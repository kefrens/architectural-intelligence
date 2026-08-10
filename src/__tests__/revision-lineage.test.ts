/**
 * Sprint 1.3 — revision lineage and navigation.
 *
 * Sprint 1.2 made staleness visible. This asserts that it is now **fixable
 * through a revision rather than a new lineage**, which is the whole sprint:
 *
 * ```text
 * what the ADR says            what production did before this sprint
 * ─────────────────            ─────────────────────────────────────
 * Brief#a v1                   Brief#a v1
 *     ↓ revise                     ↓ re-brief
 * Brief#a v2                   Brief#b v1   ← a second lineage, not a revision
 * ```
 *
 * The assertion the sprint exists for is {@link lineageIsIntact}: across every
 * revision of every stage, one artefact id.
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
  BRIEF_TOPICS,
  briefRequirement,
  classifyRequest,
  REQUEST_LANES,
  reviseBriefFrom,
  type ArchitecturalBrief
} from '../brief/index.js';
import { GEOMETRY_GRAPH_KIND, synthesizeGeometry } from '../geometry/index.js';
import { LAYOUT_PLAN_KIND, synthesizeLayout } from '../layout/index.js';
import { PLAN_BLOCKER_REASONS, PLANNING_STAGES } from '../planning/index.js';
import { SPACE_PROGRAMME_KIND, synthesizeProgramme } from '../programme/index.js';
import { createLayoutToolDefinition, createProgrammeToolDefinition } from '../tools/index.js';
import { stageState, type ArchitecturalWorkflowState } from '../workflow/index.js';
import { createHarness } from './harness.js';

const TWO_STOREY = 'Design a two-storey family home with 3 bedrooms and 2 bathrooms';

// --- A project that records approvals the way the host's registry does ---------

interface Project {
  readonly reader: PlanningArtefactReader;
  readonly service: ArchitecturalIntelligenceService;
  approve(proposal: Proposal | undefined): void;
  held(): readonly ApprovedArtefact[];
}

/**
 * Keeps every revision, appends on approval, answers the highest revision as
 * current — which is `apps/web`'s `PlanningArtefactRegistry`, restated. `all()`
 * is present because the real registry has had it since Sprint 27.8; the
 * degradation tests below use a reader without one.
 */
function createProject(options: { readonly withHistory?: boolean } = {}): Project {
  let artefacts: ApprovedArtefact[] = [];
  const backing = (): PlanningArtefactReader => createInMemoryPlanningArtefactReader(artefacts);

  const reader: PlanningArtefactReader =
    options.withHistory === false
      ? { current: (kind) => backing().current(kind) }
      : { current: (kind) => backing().current(kind), all: () => artefacts };

  const service = new ArchitecturalIntelligenceService({
    knowledge: createHarness().knowledge,
    artefacts: reader
  });

  return {
    reader,
    service,
    held: () => artefacts,
    approve: (proposal) => {
      if (proposal === undefined || !isArtefactProposal(proposal)) {
        throw new Error('Expected an artefact proposal to approve.');
      }
      artefacts = [...artefacts, { ...proposal.subject.artefact }];
    }
  };
}

/** Walks a project to an approved Brief, Programme and Layout. */
function projectWithLayout(): Project {
  const project = createProject();
  project.approve(project.service.interpret(TWO_STOREY).proposal);
  project.approve(project.service.interpret('now generate the space programme').proposal);
  project.approve(project.service.interpret('now generate the layout').proposal);
  return project;
}

function stage(state: ArchitecturalWorkflowState, name: string) {
  const found = stageState(state, name as never);
  if (found === undefined) throw new Error(`No stage ${name}`);
  return found;
}

/** The assertion this sprint exists for: one id per stage, however many revisions. */
function lineageIsIntact(state: ArchitecturalWorkflowState): boolean {
  return state.stages.every(
    (entry) => new Set(entry.revisions.map((revision) => revision.id)).size <= 1
  );
}

function briefFor(utterance: string): ArchitecturalBrief {
  return assembleBrief({ utterance, classification: classifyRequest(utterance) });
}

// --- Epic 1 — lineage in the projection ----------------------------------------

