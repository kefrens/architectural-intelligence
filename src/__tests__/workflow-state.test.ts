/**
 * Sprint 1.2 — the workflow-state projection, and the seventh lane.
 *
 * Structured as the sprint's epics. What is asserted here is the thing the
 * sprint claims: that this layer can say where a design is without owning any
 * of it, and that a user can now reach all five stages by talking.
 *
 * The chain these tests build is **coherent** — every artefact's provenance
 * names the artefact actually stored above it — because that is what production
 * produces, each stage being generated from the approved artefact the reader
 * answered with. A fixture that stored five unrelated artefacts would be
 * asserting against a project that cannot exist, and since this sprint the
 * projection would (correctly) call it stale.
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
  assembleBrief,
  classifyRequest,
  REQUEST_LANES,
  reviseBrief,
  type ArchitecturalBrief
} from '../brief/index.js';
import {
  GEOMETRY_GRAPH_KIND,
  GEOMETRY_SPECIFICATION_KIND,
  synthesizeGeometry,
  synthesizeSpecification,
  type GeometryGraph,
  type GeometrySpecification
} from '../geometry/index.js';
import { LAYOUT_PLAN_KIND, synthesizeLayout, type LayoutPlan } from '../layout/index.js';
import { PLAN_BLOCKER_REASONS, PLANNING_STAGES } from '../planning/index.js';
import {
  SPACE_PROGRAMME_KIND,
  synthesizeProgramme,
  type SpaceProgramme
} from '../programme/index.js';
import {
  createProgrammeToolDefinition,
  createSpecificationToolDefinition
} from '../tools/index.js';
import {
  deriveWorkflowState,
  stageState,
  STAGE_ARTEFACT_STATES,
  WORKFLOW_ACTIONS,
  WORKFLOW_STAGE_ORDER,
  type ArchitecturalWorkflowState
} from '../workflow/index.js';
import { createHarness } from './harness.js';

const TWO_STOREY = 'Design a two-storey family home with 3 bedrooms and 2 bathrooms';

// --- A coherent project --------------------------------------------------------

interface Chain {
  readonly brief: ArchitecturalBrief;
  readonly programme: SpaceProgramme;
  readonly layout: LayoutPlan;
  readonly graph: GeometryGraph;
  readonly specification: GeometrySpecification;
}

function chainFrom(brief: ArchitecturalBrief): Chain {
  const programme = synthesizeProgramme({ brief });
  if (!programme.ok) throw new Error(programme.message);
  const layout = synthesizeLayout({ programme: programme.programme });
  if (!layout.ok) throw new Error(layout.message);
  const graph = synthesizeGeometry({ layout: layout.plan });
  if (!graph.ok) throw new Error(graph.message);
  const specification = synthesizeSpecification({ graph: graph.graph });
  if (!specification.ok) throw new Error(specification.message);

  return {
    brief,
    programme: programme.programme,
    layout: layout.plan,
    graph: graph.graph,
    specification: specification.specification
  };
}

function briefFor(utterance: string): ArchitecturalBrief {
  return assembleBrief({ utterance, classification: classifyRequest(utterance) });
}

function chain(): Chain {
  return chainFrom(briefFor(TWO_STOREY));
}

/** The artefact record a host stores, for any of the five. */
function record(kind: string, value: { id: string; revision: number }): ApprovedArtefact {
  return { kind, id: value.id, revision: value.revision, value };
}

function readerFor(artefacts: readonly ApprovedArtefact[]): PlanningArtefactReader {
  return createInMemoryPlanningArtefactReader(artefacts);
}

/** Every artefact of a chain, up to and including `upTo`. */
function approvedUpTo(link: Chain, upTo: keyof Chain): ApprovedArtefact[] {
  const all: ApprovedArtefact[] = [
    record(ARCHITECTURAL_BRIEF_KIND, link.brief),
    record(SPACE_PROGRAMME_KIND, link.programme),
    record(LAYOUT_PLAN_KIND, link.layout),
    record(GEOMETRY_GRAPH_KIND, link.graph),
    record(GEOMETRY_SPECIFICATION_KIND, link.specification)
  ];
  const order: (keyof Chain)[] = ['brief', 'programme', 'layout', 'graph', 'specification'];
  return all.slice(0, order.indexOf(upTo) + 1);
}

