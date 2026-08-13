/**
 * Assembling an Architectural Brief (Sprint 27.8, Story 27.8.1 — ADR-0027.1
 * Rule 6).
 *
 * Every Brief in the platform is built here, whichever provider was talking.
 * The offline Architectural Assistant reaches this from
 * {@link assembleBrief}; a language model reaches it through a tool call the
 * host resolves and hands to {@link assembleBriefFromFields}. Neither writes the
 * artefact: the model contributes *fields*, and this module decides what a Brief
 * is.
 *
 * That is the rule, and the reason for it is concrete. Asking each adapter to
 * return a schema-valid Brief would break the two in-browser providers, which
 * are not language models at all, and would make the artefact's quality depend
 * on which model answered — the exact failure `automation_createRoom` was built
 * to remove in Sprint 27.7.
 *
 * ## Defaults
 *
 * A topic with a defensible default is filled in rather than asked about, and
 * every default applied is recorded twice: once as a requirement whose source is
 * `assumed`, and once in plain language in `assumptions`. Story 27.8.2 asks for
 * both halves — the user must be able to see what was decided for them, and to
 * contradict it in their next sentence.
 */

import {
  BRIEF_REQUIREMENT_SOURCES,
  BRIEF_TOPICS,
  createBrief,
  reviseBrief,
  withRelationship,
  withRequirement,
  type ArchitecturalBrief,
  type BriefRequirement,
  type BriefRequirementSource,
  type DesiredSpace,
  type SpaceRelationship
} from './architectural-brief.js';
import {
  desiredSpacesFrom,
  readBareBoolean,
  readBareCount,
  readBriefTopics,
  readSpaceRelationships
} from './brief-topics.js';
import { MANDATORY_BRIEF_TOPICS, type RequestClassification } from './request-classification.js';

/**
 * Topics the platform fills in rather than asks about.
 *
 * Each is a genuine majority case for a dwelling, and each is cheap to
 * contradict — "no garage" in the next sentence overwrites the assumption. A
 * topic only belongs here if being wrong about it costs the user a sentence
 * rather than a redesign, which is why bedrooms and storeys are mandatory
 * instead.
 */
const DEFAULTED_TOPICS: readonly {
  readonly topic: string;
  readonly value: string | number | boolean;
  readonly statement: string;
  readonly assumption: string;
}[] = [
  {
    topic: BRIEF_TOPICS.Garage,
    value: false,
    statement: 'no garage',
    assumption: 'No garage, since none was mentioned.'
  },
  {
    topic: BRIEF_TOPICS.Office,
    value: false,
    statement: 'no home office',
    assumption: 'No home office, since none was mentioned.'
  },
  {
    topic: BRIEF_TOPICS.Accessibility,
    value: false,
    statement: 'no specific accessibility requirement',
    assumption: 'No step-free requirement, since none was mentioned.'
  }
];

/**
 * Topics the deterministic reader may supply when a caller left them out
 * (Bug 003).
 *
 * `assembleBriefFromFields` built requirements from the tool call and nothing
 * else, so a topic the model did not pass simply did not exist. "Build me a
 * 100m2 appartment" produced a Brief with no total area, and the Space Programme
 * — correctly, and uselessly — reported that no total was stated and sized the
 * dwelling from its own table. The number was in the sentence the whole time;
 * {@link readBriefTopics} finds it, and only the model path never asked.
 *
 * ## Why a subset, and why these four
 *
 * The reader is deliberately permissive — `Budget` matches a bare currency
 * amount, `Garage` matches the word in any clause including one that was not
 * about this building. Filling a gap from a loose pattern is a worse failure
 * than leaving it open, because an invented requirement is not visibly missing.
 *
 * These four are the ones whose patterns demand an explicit number next to an
 * explicit noun, and they are also the four a Programme cannot be honest
 * without. Everything else stays the model's job, and stays absent when the
 * model omits it.
 *
 * The backstop only ever *fills*. A topic the caller supplied is the caller's,
 * whatever the sentence says — the model read the whole conversation and this
 * reads one message.
 */
const BACKSTOP_TOPICS: readonly string[] = [
  BRIEF_TOPICS.TotalArea,
  BRIEF_TOPICS.Storeys,
  BRIEF_TOPICS.Bedrooms,
  BRIEF_TOPICS.Bathrooms
];

