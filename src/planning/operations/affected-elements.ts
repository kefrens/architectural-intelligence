/**
 * Naming what a plan step touches (Sprint 24.5, Stories 24.5.8 and 24.5.10).
 *
 * "Explanations reference Building Platform entities whenever possible." These
 * three helpers are how: every step describes its targets as Building Objects —
 * kind, name, and the Building Object id — with the Runtime entity id carried
 * alongside for the canvas rather than in place of the semantics.
 *
 * Shared by the built-in operation providers so a wall is described the same way
 * whether it is being moved, aligned or deleted.
 */

import type { ProposalAffectedElement } from '@archisimple/ai-engine';
import type { WallDto } from '@archisimple/automation-api';
import type { SpatialRoom } from '@archisimple/spatial';
import type { BuildingKnowledge } from '../../understanding/building-knowledge';

export function affectedRoom(
  room: SpatialRoom,
  change: string,
  knowledge: BuildingKnowledge
): ProposalAffectedElement {
  return {
    objectId: knowledge.roomObjectId(room),
    kind: 'Room',
    name: room.name,
    entityId: room.sourceEntityId,
    change
  };
}

export function affectedWall(
  wall: WallDto,
  change: string,
  knowledge: BuildingKnowledge
): ProposalAffectedElement {
  const object = knowledge.buildingObjectForEntity(wall.id);
  return {
    ...(object === undefined ? {} : { objectId: object.id }),
    kind: 'Wall',
    ...(object?.name === undefined ? {} : { name: object.name }),
    entityId: wall.id,
    change
  };
}

/**
 * A target that resolved to a Runtime entity the Building Model does not name —
 * an annotation, a dimension. Described by its published type rather than
 * dropped: a delete that would also remove a dimension has to say so.
 */
export function affectedEntity(
  entityId: string,
  change: string,
  knowledge: BuildingKnowledge
): ProposalAffectedElement {
  const object = knowledge.buildingObjectForEntity(entityId);
  return {
    ...(object === undefined ? {} : { objectId: object.id }),
    kind: object?.kind ?? 'Entity',
    ...(object?.name === undefined ? {} : { name: object.name }),
    entityId,
    change
  };
}
