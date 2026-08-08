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
 */

import type { ContextFragment, ContextProvider } from '@archisimple/ai-engine';
import type { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import { ARCHITECTURAL_ACTIONS } from '../intent/architectural-intent.js';
import type { BuildingKnowledge } from '../understanding/building-knowledge.js';

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

export interface ArchitecturalContextFragment extends ContextFragment {
  /** Action ids the planner can currently turn into a proposal. */
  readonly editOperations: readonly string[];
  /** Question ids answerable from the Building Platform without a proposal. */
  readonly answerableQuestions: readonly string[];
  /** The level new geometry belongs on; `null` for a project with no geometry yet. */
  readonly activeFloorId: string | null;
  readonly floorCount: number;
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
      floorCount: knowledge.floors().length
    })
  };
}