describe('the artefact port (Story 1.3.1)', () => {
  it('answers every approved artefact, argument-free', () => {
    const brief = briefFor(TWO_STOREY);
    const reader = createInMemoryPlanningArtefactReader([
      { kind: ARCHITECTURAL_BRIEF_KIND, id: brief.id, revision: 1, value: brief },
      { kind: ARCHITECTURAL_BRIEF_KIND, id: brief.id, revision: 2, value: brief }
    ]);

    expect(reader.all?.()).toHaveLength(2);
  });

  /**
   * ADR-AI-0002 Rule 10, asserted structurally. `apps/web`'s
   * `PlanningArtefactRegistry` exposes exactly this signature and has since
   * Sprint 27.8, so declaring it cost the other repository nothing. A future
   * change to `history(kind)` would compile here and fail at a consumer's
   * `npm install`, which is the worst place to find out — so the shape is
   * pinned by a test in the repository that owns it.
   */
  it('is satisfied by a host object that only has all() and current()', () => {
    const brief = briefFor(TWO_STOREY);
    const hostRegistry = {
      all: () => [{ kind: ARCHITECTURAL_BRIEF_KIND, id: brief.id, revision: 1, value: brief }],
      current: () => ({ kind: ARCHITECTURAL_BRIEF_KIND, id: brief.id, revision: 1, value: brief })
    };
    const reader: PlanningArtefactReader = hostRegistry;

    expect(reader.all?.()).toHaveLength(1);
  });
});

describe('revisions in the projection (Stories 1.3.2 and 1.3.3)', () => {
  it('lists every revision, oldest first', () => {
    const project = projectWithLayout();
    project.approve(project.service.interpret('actually make it 4 bedrooms').proposal);

    const revisions = stage(project.service.workflowState(), PLANNING_STAGES.Brief).revisions;

    expect(revisions.map((revision) => revision.revision)).toEqual([1, 2]);
  });

  it('keeps a superseded revision readable rather than filtering it out', () => {
    const project = projectWithLayout();
    const first = stage(project.service.workflowState(), PLANNING_STAGES.Brief).approved!;

    project.approve(project.service.interpret('actually make it 4 bedrooms').proposal);
    const state = project.service.workflowState();

    expect(stage(state, PLANNING_STAGES.Brief).revisions).toContainEqual(first);
    expect(stage(state, PLANNING_STAGES.Brief).approved?.revision).toBe(2);
  });

  it('falls back to the revision in force when the host supplies no all() (Story 1.3.14)', () => {
    const project = createProject({ withHistory: false });
    project.approve(project.service.interpret(TWO_STOREY).proposal);

    const brief = stage(project.service.workflowState(), PLANNING_STAGES.Brief);

    expect(brief.revisions).toEqual([brief.approved]);
    expect(brief.artefact).toBe('approved');
  });

  it('reports no revisions for a stage the project has never approved', () => {
    const project = createProject();

    expect(stage(project.service.workflowState(), PLANNING_STAGES.Layout).revisions).toEqual([]);
  });
});

describe('a split lineage is a defect (Story 1.3.4)', () => {
  const twoLineages = (): PlanningArtefactReader => {
    const first = briefFor(TWO_STOREY);
    const second = briefFor(TWO_STOREY);
    return createInMemoryPlanningArtefactReader([
      { kind: ARCHITECTURAL_BRIEF_KIND, id: first.id, revision: 1, value: first },
      { kind: ARCHITECTURAL_BRIEF_KIND, id: second.id, revision: 1, value: second }
    ]);
  };

  it('is reported, not papered over', () => {
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge,
      artefacts: twoLineages()
    });
    const brief = stage(service.workflowState(), PLANNING_STAGES.Brief);

    expect(brief.eligible).toBe(false);
    expect(brief.blockers[0]?.reason).toBe(PLAN_BLOCKER_REASONS.Ambiguous);
    expect(brief.blockers[0]?.message).toMatch(/separate briefs/i);
  });

  it('blocks the stage below it too, rather than picking a lineage silently', () => {
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge,
      artefacts: twoLineages()
    });
    const programme = stage(service.workflowState(), PLANNING_STAGES.Programme);

    expect(programme.eligible).toBe(false);
    expect(programme.blockers[0]?.reason).toBe(PLAN_BLOCKER_REASONS.Ambiguous);
  });
});

// --- Epic 2 — revision as a production path ------------------------------------

