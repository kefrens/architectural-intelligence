/**
 * The Geometry Specification tool (Sprint 1.1, Story 1.1.11 — ADR-0027.1
 * Rule 6).
 *
 * How a *language model* reaches the final design stage: it recognises that the
 * user is asking for the walls, and calls `planning_generateSpecification`. The
 * host reads the approved Geometry Graph and resolves it.
 *
 * Like the three planning tools before it, this takes **no arguments**. Every
 * thickness, height and opening size comes from the construction defaults and
 * from maths in `@archisimple/skills`; there is nothing for the model to
 * contribute except the judgement that this is what the user asked for, which is
 * what a tool call is.
 *
 * The empty schema is that guarantee made structural: there is no field through
 * which a model could suggest a wall thickness.
 */

import type { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import type { ResolvedToolCall, ToolDefinition } from '@archisimple/ai-engine';

export function createSpecificationToolDefinition(
  intelligence: ArchitecturalIntelligenceService
): ToolDefinition {
  return {
    // A specification executes nothing, so no Automation capability gates it.
    requires: [],
    schema: {
      type: 'function',
      function: {
        name: 'planning_generateSpecification',
        description:
          'Turns the approved geometry into a complete buildable specification — walls with thickness and height, and openings with real sizes. Call this when the user asks for the walls, the construction, or what comes next after approving the geometry. Takes no arguments: every dimension is derived from the approved geometry, not from you.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    resolve: (): ResolvedToolCall => {
      const graph = intelligence.approvedGeometry();
      if (graph === undefined) {
        return {
          kind: 'blocked',
          message:
            'There is no approved geometry yet, so there is nothing to give thickness to. Ask the user to approve the geometry first.'
        };
      }

      const response = intelligence.generateSpecification(graph);
      if (response.proposal === undefined) {
        // Either synthesis failed, or the invariant gate refused the result.
        // Both are sentences the user can act on, and both return the way a
        // blocker does.
        return { kind: 'blocked', message: response.message };
      }

      return { kind: 'proposal', proposal: response.proposal };
    }
  };
}
