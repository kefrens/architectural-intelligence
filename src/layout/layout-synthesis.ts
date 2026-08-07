/**
 * Space Programme → Layout Plan (Sprint 28.0, Stories 28.0.2 and 28.0.3).
 *
 * The one place a Layout Plan is built. It decides nothing numeric itself:
 * every algorithm — storey assignment, adjacency resolution, circulation and
 * layout scoring — lives in `@archisimple/skills`' Layout domain (Rule 9), and
 * this file assembles their answers into the artefact.
 *
 * That split is what makes Sprint 28.0's central promise testable: *the same
 * approved Programme always yields the same Layout Plan.* Determinism is a
 * property of four pure functions plus one stated total order, not of this
 * file's iteration habits.
 *
 * ## What it resolves, and what it refuses to invent
 *
 * The Programme says a bathroom should be near a bedroom. The Layout says
 * whether it *is* — and when it is not, it says so rather than quietly dropping
 * the requirement. An arrangement that fails to satisfy something the user
 * approved is a fact the user should see, and `satisfied: false` plus a warning
 * is how they see it.
 *
 * It never redesigns the Programme. No space is added, removed, resized,
 * renamed or re-zoned here; `spacesFor` copies them and adds a storey. If the
 * Programme is wrong, the Programme is revised — which is a different artefact,
 * a different approval and a different sprint (Rule 2).
 */

import {
  assignStoreys,
  compareLayoutSpaces,
  createSkillContext,
  resolveAdjacencies,
  scoreCirculation,
  type LayoutSpaceInput,
  type StoreyAssignment
} from '@archisimple/skills';
import {
  FUNCTIONAL_ZONES,
  type ProgrammeSpace,
  type SpaceProgramme
} from '../programme/space-programme';
import {
  circulationNodeId,
  createLayoutPlan,
  LAYOUT_EDGE_KINDS,
  LAYOUT_NODE_KINDS,
  storeyName,
  type CirculationStrategy,
  type LayoutEdge,
  type LayoutNode,
  type LayoutPlan,
  type LayoutSpace,
  type PlanningGraph,
  type ResolvedAdjacency
} from './layout-plan';

export type LayoutSynthesisResult =
  | { readonly ok: true; readonly plan: LayoutPlan }
  | { readonly ok: false; readonly message: string };

export interface SynthesizeLayoutOptions {
  readonly programme: SpaceProgramme;
  readonly now?: number;
}

/** The skill's input shape, from a programme space. Ids and areas travel unchanged. */
function toSkillInput(space: ProgrammeSpace): LayoutSpaceInput {
  return {
    id: space.id,
    name: space.name,
    count: space.count,
    areaEach: space.areaEach,
    zone: space.zone,
    priority: space.priority
  };
}

/** Circulation spaces, by the Programme's own zoning — never by name-guessing. */
function circulationSpaceIds(programme: SpaceProgramme): readonly string[] {
  return programme.spaces
    .filter((space) => space.zone === FUNCTIONAL_ZONES.Circulation)
    .map((space) => space.id);
}

/**
 * The planning graph.
 *
 * One node per space, one synthetic circulation node per storey, and four kinds
 * of edge:
 *
 * - every space is `connected` to the circulation of each storey it occupies —
 *   which is what "you can get to it" means without coordinates;
 * - a satisfied intent becomes `adjacent`, an `avoid` becomes `separated`;
 * - consecutive storeys are joined by `vertical-connection`, but **only** when a
 *   space actually occupies both. A vertical edge with no staircase behind it
 *   would be a graph asserting something the building does not contain.
 *
 * Nodes are emitted in the stated total order, then circulation nodes by storey,
 * so the graph is byte-identical across runs.
 */
function buildGraph(
  spaces: readonly LayoutSpace[],
  adjacencies: readonly ResolvedAdjacency[],
  storeys: number
): PlanningGraph {
  const nodes: LayoutNode[] = [
    ...spaces.map((space) => ({
      id: space.id,
      kind: LAYOUT_NODE_KINDS.Space,
      storeys: space.storeys
    })),
    ...Array.from({ length: storeys }, (_, storey) => ({
      id: circulationNodeId(storey),
      kind: LAYOUT_NODE_KINDS.Circulation,
      storeys: [storey]
    }))
  ];

  const edges: LayoutEdge[] = [];

  for (const space of spaces) {
    for (const storey of space.storeys) {
      edges.push({
        fromNodeId: space.id,
        toNodeId: circulationNodeId(storey),
        kind: LAYOUT_EDGE_KINDS.Connected
      });
    }
  }

  for (const adjacency of adjacencies) {
    if (adjacency.relation === LAYOUT_EDGE_KINDS.Separated) {
      edges.push({
        fromNodeId: adjacency.fromSpaceId,
        toNodeId: adjacency.toSpaceId,
        kind: LAYOUT_EDGE_KINDS.Separated
      });
      continue;
    }
    if (adjacency.satisfied) {
      edges.push({
        fromNodeId: adjacency.fromSpaceId,
        toNodeId: adjacency.toSpaceId,
        kind: LAYOUT_EDGE_KINDS.Adjacent
      });
    }
  }

  for (let storey = 1; storey < storeys; storey += 1) {
    const connects = spaces.some(
      (space) => space.storeys.includes(storey - 1) && space.storeys.includes(storey)
    );
    if (connects) {
      edges.push({
        fromNodeId: circulationNodeId(storey - 1),
        toNodeId: circulationNodeId(storey),
        kind: LAYOUT_EDGE_KINDS.VerticalConnection
      });
    }
  }

  return { nodes, edges };
}