describe('revising the brief (Story 1.3.5)', () => {
  it('produces revision n+1 of the same lineage', () => {
    const approved = briefFor(TWO_STOREY);
    const revised = reviseBriefFrom(approved, 'actually make it 4 bedrooms');

    expect(revised?.id).toBe(approved.id);
    expect(revised?.revision).toBe(2);
    expect(briefRequirement(revised!, BRIEF_TOPICS.Bedrooms)?.value).toBe(4);
  });

  it('patches rather than replaces — untouched topics keep their value and source', () => {
    const approved = briefFor(TWO_STOREY);
    const before = briefRequirement(approved, BRIEF_TOPICS.Bathrooms)!;
    const revised = reviseBriefFrom(approved, 'actually make it 4 bedrooms')!;
    const after = briefRequirement(revised, BRIEF_TOPICS.Bathrooms)!;

    expect(after.value).toBe(before.value);
    expect(after.source).toBe(before.source);
  });

  it('carries the objective forward — a correction is not a new purpose', () => {
    const approved = briefFor(TWO_STOREY);
    const revised = reviseBriefFrom(approved, 'actually make it 4 bedrooms')!;

    expect(revised.objectives).toEqual(approved.objectives);
  });

  it('records the sentence this revision was built from', () => {
    const approved = briefFor(TWO_STOREY);
    const revised = reviseBriefFrom(approved, 'actually make it 4 bedrooms')!;

    expect(revised.utterance).toBe('actually make it 4 bedrooms');
    expect(approved.utterance).toBe(TWO_STOREY);
  });

  it('answers nothing when the utterance moves nothing', () => {
    const approved = briefFor(TWO_STOREY);

    expect(reviseBriefFrom(approved, 'actually make it 3 bedrooms')).toBeUndefined();
  });

  it('says so through the service rather than superseding with an identical revision', () => {
    const project = projectWithLayout();
    const response = project.service.interpret('actually make it 3 bedrooms');

    expect(response.blocker?.reason).toBe(PLAN_BLOCKER_REASONS.NothingToDo);
    expect(response.proposal).toBeUndefined();
  });
});

describe('the revision lane (Story 1.3.6)', () => {
  it('is unreachable for a caller that has not opted in', () => {
    expect(classifyRequest('actually make it 4 bedrooms').lane).toBe(REQUEST_LANES.DirectExecution);
  });

  it.each([
    'actually make it 4 bedrooms',
    'change it to 3 bathrooms',
    'make it 3 storeys instead',
    'revise the brief: 5 bedrooms'
  ])('reads "%s" as a revision', (utterance) => {
    expect(classifyRequest(utterance, { hasBriefToRevise: true }).lane).toBe(
      REQUEST_LANES.BriefRevision
    );
  });

  /**
   * A cue is necessary and never sufficient. Each of these is a correction, and
   * none of them names anything the Brief states — so the direct lane keeps them,
   * exactly as it has since Story 27.8.3.
   */
  it.each([
    'actually, move the kitchen wall 200 mm',
    'change this wall to load bearing',
    'make it wider'
  ])('leaves "%s" in the direct lane', (utterance) => {
    expect(classifyRequest(utterance, { hasBriefToRevise: true }).lane).toBe(
      REQUEST_LANES.DirectExecution
    );
  });

  it('outranks brief generation, so a re-description does not fork the lineage', () => {
    const classification = classifyRequest('actually design a three-storey house', {
      hasBriefToRevise: true
    });

    expect(classification.lane).toBe(REQUEST_LANES.BriefRevision);
  });
});

describe('regeneration is revision (Story 1.3.7)', () => {
  it('revises the programme rather than minting a second one', () => {
    const project = projectWithLayout();
    const first = stage(project.service.workflowState(), PLANNING_STAGES.Programme).approved!;

    project.approve(project.service.interpret('now generate the space programme').proposal);
    const second = stage(project.service.workflowState(), PLANNING_STAGES.Programme).approved!;

    expect(second.id).toBe(first.id);
    expect(second.revision).toBe(first.revision + 1);
  });

  it('records the upstream revision the regeneration actually read (Story 1.3.8)', () => {
    const project = projectWithLayout();
    project.approve(project.service.interpret('actually make it 4 bedrooms').proposal);

    const response = project.service.interpret('now generate the space programme');

    expect(response.programme?.sourceBrief.briefRevision).toBe(2);
    expect(response.programme?.revision).toBe(2);
  });
});

// --- Epic 3 — enforcement ------------------------------------------------------

