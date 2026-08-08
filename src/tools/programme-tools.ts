/**
 * The Programme tool (Sprint 27.9, Story 27.9.3 — ADR-0027.1 Rule 6).
 *
 * How a *language model* reaches the Space Programme stage: it recognises that
 * the user is asking for the programme and calls `planning_generateProgramme`.
 * The host reads the approved Brief and synthesises the artefact.
 *
 * ## Why this tool takes almost nothing
 *
 * `planning_captureBrief` accepts fields because a Brief is built from what the
 * user *said*, and the model is the thing that read it. A Programme is built
 * from an artefact the project has already approved — the host holds it, the
 * model has never seen it, and every number in the result comes from
 * `@archisimple/skills` (Rule 9). There is nothing left for the model to
 * contribute except the judgement that this is what the user asked for, which is
 * exactly what a tool call *is*.
 *
 * Letting the model pass spaces or areas here would reintroduce the failure this
 * whole pipeline exists to remove: a programme whose contents depend on which
 * model answered. So it cannot, and the schema says so.
 */

import type { ArchitecturalIntelligenceService } from '@archisimple/architectural-intelligence';
import type { ResolvedToolCall, ToolDefinition } from './toolBroker';

export function createProgrammeToolDefinition(
  intelligence: ArchitecturalIntelligenceService
): ToolDefinition {
  return {
    // A programme executes nothing, so no Automation capability gates it —
    // the same reasoning `planning_captureBrief` follows.
    requires: [],
    schema: {
      type: 'function',
      function: {
        name: 'planning_generateProgramme',
        description:
          'Turns the approved architectural brief into a space programme: which spaces the building contains, how large each should be, and which belong together. Call this when the user asks for the programme, the spaces, or what comes next after approving a brief. Takes no arguments — every space and area is derived from the approved brief, not from you.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    resolve: (): ResolvedToolCall => {
      const brief = intelligence.approvedBrief();
      if (brief === undefined) {
        return {
          kind: 'blocked',
          message:
            'There is no approved brief yet, so there is nothing to write a programme from. Ask the user what they want to build first.'
        };
      }

      const response = intelligence.generateProgramme(brief);
      if (response.proposal === undefined) {
        // Synthesis failed for a reason the user can act on — a stated total too
        // small for the spaces asked for, in practice. That is a sentence, not
        // an exception, and it goes back the same way a blocker does.
        return { kind: 'blocked', message: response.message };
      }

      return { kind: 'proposal', proposal: response.proposal };
    }
  };
}
