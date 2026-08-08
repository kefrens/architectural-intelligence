/**
 * Layout quality (Sprint 28.0, Story 28.0.4).
 *
 * Four numbers explaining how well an arrangement serves the programme it came
 * from. Computed **from the planning graph and the resolved adjacencies**,
 * never from the solver's internal representation — which is what lets Epic 1
 * hide that representation without making Epic 4 impossible.
 *
 * ## Recomputed, never stored
 *
 * {@link LayoutQuality} is not a field on {@link LayoutPlan}, and the omission
 * is the design. A score written into the artefact is correct exactly until a
 * stage provider enriches the plan (Rule 10 lets several do so), and a stale
 * score is worse than no score: it is a number a reviewer will trust. So it is
 * derived on demand, from the artefact as it stands at that moment.
 *
 * ## Informational, never blocking
 *
 * Nothing here refuses anything. A low score is a conversation — "these two
 * ended up on different floors, is that all right?" — and a platform that
 * refused to show a user their own building because an algorithm scored it
 * poorly would be overruling the brief it exists to serve. The proposal carries
 * these alongside the assumptions and warnings a reviewer already reads.
 */

import { createSkillContext, scoreCirculation, scoreLayout } from '@archisimple/skills';
import { FUNCTIONAL_ZONES, SPACE_PRIORITIES } from '../programme/space-programme.js';
import type { LayoutPlan } from './layout-plan.js';

const SKILL_CONTEXT = createSkillContext();

export interface LayoutQuality {
  /** 0–1. The share of the programme's `required` spaces the layout still contains. */
  readonly programmeSatisfaction: number;
  /** 0–1 among `required` intents. `1` when the programme stated none. */
  readonly requiredAdjacencySatisfaction: number;
  /** 0–1 among `preferred` intents. `1` when the programme stated none. */
  readonly desiredAdjacencySatisfaction: number;
  /** 0–1. The share of storeys that circulation actually reaches. */
  readonly circulationQuality: number;
}

/**
 * The quality of a layout as it currently stands.
 *
 * The `required` denominator comes from the plan's own space list, which is the
 * honest reading *for a plan*: this asks "does the arrangement still hold
 * everything the brief insisted on", and a space the solver dropped would be
 * missing from both sides. Comparing against the Programme itself is the
 * stronger check, and it belongs to divergence detection (Rule 12), which no
 * sprint has built yet.
 */
export function computeLayoutQuality(plan: LayoutPlan): LayoutQuality {
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

  const scored = scoreLayout.execute(
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
        satisfied: adjacency.satisfied,
        strength: adjacency.strength,
        reason: adjacency.reason
      })),
      circulationScore: circulation.ok ? circulation.value.score : 0
    },
    SKILL_CONTEXT
  );

  // A skill failure here would mean the artefact is malformed, not that the
  // building is bad. Reporting zeros says "nothing measured" without inventing
  // a score, and the artefact is still reviewable.
  return scored.ok
    ? scored.value
    : {
        programmeSatisfaction: 0,
        requiredAdjacencySatisfaction: 0,
        desiredAdjacencySatisfaction: 0,
        circulationQuality: 0
      };
}

/** Quality as markdown, for the review card. Percentages, because these are shares. */
export function describeLayoutQuality(quality: LayoutQuality): string {
  const percent = (value: number): string => `${Math.round(value * 100)}%`;

  return [
    `- Programme satisfied: ${percent(quality.programmeSatisfaction)}`,
    `- Required adjacencies met: ${percent(quality.requiredAdjacencySatisfaction)}`,
    `- Preferred adjacencies met: ${percent(quality.desiredAdjacencySatisfaction)}`,
    `- Circulation reaches: ${percent(quality.circulationQuality)} of storeys`
  ].join('\n');
}
