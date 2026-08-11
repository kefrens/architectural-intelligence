/**
 * Bug 004 — explicit spatial relationships (ADR-AI-0003).
 *
 * Structured as the ADR's rules, so a failure names the rule it broke.
 *
 * The scenario throughout is the one that exposed this: a user said "Kitchen and
 * Dining/Lounge area are separated", the Brief had nowhere to put it, and the
 * Programme then offered the opposite from its own template. Nothing downstream
 * needed changing — `avoid` has resolved to a `separated` layout edge since
 * Sprint 28.0 — so the last test here walks the whole chain to prove that claim
 * rather than assert it.
 */

import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURAL_BRIEF_KIND,
  assembleBrief,
  classifyRequest,
  readSpaceRelationships,
  SPACE_RELATIONSHIP_KINDS,
  summarizeBrief,
  type ArchitecturalBrief
} from '../brief/index.js';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import { synthesizeLayout } from '../layout/index.js';
import {
  ADJACENCY_STRENGTHS,
  summarizeProgramme,
  synthesizeProgramme,
  type SpaceProgramme
} from '../programme/index.js';
import { createCaptureBriefToolDefinition } from '../tools/index.js';
import { createHarness } from './harness.js';

const REQUEST =
  'Build me a 100m2 appartment with 2 bedrooms, 1 bathrooms, and a small office. Kitchen and Dining/Lounge area are separated';

/** What the model sends: no relationships at all, exactly as in the observed run. */
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

function capture(
  fields: Readonly<Record<string, unknown>>,
  lastUserMessage: string = REQUEST
): ArchitecturalBrief {
  const service = new ArchitecturalIntelligenceService({ knowledge: createHarness().knowledge });
  const resolved = createCaptureBriefToolDefinition(service).resolve(fields, {
    conversation: { lastUserMessage }
  });
  if (resolved?.kind !== 'proposal') {
    throw new Error(`Expected a brief proposal, got ${resolved?.kind ?? 'nothing'}`);
  }
  const { subject } = resolved.proposal;
  if (subject.kind !== 'artefact' || subject.artefact.kind !== ARCHITECTURAL_BRIEF_KIND) {
    throw new Error('Expected an architectural brief artefact.');
  }
  return subject.artefact.value as ArchitecturalBrief;
}

function programmeOf(brief: ArchitecturalBrief): SpaceProgramme {
  const result = synthesizeProgramme({ brief });
  if (!result.ok) {
    throw new Error(`Expected a programme: ${result.message}`);
  }
  return result.programme;
}

function between(
  programme: SpaceProgramme,
  a: string,
  b: string
): SpaceProgramme['adjacencies'][number] | undefined {
  const first = programme.spaces.find((space) => space.name === a)?.id;
  const second = programme.spaces.find((space) => space.name === b)?.id;
  return programme.adjacencies.find(
    (adjacency) =>
      (adjacency.fromSpaceId === first && adjacency.toSpaceId === second) ||
      (adjacency.fromSpaceId === second && adjacency.toSpaceId === first)
  );
}

// --- Rule 7 — both capture paths read the same sentence -------------------------

describe('reading a relationship out of a sentence (Rule 7)', () => {
  it.each([
    ['Kitchen and Dining/Lounge area are separated', 'separated'],
    ['keep the kitchen separate from the lounge', 'separated'],
    ['put the bedrooms away from the living room', 'separated'],
    ['a kitchen next to the dining room', 'adjacent'],
    ['kitchen and dining should be open', 'adjacent']
  ])('reads "%s" as %s', (sentence, kind) => {
    const [relationship] = readSpaceRelationships(sentence);

    expect(relationship?.kind).toBe(kind);
  });

  it('does not run the capture backwards over the rest of the sentence', () => {
    // "A house with the kitchen next to the dining room" must not name the
    // space "house with the kitchen".
    const [relationship] = readSpaceRelationships(
      'A house with the kitchen next to the dining room'
    );

    expect(relationship?.from).toBe('kitchen');
    expect(relationship?.to).toBe('dining');
  });

  it('reads nothing from a request that states no relationship', () => {
    expect(readSpaceRelationships('A family home with 3 bedrooms and 2 bathrooms')).toEqual([]);
  });

  it('gives the offline path the same relationship the model path gets', () => {
    const offline = assembleBrief({ utterance: REQUEST, classification: classifyRequest(REQUEST) });

    expect(offline.relationships).toHaveLength(1);
    expect(offline.relationships[0]?.kind).toBe(SPACE_RELATIONSHIP_KINDS.Separated);
    expect(capture(FIELDS).relationships[0]?.kind).toBe(SPACE_RELATIONSHIP_KINDS.Separated);
  });

  it('lets the model override a pair the reader also found', () => {
    const brief = capture({
      ...FIELDS,
      relationships: [{ from: 'kitchen', to: 'dining/lounge', kind: 'adjacent' }]
    });

    expect(brief.relationships).toHaveLength(1);
    expect(brief.relationships[0]?.kind).toBe(SPACE_RELATIONSHIP_KINDS.Adjacent);
  });

  it('drops a model relationship whose kind it does not recognise', () => {
    const brief = capture(
      { ...FIELDS, relationships: [{ from: 'kitchen', to: 'office', kind: 'near' }] },
      'A 100m2 flat'
    );

    expect(brief.relationships).toEqual([]);
  });
});

// --- Rules 1–4 — what a relationship becomes ------------------------------------

