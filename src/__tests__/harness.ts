/**
 * A project the whole layer can reason about.
 *
 * Deliberately built from the *real* Building, Spatial and Inspector services
 * rather than from stubs of them: this layer's entire claim is that it derives
 * everything from the existing Building Platform, and a test that stubbed those
 * services would prove only that the stubs agree with each other. What is faked
 * is exactly one thing — the `QueryDispatcher`, standing in for a document —
 * because faking that is the same as drawing a floor plan.
 *
 * The plan itself: two rooms side by side, sharing one wall.
 *
 * ```text
 *   (0,4000) ────────── (4000,4000) ────────── (8000,4000)
 *      │       Room 1        │       Room 2        │
 *      │                   shared                  │
 *   (0,0) ───────────── (4000,0) ───────────── (8000,0)
 * ```
 *
 * Coordinates are in millimetres, the document's own unit.
 */

import {
  EMPTY_SELECTION_DTO,
  GET_PROJECT_STRUCTURE_QUERY_TYPE,
  GET_SELECTION_QUERY_TYPE,
  GET_BUILDING_MATERIAL_CATALOGUE_QUERY_TYPE,
  GET_WALL_FACE_ENCLOSURE_QUERY_TYPE,
  GET_WALL_TOPOLOGY_QUERY_TYPE,
  GET_SITE_QUERY_TYPE,
  GET_SOLAR_DAY_QUERY_TYPE,
  GET_SUN_POSITION_QUERY_TYPE,
  type GetSolarDayQuery,
  type GetSunPositionQuery,
  type SiteDto,
  type SolarDayDto,
  type SunPositionDto,
  type CommandDispatcher,
  type CommandRequest,
  type OpeningDto,
  type ProjectStructureDto,
  type Query,
  type QueryDispatcher,
  type RoomDto,
  type SelectionDto,
  type BuildingMaterialDefinitionDto,
  type WallDto,
  type WallFaceEnclosuresDto
} from '@archisimple/automation-api';
import { BuildingService, createCoreBuildingProvider } from '@archisimple/building-model';
import { createBuildingInspectorProvider, InspectorService } from '@archisimple/inspector';
import {
  createCoreSpatialProvider,
  createSpatialBuildingProvider,
  createSpatialInspectorProvider,
  SpatialService
} from '@archisimple/spatial';
import { BuildingKnowledge } from '../understanding/building-knowledge.js';

export const LEVEL_ID = 'level-1';

/**
 * `MAIN_BUILDING_ID` in `@archisimple/core` (Sprint 083.4a, ADR-0096 Rule 2),
 * spelled out because this layer may not import core (ADR-0023 Rule 1).
 */
export const MAIN_BUILDING_ID = 'building-main';

/**
 * Fields `WallDto` requires in the platform **on disk** but not in the platform
 * **on npm**.
 *
 * This repository builds against two different versions of the same contract,
 * by design. Its own CI runs `npm ci` and resolves the platform from the
 * registry at `^0.2.0` — ADR-0030 Rule 4, and the thing that keeps "standalone"
 * a property of the repository rather than a description of someone's laptop.
 * The `~/Dev/IA` development workspace and both Docker images splice in the
 * platform's **source**, which is ahead of what has been published.
 *
 * `locationLine` and `shapeType` became required on `WallDto` when the platform
 * added `ResizeWallOperation` (archisimple `b8ba616`), after `0.2.0` went out.
 * `buildingMaterial` joined them in archisimple's Sprint 060.4 (ADR-0062 Rule 5,
 * contract `1.22.0`) — always present on a wall, unlike `RoomDto`'s optional one,
 * because a wall's material was never an assign-later concept. `roofJoin`
 * followed in Sprint 069.7 (contract `2.7.0`), required for the same reason:
 * every wall resolves to one, `'clip'` for a wall that never said. So the two
 * contracts genuinely disagree, and this fixture has to satisfy both until the
 * platform is released and the peer ranges here move with it (ADR-0030 Rule 8's
 * order).
 *
 * ## Why a spread of a named constant, and not a cast
 *
 * Writing these inline is an **excess property** error against the published
 * `WallDto`, which has neither field. Leaving them to `overrides` is a
 * **missing required property** error against the local one, because
 * `Partial<WallDto>` makes them optional. Both were checked, against both
 * contracts, with this repository's own `tsc`.
 *
 * A spread satisfies both: TypeScript does not excess-property-check properties
 * that arrive by spread, and the spread still supplies what the newer contract
 * requires.
 *
 * `as WallDto` would also compile against both — and would suppress the check
 * for **every** field, so the next required field added upstream would land here
 * silently and be discovered by a consumer instead. This tolerates exactly the
 * fields it names, and stays strict about everything else. That is the whole
 * reason it is a constant with a name rather than an assertion — `roofJoin`
 * arrived that way, as a cold `tsc -b` failure naming one field.
 *
 * **Delete this the moment the platform is published and the ranges here move.**
 * It is a bridge across a version gap, not a fixture default.
 */
