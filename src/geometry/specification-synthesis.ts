/**
 * Geometry Graph → Geometry Specification (Sprint 1.1, Epic 2).
 *
 * The one place a Specification is built. It decides no coordinate itself:
 * thickness insertion, centrelines, run merging and junctions all live in
 * `@archisimple/skills` (ADR-AI-0001 Rule 11), and this file assembles their
 * answers into the artefact and says what it assumed.
 *
 * ## One storey at a time
 *
 * `insertWallThickness` takes a single storey's polygons and walls, because
 * storeys are packed independently and a rail is a line in *one* plan. Passing
 * two storeys at once would group coordinates that never meet into one rail and
 * move a ground-floor room to suit a wall upstairs. So this loops, realises each
 * storey separately, and concatenates — and each storey may grow by a different
 * amount, which is why the growth is reported per storey.
 *
 * ## Why it never redesigns the geometry
 *
 * No space is added, removed, reshaped or moved between storeys here. The
 * Geometry Graph decided the arrangement and the user approved it. If the
 * arrangement is wrong, the Graph is revised — a different artefact, a different
 * approval, a different stage (ADR-0027.1 Rule 2).
 *
 * What this stage may do is make a room **bigger**: a room spanning a wall line
 * inserted across it absorbs that wall. Never smaller — a room delivering less
 * than was approved, silently, is the failure ADR-0027.1 exists to prevent.
 */

import {
  boundsArea,
  boundsOf,
  createSkillContext,
  findJunctions,
  insertWallThickness,
  mergeColinearRuns,
  type RealisationPolygon,
  type RealisationWall,
  type WallCentreline,
  type WallRun
} from '@archisimple/skills';
import { createUuid, type Point2D } from '@archisimple/shared';
import {
  DEFAULT_CONSTRUCTION,
  describeDefaults,
  OPENING_KINDS,
  thicknessFor,
  WALL_ROLES,
  wallHeight,
  type ConstructionDefaults,
  type OpeningKind,
  type WallRole
} from './construction-defaults.js';
import type { GeometryGraph, OpeningCandidate, RoomPolygon } from './geometry-graph.js';
import {
  createGeometrySpecification,
  type GeometryConstraintRecord,
  type GeometrySpecification,
  type SpecifiedOpening,
  type SpecifiedSpace,
  type SpecifiedStorey,
  type SpecifiedWall
} from './geometry-specification.js';

const SKILL_CONTEXT = createSkillContext();

/** How much narrower than its wall an opening must stay, in metres. */
const OPENING_MARGIN = 0.1;

export type SpecificationSynthesisResult =
  | { readonly ok: true; readonly specification: GeometrySpecification }
  | { readonly ok: false; readonly message: string };

export interface SynthesizeSpecificationOptions {
  readonly graph: GeometryGraph;
  /** Overridable so a host with a construction standard can supply one. */
  readonly defaults?: ConstructionDefaults;
  readonly now?: number;
}

