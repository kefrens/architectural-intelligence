/**
 * BUG-011 — the artefact-level defects, made executable.
 *
 * **Red on purpose**, and the companion to
 * `@archisimple/skills`' `bug-011-constraint-evaluation.test.ts`. Tests A and B
 * are skill semantics and live there; C and D need a Layout Plan and live here.
 *
 * Nothing here changes the data model or invents constraint vocabulary.
 *
 * ## Sprint 1.8 — what is green, and what had to be rewritten
 *
 * Test C is green. Two of its assertions were made green by this sprint —
 * `buildCirculation` no longer emits its unconditional sentence, and
 * `buildGraph` no longer attaches every space to circulation.
 *
 * **The other two were passing for the wrong reason and are rewritten.** When
 * ArchiSimple Sprint 037.3 removed the platform's superseded API,
 * `computeLayoutQuality` began falling back to zeros, so an assertion reading
 * `circulationQuality !== 1` held because the computation had broken rather than
 * because anything was evaluated. A test that passes because a calculation
 * failed is not evidence. Both now assert the **evaluator's** answer, at the
 * stage that can give one, which is what ADR-0034 §18's "may be extended, never
 * weakened" is for.
 *
 * Test D stays red, and stays blocked: ADR-0034 §17.1 requires a separate ADR
 * before any constraint can name one instance of a repeated space.
 */

import { describe, expect, it } from 'vitest';
import { assembleBrief, classifyRequest } from '../brief/index.js';
import { CONSTRAINT_OUTCOMES, CONSTRAINT_REASON_CODES } from '@archisimple/skills';
import {
  circulationNodeId,
  computeLayoutSummary,
  createLayoutPlan,
  describeLayoutSummary,
  synthesizeLayout,
  LAYOUT_EDGE_KINDS,
  LAYOUT_NODE_KINDS,
  type LayoutPlan,
  type LayoutSpace
} from '../layout/index.js';
import {
  createGeometrySpecification,
  evaluateSpecification,
  OPENING_KINDS,
  WALL_ROLES,
  type GeometrySpecification,
  type SpecifiedOpening,
  type SpecifiedSpace,
  type SpecifiedWall
} from '../geometry/index.js';
import { FUNCTIONAL_ZONES, SPACE_PRIORITIES, synthesizeProgramme } from '../programme/index.js';

const TC01 = 'Design a 100 m2 single storey apartment with 2 bedrooms and 2 bathrooms';

function layoutForTC01(): LayoutPlan {
  const brief = assembleBrief({ utterance: TC01, classification: classifyRequest(TC01) });
  const programme = synthesizeProgramme({ brief });
  if (!programme.ok) {
    throw new Error(programme.message);
  }
  const layout = synthesizeLayout({ programme: programme.programme });
  if (!layout.ok) {
    throw new Error(layout.message);
  }
  return layout.plan;
}

function space(id: string, name: string, zone: string): LayoutSpace {
  return {
    id,
    name,
    count: 1,
    areaEach: 12,
    priority: SPACE_PRIORITIES.Required,
    zone: zone as LayoutSpace['zone'],
    storeys: [0]
  };
}

/**
 * A single-storey plan with a hallway on it, in which `bedroom-2` has no edge to
 * circulation at all. Every other space does.
 *
 * This is the BUG-011 reproduction reduced to its topology: a hallway exists, it
 * serves the storey, and one bedroom cannot be reached through it.
 */
function planWithDisconnectedBedroom(): LayoutPlan {
  const spaces = [
    space('hallway', 'hallway', FUNCTIONAL_ZONES.Circulation),
    space('living', 'living room', FUNCTIONAL_ZONES.Day),
    space('bedroom-1', 'bedroom 1', FUNCTIONAL_ZONES.Night),
    space('bedroom-2', 'bedroom 2', FUNCTIONAL_ZONES.Night)
  ];

  return createLayoutPlan({
    sourceProgramme: { programmeId: 'programme-under-test', programmeRevision: 1 },
    storeys: 1,
    spaces,
    graph: {
      nodes: [
        ...spaces.map((entry) => ({
          id: entry.id,
          kind: LAYOUT_NODE_KINDS.Space,
          storeys: [0]
        })),
        { id: circulationNodeId(0), kind: LAYOUT_NODE_KINDS.Circulation, storeys: [0] }
      ],
      // bedroom-2 is deliberately absent from this list.
      edges: [
        {
          fromNodeId: 'hallway',
          toNodeId: circulationNodeId(0),
          kind: LAYOUT_EDGE_KINDS.Connected
        },
        { fromNodeId: 'living', toNodeId: circulationNodeId(0), kind: LAYOUT_EDGE_KINDS.Connected },
        {
          fromNodeId: 'bedroom-1',
          toNodeId: circulationNodeId(0),
          kind: LAYOUT_EDGE_KINDS.Connected
        }
      ]
    },
    circulation: {
      verticalSpaceIds: [],
      perStorey: [{ storey: 0, circulationSpaceIds: ['hallway'] }],
      unservedStoreys: [],
      description: 'Every space opens off the hallway.'
    }
  });
}