/** The loose requirement shape both field-taking entry points accept. */
interface SuppliedRequirement {
  readonly topic: string;
  readonly value: string | number | boolean;
  readonly statement?: string;
  readonly source?: BriefRequirementSource;
}

/**
 * Completes a caller's reading of the user's message with the topics
 * {@link BACKSTOP_TOPICS} allows and the caller did not state.
 *
 * Applied to what the *caller supplied*, before any folding, so everything
 * downstream — defaults, revision, change detection — behaves exactly as it does
 * for a caller who passed the topic itself. That is what keeps the two paths
 * {@link assembleBrief} and {@link assembleBriefFromFields} in agreement, which
 * this module's header has claimed since Sprint 27.8.
 */
function withBackstopTopics(
  supplied: readonly SuppliedRequirement[],
  texts: readonly (string | undefined)[]
): readonly SuppliedRequirement[] {
  const stated = new Set(supplied.map((requirement) => requirement.topic));
  const filled: SuppliedRequirement[] = [];

  for (const text of texts) {
    if (text === undefined || text.trim().length === 0) {
      continue;
    }
    for (const requirement of readBriefTopics(text)) {
      if (!BACKSTOP_TOPICS.includes(requirement.topic) || stated.has(requirement.topic)) {
        continue;
      }
      stated.add(requirement.topic);
      filled.push(requirement);
    }
  }

  return filled.length === 0 ? supplied : [...supplied, ...filled];
}

/**
 * Every text the backstop may read, in precedence order (Bug 005).
 *
 * The user's own message first, then the model's own words for this Brief.
 *
 * Reading the model's words back is not redundant, and the conversation that
 * exposed Bug 005 is why. The first `planning_captureBrief` omitted `storeys`,
 * so the host asked; the user answered **"single storey"**; the model called the
 * tool again. At that moment `userMessage` was "single storey" — the 100 m² was
 * two turns behind, and a backstop reading only the latest message recovers
 * nothing.
 *
 * What *did* still carry it was the model's own objective, inside the same tool
 * call: "design a 100m2 apartment with 2 bedrooms, 1 bathroom, and a small
 * office". A model that read the requirement well enough to paraphrase it and
 * then failed to put it in a numeric argument has still told us the number.
 *
 * `BACKSTOP_TOPICS` is what makes reading a paraphrase safe: those four patterns
 * need an explicit number beside an explicit noun, so a restatement either
 * contains the figure or matches nothing.
 */
function backstopTexts(fields: {
  readonly userMessage?: string;
  readonly utterance?: string;
  readonly objectives?: readonly string[];
}): readonly (string | undefined)[] {
  return [fields.userMessage, fields.utterance, ...(fields.objectives ?? [])];
}

/**
 * Relationships from a caller's fields, completed by what the sentence plainly
 * says (Bug 004, ADR-AI-0003 Rule 7).
 *
 * The same asymmetry the topic backstop uses, and for the same reason: the
 * deterministic reader goes in first and the caller's own relationships land on
 * top, so a pair the model stated wins and a pair it missed is still captured.
 */
function mergedRelationships(
  existing: readonly SpaceRelationship[],
  supplied: readonly SpaceRelationship[],
  texts: readonly (string | undefined)[]
): readonly SpaceRelationship[] {
  let result = existing;
  for (const text of texts) {
    if (text === undefined || text.trim().length === 0) {
      continue;
    }
    for (const read of readSpaceRelationships(text)) {
      result = withRelationship(result, read);
    }
  }
  for (const relationship of supplied) {
    result = withRelationship(result, relationship);
  }
  return result;
}

/** Applies every default the requirements do not already cover. */
function withDefaults(requirements: readonly BriefRequirement[]): {
  readonly requirements: readonly BriefRequirement[];
  readonly assumptions: readonly string[];
} {
  let result = requirements;
  const assumptions: string[] = [];

  for (const candidate of DEFAULTED_TOPICS) {
    if (result.some((requirement) => requirement.topic === candidate.topic)) {
      continue;
    }
    result = withRequirement(result, {
      topic: candidate.topic,
      statement: candidate.statement,
      value: candidate.value,
      source: BRIEF_REQUIREMENT_SOURCES.Assumed
    });
    assumptions.push(candidate.assumption);
  }

  return { requirements: result, assumptions };
}

