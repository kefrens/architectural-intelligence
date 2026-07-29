/**
 * Building Knowledge (Sprint 24.5, Epic 2).
 *
 * What the Architectural Intelligence layer knows about the project — which is
 * to say: nothing of its own. Every method here is a delegation to a platform
 * service that already owns the answer, phrased as the question the reasoning
 * layer actually has.
 *
 * ```text
 * Building Knowledge   <- you are here: a facade, no state
 *   |  BuildingService     concepts and relationships
 *   |  SpatialService      rooms, areas, adjacency
 *   |  InspectorService    what can be edited, and within what bounds
 *   +->QueryDispatcher     the document, through the Automation API
 * ```
 *
 * ## Why a facade rather than a model
 *
 * ADR-0024 Rule 2 and this sprint's own Definition of Done both say it: **no
 * duplicated semantic model.** Nothing here caches, indexes or reshapes. Every
 * call reads through on demand, so a reading taken before an approved proposal
 * and one taken after cannot disagree, and there is no refresh lifecycle to get
 * wrong. The cost — a `GetProjectStructureQuery` per call rather than per turn
 * — is the same trade `App.tsx` already makes by refreshing the Building and
 * Spatial services on every render.
 *
 * ## Why it never searches text
 *
 * Story 24.5.4 is explicit: "No text search." Resolving "the kitchen" walks the
 * Spatial Model's rooms and compares their names — the same names the
 * Navigation panel shows and the Inspector edits. There is no index, no
 * document scan, and no second naming vocabulary.
 */

import {
  getProjectStructureQuery,
  getSelectionQuery,
  type OpeningDto,
  type ProjectStructureDto,
  type QueryDispatcher,
  type SelectionDto,
  type WallDto
} from '@archisimple/automation-api';
import {
  BUILDING_OBJECT_KINDS,
  type BuildingObject,
  type BuildingService
} from '@archisimple/building-model';
import { isEditable, type InspectorService, type PropertyDescriptor } from '@archisimple/inspector';
import { roomBuildingObjectId, type SpatialRoom, type SpatialService } from '@archisimple/spatial';
import type { IntentTarget } from '../intent/architectural-intent';
import { INTENT_TARGET_KINDS } from '../intent/architectural-intent';

export interface BuildingKnowledgeOptions {
  readonly queries: QueryDispatcher;
  readonly building: BuildingService;
  readonly spatial: SpatialService;
  /** Optional: without it, `editableProperties` answers empty and property edits are unplannable. */
  readonly inspector?: InspectorService;
}

/** One editable property, flattened with the section it belongs to. */
export interface EditableProperty {
  readonly group: string;
  readonly key: string;
  readonly descriptor: PropertyDescriptor;
}

/**
 * What an {@link IntentTarget} turned out to point at.
 *
 * All three collections can be populated at once — "delete these" with a room
 * and two walls selected is a legitimate, if broad, request — and all three
 * empty is the interesting case: it is what makes "I know what you meant but
 * there is nothing to do it to" answerable (Story 24.5.11).
 */
export interface ResolvedTarget {
  readonly rooms: readonly SpatialRoom[];
  readonly walls: readonly WallDto[];
  /** Runtime entity ids the target names directly, including ones that are neither room nor wall. */
  readonly entityIds: readonly string[];
  /** The name the request used, when it named one that matched nothing. */
  readonly unresolvedName?: string;
}

export const EMPTY_RESOLVED_TARGET: ResolvedTarget = { rooms: [], walls: [], entityIds: [] };

/** The document's internal length unit, against the one measurements are reported in. */
const MILLIMETRES_PER_METRE = 1000;
const SQUARE_MILLIMETRES_PER_SQUARE_METRE = MILLIMETRES_PER_METRE * MILLIMETRES_PER_METRE;

export class BuildingKnowledge {
  private readonly queries: QueryDispatcher;
  private readonly building: BuildingService;
  private readonly spatial: SpatialService;
  private readonly inspector: InspectorService | undefined;

  constructor(options: BuildingKnowledgeOptions) {
    this.queries = options.queries;
    this.building = options.building;
    this.spatial = options.spatial;
    this.inspector = options.inspector;
  }

  // --- The document, through the Automation API -------------------------------

  structure(): ProjectStructureDto {
    return this.queries.execute(getProjectStructureQuery());
  }

  selection(): SelectionDto {
    return this.queries.execute(getSelectionQuery());
  }

  walls(): readonly WallDto[] {
    return this.structure().walls;
  }

  wall(entityId: string): WallDto | undefined {
    return this.structure().walls.find((candidate) => candidate.id === entityId);
  }

  loadBearingWalls(): readonly WallDto[] {
    return this.structure().walls.filter((wall) => wall.loadBearing);
  }

  openings(): readonly OpeningDto[] {
    return this.structure().openings;
  }

  /**
   * The level new geometry belongs on.
   *
   * The Building Model derives a Floor for every level id geometry actually
   * references, so the first one is the level this project is drawn on. A
   * project with no geometry at all has none, and a caller has to say so rather
   * than invent one.
   */
  defaultLevelId(): string | undefined {
    return this.building.getObjectsByKind(BUILDING_OBJECT_KINDS.Floor)[0]?.sourceEntityId;
  }