/**
 * The same topology, one stage down: a Specification in which `bedroom-2` has no
 * opening to anything.
 *
 * This is where the question becomes answerable. Every other room is joined to
 * the hallway by a door; the bedroom shares a wall with it and has no doorway
 * through — which is BUG-011's plan exactly, in the artefact that carries
 * openings.
 */
function specificationWithDisconnectedBedroom(): GeometrySpecification {
  const room = (spaceId: string): SpecifiedSpace => ({
    id: `polygon-${spaceId}`,
    spaceId,
    name: spaceId,
    storey: 0,
    boundary: [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 }
    ],
    area: 9
  });

  const wall = (id: string, between: readonly string[]): SpecifiedWall => ({
    id,
    storey: 0,
    start: { x: 0, y: 0 },
    end: { x: 3, y: 0 },
    thickness: 0.1,
    role: WALL_ROLES.Internal,
    height: 2.5,
    separates: between.map((spaceId) => `polygon-${spaceId}`),
    realises: []
  });

  const door = (id: string, wallId: string, connects: [string, string]): SpecifiedOpening => ({
    id,
    wallId,
    kind: OPENING_KINDS.Door,
    distanceAlongWall: 1.5,
    width: 0.9,
    height: 2.1,
    sill: 0,
    connects
  });

  return createGeometrySpecification({
    sourceGeometry: { geometryGraphId: 'graph-under-test', geometryGraphRevision: 1 },
    storeys: [{ index: 0, elevation: 0, height: 2.7 }],
    spaces: ['hallway', 'living', 'bedroom-1', 'bedroom-2'].map(room),
    walls: [
      wall('wall-living', ['hallway', 'living']),
      wall('wall-bedroom-1', ['hallway', 'bedroom-1']),
      // Shared with the hallway, and solid. The whole point.
      wall('wall-bedroom-2', ['hallway', 'bedroom-2'])
    ],
    openings: [
      door('door-living', 'wall-living', ['hallway', 'living']),
      door('door-bedroom-1', 'wall-bedroom-1', ['hallway', 'bedroom-1'])
    ]
  });
}

