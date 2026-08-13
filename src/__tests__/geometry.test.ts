/**
 * Sprint 28.1a — the Geometry Graph, its gate, its transparency and its lane.
 *
 * Structured as the sprint's epics. The clause-level work is tested in
 * `@archisimple/skills`; what is asserted here is the artefact, the boundary it
 * keeps, and the behaviour a user actually meets.
 */

import { describe, expect, it } from 'vitest';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import { createInMemoryPlanningArtefactReader } from '../artefacts/planning-artefact-reader.js';
import {
  ARCHITECTURAL_BRIEF_KIND,
  assembleBrief,
  classifyRequest,
  REQUEST_LANES,
  type ArchitecturalBrief
} from '../brief/index.js';
import {
  describeEvaluation,
  evaluateGeometryGraph,
  expectedInstances,
  gateGeometryGraph,
  GEOMETRY_GRAPH_KIND,
  matchesLayout,
  reviseGeometryGraph,
  storeyArea,
  synthesizeGeometry,
  toGeometryGraphProposal,
  type GeometryGraph
} from '../geometry/index.js';
import { LAYOUT_PLAN_KIND, synthesizeLayout, type LayoutPlan } from '../layout/index.js';
import {
  ArchitecturalPlanner,
  PLANNING_STAGES,
  type PlanningStageProvider
} from '../planning/index.js';
import {
  SPACE_PROGRAMME_KIND,
  synthesizeProgramme,
  type SpaceProgramme
} from '../programme/index.js';
import {
  defineSkill,
  packLayout,
  runPackingConformance,
  type PackLayoutInput,
  type PackLayoutOutput
} from '@archisimple/skills';
import { createHarness } from './harness.js';

const ONE_STOREY = 'Design a single storey family home with 3 bedrooms and 2 bathrooms';
const TWO_STOREY = 'Design a two-storey family home with 3 bedrooms and 2 bathrooms';

function briefFor(utterance: string): ArchitecturalBrief {
  return assembleBrief({ utterance, classification: classifyRequest(utterance) });
}

function programmeFor(utterance: string): SpaceProgramme {
  const result = synthesizeProgramme({ brief: briefFor(utterance) });
  if (!result.ok) throw new Error(result.message);
  return result.programme;
}