function buildCirculation(
  programme: SpaceProgramme,
  spaces: readonly LayoutSpace[],
  unservedStoreys: readonly number[]
): CirculationStrategy {
  const circulationIds = new Set(circulationSpaceIds(programme));
  const vertical = spaces
    .filter((space) => circulationIds.has(space.id) && space.storeys.length > 1)
    .map((space) => space.id);

  const perStorey = Array.from({ length: programme.storeys }, (_, storey) => ({
    storey,
    circulationSpaceIds: spaces
      .filter((space) => circulationIds.has(space.id) && space.storeys.includes(storey))
      .map((space) => space.id)
  }));

  const named = (ids: readonly string[]): string =>
    ids.map((id) => spaces.find((space) => space.id === id)?.name ?? id).join(', ');

  const description =
    programme.storeys === 1
      ? `Every space opens off the ${named(perStorey[0]?.circulationSpaceIds ?? []) || 'entrance'}.`
      : vertical.length > 0
        ? `${capitalize(named(vertical))} connects all ${programme.storeys} storeys; each floor is served from it.`
        : `No space connects the storeys, so the floors are only planned separately.`;

  return { verticalSpaceIds: vertical, perStorey, unservedStoreys, description };
}

/**
 * Builds the Layout Plan for one approved Space Programme.
 *
 * Returns a message rather than throwing when the programme cannot support one
 * — a programme with no spaces is a sentence the user can act on, and it comes
 * back through the same conversational path a `PlanBlocker` does.
 */
export function synthesizeLayout(options: SynthesizeLayoutOptions): LayoutSynthesisResult {
  const { programme } = options;

  if (programme.spaces.length === 0) {
    return {
      ok: false,
      message: 'That programme contains no spaces, so there is nothing to arrange.'
    };
  }

  const skillSpaces = programme.spaces.map(toSkillInput);

  const assigned = assignStoreys.execute(
    { spaces: skillSpaces, storeys: programme.storeys },
    SKILL_CONTEXT
  );
  if (!assigned.ok) {
    return { ok: false, message: assigned.failure.message };
  }

  const storeysOf = new Map<string, readonly number[]>(
    assigned.value.assignments.map((assignment: StoreyAssignment) => [
      assignment.spaceId,
      assignment.storeys
    ])
  );

  // The artefact's space list is in the stated total order, so it matches the
  // graph's node order and neither depends on the Programme's ordering.
  const spaces: readonly LayoutSpace[] = [...programme.spaces]
    .sort((a, b) => compareLayoutSpaces(toSkillInput(a), toSkillInput(b)))
    .map((space) => ({
      id: space.id,
      name: space.name,
      count: space.count,
      areaEach: space.areaEach,
      priority: space.priority,
      zone: space.zone,
      storeys: storeysOf.get(space.id) ?? [0]
    }));

  const resolved = resolveAdjacencies.execute(
    {
      intents: programme.adjacencies.map((adjacency) => ({
        fromSpaceId: adjacency.fromSpaceId,
        toSpaceId: adjacency.toSpaceId,
        strength: adjacency.strength,
        reason: adjacency.reason
      })),
      assignments: assigned.value.assignments
    },
    SKILL_CONTEXT
  );
  if (!resolved.ok) {
    return { ok: false, message: resolved.failure.message };
  }

  const adjacencies: readonly ResolvedAdjacency[] = resolved.value.resolved.map((relation) => ({
    fromSpaceId: relation.fromSpaceId,
    toSpaceId: relation.toSpaceId,
    relation: relation.relation,
    satisfied: relation.satisfied,
    strength: relation.strength,
    reason: relation.reason
  }));

  const circulationScore = scoreCirculation.execute(
    {
      assignments: assigned.value.assignments,
      circulationSpaceIds: circulationSpaceIds(programme),
      storeys: programme.storeys
    },
    SKILL_CONTEXT
  );
  if (!circulationScore.ok) {
    return { ok: false, message: circulationScore.failure.message };
  }

  const graph = buildGraph(spaces, adjacencies, programme.storeys);
  const circulation = buildCirculation(programme, spaces, circulationScore.value.unservedStoreys);

  const assumptions = [...assigned.value.notes];
  if (programme.storeys === 1) {
    assumptions.push('The building is on one storey, so every space is on the ground floor.');
  }

  const warnings: string[] = [];

  // An unsatisfied *required* adjacency is the one thing a reviewer most needs
  // told: the arrangement contradicts something they approved.
  const brokenRequirements = adjacencies.filter(
    (adjacency) => adjacency.strength === 'required' && !adjacency.satisfied
  );
  for (const broken of brokenRequirements) {
    const from =
      spaces.find((space) => space.id === broken.fromSpaceId)?.name ?? broken.fromSpaceId;
    const to = spaces.find((space) => space.id === broken.toSpaceId)?.name ?? broken.toSpaceId;
    warnings.push(
      `${capitalize(from)} and ${to} are on different storeys, so they cannot be adjacent — ${broken.reason}.`
    );
  }

  for (const storey of circulationScore.value.unservedStoreys) {
    warnings.push(
      `The ${storeyName(storey)} has no hallway or landing, so its rooms open into each other.`
    );
  }

  return {
    ok: true,
    plan: createLayoutPlan({
      sourceProgramme: { programmeId: programme.id, programmeRevision: programme.revision },
      storeys: programme.storeys,
      spaces,
      graph,
      adjacencies,
      circulation,
      assumptions,
      warnings,
      ...(options.now === undefined ? {} : { now: options.now })
    })
  };
}

/**
 * The Layout skills take no unit-bearing input and produce no dimensions, so
 * the default context is the whole of what they need: this is a placement
 * problem, not a measurement one. Built once — it is frozen and stateless.
 */
const SKILL_CONTEXT = createSkillContext();

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
