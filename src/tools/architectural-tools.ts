/**
 * Building operations in the Tool Registry (Sprint 24.5, "Components Extended:
 * Tool Registry → Building operations").
 *
 * The four architectural operations a *language model* can ask for, described
 * as function-calling tools. Each one builds an {@link ArchitecturalIntent} and
 * hands it to `ArchitecturalIntelligenceService.interpretIntent` — the same
 * planner, the same operation providers, the same reasoning, assumptions and
 * risk rules the offline Architectural Assistant goes through.
 *
 * ```text
 * a language model                 the offline assistant
 *      | tool call                        | utterance
 *      v                                  v
 * architecturalTools.ts              intent-recognizer.ts
 *      \                                 /
 *       -> ArchitecturalIntelligenceService.interpretIntent
 *                       v
 *          planner -> plan -> Proposal
 * ```
 *
 * One pipeline, two front doors. That is the whole reason these are thin: a
 * tool here parses arguments into an intent and does nothing else, so there is
 * no second place where a move-room proposal could be built differently.
 *
 * ## Why they hand back whole proposals
 *
 * Because the plan is already the interesting part. A `moveRoom` is several
 * `MoveEntityRequest`s carrying reasoning, assumptions, affected elements and a
 * risk level — none of which a caller could reconstruct from one Request. The
 * Sprint 23.5 tools keep returning a single Request, and the broker's
 * `ResolvedToolCall` union carries both.
 *
 * ## Why they name rooms rather than ids
 *
 * A model reading the Building and Spatial context fragments sees room *names*.
 * Making it echo an internal id back would be asking it to launder data it was
 * given, and would fail exactly when the id is the thing it hallucinated.
 */

import {
  ARCHITECTURAL_ACTIONS,
  ARCHITECTURAL_INTENT_KINDS,
  createIntent,
  INTENT_TARGET_KINDS,
  type ArchitecturalIntent,
  type IntentTarget
} from '../intent/index.js';
import type { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import type { ResolvedToolCall, ToolDefinition, ToolFunctionSchema } from '@archisimple/ai-engine';

/** Every Automation type the four operations below can plan. */
const MOVE_REQUIRES = ['automation.moveEntity'] as const;
const RENAME_REQUIRES = ['automation.updateProperty'] as const;
const WALL_PROPERTY_REQUIRES = ['inspector.setProperty'] as const;

const ROOM_ARGUMENT = {
  type: 'string',
  description:
    'The room’s name as it appears in the project context (for example "Kitchen"). Omit to use the current selection.'
} as const;

function schema(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: readonly string[]
): ToolFunctionSchema {
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } }
  };
}

/**
 * A room named in the arguments, or the current selection when it was not.
 * Mirrors how the recognizer reads "the kitchen" versus "this room", so both
 * front doors resolve targets identically.
 */
