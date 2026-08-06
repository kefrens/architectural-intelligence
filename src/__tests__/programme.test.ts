/**
 * Sprint 27.9 — the Space Programme, its synthesis, its lane and its providers.
 *
 * Structured as the sprint's epics, like `brief.test.ts` before it: Epic 0 the
 * read port, Epic 1 synthesis and the area rule, Epic 2 relationships, Epic 3
 * review and the fourth lane, Epic 4 stage providers.
 *
 * Nothing here calls a language model, for the reason Story 27.8.0 gave and
 * this sprint inherits: these are properties of the platform, not of whatever
 * answered.
 */

import { describe, expect, it } from 'vitest';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service';
import { createInMemoryPlanningArtefactReader } from '../artefacts/planning-artefact-reader';
import {
  ARCHITECTURAL_BRIEF_KIND,
  assembleBrief,
  classifyRequest,
  createInMemoryBriefDraftStore,
  REQUEST_LANES,
  type ArchitecturalBrief
} from '../brief';
import { ArchitecturalPlanner, PLANNING_STAGES, type PlanningStageProvider } from '../planning';
import {
  ADJACENCY_STRENGTHS,
  AREA_SOURCES,
  FUNCTIONAL_ZONES,
  matchesBrief,
  SPACE_PRIORITIES,
  SPACE_PROGRAMME_KIND,
  synthesizeProgramme,
  toProgrammeProposal,
  type SpaceProgramme
} from '../programme';
import { createHarness } from './harness';

const REQUEST = 'Design a two-storey family home with 3 bedrooms and 2 bathrooms';
const REQUEST_WITH_TOTAL = 'Design a 100 m² two-storey family home with 3 bedrooms and 2 bathrooms';

function briefFor(utterance: string): ArchitecturalBrief {
  return assembleBrief({ utterance, classification: classifyRequest(utterance) });
}

function programmeFor(utterance: string): SpaceProgramme {
  const result = synthesizeProgramme({ brief: briefFor(utterance) });
  if (!result.ok) {
    throw new Error(`Expected a programme: ${result.message}`);
  }
  return result.programme;
}

function serviceWith(
  brief: ArchitecturalBrief | undefined,
  planner?: ArchitecturalPlanner
): ArchitecturalIntelligenceService {
  return new ArchitecturalIntelligenceService({
    knowledge: createHarness().knowledge,
    briefDrafts: createInMemoryBriefDraftStore(),
    ...(planner === undefined ? {} : { planner }),
    artefacts: createInMemoryPlanningArtefactReader(
      brief === undefined
        ? []
        : [
            {
              kind: ARCHITECTURAL_BRIEF_KIND,
              id: brief.id,
              revision: brief.revision,
              value: brief
            }
          ]
    )
  });
}

// --- Epic 0 — reaching an approved Brief (Story 27.9.0) ----------------------

describe('the approved-artefact read port', () => {
  it('reads the Brief the project has approved', () => {
    const brief = briefFor(REQUEST);

    expect(serviceWith(brief).approvedBrief()?.id).toBe(brief.id);
  });

  it('answers undefined when the project has approved none', () => {
    expect(serviceWith(undefined).approvedBrief()).toBeUndefined();
  });

  it('answers undefined when no reader was supplied at all', () => {
    const service = new ArchitecturalIntelligenceService({ knowledge: createHarness().knowledge });

    expect(service.approvedBrief()).toBeUndefined();
  });

  it('returns the highest revision in force, not the first approved', () => {
    const brief = briefFor(REQUEST);
    const reader = createInMemoryPlanningArtefactReader([
      { kind: ARCHITECTURAL_BRIEF_KIND, id: brief.id, revision: 1, value: brief },
      { kind: ARCHITECTURAL_BRIEF_KIND, id: brief.id, revision: 3, value: brief },
      { kind: ARCHITECTURAL_BRIEF_KIND, id: brief.id, revision: 2, value: brief }
    ]);

    expect(reader.current(ARCHITECTURAL_BRIEF_KIND)?.revision).toBe(3);
  });

  it('treats a stored artefact with a non-object value as absent', () => {
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge,
      artefacts: createInMemoryPlanningArtefactReader([
        { kind: ARCHITECTURAL_BRIEF_KIND, id: 'b1', revision: 1, value: 'corrupt' }
      ])
    });

    expect(service.approvedBrief()).toBeUndefined();
  });
});

