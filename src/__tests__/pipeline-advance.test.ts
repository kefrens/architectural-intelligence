/**
 * Bug 005 — an acknowledgement must not regenerate, and the pipeline must
 * advance.
 *
 * The observed conversation looked like an approval-bypass and was the exact
 * opposite. Every gate held: with only a Brief approved, the three downstream
 * tools all returned deterministic blockers. What actually broke was one stage
 * up.
 *
 * ```text
 * "ok" → generateProgramme  → revision N+1 of an identical programme  ← takes the
 *      → generateLayout     → a perfectly good Layout proposal          proposal slot
 *      → generateGeometry   → blocked
 *      → generateSpecification → blocked
 * ```
 *
 * `aiServiceProvider` carries **one** artefact proposal per reply, so the
 * Programme claimed it (the model calls it first) and the Layout was dropped
 * with "1 further action was proposed alongside this plan and left out". The
 * user approved the churned Programme, superseding the one the dropped Layout
 * came from, and the loop closed. Four `ok`s produced Programme revisions 1–4
 * and never a Layout.
 *
 * So these tests assert two things: that regeneration of an unchanged stage is
 * refused, and that refusing it lets the next stage through.
 */

import { describe, expect, it } from 'vitest';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import {
  createInMemoryPlanningArtefactReader,
  type ApprovedArtefact,
  type PlanningArtefactReader
} from '../artefacts/planning-artefact-reader.js';
import { assembleBrief, classifyRequest, REQUEST_LANES } from '../brief/index.js';
import { PLAN_BLOCKER_REASONS } from '../planning/index.js';
import { SPACE_PROGRAMME_KIND, type SpaceProgramme } from '../programme/index.js';
import { LAYOUT_PLAN_KIND } from '../layout/index.js';
import {
  createCaptureBriefToolDefinition,
  createGeometryToolDefinition,
  createLayoutToolDefinition,
  createProgrammeToolDefinition,
  createSpecificationToolDefinition
} from '../tools/index.js';
import { createHarness } from './harness.js';

const REQUEST = 'Build me a 100m2 apartment with 2 bedrooms, 1 bathroom and a small office';

interface Project {
  readonly service: ArchitecturalIntelligenceService;
  /** Approves whatever the tool proposed, the way the user clicking the card does. */
  approve(artefact: { kind: string; id: string; revision: number; value: unknown }): void;
  revisionsOf(kind: string): readonly number[];
}

function createProject(): Project {
  const artefacts: ApprovedArtefact[] = [];
  const reader: PlanningArtefactReader = {
    current: (kind) => createInMemoryPlanningArtefactReader(artefacts).current(kind),
    all: () => artefacts
  };
  const service = new ArchitecturalIntelligenceService({
    knowledge: createHarness().knowledge,
    artefacts: reader
  });

  const brief = assembleBrief({ utterance: REQUEST, classification: classifyRequest(REQUEST) });
  artefacts.push({ kind: brief.kind, id: brief.id, revision: brief.revision, value: brief });

  return {
    service,
    approve: (artefact) =>
      void artefacts.push({
        kind: artefact.kind,
        id: artefact.id,
        revision: artefact.revision,
        value: artefact.value
      }),
    revisionsOf: (kind) =>
      artefacts.filter((entry) => entry.kind === kind).map((entry) => entry.revision)
  };
}

/** Every tool the model fires on "ok", in the order it fires them. */
function onOk(service: ArchitecturalIntelligenceService): readonly {
  readonly name: string;
  readonly resolved: ReturnType<ReturnType<typeof createProgrammeToolDefinition>['resolve']>;
}[] {
  return [
    { name: 'planning_generateProgramme', factory: createProgrammeToolDefinition },
    { name: 'planning_generateLayout', factory: createLayoutToolDefinition },
    { name: 'planning_generateGeometry', factory: createGeometryToolDefinition },
    { name: 'planning_generateSpecification', factory: createSpecificationToolDefinition }
  ].map((entry) => ({ name: entry.name, resolved: entry.factory(service).resolve({}, {}) }));
}

