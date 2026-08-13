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
  SPACE_RELATIONSHIP_KINDS,
  withRelationship,
  type BriefRequirement,
  type BriefRequirementSource,
  type DesiredSpace,
  type SpaceRelationship,
  type SpaceRelationshipKind
} from './architectural-brief.js';
import { TOPIC_SPACES } from './topic-spaces.js';

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
/**
 * Words that name a whole dwelling — the positive evidence the classifier
 * requires before it will read a request as a design brief.
 *
 * ## Spellings (Sprint 1.5, Story 1.5.10 — Bug 002)
 *
 * The list is exact-match, so a misspelling is not a near miss: it is silence.
 * `Build me a 100m2 appartment, with 2 bedrooms and 1 bathroom` named no
 * dwelling, fell to Direct Execution, and was answered "I did not recognise that
 * as something I can do to the building model" followed by seven `edit.*`
 * operations — confident, wrong, and unrelated to what was asked.
 *
 * `appartment` and `appartement` are the French spelling and the commonest
 * English misspelling of the commonest word here. `maisonnette` is the same for
 * the word beside it.
 *
 * Adding a spelling does **not** widen what counts as evidence — a list that
 * already accepts `apartment` accepting `appartment` changes nothing about the
 * classifier's deliberate asymmetry. Widening the evidence itself (a design verb
 * plus two mandatory topics, with no dwelling word at all) was considered and
 * left out of Sprint 1.5 on purpose: it is probably the better rule and it
 * deserves its own decision rather than arriving inside a lineage fix.
 *
 * `duplex`, `townhouse` and `penthouse` are not misspellings — they are dwelling
 * types the list simply never had.
 */
export const DWELLING_WORDS =
  /\b(house|home|apartment|appartment|appartement|flat|villa|bungalow|cottage|studio|dwelling|residence|maisonette|maisonnette|duplex|townhouse|penthouse)\b/i;

/**
 * Dwellings that are single-storey by what the word means (BUG-009).
 *
 * An apartment occupies one level of a building; so does a flat and a studio; a
 * bungalow is single-storey by definition. Asking their owner "how many
 * storeys?" is asking a question the word already answered, and BUG-009 is what
 * it cost: the reporter said "build me a 100 m² apartment", supplied bedrooms
 * and bathrooms, and `planning_captureBrief` refused every call for want of a
 * storey count nobody says out loud. No artefact was ever produced, and the
 * model narrated four stages that did not exist.
 *
 * **Deliberately not `house`, `villa` or `cottage`** — those are genuinely
 * ambiguous and the question is worth asking. And deliberately not `duplex`,
 * `maisonette`, `townhouse` or `penthouse`, which imply *more* than one storey
 * and would need a different number rather than this one.
 *
 * The implication is recorded as an **assumption**, never as something the user
 * said, so it appears in the Brief the user reviews and can be corrected by
 * saying otherwise (BUG-009 §7.1 A).
 */
export const SINGLE_STOREY_DWELLINGS =
  /\b(apartment|appartment|appartement|flat|studio|bungalow)\b/i;

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
  // A dwelling type that means one storey states one, the same way a typology
  // code below states a bedroom count the prose never spells out (BUG-009).
  //
  // `Assumed` rather than `source`, whatever the caller asked for: the user said
  // "apartment", not "one storey", and a Brief that claimed otherwise would be
  // putting words in their mouth. What the two cases share is that the word
  // carries the number; what they do not share is who said it.
  if (
    SINGLE_STOREY_DWELLINGS.test(text) &&
    !requirements.some((requirement) => requirement.topic === BRIEF_TOPICS.Storeys)
  ) {
    requirements.push({
      topic: BRIEF_TOPICS.Storeys,
      statement: '1 storey',
      value: 1,
      source: BRIEF_REQUIREMENT_SOURCES.Assumed
    });
  }

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
 * Phrasings that state a relationship between two spaces (Bug 004,
 * ADR-AI-0003 Rule 7).
 *
 * Each pattern must capture the two space names itself, so the clause boundaries
 * are the pattern's problem rather than a later split's. `[\w/\-\s]+?` is
 * deliberately lazy and deliberately allows `/` — the sentence that prompted all
 * of this named a "Dining/Lounge area".
 *
 * Narrow on purpose. This reads sentences that plainly state a relationship and
 * nothing else; anything it does not recognise stays the model's job, for the
 * reason Bug 003 established — an invented requirement is worse than a missing
 * one, because it is not visibly missing.
 */
/**
 * A word that can be part of a space's name.
 *
 * The exclusions are what stop a capture running backwards over half the
 * sentence: without them, "A house with the kitchen next to the dining room"
 * matches from "house", because the engine tries the earliest start position and
 * a permissive fragment happily spans "house with the kitchen". Barring the
 * connectives from *inside* a name means the earliest position that can start one
 * is the name itself.
 */
const NAME_WORD =
  '(?!and\\b|with\\b|the\\b|an?\\b|my\\b|our\\b|for\\b|in\\b|on\\b|to\\b|from\\b|of\\b|is\\b|are\\b|be\\b|been\\b|should\\b|must\\b|put\\b|keep\\b|kept\\b|want\\b|need\\b|like\\b|please\\b)[\\w/-]+';

