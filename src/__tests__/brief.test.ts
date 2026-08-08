/**
 * Sprint 27.8 — the Architectural Brief, its classifier and its clarification
 * dialogue.
 *
 * Structured as the sprint's own epics, because these are its acceptance
 * criteria rather than a unit suite: Epic 0 is the front door, Epic 1 the
 * artefact, Epic 2 the dialogue, Epic 3 the promise that none of it disturbs
 * what already worked.
 *
 * Nothing here calls a language model. The whole point of Story 27.8.0's
 * "validated using fake AI providers rather than relying on model behaviour" is
 * that these outcomes are properties of the platform, not of whatever answered.
 */

import { describe, expect, it } from 'vitest';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import {
  answerClarification,
  ARCHITECTURAL_BRIEF_KIND,
  assembleBrief,
  assembleBriefFromFields,
  BRIEF_REQUIREMENT_SOURCES,
  BRIEF_TOPICS,
  briefRequirement,
  classifyRequest,
  createInMemoryBriefDraftStore,
  isBriefComplete,
  MANDATORY_BRIEF_TOPICS,
  REQUEST_LANES,
  startBriefDraft,
  toBriefProposal
} from '../brief/index.js';
import { PLAN_BLOCKER_REASONS } from '../planning/index.js';
import { createHarness } from './harness.js';

const COMPLETE_REQUEST = 'Design a two-storey family home with 3 bedrooms and 2 bathrooms';

function service(): ArchitecturalIntelligenceService {
  return new ArchitecturalIntelligenceService({
    knowledge: createHarness().knowledge,
    briefDrafts: createInMemoryBriefDraftStore()
  });
}

// --- Epic 0 — Intent Completeness Analysis (Story 27.8.0) ---------------------

describe('intent completeness analysis', () => {
  it.each([
    ['create a wall from 0,0 to 4,0', 'a modelling command'],
    ['delete the selection', 'a modelling command'],
    ['move the kitchen 2 m north', 'a modelling command'],
    ['create a room of 16 m²', 'an area is not a programme'],
    ['rename the kitchen to "dining room"', 'a modelling command']
  ])('sends %s down the direct lane (%s)', (utterance) => {
    expect(classifyRequest(utterance).lane).toBe(REQUEST_LANES.DirectExecution);
  });

  it.each([
    'how many rooms does my house have?',
    'what is the total floor area of this apartment?'
  ])(
    'sends the question "%s" down the direct lane even though it names a dwelling',
    (utterance) => {
      expect(classifyRequest(utterance).lane).toBe(REQUEST_LANES.DirectExecution);
    }
  );

  it('leaves a dwelling mentioned inside a modelling command in the direct lane', () => {
    // "house" is present, but nothing is asked to be designed.
    expect(classifyRequest('move the kitchen in my house 2 m north').lane).toBe(
      REQUEST_LANES.DirectExecution
    );
  });

  it('classifies a complete design request as brief generation, with no questions', () => {
    const classification = classifyRequest(COMPLETE_REQUEST);

    expect(classification.lane).toBe(REQUEST_LANES.BriefGeneration);
    expect(classification.missing).toEqual([]);
    expect(classification.signals).toContain('home');
  });

  it('classifies an incomplete design request as needing clarification, naming what is missing', () => {
    const classification = classifyRequest('Design a family home');

    expect(classification.lane).toBe(REQUEST_LANES.ClarificationRequired);
    expect(classification.missing).toEqual(MANDATORY_BRIEF_TOPICS);
  });

  it('counts a typology code as a stated bedroom count', () => {
    // A T4 has four principal rooms, one of which is the living room.
    const classification = classifyRequest('Design a single storey T4 apartment with 2 bathrooms');

    expect(classification.lane).toBe(REQUEST_LANES.BriefGeneration);
  });

  it('treats topics settled in an earlier turn as answered', () => {
    const classification = classifyRequest('Design a family home', {
      known: MANDATORY_BRIEF_TOPICS
    });

    expect(classification.lane).toBe(REQUEST_LANES.BriefGeneration);
  });

  it('is deterministic — the same utterance always classifies the same way', () => {
    const lanes = new Set(Array.from({ length: 10 }, () => classifyRequest(COMPLETE_REQUEST).lane));

    expect(lanes.size).toBe(1);
  });
});

// --- Epic 1 — the Architectural Brief (Story 27.8.1) --------------------------

