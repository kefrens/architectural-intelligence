/**
 * The Architectural Context Provider (Sprint 24.5, Story 24.5.3).
 *
 * The sixth Context Provider, contributed through the same `ContextProvider`
 * seam Sprint 23.2 built and every other fragment already uses — no new
 * context mechanism, which is what "Existing Context Providers are reused"
 * requires.
 *
 * ## What it adds that the others do not
 *
 * `building`, `spatial` and `inspector` already tell a model what the project
 * *contains*. None of them tell it what the assistant can *do*. That gap is why
 * a model with a perfectly good picture of the plan still invents operations
 * that do not exist and then apologises for them.
 *
 * So this fragment reports the planner's registered capabilities and the
 * questions the Building Platform can answer today — read live from the
 * planner, not written out by hand, so a plugin that contributes an operation
 * provider appears here without touching this file. The active floor comes
 * along too: Story 24.5.3 asks for it explicitly and no other fragment carries
 * it.
 *
 * ## Where the design is (Sprint 1.4)
 *
 * Three fragments said what the project contains and this one said what the
 * assistant can do. **None said where the design had got to**, and Bug 001 is
 * what that costs: a user walked the whole pipeline and the assistant narrated
 * four stages it never performed, because nothing told it a Brief had just been
 * approved or that `planning_generateProgramme` had become the next move.
 *
 * `design` closes it. Every field is derived from `workflowState()` — the same
 * projection the classifier's stage gates read, so a panel, a conversation and a
 * model cannot disagree about which stage a project is on (ADR-AI-0002 Rule 8).
 *
 * ## What it reports, and what it never does
 *
 * It **reports state**. It does not instruct the model, and it carries nothing
 * about proposals or approval — this layer cannot observe those and a fragment
 * claiming otherwise would be inventing (Rule 2). Nothing here reads a single
 * word of model output (ADR-0027.1 Rule 6).
 *
 * Collected per turn and discarded with the fragment. There is no cache here
 * either, for the reason there is none anywhere else: a stored verdict about
 * which revision is current goes stale the instant a revision lands (Rule 1).
 */

import type { ContextFragment, ContextProvider } from '@archisimple/ai-engine';
import type { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import { ARCHITECTURAL_ACTIONS } from '../intent/architectural-intent.js';
import { planningToolFor } from '../tools/planning-tool-names.js';
import type { BuildingKnowledge } from '../understanding/building-knowledge.js';
import { stageState, type ArchitecturalWorkflowState } from '../workflow/index.js';

export const ARCHITECTURAL_CONTEXT_PROVIDER_ID = 'architecture';

/** The question actions the Building Platform answers directly today (Story 24.5.4). */
const ANSWERABLE_QUESTIONS: readonly string[] = [
  ARCHITECTURAL_ACTIONS.roomCount,
  ARCHITECTURAL_ACTIONS.loadBearingWalls,
  ARCHITECTURAL_ACTIONS.floorArea,
  ARCHITECTURAL_ACTIONS.roomAdjacency,
  ARCHITECTURAL_ACTIONS.describeSelection,
  ARCHITECTURAL_ACTIONS.projectOverview
];

/**
 * One stage, flattened for a model (Sprint 1.4, Story 1.4.2).
 *
 * `null` rather than an absent key throughout: this crosses to a model as
 * prompt text, and a present `null` is read more reliably than a missing field.
 */
export interface ArchitecturalDesignStage {
  readonly stage: string;
  /** `none`, `draft` or `approved`. */
  readonly artefact: string;
  /** The approved revision, or `null` when the project holds none. */
  readonly revision: number | null;
  /** Whether the approved artefact was derived from something since superseded. */
  readonly stale: boolean;
  /** Whether this stage can be generated now. */
  readonly eligible: boolean;
  /**
   * Why it cannot, in the platform's own words, or `null`.
   *
   * A `PlanBlocker` message — a sentence this platform already writes for the
   * user, not a UI label invented for the prompt (ADR-AI-0002 Rule 9).
   */
  readonly blockedBecause: string | null;
}

/** Where the design has got to (Sprint 1.4). */
export interface ArchitecturalDesignState {
  /** The stage needing attention, or `null` when the design is complete. */
  readonly currentStage: string | null;
  readonly complete: boolean;
  /** The five stages, in pipeline order. */
  readonly stages: readonly ArchitecturalDesignStage[];
  /**
   * The tool that moves {@link currentStage} forward, or `null`.
   *
   * The field that actually closes Bug 001: everything above describes a state
   * and leaves the model to infer an action, and this one names it. It promises
   * nothing about availability — the host's broker still decides which tools it
   * offers, and it always has.
   */
  readonly nextTool: string | null;
}

export interface ArchitecturalContextFragment extends ContextFragment {
  /** Action ids the planner can currently turn into a proposal. */
  readonly editOperations: readonly string[];
  /** Question ids answerable from the Building Platform without a proposal. */
  readonly answerableQuestions: readonly string[];
  /** The level new geometry belongs on; `null` for a project with no geometry yet. */
  readonly activeFloorId: string | null;
  readonly floorCount: number;
  /** Where the design is (Sprint 1.4). Derived per turn; nothing is stored. */
  readonly design: ArchitecturalDesignState;
}

export function createArchitecturalContextProvider(
  intelligence: ArchitecturalIntelligenceService,
  knowledge: BuildingKnowledge
): ContextProvider {
  return {
    id: ARCHITECTURAL_CONTEXT_PROVIDER_ID,
    collect: (): ArchitecturalContextFragment => ({
      editOperations: intelligence.capabilities().map((capability) => capability.action),
      answerableQuestions: ANSWERABLE_QUESTIONS,
      activeFloorId: knowledge.defaultLevelId() ?? null,
      floorCount: knowledge.floors().length,
      design: describeDesign(intelligence.workflowState())
    })
  };
}

/**
 * The projection, flattened.
 *
 * A mapping and nothing else — no rule of the pipeline is decided here, because
 * every one of them was decided in `deriveWorkflowState`. A second opinion about
 * eligibility or staleness in this file is exactly the divergence ADR-AI-0002
 * Rule 8 exists to prevent.
 */
export function describeDesign(workflow: ArchitecturalWorkflowState): ArchitecturalDesignState {
  const current = workflow.currentStage;
  const currentState = current === undefined ? undefined : stageState(workflow, current);

  return {
    currentStage: current ?? null,
    complete: workflow.complete,
    stages: workflow.stages.map((stage) => ({
      stage: stage.stage,
      artefact: stage.artefact,
      revision: stage.approved?.revision ?? null,
      stale: stage.stale !== undefined,
      eligible: stage.eligible,
      blockedBecause: stage.blockers[0]?.message ?? null
    })),
    // Only when the stage that needs attention can actually be acted on. A stale
    // stage is eligible — regenerating it is the fix — so this points at the
    // repair rather than at the stage that has gone wrong beneath it.
    nextTool:
      current !== undefined && currentState?.eligible === true ? planningToolFor(current) : null
  };
}