function serviceFor(artefacts: readonly ApprovedArtefact[]): ArchitecturalIntelligenceService {
  return new ArchitecturalIntelligenceService({
    knowledge: createHarness().knowledge,
    artefacts: readerFor(artefacts)
  });
}

function stage(state: ArchitecturalWorkflowState, name: string) {
  const found = stageState(state, name as never);
  if (found === undefined) throw new Error(`No stage ${name}`);
  return found;
}

// --- Epic 1 — the seventh lane -------------------------------------------------

describe('the specification lane (Story 1.2.1)', () => {
  it('is unreachable for a caller that has not opted in', () => {
    expect(classifyRequest('give it walls').lane).toBe(REQUEST_LANES.DirectExecution);
  });

  it('asks for the construction when the geometry is approved', () => {
    const classification = classifyRequest('give it walls', { hasApprovedGeometry: true });

    expect(classification.lane).toBe(REQUEST_LANES.SpecificationGeneration);
    expect(classification.signals).toContain('approved geometry');
  });

  it.each([
    'generate the specification',
    'now the walls',
    'build the walls',
    'specify the construction'
  ])('reads "%s" as a request for the construction', (utterance) => {
    expect(classifyRequest(utterance, { hasApprovedGeometry: true }).lane).toBe(
      REQUEST_LANES.SpecificationGeneration
    );
  });

  /**
   * Questions are recognised before any lane, and the new one does not change
   * that: "which walls are load bearing?" names the walls and asks something the
   * Building Platform can already answer.
   */
  it('leaves a question about the walls where questions have always gone', () => {
    const classification = classifyRequest('which walls are load bearing?', {
      hasApprovedGeometry: true
    });

    expect(classification.lane).toBe(REQUEST_LANES.DirectExecution);
    expect(classification.reason).toMatch(/question/i);
  });

  /**
   * The guard the word set exists for (Story 27.8.3). "Create a wall" says
   * `wall` and says `create`, and a lane that hijacked it would interrupt a
   * working modelling command with a design stage — the one outcome the
   * classifier's direct-lane bias is there to prevent.
   */
  it.each([
    'create a wall from 0,0 to 4,0',
    'move the kitchen wall 200 mm',
    'delete the wall between the kitchen and the hall'
  ])('leaves "%s" in the direct lane even with an approved geometry', (utterance) => {
    expect(classifyRequest(utterance, { hasApprovedGeometry: true }).lane).toBe(
      REQUEST_LANES.DirectExecution
    );
  });

  it('does not act on a mention that asks for nothing', () => {
    const classification = classifyRequest('the walls look thick', { hasApprovedGeometry: true });

    expect(classification.lane).toBe(REQUEST_LANES.DirectExecution);
    expect(classification.reason).toMatch(/asks for nothing/i);
  });

  it('is checked before the geometry lane', () => {
    // Both lanes are open, and the phrase names the construction.
    const classification = classifyRequest('now generate the wall thickness', {
      hasApprovedLayout: true,
      hasApprovedGeometry: true
    });

    expect(classification.lane).toBe(REQUEST_LANES.SpecificationGeneration);
  });

  it('produces a specification through interpret (Story 1.2.3)', () => {
    const link = chain();
    const response = serviceFor(approvedUpTo(link, 'graph')).interpret('give it walls');

    expect(response.classification?.lane).toBe(REQUEST_LANES.SpecificationGeneration);
    expect(response.specification).toBeDefined();
    expect(response.proposal).toBeDefined();
  });
});

// --- Epic 2 — derivation -------------------------------------------------------

