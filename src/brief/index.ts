export {
  ARCHITECTURAL_BRIEF_KIND,
  BRIEF_REQUIREMENT_SOURCES,
  BRIEF_TOPICS,
  briefRequirement,
  createBrief,
  isBriefComplete,
  reviseBrief,
  summarizeBrief,
  withRequirement,
  type ArchitecturalBrief,
  type BriefRequirement,
  type BriefRequirementSource,
  type BriefTopic,
  type DesiredSpace
} from './architectural-brief.js';

export {
  desiredSpacesFrom,
  DWELLING_WORDS,
  readBareBoolean,
  readBareCount,
  readBriefTopics
} from './brief-topics.js';

export {
  classifyRequest,
  MANDATORY_BRIEF_TOPICS,
  REQUEST_LANES,
  type ClassifyRequestOptions,
  type RequestClassification,
  type RequestLane
} from './request-classification.js';

export {
  clarificationBlocker,
  clarificationFor,
  clarificationQuestion,
  describeClarification,
  type ClarificationDialogue,
  type ClarificationQuestion
} from './clarification.js';

export {
  answerClarification,
  assembleBrief,
  assembleBriefFromFields,
  reviseBriefFrom,
  reviseBriefFromFields,
  startBriefDraft,
  type AssembleBriefOptions
} from './brief-assembly.js';

export { describeBrief, toBriefProposal } from './brief-proposal.js';

export { createInMemoryBriefDraftStore, type BriefDraftStore } from './brief-draft-store.js';

/** Sprint 29.1 (ADR-0029 Rule 2): the session-bound draft store, formerly in `apps/web`. */
export {
  createSessionBriefDraftStore,
  type BoundBriefDraftStore
} from './session-brief-draft-store.js';
