export {
  ADJACENCY_STRENGTHS,
  AREA_SOURCES,
  createProgramme,
  FUNCTIONAL_ZONES,
  isProgrammeComplete,
  matchesBrief,
  programmeSpace,
  reviseProgramme,
  withPreviousSpaceIds,
  SPACE_PRIORITIES,
  SPACE_PROGRAMME_KIND,
  summarizeProgramme,
  type AdjacencyStrength,
  type AreaSource,
  type BriefProvenance,
  type FunctionalZone,
  type IntendedAdjacency,
  type ProgrammeSpace,
  type SpacePriority,
  type SpaceProgramme
} from './space-programme.js';

export {
  synthesizeProgramme,
  type ProgrammeSynthesisResult,
  type SynthesizeProgrammeOptions
} from './programme-synthesis.js';

export { describeProgramme, toProgrammeProposal } from './programme-proposal.js';
