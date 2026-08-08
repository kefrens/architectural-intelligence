/**
 * Layout Plan → Geometry Graph (Sprint 28.1a, Epic 5).
 *
 * The one place a Geometry Graph is built. It decides no coordinate itself:
 * placement comes from a packing strategy (`geometry.packLayout` by default) and
 * every clause of the contract is judged by `geometry.evaluatePacking`, both in
 * `@archisimple/skills` (Rule 9).
 *
 * ## The invariant gate
 *
 * The evaluation runs over the produced artefact **before it is offered**,
 * whichever strategy produced it, and a violated invariant is a hard failure: no
 * proposal, and a message naming the clause.
 *
 * That is not belt-and-braces over the conformance suite — it is the only thing
 * that makes the guarantee true for a strategy nobody here wrote. A suite proves
 * the *built-in* packer upholds the contract; the moment a plugin ships, a card
 * asserting "every structural requirement holds" would be repeating a fact
 * nobody checked. The gate checks it.
 *
 * Enrichment runs **before** the gate, so a stage provider that breaks an
 * invariant is caught by the same check as a broken packer.
 *
 * ## Why it never redesigns the layout
 *
 * No space is added, removed, re-zoned or moved between storeys here. The
 * Layout Plan decided all of that and the user approved it. If the arrangement
 * is wrong, the Layout is revised — a different artefact, a different approval,
 * and a different stage (Rule 2).
 */

import {
  createSkillContext,
  packLayout,
  sharedPolygonEdges,
  type Bounds,
  type PackedPolygon,
  type PackSpaceInput
} from '@archisimple/skills';
import { createUuid } from '@archisimple/shared';
import type { LayoutPlan, LayoutSpace } from '../layout/layout-plan.js';
import {
  createGeometryGraph,
  GEOMETRY_GRAPH_KIND,
  type GeometryAdjacency,
  type GeometryGraph,
  type OpeningCandidate,
  type RoomPolygon,
  type WallCandidate
} from './geometry-graph.js';
import { evaluateGeometryGraph } from './geometry-evaluation.js';

const SKILL_CONTEXT = createSkillContext();

/**
 * Nominal floor-to-floor height, in metres.
 *
 * Nothing in the Brief, the Programme or the Layout states one, so this is
 * derived — and, like every derived number in this pipeline, it is recorded as
 * an assumption rather than presented as a requirement.
 */
const FLOOR_TO_FLOOR = 3;

export type GeometrySynthesisResult =
  | { readonly ok: true; readonly graph: GeometryGraph }
  | { readonly ok: false; readonly message: string };

export interface SynthesizeGeometryOptions {
  readonly layout: LayoutPlan;
  /**
   * Which packing strategy to run. Defaults to the built-in slicing tree.
   * A plugin supplies its own; the invariant gate judges both identically.
   */
  readonly strategy?: typeof packLayout;
  readonly now?: number;
}

function toPackInput(space: LayoutSpace): PackSpaceInput {
  return {
    id: space.id,
    name: space.name,
    count: space.count,
    areaEach: space.areaEach,
    zone: space.zone,
    priority: space.priority,
    storeys: space.storeys
  };
}

/** How many polygons each space should produce — the denominator for `I1`. */
export function expectedInstances(
  layout: LayoutPlan
): readonly { readonly spaceId: string; readonly instances: number }[] {
  return layout.spaces.map((space) => ({
    spaceId: space.id,
    // Vertical circulation occupies each storey once; everything else appears
    // `count` times on its single storey.
    instances: space.storeys.length > 1 ? space.storeys.length : space.count
  }));
}

/**
 * Wall candidates: every edge two rooms share, plus the storey envelope.
 *
 * Internal candidates come from the shared-edge predicate, so they are exact.
 * External ones are the envelope's four sides — the packer subdivides a
 * rectangle, so the building outline *is* that rectangle, and deriving it any
 * other way would be reconstructing what the packer already knew.
 */
function wallCandidatesFor(
  placed: readonly { polygon: RoomPolygon }[],
  envelopes: readonly { readonly storey: number; readonly bounds: Bounds }[]
): { walls: readonly WallCandidate[]; byPair: ReadonlyMap<string, string> } {
  const walls: WallCandidate[] = [];
  const byPair = new Map<string, string>();

  const storeys = [...new Set(placed.map((entry) => entry.polygon.storey))].sort((a, b) => a - b);

  for (const storey of storeys) {
    const here = placed.filter((entry) => entry.polygon.storey === storey);

    for (let i = 0; i < here.length; i += 1) {
      for (let j = i + 1; j < here.length; j += 1) {
        // Every shared stretch is a wall somebody has to build. Rectangles
        // share at most one; an L-shape wrapped round a room can share two, and
        // emitting only the first would leave a hole in the building.
        const edges = sharedPolygonEdges(here[i]!.polygon.corners, here[j]!.polygon.corners);
        for (const edge of edges) {
          const id = createUuid();
          walls.push({
            id,
            storey,
            start: edge.start,
            end: edge.end,
            external: false,
            between: [here[i]!.polygon.id, here[j]!.polygon.id]
          });
          // The pair maps to its longest shared wall, which is where an opening
          // between the two rooms belongs.
          if (!byPair.has(pairKey(here[i]!.polygon.spaceId, here[j]!.polygon.spaceId))) {
            byPair.set(pairKey(here[i]!.polygon.spaceId, here[j]!.polygon.spaceId), id);
          }
        }
      }
    }

    const envelope = envelopes.find((entry) => entry.storey === storey);
    if (envelope === undefined) {
      continue;
    }
    const { minX, minY, maxX, maxY } = envelope.bounds;
    const outline: readonly (readonly [{ x: number; y: number }, { x: number; y: number }])[] = [
      [
        { x: minX, y: minY },
        { x: maxX, y: minY }
      ],
      [
        { x: maxX, y: minY },
        { x: maxX, y: maxY }
      ],
      [
        { x: maxX, y: maxY },
        { x: minX, y: maxY }
      ],
      [
        { x: minX, y: maxY },
        { x: minX, y: minY }
      ]
    ];
    for (const [start, end] of outline) {
      walls.push({ id: createUuid(), storey, start, end, external: true, between: [] });
    }
  }

  return { walls, byPair };
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('::');
}

