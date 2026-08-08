/**
 * The Architectural Plan (Sprint 24.5, Story 24.5.6).
 *
 * "I want AI to reason before proposing changes." A plan is that reasoning,
 * made explicit and inspectable *before* it becomes a {@link Proposal}: the
 * Automation Requests it would run, why, on what assumptions, and to which
 * building elements.
 *
 * A plan is inert. Building one reads the Building Platform and writes nothing
 * — the sprint's own "No Runtime modification occurs during reasoning" — and
 * turning one into a Proposal (`proposal/proposal-builder.ts`) writes nothing
 * either. The first write happens when the user approves, through the same
 * `CommandDispatcher` a button click uses.
 *
 * ## Why a plan and a proposal are different types
 *
 * A {@link Proposal} belongs to `ai-engine` and is the AI Workspace's currency:
 * a conversation stores it, a panel renders it, approval executes it. A plan is
 * this layer's own working shape — it carries an {@link ArchitecturalIntent},
 * `PlanStep`s that still know which building element each one is for, and a
 * blocker vocabulary the Workspace has no use for. Collapsing them would put
 * architectural concepts inside `ai-engine`, which ADR-0023 Rule 1 keeps out.
 */

import type {
  PreviewGeometry,
  ProposalAffectedElement,
  ProposalRisk
} from '@archisimple/ai-engine';
import type { CommandRequest } from '@archisimple/automation-api';
import type { ArchitecturalIntent } from '../intent/architectural-intent.js';

/** One Automation Request the plan would run, with what it is for. */
export interface PlanStep {
  /** Plain language, shown in the proposal's operation list. */
  readonly description: string;
  readonly request: CommandRequest<unknown>;
  /** The building elements this step touches (Story 24.5.8). */
  readonly affects: readonly ProposalAffectedElement[];
  /** Geometry this step creates, for a canvas preview before approval (Sprint 23.4's mechanism, reused). */
  readonly previewGeometry?: readonly PreviewGeometry[];
  /** Existing entities to emphasise on the canvas while the decision is pending. */
  readonly highlightedEntityIds?: readonly string[];
}

export interface ArchitecturalPlan {
  readonly intent: ArchitecturalIntent;
  readonly title: string;
  /** Why this plan and not another (Story 24.5.10). */
  readonly reasoning: string;
  /** What had to be assumed because the request did not say (Story 24.5.10). */
  readonly assumptions: readonly string[];
  /** What the user should expect to see afterwards (Story 24.5.8). */
  readonly expectedOutcome: string;
  readonly steps: readonly PlanStep[];
  readonly risk: ProposalRisk;
  /** Caveats that do not block the plan but that a user should read first. */
  readonly warnings: readonly string[];
}

/**
 * Why a request could not be planned (Story 24.5.11).
 *
 * The first three are the story's own list, and they are separate because they
 * call for three different things from the user: supply what is missing, choose
 * between readings, or do something else entirely.
 *
 * `NothingToDo` is a fourth, added because the alternative was worse. "Align
 * these two walls" when they are already aligned is not missing information,
 * not ambiguous and not unsupported — filing it under any of those would tell
 * the user something untrue about their own request.
 */
export const PLAN_BLOCKER_REASONS = {
  /** The request is understood but left out something needed — a distance, a new name. */
  MissingInformation: 'missing-information',
  /** The request is understood but points at nothing, or at more than one thing. */
  Ambiguous: 'ambiguous',
  /** The request is understood and the platform cannot do it. */
  Unsupported: 'unsupported',
  /** The request is understood, possible, and would change nothing. */
  NothingToDo: 'nothing-to-do'
} as const;

export type PlanBlockerReason = (typeof PLAN_BLOCKER_REASONS)[keyof typeof PLAN_BLOCKER_REASONS];

export interface PlanBlocker {
  readonly reason: PlanBlockerReason;
  /** One sentence, addressed to the user, saying what stopped this. */
  readonly message: string;
  /** What the user could do instead. Empty only when there genuinely is nothing to suggest. */
  readonly suggestions: readonly string[];
}

export type PlanResult =
  | { readonly ok: true; readonly plan: ArchitecturalPlan }
  | { readonly ok: false; readonly blocker: PlanBlocker };

export function planned(plan: ArchitecturalPlan): PlanResult {
  return { ok: true, plan };
}

export function blocked(
  reason: PlanBlockerReason,
  message: string,
  suggestions: readonly string[] = []
): PlanResult {
  return { ok: false, blocker: { reason, message, suggestions } };
}
