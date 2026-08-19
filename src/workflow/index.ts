/**
 * The workflow-state projection (Sprint 1.2 — ADR-AI-0002).
 *
 * One derivation over the artefact port, and the three consumers it serves: the
 * classifier's stage gates, a headless client, and — through the host — the IA
 * panel. Nothing here owns state, and nothing here advances anything.
 */

export {
  WORKFLOW_PIPELINE,
  WORKFLOW_STAGE_ORDER,
  type WorkflowStageDescriptor
} from './pipeline.js';

export { deriveWorkflowState, type DeriveWorkflowStateOptions } from './workflow-derivation.js';

export {
  stageState,
  SKIPPED_STAGE_REASONS,
  STAGE_ARTEFACT_STATES,
  WORKFLOW_ACTIONS,
  type ArchitecturalStageState,
  type SkippedStage,
  type SkippedStageReason,
  type ArchitecturalWorkflowState,
  type ArtefactIdentity,
  type StageArtefactState,
  type StaleDerivation,
  type WorkflowAction
} from './workflow-state.js';
