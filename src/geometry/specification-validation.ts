/**
 * Validating a Geometry Specification (Sprint 1.1, Epic 3).
 *
 * The artefact validates **itself**, before approval, in the vocabulary the rest
 * of the pipeline already uses — `PlanBlocker` and `PLAN_BLOCKER_REASONS`
 * (ADR-0027.1 Rule 8, ADR-AI-0001 Rule 7).
 *
 * ## Why this is exported
 *
 * Because ADR-0031 Rule 4 makes a *translator's* rejection a defect in **this**
 * repository rather than a question for the user. A consumer asked to build a
 * malformed Specification has no good move: the user approved this design, and
 * surfacing a geometry failure at construction time would be a second failure
 * surface for something that already passed one. So the malformation has to be
 * caught here, and a consumer's own validation is a safety net that should never
 * fire.
 *
 * ## The invariants
 *
 * `S1`–`S7` of the sprint's contract. `S1`, `S2`, `S4` and `S6` are what
 * `insertWallThickness` guarantees, re-checked here rather than trusted: the
 * skill guarantees them *for its own output*, and by the time a Specification
 * reaches this gate a stage provider may have enriched it (Rule 10). A provider
 * that breaks a clause is caught by the same check as broken synthesis.
 */

import { GEOMETRY_EPSILON, boundsOf, isRectilinear } from '@archisimple/skills';
import { PLAN_BLOCKER_REASONS, type PlanBlocker } from '../planning/index.js';
import type { GeometryGraph } from './geometry-graph.js';
import {
  isGeometrySpecificationComplete,
  type GeometrySpecification,
  type SpecifiedSpace
} from './geometry-specification.js';
import { specificationJunctions } from './specification-synthesis.js';

/** The clauses, so a failure can name the one it broke. */
export const SPECIFICATION_INVARIANTS = {
  S1: 'no space is smaller than the geometry approved',
  S2: 'no two spaces touch or overlap',
  S3: 'every wall and opening the geometry named exists',
  S4: 'wall ends meet within the stated precision',
  S5: 'every opening fits inside its wall',
  S6: 'every space boundary is a simple rectilinear shape',
  S7: 'the artefact is complete and self-describing'
} as const;

export type SpecificationInvariantId = keyof typeof SPECIFICATION_INVARIANTS;

export interface SpecificationViolation {
  readonly id: SpecificationInvariantId;
  readonly detail: string;
}

/**
 * Every clause this Specification breaks, as blockers.
 *
 * An empty array is the healthy case, and the only one that may be offered for
 * approval. `graph` is optional: `S1` and `S3` compare against the artefact
 * above, and a caller validating a Specification loaded from a project file may
 * no longer hold it.
 */
export function validateGeometrySpecification(
  specification: GeometrySpecification,
  graph?: GeometryGraph
): readonly PlanBlocker[] {
  return violationsOf(specification, graph).map((violation): PlanBlocker => ({
    reason: PLAN_BLOCKER_REASONS.Unsupported,
    message: `${violation.id} — ${SPECIFICATION_INVARIANTS[violation.id]}: ${violation.detail}`,
    suggestions: ['Revise the geometry and generate the specification again.']
  }));
}

