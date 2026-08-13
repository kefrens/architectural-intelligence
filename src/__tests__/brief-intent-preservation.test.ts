/**
 * Bug 007 — explicit user intent must survive the walk to a Programme.
 *
 * The reported conversation asked for a 100 m² apartment and a small home
 * office, and produced a Brief carrying a `home office` space, the requirement
 * "no home office" and the assumption "No home office, since none was
 * mentioned" — all three at once — with the 100 m² gone entirely, so the
 * Programme reported "No total was stated" and sized the flat from its own
 * table.
 *
 * Two transitions were wrong, both in Conversation → Brief:
 *
 * - `withDefaults` decided from `requirements` alone, so a topic the model
 *   stated by naming its *space* was defaulted to false. §4's rule, violated
 *   literally: unspecified became false.
 * - the Bug 003 backstop could reach only the latest user message, and the
 *   100 m² was four turns behind by the time the Brief was captured.
 *
 * So these tests start where the conversation does — a tool call with a real
 * conversation fragment behind it — and assert **semantic values**, never
 * prose (§6). A test that hand-built a Brief with `totalArea: 100` in it would
 * have passed throughout.
 */

import { describe, expect, it } from 'vitest';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import {
  assembleBrief,
  ARCHITECTURAL_BRIEF_KIND,
  BRIEF_REQUIREMENT_SOURCES,
  BRIEF_TOPICS,
  briefRequirement,
  classifyRequest,
  type ArchitecturalBrief
} from '../brief/index.js';
import { AREA_SOURCES, synthesizeProgramme, type SpaceProgramme } from '../programme/index.js';
import { createCaptureBriefToolDefinition } from '../tools/index.js';
import { createHarness } from './harness.js';

/**
 * The reported conversation, newest first — the order the `conversation`
 * context fragment reports it in.
 */
const USER_MESSAGES: readonly string[] = [
  'modern style, and no budget to speak of',
  '2 bathrooms, and a small home office',
  '2 bedrooms',
  'single storey',
  'Can you build me a 100m2 appartment?'
];

/**
 * What the model sent once the dialogue completed.
 *
 * No `totalArea` — it was four turns behind and the objective did not repeat it.
 * No `office` flag either: the office is in `spaces`, which is where a model
 * that has just been told "a small home office" naturally puts it.
 */
const FIELDS: Readonly<Record<string, unknown>> = {
  objectives: ['A modern single-storey apartment'],
  spaces: [
    { name: 'home office', count: 1 },
    { name: 'kitchen', count: 1 }
  ],
  storeys: 1,
  bedrooms: 2,
  bathrooms: 2,
  style: 'modern'
};

function service(): ArchitecturalIntelligenceService {
  return new ArchitecturalIntelligenceService({ knowledge: createHarness().knowledge });
}

/** Captures a Brief through the real tool, behind the real conversation fragment. */
function capture(
  fields: Readonly<Record<string, unknown>> = FIELDS,
  userMessages: readonly string[] = USER_MESSAGES
): ArchitecturalBrief {
  const resolved = createCaptureBriefToolDefinition(service()).resolve(fields, {
    conversation: { lastUserMessage: userMessages[0], userMessages }
  });
  if (resolved?.kind !== 'proposal') {
    throw new Error(
      `Expected a brief proposal, got ${resolved?.kind ?? 'nothing'}${
        resolved?.kind === 'blocked' ? `: ${resolved.message}` : ''
      }`
    );
  }
  const { subject } = resolved.proposal;
  if (subject.kind !== 'artefact' || subject.artefact.kind !== ARCHITECTURAL_BRIEF_KIND) {
    throw new Error('Expected an architectural brief artefact.');
  }
  return subject.artefact.value as ArchitecturalBrief;
}

function programmeFor(brief: ArchitecturalBrief): SpaceProgramme {
  const result = synthesizeProgramme({ brief });
  if (!result.ok) {
    throw new Error(`programme: ${result.message}`);
  }
  return result.programme;
}

const OFFICE = /office|study/i;