/**
 * The objective line a Brief opens with.
 *
 * The user's own sentence, cleaned of the imperative that addressed the
 * assistant rather than the building: "Design a family home" is an instruction,
 * "a family home" is an objective, and the artefact outlives the instruction.
 */
function objectiveFrom(utterance: string): string {
  const trimmed = utterance.trim().replace(/\s+/g, ' ');
  const withoutVerb = trimmed.replace(
    /^(please\s+)?(design|plan|lay\s?out|conceive|sketch|propose|create|build|make)\s+(me\s+)?/i,
    ''
  );
  const objective = withoutVerb.length > 0 ? withoutVerb : trimmed;
  return objective.charAt(0).toUpperCase() + objective.slice(1).replace(/[.!]+$/, '');
}

export interface AssembleBriefOptions {
  readonly utterance: string;
  readonly classification: RequestClassification;
  readonly now?: number;
}

/**
 * A Brief from one complete request.
 *
 * Only called for the `brief-generation` lane: a request with mandatory topics
 * outstanding produces {@link startBriefDraft} instead, because a Brief with
 * open questions must never be offered for approval.
 */
export function assembleBrief(options: AssembleBriefOptions): ArchitecturalBrief {
  const stated = readBriefTopics(options.utterance);
  const { requirements, assumptions } = withDefaults(stated);

  return createBrief({
    utterance: options.utterance,
    objectives: [objectiveFrom(options.utterance)],
    desiredSpaces: desiredSpacesFrom(options.utterance, requirements),
    relationships: readSpaceRelationships(options.utterance),
    requirements,
    assumptions,
    openQuestions: [],
    ...(options.now === undefined ? {} : { now: options.now })
  });
}

/**
 * A draft Brief for a request that is missing mandatory topics.
 *
 * Defaults are deliberately *not* applied yet: a draft that already claimed "no
 * garage" while still asking how many bedrooms would be answering questions
 * nobody asked in the middle of asking one. They land when the draft completes.
 */
export function startBriefDraft(options: AssembleBriefOptions): ArchitecturalBrief {
  const stated = readBriefTopics(options.utterance);

  return createBrief({
    utterance: options.utterance,
    objectives: [objectiveFrom(options.utterance)],
    desiredSpaces: desiredSpacesFrom(options.utterance, stated),
    relationships: readSpaceRelationships(options.utterance),
    requirements: stated,
    assumptions: [],
    openQuestions: options.classification.missing,
    ...(options.now === undefined ? {} : { now: options.now })
  });
}

/**
 * The next revision of an **approved** Brief, from what the user just said
 * (Sprint 1.3, Story 1.3.5 — ADR-0027.1 Rule 4).
 *
 * Until this sprint there was no such path. A user who re-described their
 * building after approving a Brief went through {@link assembleBrief}, which
 * mints a **new id at revision 1** — a second lineage rather than a second
 * revision. Staleness was still detected downstream, because `matchesBrief`
 * compares the id as well as the revision, but the record of what the user
 * approved *first* was disconnected from what they approved instead, which is
 * the one thing a Brief exists to preserve.
 *
 * ## A patch, not a replacement
 *
 * Topics stated in the new utterance override their topic; everything else is
 * carried forward **with its original `source`**, so a requirement the user
 * stated three turns ago is not quietly downgraded to an assumption. A user
 * correcting the bathroom count should not lose the storey count they gave
 * earlier, and a replacement would take it.
 *
 * `objectives` are carried forward too: "actually make it 4 bedrooms" is not a
 * statement about what the building is for, and recomputing the objective from
 * it would replace "A family home" with the correction that changed one number.
 * The revision changes requirements; the point of the building is unchanged
 * until the user says otherwise.
 *
 * `utterance` **is** replaced, because it is the sentence *this* revision was
 * built from. The previous one keeps the previous words — that is what the
 * lineage is for.
 *
 * Answers `undefined` when the utterance moves nothing: a request that restates
 * what the Brief already says is not a revision, and returning revision n+1
 * identical to revision n would be supersession theatre. The caller treats it as
 * a fresh request instead, exactly as {@link answerClarification}'s caller does.
 */
export function reviseBriefFrom(
  approved: ArchitecturalBrief,
  utterance: string
): ArchitecturalBrief | undefined {
  return reviseBriefFromFields(approved, {
    utterance,
    requirements: readBriefTopics(utterance)
  });
}

