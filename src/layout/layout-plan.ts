/**
 * The Layout Plan (Sprint 28.0 — ADR-0027.1's third planning artefact).
 *
 * How the approved Space Programme is organised: which storey each space sits
 * on, which spaces end up next to which, and how you get around. It is what
 * Geometry Synthesis (Sprint 28.1) reads instead of re-deriving an arrangement
 * from a room list.
 *
 * ## Geometry-free, and what that costs
 *
 * No coordinates, no dimensions, no walls, no Runtime entities (Rule 3). A
 * storey is an integer index, not a height; an arrangement is a *relation*
 * between spaces, not a set of positions.
 *
 * The solver may use an abstract planning grid internally, but none of it
 * reaches this artefact. That is a deliberate cost: it means Sprint 28.1 derives
 * placement from the graph rather than inheriting the solver's cells, and the
 * obligation it creates is stated as a contract — **a Layout Plan must determine
 * a placement up to rotation and reflection.** If it ever fails to, the fix is
 * to enrich the graph, never to leak the grid.
 *
 * ## Why the space list travels with the plan
 *
 * Target areas live in `ProgrammeSpace.areaEach`, and Geometry Synthesis has to
 * size rooms. Carrying them here is what makes "the Layout Plan is the sole
 * input to 28.1" true rather than aspirational, and it costs nothing
 * architecturally: **an area is not a dimension**. The Space Programme carries
 * areas and is geometry-free under Rule 3; so is this.
 *
 * The copy cannot drift, because {@link ProgrammeProvenance} pins the exact
 * revision it came from, and space ids are the Programme's own — so the graph,
 * the adjacencies, the artefact and 28.1 all name spaces identically.
 *
 * ## What is deliberately absent
 *
 * **Quality.** The metrics are recomputed from the graph on demand
 * (`layout-quality.ts`), never stored: a score written into the artefact goes
 * stale the moment a stage provider enriches the plan, and a stale score is
 * worse than none.
 *
 * **Orientation and daylight.** Nothing in the Brief or the Programme captures a
 * site or a north direction, so there is no input to satisfy. They return when a
 * site topic exists, not before.
 */

import { createUuid } from '@archisimple/shared';
import { STOREY_PRECONDITIONS, type StoreyPrecondition } from '@archisimple/skills';
import type { EnrichedArtefact } from '../artefacts/enriched-artefact.js';
import type { FunctionalZone, SpacePriority } from '../programme/space-programme.js';

/** The artefact kind, as carried by `ProposalArtefact.kind` and stored in the project file. */
export const LAYOUT_PLAN_KIND = 'layout-plan';

/** The Space Programme this layout was resolved from (Rules 4 and 12). */
export interface ProgrammeProvenance {
  readonly programmeId: string;
  /**
   * The revision that was read. A Programme revised afterwards leaves this
   * layout stale — this is the field that makes that detectable rather than
   * silent.
   */
  readonly programmeRevision: number;
}

/**
 * A programme space, placed.
 *
 * Everything except `storeys` is carried verbatim from the Programme, including
 * the id.
 */
export interface LayoutSpace {
  /** The Programme's space id, unchanged. */
  readonly id: string;
  readonly name: string;
  readonly count: number;
  /** Target area of one instance, in square metres. Carried, never recomputed. */
  readonly areaEach: number;
  readonly priority: SpacePriority;
  readonly zone: FunctionalZone;
  /**
   * The storeys this space occupies, ascending. Ground is `0`.
   *
   * One entry for an ordinary space — *which* of three bedrooms sits where is a
   * placement detail and belongs to Sprint 28.1. Vertical circulation lists
   * **every** storey it connects, which is what makes it vertical.
   */
  readonly storeys: readonly number[];
}

export const LAYOUT_NODE_KINDS = {
  Space: 'space',
  /** One synthetic node per storey, standing for "getting around on this floor". */
  Circulation: 'circulation'
} as const;

export type LayoutNodeKind = (typeof LAYOUT_NODE_KINDS)[keyof typeof LAYOUT_NODE_KINDS];

export const LAYOUT_EDGE_KINDS = {
  /** The two spaces share a boundary. Only possible on a common storey. */
  Adjacent: 'adjacent',
  /** Reachable but not touching — through circulation. */
  Connected: 'connected',
  /** Deliberately apart. A requirement in its own right, not a missing edge. */
  Separated: 'separated',
  /** Between the circulation of two storeys. */
  VerticalConnection: 'vertical-connection'
} as const;

export type LayoutEdgeKind = (typeof LAYOUT_EDGE_KINDS)[keyof typeof LAYOUT_EDGE_KINDS];