export function synthesizeGeometry(options: SynthesizeGeometryOptions): GeometrySynthesisResult {
  const { layout } = options;

  if (layout.spaces.length === 0) {
    return {
      ok: false,
      message: 'That layout contains no spaces, so there is no geometry to realise.'
    };
  }

  const strategy = options.strategy ?? packLayout;
  const packed = strategy.execute(
    { spaces: layout.spaces.map(toPackInput), storeys: layout.storeys },
    SKILL_CONTEXT
  );
  if (!packed.ok) {
    return { ok: false, message: packed.failure.message };
  }

  const polygons: readonly RoomPolygon[] = packed.value.polygons.map((polygon: PackedPolygon) => ({
    id: polygon.polygonId,
    spaceId: polygon.spaceId,
    name: polygon.name,
    storey: polygon.storey,
    corners: polygon.corners,
    requestedArea: polygon.requestedArea,
    achievedArea: polygon.achievedArea
  }));

  const placed = polygons.map((polygon) => ({ polygon }));
  const { walls, byPair } = wallCandidatesFor(placed, packed.value.envelopes);

  // Every relation the Layout resolved is carried forward with whether *this*
  // stage realised it. A layout may have called two rooms adjacent and the
  // packer still failed to place them together — recording that is `I3`.
  const adjacencies: readonly GeometryAdjacency[] = layout.adjacencies.map((adjacency) => {
    const wallId = byPair.get(pairKey(adjacency.fromSpaceId, adjacency.toSpaceId));
    const touching = wallId !== undefined;
    return {
      fromSpaceId: adjacency.fromSpaceId,
      toSpaceId: adjacency.toSpaceId,
      strength: adjacency.strength,
      relation: adjacency.relation,
      satisfied: adjacency.strength === 'avoid' ? !touching : touching,
      reason: adjacency.reason
    };
  });

  // An opening is needed wherever the layout wanted passage and the geometry
  // gave it a wall to pass through.
  const openingCandidates: readonly OpeningCandidate[] = adjacencies
    .filter((adjacency) => adjacency.strength !== 'avoid' && adjacency.satisfied)
    .map((adjacency) => {
      const wallCandidateId = byPair.get(pairKey(adjacency.fromSpaceId, adjacency.toSpaceId))!;
      return {
        id: createUuid(),
        wallCandidateId,
        betweenSpaceIds: [adjacency.fromSpaceId, adjacency.toSpaceId] as [string, string],
        reason: adjacency.reason
      };
    });

  const storeyElevations = Array.from(
    { length: layout.storeys },
    (_, storey) => storey * FLOOR_TO_FLOOR
  );

  const assumptions = [
    'Rooms are rectangles cut from a rectangular floor plate, proportional to their target areas.',
    `Floors are ${FLOOR_TO_FLOOR} m apart; nothing in the brief, the programme or the layout states a storey height.`
  ];

  const warnings: string[] = [];
  const unrealised = adjacencies.filter(
    (adjacency) => adjacency.strength !== 'avoid' && !adjacency.satisfied
  );
  for (const adjacency of unrealised) {
    warnings.push(
      `${nameOf(polygons, adjacency.fromSpaceId)} and ${nameOf(polygons, adjacency.toSpaceId)} did not end up sharing a wall — ${adjacency.reason}.`
    );
  }

  return {
    ok: true,
    graph: createGeometryGraph({
      sourceLayout: { layoutId: layout.id, layoutRevision: layout.revision },
      storeys: layout.storeys,
      storeyElevations,
      polygons,
      wallCandidates: walls,
      openingCandidates,
      adjacencies,
      assumptions,
      warnings,
      ...(options.now === undefined ? {} : { now: options.now })
    })
  };
}

/**
 * The invariant gate (Epic 4).
 *
 * Runs after enrichment and before the proposal, so a stage provider that breaks
 * an invariant is caught by the same check as a broken packer.
 */
export function gateGeometryGraph(
  graph: GeometryGraph,
  layout: LayoutPlan
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  const evaluation = evaluateGeometryGraph(graph, { expected: expectedInstances(layout) });
  if (evaluation.valid) {
    return { ok: true };
  }

  const failed = evaluation.invariants.filter((invariant) => !invariant.satisfied);
  const detail = failed
    .map((invariant) => `${invariant.id} (${invariant.summary}): ${invariant.offending.join('; ')}`)
    .join('. ');

  return {
    ok: false,
    message: `The geometry could not be used: it breaks ${failed.length === 1 ? 'a structural requirement' : `${failed.length} structural requirements`}. ${detail}`
  };
}

function nameOf(polygons: readonly RoomPolygon[], spaceId: string): string {
  return polygons.find((polygon) => polygon.spaceId === spaceId)?.name ?? spaceId;
}

export { GEOMETRY_GRAPH_KIND };
