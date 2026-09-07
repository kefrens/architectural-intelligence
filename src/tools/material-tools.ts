/**
 * The material tools (Sprint 061.4, ADR-0062 Rule 1, ADR-0063 Rule 8).
 *
 * ADR-0062 Rule 1 has always said that a click in the Materials panel, an edit
 * in the property sidebar, an MCP call and **an approved AI proposal** are the
 * same edit on the same history. Three of those four were real. These are the
 * fourth: until now nothing here mentioned materials, so no model could ask for
 * one, and the rule described a capability of the boundary rather than of the
 * product.
 *
 * ## They return a Request, not a plan
 *
 * The four architectural tools build an `ArchitecturalIntent` and run it
 * through `interpretIntent`, because a `moveRoom` is several Requests carrying
 * reasoning, assumptions, affected elements and a risk level no caller could
 * reconstruct. A material assignment is none of that: one Request, no
 * alternatives to weigh, no clearance to check, no geometry to re-solve.
 * Routing it through the planner would add a stage that decides nothing and a
 * second place a material proposal could be built differently — the divergence
 * "one pipeline, two front doors" exists to prevent.
 *
 * ## What the model is trusted with, and what it is not
 *
 * It names **a material**, by an id it read in the context fragment. It does
 * not name a wall, a side, or a level:
 *
 * - **Which faces are outward** is derived from the rooms the application
 *   detects (ADR-0063), and a model asked to work it out would be confidently
 *   wrong on exactly the walls finding I-94 is about.
 * - **A level** it could not name if it wanted to — the context fragment
 *   publishes `activeFloorId` and `floorCount`, and no level *names*. Echoing
 *   an id back is what `architectural-tools.ts` already refuses for rooms: it
 *   "would fail exactly when the id is the thing it hallucinated".
 *
 * So the façade tool takes one argument, and the storey it paints is the one
 * the interface's own bulk action paints (Sprint 061.3).
 */

