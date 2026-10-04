/**
 * The material tools (Sprint 061.4, ADR-0062 Rule 1, ADR-0063 Rule 8).
 *
 * ADR-0062 Rule 1 says a click in the Materials panel, a sidebar edit, an MCP
 * call and **an approved AI proposal** are the same edit on the same history.
 * These tests are about the fourth of those becoming real — and about the two
 * things a model is deliberately not trusted with: **which faces look
 * outdoors**, and **which storey**.
 */

import { describe, expect, it } from 'vitest';
import {
  ASSIGN_BUILDING_MATERIAL_REQUEST_TYPE,
  type AssignBuildingMaterialRequest,
  type BuildingMaterialDefinitionDto,
  type WallFaceEnclosuresDto
} from '@archisimple/automation-api';

import { PROPOSAL_RISKS } from '@archisimple/ai-engine';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import {
  createAssignFacadeToolDefinition,
  createAssignMaterialToolDefinition
} from '../tools/material-tools.js';
import { createHarness, LEVEL_ID, WALLS } from './harness.js';

/** The Request these tools carry, read as itself rather than through a cast. */
const assignmentIn = (result: { readonly request?: unknown }): AssignBuildingMaterialRequest => {
  // A resolved step is a Request or an Operation (platform Sprint 052.0): these tools carry the former.
  if (result.request === undefined) throw new Error('expected a Request, not an Operation');
  return result.request as AssignBuildingMaterialRequest;
};

/** A tool's declared arguments, which `ToolFunctionSchema` types loosely. */
const argumentsOf = (schema: {
  readonly function: { readonly parameters: unknown };
}): { readonly properties: Record<string, unknown>; readonly required: readonly string[] } =>
  schema.function.parameters as {
    readonly properties: Record<string, unknown>;
    readonly required: readonly string[];
  };

const BRICK = 'brick-red-01';
const PLASTER = 'plaster-grey-01';

const CATALOGUE: readonly BuildingMaterialDefinitionDto[] = [
  { id: BRICK, name: 'Red Brick', category: 'brick' },
  { id: PLASTER, name: 'Grey Plaster', category: 'plaster' }
];

/** Every wall a façade, unless a case says otherwise. */
const allOutward = (): readonly WallFaceEnclosuresDto[] =>
  WALLS.map((wall) => ({ wallId: wall.id, left: 'enclosed', right: 'open' }));

function serviceWith(
  options: {
    readonly materials?: readonly BuildingMaterialDefinitionDto[];
    readonly wallFaceEnclosure?: readonly WallFaceEnclosuresDto[];
    readonly selectedIds?: readonly string[];
  } = {}
) {
  const harness = createHarness({
    materials: options.materials ?? CATALOGUE,
    ...(options.wallFaceEnclosure === undefined
      ? {}
      : { wallFaceEnclosure: options.wallFaceEnclosure }),
    ...(options.selectedIds === undefined ? {} : { selectedIds: options.selectedIds })
  });
  return {
    harness,
    intelligence: new ArchitecturalIntelligenceService({ knowledge: harness.knowledge })
  };
}

describe('what both tools refuse', () => {
  it('refuses a material id the catalogue does not have, and says what it does', () => {
    // `blocked`, not `undefined`: asking for a material by a half-remembered
    // name makes perfect sense, and the message is what a model corrects itself
    // from. And not a Request the boundary would refuse — every target kind in
    // the Material System was refused *by name* on the way in.
    const { intelligence } = serviceWith({ selectedIds: [WALLS[0]!.id] });
    const tool = createAssignMaterialToolDefinition(intelligence);

    const result = tool.resolve({ buildingMaterialId: 'no-such-material' }, {} as never);

    expect(result?.kind).toBe('blocked');
    expect(result?.kind === 'blocked' ? result.message : '').toContain(BRICK);
  });

  it('says so when the project has no library at all', () => {
    const { intelligence } = serviceWith({ materials: [], selectedIds: [WALLS[0]!.id] });
    const tool = createAssignMaterialToolDefinition(intelligence);

    const result = tool.resolve({ buildingMaterialId: BRICK }, {} as never);

    expect(result?.kind).toBe('blocked');
  });

  it('declares the one Automation type its output consists of', () => {
    // The broker offers a tool only when the host serves every type it names.
    const { intelligence } = serviceWith();
    for (const tool of [
      createAssignMaterialToolDefinition(intelligence),
      createAssignFacadeToolDefinition(intelligence)
    ]) {
      expect(tool.requires).toEqual([ASSIGN_BUILDING_MATERIAL_REQUEST_TYPE]);
    }
  });
});

