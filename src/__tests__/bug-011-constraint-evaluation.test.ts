/**
 * BUG-011 — the artefact-level defects, made executable.
 *
 * **Red on purpose**, and the companion to
 * `@archisimple/skills`' `bug-011-constraint-evaluation.test.ts`. Tests A and B
 * are skill semantics and live there; C and D need a Layout Plan and live here.
 *
 * Nothing here changes the data model or invents constraint vocabulary. Test C
 * builds a plan by hand — the "deliberately invalid candidate" of BUG-011 TC-07
 * and TC-10 — because `synthesizeLayout` cannot produce one: `buildGraph`
 * (`layout-synthesis.ts:240`) attaches every space to its storey's circulation
 * node unconditionally, so a disconnected space is not reachable through the
 * generator.
 */

import { describe, expect, it } from 'vitest';
import { assembleBrief, classifyRequest } from '../brief/index.js';
import {
  circulationNodeId,
  computeLayoutQuality,
  createLayoutPlan,
  synthesizeLayout,
  LAYOUT_EDGE_KINDS,
  LAYOUT_NODE_KINDS,
  type LayoutPlan,
  type LayoutSpace
} from '../layout/index.js';
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

describe('BUG-011 Test C — a hallway existing is not spaces being reachable', () => {
  /**
   * `circulationQuality` is the share of storeys that *have* a circulation space
   * assigned (`scoreCirculation`), never the share of spaces that can reach one.
   * The plan below has a hallway on its only storey, so it scores 1 while a
   * bedroom is unreachable.
   */
  it('does not report full circulation quality when a space cannot reach circulation', () => {
    const quality = computeLayoutQuality(planWithDisconnectedBedroom());

    expect(quality.circulationQuality).not.toBe(1);
  });

  /**
   * The graph is the only place the disconnection is visible, and the quality
   * calculation never reads it — `computeLayoutQuality` passes `plan.spaces` to
   * the skills and ignores `plan.graph` entirely. This asserts the input, so a
   * correction that consults the graph is distinguishable from one that merely
   * changes a number.
   */
  it('has the disconnection visible in the graph the quality calculation ignores', () => {
    const plan = planWithDisconnectedBedroom();

    const reachesCirculation = plan.graph.edges.some(
      (edge) =>
        (edge.fromNodeId === 'bedroom-2' && edge.toNodeId === circulationNodeId(0)) ||
        (edge.toNodeId === 'bedroom-2' && edge.fromNodeId === circulationNodeId(0))
    );

    // Green today — this is the premise of the test above, not a defect.
    expect(reachesCirculation).toBe(false);
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