/**
 * Which call would claim the single artefact-proposal slot.
 *
 * `aiServiceProvider` keeps the first `proposal` and counts the rest as
 * "further actions … left out", so this is the one the user actually sees.
 */
function claimsTheSlot(
  calls: ReturnType<typeof onOk>
): { readonly name: string; readonly artefact: { kind: string; revision: number } } | undefined {
  for (const call of calls) {
    if (call.resolved?.kind === 'proposal' && call.resolved.proposal.subject.kind === 'artefact') {
      return { name: call.name, artefact: call.resolved.proposal.subject.artefact };
    }
  }
  return undefined;
}

// --- The gates were never the problem -------------------------------------------

/**
 * BUG-009 — the reported conversation, from the first word to a buildable design.
 *
 * "Build me a 100 m² apartment", two bedrooms, two bathrooms — and before this
 * fix, `planning_captureBrief` refused every call for want of a storey count
 * nobody says out loud about an apartment. No artefact was produced, no card
 * ever appeared, and the model narrated four stages that did not exist.
 *
 * This walks the whole pipeline the way a model plus a clicking user do: capture,
 * approve, generate, approve, five times. It is the test that would have caught
 * the bug, because it starts where the user started rather than from a Brief
 * somebody built by hand.
 */
/**
 * BUG-010 — the user is not the workflow's orchestrator.
 *
 * Every stage below the Brief is a **derivation**: it needs the artefact above it
 * approved and nothing else. Before this lane, saying so required naming the
 * artefact — "generate the programme" worked and "ok", "next", "continue" and
 * "go ahead" all fell into Direct Execution, so a user who had just pressed
 * Approve had to know what came next and type its name.
 *
 * The lane removes the typing. It does not remove the approving: each artefact
 * still reaches the user as a proposal, which is BUG-010's Shape B decision.
 */