describe('an untouched project', () => {
  it('has five stages, in pipeline order', () => {
    const state = deriveWorkflowState();

    expect(state.stages.map((entry) => entry.stage)).toEqual([
      PLANNING_STAGES.Brief,
      PLANNING_STAGES.Programme,
      PLANNING_STAGES.Layout,
      PLANNING_STAGES.Geometry,
      PLANNING_STAGES.Specification
    ]);
    expect(WORKFLOW_STAGE_ORDER).toEqual(state.stages.map((entry) => entry.stage));
  });

  it('holds nothing, and is not complete', () => {
    const state = deriveWorkflowState();

    expect(state.stages.every((entry) => entry.artefact === STAGE_ARTEFACT_STATES.None)).toBe(true);
    expect(state.stages.every((entry) => entry.approved === undefined)).toBe(true);
    expect(state.complete).toBe(false);
  });

  it('offers the brief and blocks everything below it', () => {
    const state = deriveWorkflowState();

    expect(stage(state, PLANNING_STAGES.Brief).eligible).toBe(true);
    expect(stage(state, PLANNING_STAGES.Brief).actions).toEqual([WORKFLOW_ACTIONS.Generate]);
    expect(stage(state, PLANNING_STAGES.Programme).eligible).toBe(false);
    expect(stage(state, PLANNING_STAGES.Programme).actions).toEqual([]);
    expect(state.currentStage).toBe(PLANNING_STAGES.Brief);
  });

  it('says why a stage cannot proceed, in the one vocabulary (Story 1.2.8)', () => {
    const blockers = stage(deriveWorkflowState(), PLANNING_STAGES.Layout).blockers;

    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.reason).toBe(PLAN_BLOCKER_REASONS.MissingInformation);
    expect(blockers[0]?.message).toMatch(/space programme/i);
    expect(blockers[0]?.suggestions.length).toBeGreaterThan(0);
  });
});

describe('a project mid-pipeline', () => {
  it('opens the next stage and no further (Story 1.2.9)', () => {
    const link = chain();
    const state = deriveWorkflowState({ artefacts: readerFor(approvedUpTo(link, 'programme')) });

    expect(stage(state, PLANNING_STAGES.Layout).eligible).toBe(true);
    expect(stage(state, PLANNING_STAGES.Geometry).eligible).toBe(false);
    expect(state.currentStage).toBe(PLANNING_STAGES.Layout);
  });

  it('offers regeneration for a stage it already holds (Story 1.2.10)', () => {
    const link = chain();
    const state = deriveWorkflowState({ artefacts: readerFor(approvedUpTo(link, 'programme')) });

    expect(stage(state, PLANNING_STAGES.Programme).actions).toEqual([WORKFLOW_ACTIONS.Regenerate]);
    expect(stage(state, PLANNING_STAGES.Layout).actions).toEqual([WORKFLOW_ACTIONS.Generate]);
  });

  it('names the approved artefact so a host can navigate to it', () => {
    const link = chain();
    const state = deriveWorkflowState({ artefacts: readerFor(approvedUpTo(link, 'programme')) });

    expect(stage(state, PLANNING_STAGES.Programme).approved).toEqual({
      id: link.programme.id,
      revision: link.programme.revision
    });
  });

  it('is complete when all five are approved and current (Story 1.2.11)', () => {
    const link = chain();
    const state = deriveWorkflowState({
      artefacts: readerFor(approvedUpTo(link, 'specification'))
    });

    expect(state.complete).toBe(true);
    expect(state.currentStage).toBeUndefined();
    expect(state.stages.every((entry) => entry.stale === undefined)).toBe(true);
  });
});

