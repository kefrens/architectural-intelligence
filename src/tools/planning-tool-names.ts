/**
 * The planning tools, by the stage each one reaches (Sprint 1.4, Story 1.4.3).
 *
 * Until this sprint every tool name existed exactly once — as a string literal
 * inside its own function schema — which was correct while nothing else needed
 * to know them. The workflow-state context fragment does: telling a model *where
 * the design is* is only half an answer if it then has to guess which tool moves
 * it forward (Bug 001).
 *
 * ## One table, not a second opinion
 *
 * Keyed by {@link PLANNING_STAGES}, so this cannot disagree with the pipeline
 * about which stages exist — adding a sixth stage without a tool fails to
 * compile, which is the point of typing it as a total record rather than a
 * lookup that answers `undefined`.
 *
 * It says nothing about **availability**. The host's broker still checks each
 * tool's `requires` against what the Automation MCP server actually serves, and
 * contributing a tool has never been the same as it being offered (Sprint 29.1).
 * A name here is what to call *if* the host offers it.
 */

import { PLANNING_STAGES, type PlanningStage } from '../planning/planning-stage.js';

export const PLANNING_TOOL_NAMES: Readonly<Record<PlanningStage, string>> = {
  [PLANNING_STAGES.Brief]: 'planning_captureBrief',
  [PLANNING_STAGES.Programme]: 'planning_generateProgramme',
  [PLANNING_STAGES.Layout]: 'planning_generateLayout',
  [PLANNING_STAGES.Geometry]: 'planning_generateGeometry',
  [PLANNING_STAGES.Specification]: 'planning_generateSpecification'
};

/** The tool that moves this stage forward. Total over the five stages. */
export function planningToolFor(stage: PlanningStage): string {
  return PLANNING_TOOL_NAMES[stage];
}
