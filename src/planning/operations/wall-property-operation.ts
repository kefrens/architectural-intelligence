/**
 * Change a wall property (Sprint 24.5, Story 24.5.7).
 *
 * "Make this wall 300 mm thick." The only edit in this sprint that goes through
 * the Inspector's own write path — `inspector.setProperty` — rather than
 * straight to a wall request, and deliberately so: Story 24.4.12 built that
 * path precisely "so an AI or a script edits semantic properties through the
 * very pipeline the panel uses". Reaching past it to
 * `UpdateWallPropertiesRequest` would be a second write path with a second set
 * of bounds.
 *
 * ## Validating before proposing, not after
 *
 * The bounds come from the same `PropertyDefinition` the Inspector validates
 * against, read through {@link BuildingKnowledge.editableProperties}. A value
 * outside them is refused *here*, with the actual range quoted back, rather
 * than becoming a proposal the user approves and then watches fail — which is
 * the difference Story 24.5.11 is asking for between "cannot" and "did not".
 */

import { PROPOSAL_RISKS } from '@archisimple/ai-engine';
import { setPropertyRequest } from '@archisimple/inspector';
import type { WallDto } from '@archisimple/automation-api';
import {
  ARCHITECTURAL_ACTIONS,
  type ArchitecturalIntent
} from '../../intent/architectural-intent.js';
import type {
  BuildingKnowledge,
  EditableProperty
} from '../../understanding/building-knowledge.js';
import type { ArchitecturalOperationProvider } from '../architectural-operation.js';
import {
  blocked,
  planned,
  PLAN_BLOCKER_REASONS,
  type PlanResult,
  type PlanStep
} from '../architectural-plan.js';
import { affectedWall } from './affected-elements.js';

export const WALL_PROPERTY_OPERATION_ID = 'wall-property';

/** How each supported key reads in an explanation, with the unit its values carry. */
const PROPERTY_LABELS: Readonly<Record<string, { readonly label: string; readonly unit: string }>> =
  {
    thickness: { label: 'thickness', unit: ' m' },
    height: { label: 'height', unit: ' m' },
    loadBearing: { label: 'load-bearing flag', unit: '' }
  };

function formatValue(key: string, value: unknown): string {
  const unit = PROPERTY_LABELS[key]?.unit ?? '';
  return typeof value === 'boolean' ? (value ? 'yes' : 'no') : `${String(value)}${unit}`;
}

export function createWallPropertyOperationProvider(): ArchitecturalOperationProvider {
  return {
    id: WALL_PROPERTY_OPERATION_ID,
    actions: [ARCHITECTURAL_ACTIONS.setWallProperty],

    plan(intent: ArchitecturalIntent, knowledge: BuildingKnowledge): PlanResult {
      const property = intent.parameters['property'];
      const value = intent.parameters['value'];
      if (typeof property !== 'string' || PROPERTY_LABELS[property] === undefined) {
        return blocked(
          PLAN_BLOCKER_REASONS.Unsupported,
          'I can change a wall’s thickness, height or load-bearing flag; I could not tell which of those you meant.',
          ['Try "set this wall’s thickness to 0.3 m".']
        );
      }
      if (value === undefined) {
        return blocked(
          PLAN_BLOCKER_REASONS.MissingInformation,
          `I need a value for the ${PROPERTY_LABELS[property].label}.`,
          [`Try "set this wall’s ${PROPERTY_LABELS[property].label} to 0.3 m".`]
        );
      }

      const target = knowledge.resolveTarget(intent.target);
      if (target.walls.length === 0) {
        return blocked(
          PLAN_BLOCKER_REASONS.Ambiguous,
          'I do not know which wall to change — no wall is selected.',
          ['Select one or more walls in the plan, then ask again.']
        );
      }

      const steps: PlanStep[] = [];
      const skipped: string[] = [];
      for (const wall of target.walls) {
        const object = knowledge.buildingObjectForEntity(wall.id);
        if (object === undefined) {
          skipped.push(`\`${wall.id}\` is not part of the Building Model`);
          continue;
        }

        const editable = knowledge
          .editableProperties(object.id)
          .find((candidate) => candidate.key === property);
        if (editable === undefined) {
          skipped.push(`\`${wall.id}\` does not expose ${property} as editable`);
          continue;
        }

        const outOfRange = rangeProblem(editable, value);
        if (outOfRange !== undefined) {
          return blocked(PLAN_BLOCKER_REASONS.MissingInformation, outOfRange, [
            'Give me a value inside that range and I will propose the change.'
          ]);
        }

        steps.push(setPropertyStep(wall, object.id, editable.group, property, value, knowledge));
      }

      if (steps.length === 0) {
        return blocked(
          PLAN_BLOCKER_REASONS.Unsupported,
          `None of the selected walls can have their ${PROPERTY_LABELS[property].label} changed: ${skipped.join('; ')}.`,
          ['The Inspector panel shows exactly which properties are editable on a given object.']
        );
      }

      return planned({
        intent,
        title: `Set wall ${PROPERTY_LABELS[property].label}`,
        reasoning: `The Inspector publishes ${property} as an editable property on a wall, with bounds it validates against. Setting it through the Inspector's own request means this edit is validated and recorded exactly as if it had been typed into the panel.`,
        assumptions: [
          `"${intent.utterance}" applies to the ${steps.length === 1 ? 'selected wall' : `${steps.length} selected walls`}.`,
          ...(property === 'loadBearing'
            ? []
            : ['The value is in metres, the unit the Inspector uses for wall dimensions.'])
        ],
        expectedOutcome: `${steps.length === 1 ? 'The selected wall has' : `All ${steps.length} selected walls have`} a ${PROPERTY_LABELS[property].label} of ${formatValue(property, value)}.`,
        steps,
        risk: PROPOSAL_RISKS.Safe,
        warnings: skipped.length === 0 ? [] : [`Skipped: ${skipped.join('; ')}.`]
      });
    }
  };
}

function setPropertyStep(
  wall: WallDto,
  objectId: string,
  group: string,
  key: string,
  value: unknown,
  knowledge: BuildingKnowledge
): PlanStep {
  return {
    description: `Set ${PROPERTY_LABELS[key]?.label ?? key} of wall \`${wall.id}\` to ${formatValue(key, value)}.`,
    request: setPropertyRequest({
      objectId,
      group,
      key,
      value: value as string | number | boolean | null,
      label: 'Set Wall Property'
    }),
    affects: [affectedWall(wall, `${key} → ${formatValue(key, value)}`, knowledge)],
    highlightedEntityIds: [wall.id]
  };
}

/**
 * The Inspector's own bounds, quoted back when a value falls outside them.
 * Returns `undefined` when the value is acceptable, or when the property
 * declares no bounds to check against.
 */
function rangeProblem(editable: EditableProperty, value: unknown): string | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }
  const { min, max } = editable.descriptor.definition;
  if (min !== undefined && value < min) {
    return `${value} is below the smallest ${editable.key} the Inspector accepts (${min}).`;
  }
  if (max !== undefined && value > max) {
    return `${value} is above the largest ${editable.key} the Inspector accepts (${max}).`;
  }
  return undefined;
}
