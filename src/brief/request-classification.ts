/**
 * Intent Completeness Analysis (Sprint 27.8, Story 27.8.0).
 *
 * The pipeline's front door: three lanes, chosen deterministically from the
 * user's words before any provider is consulted.
 *
 * ```text
 * "create a wall from 0,0 to 4,0"     -> direct-execution
 * "design a 2-storey, 3-bed, 2-bath   -> brief-generation
 *  family home"
 * "design a family home"              -> clarification-required
 * ```
 *
 * ## Why the default lane is Direct Execution
 *
 * Because the cost of the two mistakes is not symmetric. Sending a genuinely
 * architectural request down the direct lane produces geometry a user can
 * inspect, reject and ask again for. Sending "create a wall" down the brief lane
 * interrupts a working modelling command with an interview, which is the one
 * outcome Story 27.8.3 exists to forbid. So the classifier looks for positive
 * evidence of a *programme* and falls through to the existing pipeline when it
 * finds none — Direct Execution is a lane of this architecture rather than an
 * exception to it (ADR-0027.1 Rule 2), and it is the lane everything shipped
 * before this sprint stays in.
 *
 * ## What counts as evidence
 *
 * A dwelling. `house`, `apartment`, `T4` — a whole building somebody will live
 * in. Not an area, and not the word "design": "create a room of 16 m²" states
 * its own programme and is a modelling command; "how many rooms does my house
 * have?" names a dwelling but asks a question the Building Platform can already
 * answer, and questions are recognised first for exactly that reason.
 */

import { ARCHITECTURAL_INTENT_KINDS } from '../intent/architectural-intent';
import { recognizeIntent } from '../intent/intent-recognizer';
import { BRIEF_TOPICS } from './architectural-brief';
import { DWELLING_WORDS, readBriefTopics } from './brief-topics';

export const REQUEST_LANES = {
  /** Straight to the existing pipeline. Everything that worked before this sprint. */
  DirectExecution: 'direct-execution',
  /** Enough was said to write a Brief without asking anything. */
  BriefGeneration: 'brief-generation',
  /** Architectural, but mandatory information is missing. */
  ClarificationRequired: 'clarification-required'
} as const;

export type RequestLane = (typeof REQUEST_LANES)[keyof typeof REQUEST_LANES];

export interface RequestClassification {
  readonly lane: RequestLane;
  /** One sentence, quotable in an explanation, saying why this lane. */
  readonly reason: string;
  /** The programme evidence found. Empty for Direct Execution. */
  readonly signals: readonly string[];
  /**
   * Mandatory topics the request left out. Non-empty exactly when the lane is
   * {@link REQUEST_LANES.ClarificationRequired}.
   */
  readonly missing: readonly string[];
}

/**
 * The topics a dwelling brief cannot be completed without.
 *
 * Three, and no more. Every additional mandatory topic is another question
 * between the user and their first drawing, and each of these three changes the
 * building fundamentally — there is no defensible default for how many bedrooms
 * somebody wants. Everything else has a default (`brief-assembly.ts`), which is
 * how "clarification stops as soon as the brief is complete" stays true of a
 * short conversation rather than a long one.
 */
export const MANDATORY_BRIEF_TOPICS: readonly string[] = [
  BRIEF_TOPICS.Storeys,
  BRIEF_TOPICS.Bedrooms,
  BRIEF_TOPICS.Bathrooms
];

/** Verbs that ask for a building to be conceived rather than an entity to be drawn. */
const DESIGN_VERBS = /\b(design|plan|lay\s?out|conceive|sketch|propose|create|build|make)\b/i;

export interface ClassifyRequestOptions {
  /**
   * Topics already settled by an earlier turn — the requirements of an open
   * draft. A follow-up that supplies the last missing answer classifies as
   * {@link REQUEST_LANES.BriefGeneration}, not as another round of questions.
   */
  readonly known?: readonly string[];
}

export function classifyRequest(
  utterance: string,
  options: ClassifyRequestOptions = {}
): RequestClassification {
  const trimmed = utterance.trim();

  // Questions first. "How many bedrooms does my house have?" names a dwelling
  // and is emphatically not a request to design one — and the Building
  // Platform can answer it today, which is the definition of Direct Execution.
  if (recognizeIntent(trimmed).kind === ARCHITECTURAL_INTENT_KINDS.Question) {
    return direct('This is a question about the existing project.');
  }

  const signals: string[] = [];
  const dwelling = trimmed.match(DWELLING_WORDS);
  if (dwelling) {
    signals.push(dwelling[0].toLowerCase());
  }
  const typology = trimmed.match(/\b[TF]\s?[1-9]\b/i);
  if (typology) {
    signals.push(typology[0].toUpperCase());
  }

  if (signals.length === 0) {
    return direct('No whole dwelling is named, so this is a modelling request.');
  }

  // A dwelling can also be *mentioned* in a modelling command — "move the
  // kitchen in my house 2 m north". Requiring a design verb as well is what
  // keeps that in the direct lane.
  if (!DESIGN_VERBS.test(trimmed)) {
    return direct('A dwelling is mentioned, but nothing is asked to be designed.');
  }

  const stated = readBriefTopics(trimmed);
  const answered = new Set([
    ...stated.map((requirement) => requirement.topic),
    ...(options.known ?? [])
  ]);
  const missing = MANDATORY_BRIEF_TOPICS.filter((topic) => !answered.has(topic));

  if (missing.length > 0) {
    return {
      lane: REQUEST_LANES.ClarificationRequired,
      reason: `This is a design request, and ${missing.length === 1 ? 'one mandatory topic is' : `${missing.length} mandatory topics are`} unanswered.`,
      signals,
      missing
    };
  }

  return {
    lane: REQUEST_LANES.BriefGeneration,
    reason: 'This is a design request and every mandatory topic is answered.',
    signals,
    missing: []
  };
}

function direct(reason: string): RequestClassification {
  return { lane: REQUEST_LANES.DirectExecution, reason, signals: [], missing: [] };
}
