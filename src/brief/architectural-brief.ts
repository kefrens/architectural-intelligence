/**
 * The Architectural Brief (Sprint 27.8, Epic 1 — ADR-0027.1's first planning
 * artefact).
 *
 * What the user is trying to achieve, written down before anything has been
 * drawn. A Brief is the answer to "what is this building for", and it is
 * deliberately *not* the answer to "what rooms, how big, where" — that is the
 * Space Programme's job (Sprint 27.9), and the difference is the whole point of
 * splitting the two.
 *
 * ## What it must not contain
 *
 * No coordinates, no walls, no openings, no adjacency, no allocated areas
 * (ADR-0027.1 Rule 3). This module therefore imports nothing from
 * `@archisimple/automation-api` or `@archisimple/geometry`, and the package's
 * architecture-compliance test asserts it rather than trusting the reviewer:
 * a Brief that could carry a `CommandRequest` would collapse four pipeline
 * stages into one within a sprint.
 *
 * A stated *total* area is the exception, and only in appearance. "Design a
 * 100 m² family home" records that the user said 100 m²; it does not allocate
 * a single square metre to a single space. Recording what the user asked for
 * is this artefact's entire job, and dropping the number because it has units
 * attached would lose the requirement the whole brief exists to hold.
 *
 * ## Why requirements are a list rather than fields
 *
 * `storeys`, `bathrooms`, `garage`, `style` and `budget` could each have been a
 * property. They are one extensible list instead because ADR-0027.1's plugin
 * model has Template, Urban Rules and Budget Providers contributing to this
 * artefact — a closed record would make every one of them a change to this
 * file, and a plugin's requirement a second-class citizen next to the built-in
 * ones. The built-in topics are named in {@link BRIEF_TOPICS} for readability;
 * the field is a string, exactly as `ArchitecturalIntent.action` is.
 *
 * ## Revisions
 *
 * ADR-0027.1 Rule 4: an approved artefact is never edited. {@link reviseBrief}
 * returns a new object carrying the same `id` and the next `revision`, which is
 * what supersession means here — the previous revision stays readable in the
 * conversation it was approved in.
 */

import { createUuid } from '@archisimple/shared';
import type { EnrichedArtefact } from '../artefacts/enriched-artefact.js';

/** The artefact kind, as carried by `ProposalArtefact.kind` and stored in the project file. */
export const ARCHITECTURAL_BRIEF_KIND = 'architectural-brief';

/**
 * The topics the built-in reader recognises.
 *
 * The first three are mandatory (see `request-classification.ts`): a dwelling
 * brief that does not say how many storeys, bedrooms and bathrooms is missing
 * information no default can honestly invent. The rest have defaults, because
 * asking a user whether they want a garage before they have said anything about
 * the house is the interrogation Story 27.8.2 exists to prevent.
 */
export const BRIEF_TOPICS = {
  Storeys: 'storeys',
  Bedrooms: 'bedrooms',
  Bathrooms: 'bathrooms',
  Garage: 'garage',
  Office: 'office',
  Accessibility: 'accessibility',
  Style: 'style',
  Budget: 'budget',
  TotalArea: 'totalArea'
} as const;

export type BriefTopic = (typeof BRIEF_TOPICS)[keyof typeof BRIEF_TOPICS];

/**
 * Where a requirement's value came from.
 *
 * The distinction is what lets the Brief be honest about itself: `assumed`
 * values also appear in {@link ArchitecturalBrief.assumptions}, so a user
 * reading the artefact can tell what they said from what the platform decided
 * for them (Story 27.8.2's "sensible defaults may be proposed").
 */
export const BRIEF_REQUIREMENT_SOURCES = {
  /** Read out of the user's original request. */
  Stated: 'stated',
  /** Supplied in answer to a clarification question. */
  Answered: 'answered',
  /** A default the platform applied, and said so. */
  Assumed: 'assumed'
} as const;

export type BriefRequirementSource =
  (typeof BRIEF_REQUIREMENT_SOURCES)[keyof typeof BRIEF_REQUIREMENT_SOURCES];

export interface BriefRequirement {
  /** A {@link BRIEF_TOPICS} value, or a topic a plugin contributed. */
  readonly topic: string;
  /** User-facing, and already a sentence fragment: "2 storeys", "a garage". */
  readonly statement: string;
  readonly value: string | number | boolean;
  readonly source: BriefRequirementSource;
}

/**
 * A space the user asked for, by name and count — never by area.
 *
 * "three bedrooms" is a desire. "three bedrooms of 12 m² each" is a programme,
 * and belongs one stage down (Rule 3).
 */
export interface DesiredSpace {
  readonly name: string;
  readonly count: number;
}

