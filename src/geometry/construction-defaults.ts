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
  /** The **structural opening** (baie), in metres — the hole in the wall. */
  readonly width: number;
  readonly height: number;
  /** Height of the opening's underside above the finished floor. */
  readonly sill: number;
  /**
   * The Library entry this specifies, where a standard product exists
   * (Sprint 1.11, ArchiSimple ADR-0038 Rule 6, ADR-0057 Rule 11).
   *
   * **A constant, not a catalogue read.** This stage already owns opening size
   * as an architectural decision — see this file's own header — and *which
   * standard door* is the same kind of decision. A *porte 83* is nameable from
   * architectural knowledge; it does not require knowing what any particular
   * machine has installed.
   *
   * A read port was considered and rejected: it would make the same Brief
   * produce different Specifications on two machines depending on which
   * libraries each user had imported, and an approved artefact is immutable
   * (ADR-0027.1 Rule 4). It would also be an eighth dependency.
   *
   * A hard-coded identifier is safe precisely because ADR-0038 Rule 2
   * guarantees an asset id is **stable across releases of its provider**. That
   * guarantee is what a reference like this is entitled to rely on.
   *
   * Absent for a passage: ArchiSimple ships no canonical cased opening, and
   * naming one that does not exist would be worse than naming none. An identity
   * the host cannot resolve costs the opening its drawing and nothing else
   * (ADR-0038 Rule 16), so an absent one is simply the state every opening was
   * in before this existed.
   */
  readonly assetDefinitionId?: string;
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
    // A *porte 83*: an 83 cm leaf in a 93 cm structural opening, which is the
    // standard for a main room in the NF P20-101 series.
    //
    // The width moved from 0.90 in Sprint 1.11, and the reason is not
    // cosmetic: **0.90 m corresponds to no leaf anybody can order.** The series
    // is 63/73/83/93 at the leaf, which with a standard bloc-porte huisserie
    // needs openings of 0.73/0.83/0.93/1.03. Specifying 0.90 specified a door
    // that does not exist.
    door: Object.freeze({
      width: 0.93,
      height: 2.1,
      sill: 0,
      assetDefinitionId: 'archisimple:door-single-leaf-83'
    }),
    // No identity: a cased opening has no leaf, and ArchiSimple's canonical
    // library ships no passage to name.
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
    // Names the product, not only the numbers (Sprint 1.11): a reviewer is
    // approving a *porte 83*, and "930 × 2.1" alone does not say so.
    `Doors are a standard 83 leaf in a ${mm(door.width)} × ${door.height} m opening, and cased openings ${mm(passage.width)} × ${passage.height} m, centred on the wall they cross.`,
    'No wall is marked load-bearing: that needs a structural model this stage does not have.',
    'There are no windows: the approved geometry records no opening in an external wall for one to be placed in.'
  ];
}

function mm(metres: number): string {
  return `${Math.round(metres * 1000)} mm`;
}