const NEWER_CONTRACT_FIELDS = {
  // ADR-0051's default, and what every wall drawn before Sprint 048.1 was.
  locationLine: 'centre',
  // A wall with no arc.
  shapeType: 'linear',
  // What every wall resolves to with nothing assigned — the platform's
  // `DEFAULT_BUILDING_MATERIAL_ID`, spelled out rather than imported because
  // `@archisimple/materials` is not a peer of this repository and does not
  // exist in the published `0.2.0` at all.
  buildingMaterial: {
    left: { buildingMaterialId: 'default' },
    right: { buildingMaterialId: 'default' }
  },
  // What a wall that never said resolves to (Sprint 069.7). `gableEnd` stays
  // absent on purpose: it is optional upstream, and saying nothing is not the
  // same as saying `'eave'` — the roof's kind derives one.
  roofJoin: 'clip'
} as const;

/**
 * The same bridge, for `ProjectStructureDto`.
 *
 * `roofs` became required in archisimple's Sprint 060.5 (ADR-0062 Rule 2,
 * contract `1.23.0`), which introduced the `Roof` entity, and `slabs` in Sprint
 * 068.0 (ADR-0066 Rules 1-2, contract `1.29.0`), which introduced the `Slab`.
 * Nothing in this layer reads either yet, so empty lists are the whole fixture;
 * they exist only so the structure literal satisfies the newer contract. Same
 * spread-not-cast reasoning as {@link NEWER_CONTRACT_FIELDS}, and the same
 * instruction: delete it when the ranges here move.
 *
 * `buildings` joined them in Sprint 083.4a (ADR-0096 Rules 1-2), and unlike the
 * other two it cannot be an empty list: every `LevelDto` now names a resolved
 * `buildingId`, and Rule 1 requires it be one of these ids. So the fixture
 * carries the one main building the single storey belongs to. `'building-main'`
 * is spelled out rather than imported for the same reason
 * `DEFAULT_BUILDING_MATERIAL_ID` is: it is `MAIN_BUILDING_ID` in
 * `@archisimple/core`, which this layer may not import (ADR-0023 Rule 1).
 * `main` repeats `id === 'building-main'` because a consumer above the boundary
 * cannot reach that constant to compare.
 *
 * Both are the same lesson about the split (ADR-0030): a field the platform adds
 * to a **published** DTO is additive for whoever *reads* one and breaking for
 * whoever *constructs* one — and this layer's fixtures construct. The platform's
 * own contract note for 1.29.0 says "all additive", which was true of every
 * consumer it could see.
 */
const NEWER_STRUCTURE_FIELDS = {
  roofs: [],
  slabs: [],
  buildings: [{ id: MAIN_BUILDING_ID, main: true, groundLevelId: LEVEL_ID }]
} as const;

/**
 * A wall's ends under **both** contracts: `start` / `end` as the published `0.2.0` has them, and
 * the reference line and derived centreline that replaced them in contract 3.0.0 (archisimple
 * Sprint 088.9). A `centre` wall's reference is its centreline, so one pair serves all of them.
 * A spread, for the reason {@link NEWER_CONTRACT_FIELDS} gives: no excess-property error
 * against the newer type, no missing-property error against it either. Delete the `start` /
 * `end` half when the ranges here move.
 */
function wallEnds(start: { x: number; y: number }, end: { x: number; y: number }) {
  return {
    start,
    end,
    referenceStart: start,
    referenceEnd: end,
    centreline: { start, end }
  };
}

/** One wall, with the fields `WallDto` requires and sensible defaults for the rest. */
export function wall(
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  overrides: Partial<WallDto> = {}
): WallDto {
  const length = Math.hypot(end.x - start.x, end.y - start.y) / 1000;
  return {
    id,
    type: 'Wall',
    levelId: LEVEL_ID,
    ...wallEnds(start, end),
    thickness: 0.2,
    height: 2.5,
    length,
    wallType: 'partition',
    loadBearing: false,
    ...NEWER_CONTRACT_FIELDS,
    ...overrides
  };
}