describe('the canonical 100 m² apartment (Bug 007 §6)', () => {
  it('keeps the stated total area, four turns after it was stated', () => {
    const total = briefRequirement(capture(), BRIEF_TOPICS.TotalArea);

    expect(total?.value).toBe(100);
    expect(total?.source).toBe(BRIEF_REQUIREMENT_SOURCES.Stated);
  });

  it('records the home office as requested, not as absent', () => {
    const office = briefRequirement(capture(), BRIEF_TOPICS.Office);

    expect(office?.value).toBe(true);
    expect(office?.source).not.toBe(BRIEF_REQUIREMENT_SOURCES.Assumed);
  });

  it('does not assume away a space it is carrying', () => {
    const brief = capture();

    expect(brief.desiredSpaces.some((space) => OFFICE.test(space.name))).toBe(true);
    expect(brief.assumptions.some((assumption) => OFFICE.test(assumption))).toBe(false);
  });

  it('still assumes the topics nothing said anything about', () => {
    // The fix removes a contradiction; it does not stop the platform having
    // defaults. Nobody mentioned a garage, and "no garage" is still the answer.
    const garage = briefRequirement(capture(), BRIEF_TOPICS.Garage);

    expect(garage?.value).toBe(false);
    expect(garage?.source).toBe(BRIEF_REQUIREMENT_SOURCES.Assumed);
  });

  it('scales the programme to the target the user gave', () => {
    const programme = programmeFor(capture());

    expect(programme.spaces.every((space) => space.areaSource === AREA_SOURCES.ScaledToStatedTotal))
      .toBe(true);
    expect(programme.assumptions.some((assumption) => /no total was stated/i.test(assumption)))
      .toBe(false);
  });

  it('carries the office into the programme as a required space', () => {
    const office = programmeFor(capture()).spaces.find((space) => OFFICE.test(space.name));

    expect(office).toBeDefined();
    // It was `optional` before: the space inherited the source of the
    // requirement that denied it.
    expect(office?.priority).toBe('required');
  });

  it('creates exactly one office, however the model named it', () => {
    const spaces = programmeFor(capture({ ...FIELDS, office: true })).spaces.filter((space) =>
      OFFICE.test(space.name)
    );

    expect(spaces).toHaveLength(1);
  });
});

describe('explicit, unspecified and explicitly rejected (Bug 007 §7)', () => {
  /** The offline path, so the reader rather than a tool call decides. */
  function briefFor(utterance: string): ArchitecturalBrief {
    return assembleBrief({ utterance, classification: classifyRequest(utterance) });
  }

  const REQUEST = 'Design a 2-storey house with 3 bedrooms and 2 bathrooms';

  it('an explicitly requested garage is stated and gets a space', () => {
    const brief = briefFor(`${REQUEST} and a garage`);
    const garage = briefRequirement(brief, BRIEF_TOPICS.Garage);

    expect(garage?.value).toBe(true);
    expect(garage?.source).toBe(BRIEF_REQUIREMENT_SOURCES.Stated);
    expect(brief.desiredSpaces.some((space) => /garage/i.test(space.name))).toBe(true);
  });

  it('an unmentioned garage is assumed, and says so', () => {
    const brief = briefFor(REQUEST);

    expect(briefRequirement(brief, BRIEF_TOPICS.Garage)?.source).toBe(
      BRIEF_REQUIREMENT_SOURCES.Assumed
    );
    expect(brief.assumptions.some((assumption) => /garage/i.test(assumption))).toBe(true);
  });

  it('an explicitly rejected garage is stated, not assumed', () => {
    const brief = briefFor(`${REQUEST}, no garage`);
    const garage = briefRequirement(brief, BRIEF_TOPICS.Garage);

    expect(garage?.value).toBe(false);
    expect(garage?.source).toBe(BRIEF_REQUIREMENT_SOURCES.Stated);
    // The refusal is the user's, so it is not recorded as something the platform
    // decided for them.
    expect(brief.assumptions.some((assumption) => /garage/i.test(assumption))).toBe(false);
  });

  it('a named space never overrules an explicit refusal', () => {
    // "a study, but no home office" is a strange thing to say, and resolving it
    // quietly would be worse than carrying it: only an `assumed` topic moves.
    const brief = capture({ ...FIELDS, office: false }, ['no home office, thanks']);

    expect(briefRequirement(brief, BRIEF_TOPICS.Office)?.value).toBe(false);
    expect(briefRequirement(brief, BRIEF_TOPICS.Office)?.source).toBe(
      BRIEF_REQUIREMENT_SOURCES.Stated
    );
  });
});

describe('the backstop’s reach (Bug 007 §4, defect B2)', () => {
  it('takes the most recent statement when the user changed their mind', () => {
    const brief = capture(FIELDS, [
      'actually make it 120m2',
      '2 bathrooms, and a small home office',
      'Can you build me a 100m2 appartment?'
    ]);

    expect(briefRequirement(brief, BRIEF_TOPICS.TotalArea)?.value).toBe(120);
  });

  it('recovers nothing when no turn carries a readable figure', () => {
    const brief = capture({ ...FIELDS, objectives: ['A place to live'] }, [
      'that sounds good to me',
      'yes please'
    ]);

    expect(briefRequirement(brief, BRIEF_TOPICS.TotalArea)).toBeUndefined();
  });
});
