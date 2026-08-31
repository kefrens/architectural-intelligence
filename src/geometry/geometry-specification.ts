/**
 * The Geometry Specification (Sprint 1.1 — ADR-AI-0001's fifth and final design
 * artefact).
 *
 * Where the Geometry Graph says *where* a room is and *how large*, this says how
 * thick the thing between two rooms is, how tall, where its centreline runs, and
 * how wide the door through it is. It is the last artefact this repository
 * produces and the only one that crosses to a consuming CAD application.
 *
 * ## Complete enough that nobody downstream decides anything
 *
 * That is the whole test of this artefact. A consumer holding one has no
 * architectural decision left to take: every coordinate is a number, every wall
 * has a thickness and a height, every opening has a position and a size
 * (Rule 4). What it does **not** carry is topology — nodes, joins, entity
 * identifiers, commands, transactions — because those depend on the CAD system,
 * and choosing them is not architecture (ADR-0031).
 *
 * ## Why the conventions are fields
 *
 * Metre, 0.001, origin, winding, elevation datum. A consumer outside this
 * project has no `CLAUDE.md` to read them from, and a convention that lives only
 * in prose is one a second consumer gets wrong (Rule 5).
 *
 * ## Why the contract version is not the package version
 *
 * `@archisimple/automation-api` carries its own `1.3.0` for the same reason. The
 * two repositories are deliberately not lockstep (ADR-0029 Rule 5), so the npm
 * version cannot tell a consumer whether it can read this. A **major** bump
 * means a consumer must change; an added optional field does not (Rule 8).
 *
 * ## What is deliberately absent
 *
 * **Validation results.** `validateGeometrySpecification` computes them on
 * demand and nothing stores them, for the reason `LayoutQuality` and the packing
 * evaluation are not stored: a verdict written into an artefact is stale the
 * moment a revision lands.
 */

import { createUuid, type Point2D } from '@archisimple/shared';
import type { EnrichedArtefact } from '../artefacts/enriched-artefact.js';
import type { OpeningKind, WallRole } from './construction-defaults.js';

/** The artefact kind, as carried by `ProposalArtefact.kind` and stored in the project file. */
export const GEOMETRY_SPECIFICATION_KIND = 'geometry-specification';

/**
 * The contract a consumer reads this against (Rule 8).
 *
 * Semantic, and independent of the npm version. A consumer checks the **major**
 * and refuses what it was not written for rather than reading it partially.
 */
export const GEOMETRY_CONTRACT_VERSION = '1.0.0';

/**
 * How to read every number in this artefact.
 *
 * Stated rather than assumed, because the consumer may be nobody this project
 * has met.
 */
export interface MetricConventions {
  /** Always `metre` — the platform's working unit. */
  readonly unit: 'metre';
  /** The grid every coordinate is expressed against, in metres. */
  readonly precision: number;
  /** Where (0, 0) is: the lowest corner of the ground storey's envelope. */
  readonly origin: 'ground-storey-envelope-minimum';
  /** Boundary winding, seen from above. */
  readonly winding: 'counter-clockwise';
  /** What storey elevations are measured from. */
  readonly elevationDatum: 'ground-storey-finished-floor';
}

export const METRIC_CONVENTIONS: MetricConventions = Object.freeze({
  unit: 'metre',
  precision: 0.001,
  origin: 'ground-storey-envelope-minimum',
  winding: 'counter-clockwise',
  elevationDatum: 'ground-storey-finished-floor'
});

/** The Geometry Graph this was resolved from (Rules 4 and 6). */
export interface GeometryProvenance {
  readonly geometryGraphId: string;
  /**
   * The revision that was read. A Graph revised afterwards leaves this
   * Specification stale — the field that makes that detectable rather than
   * silent, exactly as `LayoutProvenance` does one stage up.
   */
  readonly geometryGraphRevision: number;
}

export interface SpecifiedStorey {
  readonly index: number;
  /** Finished floor level, from the datum. */
  readonly elevation: number;
  /** Floor to floor. */
  readonly height: number;
}

/** One room, with the boundary it has once the walls are in. */
export interface SpecifiedSpace {
  /** Stable across revisions: the Geometry Graph's polygon id. */
  readonly id: string;
  readonly spaceId: string;
  readonly name: string;
  readonly storey: number;
  /** The finished face, counter-clockwise. */
  readonly boundary: readonly Point2D[];
  readonly area: number;
}