// --- Epic 1 — programme synthesis (Story 27.9.1) -----------------------------

describe('programme synthesis', () => {
  it('carries every space the brief named, with its count', () => {
    const programme = programmeFor(REQUEST);

    expect(programme.spaces.find((space) => space.name === 'bedroom')?.count).toBe(3);
    expect(programme.spaces.find((space) => space.name === 'bathroom')?.count).toBe(2);
  });

  it('adds what a dwelling implies and says it did', () => {
    const programme = programmeFor(REQUEST);

    expect(programme.spaces.map((space) => space.name)).toEqual(
      expect.arrayContaining(['kitchen', 'living room', 'hallway'])
    );
    expect(programme.assumptions.join(' ')).toMatch(/kitchen/i);
  });

  it('does not duplicate a space the brief already named', () => {
    const utterance = `${REQUEST} with a kitchen`;
    const programme = programmeFor(utterance);

    expect(programme.spaces.filter((space) => space.name === 'kitchen')).toHaveLength(1);
  });

  it('is deterministic — the same brief always yields the same areas', () => {
    const brief = briefFor(REQUEST);
    const areas = new Set(
      Array.from({ length: 8 }, () => {
        const result = synthesizeProgramme({ brief });
        return result.ok
          ? JSON.stringify(result.programme.spaces.map((space) => [space.name, space.areaEach]))
          : 'failed';
      })
    );

    expect(areas.size).toBe(1);
  });

  it('carries no geometry of any kind (Rule 3)', () => {
    const serialized = JSON.stringify(programmeFor(REQUEST));

    for (const forbidden of ['"x"', '"y"', 'coordinate', 'thickness', 'wall', 'centerline']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('records provenance, so a revised brief leaves this programme detectably stale', () => {
    const brief = briefFor(REQUEST);
    const programme = programmeFor(REQUEST);

    expect(programme.sourceBrief.briefRevision).toBe(1);
    expect(matchesBrief(programme, { id: programme.sourceBrief.briefId, revision: 1 })).toBe(true);
    expect(matchesBrief(programme, { id: programme.sourceBrief.briefId, revision: 2 })).toBe(false);
    expect(brief.revision).toBe(1);
  });

  describe('the area rule', () => {
    it('scales to a stated total and calls it a requirement', () => {
      const programme = programmeFor(REQUEST_WITH_TOTAL);

      expect(programme.totalArea).toBeCloseTo(100, 0);
      for (const space of programme.spaces) {
        expect(space.areaSource).toBe(AREA_SOURCES.ScaledToStatedTotal);
      }
      expect(programme.assumptions.join(' ')).toMatch(/scaled to the 100 m²/i);
    });

    it('uses typical areas when none was stated, and calls that an assumption', () => {
      const programme = programmeFor(REQUEST);

      for (const space of programme.spaces) {
        expect(space.areaSource).toBe(AREA_SOURCES.Typical);
      }
      // The honesty rule: a proposed total is never presented as a requirement.
      expect(programme.assumptions.join(' ')).toMatch(/No total was stated/i);
    });

    it('warns rather than silently producing tiny rooms when a total is very tight', () => {
      const programme = programmeFor(
        'Design a 40 m² two-storey family home with 3 bedrooms and 2 bathrooms'
      );

      expect(programme.warnings.join(' ')).toMatch(/tight/i);
    });

    it('refuses, with a sentence, a total that cannot hold the spaces at all', () => {
      const brief = briefFor('Design a 0.001 m² single storey home with 3 bedrooms and 1 bathroom');
      const result = synthesizeProgramme({ brief });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/too small/i);
    });
  });

  describe('priorities', () => {
    it('marks a space the user named as required', () => {
      const programme = programmeFor(REQUEST);

      expect(programme.spaces.find((space) => space.name === 'bedroom')?.priority).toBe(
        SPACE_PRIORITIES.Required
      );
    });

    it('marks a space the platform added as expected', () => {
      const programme = programmeFor(REQUEST);

      expect(programme.spaces.find((space) => space.name === 'kitchen')?.priority).toBe(
        SPACE_PRIORITIES.Expected
      );
    });

    it('marks a space arriving from an assumed requirement as optional', () => {
      // "with a garage" is stated, so the garage space is required...
      const stated = programmeFor(`${REQUEST} with a garage`);
      expect(stated.spaces.find((space) => space.name === 'garage')?.priority).toBe(
        SPACE_PRIORITIES.Required
      );
    });
  });
});

// --- Epic 2 — functional relationships (Story 27.9.2) ------------------------

describe('functional relationships', () => {
  it('zones every space', () => {
    const programme = programmeFor(REQUEST);

    expect(programme.spaces.find((space) => space.name === 'bedroom')?.zone).toBe(
      FUNCTIONAL_ZONES.Night
    );
    expect(programme.spaces.find((space) => space.name === 'kitchen')?.zone).toBe(
      FUNCTIONAL_ZONES.Day
    );
    expect(programme.spaces.find((space) => space.name === 'hallway')?.zone).toBe(
      FUNCTIONAL_ZONES.Circulation
    );
  });

  it('states intended adjacency between spaces that exist', () => {
    const programme = programmeFor(REQUEST);

    expect(programme.adjacencies.length).toBeGreaterThan(0);
    for (const adjacency of programme.adjacencies) {
      expect(programme.spaces.some((space) => space.id === adjacency.fromSpaceId)).toBe(true);
      expect(programme.spaces.some((space) => space.id === adjacency.toSpaceId)).toBe(true);
    }
  });

  it('names programme space ids, never entity ids (Rule 11)', () => {
    const programme = programmeFor(REQUEST);
    const spaceIds = new Set(programme.spaces.map((space) => space.id));

    for (const adjacency of programme.adjacencies) {
      expect(spaceIds.has(adjacency.fromSpaceId)).toBe(true);
      expect(spaceIds.has(adjacency.toSpaceId)).toBe(true);
      expect(Object.keys(adjacency)).toEqual(['fromSpaceId', 'toSpaceId', 'strength', 'reason']);
    }
  });

  it('carries an avoid relationship as a requirement in its own right', () => {
    const programme = programmeFor(REQUEST);

    const avoided = programme.adjacencies.find(
      (adjacency) => adjacency.strength === ADJACENCY_STRENGTHS.Avoid
    );
    // Not the absence of a relationship: a layout that puts these two together
    // has violated something the programme said, not merely failed to satisfy
    // something it wanted.
    expect(avoided).toBeDefined();
    expect(avoided?.reason).toMatch(/noise/i);
  });

  it('states no circulation — that is the Layout Plan (Sprint 28.0)', () => {
    const programme = programmeFor(REQUEST);

    expect(Object.keys(programme)).not.toContain('circulation');
    expect(Object.keys(programme)).not.toContain('orientation');
  });
});

// --- Epic 3 — programme review and the fourth lane (Story 27.9.3) ------------

describe('the programme lane', () => {
  it('is unreachable without an approved brief', () => {
    expect(classifyRequest('now generate the space programme').lane).toBe(
      REQUEST_LANES.DirectExecution
    );
  });

  it('is reached when a brief is approved and the user asks for the programme', () => {
    const classification = classifyRequest('now generate the space programme', {
      hasApprovedBrief: true
    });

    expect(classification.lane).toBe(REQUEST_LANES.ProgrammeGeneration);
  });

  it('does not fire for a question about the programme', () => {
    expect(classifyRequest('what is in the programme?', { hasApprovedBrief: true }).lane).toBe(
      REQUEST_LANES.DirectExecution
    );
  });

  it('leaves the three Sprint 27.8 lanes exactly as they were', () => {
    // The option defaults to false, so no 27.8 caller can reach the new lane.
    expect(classifyRequest('create a wall from 0,0 to 4,0').lane).toBe(
      REQUEST_LANES.DirectExecution
    );
    expect(classifyRequest(REQUEST).lane).toBe(REQUEST_LANES.BriefGeneration);
    expect(classifyRequest('Design a family home').lane).toBe(REQUEST_LANES.ClarificationRequired);
  });

  it('produces a programme through interpret when a brief is approved', () => {
    const response = serviceWith(briefFor(REQUEST)).interpret('now write the space programme');

    expect(response.classification?.lane).toBe(REQUEST_LANES.ProgrammeGeneration);
    expect(response.programme).toBeDefined();
    expect(response.proposal).toBeDefined();
  });

  it('says a brief must be approved first, rather than failing', () => {
    const response = serviceWith(undefined).interpret('now write the space programme');

    // No approved brief means the lane is never reached; the request falls
    // through to the existing pipeline and is answered there.
    expect(response.programme).toBeUndefined();
    expect(response.message.length).toBeGreaterThan(0);
  });

  it('re-briefing is not what a programme request means', () => {
    const response = serviceWith(briefFor(REQUEST)).interpret(
      'now write the programme for my house'
    );

    expect(response.brief).toBeUndefined();
    expect(response.programme).toBeDefined();
  });
});

describe('programme review', () => {
  it('is an artefact proposal that executes nothing (Rule 7)', () => {
    const programme = programmeFor(REQUEST);
    const proposal = toProgrammeProposal(programme);

    expect(proposal.subject).toEqual({
      kind: 'artefact',
      artefact: {
        kind: SPACE_PROGRAMME_KIND,
        id: programme.id,
        revision: programme.revision,
        value: programme
      }
    });
    expect(proposal.operations).toEqual([]);
    expect(proposal.approvalState).toBe('pending');
    expect(proposal.assumptions).toEqual(programme.assumptions);
  });

  it('refuses to propose an empty programme', () => {
    const programme = programmeFor(REQUEST);

    expect(() => toProgrammeProposal({ ...programme, spaces: [] })).toThrow(/empty/i);
  });
});

// --- Epic 4 — stage providers (Story 27.9.4) ---------------------------------

describe('planning stage providers', () => {
  function taggingProvider(id: string, tag: string): PlanningStageProvider<SpaceProgramme> {
    return {
      id,
      stage: PLANNING_STAGES.Programme,
      enrich: (programme) => ({ ...programme, warnings: [...programme.warnings, tag] })
    };
  }

  it('registers on the existing planner — no seventh registry (Rule 10)', () => {
    const planner = new ArchitecturalPlanner();
    planner.registerStageProvider(taggingProvider('urban-rules', 'a'));

    expect(planner.registeredProviderIds()).toContain('urban-rules');
    expect(planner.stageCapabilities()).toEqual([
      { stage: PLANNING_STAGES.Programme, providerId: 'urban-rules' }
    ]);
  });

  it('runs several providers on one stage, in registration order', () => {
    const planner = new ArchitecturalPlanner();
    planner.registerStageProvider(taggingProvider('urban-rules', 'first'));
    planner.registerStageProvider(taggingProvider('budget', 'second'));

    const response = serviceWith(briefFor(REQUEST), planner).interpret(
      'now write the space programme'
    );

    expect(response.programme?.warnings.slice(-2)).toEqual(['first', 'second']);
  });

  it('refuses a duplicate provider id', () => {
    const planner = new ArchitecturalPlanner();
    planner.registerStageProvider(taggingProvider('urban-rules', 'a'));

    expect(() => planner.registerStageProvider(taggingProvider('urban-rules', 'b'))).toThrow(
      /duplicate/i
    );
  });

  it('isolates a provider that throws, keeping the artefact', () => {
    const planner = new ArchitecturalPlanner();
    planner.registerStageProvider({
      id: 'broken',
      stage: PLANNING_STAGES.Programme,
      enrich: () => {
        throw new Error('boom');
      }
    });
    planner.registerStageProvider(taggingProvider('budget', 'survived'));

    const response = serviceWith(briefFor(REQUEST), planner).interpret(
      'now write the space programme'
    );

    expect(response.programme).toBeDefined();
    expect(response.programme?.warnings.at(-1)).toBe('survived');
  });

  it('unregisters by id, whichever kind of provider it was', () => {
    const planner = new ArchitecturalPlanner();
    planner.registerStageProvider(taggingProvider('urban-rules', 'a'));

    expect(planner.unregisterProvider('urban-rules')).toBe(true);
    expect(planner.stageProviders(PLANNING_STAGES.Programme)).toEqual([]);
    expect(planner.unregisterProvider('urban-rules')).toBe(false);
  });

  it('leaves a stage with no providers untouched', () => {
    const planner = new ArchitecturalPlanner();
    const programme = programmeFor(REQUEST);

    expect(planner.enrich(PLANNING_STAGES.Programme, programme, createHarness().knowledge)).toBe(
      programme
    );
  });
});