export const WALLS: readonly WallDto[] = [
  // Room 1 — the left square.
  wall('w-left', { x: 0, y: 0 }, { x: 0, y: 4000 }, { loadBearing: true, wallType: 'loadBearing' }),
  wall('w-top-1', { x: 0, y: 4000 }, { x: 4000, y: 4000 }),
  wall('w-bottom-1', { x: 0, y: 0 }, { x: 4000, y: 0 }),
  // The wall both rooms share.
  wall('w-shared', { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { loadBearing: true }),
  // Room 2 — the right square.
  wall('w-top-2', { x: 4000, y: 4000 }, { x: 8000, y: 4000 }),
  wall('w-bottom-2', { x: 4000, y: 0 }, { x: 8000, y: 0 }),
  wall('w-right', { x: 8000, y: 0 }, { x: 8000, y: 4000 })
];

export const ROOMS: readonly RoomDto[] = [
  {
    id: 'surface-1',
    type: 'Surface',
    levelId: LEVEL_ID,
    boundary: [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 4000 },
      { x: 0, y: 4000 }
    ],
    area: 16,
    origin: 'detected',
    wallIds: ['w-left', 'w-bottom-1', 'w-shared', 'w-top-1'],
    name: 'Kitchen'
  },
  {
    id: 'surface-2',
    type: 'Surface',
    levelId: LEVEL_ID,
    boundary: [
      { x: 4000, y: 0 },
      { x: 8000, y: 0 },
      { x: 8000, y: 4000 },
      { x: 4000, y: 4000 }
    ],
    area: 16,
    origin: 'detected',
    wallIds: ['w-shared', 'w-bottom-2', 'w-right', 'w-top-2']
  }
];

export const OPENINGS: readonly OpeningDto[] = [
  { id: 'window-1', type: 'Window', levelId: LEVEL_ID, position: { x: 0, y: 2000 } }
];

export interface HarnessOptions {
  readonly walls?: readonly WallDto[];
  readonly rooms?: readonly RoomDto[];
  readonly openings?: readonly OpeningDto[];
  /** Entity ids to report as selected. */
  readonly selectedIds?: readonly string[];
  /** The material catalogue a model names an id from (Sprint 061.4). */
  readonly materials?: readonly BuildingMaterialDefinitionDto[];
  /** Each wall's two faces, for the façade tool (Sprint 061.4, ADR-0063). */
  readonly wallFaceEnclosure?: readonly WallFaceEnclosuresDto[];
  /**
   * The Site and its sun (Sprint 1.13). Default: no place, so no sun — the
   * answer a headless host gives. A test that asks about the sun supplies the
   * platform's answers (recorded DTOs).
   */
  readonly site?: SiteDto;
  readonly sunPosition?: (query: GetSunPositionQuery) => SunPositionDto;
  readonly solarDay?: (query: GetSolarDayQuery) => SolarDayDto;
  /** The present, for a sun question with no moment (Sprint 1.13, DEC-5). */
  readonly now?: () => number;
}

export interface Harness {
  readonly knowledge: BuildingKnowledge;
  readonly building: BuildingService;
  readonly spatial: SpatialService;
  readonly inspector: InspectorService;
  readonly queries: QueryDispatcher;
  /** Every request a caller dispatched — nothing in this layer should ever add to it. */
  readonly executed: CommandRequest<unknown>[];
  /** Re-derives the Building and Spatial models, as `App.tsx` does per render. */
  refresh(): void;
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const walls = options.walls ?? WALLS;
  const rooms = options.rooms ?? ROOMS;
  const openings = options.openings ?? OPENINGS;
  const selectedIds = options.selectedIds ?? [];

  const materials = options.materials ?? [];
  const wallFaceEnclosure = options.wallFaceEnclosure ?? [];
  const site: SiteDto = options.site ?? {};
  const notLocated = { available: false, reason: 'not-located' } as const;
  const sunPosition = options.sunPosition ?? ((): SunPositionDto => notLocated);
  const solarDay = options.solarDay ?? ((): SolarDayDto => notLocated);

  const structure: ProjectStructureDto = {
    project: { id: 'project-1', type: 'Project', name: 'Test House' },
    levels: [
      {
        id: LEVEL_ID,
        type: 'Level',
        projectId: 'project-1',
        name: 'Ground Floor',
        // Required since the platform's Sprint 045.2 (ADR-0045 Rule 1):
        // `elevation` is the ordering, and `height` is floor-to-floor. The
        // ground floor sits on the datum, which is what makes it the ground floor.
        elevation: 0,
        height: 2.7,
        // Required since the platform's Sprint 083.4a (ADR-0096 Rule 1), and
        // always resolved: a storey that names no building belongs to the main
        // one. The id must be one of `structure.buildings`', which is why
        // NEWER_STRUCTURE_FIELDS carries that building rather than an empty list.
        buildingId: MAIN_BUILDING_ID
      }
    ],
    walls,
    rooms,
    openings,
    ...NEWER_STRUCTURE_FIELDS
  };

