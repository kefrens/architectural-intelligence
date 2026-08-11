/**
 * Sprint 1.5 — Brief lifecycle integrity (Bug 002).
 *
 * Sprint 1.3 established that producing an artefact for a project that already
 * has one is a **revision** of it. Four stages got that; the Brief kept three
 * paths that created one, and all three forked:
 *
 * ```text
 * planning_captureBrief          → new id, revision 1, every call
 * interpret → brief-generation   → new id, revision 1
 * interpret → clarification ends → the draft's own id becomes the artefact
 * ```
 *
 * Two forks put the project in a state Sprint 1.3 reports as `ambiguous` and
 * from which no stage is eligible — a dead project, two turns from a fresh one.
 *
 * What is asserted here is the invariant, from every door: **one Brief lineage,
 * whatever anyone does.**
 */

import { isArtefactProposal, type Proposal } from '@archisimple/ai-engine';
import { describe, expect, it } from 'vitest';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import {
  createInMemoryPlanningArtefactReader,
  type ApprovedArtefact,
  type PlanningArtefactReader
} from '../artefacts/planning-artefact-reader.js';
import {
  ARCHITECTURAL_BRIEF_KIND,
  BRIEF_REQUIREMENT_SOURCES,
  BRIEF_TOPICS,
  briefRequirement,
  classifyRequest,
  REQUEST_LANES,
  reviseBriefFromFields,
  assembleBrief,
  type ArchitecturalBrief,
  type BriefDraftStore
} from '../brief/index.js';
import { PLAN_BLOCKER_REASONS, PLANNING_STAGES } from '../planning/index.js';
import { createCaptureBriefToolDefinition } from '../tools/index.js';
import { stageState } from '../workflow/index.js';
import { createHarness } from './harness.js';

const REQUEST = 'Build me a 100m2 apartment, with 2 bedrooms and 1 bathroom';

/** What the model sends for that request. */
const FIELDS = {
  objectives: ['A 100 m² apartment'],
  spaces: [{ name: 'bedroom', count: 2 }],
  storeys: 1,
  bedrooms: 2,
  bathrooms: 1
};

interface Project {
  readonly service: ArchitecturalIntelligenceService;
  approve(proposal: Proposal | undefined): void;
  briefs(): readonly ApprovedArtefact[];
  lineages(): number;
}

function createProject(options: { readonly drafts?: boolean } = {}): Project {
  let artefacts: ApprovedArtefact[] = [];
  const reader: PlanningArtefactReader = {
    current: (kind) => createInMemoryPlanningArtefactReader(artefacts).current(kind),
    all: () => artefacts
  };

  let draft: ArchitecturalBrief | undefined;
  const drafts: BriefDraftStore = {
    load: () => draft,
    save: (value) => {
      draft = value;
    },
    clear: () => {
      draft = undefined;
    }
  };

  const service = new ArchitecturalIntelligenceService({
    knowledge: createHarness().knowledge,
    artefacts: reader,
    ...(options.drafts === false ? {} : { briefDrafts: drafts })
  });

  const briefs = () => artefacts.filter((entry) => entry.kind === ARCHITECTURAL_BRIEF_KIND);

  return {
    service,
    briefs,
    lineages: () => new Set(briefs().map((entry) => entry.id)).size,
    approve: (proposal) => {
      if (proposal === undefined || !isArtefactProposal(proposal)) {
        throw new Error('Expected an artefact proposal to approve.');
      }
      artefacts = [...artefacts, { ...proposal.subject.artefact }];
    }
  };
}

/** A project holding exactly one approved Brief, captured through the tool. */
function projectWithBrief(): Project {
  const project = createProject();
  const tool = createCaptureBriefToolDefinition(project.service);
  const resolved = tool.resolve(FIELDS, {});
  if (resolved?.kind !== 'proposal') {
    throw new Error('Expected the first capture to propose a brief.');
  }
  project.approve(resolved.proposal);
  return project;
}

// --- Epic 1 — revision-safe Brief production -----------------------------------