describe('BUG-011 Test C — a hallway existing is not spaces being reachable', () => {
  /**
   * **Rewritten in Sprint 1.8.** It read `computeLayoutQuality(...).
   * circulationQuality !== 1`, and after ArchiSimple Sprint 037.3 that held
   * because the calculation had broken and fell back to zero — not because
   * anything was checked.
   *
   * The property it was reaching for is this: a hallway existing on a storey is
   * not the spaces on that storey being able to reach it. The layout stage
   * cannot say either way, and now says so, in the authority's own vocabulary
   * rather than in a number that happened not to be 1.
   */
  it('does not report circulation reachability at a stage that cannot establish it', () => {
    const summary = computeLayoutSummary(planWithDisconnectedBedroom());

    // Every storey has circulation on it — a true statement about storeys, and
    // the one BUG-011's user read as "every room can reach the hallway".
    expect(summary.circulation).toEqual({
      storeys: 1,
      withCirculation: 1,
      unservedStoreys: []
    });

    // And nothing anywhere claims that. Every constraint is NOT_APPLICABLE, so
    // there is no pass to misread, and the count of evaluated ones is zero.
    expect(summary.constraints.total.evaluated).toBe(0);
    expect(summary.constraints.total.passed).toBe(0);
    expect(
      summary.constraintResults.every(
        (result) => result.outcome === CONSTRAINT_OUTCOMES.NotApplicable
      )
    ).toBe(true);

    // The rendering says it too, in words, and claims nothing.
    const rendered = describeLayoutSummary(summary);
    expect(rendered).toContain('Not yet checked');
    expect(rendered).not.toMatch(/satisfied|\bmet\b|100%/i);
  });

  /**
   * **Rewritten in Sprint 1.8.** It asserted only that the disconnection was
   * visible in the graph and invisible to the quality calculation — true, and no
   * longer the interesting half now that something reads it.
   *
   * The disconnection is still the premise, and the evaluator now finds it: at
   * the Geometry Specification, where openings exist, an unreachable bedroom is
   * a named FAIL rather than a number nobody could act on.
   */
  it('finds the unreachable bedroom at the stage that can decide it', () => {
    const plan = planWithDisconnectedBedroom();

    // The premise, unchanged: nothing joins bedroom-2 to circulation.
    const reachesCirculation = plan.graph.edges.some(
      (edge) =>
        (edge.fromNodeId === 'bedroom-2' && edge.toNodeId === circulationNodeId(0)) ||
        (edge.toNodeId === 'bedroom-2' && edge.fromNodeId === circulationNodeId(0))
    );
    expect(reachesCirculation).toBe(false);

    // A Specification of the same topology: three rooms reachable from the
    // hallway, and a fourth with no opening to anything.
    const compliance = evaluateSpecification({
      specification: specificationWithDisconnectedBedroom(),
      intents: [],
      spaces: plan.spaces
    });

    const bedroomTwo = compliance.failures.find((failure) =>
      failure.spaceIds.includes('bedroom-2')
    );

    expect(bedroomTwo).toBeDefined();
    expect(bedroomTwo?.outcome).toBe(CONSTRAINT_OUTCOMES.Fail);
    expect(bedroomTwo?.reasonCode).toBe(CONSTRAINT_REASON_CODES.Unreachable);
    // And the rooms that *are* reachable are not swept up with it.
    expect(compliance.summary.total.passed).toBe(2);
  });

  /**
   * The generator's own prose asserts a property it never checked:
   * `buildCirculation` (`layout-synthesis.ts:187`) emits "Every space opens off
   * the …" for *every* single-storey plan, unconditionally. This is what the
   * user read as an approved programme requirement.
   *
   * Asserted against a generated plan, not a fixture, because the defect is the
   * template — not any one string.
   */
  it('does not assert universal connection in generated single-storey prose', () => {
    const plan = layoutForTC01();

    expect(plan.storeys).toBe(1);
    expect(plan.circulation.description).not.toContain('Every space opens off');
  });

  /**
   * The same claim in structural form: `buildGraph` (`layout-synthesis.ts:240`)
   * attaches every space to its storey's circulation node with no check, so the
   * graph asserts total connectivity for any programme whatsoever.
   */
  it('does not attach every space to circulation unconditionally', () => {
    const plan = layoutForTC01();

    const connectedToCirculation = plan.graph.edges.filter(
      (edge) => edge.toNodeId === circulationNodeId(0) && edge.kind === LAYOUT_EDGE_KINDS.Connected
    );

    expect(connectedToCirculation).not.toHaveLength(plan.spaces.length);
  });
});

describe('BUG-011 Test D — repeated spaces have no addressable instances', () => {
  /**
   * Green today, and the premise: two bedrooms are one `LayoutSpace` carrying
   * `count: 2`. "Bedroom 2" is not an entity anywhere in the brief, the
   * programme, the layout or the graph.
   */
  it('carries two bedrooms as one space with a count', () => {
    const bedrooms = layoutForTC01().spaces.filter((entry) => /bedroom/i.test(entry.name));

    expect(bedrooms).toHaveLength(1);
    expect(bedrooms[0]?.count).toBe(2);
  });

  /**
   * The stop condition, made executable: an instance-specific constraint needs
   * an identity to name, and there is exactly one id for both bedrooms.
   *
   * This asserts *addressability*, not a representation. Whether instances
   * become separate spaces, nodes, or an id scheme over `count` is a data-model
   * decision this test deliberately does not make — and per BUG-011 stop
   * condition 2, one that should be reviewed rather than assumed.
   */
  it('cannot name the second bedroom in a constraint', () => {
    const bedrooms = layoutForTC01().spaces.filter((entry) => /bedroom/i.test(entry.name));
    const addressable = new Set(bedrooms.map((entry) => entry.id));

    expect(addressable.size).toBe(2);
  });

  /**
   * TC-04 and TC-05 of BUG-011 require relationships between *particular*
   * instances. Neither can be stated as an `IntendedAdjacency`, whose
   * `fromSpaceId` and `toSpaceId` can only hold the one shared bedroom id — the
   * two constraints would be the same object.
   */
  it.todo('distinguishes bedroom 1 → bathroom 1 from bedroom 2 → bathroom 2 (BUG-011 TC-04)');
  it.todo('checks each bedroom instance against the hallway independently (BUG-011 TC-05)');
});
