/**
 * Align walls (Sprint 24.5, Story 24.5.1 "Align these walls").
 *
 * Takes the selected walls and slides each one, perpendicular to its own run,
 * onto a shared axis — the second multi-step proposal in this sprint, and the
 * one that shows reasoning changing the *shape* of a plan rather than just its
 * parameters.
 *
 * ## Choosing the axis
 *
 * A request rarely says which axis it means, and it does not have to: the walls
 * do. A set of mostly-vertical walls can only sensibly be aligned on X (they
 * line up left-to-right); a set of mostly-horizontal ones on Y. The provider
 * reads the dominant run direction and states the choice as an assumption, so a
 * user who meant the other one can see that and say so ("align these walls
 * horizontally" names the axis explicitly).
 *
 * ## Choosing the target
 *
 * The mean of the walls' midpoints on the chosen axis. The alternative — snap
 * to the first, or to the outermost — moves more walls further; the mean moves
 * the least material overall, and no wall is privileged for being drawn first.
 */

import { moveEntityRequest, type WallDto } from '@archisimple/automation-api';
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
import { affectedWall } from './affected-elements.js';

export const ALIGN_WALLS_OPERATION_ID = 'align-walls';

/**
 * Below this, in document units, a wall counts as already aligned.
 *
 * Document units are millimetres, so this is a tenth of a millimetre: small
 * enough that nothing a user drew lands inside it by accident, large enough
 * that floating-point noise in a mean does not generate a no-op move.
 */
const ALIGNMENT_TOLERANCE = 0.1;

type Axis = 'x' | 'y';

function midpoint(wall: WallDto, axis: Axis): number {
  return axis === 'x' ? (wall.start.x + wall.end.x) / 2 : (wall.start.y + wall.end.y) / 2;
}

/**
 * The axis the walls themselves imply: a wall that runs vertically is aligned
 * by moving it horizontally, and vice versa.
 */
function dominantAxis(walls: readonly WallDto[]): Axis {
  const vertical = walls.filter(
    (wall) => Math.abs(wall.end.y - wall.start.y) >= Math.abs(wall.end.x - wall.start.x)
  ).length;
  return vertical * 2 >= walls.length ? 'x' : 'y';
}

export function createAlignWallsOperationProvider(): ArchitecturalOperationProvider {
  return {
    id: ALIGN_WALLS_OPERATION_ID,
    actions: [ARCHITECTURAL_ACTIONS.alignWalls],

    plan(intent: ArchitecturalIntent, knowledge: BuildingKnowledge): PlanResult {
      const target = knowledge.resolveTarget(intent.target);
      if (target.walls.length < 2) {
        return blocked(
          PLAN_BLOCKER_REASONS.Ambiguous,
          `Aligning needs at least two walls; ${target.walls.length === 0 ? 'none are' : 'only one is'} selected.`,
          ['Select the walls you want aligned, then ask again.']
        );
      }

      const requested = intent.parameters['axis'];
      const axis: Axis =
        requested === 'x' || requested === 'y' ? requested : dominantAxis(target.walls);
      const chosenByWalls = requested !== 'x' && requested !== 'y';

      const positions = target.walls.map((wall) => midpoint(wall, axis));
      const mean = positions.reduce((total, position) => total + position, 0) / positions.length;

      const steps: PlanStep[] = [];
      for (const wall of target.walls) {
        const offset = mean - midpoint(wall, axis);
        if (Math.abs(offset) < ALIGNMENT_TOLERANCE) {
          continue;
        }
        const delta = axis === 'x' ? { x: offset, y: 0 } : { x: 0, y: offset };
        steps.push({
          description: `Move wall \`${wall.id}\` by ${Math.round(offset)} mm on ${axis.toUpperCase()} to reach the shared axis.`,
          request: moveEntityRequest(wall.id, delta),
          affects: [affectedWall(wall, `aligned on ${axis.toUpperCase()}`, knowledge)],
          highlightedEntityIds: [wall.id]
        });
      }

      if (steps.length === 0) {
        return blocked(
          PLAN_BLOCKER_REASONS.NothingToDo,
          `Those ${target.walls.length} walls already share the same ${axis.toUpperCase()} axis.`,
          [
            `If you meant the other axis, say "align these walls ${axis === 'x' ? 'horizontally' : 'vertically'}".`
          ]
        );
      }

      return planned({
        intent,
        title: `Align ${target.walls.length} walls`,
        reasoning: `${target.walls.length} walls are selected. ${chosenByWalls ? `Most of them run ${axis === 'x' ? 'vertically, so they line up along X' : 'horizontally, so they line up along Y'}.` : `You asked for the ${axis.toUpperCase()} axis.`} Aligning to the mean of their midpoints (${Math.round(mean)} mm) moves the least material: ${steps.length} of the ${target.walls.length} walls need to move at all.`,
        assumptions: [
          `Alignment is on the ${axis.toUpperCase()} axis${chosenByWalls ? ', inferred from how the selected walls run' : ', as requested'}.`,
          'Each wall is moved as a whole rather than having its endpoints edited, so lengths and angles are preserved.'
        ],
        expectedOutcome: `All ${target.walls.length} selected walls share a common ${axis.toUpperCase()} of ${Math.round(mean)} mm. Their lengths and orientations are unchanged.`,
        steps,
        risk: PROPOSAL_RISKS.Safe,
        warnings: [
          'Walls joined to others at their endpoints will drag those joints with them; check the connections afterwards.'
        ]
      });
    }
  };
}