describe('the capture tool (Stories 1.5.2–1.5.4)', () => {
  it('captures a first brief exactly as it always did', () => {
    const project = createProject();
    const resolved = createCaptureBriefToolDefinition(project.service).resolve(FIELDS, {});

    expect(resolved?.kind).toBe('proposal');
    project.approve(resolved?.kind === 'proposal' ? resolved.proposal : undefined);
    expect(project.briefs()).toHaveLength(1);
    expect(project.briefs()[0]?.revision).toBe(1);
  });

  it('keeps the tool name and schema a model already knows', () => {
    const project = createProject();
    const tool = createCaptureBriefToolDefinition(project.service);

    expect(tool.schema.function.name).toBe('planning_captureBrief');
    expect(tool.requires).toEqual([]);
  });

  /** Bug 002's loop, ended. */
  it('answers NothingToDo when a re-capture would change nothing (Story 1.5.3)', () => {
    const project = projectWithBrief();
    const resolved = createCaptureBriefToolDefinition(project.service).resolve(FIELDS, {});

    expect(resolved?.kind).toBe('blocked');
    expect(resolved?.kind === 'blocked' && resolved.message).toMatch(/already/i);
    expect(project.lineages()).toBe(1);
    expect(project.briefs()).toHaveLength(1);
  });

  it('revises rather than forking when a re-capture changes something (Story 1.5.4)', () => {
    const project = projectWithBrief();
    const first = project.briefs()[0]!;

    const resolved = createCaptureBriefToolDefinition(project.service).resolve(
      { ...FIELDS, bedrooms: 3 },
      {}
    );
    expect(resolved?.kind).toBe('proposal');
    project.approve(resolved?.kind === 'proposal' ? resolved.proposal : undefined);

    expect(project.lineages()).toBe(1);
    expect(project.briefs()[1]?.id).toBe(first.id);
    expect(project.briefs()[1]?.revision).toBe(2);
  });

  it('carries untouched topics forward with their original source', () => {
    const project = projectWithBrief();
    const before = project.service.approvedBrief()!;

    const resolved = createCaptureBriefToolDefinition(project.service).resolve(
      { ...FIELDS, bedrooms: 3 },
      {}
    );
    project.approve(resolved?.kind === 'proposal' ? resolved.proposal : undefined);
    const after = project.service.approvedBrief()!;

    expect(briefRequirement(after, BRIEF_TOPICS.Bedrooms)?.value).toBe(3);
    // The garage was assumed, not stated, and a re-capture that never mentioned
    // it must not promote it to something the user said.
    expect(briefRequirement(after, BRIEF_TOPICS.Garage)?.source).toBe(
      briefRequirement(before, BRIEF_TOPICS.Garage)?.source
    );
    expect(briefRequirement(after, BRIEF_TOPICS.Garage)?.source).toBe(
      BRIEF_REQUIREMENT_SOURCES.Assumed
    );
  });

  it('keeps the words the brief was first described with', () => {
    const project = projectWithBrief();
    const before = project.service.approvedBrief()!;

    const resolved = createCaptureBriefToolDefinition(project.service).resolve(
      { ...FIELDS, bedrooms: 3 },
      {}
    );
    project.approve(resolved?.kind === 'proposal' ? resolved.proposal : undefined);

    // A tool call has structured fields and no sentence of its own.
    expect(project.service.approvedBrief()?.utterance).toBe(before.utterance);
  });
});

describe('the folding rule (Story 1.5.1)', () => {
  const brief = (): ArchitecturalBrief =>
    assembleBrief({ utterance: REQUEST, classification: classifyRequest(REQUEST) });

  it('answers undefined when nothing moved', () => {
    const approved = brief();

    expect(
      reviseBriefFromFields(approved, { requirements: approved.requirements })
    ).toBeUndefined();
  });

  it('overrides a topic and keeps the identity', () => {
    const approved = brief();
    const revised = reviseBriefFromFields(approved, {
      requirements: [{ topic: BRIEF_TOPICS.Bedrooms, value: 4, statement: '4 bedrooms' }]
    })!;

    expect(revised.id).toBe(approved.id);
    expect(revised.revision).toBe(approved.revision + 1);
    expect(briefRequirement(revised, BRIEF_TOPICS.Bedrooms)?.value).toBe(4);
  });

  it('carries objectives forward — a correction is not a new purpose', () => {
    const approved = brief();
    const revised = reviseBriefFromFields(approved, {
      requirements: [{ topic: BRIEF_TOPICS.Bedrooms, value: 4, statement: '4 bedrooms' }]
    })!;

    expect(revised.objectives).toEqual(approved.objectives);
  });

  it('notices a space that was added even when no requirement moved', () => {
    const approved = brief();
    const revised = reviseBriefFromFields(approved, { spaces: [{ name: 'study', count: 1 }] });

    expect(revised?.desiredSpaces.some((space) => space.name === 'study')).toBe(true);
  });
});