describe('BUG-010 — carrying on without naming the next stage', () => {
  /** A project with an approved Brief and nothing after it. */
  function afterTheBrief() {
    const artefacts: ApprovedArtefact[] = [];
    const reader: PlanningArtefactReader = {
      current: (kind) => createInMemoryPlanningArtefactReader(artefacts).current(kind),
      all: () => artefacts
    };
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge,
      artefacts: reader
    });
    const brief = assembleBrief({ utterance: REQUEST, classification: classifyRequest(REQUEST) });
    artefacts.push({ kind: brief.kind, id: brief.id, revision: brief.revision, value: brief });

    /** One turn, approving whatever it proposed — the user's press. */
    const say = (utterance: string) => {
      const response = service.interpret(utterance);
      const artefact = response.proposal?.subject;
      if (artefact !== undefined && artefact.kind === 'artefact') {
        artefacts.push(artefact.artefact as ApprovedArtefact);
      }
      return response;
    };

    return { service, artefacts, say };
  }

  const CONTINUATIONS = [
    'ok',
    'okay',
    'yes',
    'next',
    'continue',
    'go ahead',
    'carry on',
    'proceed'
  ];

  it.each(CONTINUATIONS)('"%s" generates the stage that was waiting', (utterance) => {
    const response = afterTheBrief().say(utterance);

    expect(response.classification?.lane).toBe(REQUEST_LANES.Continuation);
    expect(response.programme).toBeDefined();
  });

  /**
   * The reason the pattern is anchored: a continuation is the *whole* utterance.
   * "ok, now delete that wall" is a modelling command with a politeness in front
   * of it, and Story 27.8.3 is about not hijacking those.
   */
  it('leaves a command with a polite opener where it belongs', () => {
    const response = afterTheBrief().say('ok, now delete that wall');

    expect(response.classification?.lane).toBe(REQUEST_LANES.DirectExecution);
    expect(response.programme).toBeUndefined();
  });

  it('still lets the user name the stage they want', () => {
    const response = afterTheBrief().say('generate the programme');

    expect(response.classification?.lane).toBe(REQUEST_LANES.ProgrammeGeneration);
    expect(response.programme).toBeDefined();
  });

  /** BUG-010's acceptance scenario, minus the typing. */
  it('walks the remaining four stages on "ok" alone', () => {
    const project = afterTheBrief();

    for (let turn = 0; turn < 4; turn += 1) {
      expect(project.say('ok').classification?.lane).toBe(REQUEST_LANES.Continuation);
    }

    expect(project.artefacts.map((artefact) => artefact.kind)).toEqual([
      'architectural-brief',
      SPACE_PROGRAMME_KIND,
      LAYOUT_PLAN_KIND,
      'geometry-graph',
      'geometry-specification'
    ]);
  });

  /** And then stops: there is nothing left to derive, and building is not "carrying on". */
  it('stops when the pipeline is complete', () => {
    const project = afterTheBrief();
    for (let turn = 0; turn < 4; turn += 1) {
      project.say('ok');
    }

    expect(project.say('ok').classification?.lane).toBe(REQUEST_LANES.DirectExecution);
    expect(project.say('Build it.').classification?.lane).toBe(REQUEST_LANES.Realisation);
  });

  /**
   * The Brief is the one stage a continuation cannot produce: it is written from
   * what the user said, and "ok" says nothing about a building.
   */
  it('does not try to write a brief from "ok"', () => {
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge,
      artefacts: createInMemoryPlanningArtefactReader([])
    });

    const response = service.interpret('ok');

    expect(response.classification?.lane).not.toBe(REQUEST_LANES.Continuation);
    expect(response.brief).toBeUndefined();
  });

  /**
   * An open clarification consumes the turn first, exactly as it did before —
   * "ok" answering "how many storeys?" is an answer, not a continuation.
   */
  it('never takes a turn an open clarification is waiting for', () => {
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge,
      artefacts: createInMemoryPlanningArtefactReader([]),
      briefDrafts: (() => {
        let held: unknown;
        return {
          load: () => held,
          save: (draft: unknown) => {
            held = draft;
          },
          clear: () => {
            held = undefined;
          }
        };
      })() as never
    });
    service.interpret('Design a family home');

    const response = service.interpret('ok');

    expect(response.classification?.lane).not.toBe(REQUEST_LANES.Continuation);
  });
});

describe('BUG-009 — an apartment reaches a buildable design', () => {
  function conversation() {
    const artefacts: ApprovedArtefact[] = [];
    const reader: PlanningArtefactReader = {
      current: (kind) => createInMemoryPlanningArtefactReader(artefacts).current(kind),
      all: () => artefacts
    };
    const service = new ArchitecturalIntelligenceService({
      knowledge: createHarness().knowledge,
      artefacts: reader
    });
    const context = {
      conversation: {
        lastUserMessage: 'Build me a 100m² apartment',
        userMessages: ['2 bedrooms, 2 bathrooms', 'Build me a 100m² apartment']
      }
    };

    /** Resolves a tool and approves whatever it proposed, as the user's click does. */
    const step = (tool: { resolve: (a: never, c: never) => unknown }, args = {}) => {
      const resolved = tool.resolve(args as never, context as never) as
        | { kind: 'proposal'; proposal: { subject: { kind: string; artefact: ApprovedArtefact } } }
        | { kind: 'blocked'; message: string }
        | undefined;
      if (resolved?.kind !== 'proposal') {
        throw new Error(
          `expected a proposal, got ${resolved?.kind ?? 'nothing'}${
            resolved?.kind === 'blocked' ? `: ${resolved.message}` : ''
          }`
        );
      }
      artefacts.push(resolved.proposal.subject.artefact);
      return resolved.proposal.subject.artefact.kind;
    };

    return { service, artefacts, step };
  }

  it('captures a brief without asking how many storeys an apartment has', () => {
    const { step } = conversation();

    expect(
      step(createCaptureBriefToolDefinition(conversation().service) as never, {
        bedrooms: 2,
        bathrooms: 2,
        objectives: ['A 100 m² apartment']
      })
    ).toBe('architectural-brief');
  });

  it('walks all five stages to an approved geometry specification', () => {
    const { service, artefacts, step } = conversation();

    step(createCaptureBriefToolDefinition(service) as never, {
      bedrooms: 2,
      bathrooms: 2,
      objectives: ['A 100 m² apartment']
    });
    step(createProgrammeToolDefinition(service) as never);
    step(createLayoutToolDefinition(service) as never);
    step(createGeometryToolDefinition(service) as never);
    step(createSpecificationToolDefinition(service) as never);

    expect(artefacts.map((artefact) => artefact.kind)).toEqual([
      'architectural-brief',
      SPACE_PROGRAMME_KIND,
      LAYOUT_PLAN_KIND,
      'geometry-graph',
      'geometry-specification'
    ]);
  });

  /** And then the ninth lane can do its job, which is BUG-008's half. */
  it('offers to build the design it just approved', () => {
    const { service, step } = conversation();
    step(createCaptureBriefToolDefinition(service) as never, {
      bedrooms: 2,
      bathrooms: 2,
      objectives: ['A 100 m² apartment']
    });
    step(createProgrammeToolDefinition(service) as never);
    step(createLayoutToolDefinition(service) as never);
    step(createGeometryToolDefinition(service) as never);
    step(createSpecificationToolDefinition(service) as never);

    const response = service.interpret('Build it.');

    expect(response.classification?.lane).toBe('realisation');
    expect(response.proposal).toBeDefined();
  });
});