/**
 * One wall, as geometry.
 *
 * A centreline and a thickness — never a node, never a join, never an id
 * belonging to somebody's model. `separates` names the spaces either side, which
 * is what lets a consumer relate a wall to the rooms without inferring it from
 * coordinates.
 */
export interface SpecifiedWall {
  readonly id: string;
  readonly storey: number;
  readonly start: Point2D;
  readonly end: Point2D;
  readonly thickness: number;
  readonly role: WallRole;
  /** Clear height, floor to underside of the structure above. */
  readonly height: number;
  /** Space ids either side. One for an external wall, two for an internal one. */
  readonly separates: readonly string[];
  /**
   * The approved geometry's wall candidates this run realises.
   *
   * Provenance, and what makes "every wall the geometry named was built" a
   * checkable claim rather than a hope — several candidates merge into one wall,
   * so counting is not enough.
   */
  readonly realises: readonly string[];
}

/** One opening, positioned and sized. */
export interface SpecifiedOpening {
  readonly id: string;
  readonly wallId: string;
  readonly kind: OpeningKind;
  /** Centre of the opening, measured from the wall's `start` along its centreline. */
  readonly distanceAlongWall: number;
  readonly width: number;
  readonly height: number;
  /** Underside above the finished floor. Zero for a door. */
  readonly sill: number;
  /** The two spaces this connects. */
  readonly connects: readonly [string, string];
  /**
   * The Library entry this opening was designed as (Sprint 1.11, ArchiSimple
   * ADR-0038 Rule 6, ADR-0057).
   *
   * **Identity, never a dimension source.** `width`, `height` and `sill` above
   * stay authoritative and are what the host builds; this says *which door was
   * specified*, which a kind and three numbers cannot. A double door has to
   * draw as a double door.
   *
   * The host validates it as a **shape** and resolves nothing (ArchiSimple
   * Sprint 053.1): an identity naming a library a machine never installed is
   * valid, and never blocks a build. A design must be buildable without a
   * catalogue, or an approved artefact would be machine-dependent — which
   * ADR-0027.1 Rule 4 forbids.
   *
   * Absent for a cased opening, and for every Specification produced before
   * this existed.
   */
  readonly assetDefinitionId?: string;
}

/**
 * Why a wall is where it is.
 *
 * **Provenance, never an instruction** (Rule 4). A consumer that reads these and
 * tries to satisfy them is running a solver, which is architectural reasoning,
 * which ADR-0031 Rule 2 forbids it. They exist so a model can record the reason
 * and a later revision can re-solve — for nothing else in this pipeline.
 */
export interface GeometryConstraintRecord {
  readonly subjectId: string;
  readonly kind: string;
  readonly reason: string;
}

export interface GeometrySpecification extends EnrichedArtefact {
  readonly kind: typeof GEOMETRY_SPECIFICATION_KIND;
  readonly id: string;
  readonly revision: number;
  readonly createdAt: number;
  readonly contractVersion: string;
  readonly conventions: MetricConventions;
  readonly sourceGeometry: GeometryProvenance;
  readonly storeys: readonly SpecifiedStorey[];
  readonly spaces: readonly SpecifiedSpace[];
  readonly walls: readonly SpecifiedWall[];
  readonly openings: readonly SpecifiedOpening[];
  readonly constraints: readonly GeometryConstraintRecord[];
  /** Every number this artefact decided rather than received. */
  readonly assumptions: readonly string[];
  /** Caveats that do not block review — a room that grew, a door narrowed to fit. */
  readonly warnings: readonly string[];
}

export function createGeometrySpecification(input: {
  readonly sourceGeometry: GeometryProvenance;
  readonly storeys: readonly SpecifiedStorey[];
  readonly spaces: readonly SpecifiedSpace[];
  readonly walls: readonly SpecifiedWall[];
  readonly openings?: readonly SpecifiedOpening[];
  readonly constraints?: readonly GeometryConstraintRecord[];
  readonly assumptions?: readonly string[];
  readonly warnings?: readonly string[];
  readonly now?: number;
}): GeometrySpecification {
  return {
    kind: GEOMETRY_SPECIFICATION_KIND,
    id: createUuid(),
    revision: 1,
    createdAt: input.now ?? Date.now(),
    contractVersion: GEOMETRY_CONTRACT_VERSION,
    conventions: METRIC_CONVENTIONS,
    sourceGeometry: input.sourceGeometry,
    storeys: input.storeys,
    spaces: input.spaces,
    walls: input.walls,
    openings: input.openings ?? [],
    constraints: input.constraints ?? [],
    assumptions: input.assumptions ?? [],
    warnings: input.warnings ?? []
  };
}