export interface LayoutNode {
  /** A space id, or `circulation:<storey>` for a circulation node. */
  readonly id: string;
  readonly kind: LayoutNodeKind;
  readonly storeys: readonly number[];
}

export interface LayoutEdge {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly kind: LayoutEdgeKind;
}

/**
 * The planning graph — the structure everything downstream reads.
 *
 * Quality is computed from here, and Sprint 28.1 places from here. Nodes are in
 * a stated total order (see `layout-synthesis.ts`), so two runs over the same
 * Programme produce byte-identical graphs.
 */
export interface PlanningGraph {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
}

/**
 * One intended relationship, resolved.
 *
 * Nothing is dropped: an intent this stage cannot honour survives into the
 * artefact that failed to meet it, so the Programme's requirement is still
 * visible where it was lost.
 *
 * ## There is no `satisfied` (Sprint 1.8, ArchiSimple ADR-0034 §4.1a)
 *
 * There was, and it meant "the two spaces share a storey". On a single-storey
 * building every pair shares storey 0, so every required and preferred intent
 * resolved satisfied whatever the arrangement — a necessary condition reported
 * as a sufficient one, and the first of BUG-011's four mechanisms.
 *
 * What replaces it says only what the storeys establish. Whether an intent is
 * *met* is `constraints.evaluate`'s answer, at a stage that has boundaries and
 * openings to look at — which the Layout Plan does not.
 */
export interface ResolvedAdjacency {
  readonly fromSpaceId: string;
  readonly toSpaceId: string;
  readonly relation: LayoutEdgeKind;
  /**
   * What the storey assignment alone establishes, mirroring the platform's
   * `StoreyPrecondition` rather than inventing a second vocabulary.
   *
   * The asymmetry is the point: `impossible` is authoritative — two spaces on
   * different floors cannot share a boundary, whatever geometry follows — while
   * `possible` decides nothing at all.
   *
   * Optional because an approved plan written before Sprint 1.8 does not carry
   * it (ADR-0027.1 Rule 4 makes approved artefacts immutable). Absent reads as
   * {@link storeyPreconditionOf}'s `unknown-space`: honest for a plan whose
   * `satisfied` claim this sprint decided not to trust.
   */
  readonly storeyPrecondition?: StoreyPrecondition;
  /** The intended strength this resolves — `required`, `preferred` or `avoid`. */
  readonly strength: string;
  /** Carried from the intent, so the review card explains *why* this mattered. */
  readonly reason: string;
}

/**
 * Reads {@link ResolvedAdjacency.storeyPrecondition}, including from a plan that
 * predates it.
 *
 * A pre-Sprint-1.8 artefact carries `satisfied` instead, and that boolean is
 * exactly the claim ADR-0034 §4.1a superseded — so it is **not** translated into
 * a precondition. `unknown-space` is what "we no longer trust what this said"
 * looks like in the current vocabulary, and every reader treats it as
 * undecided rather than as a failure.
 */
export function storeyPreconditionOf(adjacency: ResolvedAdjacency): StoreyPrecondition {
  return adjacency.storeyPrecondition ?? STOREY_PRECONDITIONS.UnknownSpace;
}

export interface CirculationStrategy {
  /** Spaces that carry people between storeys — the staircase. */
  readonly verticalSpaceIds: readonly string[];
  /** Which circulation spaces serve each storey. */
  readonly perStorey: readonly {
    readonly storey: number;
    readonly circulationSpaceIds: readonly string[];
  }[];
  /** Storeys with no circulation at all, ascending. Empty is the healthy case. */
  readonly unservedStoreys: readonly number[];
  /** Plain language, for the review card. */
  readonly description: string;
}

export interface LayoutPlan extends EnrichedArtefact {
  readonly kind: typeof LAYOUT_PLAN_KIND;
  readonly id: string;
  readonly revision: number;
  readonly createdAt: number;
  readonly sourceProgramme: ProgrammeProvenance;
  readonly storeys: number;
  readonly spaces: readonly LayoutSpace[];
  readonly graph: PlanningGraph;
  readonly adjacencies: readonly ResolvedAdjacency[];
  readonly circulation: CirculationStrategy;
  /** Every decision this artefact made that the Programme did not state. */
  readonly assumptions: readonly string[];
  /** Caveats that do not block review — an unsatisfied requirement, an unserved storey. */
  readonly warnings: readonly string[];
}