import {
  ASSIGN_BUILDING_MATERIAL_REQUEST_TYPE,
  assignBuildingMaterialRequest,
  type BuildingMaterialTargetDto
} from '@archisimple/automation-api';
import { PROPOSAL_RISKS, type ResolvedToolCall, type ToolDefinition } from '@archisimple/ai-engine';
import type { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';

/** Every Automation type these tools' output consists of. */
const MATERIAL_REQUIRES = [ASSIGN_BUILDING_MATERIAL_REQUEST_TYPE] as const;

export const MATERIAL_TOOL_NAMES = {
  assignToSelection: 'material_assignToSelection',
  assignFacade: 'material_assignFacade'
} as const;

const MATERIAL_ARGUMENT = {
  type: 'string',
  description:
    'The material id, exactly as it appears in the project context (for example "brick-red-01"). Never invent one.'
} as const;

/**
 * The material a model named, or a refusal saying what exists.
 *
 * `blocked` rather than `undefined`: asking for a material by a name it
 * half-remembers makes perfect sense, and the message is what a model uses to
 * correct itself. And rather than a Request the boundary would refuse — every
 * target kind during the Material System was refused *by name* on the way in,
 * and a model deserves the same courtesy.
 */
function resolveMaterial(
  intelligence: ArchitecturalIntelligenceService,
  args: Record<string, unknown>
): { readonly id: string; readonly name: string } | ResolvedToolCall {
  const asked = args['buildingMaterialId'];
  const available = intelligence.buildingKnowledge().materials();
  const match =
    typeof asked === 'string'
      ? available.find((material) => material.id === asked.trim())
      : undefined;
  if (match !== undefined) return { id: match.id, name: match.name };

  return {
    kind: 'blocked',
    message:
      available.length === 0
        ? 'This project has no material library available, so nothing can be applied.'
        : `There is no material with the id "${String(asked)}". Available ids: ${available
            .map((material) => material.id)
            .join(', ')}.`
  };
}

const isBlocked = (
  value: { readonly id: string; readonly name: string } | ResolvedToolCall
): value is ResolvedToolCall => 'kind' in value;

/**
 * How dangerous this assignment is, and therefore whether approval asks twice.
 *
 * `destructive` for more than one target, by that value's own definition:
 * "removes or replaces existing work, or changes many elements at once". A
 * façade does both. There is deliberately nothing between the two values —
 * `PROPOSAL_RISKS`' own comment refuses a scale, because "a scale would invite
 * providers to pick a middle value that no consumer knows what to do with".
 */
const riskFor = (targets: readonly BuildingMaterialTargetDto[]) =>
  targets.length > 1 ? PROPOSAL_RISKS.Destructive : PROPOSAL_RISKS.Safe;

/** The walls a proposal would repaint, so the viewports can mark them. */
const highlighted = (targets: readonly BuildingMaterialTargetDto[]): readonly string[] => [
  ...new Set(targets.map((target) => target.id))
];

function assignmentCall(
  description: string,
  targets: readonly BuildingMaterialTargetDto[],
  buildingMaterialId: string
): ResolvedToolCall {
  return {
    kind: 'request',
    description,
    request: assignBuildingMaterialRequest({ targets, buildingMaterialId }),
    highlightedEntityIds: highlighted(targets),
    risk: riskFor(targets)
  };
}

/**
 * Applies a material to what the user has selected.
 *
 * No `side`: the selection is what it is, and an absent side means both faces
 * of a wall as one undo entry — which is what "paint this wall" means. Choosing
 * one face is a thing a user does by clicking it, not a thing a model guesses.
 */
export function createAssignMaterialToolDefinition(
  intelligence: ArchitecturalIntelligenceService
): ToolDefinition {
  return {
    requires: [...MATERIAL_REQUIRES],
    schema: {
      type: 'function',
      function: {
        name: MATERIAL_TOOL_NAMES.assignToSelection,
        description:
          'Applies a building material to whatever the user currently has selected — a wall, a floor or a roof. Call this when the user asks to make the selected thing out of a material. The material must be one of the ids listed in the project context.',
        parameters: {
          type: 'object',
          properties: { buildingMaterialId: MATERIAL_ARGUMENT },
          required: ['buildingMaterialId']
        }
      }
    },
    resolve: (args): ResolvedToolCall => {
      const material = resolveMaterial(intelligence, args);
      if (isBlocked(material)) return material;

      const selection = intelligence.buildingKnowledge().selection();
      const entity = selection.entities[0];
      if (entity === undefined || selection.count === 0) {
        return {
          kind: 'blocked',
          message: 'Nothing is selected, so there is nothing to apply a material to.'
        };
      }
      if (entity.type !== 'Wall' && entity.type !== 'Surface' && entity.type !== 'Roof') {
        // Assets are excluded deliberately and visibly (ADR-0062 Rule 2).
        return {
          kind: 'blocked',
          message: `A ${entity.type} cannot be given a building material. Select a wall, a floor or a roof.`
        };
      }

      return assignmentCall(
        `Apply ${material.name} to the selected ${entity.type.toLowerCase()}`,
        [{ id: entity.id, type: entity.type }],
        material.id
      );
    }
  };
}

/**
 * Applies a material to every outward-facing wall face on the active storey.
 *
 * One argument, because everything else is derived: the faces from ADR-0063's
 * enclosure, the storey from the one the interface is drawing on.
 */
export function createAssignFacadeToolDefinition(
  intelligence: ArchitecturalIntelligenceService
): ToolDefinition {
  return {
    requires: [...MATERIAL_REQUIRES],
    schema: {
      type: 'function',
      function: {
        name: MATERIAL_TOOL_NAMES.assignFacade,
        description:
          'Applies a building material to every outward-facing wall face on the current storey — the façade. Call this when the user asks to make the outside, the exterior or the façade of the building out of a material. Takes only the material: which faces look outdoors is derived from the rooms, not from you.',
        parameters: {
          type: 'object',
          properties: { buildingMaterialId: MATERIAL_ARGUMENT },
          required: ['buildingMaterialId']
        }
      }
    },
    resolve: (args): ResolvedToolCall => {
      const material = resolveMaterial(intelligence, args);
      if (isBlocked(material)) return material;

      const targets = intelligence.buildingKnowledge().outwardFacingFaces();
      if (targets.length === 0) {
        // An empty Request would "succeed" having done nothing, which tells a
        // user less than saying why.
        return {
          kind: 'blocked',
          message:
            'No wall face on this storey looks outdoors — either there are no walls yet, or every wall separates two rooms.'
        };
      }

      return assignmentCall(
        `Apply ${material.name} to ${targets.length} outward-facing wall faces`,
        targets,
        material.id
      );
    }
  };
}

/** Both tools, in the order they are contributed. */
export function createMaterialToolDefinitions(
  intelligence: ArchitecturalIntelligenceService
): readonly ToolDefinition[] {
  return [
    createAssignMaterialToolDefinition(intelligence),
    createAssignFacadeToolDefinition(intelligence)
  ];
}
