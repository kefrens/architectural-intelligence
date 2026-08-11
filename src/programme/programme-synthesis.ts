/**
 * Brief → Space Programme (Sprint 27.9, Stories 27.9.1 and 27.9.2).
 *
 * The one place a Programme is built, whichever provider was talking — the same
 * arrangement `brief-assembly.ts` established for the Brief, and for the same
 * reason (ADR-0027.1 Rule 6). A language model contributes fields through a
 * tool the host resolves; it does not write this artefact.
 *
 * ## What this file decides, and what it delegates
 *
 * It decides *which* spaces exist, what each is for, what matters most, and what
 * should be near what. It delegates every number to
 * `@archisimple/skills`' Programme domain (Rule 9), which is why the areas are
 * reproducible and why the same Brief cannot produce two different programmes.
 *
 * That the reasoning layer may call a skill at all is ADR-0027's Option C,
 * stated there as supported before anything used it: "operation providers may
 * consume skills exactly as tools do". This is the first consumer.
 *
 * ## The honesty rule, in code
 *
 * A stated total is a requirement and scales the allocation. An unstated total
 * is *this table's opinion*, recorded as an assumption and never as something
 * the user asked for. `AREA_SOURCES` carries the distinction per space and
 * `assumptions` carries it in prose, because the review card shows the second
 * and a later stage reads the first.
 */

import { allocateSpaceAreas, createSkillContext, type SkillContext } from '@archisimple/skills';
import { createUuid } from '@archisimple/shared';
import {
  BRIEF_REQUIREMENT_SOURCES,
  BRIEF_TOPICS,
  briefRequirement,
  type ArchitecturalBrief,
  type DesiredSpace
} from '../brief/index.js';
import {
  ADJACENCY_STRENGTHS,
  AREA_SOURCES,
  createProgramme,
  FUNCTIONAL_ZONES,
  SPACE_PRIORITIES,
  type FunctionalZone,
  type IntendedAdjacency,
  type ProgrammeSpace,
  type SpaceProgramme,
  type SpacePriority
} from './space-programme.js';

/**
 * Spaces a dwelling needs whether or not anyone mentioned them.
 *
 * A brief that says "three bedrooms and two bathrooms" has not asked for a
 * kitchen, and a programme without one is not a dwelling. These are added at
 * `expected` priority — the layout planner may drop them under pressure, and
 * the user can see they were added, which is the difference between completing
 * a brief and overruling it.
 */
const IMPLIED_SPACES: readonly DesiredSpace[] = [
  { name: 'kitchen', count: 1 },
  { name: 'living room', count: 1 },
  { name: 'hallway', count: 1 }
];

/**
 * The function a space performs, recognised from the name it was given
 * (Bug 003).
 *
 * Both places below used to match space names *literally* — implied spaces were
 * skipped on an exact lowercase equality, and {@link ADJACENCY_TEMPLATE}
 * anchored on `/^dining room$/i`. A brief asking for a "dining/lounge" therefore
 * got a second, separate living room added underneath it, and the kitchen
 * adjacency that should have attached to the dining half attached to nothing.
 * In a 100 m² flat that is 24 m² of duplicate day space nobody asked for.
 *
 * A name maps to every role it performs, so one compound space can satisfy two:
 * a dining/lounge is the dining room *and* the living room, and neither needs
 * adding again. Patterns are unanchored on purpose — that is the whole point —
 * but each demands a whole word, so "bedroom" does not make a "bedroom cupboard"
 * a bedroom.
 */
const SPACE_ROLES = {
  Kitchen: /\bkitchen(?:ette)?\b/i,
  Living: /\b(?:living|lounge|sitting\s?room|salon|family\s?room|reception\s?room)\b/i,
  Dining: /\b(?:dining|diner)\b/i,
  Bedroom: /\bbed\s?room\b/i,
  Bathroom: /\b(?:bath\s?room|shower\s?room|en.?suite)\b/i,
  Wc: /\b(?:wc|toilet|cloakroom)\b/i,
  Hallway: /\b(?:hall|hallway|corridor|entrance|entry|foyer|vestibule)\b/i,
  Staircase: /\b(?:stair|staircase|stairwell)\b/i,
  Landing: /\blanding\b/i
} as const;

