/**
 * What a Layout Plan contains (Sprint 1.8; was `layout-quality.ts`, Sprint 28.0).
 *
 * Facts and counts. **No score, no share, no percentage, and no verdict computed
 * here** — which is a smaller job than this file used to claim, and the reason
 * it was renamed.
 *
 * ## What it was, and why that ended
 *
 * It returned four numbers between 0 and 1 called `LayoutQuality`, and
 * `describeLayoutQuality` rendered them as percentages on the review card:
 *
 * ```text
 * - Programme satisfied: 100%
 * - Required adjacencies met: 100%
 * - Preferred adjacencies met: 100%
 * - Circulation reaches: 100% of storeys
 * ```
 *
 * BUG-011 is a user reading those four lines over a plan containing a bedroom
 * with no doorway to the hallway. Every one of them was true of what it measured
 * and false as English: the first two counted a `satisfied` boolean that meant
 * "these spaces share a storey", and scored an empty denominator as 1; the last
 * measured whether a storey *had* a hallway, never whether a room could reach
 * one. ArchiSimple ADR-0034 §4.1 supersedes all of it by decision.
 *
 * ## The name
 *
 * Not `LayoutQuality`, and deliberately not `LayoutFit` either: "fit" is still a
 * judgement word, and the point of the rename is that no judgement is made here.
 * `satisfied`, `score`, `quality`, `fit`, `health`, `compliance` and
 * `confidence` are the same defect under different labels, and Sprint 1.8's
 * standing prohibition covers all of them.
 *
 * ## Recomputed, never stored
 *
 * {@link LayoutSummary} is not a field on `LayoutPlan`, and the omission is the
 * design. Anything written into the artefact is correct exactly until a stage
 * provider enriches the plan, and a stale number is worse than none: it is a
 * number a reviewer will trust.
 */

import {
  createSkillContext,
  evaluateConstraints,
  scoreCirculation,
  scoreLayout,
  summariseConstraintResults,
  EVALUATION_STAGES,
  type ConstraintEvaluationSummary,
  type ConstraintResult,
  type LayoutAdjacencyTally,
  type ProgrammeCoverage
} from '@archisimple/skills';
import { FUNCTIONAL_ZONES, SPACE_PRIORITIES } from '../programme/space-programme.js';
import { storeyPreconditionOf, type LayoutPlan } from './layout-plan.js';
import {
  circulationReachabilityConstraints,
  relationshipConstraints
} from '../constraints/index.js';

const SKILL_CONTEXT = createSkillContext();

export interface CirculationCoverage {
  /** The denominator. */
  readonly storeys: number;
  readonly withCirculation: number;
  /** Storeys with no hallway, landing or stair at all, ascending. */
  readonly unservedStoreys: readonly number[];
}

export interface LayoutSummary {
  /** How many of the programme's `required` spaces the layout still contains. */
  readonly programme: ProgrammeCoverage;
  /** Stated, ruled out, and undecided — with the denominator visible (ADR-0034 §5). */
  readonly requiredAdjacencies: LayoutAdjacencyTally;
  readonly preferredAdjacencies: LayoutAdjacencyTally;
  /**
   * How many storeys **have** a circulation space on them.
   *
   * Presence, never reachability: a one-storey plan with a hallway serves its
   * one storey whether or not a single room opens onto that hallway. This is the
   * number BUG-011 rendered as "Circulation reaches: 100% of storeys", which a
   * reader took to mean every room could reach it.
   *
   * Counts rather than the platform's 0–1 coverage, for the same reason nothing
   * else here is a share: a percentage hides its denominator, and this sprint's
   * standing prohibition covers the last one as much as the first four.
   */
  readonly circulation: CirculationCoverage;
  /**
   * The authority's answer at this stage — every entry `NOT_APPLICABLE`.
   *
   * Included rather than omitted, and that is the point: "we cannot tell yet"
   * comes from `constraints.evaluate` itself, not from a sentence this file
   * decided to print. When the same constraints are evaluated against a Geometry
   * Specification they return real verdicts, through the same function.
   */
  readonly constraints: ConstraintEvaluationSummary;
  /** Every result, in case a caller wants to name them individually. */
  readonly constraintResults: readonly ConstraintResult[];
}

/**
 * What the layout, as it currently stands, measurably contains.
 *
 * The `required` denominator comes from the plan's own space list, which is the
 * honest reading *for a plan*: this asks "does the arrangement still hold
 * everything the brief insisted on", and a space the solver dropped would be
 * missing from both sides. Comparing against the Programme itself is the
 * stronger check, and it belongs to divergence detection (Rule 12), which no
 * sprint has built yet.
 */
