/**
 * The workflow-state projection (Sprint 1.2 — ADR-AI-0002).
 *
 * What the design pipeline currently looks like, as plain data, derived from
 * what the project has approved. It is the answer to two questions a consumer
 * cannot answer for itself without reimplementing this layer:
 *
 * ```text
 * where is this design?          currentStage, and five stage states
 * what can be asked for next?    eligible, actions, blockers
 * ```
 *
 * ## It is not an artefact
 *
 * No `kind`, no `createdAt`, no `contractVersion`, no `revision` of its own. It
 * is never approved, never persisted and never enters the project file — it is
 * recomputed from the artefact reader on every call, because a stored verdict
 * about which revision is current goes stale the instant a revision lands
 * (ADR-AI-0002 Rule 1, and the reason layout quality and packing evaluation are
 * absent from their artefacts too).
 *
 * ## What is deliberately absent
 *
 * **Anything about proposals.** No `proposalId`, no `pending`, no
 * `ready-for-approval`. `ProposalApprovalState` lives in `@archisimple/ai-engine`
 * and is session-scoped: this package builds a `Proposal`, hands it over, and
 * never learns its fate. What it learns is that an artefact became readable,
 * which is approval arriving by the only route that crosses the boundary
 * (Rule 2). A host renders "awaiting approval" by merging its own
 * `pendingProposal()` onto this — and it is the only participant that can be
 * right about it.
 *
 * ## Why the fields are orthogonal
 *
 * A single `status` string would have to choose between `approved` and `stale`
 * for an artefact that is both, and between `stale` and `blocked` for a stage
 * that is both. The consumer left to reconstruct the missing half is the UI,
 * which is where this codebase does not allow decisions to live (Rule 5).
 *
 * ## It crosses as plain data
 *
 * The host restates this shape structurally and imports nothing from this
 * package (ADR-0030 Rule 2, ADR-0031 Rule 1). So: string unions, numbers,
 * booleans, arrays and plain objects throughout. No classes, no methods, no
 * `Date`, no `Map`. Every identifier is a stable string the host maps to its own
 * labels — `apps/web` forbids hardcoded UI strings, and a label emitted from
 * here would arrive as one (Rule 9).
 */

import type { PlanBlocker } from '../planning/architectural-plan.js';
import type { PlanningStage } from '../planning/planning-stage.js';

/** One artefact, named the way the host's approval record names it. */
export interface ArtefactIdentity {
  readonly id: string;
  readonly revision: number;
}

/**
 * What this layer can be *asked to do* for a stage.
 *
 * `approve`, `reject`, `revise` and `navigate` are deliberately absent: every
 * one of them is the host's, and an action a consumer cannot route back to a
 * method on this service is a promise the contract cannot keep (Rule 3).
 */
export const WORKFLOW_ACTIONS = {
  /** No approved artefact, and the stage above is approved and current. */
  Generate: 'generate',
  /** An approved artefact exists; asking again produces the next revision. */
  Regenerate: 'regenerate'
} as const;

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[keyof typeof WORKFLOW_ACTIONS];

/** What the project holds for a stage. */
export const STAGE_ARTEFACT_STATES = {
  None: 'none',
  /**
   * An unfinished artefact exists in the conversation.
   *
   * Reachable for the **Brief only** — it is the one stage with a draft store,
   * because it is the one stage assembled from what a user says rather than
   * derived from the stage above. The field is on every stage because the shape
   * is uniform; four of the five can never carry this value.
   */
  Draft: 'draft',
  Approved: 'approved',
  /**
   * This stage will never hold an artefact, and that is a decision rather than
   * an omission (Sprint 046.4b — ADR-0044 revision 1.1 Rule 2).
   *
   * A design traced from a drawing enters the pipeline at the Geometry Graph,
   * so it has no Brief, no Space Programme and no Layout Plan — and it never
   * will. Until this value existed those stages read as {@link None}, which
   * means "not done **yet**", and a workflow reporting them that way nags
   * forever about artefacts that are not coming.
   *
   * ADR-0044 Rule 2 is explicit that the upstream artefacts are **absent, not
   * fabricated**: inventing objectives from a drawing to satisfy the pipeline's
   * shape would fabricate the one artefact whose whole value is that a human
   * stated it. So the pipeline records the absence honestly instead.
   *
   * A user may still write a Brief afterwards. Describing the building you
   * traced is a legitimate act, and doing it does not retroactively make that
   * Brief the Graph's source.
   */
  Skipped: 'skipped'
} as const;

export type StageArtefactState = (typeof STAGE_ARTEFACT_STATES)[keyof typeof STAGE_ARTEFACT_STATES];