/**
 * The one folding rule (Sprint 1.5, Story 1.5.1 — Bug 002).
 *
 * Three things can now produce a Brief for a project that already has one: a
 * `planning_captureBrief` call, a design request that arrives without a revision
 * cue, and a clarification dialogue that completes. Before this sprint each of
 * them minted a **new lineage**, and Sprint 1.3's integrity check then reported
 * the project as ambiguous — correctly, and fatally, since the blocker leaves no
 * stage eligible and no way back.
 *
 * So all three fold through here. Two readers sit in front of it —
 * {@link reviseBriefFrom} for an utterance, the tool for structured fields — and
 * neither holds an opinion about what "the same Brief, changed" means.
 *
 * ## What folding is
 *
 * Settled by Story 1.3.5 and unchanged: a stated topic **overrides its topic**,
 * everything else is carried forward **with its original `source`** so a
 * requirement the user stated does not quietly become an assumption, desired
 * spaces are merged, and `objectives` are carried forward because a correction is
 * not a new purpose.
 *
 * `utterance` is replaced only when the caller has one. A tool call carries
 * structured fields and no sentence of its own, so the Brief keeps the words it
 * was first described with rather than losing them to a re-capture.
 *
 * @returns `undefined` when nothing moved — the caller answers `NothingToDo`
 * rather than superseding revision _n_ with an identical revision _n+1_.
 */
export function reviseBriefFromFields(
  approved: ArchitecturalBrief,
  fields: {
    readonly utterance?: string;
    /** The same loose shape {@link assembleBriefFromFields} accepts, so both readers agree. */
    readonly requirements?: readonly SuppliedRequirement[];
    readonly spaces?: readonly DesiredSpace[];
    readonly relationships?: readonly SpaceRelationship[];
    /** The model's own words for this Brief, also read by the backstop (Bug 005). */
    readonly objectives?: readonly string[];
    /**
     * The user's own words, for {@link withBackstopTopics} (Bug 003). Distinct
     * from `utterance`, which is what the Brief quotes back: a caller may have a
     * message to re-read without having a sentence worth replacing the Brief's
     * own with.
     */
    readonly userMessage?: string;
  }
): ArchitecturalBrief | undefined {
  let requirements = approved.requirements;
  for (const supplied of withBackstopTopics(fields.requirements ?? [], backstopTexts(fields))) {
    requirements = withRequirement(requirements, {
      topic: supplied.topic,
      value: supplied.value,
      statement: supplied.statement ?? `${supplied.topic}: ${String(supplied.value)}`,
      // A topic the caller restated is one the user stated, whatever the Brief
      // assumed before. Topics they did not mention keep the source they had —
      // that is what `withRequirement` replacing by topic gives us.
      source: supplied.source ?? BRIEF_REQUIREMENT_SOURCES.Stated
    });
  }

  // Change is judged on what the caller *supplied*, never on the merged result.
  // `mergeSpaces` also derives spaces from the requirements — a brief whose
  // desired spaces named only bedrooms gains a bathroom from the bathroom count
  // — and that enrichment is not the user telling us something new. Comparing
  // the merged list would make every identical re-capture look like a change,
  // which is exactly the loop Story 1.5.3 exists to end.
  const addedSpaces = (fields.spaces ?? []).filter(
    (space) =>
      !approved.desiredSpaces.some(
        (existing) => existing.name === space.name && existing.count === space.count
      )
  );

  // A relationship the Brief did not already hold is the user telling us
  // something new, exactly as a changed requirement is (Bug 004).
  const relationships = mergedRelationships(
    approved.relationships,
    fields.relationships ?? [],
    backstopTexts(fields)
  );

  if (
    !requirementsChanged(approved.requirements, requirements) &&
    addedSpaces.length === 0 &&
    !relationshipsChanged(approved.relationships, relationships)
  ) {
    return undefined;
  }

  return reviseBrief(approved, {
    ...(fields.utterance === undefined ? {} : { utterance: fields.utterance }),
    requirements,
    relationships,
    desiredSpaces: mergeSpaces([...approved.desiredSpaces, ...addedSpaces], requirements)
  });
}

