/**
 * The Geometry Graph (Sprint 28.1a — ADR-0027.1's fourth planning artefact).
 *
 * The first stage where coordinates exist, and the last one before they become
 * walls. Rooms are polygons; the edges between them are *candidates* for walls;
 * the places those candidates must be crossed are *candidates* for openings.
 *
 * ## Semantic before metric
 *
 * A wall candidate is an edge a wall will later be built along. It is not a
 * wall: it has no thickness, no material, no height and no `CommandRequest`.
 * Wall thickness belongs to the Geometry Plan one stage down, and so does the
 * offsetting that makes room for it (ADR-0027.1 Ownership Matrix).
 *
 * ## Polygons are finished faces
 *
 * A room polygon bounds the **finished face** of the space — the surface a tape
 * measure touches — so a polygon of 12 m² is a room of 12 m². The alternative,
 * centrelines, would make every room lose half a wall thickness on each side the
 * moment thickness arrived, and the areas a user approved in the Space Programme
 * would be quietly under-delivered by a stage they never reviewed.
 *
 * ## Axis-aligned rectangles, in this sprint
 *
 * A stated limitation, not an accident. The built-in packer produces nothing
 * else, and constraining the shape turned the riskiest work of the sprint —
 * robust general-polygon predicates — into interval arithmetic that could be
 * tested exhaustively. `evaluatePacking` **refuses** a shape it cannot judge
 * rather than judging it wrongly; Sprint 28.1b narrows that refusal.
 *
 * ## What is deliberately absent
 *
 * **Evaluation.** `evaluateGeometryGraph` computes it on demand and nothing
 * stores it, for the reason `LayoutQuality` is not stored: a verdict written
 * into an artefact is stale the moment constraint optimisation revises it.
 */

import { createUuid, type Point2D } from '@archisimple/shared';
import type { EnrichedArtefact } from '../artefacts/enriched-artefact.js';

/** The artefact kind, as carried by `ProposalArtefact.kind` and stored in the project file. */
export const GEOMETRY_GRAPH_KIND = 'geometry-graph';

/** The Layout Plan this geometry was realised from (Rules 4 and 12). */
export interface LayoutProvenance {
  readonly layoutId: string;
  /**
   * The revision that was read. A Layout revised afterwards leaves this geometry
   * stale — the field that makes that detectable rather than silent.
   */
  readonly layoutRevision: number;
}

/** One room, placed. */
export interface RoomPolygon {
  /** Unique per instance: a three-bedroom space produces three of these. */
  readonly id: string;
  /** The Layout Plan's — and therefore the Programme's — space id. */
  readonly spaceId: string;
  readonly name: string;
  readonly storey: number;
  /** Counter-clockwise, closed by convention rather than by a repeated last point. */
  readonly corners: readonly Point2D[];
  /** What the Space Programme asked for, in square metres. */
  readonly requestedArea: number;
  /** What this polygon actually encloses. Both are recorded; see `I7`. */
  readonly achievedArea: number;
}

/**
 * An edge a wall will be built along.
 *
 * `between` names the polygons it separates — two for an internal wall, one for
 * an external one. There is no thickness here, and no `wallType`: choosing those
 * is the Geometry Plan's job.
 */
export interface WallCandidate {
  readonly id: string;
  readonly storey: number;
  readonly start: Point2D;
  readonly end: Point2D;
  readonly external: boolean;
  readonly between: readonly string[];
}

/** A place a wall candidate must be crossed for the layout to work. */
export interface OpeningCandidate {
  readonly id: string;
  readonly wallCandidateId: string;
  /** The two spaces this opening connects. */
  readonly betweenSpaceIds: readonly [string, string];
  /** Carried from the Layout Plan's intent, so the card can explain why. */
  readonly reason: string;
}

/**
 * One relation the Layout Plan resolved, carried forward with whether the
 * geometry actually realised it.
 *
 * `satisfied` here is about *this* stage: the Layout may have resolved two rooms
 * as adjacent, and the packer may still have failed to place them side by side.
 * Recording that rather than dropping it is `I3`.
 */
export interface GeometryAdjacency {
  readonly fromSpaceId: string;
  readonly toSpaceId: string;
  readonly strength: string;
  readonly relation: string;
  readonly satisfied: boolean;
  readonly reason: string;
}

