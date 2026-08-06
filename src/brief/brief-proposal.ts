/**
 * A Brief, offered for approval (Sprint 27.8 — ADR-0027.1 Rule 7).
 *
 * The bridge between this layer's artefact and the AI Workspace's currency,
 * and the exact twin of `proposal/proposal-builder.ts`: that one turns an
 * {@link ArchitecturalPlan} into a Proposal carrying Automation Requests, this
 * one turns an {@link ArchitecturalBrief} into a Proposal carrying an artefact.
 * Both end up in the same `ConversationMessage.proposal`, are approved through
 * the same `AiSessionController.approveProposal`, and are rendered by the same
 * card — which is the whole return on generalising `Proposal` rather than
 * building a second approval surface for planning artefacts.
 *
 * An incomplete Brief is never offered. `assertComplete` is not defensive
 * programming: a Brief with open questions that reached the approval gate would
 * let a user approve an artefact the platform was still asking them about, and
 * the resulting revision would be durable (Rule 5).
 */

import { createArtefactProposal, type Proposal } from '@archisimple/ai-engine';
import {
  ARCHITECTURAL_BRIEF_KIND,
  isBriefComplete,
  summarizeBrief,
  type ArchitecturalBrief
} from './architectural-brief';

/** What a user should expect approving a Brief to do — and, just as much, what it will not do. */
const EXPECTED_OUTCOME =
  'The brief is recorded with the project. Nothing is drawn yet: the next step turns it into a space programme.';

export function toBriefProposal(brief: ArchitecturalBrief): Proposal {
  if (!isBriefComplete(brief)) {
    throw new Error('An incomplete architectural brief cannot be proposed for approval.');
  }

  return createArtefactProposal({
    artefact: {
      kind: ARCHITECTURAL_BRIEF_KIND,
      id: brief.id,
      revision: brief.revision,
      value: brief
    },
    title:
      brief.revision === 1
        ? 'Architectural brief'
        : `Architectural brief (revision ${brief.revision})`,
    explanation: summarizeBrief(brief),
    reasoning:
      'Before any geometry exists, this records what the building is for, so the design can be reviewed as intent rather than as walls.',
    assumptions: brief.assumptions,
    expectedOutcome: EXPECTED_OUTCOME
  });
}

/**
 * The conversation message that accompanies a Brief proposal.
 *
 * Short on purpose. The card immediately below it already shows the objectives,
 * the spaces, the requirements and the assumptions; a message repeating them is
 * a second copy for the user to reconcile.
 */
export function describeBrief(brief: ArchitecturalBrief): string {
  const spaces = brief.desiredSpaces.reduce((total, space) => total + space.count, 0);
  const counted =
    spaces === 0 ? 'no spaces named yet' : `${spaces} space${spaces === 1 ? '' : 's'}`;

  return [
    `I have written an architectural brief from that — ${counted}, ${brief.requirements.length} requirement${brief.requirements.length === 1 ? '' : 's'}.`,
    '',
    'Review it below. Approving records it with the project; nothing is drawn until you do.'
  ].join('\n');
}