export function createLayoutPlan(input: {
  readonly sourceProgramme: ProgrammeProvenance;
  readonly storeys: number;
  readonly spaces: readonly LayoutSpace[];
  readonly graph: PlanningGraph;
  readonly adjacencies?: readonly ResolvedAdjacency[];
  readonly circulation: CirculationStrategy;
  readonly assumptions?: readonly string[];
  readonly warnings?: readonly string[];
  readonly now?: number;
}): LayoutPlan {
  return {
    kind: LAYOUT_PLAN_KIND,
    id: createUuid(),
    revision: 1,
    createdAt: input.now ?? Date.now(),
    sourceProgramme: input.sourceProgramme,
    storeys: input.storeys,
    spaces: input.spaces,
    graph: input.graph,
    adjacencies: input.adjacencies ?? [],
    circulation: input.circulation,
    assumptions: input.assumptions ?? [],
    warnings: input.warnings ?? []
  };
}

/**
 * The next revision (Rule 4): same identity, incremented revision, nothing mutated.
 *
 * `sourceProgramme` and `contributedBy` joined the patch in Sprint 1.3, when
 * regenerating a stage became a revision of it rather than a second artefact
 * (Story 1.3.7). A revision regenerated from a *newer* upstream revision must
 * record that upstream, or its provenance would claim it came from the one it
 * superseded — and staleness would then be computed against a lie.
 */
export function reviseLayoutPlan(
  plan: LayoutPlan,
  patch: Partial<
    Pick<
      LayoutPlan,
      | 'spaces'
      | 'graph'
      | 'adjacencies'
      | 'circulation'
      | 'assumptions'
      | 'warnings'
      | 'sourceProgramme'
      | 'contributedBy'
    >
  >
): LayoutPlan {
  return { ...plan, ...patch, revision: plan.revision + 1 };
}

/** A layout with at least one space. An empty one is never offered for approval. */
export function isLayoutPlanComplete(plan: LayoutPlan): boolean {
  return plan.spaces.length > 0;
}

/** Whether this layout was resolved from the revision of the Programme now in force (Rule 12). */
export function matchesProgramme(
  plan: LayoutPlan,
  programme: { readonly id: string; readonly revision: number }
): boolean {
  return (
    plan.sourceProgramme.programmeId === programme.id &&
    plan.sourceProgramme.programmeRevision === programme.revision
  );
}

/** The id of the synthetic circulation node for a storey. */
export function circulationNodeId(storey: number): string {
  return `circulation:${storey}`;
}

/** A storey's ordinal, for prose: "the ground floor", "the first floor". */
export function storeyName(storey: number): string {
  if (storey === 0) {
    return 'ground floor';
  }
  const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
  return `${ordinals[storey - 1] ?? `${storey}th`} floor`;
}

/**
 * The layout as markdown, for the message and the review card.
 *
 * Grouped by storey, because the storey assignment is the decision a reader is
 * most likely to disagree with, and one they cannot disagree with if they
 * cannot see it.
 */
export function summarizeLayoutPlan(plan: LayoutPlan): string {
  const lines: string[] = [];

  for (let storey = 0; storey < plan.storeys; storey += 1) {
    const here = plan.spaces.filter((space) => space.storeys.includes(storey));
    if (here.length === 0) {
      continue;
    }
    lines.push(`**${capitalize(storeyName(storey))}**`);
    for (const space of here) {
      const count = space.count === 1 ? '' : ` × ${space.count}`;
      const shared = space.storeys.length > 1 ? ' _(all storeys)_' : '';
      lines.push(`- ${space.name}${count} — ${space.areaEach} m²${shared}`);
    }
    lines.push('');
  }

  // The authoritative half of the storey rule, and the only half: two spaces on
  // different floors cannot share a boundary, whatever geometry follows. What is
  // *not* listed here is everything still undecided — a plan cannot yet say
  // whether the rest were honoured (ADR-0034 §4.1a).
  const ruledOut = plan.adjacencies.filter(
    (adjacency) => storeyPreconditionOf(adjacency) === STOREY_PRECONDITIONS.Impossible
  );
  if (ruledOut.length > 0) {
    lines.push('**Cannot be placed together**');
    for (const adjacency of ruledOut) {
      const from = spaceName(plan, adjacency.fromSpaceId);
      const to = spaceName(plan, adjacency.toSpaceId);
      lines.push(`- ${from} ↔ ${to} — ${adjacency.reason}`);
    }
    lines.push('');
  }

  lines.push(`**Circulation** — ${plan.circulation.description}`);

  return lines.join('\n').trimEnd();
}

function spaceName(plan: LayoutPlan, spaceId: string): string {
  return plan.spaces.find((space) => space.id === spaceId)?.name ?? spaceId;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