describe('the approval gates (already correct before Bug 005)', () => {
  it('blocks every downstream stage when only the Brief is approved', () => {
    const calls = onOk(createProject().service);

    expect(calls.map((call) => call.resolved?.kind)).toEqual([
      'proposal',
      'blocked',
      'blocked',
      'blocked'
    ]);
  });

  it('names the missing predecessor rather than failing abstractly', () => {
    const calls = onOk(createProject().service);

    expect(calls[1]?.resolved?.kind === 'blocked' && calls[1].resolved.message).toContain(
      'no approved space programme'
    );
    expect(calls[2]?.resolved?.kind === 'blocked' && calls[2].resolved.message).toContain(
      'no approved layout'
    );
    expect(calls[3]?.resolved?.kind === 'blocked' && calls[3].resolved.message).toContain(
      'no approved geometry'
    );
  });
});

// --- Regeneration of an unchanged stage ------------------------------------------

describe('regenerating a stage that has not changed (Bug 005)', () => {
  it('refuses instead of minting an identical revision', () => {
    const project = createProject();
    const first = claimsTheSlot(onOk(project.service))!;
    project.approve(first.artefact as never);

    const again = onOk(project.service)[0]?.resolved;

    expect(again?.kind).toBe('blocked');
  });

  it('answers with the NothingToDo vocabulary, not a new failure kind', () => {
    const project = createProject();
    project.approve(claimsTheSlot(onOk(project.service))!.artefact as never);

    const response = project.service.generateProgramme(project.service.approvedBrief()!);

    expect(response.proposal).toBeUndefined();
    expect(response.blocker?.reason).toBe(PLAN_BLOCKER_REASONS.NothingToDo);
  });

  it('points the model at the next stage rather than leaving it to guess', () => {
    const project = createProject();
    project.approve(claimsTheSlot(onOk(project.service))!.artefact as never);

    const response = project.service.generateProgramme(project.service.approvedBrief()!);

    expect(response.blocker?.suggestions.join(' ')).toContain('layout');
  });

  it('still revises when the brief underneath it actually changed', () => {
    const project = createProject();
    project.approve(claimsTheSlot(onOk(project.service))!.artefact as never);

    const revisedBrief = project.service.interpret('actually make it 4 bedrooms');
    const briefArtefact = revisedBrief.proposal?.subject;
    expect(briefArtefact?.kind).toBe('artefact');
    if (briefArtefact?.kind !== 'artefact') {
      return;
    }
    project.approve(briefArtefact.artefact as never);

    const response = project.service.generateProgramme(project.service.approvedBrief()!);

    expect(response.proposal).toBeDefined();
    expect(response.programme?.revision).toBe(2);
  });
});

