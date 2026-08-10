/**
 * Sprint 1.4 — the workflow state in the context fragment.
 *
 * The fragment is what a *model* reads before it decides what to say, so what is
 * asserted here is the thing Bug 001 cost: that a model can tell where the
 * design has got to, and which tool moves it forward, without inferring either.
 *
 * Everything crosses as prompt text, which is why the round-trip assertion is
 * not ceremony — a field that does not survive `JSON.stringify` is a field the
 * model never sees.
 */

import { isArtefactProposal, type ContextProvider, type Proposal } from '@archisimple/ai-engine';
import { describe, expect, it } from 'vitest';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import {
  createInMemoryPlanningArtefactReader,
  type ApprovedArtefact,
  type PlanningArtefactReader
} from '../artefacts/planning-artefact-reader.js';
import {
  ARCHITECTURAL_CONTEXT_PROVIDER_ID,
  createArchitecturalContextProvider,
  type ArchitecturalContextFragment
} from '../context/architectural-context-provider.js';
import { ARCHITECTURAL_ACTIONS } from '../intent/index.js';
import { PLANNING_STAGES } from '../planning/index.js';
import { PLANNING_TOOL_NAMES } from '../tools/planning-tool-names.js';
import { createHarness } from './harness.js';

const TWO_STOREY = 'Design a two-storey family home with 3 bedrooms and 2 bathrooms';

interface Project {
  readonly service: ArchitecturalIntelligenceService;
  readonly provider: ContextProvider;
  fragment(): ArchitecturalContextFragment;
  approve(proposal: Proposal | undefined): void;
}

function createProject(options: { readonly artefacts?: boolean } = {}): Project {
  let artefacts: ApprovedArtefact[] = [];
  const reader: PlanningArtefactReader = {
    current: (kind) => createInMemoryPlanningArtefactReader(artefacts).current(kind),
    all: () => artefacts
  };

  const knowledge = createHarness().knowledge;
  const service = new ArchitecturalIntelligenceService({
    knowledge,
    ...(options.artefacts === false ? {} : { artefacts: reader })
  });
  const provider = createArchitecturalContextProvider(service, knowledge);

  return {
    service,
    provider,
    fragment: () => provider.collect() as ArchitecturalContextFragment,
    approve: (proposal) => {
      if (proposal === undefined || !isArtefactProposal(proposal)) {
        throw new Error('Expected an artefact proposal to approve.');
      }
      artefacts = [...artefacts, { ...proposal.subject.artefact }];
    }
  };
}

function stageIn(fragment: ArchitecturalContextFragment, stage: string) {
  const found = fragment.design.stages.find((entry) => entry.stage === stage);
  if (found === undefined) throw new Error(`No stage ${stage}`);
  return found;
}

// --- Epic 1 — the fragment -----------------------------------------------------

describe('the fragment still carries what it always did', () => {
  it('reports capabilities, questions and the active floor', () => {
    const fragment = createProject().fragment();

    expect(fragment.editOperations.length).toBeGreaterThan(0);
    expect(fragment.answerableQuestions).toContain(ARCHITECTURAL_ACTIONS.roomCount);
    expect(fragment.floorCount).toBeGreaterThanOrEqual(0);
  });

  it('is contributed under the id it has always used', () => {
    expect(createProject().provider.id).toBe(ARCHITECTURAL_CONTEXT_PROVIDER_ID);
  });
});

describe('design state (Stories 1.4.1 and 1.4.2)', () => {
  it('reports all five stages, in pipeline order', () => {
    const fragment = createProject().fragment();

    expect(fragment.design.stages.map((entry) => entry.stage)).toEqual([
      PLANNING_STAGES.Brief,
      PLANNING_STAGES.Programme,
      PLANNING_STAGES.Layout,
      PLANNING_STAGES.Geometry,
      PLANNING_STAGES.Specification
    ]);
  });

  it('opens on the brief for an untouched project', () => {
    const fragment = createProject().fragment();

    expect(fragment.design.currentStage).toBe(PLANNING_STAGES.Brief);
    expect(fragment.design.complete).toBe(false);
    expect(stageIn(fragment, PLANNING_STAGES.Brief).artefact).toBe('none');
    expect(stageIn(fragment, PLANNING_STAGES.Brief).revision).toBeNull();
  });

  it('says why a stage cannot proceed, in the platform’s own words', () => {
    const layout = stageIn(createProject().fragment(), PLANNING_STAGES.Layout);

    expect(layout.eligible).toBe(false);
    expect(layout.blockedBecause).toMatch(/space programme/i);
  });

  it('leaves blockedBecause null for a stage that can proceed', () => {
    const brief = stageIn(createProject().fragment(), PLANNING_STAGES.Brief);

    expect(brief.eligible).toBe(true);
    expect(brief.blockedBecause).toBeNull();
  });
});

