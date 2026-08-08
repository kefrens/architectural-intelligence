/**
 * The Geometry tool (Sprint 28.1a, Epic 7 — ADR-0027.1 Rule 6).
 *
 * How a *language model* reaches the Geometric Realisation stage: it recognises
 * that the user is asking for geometry and calls `planning_generateGeometry`.
 * The host reads the approved Layout Plan and realises it.
 *
 * Like the two planning tools before it, this takes **no arguments**. Geometry
 * is derived from an artefact the host already holds, through a packing strategy
 * and an evaluation that both live in `@archisimple/skills`; there is nothing
 * for the model to contribute except the judgement that this is what the user
 * asked for, which is what a tool call is.
 *
 * The empty schema is that guarantee made structural: there is no field through
 * which a model could suggest a coordinate, a room shape or a wall.
 */

import type { ArchitecturalIntelligenceService } from '@archisimple/architectural-intelligence';
import type { ResolvedToolCall, ToolDefinition } from './toolBroker';

export function createGeometryToolDefinition(
  intelligence: ArchitecturalIntelligenceService
): ToolDefinition {
  return {
    // A Geometry Graph executes nothing, so no Automation capability gates it.
    requires: [],
    schema: {
      type: 'function',
      function: {
        name: 'planning_generateGeometry',
        description:
          'Turns the approved layout plan into room shapes with real dimensions — polygons, wall candidates and opening candidates, but no walls yet. Call this when the user asks for the geometry, the room shapes, or what comes next after approving a layout. Takes no arguments: every coordinate is derived from the approved layout, not from you.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    resolve: (): ResolvedToolCall => {
      const layout = intelligence.approvedLayout();
      if (layout === undefined) {
        return {
          kind: 'blocked',
          message:
            'There is no approved layout yet, so there is nothing to realise. Ask the user to approve a layout first.'
        };
      }

      const response = intelligence.generateGeometry(layout);
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
