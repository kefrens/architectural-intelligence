/**
 * Construction defaults (Sprint 1.1, Story 1.1.5).
 *
 * Every number the Geometry Specification needs and no earlier artefact states.
 * Thickness, height and opening size are **architectural decisions** and belong
 * to this repository (ADR-AI-0001 Rule 3) — but nothing upstream decides them
 * yet, so this stage decides them from a table and says so.
 *
 * ## One module, one shape, every value recorded
 *
 * The point of collecting them here rather than scattering literals through
 * synthesis is that the sprint which gives thickness a *knowledge model* —
 * construction type, load-bearing role, acoustic separation — replaces one
 * thing. Until then, `describeDefaults` turns the table into the sentences a
 * reviewer reads, so a user approving a Specification can see that 300 mm was
 * the platform's opinion rather than their requirement.
 *
 * That is the same honesty rule the Space Programme applies to areas
 * (`AREA_SOURCES`) and the Geometry Graph to storey heights.
 *
 * ## What is deliberately not decided here
 *
 * **Load-bearing.** A wall's role is external or internal; which walls carry
 * load needs a structural model this repository does not have, and guessing it
 * would be worse than declining it (Sprint 1.1, _Where the numbers come from_).
 */

/** What a wall is for. Thickness follows from it. */
export const WALL_ROLES = {
  /** On the building envelope. */
  External: 'external',
  /** Between two rooms. */
  Internal: 'internal'
} as const;

export type WallRole = (typeof WALL_ROLES)[keyof typeof WALL_ROLES];

/** What an opening is. The Geometry Graph names no kind, so this stage picks one. */
export const OPENING_KINDS = {
  Door: 'door',
  /** A cased opening rather than a door — how a room meets circulation. */
  Passage: 'passage'
} as const;

export type OpeningKind = (typeof OPENING_KINDS)[keyof typeof OPENING_KINDS];

export interface OpeningDefaults {
  readonly width: number;
  readonly height: number;
  /** Height of the opening's underside above the finished floor. */
  readonly sill: number;
}

export interface ConstructionDefaults {
  readonly externalWallThickness: number;
  readonly internalWallThickness: number;
  /** Floor to floor. The Geometry Graph's storey elevations already assume it. */
  readonly storeyHeight: number;
  /** Structure and finishes between floors; wall height is what is left. */
  readonly floorAssembly: number;
  readonly opening: Readonly<Record<OpeningKind, OpeningDefaults>>;
}

/**
 * The table.
 *
 * A 300 mm external wall and a 100 mm internal one are ordinary European
 * masonry-and-insulation figures. They are not derived from anything the user
 * said, which is precisely why every one of them appears in `assumptions`.
 */
export const DEFAULT_CONSTRUCTION: ConstructionDefaults = Object.freeze({
  externalWallThickness: 0.3,
  internalWallThickness: 0.1,
  // Matches the Geometry Graph's own `FLOOR_TO_FLOOR`, deliberately: two stages
  // disagreeing about storey height would put a wall through a floor.
  storeyHeight: 3,
  floorAssembly: 0.25,
  opening: Object.freeze({
    door: Object.freeze({ width: 0.9, height: 2.1, sill: 0 }),
    passage: Object.freeze({ width: 1.2, height: 2.1, sill: 0 })
  })
});

/** Clear height of a wall: floor to floor, less the floor above it. */
export function wallHeight(defaults: ConstructionDefaults): number {
  return defaults.storeyHeight - defaults.floorAssembly;
}

export function thicknessFor(role: WallRole, defaults: ConstructionDefaults): number {
  return role === WALL_ROLES.External
    ? defaults.externalWallThickness
    : defaults.internalWallThickness;
}

/**
 * The table as the sentences a reviewer reads.
 *
 * Listed in the order they matter to somebody looking at a plan: what the walls
 * are, how tall, what the openings are, and what is missing.
 */
export function describeDefaults(defaults: ConstructionDefaults): readonly string[] {
  const door = defaults.opening.door;
  const passage = defaults.opening.passage;

  return [
    `External walls are ${mm(defaults.externalWallThickness)} thick and internal walls ${mm(defaults.internalWallThickness)}; nothing in the brief states a construction type.`,
    `Walls are ${defaults.storeyHeight - defaults.floorAssembly} m clear, from a ${defaults.storeyHeight} m floor-to-floor height less a ${mm(defaults.floorAssembly)} floor.`,
    `Doors are ${mm(door.width)} × ${door.height} m and cased openings ${mm(passage.width)} × ${passage.height} m, centred on the wall they cross.`,
    'No wall is marked load-bearing: that needs a structural model this stage does not have.',
    'There are no windows: the approved geometry records no opening in an external wall for one to be placed in.'
  ];
}

function mm(metres: number): string {
  return `${Math.round(metres * 1000)} mm`;
}
