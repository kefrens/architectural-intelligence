/**
 * A Layout Plan, offered for approval (Sprint 28.0, Story 28.0.6 —
 * ADR-0027.1 Rule 7).
 *
 * The third twin of `brief/brief-proposal.ts`, and by now the pattern is the
 * point: a third planning artefact reached the approval gate with no second
 * approval surface, no second store, no second confirmation rule and no change
 * to `ai-engine`. All Sprint 28.0 added was a label.
 *
 * Quality is folded into the proposal here rather than into the artefact
 * (`layout-quality.ts` explains why), so a reviewer sees the score for the plan
 * *as it stands at the moment of review*.
 */

import { createArtefactProposal, type Proposal } from '@archisimple/ai-engine';
import { contributionNotes } from '../artefacts/enriched-artefact.js';
import {
  isLayoutPlanComplete,
  LAYOUT_PLAN_KIND,
  summarizeLayoutPlan,
  type LayoutPlan
} from './layout-plan.js';
import { computeLayoutQuality, describeLayoutQuality } from './layout-quality.js';

const EXPECTED_OUTCOME =
  'The layout is recorded with the project. Still nothing is drawn: the next step turns these spaces into walls.';

export function toLayoutProposal(plan: LayoutPlan): Proposal {
  if (!isLayoutPlanComplete(plan)) {
    throw new Error('An empty layout plan cannot be proposed for approval.');
  }

  const quality = computeLayoutQuality(plan);

  return createArtefactProposal({
    artefact: {
      kind: LAYOUT_PLAN_KIND,
      id: plan.id,
      revision: plan.revision,
      value: plan
    },
    title: plan.revision === 1 ? 'Layout plan' : `Layout plan (revision ${plan.revision})`,
    explanation: `${summarizeLayoutPlan(plan)}\n\n**How well it fits the programme**\n${describeLayoutQuality(quality)}`,
    reasoning:
      'This arranges the approved programme — which floor each space is on, what ends up next to what, and how you get around — while there is still nothing to redraw.',
    // Sprint 28.3: what an installed extension added is named beside
    // what the platform assumed, in the same list the user already reads.
    assumptions: [...plan.assumptions, ...contributionNotes(plan)],
    warnings: plan.warnings,
    expectedOutcome: EXPECTED_OUTCOME
  });
}

/**
 * The message that accompanies the proposal.
 *
 * The card below lists every space by storey and scores the fit, so the message
 * carries only what a user checks first: how many floors, and whether anything
 * they asked for could not be honoured.
 */
export function describeLayout(plan: LayoutPlan): string {
  const unsatisfied = plan.adjacencies.filter((adjacency) => !adjacency.satisfied).length;
  const floors = plan.storeys === 1 ? 'a single storey' : `${plan.storeys} storeys`;

  const caveat =
    unsatisfied === 0
      ? 'Everything the programme asked for is satisfied.'
      : `${unsatisfied} relationship${unsatisfied === 1 ? '' : 's'} could not be satisfied — they are listed below.`;

  return [
    `I have arranged the approved programme across ${floors}. ${caveat}`,
    '',
    'Review it below. Approving records it with the project; nothing is drawn until you do.'
  ].join('\n');
}
