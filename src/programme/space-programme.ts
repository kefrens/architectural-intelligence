/**
 * The Space Programme (Sprint 27.9, Epics 1 and 2 — ADR-0027.1's second
 * planning artefact).
 *
 * The logical building: which spaces exist, how large each should be, which
 * belong together, and which matter most. It is what a layout planner reads
 * instead of a conversation.
 *
 * ## The line against the Brief above it
 *
 * A Brief says "three bedrooms". A Programme says "three bedrooms of 12 m²
 * each, adjacent to a bathroom, in the night zone". The Brief holds no areas at
 * all (Rule 3), and this is where numbers first appear — which is why every one
 * of them is attributed: {@link ProgrammeSpace.areaSource} says whether an area
 * came from a total the user stated or from the platform's own table, and the
 * artefact's `assumptions` say the same thing in prose. A programme may
 * *propose* 96 m²; it must never claim the user asked for it.
 *
 * ## The line against the Layout below it
 *
 * No coordinates, no dimensions, no ordering that implies a position. The
 * adjacency here is **intended** — "these two should be near each other" — and
 * is a different thing from `SpatialService`'s measured `RoomAdjacency`, which
 * is computed from walls that exist (Rule 11). Neither is derived from the
 * other; comparing them is how divergence will later be detected, and that
 * comparison means nothing if one was built from the other.
 *
 * The Layout Plan (Sprint 28.0) *resolves* this adjacency into an arrangement.
 * Resolving is not owning: circulation, orientation and daylight belong there,
 * and are deliberately absent here.
 */

import { createUuid } from '@archisimple/shared';
import type { EnrichedArtefact } from '../artefacts/enriched-artefact';

/** The artefact kind, as carried by `ProposalArtefact.kind` and stored in the project file. */
export const SPACE_PROGRAMME_KIND = 'space-programme';

/**
 * How much a space matters, derived from what the Brief already distinguishes.
 *
 * The Brief carries no priority field, and this sprint deliberately does not add
 * one: it has shipped, and a user may already hold an approved Brief in a
 * project file, which Rule 4 makes expensive to change. What the Brief *does*
 * carry is where each requirement came from — `stated`, `answered` or `assumed`
 * — and that maps onto exactly the three distinctions a layout planner needs
 * when it cannot fit everything.
 */
export const SPACE_PRIORITIES = {
  /** The user named it, or answered a question about it. Drop this and the brief is unmet. */
  Required: 'required',
  /** A dwelling implies it and nobody mentioned it — a kitchen, a hallway. */
  Expected: 'expected',
  /** It arrived from a default the platform applied. First to go. */
  Optional: 'optional'
} as const;

export type SpacePriority = (typeof SPACE_PRIORITIES)[keyof typeof SPACE_PRIORITIES];

/** Where a target area came from — the honesty rule, as a field. */
export const AREA_SOURCES = {
  /** Scaled to fit a total the user stated. */
  ScaledToStatedTotal: 'scaled-to-stated-total',
  /** The platform's typical-area table, unscaled. The user stated no total. */
  Typical: 'typical'
} as const;

export type AreaSource = (typeof AREA_SOURCES)[keyof typeof AREA_SOURCES];

export interface ProgrammeSpace {
  /** Stable within the programme, so adjacency can name spaces without ordering them. */
  readonly id: string;
  readonly name: string;
  readonly count: number;
  /** Target area of one instance, in square metres. Never a dimension, never a coordinate. */
  readonly areaEach: number;
  /** `areaEach × count`. */
  readonly areaTotal: number;
  readonly priority: SpacePriority;
  readonly areaSource: AreaSource;
  /** The functional zone this space belongs to. */
  readonly zone: FunctionalZone;
}

/**
 * Functional zoning — the coarse grouping a layout planner arranges by.
 *
 * Four zones, because four is what changes a layout: what visitors see, where
 * people sleep, what serves the rest, and what is outside the heated envelope.
 * A finer taxonomy would be a classification exercise with no consumer.
 */
export const FUNCTIONAL_ZONES = {
  /** Living, kitchen, dining — awake, shared, often visited. */
  Day: 'day',
  /** Bedrooms and their bathrooms — quiet, private. */
  Night: 'night',
  /** Utility, storage, WC — serves the others. */
  Service: 'service',
  /** Hallways, landings, entrances — the space between spaces. */
  Circulation: 'circulation'
} as const;

export type FunctionalZone = (typeof FUNCTIONAL_ZONES)[keyof typeof FUNCTIONAL_ZONES];

/**
 * How strongly two spaces should be near each other.
 *
 * `avoid` is not the absence of a relationship — it is a requirement in its own
 * right, and a layout that puts the WC off the dining room has violated
 * something the programme said, not merely failed to satisfy something it
 * wanted.
 */
export const ADJACENCY_STRENGTHS = {
  Required: 'required',
  Preferred: 'preferred',
  Avoid: 'avoid'
} as const;

export type AdjacencyStrength = (typeof ADJACENCY_STRENGTHS)[keyof typeof ADJACENCY_STRENGTHS];

/**
 * One intended relationship between two spaces.
 *
 * Carries programme-space ids, never entity ids — there are no entities yet,
 * and a type that could hold one would be a route for measured adjacency to
 * leak in (Rule 11).
 */
export interface IntendedAdjacency {
  readonly fromSpaceId: string;
  readonly toSpaceId: string;
  readonly strength: AdjacencyStrength;
  /** Plain language, for the review card: "so the kitchen serves the dining room". */
  readonly reason: string;
}

