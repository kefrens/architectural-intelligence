/**
 * architectural-intelligence (Sprint 24.5, ADR-0023 + ADR-0024).
 *
 * The Architectural Intelligence layer: the capability that lets a user talk to
 * their project in architectural language and get back either an answer drawn
 * from the Building Platform or a reviewable Automation proposal.
 *
 * ```text
 * apps/web (AI Workspace panel)
 *     v
 * ai-engine                   conversations, proposals, approval
 *     v
 * architectural-intelligence  <- you are here: intent, knowledge, plans, proposals
 *     v
 * building-model / spatial / inspector      the Building Platform
 *     v
 * @archisimple/automation-api               the only way anything is written
 * ```
 *
 * ## What this package owns
 *
 * Reasoning, and only reasoning. It owns no project state, holds no document
 * reference, and has no `CommandDispatcher` anywhere in it — a fact its own
 * architecture-compliance test asserts against the sources rather than trusting
 * the layering. It reads the Building Platform through the services that
 * already derive it, and it emits `CommandRequest`s that somebody *else*
 * executes, after a user has approved them.
 *
 * That is the whole of the sprint's architectural constraint: no new runtime,
 * no second semantic model, no second execution pipeline, and Automation
 * remains the single way anything changes.
 *
 * ## What extends it
 *
 * {@link ArchitecturalOperationProvider} — one provider, one or more
 * architectural actions, registered on the {@link ArchitecturalPlanner} by id.
 * The built-in operations register through exactly that seam, so a plugin's
 * operation is a peer of theirs rather than a special case.
 */

export {
  ArchitecturalIntelligenceService,
  type ArchitecturalIntelligenceServiceOptions,
  type ArchitecturalResponse
} from './architectural-intelligence-service';

export {
  ARCHITECTURAL_ACTIONS,
  ARCHITECTURAL_INTENT_KINDS,
  createIntent,
  INTENT_TARGET_KINDS,
  isModification,
  NO_INTENT_TARGET,
  recognizeIntent,
  type ArchitecturalAction,
  type ArchitecturalIntent,
  type ArchitecturalIntentKind,
  type IntentTarget,
  type IntentTargetKind
} from './intent';

export {
  answerArchitecturalQuestion,
  BuildingKnowledge,
  EMPTY_RESOLVED_TARGET,
  type ArchitecturalAnswer,
  type BuildingKnowledgeOptions,
  type EditableProperty,
  type ResolvedTarget
} from './understanding';

export {
  ALIGN_WALLS_OPERATION_ID,
  ArchitecturalPlanner,
  blocked,
  createAlignWallsOperationProvider,
  createBuiltInOperationProviders,
  createDeleteOperationProvider,
  createMoveRoomOperationProvider,
  createRenameRoomOperationProvider,
  createUnsupportedOperationProvider,
  createWallPropertyOperationProvider,
  DELETE_OPERATION_ID,
  MOVE_ROOM_OPERATION_ID,
  PLAN_BLOCKER_REASONS,
  planned,
  RENAME_ROOM_OPERATION_ID,
  UNSUPPORTED_OPERATIONS_ID,
  WALL_PROPERTY_OPERATION_ID,
  type ArchitecturalCapability,
  type ArchitecturalOperationProvider,
  type ArchitecturalPlan,
  type PlanBlocker,
  type PlanBlockerReason,
  type PlanResult,
  type PlanStep
} from './planning';

export { BULK_STEP_THRESHOLD, toProposal } from './proposal/proposal-builder';

export {
  ARCHITECTURAL_CONTEXT_PROVIDER_ID,
  createArchitecturalContextProvider,
  type ArchitecturalContextFragment
} from './context/architectural-context-provider';

export {
  ARCHITECTURAL_PROVIDER_ID,
  createArchitecturalProviderAdapter,
  type CreateArchitecturalProviderAdapterOptions
} from './provider/architectural-provider-adapter';