export interface GeometryGraph extends EnrichedArtefact {
  readonly kind: typeof GEOMETRY_GRAPH_KIND;
  readonly id: string;
  readonly revision: number;
  readonly createdAt: number;
  readonly sourceLayout: LayoutProvenance;
  readonly storeys: number;
  /** Floor level of each storey, in metres. Derived — see `assumptions`. */
  readonly storeyElevations: readonly number[];
  readonly polygons: readonly RoomPolygon[];
  readonly wallCandidates: readonly WallCandidate[];
  readonly openingCandidates: readonly OpeningCandidate[];
  readonly adjacencies: readonly GeometryAdjacency[];
  /** Every number this artefact derived rather than received. */
  readonly assumptions: readonly string[];
  /** Caveats that do not block review — an unrealised adjacency, an area shortfall. */
  readonly warnings: readonly string[];
}

export function createGeometryGraph(input: {
  readonly sourceLayout: LayoutProvenance;
  readonly storeys: number;
  readonly storeyElevations: readonly number[];
  readonly polygons: readonly RoomPolygon[];
  readonly wallCandidates: readonly WallCandidate[];
  readonly openingCandidates?: readonly OpeningCandidate[];
  readonly adjacencies?: readonly GeometryAdjacency[];
  readonly assumptions?: readonly string[];
  readonly warnings?: readonly string[];
  readonly now?: number;
}): GeometryGraph {
  return {
    kind: GEOMETRY_GRAPH_KIND,
    id: createUuid(),
    revision: 1,
    createdAt: input.now ?? Date.now(),
    sourceLayout: input.sourceLayout,
    storeys: input.storeys,
    storeyElevations: input.storeyElevations,
    polygons: input.polygons,
    wallCandidates: input.wallCandidates,
    openingCandidates: input.openingCandidates ?? [],
    adjacencies: input.adjacencies ?? [],
    assumptions: input.assumptions ?? [],
    warnings: input.warnings ?? []
  };
}

/**
 * The next revision (Rule 4): same identity, incremented revision, nothing
 * mutated.
 *
 * This is what Sprint 28.2's constraint optimisation calls. An optimiser that
 * can only revise cannot reinterpret the Layout Plan, because it never reads one
 * (Rule 13).
 */
export function reviseGeometryGraph(
  graph: GeometryGraph,
  patch: Partial<
    Pick<
      GeometryGraph,
      | 'polygons'
      | 'wallCandidates'
      | 'openingCandidates'
      | 'adjacencies'
      | 'assumptions'
      | 'warnings'
      // Sprint 1.3: a revision regenerated from a newer Layout must record that
      // Layout, or staleness would be computed against a provenance that lies.
      | 'sourceLayout'
      | 'contributedBy'
    >
  >
): GeometryGraph {
  return { ...graph, ...patch, revision: graph.revision + 1 };
}

/** A graph with at least one room. An empty one is never offered for approval. */
export function isGeometryGraphComplete(graph: GeometryGraph): boolean {
  return graph.polygons.length > 0;
}

/** Whether this geometry was realised from the Layout revision now in force (Rule 12). */
export function matchesLayout(
  graph: GeometryGraph,
  layout: { readonly id: string; readonly revision: number }
): boolean {
  return (
    graph.sourceLayout.layoutId === layout.id &&
    graph.sourceLayout.layoutRevision === layout.revision
  );
}

/** The total enclosed area of one storey, in square metres. */
export function storeyArea(graph: GeometryGraph, storey: number): number {
  return graph.polygons
    .filter((polygon) => polygon.storey === storey)
    .reduce((total, polygon) => total + polygon.achievedArea, 0);
}

/**
 * The graph as markdown, for the message and the review card.
 *
 * Grouped by storey, and it reports the *achieved* area beside the requested one
 * wherever they differ — a reader who cannot see the shortfall cannot disagree
 * with it.
 */
export function summarizeGeometryGraph(graph: GeometryGraph): string {
  const lines: string[] = [];

  for (let storey = 0; storey < graph.storeys; storey += 1) {
    const here = graph.polygons.filter((polygon) => polygon.storey === storey);
    if (here.length === 0) {
      continue;
    }

    lines.push(`**${storeyLabel(storey)}** — ${round(storeyArea(graph, storey))} m²`);
    for (const polygon of here) {
      const drift = Math.abs(polygon.achievedArea - polygon.requestedArea);
      const area =
        drift < 0.05
          ? `${round(polygon.achievedArea)} m²`
          : `${round(polygon.achievedArea)} m² _(asked for ${round(polygon.requestedArea)})_`;
      lines.push(`- ${polygon.name} — ${area}`);
    }
    lines.push('');
  }

  const internal = graph.wallCandidates.filter((candidate) => !candidate.external).length;
  const external = graph.wallCandidates.length - internal;
  lines.push(
    `**Walls** — ${internal} internal, ${external} external, with ${graph.openingCandidates.length} opening${graph.openingCandidates.length === 1 ? '' : 's'}`
  );

  return lines.join('\n').trimEnd();
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