type SpaceRole = (typeof SPACE_ROLES)[keyof typeof SPACE_ROLES];

/** The role each implied space fills, so a brief that already fills it gets no duplicate. */
const ROLE_OF_IMPLIED_SPACE: Readonly<Record<string, SpaceRole>> = {
  kitchen: SPACE_ROLES.Kitchen,
  'living room': SPACE_ROLES.Living,
  hallway: SPACE_ROLES.Hallway,
  staircase: SPACE_ROLES.Staircase,
  landing: SPACE_ROLES.Landing
};

function fills(role: SpaceRole, name: string): boolean {
  return role.test(name);
}

/**
 * Vertical circulation, implied when the brief asks for more than one storey
 * (Sprint 28.0's 27.9 amendment).
 *
 * A two-storey programme with no staircase is not a two-storey building, and
 * before this the platform produced exactly that: `IMPLIED_SPACES` covered the
 * ground floor and nothing connected the floors. The Layout Plan's
 * `vertical-connection` edge would then have had nothing to occupy it.
 *
 * One staircase, and one landing per floor above the ground. Both `expected`,
 * like every other implied space, so they are visible in the review and a user
 * who wants neither can say so. *Which* spaces exist stays a Programme
 * decision; where they go is the Layout's.
 */
function verticalCirculationFor(storeys: number): readonly DesiredSpace[] {
  if (storeys <= 1) {
    return [];
  }
  return [
    { name: 'staircase', count: 1 },
    { name: 'landing', count: storeys - 1 }
  ];
}

/** The storey count the brief stated. Mandatory there, so it is essentially always present. */
function statedStoreys(brief: ArchitecturalBrief): number {
  const value = briefRequirement(brief, BRIEF_TOPICS.Storeys)?.value;
  return typeof value === 'number' && value >= 1 ? Math.floor(value) : 1;
}

/** Which zone a space belongs to. Unknown names fall to `day`, the least surprising default. */
const ZONE_BY_SPACE: readonly (readonly [RegExp, FunctionalZone])[] = [
  [/bed\s?room|bedroom/i, FUNCTIONAL_ZONES.Night],
  [/bath|shower|en.?suite/i, FUNCTIONAL_ZONES.Night],
  [/wc|toilet|cloak/i, FUNCTIONAL_ZONES.Service],
  [/utility|laundry|storage|garage|plant/i, FUNCTIONAL_ZONES.Service],
  [/hall|landing|entrance|corridor|stair/i, FUNCTIONAL_ZONES.Circulation],
  [/kitchen|living|dining|lounge|office|study|snug/i, FUNCTIONAL_ZONES.Day]
];

function zoneFor(name: string): FunctionalZone {
  for (const [pattern, zone] of ZONE_BY_SPACE) {
    if (pattern.test(name)) {
      return zone;
    }
  }
  return FUNCTIONAL_ZONES.Day;
}

/**
 * The priority a space carries, from what the Brief says about it.
 *
 * A space the user named is `required`. A space that exists only because a
 * requirement was *assumed* — the garage the platform defaulted to — is
 * `optional`. Everything this file added to make the dwelling habitable is
 * `expected`.
 */
function priorityFor(name: string, brief: ArchitecturalBrief, implied: boolean): SpacePriority {
  if (implied) {
    return SPACE_PRIORITIES.Expected;
  }

  // A space that maps onto a brief topic inherits that requirement's source.
  const topic = TOPIC_BY_SPACE[name.toLowerCase()];
  const source = topic === undefined ? undefined : briefRequirement(brief, topic)?.source;
  if (source === BRIEF_REQUIREMENT_SOURCES.Assumed) {
    return SPACE_PRIORITIES.Optional;
  }
  return SPACE_PRIORITIES.Required;
}

/** Spaces that exist because a brief topic said so, so their priority follows that topic's source. */
const TOPIC_BY_SPACE: Readonly<Record<string, string>> = {
  bedroom: BRIEF_TOPICS.Bedrooms,
  bathroom: BRIEF_TOPICS.Bathrooms,
  garage: BRIEF_TOPICS.Garage,
  'home office': BRIEF_TOPICS.Office,
  study: BRIEF_TOPICS.Office
};

/**
 * The spaces the programme will contain: what the Brief named, plus what a
 * dwelling implies and the Brief did not mention.
 *
 * A brief that already names a kitchen does not get a second one — implied
 * spaces fill gaps, they never duplicate.
 */