describe('the architectural brief', () => {
  const classification = classifyRequest(COMPLETE_REQUEST);

  it('captures requirements, assumptions and constraints', () => {
    const brief = assembleBrief({ utterance: COMPLETE_REQUEST, classification });

    expect(briefRequirement(brief, BRIEF_TOPICS.Storeys)?.value).toBe(2);
    expect(briefRequirement(brief, BRIEF_TOPICS.Bedrooms)?.value).toBe(3);
    expect(briefRequirement(brief, BRIEF_TOPICS.Bathrooms)?.value).toBe(2);
    expect(brief.assumptions.length).toBeGreaterThan(0);
    expect(brief.objectives).toEqual(['A two-storey family home with 3 bedrooms and 2 bathrooms']);
  });

  it('records a defaulted topic as an assumption and marks its source', () => {
    const brief = assembleBrief({ utterance: COMPLETE_REQUEST, classification });

    expect(briefRequirement(brief, BRIEF_TOPICS.Garage)?.source).toBe(
      BRIEF_REQUIREMENT_SOURCES.Assumed
    );
    expect(brief.assumptions.join(' ')).toMatch(/garage/i);
  });

  it('lets a stated topic override the default it would otherwise have assumed', () => {
    const utterance = `${COMPLETE_REQUEST} and a garage`;
    const brief = assembleBrief({ utterance, classification: classifyRequest(utterance) });

    const garage = briefRequirement(brief, BRIEF_TOPICS.Garage);
    expect(garage?.value).toBe(true);
    expect(garage?.source).toBe(BRIEF_REQUIREMENT_SOURCES.Stated);
    expect(brief.assumptions.join(' ')).not.toMatch(/garage/i);
  });

  it('derives desired spaces from the counts, never areas', () => {
    const brief = assembleBrief({ utterance: COMPLETE_REQUEST, classification });

    expect(brief.desiredSpaces).toContainEqual({ name: 'bedroom', count: 3 });
    expect(brief.desiredSpaces).toContainEqual({ name: 'bathroom', count: 2 });
    expect(JSON.stringify(brief)).not.toMatch(/"x"|"y"|coordinate/i);
  });

  it('records a stated total area as a requirement without allocating it', () => {
    const utterance = 'Design a 120 m² single storey home with 3 bedrooms and 1 bathroom';
    const brief = assembleBrief({ utterance, classification: classifyRequest(utterance) });

    expect(briefRequirement(brief, BRIEF_TOPICS.TotalArea)?.value).toBe(120);
    // Rule 3: no space carries an area of its own.
    for (const space of brief.desiredSpaces) {
      expect(Object.keys(space)).toEqual(['name', 'count']);
    }
  });

  it('is reviewable as a proposal that executes nothing', () => {
    const brief = assembleBrief({ utterance: COMPLETE_REQUEST, classification });
    const proposal = toBriefProposal(brief);

    expect(proposal.subject).toEqual({
      kind: 'artefact',
      artefact: {
        kind: ARCHITECTURAL_BRIEF_KIND,
        id: brief.id,
        revision: brief.revision,
        value: brief
      }
    });
    expect(proposal.operations).toEqual([]);
    expect(proposal.approvalState).toBe('pending');
    expect(proposal.assumptions).toEqual(brief.assumptions);
  });

  it('refuses to propose an incomplete brief', () => {
    const draft = startBriefDraft({
      utterance: 'Design a family home',
      classification: classifyRequest('Design a family home')
    });

    expect(() => toBriefProposal(draft)).toThrow(/incomplete/i);
  });

  it('revises rather than edits, keeping identity and superseding the previous revision', () => {
    const draft = startBriefDraft({
      utterance: 'Design a home with 3 bedrooms and 1 bathroom',
      classification: classifyRequest('Design a home with 3 bedrooms and 1 bathroom')
    });
    const revised = answerClarification(draft, 'two storeys');

    expect(revised.id).toBe(draft.id);
    expect(revised.revision).toBe(draft.revision + 1);
    // The original object is untouched, so an approved revision stays as approved.
    expect(draft.openQuestions).toEqual([BRIEF_TOPICS.Storeys]);
  });
});

// --- Epic 2 — the Clarification Dialogue (Story 27.8.2) ----------------------

