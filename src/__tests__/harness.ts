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
  GET_WALL_TOPOLOGY_QUERY_TYPE,
  type CommandDispatcher,
  type CommandRequest,
  type OpeningDto,
  type ProjectStructureDto,
  type Query,
  type QueryDispatcher,
  type RoomDto,
  type SelectionDto,
  type WallDto
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
    start,
    end,
    thickness: 0.2,
    height: 2.5,
    length,
    wallType: 'partition',
    loadBearing: false,
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
        height: 2.7
      }
    ],
    walls,
    rooms,
    openings
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
      GET_WALL_TOPOLOGY_QUERY_TYPE
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
    knowledge: new BuildingKnowledge({ queries, building, spatial, inspector }),
    building,
    spatial,
    inspector,
    queries,
    executed,
    refresh
  };
}