/** Whether any pair gained, lost or changed its kind. Sources are not compared. */
function relationshipsChanged(
  before: readonly SpaceRelationship[],
  after: readonly SpaceRelationship[]
): boolean {
  if (before.length !== after.length) {
    return true;
  }
  const key = (relationship: SpaceRelationship): string =>
    [relationship.from.toLowerCase(), relationship.to.toLowerCase()].sort().join('|');

  return after.some((relationship) => {
    const previous = before.find((candidate) => key(candidate) === key(relationship));
    return previous === undefined || previous.kind !== relationship.kind;
  });
}

/** Whether any topic gained, lost or changed a value. Sources are not compared. */
function requirementsChanged(
  before: readonly BriefRequirement[],
  after: readonly BriefRequirement[]
): boolean {
  if (before.length !== after.length) {
    return true;
  }
  return after.some((requirement) => {
    const previous = before.find((candidate) => candidate.topic === requirement.topic);
    return previous === undefined || previous.value !== requirement.value;
  });
}

/**
 * Folds one clarification answer into a draft.
 *
 * The answer is read twice on purpose. A full sentence — "two bathrooms and a
 * garage" — goes through the same reader the original request did, so a user
 * who answers more than was asked is not made to answer it again. A bare reply —
 * "two", "yes" — carries no topic word at all, so it is attributed to the
 * question that was open.
 *
 * When the last mandatory topic is answered the defaults land and the draft
 * becomes a complete Brief, which is Story 27.8.2's "clarification stops as soon
 * as the brief is complete" — it stops because there is nothing left to ask, not
 * because a turn limit was reached.
 */
export function answerClarification(draft: ArchitecturalBrief, answer: string): ArchitecturalBrief {
  const asked = draft.openQuestions[0];
  let requirements = draft.requirements;

  for (const stated of readBriefTopics(answer, BRIEF_REQUIREMENT_SOURCES.Answered)) {
    requirements = withRequirement(requirements, stated);
  }

  // Only when the reader found nothing for the topic actually being asked: a
  // reply of "two" to "how many bedrooms?" means bedrooms, and "yes" to "a
  // garage?" means a garage.
  if (
    asked !== undefined &&
    !requirements.some((r) => r.topic === asked && r.source !== BRIEF_REQUIREMENT_SOURCES.Stated)
  ) {
    const bare = bareAnswerFor(asked, answer);
    if (bare !== undefined) {
      requirements = withRequirement(requirements, bare);
    }
  }

  const answered = new Set(requirements.map((requirement) => requirement.topic));
  const openQuestions = draft.openQuestions.filter((topic) => !answered.has(topic));

  if (openQuestions.length > 0) {
    return reviseBrief(draft, { requirements, openQuestions });
  }

  const complete = withDefaults(requirements);
  return reviseBrief(draft, {
    requirements: complete.requirements,
    // A user answering "how many bathrooms?" may say more than was asked, and a
    // relationship stated in that answer is as explicit as one in the first
    // sentence (Bug 004, Rule 7).
    relationships: mergedRelationships(draft.relationships, [], [answer]),
    assumptions: [...draft.assumptions, ...complete.assumptions],
    desiredSpaces: mergeSpaces(draft.desiredSpaces, complete.requirements),
    openQuestions: []
  });
}

/** The bare form of an answer, interpreted as the open topic asks. */
function bareAnswerFor(topic: string, answer: string): BriefRequirement | undefined {
  const countable = MANDATORY_BRIEF_TOPICS.includes(topic) || topic === BRIEF_TOPICS.Storeys;

  if (countable) {
    const count = readBareCount(answer);
    // "none" answers a bathroom count; it does not answer a storey count, and a
    // brief saying "0 storeys" is not a building (Bug 006). Left unanswered, the
    // question is simply asked again.
    if (count === undefined || (topic === BRIEF_TOPICS.Storeys && count < 1)) {
      return undefined;
    }
    const noun = topic === BRIEF_TOPICS.Storeys ? 'storey' : topic.replace(/s$/, '');
    return {
      topic,
      statement: count === 1 ? `1 ${noun}` : `${count} ${noun}s`,
      value: count,
      source: BRIEF_REQUIREMENT_SOURCES.Answered
    };
  }

  const flag = readBareBoolean(answer);
  return flag === undefined
    ? undefined
    : {
        topic,
        statement: flag ? `a ${topic}` : `no ${topic}`,
        value: flag,
        source: BRIEF_REQUIREMENT_SOURCES.Answered
      };
}

