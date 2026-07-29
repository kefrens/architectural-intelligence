/**
 * Plan → Proposal (Sprint 24.5, Stories 24.5.8, 24.5.9 and 24.5.12).
 *
 * The one place this layer hands its work to the AI Workspace. Everything a
 * plan already decided travels across unchanged — the Requests, the reasoning,
 * the assumptions, the affected elements, the expected outcome — because a
 * proposal a user reads should say exactly what the planner concluded, not a
 * summary of it.
 *
 * Two things this step adds, and only two:
 *
 * 1. **Flattening.** A plan's steps carry per-step preview geometry and
 *    highlights; a Proposal carries one list of each, because that is what a
 *    canvas draws. Nothing is dropped and nothing is recomputed.
 * 2. **The bulk rule.** A plan that touches more than {@link BULK_STEP_THRESHOLD}
 *    elements is escalated to `destructive` even if its own operation is
 *    individually harmless. Story 24.5.12 lists "bulk modifications" alongside
 *    delete, replace and merge, and it is right to: sixteen safe moves the user
 *    did not expect are not a safe change. The rule lives here rather than in
 *    each provider so every operation — including a plugin's — inherits it.
 *
 * Execution is not this file's business, nor this package's. A Proposal's
 * operations run through `AiSessionController.approveProposal`, which dispatches
 * each one through the same `CommandDispatcher` a button click uses (Sprint
 * 23.3). Nothing here holds a dispatcher, and the whole package's
 * architecture-compliance test asserts it.
 */

import {
  createProposal,
  PROPOSAL_RISKS,
  type PreviewGeometry,
  type Proposal,
  type ProposalAffectedElement,
  type ProposalOperation
} from '@archisimple/ai-engine';
import type { ArchitecturalPlan } from '../planning/architectural-plan';

/**
 * How many affected elements make a change "bulk".
 *
 * Five: a room's four walls plus one is the smallest set that stops being
 * something a user can hold in their head while reading the operation list.
 */
export const BULK_STEP_THRESHOLD = 5;

export function toProposal(plan: ArchitecturalPlan): Proposal {
  const operations: readonly ProposalOperation[] = plan.steps.map((step) => ({
    description: step.description,
    request: step.request
  }));

  const affectedElements: readonly ProposalAffectedElement[] = plan.steps.flatMap(
    (step) => step.affects
  );
  const previewGeometry: readonly PreviewGeometry[] = plan.steps.flatMap(
    (step) => step.previewGeometry ?? []
  );
  const highlightedEntityIds = [
    ...new Set(plan.steps.flatMap((step) => step.highlightedEntityIds ?? []))
  ];

  const bulk = affectedElements.length > BULK_STEP_THRESHOLD;
  const risk = bulk ? PROPOSAL_RISKS.Destructive : plan.risk;

  return createProposal({
    title: plan.title,
    // The prose the conversation shows. The structured fields below carry the
    // same content for a panel that renders sections rather than a paragraph;
    // neither is derived from the other, both come from the plan.
    explanation: plan.expectedOutcome,
    operations,
    reasoning: plan.reasoning,
    assumptions: plan.assumptions,
    affectedElements,
    expectedOutcome: plan.expectedOutcome,
    risk,
    warnings: bulk
      ? [
          ...plan.warnings,
          `This changes ${affectedElements.length} elements at once, so it needs an explicit confirmation.`
        ]
      : plan.warnings,
    previewGeometry,
    highlightedEntityIds
  });
}
