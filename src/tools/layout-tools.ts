/**
 * The Layout tool (Sprint 28.0, Story 28.0.6 — ADR-0027.1 Rule 6).
 *
 * How a *language model* reaches the Layout Planning stage: it recognises that
 * the user is asking for the layout and calls `planning_generateLayout`. The
 * host reads the approved Space Programme and resolves it.
 *
 * Like `planning_generateProgramme` before it, this takes **no arguments**. A
 * layout is derived from an artefact the host already holds, through four
 * deterministic skills; there is nothing for the model to contribute except the
 * judgement that this is what the user asked for, which is what a tool call is.
 *
 * The empty schema is the guarantee made structural: there is no field through
 * which a model could suggest a storey, an adjacency or an arrangement, so the
 * layout cannot depend on which model answered.
 */

import type { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import type { ResolvedToolCall, ToolDefinition } from '@archisimple/ai-engine';
import { PLANNING_STAGES } from '../planning/planning-stage.js';
import { PLANNING_TOOL_NAMES } from './planning-tool-names.js';

export function createLayoutToolDefinition(
  intelligence: ArchitecturalIntelligenceService
): ToolDefinition {
  return {
    // A layout executes nothing, so no Automation capability gates it.
    requires: [],
    schema: {
      type: 'function',
      function: {
        name: PLANNING_TOOL_NAMES[PLANNING_STAGES.Layout],
        description:
          'Arranges the approved space programme into a layout: which storey each space sits on, what ends up next to what, and how circulation works. Call this when the user asks for the layout, the arrangement, or what comes next after approving a programme. Takes no arguments — every decision is derived from the approved programme, not from you.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    resolve: (): ResolvedToolCall => {
      const programme = intelligence.approvedProgramme();
      if (programme === undefined) {
        return {
          kind: 'blocked',
          message:
            'There is no approved space programme yet, so there is nothing to arrange. Ask the user to approve a programme first.'
        };
      }

      const response = intelligence.generateLayout(programme);
      if (response.proposal === undefined) {
        // Synthesis failed for a reason the user can act on. A sentence, not an
        // exception, and it returns the way a blocker does.
        return { kind: 'blocked', message: response.message };
      }

      return { kind: 'proposal', proposal: response.proposal };
    }
  };
}