export function computeLayoutSummary(plan: LayoutPlan): LayoutSummary {
  const required = plan.spaces.filter((space) => space.priority === SPACE_PRIORITIES.Required);

  const circulation = scoreCirculation.execute(
    {
      assignments: plan.spaces.map((space) => ({ spaceId: space.id, storeys: space.storeys })),
      circulationSpaceIds: plan.spaces
        .filter((space) => space.zone === FUNCTIONAL_ZONES.Circulation)
        .map((space) => space.id),
      storeys: plan.storeys
    },
    SKILL_CONTEXT
  );

  const unservedStoreys = circulation.ok ? circulation.value.unservedStoreys : [];
  const storeyCoverage = circulation.ok ? circulation.value.storeyCoverage : 0;

  const counted = scoreLayout.execute(
    {
      spaces: plan.spaces.map((space) => ({
        id: space.id,
        name: space.name,
        count: space.count,
        areaEach: space.areaEach,
        zone: space.zone,
        priority: space.priority
      })),
      programmeRequiredSpaceIds: required.map((space) => space.id),
      resolved: plan.adjacencies.map((adjacency) => ({
        fromSpaceId: adjacency.fromSpaceId,
        toSpaceId: adjacency.toSpaceId,
        relation: adjacency.relation as 'adjacent' | 'connected' | 'separated',
        storeyPrecondition: storeyPreconditionOf(adjacency),
        strength: adjacency.strength,
        reason: adjacency.reason
      })),
      circulationStoreyCoverage: storeyCoverage
    },
    SKILL_CONTEXT
  );

  // The Layout stage decides nothing, and says so through the authority rather
  // than through a hardcoded sentence. The facts are deliberately omitted: a
  // Layout Plan has no boundaries and no openings to state, and the evaluator
  // answers NOT_APPLICABLE from the stage before it looks at anything.
  const constraints = [
    ...relationshipConstraints(plan.adjacencies),
    ...circulationReachabilityConstraints(plan.spaces)
  ];
  const evaluated = evaluateConstraints.execute(
    {
      stage: EVALUATION_STAGES.Layout,
      constraints,
      facts: { spaceIds: plan.spaces.map((space) => space.id) }
    },
    SKILL_CONTEXT
  );

  const results = evaluated.ok ? evaluated.value.results : [];

  // A skill failure here means the artefact is malformed, not that the building
  // is bad. Reporting empty counts says "nothing measured" without inventing a
  // number, and the artefact is still reviewable.
  const empty = { stated: 0, impossible: 0, unknownSpace: 0, undecided: 0 };

  return {
    programme: counted.ok ? counted.value.programme : { required: 0, kept: 0, missing: [] },
    requiredAdjacencies: counted.ok ? counted.value.requiredAdjacencies : empty,
    preferredAdjacencies: counted.ok ? counted.value.preferredAdjacencies : empty,
    circulation: {
      storeys: plan.storeys,
      withCirculation: plan.storeys - unservedStoreys.length,
      unservedStoreys
    },
    constraints: evaluated.ok
      ? evaluated.value.summary
      : summariseConstraintResults(EVALUATION_STAGES.Layout, []),
    constraintResults: results
  };
}

/**
 * The summary as markdown, for the review card.
 *
 * Three properties this holds, and every one of them is a BUG-011 lesson:
 *
 * 1. **no sentence asserts a constraint is met** — nothing here can, because
 *    nothing at this stage established one;
 * 2. **every count shows its denominator** (ADR-0034 §5), so "3 stated" cannot
 *    be read as "3 achieved";
 * 3. **"not yet checked" is distinguishable** from "checked and passed" and from
 *    "nothing was asked". Those are three different things and used to render
 *    as the same 100%.
 */
export function describeLayoutSummary(summary: LayoutSummary): string {
  const lines = [
    '**What this layout contains**',
    `- Programme: ${summary.programme.kept} of ${summary.programme.required} required spaces`,
    `- ${statedLine('Required', summary.requiredAdjacencies)}`,
    `- ${statedLine('Preferred', summary.preferredAdjacencies)}`,
    `- Circulation: on ${summary.circulation.withCirculation} of ${summary.circulation.storeys} storeys`
  ];

  if (summary.programme.missing.length > 0) {
    lines.push(`- Missing: ${summary.programme.missing.join(', ')}`);
  }

  lines.push('', '**Not yet checked**');
  lines.push(
    summary.constraints.total.stated === 0
      ? 'No relationships were stated, so there is nothing to check.'
      : `A layout has no walls or doorways yet, so whether these ${summary.constraints.total.stated} relationships hold cannot be established here. They are checked when the design reaches geometry.`
  );

  return lines.join('\n');
}

/** "Required relationships stated: 3 — 1 ruled out by the storey assignment". */
function statedLine(label: string, tally: LayoutAdjacencyTally): string {
  const head = `${label} relationships stated: ${tally.stated}`;
  const ruledOut =
    tally.impossible === 0 ? '' : ` — ${tally.impossible} ruled out by the storey assignment`;
  return `${head}${ruledOut}`;
}