export function synthesizeSpecification(
  options: SynthesizeSpecificationOptions
): SpecificationSynthesisResult {
  const { graph } = options;
  const defaults = options.defaults ?? DEFAULT_CONSTRUCTION;

  if (graph.polygons.length === 0) {
    return {
      ok: false,
      message: 'That geometry contains no rooms, so there is nothing to give thickness to.'
    };
  }
  if (graph.wallCandidates.length === 0) {
    return {
      ok: false,
      message: 'That geometry names no walls, so there is nothing to build between the rooms.'
    };
  }

  const spaces: SpecifiedSpace[] = [];
  const walls: SpecifiedWall[] = [];
  const openings: SpecifiedOpening[] = [];
  const growth: { storey: number; x: number; y: number }[] = [];
  const warnings: string[] = [];

  for (let storey = 0; storey < graph.storeys; storey += 1) {
    const here = graph.polygons.filter((polygon) => polygon.storey === storey);
    if (here.length === 0) {
      continue;
    }

    const candidates = graph.wallCandidates.filter((candidate) => candidate.storey === storey);
    const realised = insertWallThickness.execute(
      {
        polygons: here.map((polygon): RealisationPolygon => ({
          polygonId: polygon.id,
          corners: polygon.corners
        })),
        walls: candidates.map((candidate): RealisationWall => ({
          wallId: candidate.id,
          start: candidate.start,
          end: candidate.end,
          thickness: thicknessFor(roleOf(candidate.external), defaults)
        }))
      },
      SKILL_CONTEXT
    );

    if (!realised.ok) {
      return {
        ok: false,
        message: `The walls could not be placed on ${storeyLabel(storey)}: ${realised.failure.message}`
      };
    }

    for (const polygon of realised.value.polygons) {
      const source = here.find((entry) => entry.id === polygon.polygonId)!;
      spaces.push({
        id: source.id,
        spaceId: source.spaceId,
        name: source.name,
        storey,
        boundary: polygon.corners,
        area: round(boundsArea(boundsOf(polygon.corners)))
      });
    }

    // Walls arrive one per shared edge, so a corridor with three rooms off it is
    // three segments of one wall. Merging is what makes it a wall rather than a
    // list of the rooms that happen to border it.
    const runs = mergeColinearRuns(realised.value.centrelines);
    for (const run of runs) {
      walls.push({
        id: run.runId,
        storey,
        start: run.start,
        end: run.end,
        thickness: run.thickness,
        role: roleFor(run.thickness, defaults),
        height: wallHeight(defaults),
        separates: separatedBy(run, candidates),
        realises: run.wallIds
      });
    }

    openings.push(
      ...openingsFor(graph, storey, runs, realised.value.centrelines, defaults, warnings)
    );

    growth.push({
      storey,
      x: realised.value.growth.x,
      y: realised.value.growth.y
    });

    for (const stretched of realised.value.stretched) {
      const source = here.find((entry) => entry.id === stretched.polygonId);
      warnings.push(
        `${source?.name ?? stretched.polygonId} grew by ${mm(stretched.x)} × ${mm(stretched.y)} because walls were inserted across it; it is larger than the geometry you approved, never smaller.`
      );
    }
  }

  const storeys: readonly SpecifiedStorey[] = graph.storeyElevations.map(
    (elevation, index): SpecifiedStorey => ({
      index,
      elevation,
      height: defaults.storeyHeight
    })
  );

  return {
    ok: true,
    specification: createGeometrySpecification({
      sourceGeometry: { geometryGraphId: graph.id, geometryGraphRevision: graph.revision },
      storeys,
      spaces,
      walls,
      openings,
      constraints: constraintsFrom(graph),
      assumptions: [...describeDefaults(defaults), ...describeGrowth(growth)],
      warnings,
      ...(options.now === undefined ? {} : { now: options.now })
    })
  };
}

function roleOf(external: boolean): WallRole {
  return external ? WALL_ROLES.External : WALL_ROLES.Internal;
}

/**
 * A run's role, read back from its thickness.
 *
 * Runs merge by thickness, so every segment of one run had the same role going
 * in — reading it back is recovering what was already true rather than deciding
 * again.
 */
function roleFor(thickness: number, defaults: ConstructionDefaults): WallRole {
  return Math.abs(thickness - defaults.externalWallThickness) < 1e-9
    ? WALL_ROLES.External
    : WALL_ROLES.Internal;
}

/** The spaces either side of a run: the union of what its segments separated. */
function separatedBy(
  run: WallRun,
  candidates: readonly { readonly id: string; readonly between: readonly string[] }[]
): readonly string[] {
  const separated = new Set<string>();
  for (const wallId of run.wallIds) {
    const candidate = candidates.find((entry) => entry.id === wallId);
    for (const polygonId of candidate?.between ?? []) {
      separated.add(polygonId);
    }
  }
  return [...separated].sort();
}

/**
 * Every opening candidate, positioned and sized.
 *
 * The candidate's own realised centreline gives the stretch of wall the two
 * rooms actually share, so the opening is centred on **that** rather than on the
 * merged run — a door between two rooms belongs on the wall between them, not in
 * the middle of the corridor the wall became.
 */
function openingsFor(
  graph: GeometryGraph,
  storey: number,
  runs: readonly WallRun[],
  centrelines: readonly WallCentreline[],
  defaults: ConstructionDefaults,
  warnings: string[]
): readonly SpecifiedOpening[] {
  const openings: SpecifiedOpening[] = [];

  for (const candidate of graph.openingCandidates) {
    const centreline = centrelines.find((line) => line.wallId === candidate.wallCandidateId);
    if (centreline === undefined) {
      // The candidate belongs to another storey.
      continue;
    }
    const run = runs.find((entry) => entry.wallIds.includes(candidate.wallCandidateId));
    if (run === undefined) {
      continue;
    }

    const kind = kindFor(graph, candidate);
    const shared = lengthOf(centreline.start, centreline.end);
    const wanted = defaults.opening[kind].width;
    const available = shared - OPENING_MARGIN;

    if (available <= 0) {
      warnings.push(
        `${nameOf(graph.polygons, candidate.betweenSpaceIds[0])} and ${nameOf(graph.polygons, candidate.betweenSpaceIds[1])} share too little wall for an opening, so none was placed — ${candidate.reason}.`
      );
      continue;
    }

    const width = Math.min(wanted, round(available));
    if (width < wanted) {
      warnings.push(
        `The opening between ${nameOf(graph.polygons, candidate.betweenSpaceIds[0])} and ${nameOf(graph.polygons, candidate.betweenSpaceIds[1])} was narrowed to ${mm(width)} to fit the wall they share.`
      );
    }

    const opening = defaults.opening[kind];
    openings.push({
      id: createUuid(),
      wallId: run.runId,
      kind,
      distanceAlongWall: round(distanceAlong(run, midpoint(centreline.start, centreline.end))),
      width,
      height: opening.height,
      sill: opening.sill,
      connects: candidate.betweenSpaceIds,
      // The product this specifies, where a standard one exists (Sprint 1.11).
      //
      // Written **even when the door was narrowed** to fit a short shared wall:
      // the host scales the symbol to the width actually built, and the record
      // of what was intended is worth more than a silence. The warning raised
      // above already tells a reviewer the door was narrowed.
      //
      // Omitted rather than written as `undefined`, so a passage — and any
      // future kind with no canonical product — produces exactly the opening it
      // produced before this field existed.
      ...(opening.assetDefinitionId === undefined
        ? {}
        : { assetDefinitionId: opening.assetDefinitionId })
    });
  }

  return openings.filter((opening) => runs.some((run) => run.runId === opening.wallId));
}

