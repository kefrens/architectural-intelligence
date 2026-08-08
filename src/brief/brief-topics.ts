/**
 * Reading brief topics out of text (Sprint 27.8).
 *
 * One reader, used twice: the classifier asks it what the original request
 * already said, and the clarification dialogue asks it what an answer supplied.
 * They must agree — "two bathrooms" in the opening sentence and "two" in reply
 * to "how many bathrooms?" have to produce the same requirement, or the same
 * brief would depend on which turn the user happened to mention it in.
 *
 * This is ordered pattern matching over a fixed table, in the same spirit as
 * `intent/intent-recognizer.ts`, and it is worth being as blunt about it here as
 * that file is: it is not natural-language understanding. It is the offline,
 * deterministic path that makes Story 27.8.0's "requests are deterministically
 * classified" and its fake-provider tests possible at all. A language model
 * reaches the same {@link ArchitecturalBrief} through a tool call the host
 * resolves (ADR-0027.1 Rule 6), never by writing the artefact itself.
 */

import {
  BRIEF_REQUIREMENT_SOURCES,
  BRIEF_TOPICS,
  type BriefRequirement,
  type BriefRequirementSource,
  type DesiredSpace
} from './architectural-brief.js';

/** Number words a request plausibly uses for a count of rooms or storeys. */
const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ['no', 0],
  ['zero', 0],
  ['one', 1],
  ['a', 1],
  ['an', 1],
  ['single', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8]
]);

const NUMBER_PATTERN = `\\d+|${[...NUMBER_WORDS.keys()].join('|')}`;

function countFrom(token: string | undefined): number | undefined {
  if (token === undefined) {
    return undefined;
  }
  const numeric = Number.parseInt(token, 10);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return NUMBER_WORDS.get(token.toLowerCase());
}