/**
 * The next revision (Rule 9): same identity, incremented revision, nothing
 * mutated.
 *
 * Unlike the four artefacts above it, this one has a **production** caller —
 * regenerating over an approved Specification produces revision n+1 rather than
 * a second artefact at revision 1 (Story 1.1.13).
 */
export function reviseGeometrySpecification(
  specification: GeometrySpecification,
  patch: Partial<
    Pick<
      GeometrySpecification,
      | 'storeys'
      | 'spaces'
      | 'walls'
      | 'openings'
      | 'constraints'
      | 'assumptions'
      | 'warnings'
      // Sprint 1.3: a revision regenerated from a newer Graph must record that
      // Graph, or staleness would be computed against a provenance that lies.
      | 'sourceGeometry'
      | 'contributedBy'
    >
  >
): GeometrySpecification {
  return { ...specification, ...patch, revision: specification.revision + 1 };
}

/** A specification with at least one space and one wall. An empty one is never offered. */
export function isGeometrySpecificationComplete(specification: GeometrySpecification): boolean {
  return specification.spaces.length > 0 && specification.walls.length > 0;
}

/** Whether this was resolved from the Geometry revision now in force (Rule 6). */
export function matchesGeometryGraph(
  specification: GeometrySpecification,
  graph: { readonly id: string; readonly revision: number }
): boolean {
  return (
    specification.sourceGeometry.geometryGraphId === graph.id &&
    specification.sourceGeometry.geometryGraphRevision === graph.revision
  );
}

/** Whether a consumer written against `contractVersion` can read this (Rule 8). */
export function isContractCompatible(
  specification: GeometrySpecification,
  consumerVersion: string
): boolean {
  return major(specification.contractVersion) === major(consumerVersion);
}

function major(version: string): string {
  return version.split('.')[0] ?? '';
}

/** The total floor area of one storey, measured across the finished faces. */
export function storeyFloorArea(specification: GeometrySpecification, storey: number): number {
  return specification.spaces
    .filter((space) => space.storey === storey)
    .reduce((total, space) => total + space.area, 0);
}

/**
 * The specification as markdown, for the message and the review card.
 *
 * Leads with what changed from the geometry the user already approved — the
 * wall thicknesses, and any room that had to grow — because that is the only
 * new information. Everything else they have seen.
 */
export function summarizeGeometrySpecification(specification: GeometrySpecification): string {
  const lines: string[] = [];

  for (const storey of specification.storeys) {
    const here = specification.spaces.filter((space) => space.storey === storey.index);
    if (here.length === 0) {
      continue;
    }

    lines.push(
      `**${storeyLabel(storey.index)}** — ${round(storeyFloorArea(specification, storey.index))} m², walls ${round(wallHeightOn(specification, storey.index))} m clear`
    );
    for (const space of here) {
      lines.push(`- ${space.name} — ${round(space.area)} m²`);
    }
    lines.push('');
  }

  const external = specification.walls.filter((wall) => wall.role === 'external');
  const internal = specification.walls.length - external.length;
  const thicknesses = [...new Set(specification.walls.map((wall) => wall.thickness))].sort(
    (a, b) => a - b
  );

  lines.push(
    `**Walls** — ${internal} internal and ${external.length} external, at ${thicknesses.map((value) => `${Math.round(value * 1000)} mm`).join(' and ')}`
  );
  lines.push(
    `**Openings** — ${specification.openings.length} ${specification.openings.length === 1 ? 'opening' : 'openings'}, ${describeOpeningMix(specification)}`
  );

  return lines.join('\n').trimEnd();
}

function describeOpeningMix(specification: GeometrySpecification): string {
  const doors = specification.openings.filter((opening) => opening.kind === 'door').length;
  const passages = specification.openings.length - doors;
  if (passages === 0) {
    return 'all doors';
  }
  if (doors === 0) {
    return 'all cased openings';
  }
  return `${doors} ${doors === 1 ? 'door' : 'doors'} and ${passages} cased`;
}

function wallHeightOn(specification: GeometrySpecification, storey: number): number {
  return specification.walls.find((wall) => wall.storey === storey)?.height ?? 0;
}

function storeyLabel(storey: number): string {
  if (storey === 0) {
    return 'Ground floor';
  }
  const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'];
  return `${ordinals[storey - 1] ?? `${storey}th`} floor`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
