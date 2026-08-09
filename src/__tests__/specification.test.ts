/**
 * Sprint 1.1 — the Geometry Specification, its gate, its tool and its revision.
 *
 * Structured as the sprint's epics. The thickness-insertion maths is tested in
 * `@archisimple/skills`, where it lives; what is asserted here is the artefact,
 * the boundary it keeps, and the behaviour a user actually meets.
 *
 * The fixture is the real chain — utterance to Brief to Programme to Layout to
 * Geometry Graph to Specification — because the claim worth checking is that the
 * pipeline produces a buildable description of the house somebody asked for, not
 * that a hand-made graph converts.
 */

import { isArtefactProposal } from '@archisimple/ai-engine';
import { describe, expect, it } from 'vitest';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import { createInMemoryPlanningArtefactReader } from '../artefacts/planning-artefact-reader.js';
import {
  ARCHITECTURAL_BRIEF_KIND,
  assembleBrief,
  classifyRequest,
  type ArchitecturalBrief
} from '../brief/index.js';
import {
  DEFAULT_CONSTRUCTION,
  GEOMETRY_CONTRACT_VERSION,
  GEOMETRY_GRAPH_KIND,
  GEOMETRY_SPECIFICATION_KIND,
  gateGeometrySpecification,
  isContractCompatible,
  matchesGeometryGraph,
  reviseGeometrySpecification,
  specificationJunctions,
  storeyFloorArea,
  summarizeGeometrySpecification,
  synthesizeGeometry,
  synthesizeSpecification,
  toGeometrySpecificationProposal,
  validateGeometrySpecification,
  wallHeight,
  type GeometryGraph,
  type GeometrySpecification
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
import { createSpecificationToolDefinition } from '../tools/index.js';
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

function graphFor(utterance: string): GeometryGraph {
  const result = synthesizeGeometry({ layout: layoutFor(utterance) });
  if (!result.ok) throw new Error(result.message);
  return result.graph;
}

function specificationFrom(graph: GeometryGraph): GeometrySpecification {
  const result = synthesizeSpecification({ graph });
  if (!result.ok) throw new Error(result.message);
  return result.specification;
}

function serviceWith(
  graph: GeometryGraph | undefined,
  options: {
    readonly planner?: ArchitecturalPlanner;
    readonly specification?: GeometrySpecification;
  } = {}
): ArchitecturalIntelligenceService {
  const layout = layoutFor(TWO_STOREY);
  const programme = programmeFor(TWO_STOREY);
  const brief = briefFor(TWO_STOREY);

  return new ArchitecturalIntelligenceService({
    knowledge: createHarness().knowledge,
    ...(options.planner === undefined ? {} : { planner: options.planner }),
    artefacts: createInMemoryPlanningArtefactReader([
      { kind: ARCHITECTURAL_BRIEF_KIND, id: brief.id, revision: 1, value: brief },
      { kind: SPACE_PROGRAMME_KIND, id: programme.id, revision: 1, value: programme },
      { kind: LAYOUT_PLAN_KIND, id: layout.id, revision: layout.revision, value: layout },
      ...(graph === undefined
        ? []
        : [{ kind: GEOMETRY_GRAPH_KIND, id: graph.id, revision: graph.revision, value: graph }]),
      ...(options.specification === undefined
        ? []
        : [
            {
              kind: GEOMETRY_SPECIFICATION_KIND,
              id: options.specification.id,
              revision: options.specification.revision,
              value: options.specification
            }
          ])
    ])
  });
}

// --- Epic 1 — the artefact -----------------------------------------------------

describe('the geometry specification', () => {
  it('states the contract version and the conventions a foreign consumer needs', () => {
    const specification = specificationFrom(graphFor(ONE_STOREY));

    expect(specification.contractVersion).toBe(GEOMETRY_CONTRACT_VERSION);
    expect(specification.conventions.unit).toBe('metre');
    expect(specification.conventions.precision).toBe(0.001);
    expect(specification.conventions.winding).toBe('counter-clockwise');
  });

  it('refuses a consumer written against a different major contract', () => {
    const specification = specificationFrom(graphFor(ONE_STOREY));

    expect(isContractCompatible(specification, '1.4.0')).toBe(true);
    expect(isContractCompatible(specification, '2.0.0')).toBe(false);
  });

  it('records provenance so a revised graph leaves it detectably stale', () => {
    const graph = graphFor(ONE_STOREY);
    const specification = specificationFrom(graph);

    expect(matchesGeometryGraph(specification, { id: graph.id, revision: 1 })).toBe(true);
    expect(matchesGeometryGraph(specification, { id: graph.id, revision: 2 })).toBe(false);
  });

  it('keeps space ids stable, so an element can be followed between artefacts', () => {
    const graph = graphFor(ONE_STOREY);
    const specification = specificationFrom(graph);

    for (const polygon of graph.polygons) {
      expect(specification.spaces.some((space) => space.id === polygon.id)).toBe(true);
    }
  });

  it('revises rather than mutates', () => {
    const specification = specificationFrom(graphFor(ONE_STOREY));
    const revised = reviseGeometrySpecification(specification, { warnings: ['later'] });

    expect(revised.id).toBe(specification.id);
    expect(revised.revision).toBe(2);
    expect(specification.revision).toBe(1);
    expect(specification.warnings).not.toContain('later');
  });
});

// --- Epic 2 — synthesis --------------------------------------------------------

describe('S1 — no space is under-delivered', () => {
  it('never returns a room smaller than the geometry the user approved', () => {
    for (const utterance of [ONE_STOREY, TWO_STOREY]) {
      const graph = graphFor(utterance);
      const specification = specificationFrom(graph);

      for (const polygon of graph.polygons) {
        const space = specification.spaces.find((entry) => entry.id === polygon.id)!;
        expect(space.area).toBeGreaterThanOrEqual(polygon.achievedArea - 0.0001);
      }
    }
  });

  it('says which rooms grew, and why, rather than letting it pass unnoticed', () => {
    const specification = specificationFrom(graphFor(TWO_STOREY));
    const stretched = specification.warnings.filter((warning) => warning.includes('grew by'));

    // Whether any room spans an inserted wall depends on the packing, so this
    // asserts the *reporting*, not the arithmetic: every claim of growth names
    // the room and says the direction the change went.
    for (const warning of stretched) {
      expect(warning).toContain('larger than the geometry you approved, never smaller');
    }
  });
});

describe('S2 — rooms are separated by the walls between them', () => {
  it('leaves no two rooms on a storey touching', () => {
    const specification = specificationFrom(graphFor(TWO_STOREY));
    expect(validateGeometrySpecification(specification)).toEqual([]);
  });
});

describe('walls', () => {
  it('gives every wall a thickness, a height and a role', () => {
    const specification = specificationFrom(graphFor(ONE_STOREY));

    expect(specification.walls.length).toBeGreaterThan(0);
    for (const wall of specification.walls) {
      expect(wall.thickness).toBeGreaterThan(0);
      expect(wall.height).toBe(wallHeight(DEFAULT_CONSTRUCTION));
      expect(['external', 'internal']).toContain(wall.role);
    }
  });

  it('uses the external thickness on the envelope and the internal one inside', () => {
    const specification = specificationFrom(graphFor(ONE_STOREY));
    const external = specification.walls.filter((wall) => wall.role === 'external');
    const internal = specification.walls.filter((wall) => wall.role === 'internal');

    expect(external.length).toBeGreaterThan(0);
    expect(internal.length).toBeGreaterThan(0);
    for (const wall of external) {
      expect(wall.thickness).toBe(DEFAULT_CONSTRUCTION.externalWallThickness);
    }
    for (const wall of internal) {
      expect(wall.thickness).toBe(DEFAULT_CONSTRUCTION.internalWallThickness);
    }
  });

  it('merges colinear segments into runs, and names what each realises', () => {
    const graph = graphFor(ONE_STOREY);
    const specification = specificationFrom(graph);

    // Every candidate the geometry named is realised by exactly one run — which
    // is what makes "nothing was dropped" checkable when several merge into one.
    const realised = specification.walls.flatMap((wall) => wall.realises);
    for (const candidate of graph.wallCandidates) {
      expect(realised.filter((id) => id === candidate.id)).toHaveLength(1);
    }
    expect(specification.walls.length).toBeLessThan(graph.wallCandidates.length);
  });

  it('names the spaces a wall separates', () => {
    const specification = specificationFrom(graphFor(ONE_STOREY));
    const internal = specification.walls.filter((wall) => wall.role === 'internal');

    for (const wall of internal) {
      expect(wall.separates.length).toBeGreaterThan(0);
      for (const spaceId of wall.separates) {
        expect(specification.spaces.some((space) => space.id === spaceId)).toBe(true);
      }
    }
  });
});

describe('S4 — walls meet exactly', () => {
  it('forms junctions the walls actually share, rather than near misses', () => {
    const specification = specificationFrom(graphFor(ONE_STOREY));
    const junctions = specificationJunctions(specification);

    expect(junctions.length).toBeGreaterThan(0);
    for (const junction of junctions) {
      for (const wallId of junction.wallIds) {
        expect(specification.walls.some((wall) => wall.id === wallId)).toBe(true);
      }
    }
  });
});

describe('S5 — openings fit their walls', () => {
  it('places every opening inside the wall it crosses', () => {
    const specification = specificationFrom(graphFor(TWO_STOREY));

    for (const opening of specification.openings) {
      const wall = specification.walls.find((entry) => entry.id === opening.wallId)!;
      const length =
        Math.abs(wall.end.x - wall.start.x) + Math.abs(wall.end.y - wall.start.y);

      expect(opening.width).toBeLessThan(length);
      expect(opening.distanceAlongWall - opening.width / 2).toBeGreaterThanOrEqual(-0.0001);
      expect(opening.distanceAlongWall + opening.width / 2).toBeLessThanOrEqual(length + 0.0001);
      expect(opening.sill + opening.height).toBeLessThanOrEqual(wall.height);
    }
  });

  it('gives every opening a kind, a size and the two spaces it connects', () => {
    const specification = specificationFrom(graphFor(TWO_STOREY));

    expect(specification.openings.length).toBeGreaterThan(0);
    for (const opening of specification.openings) {
      expect(['door', 'passage']).toContain(opening.kind);
      expect(opening.width).toBeGreaterThan(0);
      expect(opening.height).toBeGreaterThan(0);
      expect(opening.connects).toHaveLength(2);
    }
  });
});

describe('S7 — determinism and self-description', () => {
  it('produces the same specification from the same graph', () => {
    const graph = graphFor(TWO_STOREY);
    const first = synthesizeSpecification({ graph, now: 1 });
    const second = synthesizeSpecification({ graph, now: 1 });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // Ids are fresh per artefact by design; everything that describes the
    // building must be identical.
    expect(second.specification.spaces).toEqual(first.specification.spaces);
    expect(second.specification.walls).toEqual(first.specification.walls);
    expect(second.specification.assumptions).toEqual(first.specification.assumptions);
  });

  it('records every number it decided rather than received', () => {
    const specification = specificationFrom(graphFor(ONE_STOREY));
    const assumptions = specification.assumptions.join(' ');

    expect(assumptions).toContain('300 mm');
    expect(assumptions).toContain('load-bearing');
    expect(assumptions).toContain('no windows');
  });

  it('refuses a geometry with no rooms, and one with no walls', () => {
    const graph = graphFor(ONE_STOREY);

    expect(synthesizeSpecification({ graph: { ...graph, polygons: [] } })).toMatchObject({
      ok: false
    });
    expect(synthesizeSpecification({ graph: { ...graph, wallCandidates: [] } })).toMatchObject({
      ok: false
    });
  });
});

describe('constraints are provenance, not instructions', () => {
  it('carries why a relation mattered, and nothing a consumer could be asked to solve', () => {
    const graph = graphFor(TWO_STOREY);
    const specification = specificationFrom(graph);

    expect(specification.constraints.length).toBe(graph.adjacencies.length);
    for (const constraint of specification.constraints) {
      expect(constraint.kind.startsWith('adjacency:')).toBe(true);
      expect(constraint.reason.length).toBeGreaterThan(0);
    }
  });
});

// --- Epic 3 — validation and the gate ------------------------------------------

describe('the invariant gate', () => {
  it('passes a specification this pipeline produced', () => {
    const graph = graphFor(TWO_STOREY);
    expect(gateGeometrySpecification(specificationFrom(graph), graph)).toEqual({ ok: true });
  });

  it('refuses an opening wider than its wall, naming the clause', () => {
    const specification = specificationFrom(graphFor(TWO_STOREY));
    const broken = reviseGeometrySpecification(specification, {
      openings: specification.openings.map((opening) => ({ ...opening, width: 100 }))
    });

    const gate = gateGeometrySpecification(broken);
    expect(gate.ok).toBe(false);
    expect(gate.ok || gate.message).toContain('S5');
  });

  it('refuses rooms that overlap', () => {
    const specification = specificationFrom(graphFor(ONE_STOREY));
    const first = specification.spaces[0]!;
    const broken = reviseGeometrySpecification(specification, {
      spaces: specification.spaces.map((space) => ({ ...space, boundary: first.boundary }))
    });

    const gate = gateGeometrySpecification(broken);
    expect(gate.ok).toBe(false);
    expect(gate.ok || gate.message).toContain('S2');
  });

  it('refuses a wall the geometry named and nothing built', () => {
    const graph = graphFor(ONE_STOREY);
    const specification = specificationFrom(graph);
    const broken = reviseGeometrySpecification(specification, {
      walls: specification.walls.slice(1)
    });

    const gate = gateGeometrySpecification(broken, graph);
    expect(gate.ok).toBe(false);
    expect(gate.ok || gate.message).toContain('S3');
  });

  it('catches a stage provider that breaks an invariant, not only broken synthesis', () => {
    const graph = graphFor(ONE_STOREY);
    const planner = new ArchitecturalPlanner();
    const vandal: PlanningStageProvider<GeometrySpecification> = {
      id: 'vandal',
      stage: PLANNING_STAGES.Specification,
      enrich: (specification) => ({
        ...specification,
        openings: specification.openings.map((opening) => ({ ...opening, width: 99 }))
      })
    };
    planner.registerStageProvider(vandal);

    const response = serviceWith(graph, { planner }).generateSpecification(graph);

    expect(response.proposal).toBeUndefined();
    expect(response.message).toContain('S5');
  });

  it('reports blockers in the one vocabulary the pipeline already uses', () => {
    const specification = specificationFrom(graphFor(ONE_STOREY));
    const broken = reviseGeometrySpecification(specification, { walls: [] });

    const blockers = validateGeometrySpecification(broken);
    expect(blockers.length).toBeGreaterThan(0);
    for (const blocker of blockers) {
      expect(blocker.reason).toBe('unsupported');
      expect(blocker.suggestions.length).toBeGreaterThan(0);
    }
  });
});

// --- Epic 4 — reachability and revision ----------------------------------------

describe('the specification lane', () => {
  it('offers a proposal for an approved geometry', () => {
    const graph = graphFor(TWO_STOREY);
    const response = serviceWith(graph).generateSpecification(graph);

    expect(response.proposal).toBeDefined();
    expect(response.specification).toBeDefined();
    expect(response.proposal !== undefined && isArtefactProposal(response.proposal)).toBe(true);
    expect(
      response.proposal !== undefined && isArtefactProposal(response.proposal)
        ? response.proposal.subject.artefact.kind
        : undefined
    ).toBe(GEOMETRY_SPECIFICATION_KIND);
  });

  it('says approval builds nothing, because it does not', () => {
    const specification = specificationFrom(graphFor(ONE_STOREY));
    const proposal = toGeometrySpecificationProposal(specification);

    expect(proposal.expectedOutcome).toContain('Nothing is built from it here');
    expect(proposal.operations ?? []).toHaveLength(0);
  });

  it('blocks the tool when no geometry is approved', () => {
    const tool = createSpecificationToolDefinition(serviceWith(undefined));
    const resolved = tool.resolve({}, {});

    expect(resolved?.kind).toBe('blocked');
    expect(resolved?.kind === 'blocked' ? resolved.message : '').toContain('no approved geometry');
  });

  it('resolves the tool to a proposal when geometry is approved', () => {
    const graph = graphFor(TWO_STOREY);
    const tool = createSpecificationToolDefinition(serviceWith(graph));
    const resolved = tool.resolve({}, {});

    expect(resolved?.kind).toBe('proposal');
  });

  it('takes no arguments — a model cannot suggest a wall thickness', () => {
    const tool = createSpecificationToolDefinition(serviceWith(undefined));
    expect(tool.schema.function.parameters).toEqual({
      type: 'object',
      properties: {},
      required: []
    });
  });
});

describe('regenerating produces a revision, not a second artefact', () => {
  it('returns revision 2 when the project already approved one for this geometry', () => {
    const graph = graphFor(TWO_STOREY);
    const approved = specificationFrom(graph);

    const response = serviceWith(graph, { specification: approved }).generateSpecification(graph);

    expect(response.specification?.id).toBe(approved.id);
    expect(response.specification?.revision).toBe(2);
  });

  it('starts a new artefact when the approved one describes different geometry', () => {
    const graph = graphFor(TWO_STOREY);
    const approved = specificationFrom(graphFor(ONE_STOREY));

    const response = serviceWith(graph, { specification: approved }).generateSpecification(graph);

    expect(response.specification?.id).not.toBe(approved.id);
    expect(response.specification?.revision).toBe(1);
  });
});

describe('the review card', () => {
  it('leads with what the user has not seen: thickness, height and openings', () => {
    const specification = specificationFrom(graphFor(TWO_STOREY));
    const summary = summarizeGeometrySpecification(specification);

    expect(summary).toContain('Ground floor');
    expect(summary).toContain('mm');
    expect(summary).toContain('Openings');
    expect(storeyFloorArea(specification, 0)).toBeGreaterThan(0);
  });
});