describe('generation refuses a superseded input (Story 1.3.9)', () => {
  it('refuses a brief the project has revised past', () => {
    const project = projectWithLayout();
    const superseded = project.service.approvedBrief()!;
    project.approve(project.service.interpret('actually make it 4 bedrooms').proposal);

    const response = project.service.generateProgramme(superseded);

    expect(response.blocker?.reason).toBe(PLAN_BLOCKER_REASONS.Superseded);
    expect(response.proposal).toBeUndefined();
    expect(response.blocker?.suggestions[0]).toMatch(/in force/i);
  });

  it('refuses a programme from a different lineage', () => {
    const project = projectWithLayout();
    const foreign = synthesizeProgramme({ brief: briefFor(TWO_STOREY) });
    if (!foreign.ok) throw new Error(foreign.message);

    const response = project.service.generateLayout(foreign.programme);

    expect(response.blocker?.reason).toBe(PLAN_BLOCKER_REASONS.Superseded);
    expect(response.blocker?.message).toMatch(/not the one this project holds/i);
  });

  it('stays silent when the project holds nothing of that kind', () => {
    // An artefact the project never approved is not one it superseded, and a
    // caller composing a pipeline by hand still works exactly as it did.
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge,
      artefacts: createInMemoryPlanningArtefactReader([])
    });

    expect(service.generateProgramme(briefFor(TWO_STOREY)).proposal).toBeDefined();
  });

  it('stays silent with no reader at all', () => {
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge
    });

    expect(service.generateProgramme(briefFor(TWO_STOREY)).proposal).toBeDefined();
  });
});

describe('the tools regenerate rather than fail (Story 1.3.10)', () => {
  it('produces a fresh programme revision on a stale stage', () => {
    const project = projectWithLayout();
    project.approve(project.service.interpret('actually make it 4 bedrooms').proposal);

    const resolved = createProgrammeToolDefinition(project.service).resolve({}, {});

    expect(resolved).toMatchObject({ kind: 'proposal' });
  });

  /**
   * The clause that closed a hole this sprint's first draft left open.
   *
   * The layout tool reads the programme *in force* and passes it faithfully — so
   * the "not the artefact in force" check never fires. But that programme was
   * derived from Brief v1, and a layout built on it would be stale on the day it
   * was approved. Without the second clause of `supersededInput` a tool could
   * build precisely what the workflow state says is unavailable.
   */
  it('refuses the layout tool while the programme it needs is stale', () => {
    const project = projectWithLayout();
    project.approve(project.service.interpret('actually make it 4 bedrooms').proposal);

    const resolved = createLayoutToolDefinition(project.service).resolve({}, {});

    expect(resolved).toMatchObject({ kind: 'blocked' });
    expect(stage(project.service.workflowState(), PLANNING_STAGES.Layout).eligible).toBe(false);
  });

  it('offers the layout again once the programme is regenerated', () => {
    const project = projectWithLayout();
    project.approve(project.service.interpret('actually make it 4 bedrooms').proposal);
    project.approve(project.service.interpret('now generate the space programme').proposal);

    expect(createLayoutToolDefinition(project.service).resolve({}, {})).toMatchObject({
      kind: 'proposal'
    });
  });
});

// --- Epic 4 — end to end -------------------------------------------------------

describe('revision, end to end (Story 1.3.11)', () => {
  it('supersedes the brief and marks everything below it stale', () => {
    const project = projectWithLayout();
    const briefV1 = project.service.approvedBrief()!;

    project.approve(project.service.interpret('actually make it 4 bedrooms').proposal);
    const state = project.service.workflowState();

    expect(stage(state, PLANNING_STAGES.Brief).approved).toEqual({
      id: briefV1.id,
      revision: 2
    });
    expect(stage(state, PLANNING_STAGES.Programme).stale?.inherited).toBe(false);
    expect(stage(state, PLANNING_STAGES.Layout).stale?.inherited).toBe(true);
    expect(state.currentStage).toBe(PLANNING_STAGES.Programme);
    expect(lineageIsIntact(state)).toBe(true);
  });

  it('names the revision each stale stage came from, and the one in force', () => {
    const project = projectWithLayout();
    const briefV1 = project.service.approvedBrief()!;
    project.approve(project.service.interpret('actually make it 4 bedrooms').proposal);

    const programme = stage(project.service.workflowState(), PLANNING_STAGES.Programme);

    expect(programme.stale?.derivedFrom).toEqual({ id: briefV1.id, revision: 1 });
    expect(programme.stale?.nowInForce).toEqual({ id: briefV1.id, revision: 2 });
  });
});