describe('assigning to the selection', () => {
  it('carries a single Request, not a plan', () => {
    // A material assignment has no alternatives to weigh and no geometry to
    // re-solve, so routing it through the planner would add a stage that
    // decides nothing — and a second place a material proposal could be built.
    const { intelligence } = serviceWith({ selectedIds: [WALLS[0]!.id] });
    const tool = createAssignMaterialToolDefinition(intelligence);

    const result = tool.resolve({ buildingMaterialId: BRICK }, {} as never);

    expect(result?.kind).toBe('request');
    if (result?.kind !== 'request') return;
    expect(assignmentIn(result).type).toBe(ASSIGN_BUILDING_MATERIAL_REQUEST_TYPE);
    expect(assignmentIn(result)).toMatchObject({
      buildingMaterialId: BRICK,
      targets: [{ id: WALLS[0]!.id, type: 'Wall' }]
    });
  });

  it('names no side — painting "this wall" means both faces, as one undo entry', () => {
    // Choosing one face is something a user does by clicking it, not something
    // a model guesses. An absent `side` is what the contract already means by
    // "both faces, one undo entry".
    const { intelligence } = serviceWith({ selectedIds: [WALLS[0]!.id] });
    const result = createAssignMaterialToolDefinition(intelligence).resolve(
      { buildingMaterialId: BRICK },
      {} as never
    );

    if (result?.kind !== 'request') throw new Error('expected a request');
    expect(assignmentIn(result).targets[0]?.side).toBeUndefined();
  });

  it('is safe, and highlights what it would repaint', () => {
    const { intelligence } = serviceWith({ selectedIds: [WALLS[0]!.id] });
    const result = createAssignMaterialToolDefinition(intelligence).resolve(
      { buildingMaterialId: BRICK },
      {} as never
    );

    if (result?.kind !== 'request') throw new Error('expected a request');
    expect(result.risk).toBe(PROPOSAL_RISKS.Safe);
    expect(result.highlightedEntityIds).toEqual([WALLS[0]!.id]);
  });

  it('refuses when nothing is selected', () => {
    const { intelligence } = serviceWith();
    const result = createAssignMaterialToolDefinition(intelligence).resolve(
      { buildingMaterialId: BRICK },
      {} as never
    );

    expect(result?.kind).toBe('blocked');
  });
});