function spacesFrom(
  brief: ArchitecturalBrief,
  storeys: number
): readonly (DesiredSpace & { implied: boolean })[] {
  const named = brief.desiredSpaces.map((space) => ({ ...space, implied: false }));

  // By role, not by name: a brief naming a "dining/lounge" has a living room
  // already, however differently it spelled it (Bug 003).
  const covered = (candidate: DesiredSpace): boolean => {
    const role = ROLE_OF_IMPLIED_SPACE[candidate.name];
    return named.some((space) =>
      role === undefined
        ? space.name.toLowerCase() === candidate.name.toLowerCase()
        : fills(role, space.name)
    );
  };

  const implied = [...IMPLIED_SPACES, ...verticalCirculationFor(storeys)]
    .filter((space) => !covered(space))
    .map((space) => ({ ...space, implied: true }));

  return [...named, ...implied];
}

/**
 * The intended adjacencies a dwelling programme always states.
 *
 * A fixed set, stated as data rather than inferred: these are the relationships
 * that hold for essentially every dwelling, and a programme that had to derive
 * them from the brief would derive nothing at all from a brief that says
 * "3 bedrooms, 2 bathrooms". A layout planner or an Urban Rules provider may add
 * to them; nothing here pretends they were the user's idea, which is why each
 * carries the reason it exists.
 */
const ADJACENCY_TEMPLATE: readonly {
  readonly from: SpaceRole;
  readonly to: SpaceRole;
  readonly strength: (typeof ADJACENCY_STRENGTHS)[keyof typeof ADJACENCY_STRENGTHS];
  readonly reason: string;
}[] = [
  {
    from: SPACE_ROLES.Kitchen,
    to: SPACE_ROLES.Dining,
    strength: ADJACENCY_STRENGTHS.Required,
    reason: 'so the kitchen serves the dining room directly'
  },
  {
    from: SPACE_ROLES.Living,
    to: SPACE_ROLES.Kitchen,
    strength: ADJACENCY_STRENGTHS.Preferred,
    reason: 'the two shared daytime spaces usually open onto each other'
  },
  {
    from: SPACE_ROLES.Hallway,
    to: SPACE_ROLES.Living,
    strength: ADJACENCY_STRENGTHS.Required,
    reason: 'the entrance reaches the living space without passing through another room'
  },
  {
    from: SPACE_ROLES.Bedroom,
    to: SPACE_ROLES.Bathroom,
    strength: ADJACENCY_STRENGTHS.Preferred,
    reason: 'a bathroom is reachable from the sleeping area at night'
  },
  {
    from: SPACE_ROLES.Bedroom,
    to: SPACE_ROLES.Living,
    strength: ADJACENCY_STRENGTHS.Avoid,
    reason: 'so noise from the living space does not carry into a bedroom'
  },
  {
    from: SPACE_ROLES.Wc,
    to: SPACE_ROLES.Dining,
    strength: ADJACENCY_STRENGTHS.Avoid,
    reason: 'a WC should not open directly onto a room where people eat'
  }
];

/** Unordered, so one pair cannot be stated twice under two different strengths. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function adjacenciesFor(spaces: readonly ProgrammeSpace[]): readonly IntendedAdjacency[] {
  const find = (role: SpaceRole): ProgrammeSpace | undefined =>
    spaces.find((space) => fills(role, space.name));

  const adjacencies: IntendedAdjacency[] = [];
  // One compound space can fill two roles, so two templates can resolve to the
  // same pair — kitchen↔dining and living↔kitchen both land on a "dining/lounge"
  // (Bug 003). The first wins, which is why the template is ordered strongest
  // first: a required adjacency is not downgraded by a preference that happens
  // to describe the same two rooms.
  const stated = new Set<string>();

  for (const template of ADJACENCY_TEMPLATE) {
    const from = find(template.from);
    const to = find(template.to);
    if (from === undefined || to === undefined || from.id === to.id) {
      continue;
    }
    const key = pairKey(from.id, to.id);
    if (stated.has(key)) {
      continue;
    }
    stated.add(key);
    adjacencies.push({
      fromSpaceId: from.id,
      toSpaceId: to.id,
      strength: template.strength,
      reason: template.reason
    });
  }
  return adjacencies;
}

/** The total area the Brief stated, if it stated one. */
function statedTotalArea(brief: ArchitecturalBrief): number | undefined {
  const value = briefRequirement(brief, BRIEF_TOPICS.TotalArea)?.value;
  return typeof value === 'number' && value > 0 ? value : undefined;
}