describe('the brief draft', () => {
  it('is the only stage that can be drafted', () => {
    const state = deriveWorkflowState({ hasBriefDraft: true });

    expect(stage(state, PLANNING_STAGES.Brief).artefact).toBe(STAGE_ARTEFACT_STATES.Draft);
    expect(
      state.stages.slice(1).every((entry) => entry.artefact === STAGE_ARTEFACT_STATES.None)
    ).toBe(true);
  });

  it('does not outrank an approved brief', () => {
    const link = chain();
    const state = deriveWorkflowState({
      artefacts: readerFor(approvedUpTo(link, 'brief')),
      hasBriefDraft: true
    });

    expect(stage(state, PLANNING_STAGES.Brief).artefact).toBe(STAGE_ARTEFACT_STATES.Approved);
  });
});

// --- Epic 2 — staleness --------------------------------------------------------

/** The project after the user revised their brief: same lineage, next revision. */
function afterBriefRevision(link: Chain): ApprovedArtefact[] {
  const revised = reviseBrief(link.brief, {});
  return [...approvedUpTo(link, 'layout').slice(1), record(ARCHITECTURAL_BRIEF_KIND, revised)];
}

describe('staleness (Stories 1.2.5 and 1.2.6)', () => {
  it('reports the stage whose provenance diverged, and from what to what', () => {
    const link = chain();
    const state = deriveWorkflowState({ artefacts: readerFor(afterBriefRevision(link)) });
    const programme = stage(state, PLANNING_STAGES.Programme);

    expect(programme.stale?.inherited).toBe(false);
    expect(programme.stale?.upstreamStage).toBe(PLANNING_STAGES.Brief);
    expect(programme.stale?.derivedFrom).toEqual({ id: link.brief.id, revision: 1 });
    expect(programme.stale?.nowInForce).toEqual({ id: link.brief.id, revision: 2 });
  });

  it('carries staleness down the chain (Rule 6)', () => {
    const link = chain();
    const state = deriveWorkflowState({ artefacts: readerFor(afterBriefRevision(link)) });
    const layout = stage(state, PLANNING_STAGES.Layout);

    expect(layout.stale).toBeDefined();
    expect(layout.stale?.inherited).toBe(true);
    // Its own provenance is intact — that *is* what `inherited` reports.
    expect(layout.stale?.derivedFrom).toEqual(layout.stale?.nowInForce);
  });

  it('leaves a stale artefact approved, and still readable', () => {
    const link = chain();
    const state = deriveWorkflowState({ artefacts: readerFor(afterBriefRevision(link)) });
    const programme = stage(state, PLANNING_STAGES.Programme);

    expect(programme.artefact).toBe(STAGE_ARTEFACT_STATES.Approved);
    expect(programme.approved).toEqual({ id: link.programme.id, revision: 1 });
  });

  it('does not block the stale stage from being regenerated (Rule 7)', () => {
    const link = chain();
    const state = deriveWorkflowState({ artefacts: readerFor(afterBriefRevision(link)) });
    const programme = stage(state, PLANNING_STAGES.Programme);

    expect(programme.eligible).toBe(true);
    expect(programme.blockers).toEqual([]);
    expect(programme.actions).toEqual([WORKFLOW_ACTIONS.Regenerate]);
  });

  it('blocks the stage below it as superseded (Story 1.2.7)', () => {
    const link = chain();
    const state = deriveWorkflowState({ artefacts: readerFor(afterBriefRevision(link)) });
    const layout = stage(state, PLANNING_STAGES.Layout);

    expect(layout.eligible).toBe(false);
    expect(layout.blockers[0]?.reason).toBe(PLAN_BLOCKER_REASONS.Superseded);
    expect(layout.blockers[0]?.message).toMatch(/out of date/i);
  });

  it('makes the earliest stale stage the current one', () => {
    const link = chain();
    const state = deriveWorkflowState({ artefacts: readerFor(afterBriefRevision(link)) });

    expect(state.currentStage).toBe(PLANNING_STAGES.Programme);
    expect(state.complete).toBe(false);
  });

  it('is never reported for the brief, which derives from an utterance', () => {
    const link = chain();
    const state = deriveWorkflowState({ artefacts: readerFor(afterBriefRevision(link)) });

    expect(stage(state, PLANNING_STAGES.Brief).stale).toBeUndefined();
  });
});