export function violationsOf(
  specification: GeometrySpecification,
  graph?: GeometryGraph
): readonly SpecificationViolation[] {
  const violations: SpecificationViolation[] = [];

  if (!isGeometrySpecificationComplete(specification)) {
    violations.push({
      id: 'S7',
      detail: 'a specification with no spaces or no walls describes no building'
    });
  }
  if (specification.contractVersion.length === 0 || specification.conventions.unit !== 'metre') {
    violations.push({
      id: 'S7',
      detail: 'the contract version and metric conventions must both be stated'
    });
  }

  // S6 first: the later clauses measure shapes, and measuring one this cannot
  // judge would report a wrong number rather than an unanswerable question.
  for (const space of specification.spaces) {
    if (!isRectilinear(space.boundary)) {
      violations.push({
        id: 'S6',
        detail: `${space.name} is not an axis-aligned rectangle`
      });
    }
  }
  if (violations.some((violation) => violation.id === 'S6')) {
    return violations;
  }

  if (graph !== undefined) {
    for (const polygon of graph.polygons) {
      const space = specification.spaces.find((entry) => entry.id === polygon.id);
      if (space === undefined) {
        violations.push({ id: 'S3', detail: `${polygon.name} is missing from the specification` });
        continue;
      }
      if (space.area < polygon.achievedArea - GEOMETRY_EPSILON) {
        violations.push({
          id: 'S1',
          detail: `${space.name} is ${round(space.area)} m² against the ${round(polygon.achievedArea)} m² approved`
        });
      }
    }

    // Several candidates merge into one wall, so counting proves nothing:
    // every candidate must be named by the run that realised it.
    const realised = new Set(specification.walls.flatMap((wall) => wall.realises));
    for (const candidate of graph.wallCandidates) {
      if (!realised.has(candidate.id)) {
        violations.push({
          id: 'S3',
          detail: `a wall the geometry named on ${storeyLabel(candidate.storey)} was not built`
        });
      }
    }
  }

  violations.push(...overlaps(specification.spaces));

  for (const junction of specificationJunctions(specification)) {
    // `findJunctions` only reports meetings that are exact within the epsilon,
    // so a wall end that missed one is invisible here — this catches the
    // opposite: a junction claiming walls that are not in the artefact.
    for (const wallId of junction.wallIds) {
      if (!specification.walls.some((wall) => wall.id === wallId)) {
        violations.push({ id: 'S4', detail: `a junction names an unknown wall ${wallId}` });
      }
    }
  }

  for (const opening of specification.openings) {
    const wall = specification.walls.find((entry) => entry.id === opening.wallId);
    if (wall === undefined) {
      violations.push({
        id: 'S3',
        detail: `an opening names a wall that does not exist (${opening.wallId})`
      });
      continue;
    }

    const length = Math.abs(wall.end.x - wall.start.x) + Math.abs(wall.end.y - wall.start.y);
    if (opening.width <= 0) {
      violations.push({ id: 'S5', detail: 'an opening has no width' });
    }
    // Shape, and nothing else (Sprint 1.11). Not checked against the identifier
    // grammar and **not resolved**: this layer holds no catalogue, and an
    // identity naming a library some machine lacks is valid — the host builds
    // the opening anyway and it draws with the built-in mark.
    if (
      opening.assetDefinitionId !== undefined &&
      (typeof opening.assetDefinitionId !== 'string' || opening.assetDefinitionId.length === 0)
    ) {
      violations.push({
        id: 'S3',
        detail: `an opening names an unusable asset definition ("${String(opening.assetDefinitionId)}")`
      });
    }
    if (opening.width >= length) {
      violations.push({
        id: 'S5',
        detail: `a ${round(opening.width)} m opening does not fit a ${round(length)} m wall`
      });
    }
    const half = opening.width / 2;
    if (
      opening.distanceAlongWall - half < -GEOMETRY_EPSILON ||
      opening.distanceAlongWall + half > length + GEOMETRY_EPSILON
    ) {
      violations.push({
        id: 'S5',
        detail: `an opening at ${round(opening.distanceAlongWall)} m runs past the end of its ${round(length)} m wall`
      });
    }
    if (opening.sill + opening.height > wall.height + GEOMETRY_EPSILON) {
      violations.push({
        id: 'S5',
        detail: `an opening reaches ${round(opening.sill + opening.height)} m in a ${round(wall.height)} m wall`
      });
    }
  }

  return violations;
}

/** `S2`: rooms are separated by their walls, so none may touch. */
function overlaps(spaces: readonly SpecifiedSpace[]): readonly SpecificationViolation[] {
  const violations: SpecificationViolation[] = [];

  for (let i = 0; i < spaces.length; i += 1) {
    for (let j = i + 1; j < spaces.length; j += 1) {
      const a = spaces[i]!;
      const b = spaces[j]!;
      if (a.storey !== b.storey) {
        continue;
      }
      const boxA = boundsOf(a.boundary);
      const boxB = boundsOf(b.boundary);
      const apart =
        boxA.maxX < boxB.minX - GEOMETRY_EPSILON ||
        boxB.maxX < boxA.minX - GEOMETRY_EPSILON ||
        boxA.maxY < boxB.minY - GEOMETRY_EPSILON ||
        boxB.maxY < boxA.minY - GEOMETRY_EPSILON;
      if (!apart) {
        violations.push({
          id: 'S2',
          detail: `${a.name} and ${b.name} touch or overlap; the wall between them left no gap`
        });
      }
    }
  }

  return violations;
}

/**
 * The invariant gate (Story 1.1.10).
 *
 * Runs after enrichment and before the proposal, so a stage provider that breaks
 * a clause is caught by the same check as broken synthesis — the shape
 * `gateGeometryGraph` established one stage up, and the reason it is a gate
 * rather than a test: a suite proves *this* synthesis upholds the contract, and
 * says nothing about a provider nobody here wrote.
 */
export function gateGeometrySpecification(
  specification: GeometrySpecification,
  graph?: GeometryGraph
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  const violations = violationsOf(specification, graph);
  if (violations.length === 0) {
    return { ok: true };
  }

  const detail = violations
    .map(
      (violation) =>
        `${violation.id} (${SPECIFICATION_INVARIANTS[violation.id]}): ${violation.detail}`
    )
    .join('. ');

  return {
    ok: false,
    message: `The specification could not be used: it breaks ${violations.length === 1 ? 'a structural requirement' : `${violations.length} structural requirements`}. ${detail}`
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function storeyLabel(storey: number): string {
  if (storey === 0) {
    return 'the ground floor';
  }
  const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
  return `the ${ordinals[storey - 1] ?? `${storey}th`} floor`;
}