export type ProgrammeSynthesisResult =
  | { readonly ok: true; readonly programme: SpaceProgramme }
  | { readonly ok: false; readonly message: string };

export interface SynthesizeProgrammeOptions {
  readonly brief: ArchitecturalBrief;
  /** Defaults to the platform default — metres, 1 mm resolution. */
  readonly context?: SkillContext;
  readonly now?: number;
}

/**
 * Builds the Space Programme for one approved Brief.
 *
 * Returns a message rather than throwing when the brief cannot support one — a
 * stated total too small to hold the spaces asked for is a sentence the user can
 * act on, exactly as a `PlanBlocker` is, and it comes back through the same
 * conversational path.
 */
export function synthesizeProgramme(options: SynthesizeProgrammeOptions): ProgrammeSynthesisResult {
  const { brief } = options;
  const context = options.context ?? createSkillContext();

  const storeys = statedStoreys(brief);
  const demands = spacesFrom(brief, storeys);
  if (demands.length === 0) {
    return {
      ok: false,
      message: 'That brief names no spaces, so there is nothing to write a programme from.'
    };
  }

  const totalArea = statedTotalArea(brief);
  const allocated = allocateSpaceAreas.execute(
    {
      spaces: demands.map((demand) => ({ name: demand.name, count: demand.count })),
      ...(totalArea === undefined ? {} : { totalArea })
    },
    context
  );

  if (!allocated.ok) {
    return { ok: false, message: allocated.failure.message };
  }

  const areaSource =
    totalArea === undefined ? AREA_SOURCES.Typical : AREA_SOURCES.ScaledToStatedTotal;

  const spaces: ProgrammeSpace[] = allocated.value.allocations.map((allocation, index) => {
    const demand = demands[index]!;
    return {
      id: createUuid(),
      name: allocation.name,
      count: allocation.count,
      areaEach: allocation.areaEach,
      areaTotal: allocation.areaTotal,
      priority: priorityFor(allocation.name, brief, demand.implied),
      areaSource,
      zone: zoneFor(allocation.name)
    };
  });

  const assumptions: string[] = [];
  const warnings: string[] = [];

  if (totalArea === undefined) {
    // The distinction the whole artefact turns on.
    assumptions.push(
      `Target areas come from typical dwelling sizes, totalling about ${allocated.value.total} m². No total was stated.`
    );
  } else {
    assumptions.push(
      `Target areas are scaled to the ${totalArea} m² you asked for, keeping the usual proportions between rooms.`
    );
    if (allocated.value.scaleFactor < 0.75) {
      warnings.push(
        `${totalArea} m² is tight for these spaces — each is about ${Math.round(allocated.value.scaleFactor * 100)}% of its typical size.`
      );
    }
  }

  const implied = demands.filter((demand) => demand.implied);
  if (implied.length > 0) {
    assumptions.push(
      `Added ${implied.map((demand) => demand.name).join(', ')}, which the brief did not mention but a home needs.`
    );
  }

  if (storeys > 1) {
    assumptions.push(
      `The brief asks for ${storeys} storeys, so the programme includes vertical circulation.`
    );
  }

  if (allocated.value.unrecognisedSpaces.length > 0) {
    warnings.push(
      `I had no typical size for ${allocated.value.unrecognisedSpaces.join(', ')}, so I used a general one.`
    );
  }

  const adjacencies = adjacenciesFor(spaces);
  if (adjacencies.length > 0) {
    assumptions.push(
      'The relationships between spaces are the usual ones for a home; nothing in the brief specified them.'
    );
  }

  return {
    ok: true,
    programme: createProgramme({
      sourceBrief: { briefId: brief.id, briefRevision: brief.revision },
      storeys,
      objectives: brief.objectives,
      spaces,
      adjacencies,
      totalArea: allocated.value.total,
      assumptions,
      warnings,
      ...(options.now === undefined ? {} : { now: options.now })
    })
  };
}