function plural(count: number, singular: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`;
}

/**
 * Dwelling typology codes — `T4`, `F3`.
 *
 * In French usage a T4 has four principal rooms, of which one is the living
 * room, so the bedroom count is one less. That convention is encoded here
 * rather than left to a model to remember, which is the same reason
 * `computeRoomOutline` exists in `@archisimple/skills`.
 */
const TYPOLOGY = /\b([TF])\s?([1-9])\b/i;

/** Words that mean "a dwelling", which is what makes a request a programme rather than a command. */
export const DWELLING_WORDS =
  /\b(house|home|apartment|flat|villa|bungalow|cottage|studio|dwelling|residence|maisonette)\b/i;

interface TopicRule {
  readonly topic: string;
  readonly pattern: RegExp;
  /** Builds the requirement from the match, or `undefined` when the match carried no usable value. */
  read(
    match: RegExpMatchArray
  ): { readonly value: string | number | boolean; readonly statement: string } | undefined;
}

const TOPIC_RULES: readonly TopicRule[] = [
  {
    topic: BRIEF_TOPICS.Storeys,
    // "two storeys", "2-storey", "over three floors", "single level".
    pattern: new RegExp(
      `\\b(${NUMBER_PATTERN})[\\s-]*(?:storey|story|storeys|stories|floor|floors|level|levels)\\b`,
      'i'
    ),
    read: (match) => {
      const count = countFrom(match[1]);
      return count === undefined || count < 1
        ? undefined
        : { value: count, statement: plural(count, 'storey') };
    }
  },
  {
    topic: BRIEF_TOPICS.Bedrooms,
    pattern: new RegExp(`\\b(${NUMBER_PATTERN})[\\s-]*bed(?:room)?s?\\b`, 'i'),
    read: (match) => {
      const count = countFrom(match[1]);
      return count === undefined
        ? undefined
        : { value: count, statement: plural(count, 'bedroom') };
    }
  },
  {
    topic: BRIEF_TOPICS.Bathrooms,
    pattern: new RegExp(
      `\\b(${NUMBER_PATTERN})[\\s-]*(?:bath(?:room)?s?|shower\\s?rooms?)\\b`,
      'i'
    ),
    read: (match) => {
      const count = countFrom(match[1]);
      return count === undefined
        ? undefined
        : { value: count, statement: plural(count, 'bathroom') };
    }
  },
  {
    topic: BRIEF_TOPICS.Garage,
    pattern:
      /\b(no|without(?:\s+a)?|with(?:\s+a)?|a|an|one|two)?\s*(garage|carport|parking\s+space)\b/i,
    read: (match) => {
      const negated = /^(no|without)/i.test(match[1] ?? '');
      return {
        value: !negated,
        statement: negated ? 'no garage' : 'a garage'
      };
    }
  },
  {
    topic: BRIEF_TOPICS.Office,
    pattern:
      /\b(no|without(?:\s+an?)?|with(?:\s+an?)?|an?|one)?\s*(home\s+office|study|workspace)\b/i,
    read: (match) => {
      const negated = /^(no|without)/i.test(match[1] ?? '');
      return {
        value: !negated,
        statement: negated ? 'no home office' : 'a home office'
      };
    }
  },
  {
    topic: BRIEF_TOPICS.Accessibility,
    pattern:
      /\b(step[\s-]?free|wheelchair[\s-]?accessible|accessible|barrier[\s-]?free|single[\s-]storey\s+living)\b/i,
    read: () => ({ value: true, statement: 'step-free accessibility' })
  },
  {
    topic: BRIEF_TOPICS.Style,
    pattern:
      /\b(modern|contemporary|traditional|minimalist|rustic|scandinavian|industrial|classical)\b/i,
    read: (match) => {
      const style = match[1]!.toLowerCase();
      return { value: style, statement: `${style} style` };
    }
  },
  {
    topic: BRIEF_TOPICS.Budget,
    // A currency symbol or an explicit "budget", so a bare number is never money.
    pattern:
      /(?:budget[^\d]{0,12})?([€$£]\s?\d[\d\s,.]*\s?(?:k|m)?)|budget\s+of\s+([\d\s,.]+\s?(?:k|m)?)/i,
    read: (match) => {
      const raw = (match[1] ?? match[2] ?? '').trim();
      return raw.length === 0 ? undefined : { value: raw, statement: `a budget of ${raw}` };
    }
  },
  {
    topic: BRIEF_TOPICS.TotalArea,
    // Recorded as the user stated it, units included — never converted and
    // never allocated to a space (ADR-0027.1 Rule 3).
    //
    // The unit ends in a lookahead rather than `\b`: `²` is not a word
    // character, so a trailing `\b` after "m²" would demand a word boundary
    // between two non-word characters and never match "120 m² single".
    pattern: /\b(\d[\d\s.,]*)\s?(?:m²|m2|sqm|square\s+met(?:re|er)s?)(?!\w)/i,
    read: (match) => {
      const value = Number.parseFloat(match[1]!.replace(/[\s,]/g, ''));
      return Number.isFinite(value)
        ? { value, statement: `a total area of about ${value} m²` }
        : undefined;
    }
  }
];

/**
 * Every topic this text states, as requirements attributed to `source`.
 *
 * A topic the text does not mention is simply absent — this never guesses, for
 * the reason the intent recognizer gives for never inventing a distance: a
 * requirement the user did not state is worse than an unanswered question.
 */
export function readBriefTopics(
  text: string,
  source: BriefRequirementSource = BRIEF_REQUIREMENT_SOURCES.Stated
): readonly BriefRequirement[] {
  const requirements: BriefRequirement[] = [];

  for (const rule of TOPIC_RULES) {
    const match = text.match(rule.pattern);
    if (!match) {
      continue;
    }
    const read = rule.read(match);
    if (read === undefined) {
      continue;
    }
    requirements.push({ topic: rule.topic, statement: read.statement, value: read.value, source });
  }

  // A typology code states a bedroom count the prose never spells out, and only
  // when the prose did not already say one — "T4 with 2 bedrooms" is the user
  // correcting the shorthand, and the explicit number wins.
  const typology = text.match(TYPOLOGY);
  if (
    typology &&
    !requirements.some((requirement) => requirement.topic === BRIEF_TOPICS.Bedrooms)
  ) {
    const rooms = Number.parseInt(typology[2]!, 10);
    if (rooms > 1) {
      requirements.push({
        topic: BRIEF_TOPICS.Bedrooms,
        statement: `${plural(rooms - 1, 'bedroom')} (from ${typology[0]!.toUpperCase()})`,
        value: rooms - 1,
        source
      });
    }
  }

  return requirements;
}

/**
 * Answering a bare count.
 *
 * "How many bathrooms?" → "two". There is no topic word in that reply, so
 * {@link readBriefTopics} cannot see it; the dialogue knows which question is
 * open and asks for the number alone.
 */
export function readBareCount(text: string): number | undefined {
  const match = text.trim().match(new RegExp(`^(${NUMBER_PATTERN})\\b`, 'i'));
  return countFrom(match?.[1]);
}

/** "yes"/"no" for a topic whose value is a boolean. */
export function readBareBoolean(text: string): boolean | undefined {
  const trimmed = text.trim().toLowerCase();
  if (/^(yes|yep|yeah|sure|please|true)\b/.test(trimmed)) {
    return true;
  }
  if (/^(no|nope|none|not?\s|false)\b/.test(trimmed)) {
    return false;
  }
  return undefined;
}

/**
 * The spaces a request names, beyond the ones a bedroom or bathroom count
 * already implies.
 *
 * Counts come from the requirements rather than being parsed twice, so
 * "3 bedrooms" produces one desired space with a count of 3 and cannot
 * disagree with the requirement of the same name.
 */
export function desiredSpacesFrom(
  text: string,
  requirements: readonly BriefRequirement[]
): readonly DesiredSpace[] {
  const spaces: DesiredSpace[] = [];

  const countOf = (topic: string): number | undefined => {
    const value = requirements.find((requirement) => requirement.topic === topic)?.value;
    return typeof value === 'number' ? value : undefined;
  };

  const bedrooms = countOf(BRIEF_TOPICS.Bedrooms);
  if (bedrooms !== undefined && bedrooms > 0) {
    spaces.push({ name: 'bedroom', count: bedrooms });
  }
  const bathrooms = countOf(BRIEF_TOPICS.Bathrooms);
  if (bathrooms !== undefined && bathrooms > 0) {
    spaces.push({ name: 'bathroom', count: bathrooms });
  }

  const NAMED_SPACES: readonly (readonly [RegExp, string])[] = [
    [/\b(kitchens?)\b/i, 'kitchen'],
    [/\b(living\s+rooms?|lounges?|sitting\s+rooms?)\b/i, 'living room'],
    [/\b(dining\s+rooms?)\b/i, 'dining room'],
    [/\b(utility\s+rooms?|laundr(?:y|ies))\b/i, 'utility room'],
    [/\b(home\s+office|stud(?:y|ies))\b/i, 'home office'],
    [/\b(garages?)\b/i, 'garage']
  ];

  for (const [pattern, name] of NAMED_SPACES) {
    if (pattern.test(text) && !spaces.some((space) => space.name === name)) {
      spaces.push({ name, count: 1 });
    }
  }

  return spaces;
}
