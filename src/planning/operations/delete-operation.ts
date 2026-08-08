/**
 * Delete the selection (Sprint 24.5, Story 24.5.12).
 *
 * The sprint's own first example of a "potentially destructive" operation, and
 * the reason {@link PROPOSAL_RISKS} exists: this provider marks its plan
 * `destructive`, which makes `AiSessionController.approveProposal` refuse to
 * run it until the caller passes an explicit confirmation.
 *
 * The safety is in the plan, not in the panel. A script or a protocol adapter
 * driving the same session inherits the confirmation requirement without
 * knowing this provider exists.
 *
 * ## Why it describes what is being deleted so carefully
 *
 * Because "delete" is the one decision a user cannot examine afterwards. The
 * affected-element list names each target in the Building Model's vocabulary,
 * and rooms are called out separately: deleting a wall that bounds a room
 * destroys the room as a side effect, and that consequence has to be visible
 * before approval rather than discovered after it.
 */

import { deleteEntityRequest } from '@archisimple/automation-api';
import { PROPOSAL_RISKS } from '@archisimple/ai-engine';
import {
  ARCHITECTURAL_ACTIONS,
  type ArchitecturalIntent
} from '../../intent/architectural-intent.js';
import type { BuildingKnowledge } from '../../understanding/building-knowledge.js';
import type { ArchitecturalOperationProvider } from '../architectural-operation.js';
import {
  blocked,
  planned,
  PLAN_BLOCKER_REASONS,
  type PlanResult,
  type PlanStep
} from '../architectural-plan.js';
import { affectedEntity } from './affected-elements.js';

export const DELETE_OPERATION_ID = 'delete-selection';

export function createDeleteOperationProvider(): ArchitecturalOperationProvider {
  return {
    id: DELETE_OPERATION_ID,
    actions: [ARCHITECTURAL_ACTIONS.deleteSelection],

    plan(intent: ArchitecturalIntent, knowledge: BuildingKnowledge): PlanResult {
      const target = knowledge.resolveTarget(intent.target);

      if (target.unresolvedName !== undefined) {
        return blocked(
          PLAN_BLOCKER_REASONS.Ambiguous,
          `I could not find anything called "${target.unresolvedName}" to delete.`,
          knowledge
            .rooms()
            .map((room) => `Did you mean **${room.name}**?`)
            .slice(0, 5)
        );
      }
      if (target.entityIds.length === 0) {
        return blocked(
          PLAN_BLOCKER_REASONS.Ambiguous,
          'Nothing is selected, so I do not know what to delete.',
          ['Select the elements you want removed, then ask again.']
        );
      }

      const steps: PlanStep[] = target.entityIds.map((entityId) => {
        const affected = affectedEntity(entityId, 'deleted', knowledge);
        return {
          description: `Delete ${affected.kind}${affected.name === undefined ? '' : ` "${affected.name}"`} \`${entityId}\`.`,
          request: deleteEntityRequest(entityId),
          affects: [affected],
          highlightedEntityIds: [entityId]
        };
      });

      // A wall that bounds a room takes the room with it when it goes: the
      // enclosure stops being closed, and the Spatial Model stops deriving a
      // space there. Named explicitly, because it is the consequence a user is
      // least likely to have in mind while selecting a wall.
      const doomedRooms = knowledge
        .rooms()
        .filter((room) => room.boundaryWallIds.some((wallId) => target.entityIds.includes(wallId)))
        .map((room) => room.name);

      return planned({
        intent,
        title: `Delete ${steps.length} element${steps.length === 1 ? '' : 's'}`,
        reasoning: `The selection holds ${steps.length} element${steps.length === 1 ? '' : 's'}, each removed by its own Automation request so the whole set lands on the undo stack as one reviewable decision.`,
        assumptions: [`"${intent.utterance}" refers to what is currently selected.`],
        expectedOutcome: `${steps.length} element${steps.length === 1 ? '' : 's'} disappear${steps.length === 1 ? 's' : ''} from the plan. Undo restores ${steps.length === 1 ? 'it' : 'them'}.`,
        steps,
        risk: PROPOSAL_RISKS.Destructive,
        warnings:
          doomedRooms.length === 0
            ? []
            : [
                `This also breaks the enclosure of ${doomedRooms.map((name) => `**${name}**`).join(', ')}, so ${doomedRooms.length === 1 ? 'that room' : 'those rooms'} will no longer be detected.`
              ]
      });
    }
  };
}