/** One to several such words: "kitchen", "dining room", "Dining/Lounge area". */
const SPACE_NAME = `(?:${NAME_WORD})(?:\\s+(?:${NAME_WORD}))*`;

const RELATIONSHIP_RULES: readonly {
  readonly pattern: RegExp;
  readonly kind: SpaceRelationshipKind;
}[] = [
  {
    // "Kitchen and Dining/Lounge area are separated", "… must be kept separate".
    pattern: new RegExp(
      `\\b(${SPACE_NAME})\\s+and\\s+(?:the\\s+)?(${SPACE_NAME})\\s+(?:are|is|should\\s+be|must\\s+be|to\\s+be)\\s+(?:kept\\s+)?separat(?:e|ed)\\b`,
      'i'
    ),
    kind: SPACE_RELATIONSHIP_KINDS.Separated
  },
  {
    // "keep the kitchen separate from the lounge".
    pattern: new RegExp(
      `\\b(${SPACE_NAME})\\s+separat(?:e|ed)\\s+from\\s+(?:the\\s+)?(${SPACE_NAME})`,
      'i'
    ),
    kind: SPACE_RELATIONSHIP_KINDS.Separated
  },
  {
    // "bedrooms away from the living room".
    pattern: new RegExp(
      `\\b(${SPACE_NAME})\\s+(?:well\\s+)?away\\s+from\\s+(?:the\\s+)?(${SPACE_NAME})`,
      'i'
    ),
    kind: SPACE_RELATIONSHIP_KINDS.Separated
  },
  {
    // "kitchen and dining should be open".
    pattern: new RegExp(
      `\\b(${SPACE_NAME})\\s+and\\s+(?:the\\s+)?(${SPACE_NAME})\\s+(?:are|is|should\\s+be|must\\s+be|to\\s+be)\\s+(?:open|connected|joined|together)\\b`,
      'i'
    ),
    kind: SPACE_RELATIONSHIP_KINDS.Adjacent
  },
  {
    // "kitchen next to the dining room", "kitchen opening onto the lounge".
    pattern: new RegExp(
      `\\b(${SPACE_NAME})\\s+(?:next\\s+to|adjacent\\s+to|opening\\s+onto|opens\\s+onto|beside)\\s+(?:the\\s+)?(${SPACE_NAME})`,
      'i'
    ),
    kind: SPACE_RELATIONSHIP_KINDS.Adjacent
  }
];

/** Leading articles and trailing nouns that are not part of the space's name. */
function cleanSpaceName(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:the|a|an|my|our|both|and)\s+/i, '')
    .replace(/\s+(?:area|areas|space|spaces|room|rooms)$/i, '')
    .replace(/[.,;!?]+$/, '')
    .trim();
}

/**
 * The relationships a request states between two of its spaces.
 *
 * Read per sentence, because every pattern here spans a clause and a sentence
 * boundary is the one place a clause certainly ends. A name that survives
 * cleaning but matches no space the brief knows is not filtered out here — the
 * Space Programme drops it with a warning (Rule 6), because only the Programme
 * knows which spaces finally exist.
 */
export function readSpaceRelationships(
  text: string,
  source: BriefRequirementSource = BRIEF_REQUIREMENT_SOURCES.Stated
): readonly SpaceRelationship[] {
  let relationships: readonly SpaceRelationship[] = [];

  for (const sentence of text.split(/[.;\n]+/)) {
    for (const rule of RELATIONSHIP_RULES) {
      const match = sentence.match(rule.pattern);
      if (!match) {
        continue;
      }
      const from = cleanSpaceName(match[1] ?? '');
      const to = cleanSpaceName(match[2] ?? '');
      if (from.length === 0 || to.length === 0 || from.toLowerCase() === to.toLowerCase()) {
        continue;
      }
      relationships = withRelationship(relationships, { from, to, kind: rule.kind, source });
      // One relationship per sentence: the patterns overlap, and a sentence that
      // matched two of them has been read twice rather than said two things.
      break;
    }
  }

  return relationships;
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

  // The converse of `withSpaceStatedTopics` (Bug 007). A topic stated as a flag
  // — `office: true`, from the tool argument or from "with a home office" — is a
  // space the user asked for, and a Brief that requires an office while its
  // desired spaces name none produces a Programme with no room for it: the
  // Programme builds from `desiredSpaces`, and `requirements` is not somewhere it
  // looks for a space.
  //
  // By role, and against the text as well as the spaces derived above, so a
  // brief that already named a "study" or a bare "office" gains nothing. Callers
  // that hold spaces this function cannot see pass their names as the text —
  // `mergeSpaces` does exactly that.
  for (const entry of TOPIC_SPACES) {
    const value = requirements.find((requirement) => requirement.topic === entry.topic)?.value;
    if (
      !entry.boolean ||
      value !== true ||
      entry.role.test(text) ||
      spaces.some((space) => entry.role.test(space.name))
    ) {
      continue;
    }
    spaces.push({ name: entry.space, count: 1 });
  }

  return spaces;
}