describe('nextTool (Story 1.4.3)', () => {
  it('names the tool for the stage that can be acted on', () => {
    expect(createProject().fragment().design.nextTool).toBe(
      PLANNING_TOOL_NAMES[PLANNING_STAGES.Brief]
    );
  });

  /**
   * The field Bug 001 is about. After the Brief is approved the model has to
   * know that `planning_generateProgramme` is now the move — inferring it from
   * five stage records is exactly the inference that failed.
   */
  it('moves to the next tool as each stage is approved', () => {
    const project = createProject();

    project.approve(project.service.interpret(TWO_STOREY).proposal);
    expect(project.fragment().design.nextTool).toBe(PLANNING_TOOL_NAMES[PLANNING_STAGES.Programme]);

    project.approve(project.service.interpret('now generate the space programme').proposal);
    expect(project.fragment().design.nextTool).toBe(PLANNING_TOOL_NAMES[PLANNING_STAGES.Layout]);

    project.approve(project.service.interpret('now generate the layout').proposal);
    expect(project.fragment().design.nextTool).toBe(PLANNING_TOOL_NAMES[PLANNING_STAGES.Geometry]);

    project.approve(project.service.interpret('now draw the rooms').proposal);
    expect(project.fragment().design.nextTool).toBe(
      PLANNING_TOOL_NAMES[PLANNING_STAGES.Specification]
    );
  });

  it('is null once the design is complete', () => {
    const project = createProject();
    project.approve(project.service.interpret(TWO_STOREY).proposal);
    project.approve(project.service.interpret('now generate the space programme').proposal);
    project.approve(project.service.interpret('now generate the layout').proposal);
    project.approve(project.service.interpret('now draw the rooms').proposal);
    project.approve(project.service.interpret('give it walls').proposal);

    const fragment = project.fragment();

    expect(fragment.design.complete).toBe(true);
    expect(fragment.design.currentStage).toBeNull();
    expect(fragment.design.nextTool).toBeNull();
  });
});

describe('the five-stage walk (Story 1.4.5)', () => {
  it('reports each artefact as it is approved', () => {
    const project = createProject();

    project.approve(project.service.interpret(TWO_STOREY).proposal);
    let fragment = project.fragment();
    expect(stageIn(fragment, PLANNING_STAGES.Brief).artefact).toBe('approved');
    expect(stageIn(fragment, PLANNING_STAGES.Brief).revision).toBe(1);
    expect(stageIn(fragment, PLANNING_STAGES.Programme).eligible).toBe(true);
    expect(stageIn(fragment, PLANNING_STAGES.Layout).eligible).toBe(false);

    project.approve(project.service.interpret('now generate the space programme').proposal);
    fragment = project.fragment();
    expect(stageIn(fragment, PLANNING_STAGES.Programme).artefact).toBe('approved');
    expect(fragment.design.currentStage).toBe(PLANNING_STAGES.Layout);
  });
});

describe('staleness is visible (Story 1.4.6)', () => {
  it('reports a revised brief’s consequences and points back at the repair', () => {
    const project = createProject();
    project.approve(project.service.interpret(TWO_STOREY).proposal);
    project.approve(project.service.interpret('now generate the space programme').proposal);
    project.approve(project.service.interpret('now generate the layout').proposal);

    project.approve(project.service.interpret('actually make it 4 bedrooms').proposal);
    const fragment = project.fragment();

    expect(stageIn(fragment, PLANNING_STAGES.Brief).revision).toBe(2);
    expect(stageIn(fragment, PLANNING_STAGES.Programme).stale).toBe(true);
    expect(stageIn(fragment, PLANNING_STAGES.Layout).stale).toBe(true);
    expect(fragment.design.currentStage).toBe(PLANNING_STAGES.Programme);
    // A stale stage is eligible — regenerating it is the fix — so the model is
    // pointed at the repair rather than at the stage that went stale beneath it.
    expect(fragment.design.nextTool).toBe(PLANNING_TOOL_NAMES[PLANNING_STAGES.Programme]);
  });

  it('reports the layout as blocked while its input is out of date', () => {
    const project = createProject();
    project.approve(project.service.interpret(TWO_STOREY).proposal);
    project.approve(project.service.interpret('now generate the space programme').proposal);
    project.approve(project.service.interpret('now generate the layout').proposal);
    project.approve(project.service.interpret('actually make it 4 bedrooms').proposal);

    const layout = stageIn(project.fragment(), PLANNING_STAGES.Layout);

    expect(layout.eligible).toBe(false);
    expect(layout.blockedBecause).toMatch(/out of date/i);
  });
});

describe('degradation (Story 1.4.4)', () => {
  /**
   * The configuration Bug 001 actually ran in: a host that composed the
   * reasoning layer without an artefact reader. The fragment describes it
   * accurately rather than disguising it — five untouched stages, and the brief
   * as the only thing that can be done.
   */
  it('reports an untouched pipeline rather than throwing', () => {
    const fragment = createProject({ artefacts: false }).fragment();

    expect(fragment.design.stages).toHaveLength(5);
    expect(fragment.design.currentStage).toBe(PLANNING_STAGES.Brief);
    expect(fragment.design.complete).toBe(false);
    expect(fragment.design.nextTool).toBe(PLANNING_TOOL_NAMES[PLANNING_STAGES.Brief]);
  });

  it('keeps the key present, so a model never meets a missing field', () => {
    const fragment = createProject({ artefacts: false }).fragment();

    expect(Object.hasOwn(fragment, 'design')).toBe(true);
    expect(fragment.design.stages.every((entry) => entry.revision === null)).toBe(true);
  });
});

describe('it crosses as text (Story 1.4.7)', () => {
  it('survives a JSON round trip unchanged', () => {
    const project = createProject();
    project.approve(project.service.interpret(TWO_STOREY).proposal);
    const fragment = project.fragment();

    expect(JSON.parse(JSON.stringify(fragment))).toEqual(fragment);
  });

  it('carries no undefined, which JSON would silently drop', () => {
    const fragment = createProject().fragment();
    const serialised = JSON.stringify(fragment.design);

    expect(serialised).not.toContain('undefined');
    expect(JSON.parse(serialised)).toEqual(fragment.design);
  });
});

describe('the tool table (Story 1.4.3)', () => {
  it('names one tool per stage, and the names the schemas use', () => {
    expect(PLANNING_TOOL_NAMES).toEqual({
      brief: 'planning_captureBrief',
      programme: 'planning_generateProgramme',
      layout: 'planning_generateLayout',
      geometry: 'planning_generateGeometry',
      specification: 'planning_generateSpecification'
    });
  });
});