describe('recovery, end to end (Story 1.3.12)', () => {
  it('clears staleness one stage at a time, and never before its turn', () => {
    const project = projectWithLayout();
    project.approve(project.service.interpret('actually make it 4 bedrooms').proposal);

    // Regenerate the programme: it becomes current, the layout does not.
    project.approve(project.service.interpret('now generate the space programme').proposal);
    let state = project.service.workflowState();
    expect(stage(state, PLANNING_STAGES.Programme).stale).toBeUndefined();
    expect(stage(state, PLANNING_STAGES.Programme).approved?.revision).toBe(2);
    expect(stage(state, PLANNING_STAGES.Layout).stale).toBeDefined();
    expect(state.currentStage).toBe(PLANNING_STAGES.Layout);

    // Regenerate the layout: the whole chain is current again.
    project.approve(project.service.interpret('now generate the layout').proposal);
    state = project.service.workflowState();
    expect(state.stages.every((entry) => entry.stale === undefined)).toBe(true);
    expect(stage(state, PLANNING_STAGES.Layout).approved?.revision).toBe(2);
    expect(state.currentStage).toBe(PLANNING_STAGES.Geometry);
  });

  it('keeps one lineage per stage throughout (Story 1.3.13)', () => {
    const project = projectWithLayout();
    project.approve(project.service.interpret('actually make it 4 bedrooms').proposal);
    project.approve(project.service.interpret('now generate the space programme').proposal);
    project.approve(project.service.interpret('now generate the layout').proposal);
    project.approve(project.service.interpret('now draw the rooms').proposal);
    project.approve(project.service.interpret('give it walls').proposal);

    const state = project.service.workflowState();

    expect(lineageIsIntact(state)).toBe(true);
    expect(state.complete).toBe(true);
    // Two brief revisions, two programme revisions, two layout revisions, and
    // one each of the two stages that were never built before the revision.
    expect(project.held()).toHaveLength(8);
  });

  it('carries a revised brief all the way into the geometry it produces', () => {
    const project = projectWithLayout();
    project.approve(project.service.interpret('actually make it 5 bedrooms').proposal);
    project.approve(project.service.interpret('now generate the space programme').proposal);
    project.approve(project.service.interpret('now generate the layout').proposal);

    const bedrooms = project.service
      .approvedProgramme()!
      .spaces.filter((space) => space.name.toLowerCase().includes('bedroom'))
      .reduce((total, space) => total + space.count, 0);

    expect(bedrooms).toBe(5);
  });
});

// --- Degradation ---------------------------------------------------------------

describe('a host that supplies no history (Story 1.3.14)', () => {
  it('still detects staleness and still revises', () => {
    const project = createProject({ withHistory: false });
    project.approve(project.service.interpret(TWO_STOREY).proposal);
    project.approve(project.service.interpret('now generate the space programme').proposal);
    project.approve(project.service.interpret('actually make it 4 bedrooms').proposal);

    const state = project.service.workflowState();

    expect(stage(state, PLANNING_STAGES.Brief).approved?.revision).toBe(2);
    expect(stage(state, PLANNING_STAGES.Programme).stale?.inherited).toBe(false);
    expect(stage(state, PLANNING_STAGES.Brief).revisions).toHaveLength(1);
  });

  it('reports no split lineage it cannot see, rather than guessing', () => {
    const project = createProject({ withHistory: false });
    project.approve(project.service.interpret(TWO_STOREY).proposal);

    expect(stage(project.service.workflowState(), PLANNING_STAGES.Brief).blockers).toEqual([]);
  });
});

// --- The kinds are the ones the host stores under ------------------------------

describe('the artefact kinds this sprint reads', () => {
  it('are the five the pipeline table names', () => {
    expect([
      ARCHITECTURAL_BRIEF_KIND,
      SPACE_PROGRAMME_KIND,
      LAYOUT_PLAN_KIND,
      GEOMETRY_GRAPH_KIND
    ]).toEqual(['architectural-brief', 'space-programme', 'layout-plan', 'geometry-graph']);
    expect(synthesizeLayout).toBeTypeOf('function');
    expect(synthesizeGeometry).toBeTypeOf('function');
  });
});
