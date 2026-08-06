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
  withRequirement,
  type ArchitecturalBrief,
  type BriefRequirement,
  type DesiredSpace
} from './architectural-brief';
import { desiredSpacesFrom, readBareBoolean, readBareCount, readBriefTopics } from './brief-topics';
import { MANDATORY_BRIEF_TOPICS, type RequestClassification } from './request-classification';

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
    requirements: stated,
    assumptions: [],
    openQuestions: options.classification.missing,
    ...(options.now === undefined ? {} : { now: options.now })
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
    if (count === undefined) {
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
  readonly requirements?: readonly {
    readonly topic: string;
    readonly value: string | number | boolean;
    readonly statement?: string;
  }[];
  readonly now?: number;
}): ArchitecturalBrief {
  let requirements: readonly BriefRequirement[] = [];
  for (const supplied of fields.requirements ?? []) {
    requirements = withRequirement(requirements, {
      topic: supplied.topic,
      value: supplied.value,
      statement: supplied.statement ?? `${supplied.topic}: ${String(supplied.value)}`,
      source: BRIEF_REQUIREMENT_SOURCES.Stated
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
    desiredSpaces: fields.spaces ?? [],
    requirements: finished?.requirements ?? requirements,
    assumptions: finished?.assumptions ?? [],
    openQuestions,
    ...(fields.now === undefined ? {} : { now: fields.now })
  });
}
