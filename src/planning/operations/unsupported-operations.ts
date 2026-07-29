/**
 * Recognised, and honestly refused (Sprint 24.5, Story 24.5.11).
 *
 * Two of the sprint's own example requests — "Make this room larger" and "Add a
 * window here" — cannot be carried out by this platform today, and this
 * provider exists so that fact is *stated* rather than reached by falling off
 * the end of the planner.
 *
 * The difference matters. An unrecognised phrase gets "I did not understand
 * that". These two get "I understood exactly what you asked, here is the part
 * of the platform that is missing, and here is what I can do instead" — which
 * is the whole of Story 24.5.11: identify unsupported operations, and propose
 * alternatives whenever possible.
 *
 * ## Why they are unsupported
 *
 * - **Resize a room.** The Automation contract has no request that resizes an
 *   enclosure. A room is derived from its walls, so growing it means deciding
 *   *which* wall moves and by how much — a decision the request does not carry
 *   and this layer must not invent. `edit.moveRoom` already moves walls once
 *   told which and how far, so the alternative is real rather than a deflection.
 * - **Add an opening.** There is no create-door or create-window request at all
 *   (`APPLICATION_REQUEST_TYPES` covers walls, entities and annotations). The
 *   Building Model can *name* an Opening; nothing can make one. This is a
 *   platform gap, and pretending otherwise would produce a proposal that fails
 *   on approval.
 *
 * Each becomes plannable the day the corresponding Automation request exists —
 * at which point this provider drops that action and a real one takes it.
 */

import { ARCHITECTURAL_ACTIONS, type ArchitecturalIntent } from '../../intent/architectural-intent';
import type { BuildingKnowledge } from '../../understanding/building-knowledge';
import type { ArchitecturalOperationProvider } from '../architectural-operation';
import { blocked, PLAN_BLOCKER_REASONS, type PlanResult } from '../architectural-plan';

export const UNSUPPORTED_OPERATIONS_ID = 'unsupported';

export function createUnsupportedOperationProvider(): ArchitecturalOperationProvider {
  return {
    id: UNSUPPORTED_OPERATIONS_ID,
    actions: [ARCHITECTURAL_ACTIONS.resizeRoom, ARCHITECTURAL_ACTIONS.addOpening],

    plan(intent: ArchitecturalIntent, knowledge: BuildingKnowledge): PlanResult {
      if (intent.action === ARCHITECTURAL_ACTIONS.resizeRoom) {
        const room = knowledge.resolveTarget(intent.target).rooms[0];
        return blocked(
          PLAN_BLOCKER_REASONS.Unsupported,
          `I cannot resize ${room === undefined ? 'a room' : `**${room.name}**`} directly: a room is the space its walls enclose, and there is no request that grows an enclosure on its own.`,
          [
            'Tell me which wall to move and how far — "move the north wall 500 mm north" — and I will propose that.',
            ...(room === undefined
              ? []
              : [
                  `**${room.name}** is bounded by ${room.boundaryWallIds.length} walls; moving any one of them changes its size.`
                ]),
            'You can also drag a boundary wall directly in the floor plan.'
          ]
        );
      }

      const openingType = intent.parameters['openingType'];
      return blocked(
        PLAN_BLOCKER_REASONS.Unsupported,
        `I cannot add ${openingType === 'window' || openingType === 'door' ? `a ${String(openingType)}` : 'an opening'}: the Automation API has no request that creates one, so there is nothing I could propose that would succeed.`,
        [
          'The Building Model can already describe openings once they exist — I can answer questions about them.',
          'Wall, annotation and dimension creation are available; ask for one of those and I will propose it.'
        ]
      );
    }
  };
}