/**
 * The spaces a bedroom or bathroom *count* names, for a caller that listed
 * neither (Bug 003).
 *
 * `planning_captureBrief` exposes bedrooms and bathrooms as dedicated numeric
 * arguments *and* accepts a `spaces` array, so a model that passes
 * `bedrooms: 3` and lists only the kitchen has answered the question it was
 * asked. Before this, that Brief carried one desired space, and the Space
 * Programme built a three-bedroom house with no bedrooms in it — the count was
 * in `requirements` where nothing downstream reads it as a space.
 *
 * The offline path never had this gap: `assembleBrief` runs `desiredSpacesFrom`
 * over the utterance, which derives exactly these two from the counts. Passing
 * an empty text reuses that derivation and *only* that — re-reading the space
 * names would let `NAMED_SPACES` match inside a compound the user chose, turning
 * "dining/lounge" into a second, separate living room.
 */
function withCountedSpaces(
  supplied: readonly DesiredSpace[],
  requirements: readonly BriefRequirement[]
): readonly DesiredSpace[] {
  const has = (name: string): boolean =>
    supplied.some((space) => space.name.trim().toLowerCase().replace(/s$/, '') === name);

  const counted = desiredSpacesFrom('', requirements).filter((space) => !has(space.name));
  return counted.length === 0 ? supplied : [...supplied, ...counted];
}

/**
 * The spaces a completed draft implies, now that its counts are known.
 *
 * Recomputed from the final requirements rather than accumulated turn by turn,
 * so a bedroom count answered in the third message produces the same desired
 * spaces as one stated in the first.
 */
function mergeSpaces(
  existing: readonly DesiredSpace[],
  requirements: readonly BriefRequirement[]
): readonly DesiredSpace[] {
  const derived = desiredSpacesFrom(existing.map((space) => space.name).join(' '), requirements);
  const names = new Set(derived.map((space) => space.name));
  return [...derived, ...existing.filter((space) => !names.has(space.name))];
}

/**
 * A Brief from fields a language model supplied through a tool call
 * (ADR-0027.1 Rule 6).
 *
 * The model names objectives, spaces and counts; this decides what a Brief is,
 * applies the same defaults the offline path applies, and records the same
 * assumptions. Anything the model leaves out is missing, not invented — a
 * `brief` that arrived without a bedroom count comes back with that topic still
 * open, and the host asks.
 */
export function assembleBriefFromFields(fields: {
  readonly utterance: string;
  readonly objectives?: readonly string[];
  readonly spaces?: readonly DesiredSpace[];
  readonly requirements?: readonly SuppliedRequirement[];
  readonly relationships?: readonly SpaceRelationship[];
  /** The user's own words, for {@link withBackstopTopics} (Bug 003). */
  readonly userMessage?: string;
  readonly now?: number;
}): ArchitecturalBrief {
  let requirements: readonly BriefRequirement[] = [];
  for (const supplied of withBackstopTopics(fields.requirements ?? [], backstopTexts(fields))) {
    requirements = withRequirement(requirements, {
      topic: supplied.topic,
      value: supplied.value,
      statement: supplied.statement ?? `${supplied.topic}: ${String(supplied.value)}`,
      source: supplied.source ?? BRIEF_REQUIREMENT_SOURCES.Stated
    });
  }

  const answered = new Set(requirements.map((requirement) => requirement.topic));
  const openQuestions = MANDATORY_BRIEF_TOPICS.filter((topic) => !answered.has(topic));

  // Defaults are for a Brief that is otherwise complete, exactly as on the
  // offline path — an incomplete one keeps its questions instead.
  const finished = openQuestions.length === 0 ? withDefaults(requirements) : undefined;

  return createBrief({
    utterance: fields.utterance,
    objectives:
      fields.objectives !== undefined && fields.objectives.length > 0
        ? fields.objectives
        : [objectiveFrom(fields.utterance)],
    desiredSpaces: withCountedSpaces(fields.spaces ?? [], finished?.requirements ?? requirements),
    relationships: mergedRelationships([], fields.relationships ?? [], backstopTexts(fields)),
    requirements: finished?.requirements ?? requirements,
    assumptions: finished?.assumptions ?? [],
    openQuestions,
    ...(fields.now === undefined ? {} : { now: fields.now })
  });
}
