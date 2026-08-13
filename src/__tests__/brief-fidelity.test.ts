/**
 * Bug 003 — what the user said must survive into the Programme.
 *
 * The reported symptom was a Space Programme totalling 91 m² for a request that
 * said 100 m². The Programme was not at fault: it scales to a stated total and
 * always did. The Brief it read had no total in it, because
 * `assembleBriefFromFields` built requirements from the tool call and nothing
 * else, and the model had not passed `totalArea`.
 *
 * So these tests start at the **tool call**, not at a hand-built Brief. A test
 * that constructs a Brief carrying `totalArea: 100` and asserts the programme
 * totals 100 passed before any of this was fixed, and would have gone on passing
 * while the bug shipped.
 *
 * The scenario is the real one, verbatim, from the E2E run that exposed it.
 */

import { describe, expect, it } from 'vitest';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import {
  answerClarification,
  ARCHITECTURAL_BRIEF_KIND,
  BRIEF_TOPICS,
  classifyRequest,
  startBriefDraft,
  type ArchitecturalBrief
} from '../brief/index.js';
import { synthesizeProgramme } from '../programme/index.js';
import { createCaptureBriefToolDefinition } from '../tools/index.js';
import { createHarness } from './harness.js';

/** The user's actual sentence, misspelling included. */
const REQUEST =
  'Build me a 100m2 appartment with 2 bedrooms, 1 bathrooms, and a small office. Kitchen and Dining/Lounge area are separated';

/**
 * What the model actually sent for it — note the absence of `totalArea`, which
 * is the whole bug. The tool's schema has offered that argument since Sprint
 * 27.8; the model simply did not use it.
 */
const FIELDS = {
  objectives: ['A 100 m² apartment'],
  spaces: [
    { name: 'bedroom', count: 2 },
    { name: 'bathroom', count: 1 },
    { name: 'office', count: 1 },
    { name: 'kitchen', count: 1 },
    { name: 'dining/lounge', count: 1 }
  ],
  storeys: 1,
  bedrooms: 2,
  bathrooms: 1,
  office: true
};

function service(): ArchitecturalIntelligenceService {
  // No artefact reader: this is a first capture, exactly as in the E2E run.
  return new ArchitecturalIntelligenceService({ knowledge: createHarness().knowledge });
}

