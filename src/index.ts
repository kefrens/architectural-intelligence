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
} from './architectural-intelligence-service.js';

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
} from './intent/index.js';

export {
  answerArchitecturalQuestion,
  BuildingKnowledge,
  EMPTY_RESOLVED_TARGET,
  type ArchitecturalAnswer,
  type BuildingKnowledgeOptions,
  type EditableProperty,
  type ResolvedTarget
} from './understanding/index.js';

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
  PLANNING_STAGES,
  type ArchitecturalPlan,
  type PlanBlocker,
  type PlanBlockerReason,
  type PlanningStage,
  type PlanningStageCapability,
  type PlanningStageProvider,
  type PlanResult,
  type PlanStep
} from './planning/index.js';

export {
  ADJACENCY_STRENGTHS,
  AREA_SOURCES,
  createProgramme,
  describeProgramme,
  FUNCTIONAL_ZONES,
  isProgrammeComplete,
  matchesBrief,
  programmeSpace,
  reviseProgramme,
  SPACE_PRIORITIES,
  SPACE_PROGRAMME_KIND,
  summarizeProgramme,
  synthesizeProgramme,
  toProgrammeProposal,
  type AdjacencyStrength,
  type AreaSource,
  type BriefProvenance,
  type FunctionalZone,
  type IntendedAdjacency,
  type ProgrammeSpace,
  type ProgrammeSynthesisResult,
  type SpacePriority,
  type SpaceProgramme,
  type SynthesizeProgrammeOptions
} from './programme/index.js';

export {
  createGeometryGraph,
  describeEvaluation,
  describeGeometry,
  evaluateGeometryGraph,
  expectedInstances,
  gateGeometryGraph,
  GEOMETRY_GRAPH_KIND,
  isGeometryGraphComplete,
  matchesLayout,
  reviseGeometryGraph,
  storeyArea,
  summarizeGeometryGraph,
  synthesizeGeometry,
  toGeometryGraphProposal,
  type GeometryAdjacency,
  type GeometryGraph,
  type GeometrySynthesisResult,
  type LayoutProvenance,
  type OpeningCandidate,
  type RoomPolygon,
  type SynthesizeGeometryOptions,
  type WallCandidate
} from './geometry/index.js';

/**
 * The Geometry Specification (Sprint 1.1 — ADR-AI-0001).
 *
 * The final design artefact, and the only one that crosses to a consuming CAD
 * application. `validateGeometrySpecification` is exported beside it because a
 * consumer's rejection is a defect *here* rather than a question for the user
 * (ADR-0031 Rule 4).
 */
export {
  createGeometrySpecification,
  DEFAULT_CONSTRUCTION,
  describeDefaults,
  describeSpecification,
  gateGeometrySpecification,
  GEOMETRY_CONTRACT_VERSION,
  GEOMETRY_SPECIFICATION_KIND,
  isContractCompatible,
  isGeometrySpecificationComplete,
  matchesGeometryGraph,
  METRIC_CONVENTIONS,
  OPENING_KINDS,
  reviseGeometrySpecification,
  SPECIFICATION_INVARIANTS,
  specificationJunctions,
  storeyFloorArea,
  summarizeGeometrySpecification,
  synthesizeSpecification,
  thicknessFor,
  toGeometrySpecificationProposal,
  validateGeometrySpecification,
  violationsOf,
  WALL_ROLES,
  wallHeight,
  type ConstructionDefaults,
  type GeometryConstraintRecord,
  type GeometryProvenance,
  type GeometrySpecification,
  type MetricConventions,
  type OpeningDefaults,
  type OpeningKind,
  type SpecificationInvariantId,
  type SpecificationSynthesisResult,
  type SpecificationViolation,
  type SpecifiedOpening,
  type SpecifiedSpace,
  type SpecifiedStorey,
  type SpecifiedWall,
  type SynthesizeSpecificationOptions,
  type WallRole
} from './geometry/index.js';

export {
  circulationNodeId,
  computeLayoutQuality,
  createLayoutPlan,
  describeLayout,
  describeLayoutQuality,
  isLayoutPlanComplete,
  LAYOUT_EDGE_KINDS,
  LAYOUT_NODE_KINDS,
  LAYOUT_PLAN_KIND,
  matchesProgramme,
  reviseLayoutPlan,
  storeyName,
  summarizeLayoutPlan,
  synthesizeLayout,
  toLayoutProposal,
  type CirculationStrategy,
  type LayoutEdge,
  type LayoutEdgeKind,
  type LayoutNode,
  type LayoutNodeKind,
  type LayoutPlan,
  type LayoutQuality,
  type LayoutSpace,
  type LayoutSynthesisResult,
  type PlanningGraph,
  type ProgrammeProvenance,
  type ResolvedAdjacency,
  type SynthesizeLayoutOptions
} from './layout/index.js';

export {
  createInMemoryPlanningArtefactReader,
  type ApprovedArtefact,
  type PlanningArtefactReader
} from './artefacts/planning-artefact-reader.js';

export {
  contributorsOf,
  wasEnriched,
  type EnrichedArtefact
} from './artefacts/enriched-artefact.js';

export { BULK_STEP_THRESHOLD, toProposal } from './proposal/proposal-builder.js';

export {
  answerClarification,
  ARCHITECTURAL_BRIEF_KIND,
  assembleBrief,
  assembleBriefFromFields,
  BRIEF_REQUIREMENT_SOURCES,
  BRIEF_TOPICS,
  briefRequirement,
  clarificationBlocker,
  clarificationFor,
  clarificationQuestion,
  classifyRequest,
  createBrief,
  createInMemoryBriefDraftStore,
  createSessionBriefDraftStore,
  describeBrief,
  describeClarification,
  desiredSpacesFrom,
  isBriefComplete,
  MANDATORY_BRIEF_TOPICS,
  readBriefTopics,
  REQUEST_LANES,
  reviseBrief,
  startBriefDraft,
  summarizeBrief,
  toBriefProposal,
  withRequirement,
  type ArchitecturalBrief,
  type AssembleBriefOptions,
  type BoundBriefDraftStore,
  type BriefDraftStore,
  type BriefRequirement,
  type BriefRequirementSource,
  type BriefTopic,
  type ClarificationDialogue,
  type ClarificationQuestion,
  type ClassifyRequestOptions,
  type DesiredSpace,
  type RequestClassification,
  type RequestLane
} from './brief/index.js';

export {
  ARCHITECTURAL_CONTEXT_PROVIDER_ID,
  createArchitecturalContextProvider,
  type ArchitecturalContextFragment
} from './context/architectural-context-provider.js';

export {
  ARCHITECTURAL_PROVIDER_ID,
  createArchitecturalProviderAdapter,
  type CreateArchitecturalProviderAdapterOptions
} from './provider/architectural-provider-adapter.js';

/**
 * The composition seam (Sprint 29.1, ADR-0029 Rule 2). One entry point through
 * which a host receives this capability instead of constructing it by name.
 */
export {
  contributionForIntelligence,
  createArchitecturalIntelligenceContribution,
  ARCHITECTURAL_INTELLIGENCE_CONTRIBUTION_ID,
  type ArchitecturalIntelligenceContribution,
  type ArchitecturalIntelligenceContributionOptions,
  type ArchitecturalIntelligenceServicesOptions
} from './contribution.js';

/** The planning tools, for a host composing them without the contribution. */
export {
  captureBriefToolDefinition,
  createArchitecturalToolDefinitions,
  createGeometryToolDefinition,
  createLayoutToolDefinition,
  createProgrammeToolDefinition,
  createSpecificationToolDefinition
} from './tools/index.js';