// --- Epic 2 — the conversational paths -----------------------------------------

describe('the conversation cannot fork the lineage (Stories 1.5.6–1.5.9)', () => {
  it('folds a re-description that carries no revision cue (Story 1.5.6)', () => {
    const project = projectWithBrief();
    const first = project.briefs()[0]!;

    // Classifies as `brief-generation`, which forked before Sprint 1.5.
    const response = project.service.interpret(
      'design a two-storey house with 4 bedrooms and 2 bathrooms'
    );
    project.approve(response.proposal);

    expect(project.lineages()).toBe(1);
    expect(project.briefs()[1]?.id).toBe(first.id);
    expect(project.briefs()[1]?.revision).toBe(2);
  });

  it('folds a completed clarification dialogue (Story 1.5.7)', () => {
    const project = projectWithBrief();
    const first = project.briefs()[0]!;

    // An incomplete design request opens a draft…
    const opened = project.service.interpret('design a villa');
    expect(opened.clarification).toBeDefined();

    // …and answering it completes the draft, which before Sprint 1.5 became an
    // artefact under the *draft's* id.
    let response = project.service.interpret('3');
    while (response.clarification !== undefined) {
      response = project.service.interpret('2');
    }
    project.approve(response.proposal);

    expect(project.lineages()).toBe(1);
    expect(project.briefs()[1]?.id).toBe(first.id);
  });

  it('answers NothingToDo when a re-description changes nothing (Story 1.5.8)', () => {
    const project = projectWithBrief();
    const response = project.service.interpret('actually make it 2 bedrooms');

    expect(response.blocker?.reason).toBe(PLAN_BLOCKER_REASONS.NothingToDo);
    expect(response.proposal).toBeUndefined();
    expect(project.briefs()).toHaveLength(1);
  });

  it('still revises through the Sprint 1.3 lane', () => {
    const project = projectWithBrief();
    const response = project.service.interpret('actually make it 4 bedrooms');
    project.approve(response.proposal);

    expect(project.lineages()).toBe(1);
    expect(project.service.approvedBrief()?.revision).toBe(2);
  });

  /** Every door, one project, one lineage (Story 1.5.9). */
  it('holds one lineage after every producing path has been used', () => {
    const project = projectWithBrief();

    createCaptureBriefToolDefinition(project.service).resolve({ ...FIELDS, bedrooms: 3 }, {});
    project.approve(
      (() => {
        const r = createCaptureBriefToolDefinition(project.service).resolve(
          { ...FIELDS, bedrooms: 3 },
          {}
        );
        return r?.kind === 'proposal' ? r.proposal : undefined;
      })()
    );
    project.approve(project.service.interpret('actually make it 4 bathrooms').proposal);
    project.approve(
      project.service.interpret('design a three-storey house with 5 bedrooms and 3 bathrooms')
        .proposal
    );

    expect(project.lineages()).toBe(1);
    expect(project.service.approvedBrief()?.revision).toBe(4);
  });
});

// --- Epic 3 — classification ---------------------------------------------------