/** Captures a Brief the way a provider does, and returns the artefact proposed. */
function capture(
  fields: Readonly<Record<string, unknown>>,
  lastUserMessage: string = REQUEST
): ArchitecturalBrief {
  const resolved = createCaptureBriefToolDefinition(service()).resolve(fields, {
    conversation: { lastUserMessage }
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

describe('a topic the model omitted (Bug 003)', () => {
  it('recovers the stated total area from the user’s own sentence', () => {
    const brief = capture(FIELDS);

    const total = brief.requirements.find(
      (requirement) => requirement.topic === BRIEF_TOPICS.TotalArea
    );
    expect(total?.value).toBe(100);
  });

  it('records it as stated, because the user stated it', () => {
    const brief = capture(FIELDS);

    expect(
      brief.requirements.find((requirement) => requirement.topic === BRIEF_TOPICS.TotalArea)?.source
    ).toBe('stated');
  });

  it('never overrides a topic the model did supply', () => {
    // The sentence says 2 bedrooms; the model says 3. The model read the whole
    // conversation, the backstop reads one message, and the model wins.
    const brief = capture({ ...FIELDS, bedrooms: 3 });

    expect(
      brief.requirements.find((requirement) => requirement.topic === BRIEF_TOPICS.Bedrooms)?.value
    ).toBe(3);
  });

  it('reads the model’s own objective when the user message no longer carries it (Bug 005)', () => {
    // The conversation that exposed Bug 005: the first capture omitted
    // `storeys`, the host asked, the user answered "single storey", and the
    // model called again. The 100 m² was two turns behind by then — but the
    // model's own objective still said it.
    const brief = capture(FIELDS, 'single storey');

    expect(
      brief.requirements.find((requirement) => requirement.topic === BRIEF_TOPICS.TotalArea)?.value
    ).toBe(100);
  });

  it('fills nothing when nothing readable is available at all', () => {
    const brief = capture({ ...FIELDS, objectives: ['A place to live'] }, 'that sounds good to me');

    expect(
      brief.requirements.some((requirement) => requirement.topic === BRIEF_TOPICS.TotalArea)
    ).toBe(false);
  });

  it('leaves loose topics to the model — a bare budget is not recovered', () => {
    // `Budget` matches a currency amount anywhere in a sentence, which is too
    // permissive to fill a gap with. An invented requirement is worse than a
    // missing one, because it is not visibly missing.
    const brief = capture(FIELDS, 'A 100m2 flat near the €500 000 place on the corner');

    expect(
      brief.requirements.some((requirement) => requirement.topic === BRIEF_TOPICS.Budget)
    ).toBe(false);
  });
});

describe('a count whose value means nothing (Bug 006)', () => {
  /** Resolves without insisting on a proposal, so a blocker can be inspected. */
  function resolve(fields: Readonly<Record<string, unknown>>) {
    return createCaptureBriefToolDefinition(service()).resolve(fields, {
      conversation: { lastUserMessage: REQUEST }
    });
  }

  /**
   * **Narrowed by BUG-009, and the rule underneath is unchanged.**
   *
   * Bug 006's rule is that a *meaningless value is not an answer*: `storeys: 0`
   * is dropped rather than corrected, so the topic stays unanswered. That still
   * holds — see the apartment case below, which shows the zero being discarded.
   *
   * What changed is where the answer may then come from. This request is for an
   * **apartment**, and since BUG-009 the word itself answers the storey question
   * (as an assumption the user can correct), so asking it would be asking
   * something the user already said. The assertion therefore moves to a dwelling
   * that genuinely leaves the question open, which is what it was always about:
   * the model's zero, not the building type.
   */
  const HOUSE = 'Build me a 100m2 house with 2 bedrooms, 1 bathrooms, and a small office.';

  function resolveHouse(fields: Readonly<Record<string, unknown>>) {
    return createCaptureBriefToolDefinition(service()).resolve(fields, {
      conversation: { lastUserMessage: HOUSE }
    });
  }

  it('does not accept zero storeys as an answer', () => {
    // The reported Brief said "0 storeys" and was offered for approval: the
    // mandatory-topic check asked whether `storeys` was present, not whether its
    // value meant anything. `synthesizeProgramme` then coerced it back to 1, so
    // nothing downstream ever noticed.
    const resolved = resolveHouse({ ...FIELDS, storeys: 0 });

    expect(resolved?.kind).toBe('blocked');
  });

  it('asks the storey question rather than guessing that they meant one', () => {
    const resolved = resolveHouse({ ...FIELDS, storeys: 0 });

    expect(resolved?.kind === 'blocked' && resolved.message).toContain('How many storeys');
  });

  /**
   * The two rules meeting, on the request that produced both bugs: the model's
   * `0` is still discarded, and the answer comes from the user's own word.
   * "0 storeys" must never reach a Brief; "1 storey (assumed)" is correct.
   */
  it('discards a zero and takes the storey count from the dwelling instead', () => {
    const resolved = resolve({ ...FIELDS, storeys: 0 });

    expect(resolved?.kind).toBe('proposal');
    if (resolved?.kind !== 'proposal') return;
    expect(resolved.proposal.explanation).not.toMatch(/0 storeys/i);
    expect(resolved.proposal.assumptions.join(' ')).toMatch(/one storey/i);
  });

  it('accepts a single storey, which is the smallest building there is', () => {
    expect(resolve({ ...FIELDS, storeys: 1 })?.kind).toBe('proposal');
  });

  it('still accepts zero bedrooms, because a studio has none', () => {
    // The minimum is per topic, not a blanket "counts must be positive": zero is
    // a real answer here and only meaningless for storeys.
    const brief = capture(
      {
        objectives: ['A studio flat'],
        spaces: [{ name: 'kitchen', count: 1 }],
        storeys: 1,
        bedrooms: 0,
        bathrooms: 1
      },
      'A studio flat with no separate bedroom'
    );

    expect(
      brief.requirements.find((requirement) => requirement.topic === BRIEF_TOPICS.Bedrooms)?.value
    ).toBe(0);
    expect(brief.desiredSpaces.some((space) => space.name === 'bedroom')).toBe(false);
  });

  it('re-asks when the storey question is answered with "none"', () => {
    const utterance = 'Design me a house with 3 bedrooms and 2 bathrooms';
    const draft = startBriefDraft({ utterance, classification: classifyRequest(utterance) });
    expect(draft.openQuestions).toContain(BRIEF_TOPICS.Storeys);

    const answered = answerClarification(draft, 'none');

    expect(answered.openQuestions).toContain(BRIEF_TOPICS.Storeys);
    expect(
      answered.requirements.some((requirement) => requirement.topic === BRIEF_TOPICS.Storeys)
    ).toBe(false);
  });
});

describe('a count the model gave as an argument rather than a space (Bug 003)', () => {
  it('still produces bedrooms in the programme', () => {
    // The tool offers `bedrooms` as a dedicated argument *and* accepts a
    // `spaces` array, so a model that fills in the first and omits the second
    // has answered what it was asked. Before this, the count sat in
    // `requirements` where nothing downstream reads it as a space, and a
    // three-bedroom house was programmed with no bedrooms in it.
    const brief = capture({
      objectives: ['A family home'],
      spaces: [{ name: 'kitchen', count: 1 }],
      storeys: 1,
      bedrooms: 3,
      bathrooms: 2
    });

    const result = synthesizeProgramme({ brief });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const bedrooms = result.programme.spaces.find((space) => space.name === 'bedroom');
    const bathrooms = result.programme.spaces.find((space) => space.name === 'bathroom');
    expect(bedrooms?.count).toBe(3);
    expect(bathrooms?.count).toBe(2);
  });

  it('does not duplicate a space the model listed as well', () => {
    const brief = capture({
      objectives: ['A family home'],
      spaces: [{ name: 'bedroom', count: 3 }],
      storeys: 1,
      bedrooms: 3,
      bathrooms: 2
    });

    expect(brief.desiredSpaces.filter((space) => space.name === 'bedroom')).toHaveLength(1);
  });
});

describe('the reported scenario, end to end (Bug 003)', () => {
  const programme = () => {
    const result = synthesizeProgramme({ brief: capture(FIELDS) });
    if (!result.ok) {
      throw new Error(`Expected a programme: ${result.message}`);
    }
    return result.programme;
  };

  it('totals the area the user asked for, not the platform’s own table', () => {
    expect(programme().totalArea).toBeCloseTo(100, 1);
  });

  it('no longer claims no total was stated', () => {
    expect(programme().assumptions.join(' ')).not.toContain('No total was stated');
    expect(programme().assumptions.join(' ')).toContain('100 m² you asked for');
  });

  it('carries every space the user named, with its count', () => {
    const names = programme().spaces.map((space) => space.name);

    expect(names).toEqual(expect.arrayContaining(['bedroom', 'bathroom', 'office', 'kitchen']));
    expect(programme().spaces.find((space) => space.name === 'bedroom')?.count).toBe(2);
  });

  it('adds no second living room beside the dining/lounge the user asked for', () => {
    // The implied-space check matched names literally, so "dining/lounge" did
    // not look like a living room and one was added underneath it — 24 m² of
    // duplicate day space in a 100 m² flat.
    expect(programme().spaces.map((space) => space.name)).not.toContain('living room');
  });

  it('attaches the kitchen adjacency to the space that has the dining half', () => {
    const result = programme();
    const kitchen = result.spaces.find((space) => space.name === 'kitchen');
    const dining = result.spaces.find((space) => space.name === 'dining/lounge');

    expect(
      result.adjacencies.some(
        (adjacency) => adjacency.fromSpaceId === kitchen?.id && adjacency.toSpaceId === dining?.id
      )
    ).toBe(true);
  });

  it('states one relationship per pair of spaces, never two', () => {
    const seen = programme().adjacencies.map((adjacency) =>
      [adjacency.fromSpaceId, adjacency.toSpaceId].sort().join('|')
    );

    expect(new Set(seen).size).toBe(seen.length);
  });

  // Deliberately not asserted here: that "office" and "dining/lounge" resolve to
  // a typical area rather than the generic 10 m². That half of Bug 003 is a
  // `@archisimple/skills` change, and this repository consumes the platform at a
  // released version (ADR-0030 Rule 4). Asserting it would make this suite fail
  // against `skills@0.2.0` — which is what a clean clone installs — and pass only
  // on a machine with an unreleased checkout. It is tested where it lives, in
  // `programme-skills.test.ts`.

  it('still marks what it added itself as expected rather than required', () => {
    const hallway = programme().spaces.find((space) => space.name === 'hallway');

    expect(hallway?.priority).toBe('expected');
  });
});

describe('boundary cases (Bug 003)', () => {
  it.each([
    [70, 2, 1],
    [120, 3, 2]
  ])('allocates a %i m² brief with %i bedrooms and %i bathrooms', (area, bedrooms, bathrooms) => {
    const brief = capture(
      {
        objectives: [`A ${area} m² home`],
        spaces: [{ name: 'kitchen', count: 1 }],
        storeys: 1,
        bedrooms,
        bathrooms
      },
      `Design a ${area}m2 home with ${bedrooms} bedrooms and ${bathrooms} bathrooms`
    );

    const result = synthesizeProgramme({ brief });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.programme.totalArea).toBeCloseTo(area, 1);
    expect(result.programme.spaces.find((space) => space.name === 'bedroom')?.count).toBe(bedrooms);
    expect(result.programme.spaces.find((space) => space.name === 'bathroom')?.count).toBe(
      bathrooms
    );
  });
});