export interface ArchitecturalBrief extends EnrichedArtefact {
  readonly kind: typeof ARCHITECTURAL_BRIEF_KIND;
  /** Stable across revisions. */
  readonly id: string;
  /** 1 for a first draft; incremented by {@link reviseBrief}. */
  readonly revision: number;
  readonly createdAt: number;
  /** The user's words, kept verbatim so the artefact can quote what it was built from. */
  readonly utterance: string;
  /** What the user is trying to achieve, in their terms. */
  readonly objectives: readonly string[];
  readonly desiredSpaces: readonly DesiredSpace[];
  readonly requirements: readonly BriefRequirement[];
  /** What was decided for the user rather than by them. */
  readonly assumptions: readonly string[];
  /** Mandatory topics still unanswered. Empty means the Brief is complete. */
  readonly openQuestions: readonly string[];
}

export function createBrief(input: {
  readonly utterance: string;
  readonly objectives?: readonly string[];
  readonly desiredSpaces?: readonly DesiredSpace[];
  readonly requirements?: readonly BriefRequirement[];
  readonly assumptions?: readonly string[];
  readonly openQuestions?: readonly string[];
  readonly now?: number;
}): ArchitecturalBrief {
  return {
    kind: ARCHITECTURAL_BRIEF_KIND,
    id: createUuid(),
    revision: 1,
    createdAt: input.now ?? Date.now(),
    utterance: input.utterance,
    objectives: input.objectives ?? [],
    desiredSpaces: input.desiredSpaces ?? [],
    requirements: input.requirements ?? [],
    assumptions: input.assumptions ?? [],
    openQuestions: input.openQuestions ?? []
  };
}

/**
 * The next revision of a brief (Rule 4).
 *
 * Same identity, incremented revision, patched contents. Nothing here mutates
 * the input, so a superseded revision held by an approved proposal stays exactly
 * as the user approved it.
 *
 * `utterance` joined the patch in Sprint 1.3, when revising an approved Brief
 * became a production path. A revision built from a second sentence was built
 * from that sentence, and the field's whole job is to let the artefact quote
 * what it came from. The previous revision keeps the previous words, which is
 * what the lineage is for.
 */
export function reviseBrief(
  brief: ArchitecturalBrief,
  patch: Partial<
    Pick<
      ArchitecturalBrief,
      | 'utterance'
      | 'objectives'
      | 'desiredSpaces'
      | 'requirements'
      | 'assumptions'
      | 'openQuestions'
    >
  >
): ArchitecturalBrief {
  return { ...brief, ...patch, revision: brief.revision + 1 };
}

export function briefRequirement(
  brief: ArchitecturalBrief,
  topic: string
): BriefRequirement | undefined {
  return brief.requirements.find((requirement) => requirement.topic === topic);
}

/**
 * Adds or replaces a requirement, keyed on topic.
 *
 * Replacement rather than accumulation: a user who answers "two" and then
 * "actually three" has three bathrooms, not both.
 */
export function withRequirement(
  requirements: readonly BriefRequirement[],
  requirement: BriefRequirement
): readonly BriefRequirement[] {
  return [
    ...requirements.filter((candidate) => candidate.topic !== requirement.topic),
    requirement
  ];
}

/** A Brief with nothing left to ask. Only a complete Brief is offered for approval. */
export function isBriefComplete(brief: ArchitecturalBrief): boolean {
  return brief.openQuestions.length === 0;
}

/**
 * The Brief as markdown, for the conversation message that carries it.
 *
 * The proposal card renders the artefact's title, assumptions and explanation
 * from the `Proposal` fields it already knows; this is the artefact's own body,
 * which no existing card field could hold.
 */
export function summarizeBrief(brief: ArchitecturalBrief): string {
  const lines: string[] = [];

  if (brief.objectives.length > 0) {
    lines.push('**Objectives**', ...brief.objectives.map((objective) => `- ${objective}`), '');
  }

  if (brief.desiredSpaces.length > 0) {
    lines.push(
      '**Spaces**',
      ...brief.desiredSpaces.map((space) =>
        space.count === 1 ? `- ${space.name}` : `- ${space.count} × ${space.name}`
      ),
      ''
    );
  }

  if (brief.requirements.length > 0) {
    lines.push(
      '**Requirements**',
      ...brief.requirements.map((requirement) => `- ${requirement.statement}`),
      ''
    );
  }

  if (brief.openQuestions.length > 0) {
    lines.push('**Still to decide**', ...brief.openQuestions.map((topic) => `- ${topic}`), '');
  }

  // A brief with no content at all is possible — an utterance that named a
  // dwelling and nothing else — and saying so beats rendering an empty document.
  return lines.length === 0 ? '_This brief is still empty._' : lines.join('\n').trimEnd();
}