function roomTarget(args: Record<string, unknown>): IntentTarget {
  const room = args['room'];
  return typeof room === 'string' && room.trim().length > 0
    ? { kind: INTENT_TARGET_KINDS.Named, name: room.trim(), objectKind: 'Room' }
    : { kind: INTENT_TARGET_KINDS.Selection, objectKind: 'Room' };
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Runs one intent through the planner and shapes the outcome for the broker.
 *
 * A blocked plan comes back as `blocked` rather than `undefined`, so the model's
 * caller can show the user *why* — the same explanation the offline assistant
 * would have given (Story 24.5.11).
 */
function plan(
  intelligence: ArchitecturalIntelligenceService,
  intent: ArchitecturalIntent
): ResolvedToolCall {
  const response = intelligence.interpretIntent(intent);
  return response.proposal === undefined
    ? { kind: 'blocked', message: response.message }
    : { kind: 'proposal', proposal: response.proposal };
}

function modification(
  action: string,
  target: IntentTarget,
  parameters: Readonly<Record<string, unknown>>,
  utterance: string
): ArchitecturalIntent {
  return createIntent({
    kind: ARCHITECTURAL_INTENT_KINDS.Modification,
    action,
    utterance,
    target,
    parameters
  });
}

export function createArchitecturalToolDefinitions(
  intelligence: ArchitecturalIntelligenceService
): readonly ToolDefinition[] {
  return [
    {
      requires: MOVE_REQUIRES,
      schema: schema(
        'building_moveRoom',
        'Moves a room by translating every wall that encloses it. Distances are in metres; +X is east and +Y is north. Half a metre is 0.5, not 500.',
        {
          room: ROOM_ARGUMENT,
          deltaXM: {
            type: 'number',
            description: 'Eastward displacement in metres (negative for west).'
          },
          deltaYM: {
            type: 'number',
            description: 'Northward displacement in metres (negative for south).'
          }
        },
        ['deltaXM', 'deltaYM']
      ),
      resolve: (args) => {
        const deltaX = finite(args['deltaXM']);
        const deltaY = finite(args['deltaYM']);
        if (deltaX === undefined || deltaY === undefined) {
          return undefined;
        }
        return plan(
          intelligence,
          modification(
            ARCHITECTURAL_ACTIONS.moveRoom,
            roomTarget(args),
            { deltaX, deltaY },
            `Move the room by (${deltaX}, ${deltaY}) m.`
          )
        );
      }
    },
    {
      requires: RENAME_REQUIRES,
      schema: schema(
        'building_renameRoom',
        'Renames a room. The name is what appears in the Navigation panel, the Inspector and future answers.',
        {
          room: ROOM_ARGUMENT,
          newName: { type: 'string', description: 'The room’s new display name.' }
        },
        ['newName']
      ),
      resolve: (args) => {
        const newName = args['newName'];
        if (typeof newName !== 'string' || newName.trim().length === 0) {
          return undefined;
        }
        return plan(
          intelligence,
          modification(
            ARCHITECTURAL_ACTIONS.renameRoom,
            roomTarget(args),
            { newName: newName.trim() },
            `Rename the room to "${newName.trim()}".`
          )
        );
      }
    },
    {
      requires: WALL_PROPERTY_REQUIRES,
      schema: schema(
        'building_setWallProperty',
        'Changes a property of the currently selected wall or walls. Thickness and height are in metres; loadBearing is a boolean.',
        {
          property: {
            type: 'string',
            enum: ['thickness', 'height', 'loadBearing'],
            description: 'Which property to set.'
          },
          value: {
            type: ['number', 'boolean'],
            description: 'Metres for thickness and height; true or false for loadBearing.'
          }
        },
        ['property', 'value']
      ),
      resolve: (args) => {
        const property = args['property'];
        const value = args['value'];
        if (
          typeof property !== 'string' ||
          (typeof value !== 'number' && typeof value !== 'boolean')
        ) {
          return undefined;
        }
        return plan(
          intelligence,
          modification(
            ARCHITECTURAL_ACTIONS.setWallProperty,
            { kind: INTENT_TARGET_KINDS.Selection, objectKind: 'Wall' },
            { property, value },
            `Set the selected wall’s ${property} to ${String(value)}.`
          )
        );
      }
    },
    {
      requires: MOVE_REQUIRES,
      schema: schema(
        'building_alignWalls',
        'Aligns the currently selected walls onto a shared axis, moving each one perpendicular to its own run. Omit the axis to let the walls’ own orientation decide.',
        {
          axis: {
            type: 'string',
            enum: ['x', 'y'],
            description:
              'Align on a common X (walls that run vertically) or common Y (walls that run horizontally).'
          }
        },
        []
      ),
      resolve: (args) => {
        const axis = args['axis'];
        return plan(
          intelligence,
          modification(
            ARCHITECTURAL_ACTIONS.alignWalls,
            { kind: INTENT_TARGET_KINDS.Selection, objectKind: 'Wall' },
            axis === 'x' || axis === 'y' ? { axis } : {},
            'Align the selected walls.'
          )
        );
      }
    }
  ];
}
