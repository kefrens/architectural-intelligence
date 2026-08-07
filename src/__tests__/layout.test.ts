/**
 * Sprint 28.0 — the Layout Plan, its graph, its quality and its lane.
 *
 * Structured as the sprint's epics, like `brief.test.ts` and `programme.test.ts`
 * before it. Epic 1 the artefact and the graph, Epic 2 storeys, Epic 3
 * functional resolution, Epic 4 quality, Epic 6 the trigger and review.
 *
 * The 27.9 amendment this sprint carries (`SpaceProgramme.storeys` and implied
 * vertical circulation) is asserted first, because everything else rests on it.
 */

import { describe, expect, it } from 'vitest';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service';
import { createInMemoryPlanningArtefactReader } from '../artefacts/planning-artefact-reader';
import {
  ARCHITECTURAL_BRIEF_KIND,
  assembleBrief,
  classifyRequest,
  REQUEST_LANES,
  type ArchitecturalBrief
} from '../brief';
import {
  computeLayoutQuality,
  LAYOUT_EDGE_KINDS,
  LAYOUT_NODE_KINDS,
  LAYOUT_PLAN_KIND,
  matchesProgramme,
  synthesizeLayout,
  toLayoutProposal,
  type LayoutPlan
} from '../layout';
import { ArchitecturalPlanner, PLANNING_STAGES, type PlanningStageProvider } from '../planning';
import {
  FUNCTIONAL_ZONES,
  SPACE_PROGRAMME_KIND,
  synthesizeProgramme,
  type SpaceProgramme
} from '../programme';
import { createHarness } from './harness';

const ONE_STOREY = 'Design a single storey family home with 3 bedrooms and 2 bathrooms';
const TWO_STOREY = 'Design a two-storey family home with 3 bedrooms and 2 bathrooms';

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

function layoutFor(utterance: string): LayoutPlan {
  const result = synthesizeLayout({ programme: programmeFor(utterance) });
  if (!result.ok) {
    throw new Error(`Expected a layout: ${result.message}`);
  }
  return result.plan;
}

/**
 * A two-storey programme with a `required` adjacency between a day space and a
 * night space — which the storey rule cannot honour, because the two zones live
 * on different floors. The one case that exercises "unsatisfied, not dropped".
 */
function crossStoreyLayout(): LayoutPlan {
  const base = programmeFor(TWO_STOREY);
  const kitchen = base.spaces.find((space) => space.zone === FUNCTIONAL_ZONES.Day)!;
  const bedroom = base.spaces.find((space) => space.zone === FUNCTIONAL_ZONES.Night)!;

  const result = synthesizeLayout({
    programme: {
      ...base,
      adjacencies: [
        {
          fromSpaceId: kitchen.id,
          toSpaceId: bedroom.id,
          strength: 'required',
          reason: 'so deliveries reach the bedroom without stairs'
        }
      ]
    }
  });
  if (!result.ok) {
    throw new Error(`Expected a layout: ${result.message}`);
  }
  return result.plan;
}

function serviceWith(
  programme: SpaceProgramme | undefined,
  planner?: ArchitecturalPlanner
): ArchitecturalIntelligenceService {
  const brief = briefFor(TWO_STOREY);
  return new ArchitecturalIntelligenceService({
    knowledge: createHarness().knowledge,
    ...(planner === undefined ? {} : { planner }),
    artefacts: createInMemoryPlanningArtefactReader([
      { kind: ARCHITECTURAL_BRIEF_KIND, id: brief.id, revision: brief.revision, value: brief },
      ...(programme === undefined
        ? []
        : [
            {
              kind: SPACE_PROGRAMME_KIND,
              id: programme.id,
              revision: programme.revision,
              value: programme
            }
          ])
    ])
  });
}

// --- The 27.9 amendment (Sprint 28.0's first task) ---------------------------

describe('the space programme carries storeys', () => {
  it('reads the count from the brief', () => {
    expect(programmeFor(ONE_STOREY).storeys).toBe(1);
    expect(programmeFor(TWO_STOREY).storeys).toBe(2);
  });

  it('implies vertical circulation only when there is more than one storey', () => {
    const single = programmeFor(ONE_STOREY).spaces.map((space) => space.name);
    const double = programmeFor(TWO_STOREY).spaces.map((space) => space.name);

    expect(single).not.toContain('staircase');
    expect(double).toContain('staircase');
    expect(double).toContain('landing');
  });

  it('adds one landing per floor above the ground', () => {
    const utterance = 'Design a three-storey family home with 4 bedrooms and 2 bathrooms';
    const programme = synthesizeProgramme({ brief: briefFor(utterance) });

    expect(programme.ok).toBe(true);
    if (!programme.ok) return;
    expect(programme.programme.storeys).toBe(3);
    expect(programme.programme.spaces.find((space) => space.name === 'landing')?.count).toBe(2);
  });

  it('says it added vertical circulation rather than doing it silently', () => {
    expect(programmeFor(TWO_STOREY).assumptions.join(' ')).toMatch(/vertical circulation/i);
  });
});

