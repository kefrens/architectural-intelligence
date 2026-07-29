/**
 * Move a room (Sprint 24.5, Story 24.5.1 "Move the kitchen", Story 24.5.9).
 *
 * The sprint's own example of a multi-step proposal, and the reason Story
 * 24.5.9 exists: a room is not an entity you can translate. It is an enclosed
 * space *derived* from the walls around it, so moving it means moving each of
 * its boundary walls — one `MoveEntityRequest` per wall, grouped into one
 * proposal the user reads as a single decision.
 *
 * ## Why boundary walls and not the room entity
 *
 * The Spatial Model derives a room from a closed loop of walls (Sprint 24.3);
 * the `Surface` entity behind it is regenerated whenever those walls change.
 * Translating that entity would be translating the output of a computation —
 * the walls would snap it straight back. Moving the walls moves the room, which
 * is the only version of "move the kitchen" the document can actually hold.
 *
 * ## The caveat this always carries
 *
 * A wall shared with an adjacent room bounds both of them. Moving it moves the
 * neighbour's boundary too, and no amount of planning avoids that — it is what
 * the geometry says. So the plan says it, as a warning, rather than surprising
 * the user after approval.
 */

import { moveEntityRequest } from '@archisimple/automation-api';
import { PROPOSAL_RISKS } from '@archisimple/ai-engine';
import { ARCHITECTURAL_ACTIONS, type ArchitecturalIntent } from '../../intent/architectural-intent';
import type { BuildingKnowledge } from '../../understanding/building-knowledge';
import type { ArchitecturalOperationProvider } from '../architectural-operation';
import {
  blocked,
  planned,
  PLAN_BLOCKER_REASONS,
  type PlanResult,
  type PlanStep
} from '../architectural-plan';
import { affectedRoom, affectedWall } from './affected-elements';

export const MOVE_ROOM_OPERATION_ID = 'move-room';

const MILLIMETRES_PER_METRE = 1000;

function metres(millimetres: number): number {
  return Math.round((millimetres / MILLIMETRES_PER_METRE) * 100) / 100;
}

function describeDelta(deltaX: number, deltaY: number): string {
  const parts: string[] = [];
  if (deltaX !== 0) {
    parts.push(`${metres(Math.abs(deltaX))} m ${deltaX > 0 ? 'east' : 'west'}`);
  }
  if (deltaY !== 0) {
    parts.push(`${metres(Math.abs(deltaY))} m ${deltaY > 0 ? 'north' : 'south'}`);
  }
  return parts.join(' and ');
}

export function createMoveRoomOperationProvider(): ArchitecturalOperationProvider {
  return {
    id: MOVE_ROOM_OPERATION_ID,
    actions: [ARCHITECTURAL_ACTIONS.moveRoom],

    plan(intent: ArchitecturalIntent, knowledge: BuildingKnowledge): PlanResult {
      const deltaX = intent.parameters['deltaX'];
      const deltaY = intent.parameters['deltaY'];
      if (typeof deltaX !== 'number' || typeof deltaY !== 'number') {
        return blocked(
          PLAN_BLOCKER_REASONS.MissingInformation,
          'I need to know how far and in which direction to move it.',
          [
            'Try "move the kitchen 2 m north".',
            'Directions I understand: north, south, east, west (and up, down, left, right).'
          ]
        );
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
        return blocked(PLAN_BLOCKER_REASONS.Ambiguous, 'I do not know which room to move.', [
          'Name it — "move the kitchen 2 m north".',
          'Or select the room first and say "move this room 2 m north".'
        ]);
      }
      if (target.rooms.length > 1) {
        return blocked(
          PLAN_BLOCKER_REASONS.Ambiguous,
          `That points at ${target.rooms.length} rooms at once, and I would rather move one at a time.`,
          target.rooms.map((candidate) => `Say "move ${candidate.name} …" to move just that one.`)
        );
      }
      if (room.boundaryWallIds.length === 0) {
        return blocked(
          PLAN_BLOCKER_REASONS.Unsupported,
          `**${room.name}** has no boundary walls recorded, so there is nothing to move it by.`,
          ['Rooms are moved by moving the walls that enclose them.']
        );
      }

      const delta = { x: deltaX, y: deltaY };
      const wallsById = new Map(knowledge.walls().map((wall) => [wall.id, wall]));
      const steps: PlanStep[] = room.boundaryWallIds.map((wallId, index) => {
        const wall = wallsById.get(wallId);
        return {
          description: `Move boundary wall \`${wallId}\` by ${describeDelta(deltaX, deltaY)}.`,
          request: moveEntityRequest(wallId, delta),
          affects: [
            // The room itself is named once, on the first step: it is what the
            // user asked to move, and repeating it per wall would bury the walls
            // it is actually moved by — and would trip the bulk-confirmation
            // threshold on element count alone.
            ...(index === 0 ? [affectedRoom(room, 'moved', knowledge)] : []),
            ...(wall === undefined
              ? [{ kind: 'Wall', entityId: wallId, change: 'moved' }]
              : [affectedWall(wall, 'moved', knowledge)])
          ],
          highlightedEntityIds: [wallId]
        };
      });

      const sharedWallIds = knowledge
        .adjacentRooms(room.id)
        .flatMap((neighbour) => neighbour.boundaryWallIds)
        .filter((wallId) => room.boundaryWallIds.includes(wallId));

      return planned({
        intent,
        title: `Move ${room.name}`,
        reasoning: `**${room.name}** is an enclosed space derived from ${room.boundaryWallIds.length} boundary walls, so moving it means moving each of those walls by the same amount. Moving the room's surface entity alone would be undone the moment the walls are next re-read.`,
        assumptions: [
          `"${intent.utterance}" refers to the room **${room.name}** (${Math.round(knowledge.roomAreaSquareMetres(room) * 100) / 100} m²).`,
          'North is +Y and east is +X in the plan’s world coordinates.'
        ],
        expectedOutcome: `**${room.name}** and its ${room.boundaryWallIds.length} boundary walls sit ${describeDelta(deltaX, deltaY)} of where they are now; the room keeps its area and shape.`,
        steps,
        risk: PROPOSAL_RISKS.Safe,
        warnings:
          sharedWallIds.length === 0
            ? []
            : [
                `${sharedWallIds.length} of these walls also bound an adjacent room, which will change shape as a result.`
              ]
      });
    }
  };
}