describe('dwelling recognition (Stories 1.5.10 and 1.5.11)', () => {
  it.each([
    'Build me a 100m2 appartment, with 2 bedrooms and 1 bathroom',
    'Build me a 100m2 appartement, with 2 bedrooms and 1 bathroom',
    'design a duplex with 3 bedrooms and 2 bathrooms on 2 storeys',
    'design a townhouse with 3 bedrooms and 2 bathrooms on 2 storeys',
    'design a penthouse with 2 bedrooms and 2 bathrooms on 1 storey',
    'design a maisonnette with 2 bedrooms and 1 bathroom on 2 storeys'
  ])('reads "%s" as a design request', (utterance) => {
    expect(classifyRequest(utterance).lane).not.toBe(REQUEST_LANES.DirectExecution);
  });

  it('reaches the same lane whichever way apartment is spelled', () => {
    expect(
      classifyRequest('Build me a 100m2 appartment, with 2 bedrooms and 1 bathroom').lane
    ).toBe(classifyRequest('Build me a 100m2 apartment, with 2 bedrooms and 1 bathroom').lane);
  });

  /**
   * The negative half, and the one that matters more: the classifier's
   * asymmetry is deliberate, and widening a word list must not move it.
   */
  it.each([
    'create a wall from 0,0 to 4,0',
    'move the kitchen wall 200 mm',
    'delete the selection',
    'rename this room to Study',
    'align these two walls',
    'create a room of 16 m²'
  ])('leaves "%s" in the direct lane', (utterance) => {
    expect(classifyRequest(utterance).lane).toBe(REQUEST_LANES.DirectExecution);
  });

  it('still needs a design verb before a mentioned dwelling counts', () => {
    expect(classifyRequest('move the kitchen in my appartment 2 m north').lane).toBe(
      REQUEST_LANES.DirectExecution
    );
  });
});

// --- Epic 4 — regression -------------------------------------------------------

describe('Bug 002, as a test (Story 1.5.12)', () => {
  it('leaves one lineage at revision 1 after a re-capture, and a live workflow', () => {
    const project = projectWithBrief();

    // The "ok" that produced a second Brief in the transcript.
    const resolved = createCaptureBriefToolDefinition(project.service).resolve(FIELDS, {});
    expect(resolved?.kind).toBe('blocked');

    expect(project.lineages()).toBe(1);
    expect(project.briefs()).toHaveLength(1);
    expect(project.briefs()[0]?.revision).toBe(1);

    // And the workflow is alive rather than terminal.
    const state = project.service.workflowState();
    expect(state.currentStage).toBe(PLANNING_STAGES.Programme);
    expect(stageState(state, PLANNING_STAGES.Brief)?.eligible).toBe(true);
    expect(stageState(state, PLANNING_STAGES.Programme)?.eligible).toBe(true);
  });
});

describe('the pipeline still completes (Story 1.5.13)', () => {
  it('reaches a specification after a re-capture partway through', () => {
    const project = projectWithBrief();

    // A re-capture that changes something, mid-design.
    const resolved = createCaptureBriefToolDefinition(project.service).resolve(
      { ...FIELDS, bedrooms: 3 },
      {}
    );
    project.approve(resolved?.kind === 'proposal' ? resolved.proposal : undefined);

    project.approve(project.service.interpret('now generate the space programme').proposal);
    project.approve(project.service.interpret('now generate the layout').proposal);
    project.approve(project.service.interpret('now draw the rooms').proposal);
    project.approve(project.service.interpret('give it walls').proposal);

    const state = project.service.workflowState();
    expect(state.complete).toBe(true);
    expect(project.lineages()).toBe(1);
    expect(state.stages.every((stage) => stage.revisions.length >= 1)).toBe(true);
  });
});

describe('the guard still guards (Story 1.5.14)', () => {
  /**
   * Sprint 1.5 makes the split unreachable; it does not make it acceptable. A
   * project that somehow holds two lineages is still reported, and no lineage is
   * chosen for the user.
   */
  it('still reports two lineages as ambiguous, and picks neither', () => {
    const first = assembleBrief({ utterance: REQUEST, classification: classifyRequest(REQUEST) });
    const second = assembleBrief({ utterance: REQUEST, classification: classifyRequest(REQUEST) });
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge,
      artefacts: createInMemoryPlanningArtefactReader([
        { kind: ARCHITECTURAL_BRIEF_KIND, id: first.id, revision: 1, value: first },
        { kind: ARCHITECTURAL_BRIEF_KIND, id: second.id, revision: 1, value: second }
      ])
    });

    const brief = stageState(service.workflowState(), PLANNING_STAGES.Brief);

    expect(brief?.eligible).toBe(false);
    expect(brief?.blockers[0]?.reason).toBe(PLAN_BLOCKER_REASONS.Ambiguous);
  });
});