// --- Epic 1 — layout representation (Story 28.0.1) ---------------------------

describe('the layout plan', () => {
  it('records provenance so a revised programme leaves it detectably stale', () => {
    const programme = programmeFor(TWO_STOREY);
    const plan = synthesizeLayout({ programme });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(matchesProgramme(plan.plan, { id: programme.id, revision: 1 })).toBe(true);
    expect(matchesProgramme(plan.plan, { id: programme.id, revision: 2 })).toBe(false);
  });

  it('carries the space list forward with target areas, keyed on programme ids', () => {
    const programme = programmeFor(TWO_STOREY);
    const result = synthesizeLayout({ programme });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const plan = result.plan;

    // Same ids, same areas — 28.1 needs both and reads only this artefact.
    expect(new Set(plan.spaces.map((space) => space.id))).toEqual(
      new Set(programme.spaces.map((space) => space.id))
    );
    for (const space of plan.spaces) {
      const source = programme.spaces.find((candidate) => candidate.id === space.id)!;
      expect(space.areaEach).toBe(source.areaEach);
      expect(space.zone).toBe(source.zone);
      expect(space.priority).toBe(source.priority);
    }
  });

  it('contains no geometry of any kind (Rule 3)', () => {
    const serialized = JSON.stringify(layoutFor(TWO_STOREY));

    for (const forbidden of ['"x"', '"y"', 'coordinate', 'thickness', 'centerline', 'wallType']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('exposes no solver representation', () => {
    const plan = layoutFor(TWO_STOREY);

    for (const forbidden of ['grid', 'cell', 'row', 'column']) {
      expect(Object.keys(plan)).not.toContain(forbidden);
    }
  });

  it('is deterministic — the same programme always yields the same plan', () => {
    const programme = programmeFor(TWO_STOREY);
    const shapes = new Set(
      Array.from({ length: 8 }, () => {
        const result = synthesizeLayout({ programme, now: 0 });
        if (!result.ok) return 'failed';
        // Everything except the generated id, which is identity, not arrangement.
        const rest: Record<string, unknown> = { ...result.plan };
        delete rest['id'];
        return JSON.stringify(rest);
      })
    );

    expect(shapes.size).toBe(1);
  });

  it('never mutates the programme it read (Rule 2)', () => {
    const programme = programmeFor(TWO_STOREY);
    const before = JSON.stringify(programme);

    synthesizeLayout({ programme });

    expect(JSON.stringify(programme)).toBe(before);
  });
});

describe('the planning graph', () => {
  it('has a node per space and a circulation node per storey', () => {
    const plan = layoutFor(TWO_STOREY);

    const spaceNodes = plan.graph.nodes.filter((node) => node.kind === LAYOUT_NODE_KINDS.Space);
    const circulationNodes = plan.graph.nodes.filter(
      (node) => node.kind === LAYOUT_NODE_KINDS.Circulation
    );

    expect(spaceNodes).toHaveLength(plan.spaces.length);
    expect(circulationNodes).toHaveLength(plan.storeys);
  });

  it('connects every space to the circulation of each storey it occupies', () => {
    const plan = layoutFor(TWO_STOREY);

    for (const space of plan.spaces) {
      for (const storey of space.storeys) {
        expect(
          plan.graph.edges.some(
            (edge) =>
              edge.fromNodeId === space.id &&
              edge.toNodeId === `circulation:${storey}` &&
              edge.kind === LAYOUT_EDGE_KINDS.Connected
          )
        ).toBe(true);
      }
    }
  });

  it('joins consecutive storeys only when a space actually occupies both', () => {
    const twoStorey = layoutFor(TWO_STOREY);
    const oneStorey = layoutFor(ONE_STOREY);

    expect(
      twoStorey.graph.edges.some((edge) => edge.kind === LAYOUT_EDGE_KINDS.VerticalConnection)
    ).toBe(true);
    expect(
      oneStorey.graph.edges.some((edge) => edge.kind === LAYOUT_EDGE_KINDS.VerticalConnection)
    ).toBe(false);
  });

  it('carries an avoid intent as a separated edge, not as a missing one', () => {
    const plan = layoutFor(TWO_STOREY);

    expect(plan.graph.edges.some((edge) => edge.kind === LAYOUT_EDGE_KINDS.Separated)).toBe(true);
  });
});

// --- Epic 2 — storey resolution (Story 28.0.2) -------------------------------

describe('storey resolution', () => {
  it('takes the count exclusively from the programme', () => {
    const programme = { ...programmeFor(TWO_STOREY), storeys: 3 };
    const plan = synthesizeLayout({ programme });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.storeys).toBe(3);
  });

  it('gives every space at least one storey', () => {
    const plan = layoutFor(TWO_STOREY);

    for (const space of plan.spaces) {
      expect(space.storeys.length).toBeGreaterThan(0);
      for (const storey of space.storeys) {
        expect(storey).toBeGreaterThanOrEqual(0);
        expect(storey).toBeLessThan(plan.storeys);
      }
    }
  });

  it('puts the night zone upstairs and the day zone on the ground', () => {
    const plan = layoutFor(TWO_STOREY);
    const zoneOf = (zone: string) => plan.spaces.filter((space) => space.zone === zone);

    for (const space of zoneOf(FUNCTIONAL_ZONES.Night)) {
      expect(space.storeys).toEqual([1]);
    }
    for (const space of zoneOf(FUNCTIONAL_ZONES.Day)) {
      expect(space.storeys).toEqual([0]);
    }
  });

  it('places vertical circulation on every storey it connects', () => {
    const plan = layoutFor(TWO_STOREY);
    const stair = plan.spaces.find((space) => space.name === 'staircase');

    expect(stair?.storeys).toEqual([0, 1]);
    expect(plan.circulation.verticalSpaceIds).toEqual([stair!.id]);
  });

  it('puts everything on the ground floor in a single-storey home', () => {
    const plan = layoutFor(ONE_STOREY);

    for (const space of plan.spaces) {
      expect(space.storeys).toEqual([0]);
    }
    expect(plan.assumptions.join(' ')).toMatch(/one storey/i);
  });
});

// --- Epic 3 — functional resolution (Story 28.0.3) ---------------------------

describe('functional resolution', () => {
  it('resolves every intended adjacency, dropping none', () => {
    const programme = programmeFor(TWO_STOREY);
    const result = synthesizeLayout({ programme });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.adjacencies).toHaveLength(programme.adjacencies.length);
  });

  it('satisfies every intent in an ordinary two-storey home', () => {
    // Not a lucky accident: the programme zones spaces the same way the layout
    // assigns storeys, so day-with-day and night-with-night intents land on a
    // common floor by construction. A regression here means the two rules have
    // drifted apart.
    const plan = layoutFor(TWO_STOREY);

    expect(plan.adjacencies.every((adjacency) => adjacency.satisfied)).toBe(true);
    expect(plan.warnings).toEqual([]);
  });

  it('records a cross-zone intent as unsatisfied rather than dropping it', () => {
    const plan = crossStoreyLayout();
    const unsatisfied = plan.adjacencies.filter((adjacency) => !adjacency.satisfied);

    expect(unsatisfied).toHaveLength(1);
    expect(unsatisfied[0]).toMatchObject({ strength: 'required', relation: 'connected' });
    // The reason survives from the programme, so the card explains what was lost.
    expect(unsatisfied[0]!.reason).toMatch(/deliveries/i);
  });

  it('warns about an unsatisfiable required adjacency', () => {
    expect(crossStoreyLayout().warnings.join(' ')).toMatch(/different storeys/i);
  });

  it('preserves the programme zones rather than recomputing them', () => {
    const programme = programmeFor(TWO_STOREY);
    const result = synthesizeLayout({ programme });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const space of result.plan.spaces) {
      expect(space.zone).toBe(programme.spaces.find((s) => s.id === space.id)!.zone);
    }
  });

  it('produces a circulation strategy naming each storey', () => {
    const plan = layoutFor(TWO_STOREY);

    expect(plan.circulation.perStorey).toHaveLength(plan.storeys);
    expect(plan.circulation.unservedStoreys).toEqual([]);
    expect(plan.circulation.description.length).toBeGreaterThan(0);
  });
});