// --- Epic 3 — exposure ---------------------------------------------------------

describe('workflowState() (Stories 1.2.12 and 1.2.13)', () => {
  it('degrades to five untouched stages with no artefact reader (Rule 11)', () => {
    const service = new ArchitecturalIntelligenceService({ knowledge: createHarness().knowledge });
    const state = service.workflowState();

    expect(state.stages).toHaveLength(5);
    expect(state.currentStage).toBe(PLANNING_STAGES.Brief);
    expect(state.complete).toBe(false);
  });

  it('never reports a draft with no draft store', () => {
    const service = new ArchitecturalIntelligenceService({ knowledge: createHarness().knowledge });

    expect(
      service
        .workflowState()
        .stages.every((entry) => entry.artefact !== STAGE_ARTEFACT_STATES.Draft)
    ).toBe(true);
  });

  it('reports the draft an unfinished conversation left open', () => {
    let saved: ArchitecturalBrief | undefined;
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge,
      briefDrafts: {
        load: () => saved,
        save: (draft) => {
          saved = draft;
        },
        clear: () => {
          saved = undefined;
        }
      }
    });

    service.interpret('Design a house');

    expect(stage(service.workflowState(), PLANNING_STAGES.Brief).artefact).toBe(
      STAGE_ARTEFACT_STATES.Draft
    );
  });

  it('advances nothing — reading it twice changes nothing (Rule 12)', () => {
    const link = chain();
    const service = serviceFor(approvedUpTo(link, 'programme'));

    expect(service.workflowState()).toEqual(service.workflowState());
    expect(service.approvedLayout()).toBeUndefined();
  });

  it('is derived, not stored: a changed project gives a changed answer (Story 1.2.19)', () => {
    const link = chain();
    let artefacts = approvedUpTo(link, 'brief');
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge,
      artefacts: { current: (kind) => readerFor(artefacts).current(kind) }
    });

    expect(service.workflowState().currentStage).toBe(PLANNING_STAGES.Programme);

    artefacts = approvedUpTo(link, 'programme');

    expect(service.workflowState().currentStage).toBe(PLANNING_STAGES.Layout);
  });
});

describe('the classifier consumes the projection (Story 1.2.14)', () => {
  it('closes a lane whose input was superseded', () => {
    const link = chain();
    const service = serviceFor(afterBriefRevision(link));

    // The layout lane would have been open before this sprint: a programme is
    // approved. It is closed now, because that programme is out of date.
    expect(service.interpret('now generate the layout').layout).toBeUndefined();
  });

  it('leaves the stage that fixes it open', () => {
    const link = chain();
    const service = serviceFor(afterBriefRevision(link));
    const response = service.interpret('now generate the space programme');

    expect(response.classification?.lane).toBe(REQUEST_LANES.ProgrammeGeneration);
    expect(response.programme).toBeDefined();
  });

  it('agrees with the projection it derives from', () => {
    const link = chain();
    const service = serviceFor(approvedUpTo(link, 'layout'));
    const state = service.workflowState();

    expect(stage(state, PLANNING_STAGES.Geometry).eligible).toBe(true);
    expect(service.interpret('now draw the rooms').geometry).toBeDefined();
  });
});

// --- Epic 4 — end to end -------------------------------------------------------

/** A project that records what the user approves, the way the host's registry does. */
function createProject(): {
  readonly reader: PlanningArtefactReader;
  approve(proposal: Proposal | undefined): void;
} {
  let artefacts: ApprovedArtefact[] = [];
  return {
    reader: {
      current: (kind) => createInMemoryPlanningArtefactReader(artefacts).current(kind)
    },
    approve: (proposal) => {
      if (proposal === undefined || !isArtefactProposal(proposal)) {
        throw new Error('Expected an artefact proposal to approve.');
      }
      artefacts = [...artefacts, { ...proposal.subject.artefact }];
    }
  };
}