/**
 * Door or cased opening, from the relation the Layout resolved.
 *
 * `adjacent` is two rooms sharing a wall, which takes a door. Anything else
 * reached through circulation takes a cased opening. Nothing here reads a room's
 * name: a rule that sniffed for "hall" would be guessing, and the Layout already
 * recorded the answer.
 */
function kindFor(graph: GeometryGraph, candidate: OpeningCandidate): OpeningKind {
  const [from, to] = candidate.betweenSpaceIds;
  const adjacency = graph.adjacencies.find(
    (entry) =>
      (entry.fromSpaceId === from && entry.toSpaceId === to) ||
      (entry.fromSpaceId === to && entry.toSpaceId === from)
  );
  return adjacency?.relation === 'adjacent' ? OPENING_KINDS.Door : OPENING_KINDS.Passage;
}

/**
 * Provenance, never instructions (Rule 4).
 *
 * Every relation the Layout resolved and the Graph carried forward, recorded so
 * a reader can ask why a wall is where it is. A consumer that tries to *satisfy*
 * one is running a solver, which ADR-0031 Rule 2 forbids it.
 */
function constraintsFrom(graph: GeometryGraph): readonly GeometryConstraintRecord[] {
  // The reason is the programme's own, verbatim. It used to gain a suffix —
  // "— not realised by the approved geometry" — decided from the graph's own
  // `satisfied` boolean, which made a provenance record carry a compliance
  // verdict computed outside the evaluator (Sprint 1.8, ADR-0034 §4 and §10).
  //
  // Whether the relationship holds is answered by `constraints.evaluate` against
  // this Specification, and reported where it is established.
  return graph.adjacencies.map((adjacency) => ({
    subjectId: `${adjacency.fromSpaceId}::${adjacency.toSpaceId}`,
    kind: `adjacency:${adjacency.relation}`,
    reason: adjacency.reason
  }));
}

function describeGrowth(
  growth: readonly { storey: number; x: number; y: number }[]
): readonly string[] {
  return growth
    .filter((entry) => entry.x > 0 || entry.y > 0)
    .map(
      (entry) =>
        `${storeyLabel(entry.storey)} grew by ${mm(entry.x)} × ${mm(entry.y)} to make room for the walls; the rooms kept their sizes and the building got bigger, rather than the other way round.`
    );
}

function distanceAlong(run: WallRun, point: Point2D): number {
  return run.axis === 'vertical'
    ? Math.abs(point.y - run.start.y)
    : Math.abs(point.x - run.start.x);
}

function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function lengthOf(a: Point2D, b: Point2D): number {
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
}

function nameOf(polygons: readonly RoomPolygon[], spaceId: string): string {
  return polygons.find((polygon) => polygon.spaceId === spaceId)?.name ?? spaceId;
}

function storeyLabel(storey: number): string {
  if (storey === 0) {
    return 'The ground floor';
  }
  const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
  return `The ${ordinals[storey - 1] ?? `${storey}th`} floor`;
}

function mm(metres: number): string {
  return `${Math.round(metres * 1000)} mm`;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

/** Every junction the specification's walls form — for validation, and for a consumer. */
export function specificationJunctions(specification: GeometrySpecification) {
  return findJunctions(
    specification.walls.map((wall): WallCentreline => ({
      wallId: wall.id,
      start: wall.start,
      end: wall.end,
      axis: Math.abs(wall.start.x - wall.end.x) < 1e-9 ? 'vertical' : 'horizontal',
      thickness: wall.thickness
    }))
  );
}