// --- Epic 4 — layout quality (Story 28.0.4) ---------------------------------

describe('layout quality', () => {
  it('is not stored in the artefact', () => {
    expect(Object.keys(layoutFor(TWO_STOREY))).not.toContain('quality');
  });

  it('is recomputed from the plan, and every metric is a share', () => {
    const quality = computeLayoutQuality(layoutFor(TWO_STOREY));

    for (const value of Object.values(quality)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(quality.programmeSatisfaction).toBe(1);
    expect(quality.circulationQuality).toBe(1);
  });

  it('reflects a change to the plan, which a stored score could not', () => {
    const plan = layoutFor(TWO_STOREY);
    const enriched: LayoutPlan = {
      ...plan,
      adjacencies: plan.adjacencies.map((adjacency) => ({ ...adjacency, satisfied: false }))
    };

    expect(computeLayoutQuality(enriched).requiredAdjacencySatisfaction).toBeLessThan(
      computeLayoutQuality(plan).requiredAdjacencySatisfaction + 0.0001
    );
    expect(computeLayoutQuality(enriched).requiredAdjacencySatisfaction).toBe(0);
  });

  it('never blocks approval', () => {
    const plan = layoutFor(TWO_STOREY);
    const poor: LayoutPlan = {
      ...plan,
      adjacencies: plan.adjacencies.map((adjacency) => ({ ...adjacency, satisfied: false }))
    };

    expect(() => toLayoutProposal(poor)).not.toThrow();
    expect(toLayoutProposal(poor).approvalState).toBe('pending');
  });
});

// --- Epic 6 — trigger and review (Story 28.0.6) -----------------------------

describe('the layout lane', () => {
  it('is unreachable without an approved programme', () => {
    expect(classifyRequest('now generate the layout').lane).toBe(REQUEST_LANES.DirectExecution);
  });

  it('is reached when a programme is approved and the user asks for the layout', () => {
    expect(classifyRequest('now generate the layout', { hasApprovedProgramme: true }).lane).toBe(
      REQUEST_LANES.LayoutGeneration
    );
    expect(classifyRequest('arrange the spaces', { hasApprovedProgramme: true }).lane).toBe(
      REQUEST_LANES.LayoutGeneration
    );
  });

  it('leaves the four earlier lanes exactly as they were', () => {
    expect(classifyRequest('create a wall from 0,0 to 4,0').lane).toBe(
      REQUEST_LANES.DirectExecution
    );
    expect(classifyRequest(TWO_STOREY).lane).toBe(REQUEST_LANES.BriefGeneration);
    expect(classifyRequest('Design a family home').lane).toBe(REQUEST_LANES.ClarificationRequired);
    expect(
      classifyRequest('now generate the space programme', { hasApprovedBrief: true }).lane
    ).toBe(REQUEST_LANES.ProgrammeGeneration);
  });

  it('produces a layout through interpret when a programme is approved', () => {
    const response = serviceWith(programmeFor(TWO_STOREY)).interpret('now generate the layout');

    expect(response.classification?.lane).toBe(REQUEST_LANES.LayoutGeneration);
    expect(response.layout).toBeDefined();
    expect(response.proposal).toBeDefined();
  });

  it('does not offer a layout when only a brief is approved', () => {
    const response = serviceWith(undefined).interpret('now generate the layout');

    expect(response.layout).toBeUndefined();
  });
});

describe('layout review', () => {
  it('is an artefact proposal that executes nothing (Rule 7)', () => {
    const plan = layoutFor(TWO_STOREY);
    const proposal = toLayoutProposal(plan);

    expect(proposal.subject).toEqual({
      kind: 'artefact',
      artefact: { kind: LAYOUT_PLAN_KIND, id: plan.id, revision: plan.revision, value: plan }
    });
    expect(proposal.operations).toEqual([]);
    expect(proposal.approvalState).toBe('pending');
  });

  it('shows the quality it computed', () => {
    expect(toLayoutProposal(layoutFor(TWO_STOREY)).explanation).toMatch(/Programme satisfied/i);
  });

  it('refuses to propose an empty layout', () => {
    const plan = layoutFor(TWO_STOREY);

    expect(() => toLayoutProposal({ ...plan, spaces: [] })).toThrow(/empty/i);
  });
});

// --- Rule 10 — stage providers -----------------------------------------------

describe('layout stage providers', () => {
  it('enrich the plan before it is offered', () => {
    const planner = new ArchitecturalPlanner();
    const provider: PlanningStageProvider<LayoutPlan> = {
      id: 'energy',
      stage: PLANNING_STAGES.Layout,
      enrich: (plan) => ({ ...plan, warnings: [...plan.warnings, 'energy checked'] })
    };
    planner.registerStageProvider(provider);

    const response = serviceWith(programmeFor(TWO_STOREY), planner).interpret(
      'now generate the layout'
    );

    expect(response.layout?.warnings).toContain('energy checked');
  });
});