  // --- Semantic concepts ------------------------------------------------------

  floors(): readonly BuildingObject[] {
    return this.building.getObjectsByKind(BUILDING_OBJECT_KINDS.Floor);
  }

  rooms(): readonly SpatialRoom[] {
    return this.spatial.getGraph().getRooms();
  }

  room(roomId: string): SpatialRoom | undefined {
    return this.spatial.getGraph().getRoom(roomId);
  }

  /**
   * A room's area in square metres.
   *
   * `SpatialRoom.area` is computed from the boundary polygon, and boundary
   * coordinates are in the document's internal unit — millimetres — even though
   * `WallDto.thickness` and friends are published in metres. (The same
   * mismatch is documented at length in `ai-engine`'s Demo Provider, which hits
   * it from the other direction when *writing* a wall.) A 4 m × 4 m room
   * therefore has an `area` of 16 000 000, and reporting that number followed by
   * "m²" would be simply false.
   *
   * The conversion lives here, once, rather than at each place a number is
   * rendered — and it is a named method rather than a field so no caller can
   * read an area without choosing a unit.
   */
  roomAreaSquareMetres(room: SpatialRoom): number {
    return room.area / SQUARE_MILLIMETRES_PER_SQUARE_METRE;
  }

  /** A room's perimeter in metres; see {@link roomAreaSquareMetres} for why this conversion exists. */
  roomPerimeterMetres(room: SpatialRoom): number {
    return room.perimeter / MILLIMETRES_PER_METRE;
  }

  /** Square metres across every detected room; `0` for a project with none. */
  totalFloorAreaSquareMetres(): number {
    return this.rooms().reduce((total, room) => total + this.roomAreaSquareMetres(room), 0);
  }

  /** The rooms sharing at least one boundary wall with this one (Story 24.5.5). */
  adjacentRooms(roomId: string): readonly SpatialRoom[] {
    const graph = this.spatial.getGraph();
    return graph
      .getAdjacenciesFor(roomId)
      .map((adjacency) => (adjacency.roomAId === roomId ? adjacency.roomBId : adjacency.roomAId))
      .map((neighbourId) => graph.getRoom(neighbourId))
      .filter((room): room is SpatialRoom => room !== undefined);
  }

  /** The Building Object a Runtime entity was derived from, if any. */
  buildingObjectForEntity(entityId: string): BuildingObject | undefined {
    return this.building.findObjectBySourceEntityId(entityId);
  }

  buildingObject(objectId: string): BuildingObject | undefined {
    return this.building.getObject(objectId);
  }

  /** The Building Object id a Spatial room is published under, so the Inspector can be asked about it. */
  roomObjectId(room: SpatialRoom): string {
    return roomBuildingObjectId(room.id);
  }

  // --- What can be changed ----------------------------------------------------

  /**
   * The properties an assistant could actually set on an object, with the
   * bounds the Inspector will validate against — the difference between a
   * proposal that applies and one that gets refused.
   */
  editableProperties(objectId: string): readonly EditableProperty[] {
    if (this.inspector === undefined) {
      return [];
    }
    return this.inspector.inspect(objectId).groups.flatMap((group) =>
      group.properties
        .filter((property) => isEditable(property.definition))
        .map((property) => ({
          group: group.id,
          key: property.definition.key,
          descriptor: property
        }))
    );
  }

  // --- Resolution -------------------------------------------------------------

  /**
   * Finds a room by the words a user used.
   *
   * Case- and whitespace-insensitive against the room's own name, then against
   * its generated `Room N` form so "room 2" works on a project where nothing
   * has been named yet.
   */
  findRoomByName(name: string): SpatialRoom | undefined {
    const wanted = normalise(name);
    return this.rooms().find((room) => normalise(room.name) === wanted);
  }

  /**
   * Turns an {@link IntentTarget} into the things it actually points at.
   *
   * A `selection` target reads the document's selection through the Automation
   * API — the same `GetSelectionQuery` the AI Workspace's own selection context
   * already uses (Story 24.5.2), rather than a second selection model.
   */
  resolveTarget(target: IntentTarget): ResolvedTarget {
    if (target.kind === INTENT_TARGET_KINDS.Named && target.name !== undefined) {
      const room = this.findRoomByName(target.name);
      if (room === undefined) {
        return { ...EMPTY_RESOLVED_TARGET, unresolvedName: target.name };
      }
      return { rooms: [room], walls: [], entityIds: [room.sourceEntityId] };
    }

    if (target.kind !== INTENT_TARGET_KINDS.Selection) {
      return EMPTY_RESOLVED_TARGET;
    }

    const entityIds = this.selection().entities.map((entity) => entity.id);
    const wallById = new Map(this.walls().map((wall) => [wall.id, wall]));
    const graph = this.spatial.getGraph();

    return {
      entityIds,
      walls: entityIds
        .map((id) => wallById.get(id))
        .filter((wall): wall is WallDto => wall !== undefined),
      rooms: entityIds
        .map((id) => graph.findRoomBySourceEntityId(id))
        .filter((room): room is SpatialRoom => room !== undefined)
    };
  }
}

function normalise(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