  const selection: SelectionDto =
    selectedIds.length === 0
      ? EMPTY_SELECTION_DTO
      : {
          entities: selectedIds.map((id) => ({
            id,
            type: walls.some((candidate) => candidate.id === id) ? 'Wall' : 'Surface'
          })),
          count: selectedIds.length,
          types: [
            ...new Set(
              selectedIds.map((id) => (walls.some((w) => w.id === id) ? 'Wall' : 'Surface'))
            )
          ],
          isEmpty: false
        };

  const queries: QueryDispatcher = {
    execute: (<TResult>(query: Query<TResult>): TResult => {
      switch (query.type) {
        case GET_PROJECT_STRUCTURE_QUERY_TYPE:
          return structure as unknown as TResult;
        case GET_SELECTION_QUERY_TYPE:
          return selection as unknown as TResult;
        case GET_WALL_TOPOLOGY_QUERY_TYPE:
          return [] as unknown as TResult;
        // Sprint 061.4. The catalogue a model names a material from, and the
        // faces a façade assignment paints. Both default to empty, which is
        // the same answer a headless host gives, so a test that cares supplies
        // its own.
        case GET_BUILDING_MATERIAL_CATALOGUE_QUERY_TYPE:
          return materials as unknown as TResult;
        case GET_WALL_FACE_ENCLOSURE_QUERY_TYPE:
          return wallFaceEnclosure as unknown as TResult;
        // Sprint 1.13: the sun, and the Site it needs.
        case GET_SITE_QUERY_TYPE:
          return site as unknown as TResult;
        case GET_SUN_POSITION_QUERY_TYPE:
          return sunPosition(query as unknown as GetSunPositionQuery) as unknown as TResult;
        case GET_SOLAR_DAY_QUERY_TYPE:
          return solarDay(query as unknown as GetSolarDayQuery) as unknown as TResult;
        default:
          throw new Error(`The harness does not answer "${query.type}".`);
      }
    }) as QueryDispatcher['execute'],
    register: () => undefined,
    unregister: () => false,
    canHandle: () => true,
    registeredTypes: () => [
      GET_PROJECT_STRUCTURE_QUERY_TYPE,
      GET_SELECTION_QUERY_TYPE,
      GET_WALL_TOPOLOGY_QUERY_TYPE,
      GET_BUILDING_MATERIAL_CATALOGUE_QUERY_TYPE,
      GET_WALL_FACE_ENCLOSURE_QUERY_TYPE,
      GET_SITE_QUERY_TYPE,
      GET_SUN_POSITION_QUERY_TYPE,
      GET_SOLAR_DAY_QUERY_TYPE
    ]
  };

  const executed: CommandRequest<unknown>[] = [];
  const commands: CommandDispatcher = {
    execute: (<TResult>(request: CommandRequest<TResult>): TResult => {
      executed.push(request as CommandRequest<unknown>);
      return true as unknown as TResult;
    }) as CommandDispatcher['execute'],
    register: () => undefined,
    unregister: () => false,
    canHandle: () => true,
    registeredTypes: () => [],
    canUndo: () => false,
    canRedo: () => false,
    undo: () => undefined,
    redo: () => undefined,
    clearHistory: () => undefined
  };

  const spatial = new SpatialService({ context: { queries } });
  spatial.registerProvider(createCoreSpatialProvider());

  const building = new BuildingService({ context: { queries } });
  building.registerProvider(createCoreBuildingProvider({ includeRooms: false }));
  building.registerProvider(createSpatialBuildingProvider(spatial));

  const inspector = new InspectorService({ context: { queries, commands, building } });
  inspector.registerProvider(createBuildingInspectorProvider());
  inspector.registerProvider(createSpatialInspectorProvider(spatial));

  const refresh = (): void => {
    spatial.refresh();
    building.refresh();
  };
  refresh();

  return {
    knowledge: new BuildingKnowledge({
      queries,
      building,
      spatial,
      inspector,
      ...(options.now === undefined ? {} : { now: options.now })
    }),
    building,
    spatial,
    inspector,
    queries,
    executed,
    refresh
  };
}