/**
 * Why an approved artefact is no longer current.
 *
 * Staleness is transitive (Rule 6): an artefact is stale when its own provenance
 * diverges from the upstream artefact in force, **or** when the stage above it
 * is stale. Without the second clause, revising a Brief would mark the Programme
 * stale and leave the Layout claiming to be current — derived, correctly, from a
 * Programme nobody should build on.
 */
export interface StaleDerivation {
  /** The stage this one derives from. */
  readonly upstreamStage: PlanningStage;
  /** The upstream revision this artefact records having been derived from. */
  readonly derivedFrom: ArtefactIdentity;
  /** The upstream revision in force now. */
  readonly nowInForce: ArtefactIdentity;
  /**
   * `false` when this artefact's own provenance diverged; `true` when it still
   * matches and the staleness came from further up.
   *
   * When `true`, `derivedFrom` and `nowInForce` are equal — that *is* the fact
   * being reported, and it is why the flag exists rather than leaving a consumer
   * to conclude "the identities match, so why is this stale?".
   */
  readonly inherited: boolean;
}

/** Why a stage holds nothing and never will (Sprint 046.4b). */
export const SKIPPED_STAGE_REASONS = {
  /**
   * The design was extracted from a drawing, so the pipeline was entered at the
   * Geometry Graph (ADR-0044 Rule 1) and everything above it was never authored.
   */
  ExtractedFromDrawing: 'extracted-from-drawing'
} as const;

export type SkippedStageReason = (typeof SKIPPED_STAGE_REASONS)[keyof typeof SKIPPED_STAGE_REASONS];

export interface SkippedStage {
  readonly reason: SkippedStageReason;
}

export interface ArchitecturalStageState {
  readonly stage: PlanningStage;
  readonly artefact: StageArtefactState;
  /** The approved artefact's identity. Present exactly when `artefact` is `approved`. */
  readonly approved?: ArtefactIdentity;
  /**
   * Every revision the project holds for this stage, oldest first (Sprint 1.3).
   *
   * A superseded revision is a decision the user took, and ADR-0027.1 Rule 4
   * supersedes rather than deletes — so it is listed here rather than filtered
   * out, and never marked as being in error.
   *
   * `[approved]`, or `[]`, when the host supplies no `all()` on its reader: the
   * revision in force is still knowable, and the lineage behind it is not
   * (ADR-AI-0002 Rule 11).
   *
   * **More than one distinct `id` here is a broken lineage** — a defect, not a
   * workflow. It is reported through {@link blockers} as well, because a stage
   * holding two lineages cannot say which one the project meant.
   */
  readonly revisions: readonly ArtefactIdentity[];
  /** Present when the approved artefact is no longer current. */
  readonly stale?: StaleDerivation;
  /**
   * Why this stage will never be filled. Present exactly when `artefact` is
   * {@link STAGE_ARTEFACT_STATES}.Skipped.
   *
   * A **reason**, not a flag, because a stage skipped because the design came
   * from a drawing and one skipped for some later cause are different facts —
   * and this projection is read by a model, which will say something about it.
   */
  readonly skipped?: SkippedStage;
  /**
   * Why this stage cannot be generated now. Empty exactly when {@link eligible}.
   *
   * A stage's **own** staleness is never a blocker: regenerating it is the fix,
   * not the thing to prevent (Rule 7). Own staleness is reported by
   * {@link stale}; blockers describe the stage above.
   */
  readonly blockers: readonly PlanBlocker[];
  /**
   * Whether this stage can be generated now — the stage above holds an approved
   * artefact that is not itself stale.
   *
   * The same gate `classifyRequest` uses, derived once (Rule 8). Two derivations
   * would eventually disagree, and the disagreement would show up as a panel
   * offering a stage the conversation refuses.
   */
  readonly eligible: boolean;
  readonly actions: readonly WorkflowAction[];
}

export interface ArchitecturalWorkflowState {
  /** The five stages, in pipeline order. Always all five. */
  readonly stages: readonly ArchitecturalStageState[];
  /**
   * The stage that needs attention: the first stale one, or failing that the
   * first that can be generated and has not been. Absent when the design is
   * complete, and absent when nothing can be done at all.
   */
  readonly currentStage?: PlanningStage;
  /** Every stage approved, and none of them stale. */
  readonly complete: boolean;
}

/** The state of one stage, by name. `undefined` is impossible for the five real stages. */
export function stageState(
  state: ArchitecturalWorkflowState,
  stage: PlanningStage
): ArchitecturalStageState | undefined {
  return state.stages.find((candidate) => candidate.stage === stage);
}