// --- Space identity ---------------------------------------------------------------

describe('space ids across a programme revision (Bug 005)', () => {
  it('keeps the id of a space that survived the revision', () => {
    const project = createProject();
    const first = claimsTheSlot(onOk(project.service))!.artefact as unknown as {
      value: SpaceProgramme;
    };
    project.approve(first as never);
    const before = first.value.spaces.find((space) => space.name === 'bedroom')!;

    const briefArtefact = project.service.interpret('actually make it 4 bedrooms').proposal
      ?.subject;
    if (briefArtefact?.kind !== 'artefact') {
      throw new Error('Expected a brief revision.');
    }
    project.approve(briefArtefact.artefact as never);

    const after = project.service
      .generateProgramme(project.service.approvedBrief()!)
      .programme!.spaces.find((space) => space.name === 'bedroom')!;

    // A Layout Plan's nodes *are* these ids. Regenerating them left every
    // downstream artefact pointing at spaces that no longer existed.
    expect(after.id).toBe(before.id);
    expect(after.count).toBe(4);
  });

  it('keeps adjacency pointing at the spaces it named', () => {
    const project = createProject();
    const first = claimsTheSlot(onOk(project.service))!.artefact as unknown as {
      value: SpaceProgramme;
    };
    project.approve(first as never);

    const briefArtefact = project.service.interpret('actually make it 4 bedrooms').proposal
      ?.subject;
    if (briefArtefact?.kind !== 'artefact') {
      throw new Error('Expected a brief revision.');
    }
    project.approve(briefArtefact.artefact as never);

    const revised = project.service.generateProgramme(project.service.approvedBrief()!).programme!;
    const ids = new Set(revised.spaces.map((space) => space.id));

    expect(
      revised.adjacencies.every(
        (adjacency) => ids.has(adjacency.fromSpaceId) && ids.has(adjacency.toSpaceId)
      )
    ).toBe(true);
  });
});

// --- The observed conversation ----------------------------------------------------

describe('the observed conversation, turn by turn (Bug 005)', () => {
  it('advances one stage per "ok" instead of churning the programme', () => {
    const project = createProject();
    const claimed: string[] = [];

    // Four acknowledgements, exactly as in the transcript.
    for (let turn = 0; turn < 4; turn += 1) {
      const winner = claimsTheSlot(onOk(project.service));
      if (winner === undefined) {
        claimed.push('nothing');
        continue;
      }
      claimed.push(winner.artefact.kind);
      project.approve(winner.artefact as never);
    }

    // Before the fix this was four space-programmes and no layout.
    expect(claimed[0]).toBe(SPACE_PROGRAMME_KIND);
    expect(claimed[1]).toBe(LAYOUT_PLAN_KIND);
    expect(new Set(claimed).size).toBeGreaterThan(1);
  });

  it('never approves a second identical programme revision', () => {
    const project = createProject();

    for (let turn = 0; turn < 4; turn += 1) {
      const winner = claimsTheSlot(onOk(project.service));
      if (winner !== undefined) {
        project.approve(winner.artefact as never);
      }
    }

    // The transcript reached revision 4 with identical content every time.
    expect(project.revisionsOf(SPACE_PROGRAMME_KIND)).toEqual([1]);
  });

  it('reaches the geometry stage, which the transcript never did', () => {
    const project = createProject();
    const reached = new Set<string>();

    for (let turn = 0; turn < 5; turn += 1) {
      const winner = claimsTheSlot(onOk(project.service));
      if (winner === undefined) {
        break;
      }
      reached.add(winner.artefact.kind);
      project.approve(winner.artefact as never);
    }

    expect(reached.has(SPACE_PROGRAMME_KIND)).toBe(true);
    expect(reached.has(LAYOUT_PLAN_KIND)).toBe(true);
    expect(reached.size).toBeGreaterThanOrEqual(3);
  });
});