describe('the five-stage pipeline, end to end (Story 1.2.16)', () => {
  it('walks brief to specification, one approval at a time', () => {
    const project = createProject();
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge,
      artefacts: project.reader
    });

    const brief = service.interpret(TWO_STOREY);
    expect(brief.brief).toBeDefined();
    // Completion is not approval: the artefact exists and the project holds nothing.
    expect(stage(service.workflowState(), PLANNING_STAGES.Brief).artefact).toBe(
      STAGE_ARTEFACT_STATES.None
    );

    project.approve(brief.proposal);
    let state = service.workflowState();
    expect(stage(state, PLANNING_STAGES.Brief).artefact).toBe(STAGE_ARTEFACT_STATES.Approved);
    expect(stage(state, PLANNING_STAGES.Programme).eligible).toBe(true);
    expect(stage(state, PLANNING_STAGES.Layout).eligible).toBe(false);
    expect(state.currentStage).toBe(PLANNING_STAGES.Programme);

    project.approve(service.interpret('now generate the space programme').proposal);
    state = service.workflowState();
    expect(stage(state, PLANNING_STAGES.Programme).artefact).toBe(STAGE_ARTEFACT_STATES.Approved);
    expect(stage(state, PLANNING_STAGES.Layout).eligible).toBe(true);
    expect(stage(state, PLANNING_STAGES.Geometry).eligible).toBe(false);

    project.approve(service.interpret('now generate the layout').proposal);
    state = service.workflowState();
    expect(stage(state, PLANNING_STAGES.Geometry).eligible).toBe(true);
    expect(state.currentStage).toBe(PLANNING_STAGES.Geometry);

    project.approve(service.interpret('now draw the rooms').proposal);
    state = service.workflowState();
    expect(stage(state, PLANNING_STAGES.Specification).eligible).toBe(true);
    expect(state.complete).toBe(false);

    project.approve(service.interpret('give it walls').proposal);
    state = service.workflowState();
    expect(stage(state, PLANNING_STAGES.Specification).artefact).toBe(
      STAGE_ARTEFACT_STATES.Approved
    );
    expect(state.complete).toBe(true);
    expect(state.currentStage).toBeUndefined();
    expect(state.stages.every((entry) => entry.stale === undefined)).toBe(true);
  });
});

describe('completion is not approval (Story 1.2.17)', () => {
  it('does not open the programme lane for a complete but unapproved brief', () => {
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge,
      artefacts: readerFor([])
    });

    const brief = service.interpret(TWO_STOREY);
    expect(brief.brief).toBeDefined();

    // `generateProgramme(brief)` takes its artefact as an argument and cannot
    // know whether it was approved — which is why both gates sit in front of it.
    const response = service.interpret('now generate the space programme');
    expect(response.classification?.lane).toBe(REQUEST_LANES.DirectExecution);
    expect(response.programme).toBeUndefined();
  });

  it('blocks the programme tool for a complete but unapproved brief', () => {
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge,
      artefacts: readerFor([])
    });
    service.interpret(TWO_STOREY);

    expect(createProgrammeToolDefinition(service).resolve({}, {})).toMatchObject({
      kind: 'blocked'
    });
  });

  it('does not open the specification lane for an unapproved geometry', () => {
    const link = chain();
    const service = serviceFor(approvedUpTo(link, 'layout'));

    const geometry = service.interpret('now draw the rooms');
    expect(geometry.geometry).toBeDefined();

    const response = service.interpret('give it walls');
    expect(response.classification?.lane).toBe(REQUEST_LANES.DirectExecution);
    expect(response.specification).toBeUndefined();
  });

  it('blocks the specification tool for an unapproved geometry', () => {
    const link = chain();
    const service = serviceFor(approvedUpTo(link, 'layout'));

    expect(createSpecificationToolDefinition(service).resolve({}, {})).toMatchObject({
      kind: 'blocked'
    });
  });
});
