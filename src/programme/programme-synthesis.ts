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
  const have = new Set(named.map((space) => space.name.toLowerCase()));

  const implied = [...IMPLIED_SPACES, ...verticalCirculationFor(storeys)]
    .filter((space) => !have.has(space.name.toLowerCase()))
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
  readonly from: RegExp;
  readonly to: RegExp;
  readonly strength: (typeof ADJACENCY_STRENGTHS)[keyof typeof ADJACENCY_STRENGTHS];
  readonly reason: string;
}[] = [
  {
    from: /^kitchen$/i,
    to: /^dining room$/i,
    strength: ADJACENCY_STRENGTHS.Required,
    reason: 'so the kitchen serves the dining room directly'
  },
  {
    from: /^living room$/i,
    to: /^kitchen$/i,
    strength: ADJACENCY_STRENGTHS.Preferred,
    reason: 'the two shared daytime spaces usually open onto each other'
  },
  {
    from: /^hallway$/i,
    to: /^living room$/i,
    strength: ADJACENCY_STRENGTHS.Required,
    reason: 'the entrance reaches the living space without passing through another room'
  },
  {
    from: /^bedroom$/i,
    to: /^bathroom$/i,
    strength: ADJACENCY_STRENGTHS.Preferred,
    reason: 'a bathroom is reachable from the sleeping area at night'
  },
  {
    from: /^bedroom$/i,
    to: /^living room$/i,
    strength: ADJACENCY_STRENGTHS.Avoid,
    reason: 'so noise from the living space does not carry into a bedroom'
  },
  {
    from: /^wc$/i,
    to: /^dining room$/i,
    strength: ADJACENCY_STRENGTHS.Avoid,
    reason: 'a WC should not open directly onto a room where people eat'
  }
];

function adjacenciesFor(spaces: readonly ProgrammeSpace[]): readonly IntendedAdjacency[] {
  const find = (pattern: RegExp): ProgrammeSpace | undefined =>
    spaces.find((space) => pattern.test(space.name));

  const adjacencies: IntendedAdjacency[] = [];
  for (const template of ADJACENCY_TEMPLATE) {
    const from = find(template.from);
    const to = find(template.to);
    if (from === undefined || to === undefined || from.id === to.id) {
      continue;
    }
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