describe('what a stated relationship becomes (Rules 1–4)', () => {
  it('carries no distance, no wall and no coordinate (Rule 1)', () => {
    const [relationship] = capture(FIELDS).relationships;

    expect(Object.keys(relationship ?? {})).toEqual(['from', 'to', 'kind', 'source']);
  });

  it('becomes an avoid requirement, never a preference (Rule 3)', () => {
    const adjacency = between(programmeOf(capture(FIELDS)), 'kitchen', 'dining/lounge');

    expect(adjacency?.strength).toBe(ADJACENCY_STRENGTHS.Avoid);
  });

  it('a stated adjacency becomes required, never preferred (Rule 3)', () => {
    const brief = capture({
      ...FIELDS,
      relationships: [{ from: 'kitchen', to: 'office', kind: 'adjacent' }]
    });

    expect(between(programmeOf(brief), 'kitchen', 'office')?.strength).toBe(
      ADJACENCY_STRENGTHS.Required
    );
  });

  it('records that the user said it, not the platform (Rule 4)', () => {
    expect(between(programmeOf(capture(FIELDS)), 'kitchen', 'dining/lounge')?.source).toBe(
      'stated'
    );
  });

  it('marks everything the template contributed as assumed (Rule 4)', () => {
    const programme = programmeOf(capture(FIELDS));
    const derived = programme.adjacencies.filter((adjacency) => adjacency.source === 'assumed');

    expect(derived.length).toBeGreaterThan(0);
    expect(derived.every((adjacency) => adjacency.reason.length > 0)).toBe(true);
  });

  it('resolves a name by role, so "lounge" finds the dining/lounge (Rule 2)', () => {
    const brief = capture(
      { ...FIELDS, relationships: [{ from: 'lounge', to: 'kitchen', kind: 'separated' }] },
      'A 100m2 flat'
    );

    expect(between(programmeOf(brief), 'kitchen', 'dining/lounge')?.strength).toBe(
      ADJACENCY_STRENGTHS.Avoid
    );
  });
});

// --- Rule 5 — explicit outranks derived ----------------------------------------

describe('an explicit relationship outranks the template (Rule 5)', () => {
  it('suppresses the template relationship that named the same pair', () => {
    // ADJACENCY_TEMPLATE states kitchen↔dining as *required*. The user said the
    // opposite, and the user wins.
    const programme = programmeOf(capture(FIELDS));

    expect(between(programme, 'kitchen', 'dining/lounge')?.strength).toBe(
      ADJACENCY_STRENGTHS.Avoid
    );
  });

  it('still states one relationship per pair, never two', () => {
    const seen = programmeOf(capture(FIELDS)).adjacencies.map((adjacency) =>
      [adjacency.fromSpaceId, adjacency.toSpaceId].sort().join('|')
    );

    expect(new Set(seen).size).toBe(seen.length);
  });

  it('leaves the template free to state pairs the user said nothing about', () => {
    const programme = programmeOf(capture(FIELDS));

    expect(between(programme, 'bedroom', 'bathroom')?.source).toBe('assumed');
  });
});

// --- Rule 6 — an unmatched name warns rather than fails -------------------------

describe('a relationship naming a space that does not exist (Rule 6)', () => {
  const brief = () =>
    capture(
      { ...FIELDS, relationships: [{ from: 'kitchen', to: 'wine cellar', kind: 'separated' }] },
      'A 100m2 flat'
    );

  it('still produces a programme', () => {
    expect(synthesizeProgramme({ brief: brief() }).ok).toBe(true);
  });

  it('says which relationship it could not carry', () => {
    expect(programmeOf(brief()).warnings.join(' ')).toContain('wine cellar');
  });
});

// --- Rule 8 — the field is optional --------------------------------------------

describe('a Brief approved before this existed (Rule 8)', () => {
  it('synthesises a programme when relationships are absent entirely', () => {
    const legacy = { ...capture(FIELDS), relationships: [] } as ArchitecturalBrief;

    const programme = programmeOf(legacy);
    expect(programme.adjacencies.every((adjacency) => adjacency.source === 'assumed')).toBe(true);
  });
});

// --- Rule 9 — nothing below the Programme learns a new concept ------------------

describe('the whole chain, end to end (Rule 9)', () => {
  it('reaches the layout as a separation edge, with no change below the programme', () => {
    const programme = programmeOf(capture(FIELDS));
    const kitchen = programme.spaces.find((space) => space.name === 'kitchen')?.id;
    const dining = programme.spaces.find((space) => space.name === 'dining/lounge')?.id;

    const layout = synthesizeLayout({ programme });
    expect(layout.ok).toBe(true);
    if (!layout.ok) {
      return;
    }

    const edge = layout.plan.graph.edges.find(
      (candidate) =>
        [candidate.fromNodeId, candidate.toNodeId].includes(kitchen ?? '') &&
        [candidate.fromNodeId, candidate.toNodeId].includes(dining ?? '')
    );
    expect(edge?.kind).toBe('separated');
  });
});

// --- What a reviewer sees -------------------------------------------------------

describe('the review cards', () => {
  it('shows the relationship on the brief', () => {
    expect(summarizeBrief(capture(FIELDS))).toContain('kept separate');
  });

  it('separates what the user asked for from what the platform assumed', () => {
    const card = summarizeProgramme(programmeOf(capture(FIELDS)));

    expect(card).toContain('**You asked for**');
    expect(card.indexOf('**You asked for**')).toBeLessThan(card.indexOf('**Should be adjacent**'));
  });

  it('no longer hides a separation from the reviewer', () => {
    // `avoid` was filtered out of the card entirely, which was tolerable while
    // every one of them was the platform's own idea.
    expect(summarizeProgramme(programmeOf(capture(FIELDS)))).toContain('kept separate');
  });
});