/** The Brief this programme was derived from (Rules 4 and 12). */
export interface BriefProvenance {
  readonly briefId: string;
  /**
   * The revision that was read. A Brief revised afterwards leaves this
   * programme stale — this is the field that makes that detectable rather than
   * silent, which is the whole of what Sprint 27.9 owes Rule 12.
   */
  readonly briefRevision: number;
}

export interface SpaceProgramme extends EnrichedArtefact {
  readonly kind: typeof SPACE_PROGRAMME_KIND;
  readonly id: string;
  readonly revision: number;
  readonly createdAt: number;
  readonly sourceBrief: BriefProvenance;
  /**
   * How many storeys the building has (Sprint 28.0's 27.9 amendment).
   *
   * Carried from the Brief's mandatory `storeys` topic. It lives here rather
   * than being read from the Brief later because the artefact reader answers
   * `current(kind)` only: a consumer reading the Brief directly would get
   * whichever revision is in force *now*, while this programme was derived from
   * `sourceBrief.briefRevision` — silently mixing two revisions, which is the
   * divergence ADR-0027.1 Rule 12 says must be reported rather than reconciled.
   *
   * Always at least 1. It is a count, not a layout: *which* spaces sit on
   * *which* storey is the Layout Plan's decision (Sprint 28.0).
   */
  readonly storeys: number;
  /** Carried through from the Brief, so the programme can be read on its own. */
  readonly objectives: readonly string[];
  readonly spaces: readonly ProgrammeSpace[];
  readonly adjacencies: readonly IntendedAdjacency[];
  /** Total target floor area, in square metres. Derived; see `assumptions`. */
  readonly totalArea: number;
  /** Every number this artefact derived rather than received. */
  readonly assumptions: readonly string[];
  /** Caveats that do not block review — an unrecognised space, a very tight total. */
  readonly warnings: readonly string[];
}

export function createProgramme(input: {
  readonly sourceBrief: BriefProvenance;
  /** Defaults to 1 — a programme that says nothing about storeys is single-storey. */
  readonly storeys?: number;
  readonly objectives?: readonly string[];
  readonly spaces: readonly ProgrammeSpace[];
  readonly adjacencies?: readonly IntendedAdjacency[];
  readonly totalArea: number;
  readonly assumptions?: readonly string[];
  readonly warnings?: readonly string[];
  readonly now?: number;
}): SpaceProgramme {
  return {
    kind: SPACE_PROGRAMME_KIND,
    id: createUuid(),
    revision: 1,
    createdAt: input.now ?? Date.now(),
    sourceBrief: input.sourceBrief,
    storeys: Math.max(1, Math.floor(input.storeys ?? 1)),
    objectives: input.objectives ?? [],
    spaces: input.spaces,
    adjacencies: input.adjacencies ?? [],
    totalArea: input.totalArea,
    assumptions: input.assumptions ?? [],
    warnings: input.warnings ?? []
  };
}

/** The next revision (Rule 4): same identity, incremented revision, nothing mutated. */
export function reviseProgramme(
  programme: SpaceProgramme,
  patch: Partial<
    Pick<
      SpaceProgramme,
      'spaces' | 'adjacencies' | 'totalArea' | 'assumptions' | 'warnings' | 'objectives'
    >
  >
): SpaceProgramme {
  return { ...programme, ...patch, revision: programme.revision + 1 };
}

export function programmeSpace(
  programme: SpaceProgramme,
  spaceId: string
): ProgrammeSpace | undefined {
  return programme.spaces.find((space) => space.id === spaceId);
}

/** A programme with at least one space. An empty one is never offered for approval. */
export function isProgrammeComplete(programme: SpaceProgramme): boolean {
  return programme.spaces.length > 0;
}

/** Whether this programme was derived from the revision of the Brief now in force (Rule 12). */
export function matchesBrief(
  programme: SpaceProgramme,
  brief: { readonly id: string; readonly revision: number }
): boolean {
  return (
    programme.sourceBrief.briefId === brief.id &&
    programme.sourceBrief.briefRevision === brief.revision
  );
}

/**
 * The programme as markdown, for the message and the review card.
 *
 * Grouped by zone rather than listed flat: the zoning is a decision the
 * programme made, and a reader who cannot see it cannot disagree with it.
 */
export function summarizeProgramme(programme: SpaceProgramme): string {
  const lines: string[] = [];

  const zones: readonly FunctionalZone[] = [
    FUNCTIONAL_ZONES.Day,
    FUNCTIONAL_ZONES.Night,
    FUNCTIONAL_ZONES.Service,
    FUNCTIONAL_ZONES.Circulation
  ];

  for (const zone of zones) {
    const inZone = programme.spaces.filter((space) => space.zone === zone);
    if (inZone.length === 0) {
      continue;
    }
    lines.push(`**${zone.charAt(0).toUpperCase()}${zone.slice(1)}**`);
    for (const space of inZone) {
      const each = space.count === 1 ? '' : ` × ${space.count}`;
      const area = space.count === 1 ? `${space.areaEach} m²` : `${space.areaEach} m² each`;
      lines.push(`- ${space.name}${each} — ${area}`);
    }
    lines.push('');
  }

  lines.push(`**Total** — ${programme.totalArea} m²`, '');

  const stated = programme.adjacencies.filter(
    (adjacency) => adjacency.strength !== ADJACENCY_STRENGTHS.Avoid
  );
  if (stated.length > 0) {
    lines.push('**Should be adjacent**');
    for (const adjacency of stated) {
      const from = programmeSpace(programme, adjacency.fromSpaceId)?.name ?? adjacency.fromSpaceId;
      const to = programmeSpace(programme, adjacency.toSpaceId)?.name ?? adjacency.toSpaceId;
      lines.push(`- ${from} ↔ ${to} — ${adjacency.reason}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