describe('the clarification dialogue', () => {
  it('asks one focused question, using the existing blocker vocabulary', () => {
    const response = service().interpret('Design a family home');

    expect(response.clarification).toBeDefined();
    const [first] = response.clarification!.questions;
    expect(first!.blocker.reason).toBe(PLAN_BLOCKER_REASONS.MissingInformation);
    expect(first!.blocker.suggestions.length).toBeGreaterThan(0);
    // Only the first is put to the user; the rest are named, not asked.
    expect(response.message).toContain(first!.blocker.message);
    expect(response.message).not.toContain(response.clarification!.questions[1]!.blocker.message);
  });

  it('stops as soon as the brief is complete, not after a fixed number of turns', () => {
    const intelligence = service();

    expect(intelligence.interpret('Design a family home').clarification).toBeDefined();
    expect(intelligence.interpret('two storeys').clarification).toBeDefined();
    expect(intelligence.interpret('3 bedrooms').clarification).toBeDefined();

    const done = intelligence.interpret('2 bathrooms');
    expect(done.clarification).toBeUndefined();
    expect(done.brief).toBeDefined();
    expect(isBriefComplete(done.brief!)).toBe(true);
  });

  it('accepts more than was asked, in one sentence', () => {
    const intelligence = service();
    intelligence.interpret('Design a family home');

    const done = intelligence.interpret('two storeys, 3 bedrooms and 2 bathrooms');

    expect(done.brief).toBeDefined();
    expect(briefRequirement(done.brief!, BRIEF_TOPICS.Bedrooms)?.value).toBe(3);
  });

  it('reads a bare answer as the question that was asked', () => {
    const intelligence = service();
    const opening = intelligence.interpret('Design a family home');
    const asked = opening.clarification!.questions[0]!.topic;

    const next = intelligence.interpret('two');

    expect(briefRequirement(next.clarification!.draft, asked)?.value).toBe(2);
    expect(briefRequirement(next.clarification!.draft, asked)?.source).toBe(
      BRIEF_REQUIREMENT_SOURCES.Answered
    );
  });

  it('attributes answered topics separately from assumed ones', () => {
    const intelligence = service();
    intelligence.interpret('Design a family home');
    intelligence.interpret('two storeys');
    intelligence.interpret('3 bedrooms');
    const done = intelligence.interpret('2 bathrooms');

    expect(briefRequirement(done.brief!, BRIEF_TOPICS.Bathrooms)?.source).toBe(
      BRIEF_REQUIREMENT_SOURCES.Answered
    );
    expect(briefRequirement(done.brief!, BRIEF_TOPICS.Garage)?.source).toBe(
      BRIEF_REQUIREMENT_SOURCES.Assumed
    );
  });

  it('abandons the dialogue when the user changes the subject', () => {
    const intelligence = service();
    intelligence.interpret('Design a family home');

    // Not an answer to "how many storeys": a modelling command.
    const changed = intelligence.interpret('create a wall from 0,0 to 4,0');

    expect(changed.clarification).toBeUndefined();
    expect(changed.classification?.lane).toBe(REQUEST_LANES.DirectExecution);
  });

  it('applies no defaults while questions are still open', () => {
    const draft = startBriefDraft({
      utterance: 'Design a family home',
      classification: classifyRequest('Design a family home')
    });

    expect(draft.assumptions).toEqual([]);
  });
});

// --- Epic 3 — backward compatibility (Story 27.8.3) ---------------------------

describe('backward compatibility', () => {
  it('routes a modelling request to the planner exactly as before', () => {
    const response = service().interpret('rename the kitchen to "dining room"');

    expect(response.classification?.lane).toBe(REQUEST_LANES.DirectExecution);
    expect(response.brief).toBeUndefined();
    expect(response.proposal?.subject.kind).toBe('automation');
  });

  it('answers a question from the Building Platform, proposing nothing', () => {
    const response = service().interpret('how many rooms are there?');

    expect(response.answer).toBeDefined();
    expect(response.proposal).toBeUndefined();
    expect(response.brief).toBeUndefined();
  });

  it('does not classify a tool call — interpretIntent is Direct Execution by construction', () => {
    const intelligence = service();
    const response = intelligence.interpretIntent({
      kind: 'modification',
      action: 'edit.renameRoom',
      utterance: 'design a family home',
      target: { kind: 'named', name: 'Room 1' },
      parameters: { name: 'Studio' }
    });

    // The utterance would classify as a design request; reaching the planner
    // through a tool call bypasses that entirely.
    expect(response.classification).toBeUndefined();
    expect(response.proposal ?? response.blocker).toBeDefined();
  });
});

// --- Rule 6 — host-side assembly ---------------------------------------------

describe('a brief assembled from model-supplied fields (ADR-0027.1 Rule 6)', () => {
  it('applies the same defaults and assumptions the offline path applies', () => {
    const brief = assembleBriefFromFields({
      utterance: 'Design a family home',
      objectives: ['A family home near the coast'],
      spaces: [{ name: 'bedroom', count: 3 }],
      requirements: [
        { topic: BRIEF_TOPICS.Storeys, value: 2 },
        { topic: BRIEF_TOPICS.Bedrooms, value: 3 },
        { topic: BRIEF_TOPICS.Bathrooms, value: 2 }
      ]
    });

    expect(isBriefComplete(brief)).toBe(true);
    expect(briefRequirement(brief, BRIEF_TOPICS.Garage)?.source).toBe(
      BRIEF_REQUIREMENT_SOURCES.Assumed
    );
    expect(brief.objectives).toEqual(['A family home near the coast']);
  });

  it('leaves out what the model left out rather than inventing it', () => {
    const brief = assembleBriefFromFields({
      utterance: 'Design a family home',
      requirements: [{ topic: BRIEF_TOPICS.Storeys, value: 1 }]
    });

    expect(isBriefComplete(brief)).toBe(false);
    expect(brief.openQuestions).toEqual([BRIEF_TOPICS.Bedrooms, BRIEF_TOPICS.Bathrooms]);
    expect(brief.assumptions).toEqual([]);
  });
});
