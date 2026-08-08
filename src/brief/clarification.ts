/**
 * The Clarification Dialogue (Sprint 27.8, Story 27.8.2).
 *
 * "I want AI to ask only meaningful architectural questions." A question here is
 * not a new kind of thing: it is a {@link PlanBlocker} of reason
 * `missing-information`, whose `message` is the question and whose `suggestions`
 * are the answers worth offering.
 *
 * That reuse is ADR-0027.1 Rule 8, and it is worth saying why it is a rule
 * rather than a convenience. The planner has been able to say "the request left
 * out something needed" since Sprint 24.5, with a four-way vocabulary that
 * distinguishes missing information from ambiguity from an unsupported action
 * from a no-op. A second taxonomy for the Brief stage would mean the platform
 * had two answers to "what is missing", diverging from the first day one of them
 * grew a case the other lacked — and a host would have to render both.
 *
 * So there is one vocabulary, asked one stage earlier.
 */

import { PLAN_BLOCKER_REASONS, type PlanBlocker } from '../planning/architectural-plan.js';
import { BRIEF_TOPICS, type ArchitecturalBrief } from './architectural-brief.js';

/**
 * One open question.
 *
 * The question text and its suggested answers live in the blocker rather than
 * beside it, so a host that already renders blockers renders these unchanged.
 */
export interface ClarificationQuestion {
  /** The {@link BRIEF_TOPICS} value this question would answer. */
  readonly topic: string;
  readonly blocker: PlanBlocker;
}

export interface ClarificationDialogue {
  /** The Brief as far as it has been established. Never offered for approval while questions remain. */
  readonly draft: ArchitecturalBrief;
  /** Ordered; the first is the one to ask now. Never empty — an empty dialogue is a complete Brief. */
  readonly questions: readonly ClarificationQuestion[];
}

/** What each mandatory topic asks, and what it offers. */
const TOPIC_QUESTIONS: Readonly<
  Record<string, { readonly message: string; readonly suggestions: readonly string[] }>
> = {
  [BRIEF_TOPICS.Storeys]: {
    message: 'How many storeys should the building have?',
    suggestions: ['Single storey', 'Two storeys', 'Three storeys']
  },
  [BRIEF_TOPICS.Bedrooms]: {
    message: 'How many bedrooms do you need?',
    suggestions: ['2 bedrooms', '3 bedrooms', '4 bedrooms']
  },
  [BRIEF_TOPICS.Bathrooms]: {
    message: 'How many bathrooms do you need?',
    suggestions: ['1 bathroom', '2 bathrooms', '3 bathrooms']
  },
  [BRIEF_TOPICS.Garage]: {
    message: 'Should the design include a garage?',
    suggestions: ['Yes', 'No']
  },
  [BRIEF_TOPICS.Office]: {
    message: 'Do you need a home office?',
    suggestions: ['Yes', 'No']
  },
  [BRIEF_TOPICS.Accessibility]: {
    message: 'Does the home need to be step-free?',
    suggestions: ['Yes', 'No']
  }
};

/**
 * The blocker that stands for "this topic is unanswered".
 *
 * A topic with no entry in the table still produces a well-formed question —
 * a plugin contributing an Urban Rules topic gets a usable dialogue before it
 * gets a hand-written sentence.
 */
export function clarificationBlocker(topic: string): PlanBlocker {
  const known = TOPIC_QUESTIONS[topic];
  return {
    reason: PLAN_BLOCKER_REASONS.MissingInformation,
    message: known?.message ?? `What should the brief say about ${topic}?`,
    suggestions: known?.suggestions ?? []
  };
}

export function clarificationQuestion(topic: string): ClarificationQuestion {
  return { topic, blocker: clarificationBlocker(topic) };
}

/** The dialogue for a draft and the topics it is still missing. */
export function clarificationFor(
  draft: ArchitecturalBrief,
  topics: readonly string[]
): ClarificationDialogue {
  return { draft, questions: topics.map(clarificationQuestion) };
}

/**
 * The dialogue as markdown, for the conversation message that carries it.
 *
 * Only the first question is asked. Presenting all three at once is how a
 * clarification dialogue turns into the configuration form Story 27.8.2 is
 * written against; the rest are named as what is still to come so the user can
 * answer them in one sentence if they would rather.
 */
export function describeClarification(dialogue: ClarificationDialogue): string {
  const [first, ...rest] = dialogue.questions;
  if (!first) {
    return 'Nothing further to clarify.';
  }

  const lines = [first.blocker.message];
  if (first.blocker.suggestions.length > 0) {
    lines.push('', ...first.blocker.suggestions.map((suggestion) => `- ${suggestion}`));
  }
  if (rest.length > 0) {
    lines.push(
      '',
      `Then I still need to know about: ${rest.map((question) => question.topic).join(', ')}.`
    );
  }
  return lines.join('\n');
}