function layoutFor(utterance: string): LayoutPlan {
  const result = synthesizeLayout({ programme: programmeFor(utterance) });
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

function geometryFrom(layout: LayoutPlan): GeometryGraph {
  const result = synthesizeGeometry({ layout });
  if (!result.ok) throw new Error(result.message);
  return result.graph;
}

/**
 * A project holding a coherent chain.
 *
 * Each upstream artefact is stored under the identity the artefact below it
 * records having been derived from. Since Sprint 1.2 that matters: a project
 * whose Programme names a Brief the project does not hold has a **stale**
 * Programme, the geometry lane closes, and the classifier is right to close it
 * (ADR-AI-0002 Rule 7). Before the workflow state existed nothing looked, so
 * these fixtures could store three unrelated artefacts and still reach the lane.
 */
function serviceWith(
  layout: LayoutPlan | undefined,
  planner?: ArchitecturalPlanner
): ArchitecturalIntelligenceService {
  const programme = programmeFor(TWO_STOREY);
  const brief = briefFor(TWO_STOREY);
  return new ArchitecturalIntelligenceService({
    knowledge: createHarness().knowledge,
    ...(planner === undefined ? {} : { planner }),
    artefacts: createInMemoryPlanningArtefactReader([
      {
        kind: ARCHITECTURAL_BRIEF_KIND,
        id: programme.sourceBrief.briefId,
        revision: programme.sourceBrief.briefRevision,
        value: brief
      },
      ...(layout === undefined
        ? [{ kind: SPACE_PROGRAMME_KIND, id: programme.id, revision: 1, value: programme }]
        : [
            {
              kind: SPACE_PROGRAMME_KIND,
              id: layout.sourceProgramme.programmeId,
              revision: layout.sourceProgramme.programmeRevision,
              value: programme
            },
            { kind: LAYOUT_PLAN_KIND, id: layout.id, revision: layout.revision, value: layout }
          ])
    ])
  });
}

// --- Epic 2 — the artefact -----------------------------------------------------

describe('the geometry graph', () => {
  it('records provenance so a revised layout leaves it detectably stale', () => {
    const layout = layoutFor(TWO_STOREY);
    const graph = geometryFrom(layout);

    expect(matchesLayout(graph, { id: layout.id, revision: 1 })).toBe(true);
    expect(matchesLayout(graph, { id: layout.id, revision: 2 })).toBe(false);
  });

  it('places one polygon per instance, on the storey the layout assigned', () => {
    const layout = layoutFor(TWO_STOREY);
    const graph = geometryFrom(layout);

    for (const polygon of graph.polygons) {
      const space = layout.spaces.find((entry) => entry.id === polygon.spaceId)!;
      expect(space.storeys).toContain(polygon.storey);
    }
    const bedrooms = graph.polygons.filter(
      (polygon) => polygon.spaceId === layout.spaces.find((s) => s.name === 'bedroom')!.id
    );
    expect(bedrooms).toHaveLength(3);
  });

  it('carries both areas on every polygon', () => {
    for (const polygon of geometryFrom(layoutFor(TWO_STOREY)).polygons) {
      expect(polygon.requestedArea).toBeGreaterThan(0);
      expect(polygon.achievedArea).toBeGreaterThan(0);
    }
  });

  it('honours target areas closely — polygons are finished faces, not centrelines', () => {
    const graph = geometryFrom(layoutFor(TWO_STOREY));

    for (const polygon of graph.polygons) {
      const drift = Math.abs(polygon.achievedArea - polygon.requestedArea) / polygon.requestedArea;
      expect(drift).toBeLessThan(0.02);
    }
  });

  it('carries no wall thickness, no runtime entity and no request', () => {
    const serialized = JSON.stringify(geometryFrom(layoutFor(TWO_STOREY)));

    for (const forbidden of ['thickness', 'wallType', 'entityId', 'commandRequest', 'levelId']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('revises rather than edits — the entry point optimisation will call', () => {
    const graph = geometryFrom(layoutFor(TWO_STOREY));
    const revised = reviseGeometryGraph(graph, { warnings: ['squared off'] });

    expect(revised.id).toBe(graph.id);
    expect(revised.revision).toBe(2);
    expect(graph.warnings).not.toContain('squared off');
  });

  it('is deterministic — the same layout always yields the same geometry', () => {
    const layout = layoutFor(TWO_STOREY);
    const shapes = new Set(
      Array.from({ length: 6 }, () => {
        const result = synthesizeGeometry({ layout, now: 0 });
        if (!result.ok) return 'failed';
        const rest: Record<string, unknown> = { ...result.graph };
        delete rest['id'];
        // Wall and opening candidates carry generated ids; the shapes are what
        // determinism is about.
        delete rest['wallCandidates'];
        delete rest['openingCandidates'];
        return JSON.stringify(rest);
      })
    );

    expect(shapes.size).toBe(1);
  });

  it('never mutates the layout it read (Rule 2)', () => {
    const layout = layoutFor(TWO_STOREY);
    const before = JSON.stringify(layout);

    synthesizeGeometry({ layout });

    expect(JSON.stringify(layout)).toBe(before);
  });
});

// --- Epic 5 — walls, openings and storeys --------------------------------------

describe('wall and opening candidates', () => {
  it('emits an internal candidate for every pair of rooms that share an edge', () => {
    const graph = geometryFrom(layoutFor(ONE_STOREY));
    const internal = graph.wallCandidates.filter((candidate) => !candidate.external);

    expect(internal.length).toBeGreaterThan(0);
    for (const candidate of internal) {
      expect(candidate.between).toHaveLength(2);
    }
  });

  it('emits four external candidates per storey — the envelope', () => {
    const graph = geometryFrom(layoutFor(TWO_STOREY));
    const external = graph.wallCandidates.filter((candidate) => candidate.external);

    expect(external).toHaveLength(4 * graph.storeys);
  });

  it('emits an opening only where a satisfied adjacency needs passage', () => {
    const graph = geometryFrom(layoutFor(TWO_STOREY));
    const satisfied = graph.adjacencies.filter(
      (adjacency) => adjacency.strength !== 'avoid' && adjacency.satisfied
    );

    expect(graph.openingCandidates).toHaveLength(satisfied.length);
    for (const opening of graph.openingCandidates) {
      expect(
        graph.wallCandidates.some((candidate) => candidate.id === opening.wallCandidateId)
      ).toBe(true);
      expect(opening.reason.length).toBeGreaterThan(0);
    }
  });

  it('derives storey elevations and says it assumed them', () => {
    const graph = geometryFrom(layoutFor(TWO_STOREY));

    expect(graph.storeyElevations).toEqual([0, 3]);
    expect(graph.assumptions.join(' ')).toMatch(/storey height/i);
  });

  it('reports each storey area from what was actually enclosed', () => {
    const graph = geometryFrom(layoutFor(TWO_STOREY));

    expect(storeyArea(graph, 0)).toBeGreaterThan(0);
    expect(storeyArea(graph, 1)).toBeGreaterThan(0);
  });

  it('records an unrealised adjacency rather than dropping it', () => {
    const graph = geometryFrom(layoutFor(TWO_STOREY));
    const layout = layoutFor(TWO_STOREY);

    expect(graph.adjacencies).toHaveLength(layout.adjacencies.length);
    for (const adjacency of graph.adjacencies) {
      expect(adjacency.reason.length).toBeGreaterThan(0);
    }
  });
});

// --- Epic 4 — evaluation and the gate ------------------------------------------

describe('evaluation', () => {
  it('finds the built-in packer valid on every invariant', () => {
    const layout = layoutFor(TWO_STOREY);
    const evaluation = evaluateGeometryGraph(geometryFrom(layout), {
      expected: expectedInstances(layout)
    });

    for (const invariant of evaluation.invariants) {
      expect(`${invariant.id}: ${invariant.offending.join('; ')}`).toBe(`${invariant.id}: `);
    }
    expect(evaluation.valid).toBe(true);
  });

  it('is not stored on the artefact', () => {
    expect(Object.keys(geometryFrom(layoutFor(TWO_STOREY)))).not.toContain('evaluation');
    expect(Object.keys(geometryFrom(layoutFor(TWO_STOREY)))).not.toContain('quality');
  });

  it('is recomputed — a changed graph evaluates differently through the same function', () => {
    const layout = layoutFor(TWO_STOREY);
    const graph = geometryFrom(layout);
    const broken = reviseGeometryGraph(graph, { polygons: [] });

    expect(evaluateGeometryGraph(graph, { expected: expectedInstances(layout) }).valid).toBe(true);
    expect(evaluateGeometryGraph(broken, { expected: expectedInstances(layout) }).valid).toBe(
      false
    );
  });

  it('describes invariants and objectives separately, without naming a sprint', () => {
    const layout = layoutFor(TWO_STOREY);
    const text = describeEvaluation(
      evaluateGeometryGraph(geometryFrom(layout), { expected: expectedInstances(layout) })
    );

    expect(text).toMatch(/Guaranteed/i);
    expect(text).toMatch(/Can be improved/i);
    // A card that advertises unbuilt work stops being true when that work moves.
    expect(text).not.toMatch(/sprint|28\.2/i);
  });

  it('describeEvaluation computes nothing — same evaluation, same text', () => {
    const layout = layoutFor(TWO_STOREY);
    const evaluation = evaluateGeometryGraph(geometryFrom(layout), {
      expected: expectedInstances(layout)
    });

    expect(describeEvaluation(evaluation)).toBe(describeEvaluation(evaluation));
  });
});

describe('the invariant gate', () => {
  it('passes a graph the built-in packer produced', () => {
    const layout = layoutFor(TWO_STOREY);

    expect(gateGeometryGraph(geometryFrom(layout), layout).ok).toBe(true);
  });

  it('refuses a graph that lost a room, naming the clause', () => {
    const layout = layoutFor(TWO_STOREY);
    const graph = geometryFrom(layout);
    const damaged = reviseGeometryGraph(graph, { polygons: graph.polygons.slice(1) });

    const gate = gateGeometryGraph(damaged, layout);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.message).toMatch(/I1/);
  });

  it('refuses a graph with overlapping rooms', () => {
    const layout = layoutFor(ONE_STOREY);
    const graph = geometryFrom(layout);
    const first = graph.polygons[0]!;
    const overlapping = reviseGeometryGraph(graph, {
      polygons: graph.polygons.map((polygon, index) =>
        index === 1 ? { ...polygon, corners: first.corners } : polygon
      )
    });

    const gate = gateGeometryGraph(overlapping, layout);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.message).toMatch(/I2/);
  });

  it('runs after enrichment, so a stage provider that breaks an invariant is caught', () => {
    const planner = new ArchitecturalPlanner();
    const vandal: PlanningStageProvider<GeometryGraph> = {
      id: 'vandal',
      stage: PLANNING_STAGES.Geometry,
      enrich: (graph) => ({ ...graph, polygons: [] })
    };
    planner.registerStageProvider(vandal);

    const response = serviceWith(layoutFor(TWO_STOREY), planner).interpret('now draw the rooms');

    expect(response.geometry).toBeUndefined();
    expect(response.proposal).toBeUndefined();
    expect(response.message).toMatch(/structural requirement/i);
  });
});

// --- Epic 7 — the lane and review ----------------------------------------------

describe('the geometry lane', () => {
  it('is unreachable without an approved layout', () => {
    expect(classifyRequest('now draw the rooms').lane).toBe(REQUEST_LANES.DirectExecution);
  });

  it('is reached when a layout is approved and geometry is asked for', () => {
    expect(classifyRequest('now draw the rooms', { hasApprovedLayout: true }).lane).toBe(
      REQUEST_LANES.GeometryGeneration
    );
    expect(classifyRequest('generate the geometry', { hasApprovedLayout: true }).lane).toBe(
      REQUEST_LANES.GeometryGeneration
    );
  });

  it('leaves the five earlier lanes exactly as they were', () => {
    expect(classifyRequest('create a wall from 0,0 to 4,0').lane).toBe(
      REQUEST_LANES.DirectExecution
    );
    expect(classifyRequest(TWO_STOREY).lane).toBe(REQUEST_LANES.BriefGeneration);
    expect(classifyRequest('Design a family home').lane).toBe(REQUEST_LANES.ClarificationRequired);
    expect(
      classifyRequest('now generate the space programme', { hasApprovedBrief: true }).lane
    ).toBe(REQUEST_LANES.ProgrammeGeneration);
    expect(classifyRequest('arrange the spaces', { hasApprovedProgramme: true }).lane).toBe(
      REQUEST_LANES.LayoutGeneration
    );
  });

  it('produces geometry through interpret when a layout is approved', () => {
    const response = serviceWith(layoutFor(TWO_STOREY)).interpret('now draw the rooms');

    expect(response.classification?.lane).toBe(REQUEST_LANES.GeometryGeneration);
    expect(response.geometry).toBeDefined();
    expect(response.proposal).toBeDefined();
  });

  it('does not offer geometry when only a programme is approved', () => {
    expect(serviceWith(undefined).interpret('now draw the rooms').geometry).toBeUndefined();
  });
});

describe('geometry review', () => {
  it('is an artefact proposal that executes nothing (Rule 7)', () => {
    const layout = layoutFor(TWO_STOREY);
    const graph = geometryFrom(layout);
    const proposal = toGeometryGraphProposal(graph, { expected: expectedInstances(layout) });

    expect(proposal.subject).toEqual({
      kind: 'artefact',
      artefact: { kind: GEOMETRY_GRAPH_KIND, id: graph.id, revision: graph.revision, value: graph }
    });
    expect(proposal.operations).toEqual([]);
    expect(proposal.approvalState).toBe('pending');
  });

  it('shows what is guaranteed and what can be improved', () => {
    const layout = layoutFor(TWO_STOREY);
    const proposal = toGeometryGraphProposal(geometryFrom(layout), {
      expected: expectedInstances(layout)
    });

    expect(proposal.explanation).toMatch(/Guaranteed/i);
    expect(proposal.explanation).toMatch(/Can be improved/i);
  });

  it('refuses to propose an empty graph', () => {
    const layout = layoutFor(TWO_STOREY);
    const graph = geometryFrom(layout);

    expect(() =>
      toGeometryGraphProposal(reviseGeometryGraph(graph, { polygons: [] }), {
        expected: expectedInstances(layout)
      })
    ).toThrow(/empty/i);
  });
});

// --- Sprint 28.1b — the contract is public and enforced for any strategy ------

describe('a conformant strategy that is not the built-in', () => {
  /**
   * A plugin-shaped packer: the reference packing, mirrored about x. Every
   * invariant still holds — it is a rigid transform — so the contract accepts
   * it, and the card's guarantee must read identically.
   */
  const mirrored = defineSkill<PackLayoutInput, PackLayoutOutput>({
    id: 'test.mirroredPacker',
    summary: 'The reference packing, mirrored — a conformant third-party strategy.',
    execute: (input, ctx) => {
      const packed = packLayout.execute(input, ctx);
      if (!packed.ok) {
        return packed;
      }
      const flip = (value: number): number => -value;
      return {
        ok: true,
        value: {
          polygons: packed.value.polygons.map((polygon) => ({
            ...polygon,
            corners: polygon.corners.map((corner) => ({ x: flip(corner.x), y: corner.y }))
          })),
          envelopes: packed.value.envelopes.map((envelope) => ({
            storey: envelope.storey,
            bounds: {
              minX: flip(envelope.bounds.maxX),
              minY: envelope.bounds.minY,
              maxX: flip(envelope.bounds.minX),
              maxY: envelope.bounds.maxY
            }
          }))
        }
      };
    }
  });

  it('passes the published conformance suite', () => {
    expect(runPackingConformance(mirrored).conformant).toBe(true);
  });

  it('passes the invariant gate at synthesis', () => {
    const layout = layoutFor(TWO_STOREY);
    const result = synthesizeGeometry({ layout, strategy: mirrored });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(gateGeometryGraph(result.graph, layout).ok).toBe(true);
  });

  it('produces a card whose guarantee wording is unchanged', () => {
    const layout = layoutFor(TWO_STOREY);
    const builtIn = geometryFrom(layout);
    const plugin = synthesizeGeometry({ layout, strategy: mirrored });
    expect(plugin.ok).toBe(true);
    if (!plugin.ok) return;

    const guaranteeOf = (graph: GeometryGraph): string =>
      describeEvaluation(evaluateGeometryGraph(graph, { expected: expectedInstances(layout) }))
        .split('\n')
        .find((line) => line.startsWith('**Guaranteed**'))!;

    // The promise is about the contract, not about the built-in.
    expect(guaranteeOf(plugin.graph)).toBe(guaranteeOf(builtIn));
    expect(guaranteeOf(builtIn)).toMatch(/whatever produced this geometry/i);
  });

  it('is refused by the gate the moment it stops being conformant', () => {
    const broken = defineSkill<PackLayoutInput, PackLayoutOutput>({
      id: 'test.brokenPacker',
      summary: 'Drops a room.',
      execute: (input, ctx) => {
        const packed = packLayout.execute(input, ctx);
        return packed.ok
          ? { ok: true, value: { ...packed.value, polygons: packed.value.polygons.slice(1) } }
          : packed;
      }
    });

    const layout = layoutFor(TWO_STOREY);
    const result = synthesizeGeometry({ layout, strategy: broken });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const gate = gateGeometryGraph(result.graph, layout);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.message).toMatch(/I1/);
  });
});