describe('assigning a façade', () => {
  it('takes only a material — no level, no wall, no side', () => {
    // The context fragment publishes `activeFloorId` and `floorCount` and no
    // level *names*, so a model has nothing to name a storey by; and echoing an
    // id back is what this layer already refuses for rooms.
    const { intelligence } = serviceWith({ wallFaceEnclosure: allOutward() });
    const args = argumentsOf(createAssignFacadeToolDefinition(intelligence).schema);

    expect(Object.keys(args.properties)).toEqual(['buildingMaterialId']);
    expect(args.required).toEqual(['buildingMaterialId']);
  });

  it('paints every outward face the derivation found, and no other', () => {
    const enclosure: readonly WallFaceEnclosuresDto[] = [
      { wallId: WALLS[0]!.id, left: 'enclosed', right: 'open' },
      { wallId: WALLS[1]!.id, left: 'enclosed', right: 'enclosed' }, // a partition
      { wallId: WALLS[2]!.id, left: 'open', right: 'open' } // free-standing
    ];
    const { intelligence } = serviceWith({ wallFaceEnclosure: enclosure });

    const result = createAssignFacadeToolDefinition(intelligence).resolve(
      { buildingMaterialId: BRICK },
      {} as never
    );

    if (result?.kind !== 'request') throw new Error('expected a request');
    expect(assignmentIn(result).targets).toEqual([
      { id: WALLS[0]!.id, type: 'Wall', side: 'right' },
      { id: WALLS[2]!.id, type: 'Wall', side: 'left' },
      { id: WALLS[2]!.id, type: 'Wall', side: 'right' }
    ]);
  });

  it('is destructive when it changes more than one thing, so approval asks twice', () => {
    // By that value's own definition: "removes or replaces existing work, or
    // changes many elements at once". There is nothing between the two values.
    const { intelligence } = serviceWith({ wallFaceEnclosure: allOutward() });
    const result = createAssignFacadeToolDefinition(intelligence).resolve(
      { buildingMaterialId: BRICK },
      {} as never
    );

    if (result?.kind !== 'request') throw new Error('expected a request');
    expect(result.risk).toBe(PROPOSAL_RISKS.Destructive);
    expect(result.highlightedEntityIds?.length).toBeGreaterThan(1);
  });

  it('refuses when no face looks outdoors, rather than succeeding at nothing', () => {
    // An empty Request would report success having done nothing, which tells a
    // user less than saying why.
    const { intelligence } = serviceWith({
      wallFaceEnclosure: WALLS.map((wall) => ({
        wallId: wall.id,
        left: 'enclosed' as const,
        right: 'enclosed' as const
      }))
    });

    const result = createAssignFacadeToolDefinition(intelligence).resolve(
      { buildingMaterialId: BRICK },
      {} as never
    );

    expect(result?.kind).toBe('blocked');
  });

  it('skips a face the derivation could not place', () => {
    const { intelligence } = serviceWith({
      wallFaceEnclosure: [{ wallId: WALLS[0]!.id, left: 'unresolved', right: 'open' }]
    });

    const result = createAssignFacadeToolDefinition(intelligence).resolve(
      { buildingMaterialId: BRICK },
      {} as never
    );

    if (result?.kind !== 'request') throw new Error('expected a request');
    expect(assignmentIn(result).targets).toEqual([
      { id: WALLS[0]!.id, type: 'Wall', side: 'right' }
    ]);
  });
});

describe('the catalogue reaches the model', () => {
  it('is published in the context fragment, so an id can be named rather than invented', () => {
    const { harness } = serviceWith();
    expect(harness.knowledge.materials().map((material) => material.id)).toEqual([BRICK, PLASTER]);
  });

  it('reads the faces for the storey the interface is drawing on', () => {
    const { harness } = serviceWith({ wallFaceEnclosure: allOutward() });
    expect(harness.knowledge.defaultLevelId()).toBe(LEVEL_ID);
    expect(harness.knowledge.outwardFacingFaces().length).toBe(WALLS.length);
  });
});

describe('nothing here executes', () => {
  it('dispatches no request while resolving a tool call', () => {
    // The layer proposes; `AiSessionController` is what runs. Its compliance
    // test asserts no `CommandDispatcher` in the sources; this asserts the
    // behaviour that rule exists for.
    const { harness, intelligence } = serviceWith({
      selectedIds: [WALLS[0]!.id],
      wallFaceEnclosure: allOutward()
    });

    createAssignMaterialToolDefinition(intelligence).resolve(
      { buildingMaterialId: BRICK },
      {} as never
    );
    createAssignFacadeToolDefinition(intelligence).resolve(
      { buildingMaterialId: PLASTER },
      {} as never
    );

    expect(harness.executed).toEqual([]);
  });
});
