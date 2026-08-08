/**
 * Rename a room (Sprint 24.5, Story 24.5.1 "Rename this room").
 *
 * The smallest genuine architectural edit the platform supports, and the one
 * that shows the whole chain working: a semantic concept the user names, a
 * Building Object that carries the name, an Automation Request that writes it,
 * and the shared undo stack that takes it back.
 *
 * ## Why `UpdatePropertyRequest` and not the Inspector's `SetProperty`
 *
 * Because a room's name is not an editable Inspector property today — the
 * Building Inspector Provider publishes it as `derived` (Sprint 24.4's editable
 * coverage is three wall properties). `UpdatePropertyRequest` sets a typed
 * user-defined property on the entity, which is exactly where the room DTO
 * reads a name from, so this writes to the same place the Navigation panel and
 * the Inspector read from. No second naming path.
 *
 * ## The caveat a detected room always carries
 *
 * A detected room is regenerated from its walls whenever they change. The name
 * lives on the regenerated entity, so a later wall edit can take it with it.
 * The plan warns rather than pretending otherwise.
 */

import { PropertyDto, updatePropertyRequest } from '@archisimple/automation-api';
import { PROPOSAL_RISKS } from '@archisimple/ai-engine';
import {
  ARCHITECTURAL_ACTIONS,
  type ArchitecturalIntent
} from '../../intent/architectural-intent.js';
import type { BuildingKnowledge } from '../../understanding/building-knowledge.js';
import type { ArchitecturalOperationProvider } from '../architectural-operation.js';
import { blocked, planned, PLAN_BLOCKER_REASONS, type PlanResult } from '../architectural-plan.js';
import { affectedRoom } from './affected-elements.js';

export const RENAME_ROOM_OPERATION_ID = 'rename-room';

/** The metadata key `RoomDto`/`surfaceToRoomDto` read a display name from. */
const NAME_PROPERTY_KEY = 'name';

export function createRenameRoomOperationProvider(): ArchitecturalOperationProvider {
  return {
    id: RENAME_ROOM_OPERATION_ID,
    actions: [ARCHITECTURAL_ACTIONS.renameRoom],

    plan(intent: ArchitecturalIntent, knowledge: BuildingKnowledge): PlanResult {
      const newName = intent.parameters['newName'];
      if (typeof newName !== 'string' || newName.trim().length === 0) {
        return blocked(PLAN_BLOCKER_REASONS.MissingInformation, 'I need the new name.', [
          'Try "rename this room to Kitchen".'
        ]);
      }

      const target = knowledge.resolveTarget(intent.target);
      if (target.unresolvedName !== undefined) {
        return blocked(
          PLAN_BLOCKER_REASONS.Ambiguous,
          `I could not find a room called "${target.unresolvedName}".`,
          knowledge
            .rooms()
            .map((room) => `Did you mean **${room.name}**?`)
            .slice(0, 5)
        );
      }
      const room = target.rooms[0];
      if (room === undefined) {
        return blocked(PLAN_BLOCKER_REASONS.Ambiguous, 'I do not know which room to rename.', [
          'Select the room and say "rename this room to Kitchen".',
          'Or name it directly — "rename Room 1 to Kitchen".'
        ]);
      }
      if (target.rooms.length > 1) {
        return blocked(
          PLAN_BLOCKER_REASONS.Ambiguous,
          `${target.rooms.length} rooms are selected, and they cannot all be called "${newName.trim()}".`,
          ['Select a single room and ask again.']
        );
      }

      const trimmed = newName.trim();
      return planned({
        intent,
        title: `Rename ${room.name}`,
        reasoning: `**${room.name}** is the room this request points at. A room's display name is a property of the space itself, so renaming it changes nothing geometric — the walls, area and adjacency all stay exactly as they are.`,
        assumptions: [`The new name is "${trimmed}", taken verbatim from the request.`],
        expectedOutcome: `The room currently shown as **${room.name}** appears as **${trimmed}** in the Navigation panel, the Inspector and in future answers.`,
        steps: [
          {
            description: `Rename "${room.name}" to "${trimmed}".`,
            request: updatePropertyRequest({
              entityId: room.sourceEntityId,
              key: NAME_PROPERTY_KEY,
              value: PropertyDto.string(trimmed),
              label: 'Rename Room'
            }),
            affects: [affectedRoom(room, `renamed to "${trimmed}"`, knowledge)],
            highlightedEntityIds: [room.sourceEntityId]
          }
        ],
        risk: PROPOSAL_RISKS.Safe,
        warnings:
          room.origin === 'detected'
            ? [
                'This room was detected from its walls. Editing those walls regenerates the space, which can drop the name.'
              ]
            : []
      });
    }
  };
}
