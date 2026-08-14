/**
 * Consuming the authoritative evaluator (Sprint 1.8, ArchiSimple ADR-0034).
 *
 * BUG-011's own reproduction is asserted in
 * `bug-011-constraint-evaluation.test.ts` and not duplicated here. What this
 * suite pins down is the migration: that intents become constraints without
 * gaining or losing anything, that each stage answers with what it can
 * establish and no more, and — the one that matters most — that no verdict in
 * this repository is computed anywhere but in `constraints.evaluate`.
 */

import { describe, expect, it } from 'vitest';
import {
  CONSTRAINT_OUTCOMES,
  CONSTRAINT_REASON_CODES,
  CONSTRAINT_RELATIONS,
  CONSTRAINT_STRENGTHS,
  EVALUATION_STAGES,
  STOREY_PRECONDITIONS
} from '@archisimple/skills';
import { assembleBrief, classifyRequest } from '../brief/index.js';
import {
  circulationReachabilityConstraints,
  circulationRootIds,
  relationshipConstraints
} from '../constraints/index.js';
import {
  computeLayoutSummary,
  describeLayoutSummary,
  synthesizeLayout,
  type LayoutPlan,
  type ResolvedAdjacency
} from '../layout/index.js';
import {
  createGeometrySpecification,
  describeSpecificationCompliance,
  evaluateSpecification,
  OPENING_KINDS,
  WALL_ROLES,
  type GeometrySpecification,
  type SpecifiedOpening,
  type SpecifiedSpace,
  type SpecifiedWall
} from '../geometry/index.js';
import { FUNCTIONAL_ZONES, synthesizeProgramme } from '../programme/index.js';

const APARTMENT = 'Design a 100 m2 single storey apartment with 2 bedrooms and 2 bathrooms';

function layoutFor(utterance: string): LayoutPlan {
  const brief = assembleBrief({ utterance, classification: classifyRequest(utterance) });
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

// --- the adapter ------------------------------------------------------------

describe('intents become constraints, and nothing else', () => {
  const intents = [
    { fromSpaceId: 'hall', toSpaceId: 'living', strength: 'required', reason: 'the way in' },
    { fromSpaceId: 'bed', toSpaceId: 'bath', strength: 'preferred', reason: 'at night' },
    { fromSpaceId: 'wc', toSpaceId: 'dining', strength: 'avoid', reason: 'not while eating' }
  ];

  it('maps each strength to the relation Q2 fixed, and only that one', () => {
    const constraints = relationshipConstraints(intents);

    expect(constraints.map((constraint) => constraint.relation)).toEqual([
      CONSTRAINT_RELATIONS.TraversableConnection,
      CONSTRAINT_RELATIONS.Adjacent,
      CONSTRAINT_RELATIONS.TraversableConnection
    ]);
    // One intent, one constraint. Two would be two chances to report it met.
    expect(constraints).toHaveLength(intents.length);
  });

  it('carries the strength across unchanged, so required and preferred stay apart', () => {
    expect(relationshipConstraints(intents).map((constraint) => constraint.strength)).toEqual([
      CONSTRAINT_STRENGTHS.Required,
      CONSTRAINT_STRENGTHS.Preferred,
      CONSTRAINT_STRENGTHS.Avoid
    ]);
  });

  it('carries the reason as a rationale, and nothing that could be read as evidence', () => {
    const [first] = relationshipConstraints(intents);

    expect(first?.rationale).toBe('the way in');
    // The shape cannot express a generator's claim (ADR-0034 §7). If any of
    // these ever appear, evaluation has been handed something it may not read.
    expect(first).not.toHaveProperty('satisfied');
    expect(first).not.toHaveProperty('score');
    expect(first).not.toHaveProperty('storeyPrecondition');
  });

  it('drops an intent whose strength is outside the vocabulary, rather than guessing', () => {
    const constraints = relationshipConstraints([
      ...intents,
      { fromSpaceId: 'a', toSpaceId: 'b', strength: 'nearby', reason: '' }
    ]);

    expect(constraints).toHaveLength(intents.length);
  });

  it('gives ids that are stable and distinguish two relations over one pair', () => {
    const once = relationshipConstraints(intents).map((constraint) => constraint.id);
    const twice = relationshipConstraints(intents).map((constraint) => constraint.id);

    expect(twice).toEqual(once);
    expect(new Set(once).size).toBe(once.length);
  });
});

describe('circulation reachability is stated, not assumed', () => {
  const spaces = [
    { id: 'hall', zone: FUNCTIONAL_ZONES.Circulation },
    { id: 'living', zone: FUNCTIONAL_ZONES.Day },
    { id: 'bed', zone: FUNCTIONAL_ZONES.Night }
  ];

  it('states one requirement per non-circulation space', () => {
    const constraints = circulationReachabilityConstraints(spaces);

    expect(constraints.map((constraint) => constraint.subjectSpaceId)).toEqual(['living', 'bed']);
    expect(
      constraints.every(
        (constraint) => constraint.relation === CONSTRAINT_RELATIONS.CirculationReachability
      )
    ).toBe(true);
  });

  it('names no second space, because the other end is the circulation system', () => {
    expect(
      circulationReachabilityConstraints(spaces).every(
        (constraint) => constraint.objectSpaceId === undefined
      )
    ).toBe(true);
  });

  it('roots at the programme’s circulation zoning, and derives no entrance', () => {
    expect(circulationRootIds(spaces)).toEqual(['hall']);
  });

  it('supplies the denominator BUG-011’s programme never had', () => {
    // The reproduction's required-adjacency denominator was 1. The requirement a
    // user believed they had — every room is reachable — is stated here, once
    // per room, and is what makes "100% of nothing" impossible to report.
    const plan = layoutFor(APARTMENT);
    const constraints = circulationReachabilityConstraints(plan.spaces);

    expect(constraints.length).toBeGreaterThan(1);
  });
});

// --- the Layout stage -------------------------------------------------------

describe('the Layout stage establishes nothing, and says so', () => {
  it('answers every constraint NOT_APPLICABLE, at the stage it names', () => {
    const summary = computeLayoutSummary(layoutFor(APARTMENT));

    expect(summary.constraints.evaluatedStage).toBe(EVALUATION_STAGES.Layout);
    expect(summary.constraints.total.stated).toBeGreaterThan(0);
    expect(summary.constraints.total.evaluated).toBe(0);
    expect(
      summary.constraintResults.every(
        (result) =>
          result.outcome === CONSTRAINT_OUTCOMES.NotApplicable &&
          result.reasonCode === CONSTRAINT_REASON_CODES.StageCannotDecide
      )
    ).toBe(true);
  });

  /** The four states of the sprint brief's item 8, each separately visible. */
  it('keeps evaluated, failed, not-applicable and nothing-asked distinguishable', () => {
    const summary = computeLayoutSummary(layoutFor(APARTMENT));

    // not-applicable — checked, and could not be decided here
    expect(summary.constraints.total.notApplicable).toBe(summary.constraints.total.stated);
    // evaluated and failed — separately counted, and both zero at this stage
    expect(summary.constraints.total.evaluated).toBe(0);
    expect(summary.constraints.total.failed).toBe(0);
    // nothing-asked — a different number from all three, and visible
    expect(summary.requiredAdjacencies.stated).toBeGreaterThanOrEqual(0);
    expect(describeLayoutSummary(summary)).toContain('Not yet checked');
  });

  it('renders no percentage and no claim of satisfaction', () => {
    const rendered = describeLayoutSummary(computeLayoutSummary(layoutFor(APARTMENT)));

    expect(rendered).not.toMatch(/%/);
    expect(rendered).not.toMatch(/satisfied|\bmet\b|opens off/i);
  });
});

// --- a plan written before Sprint 1.8 ---------------------------------------

describe('a Layout Plan approved before this sprint', () => {
  /** An artefact carrying the superseded `satisfied`, as a project file holds it. */
  function legacyPlan(): LayoutPlan {
    const plan = layoutFor(APARTMENT);
    return {
      ...plan,
      adjacencies: plan.adjacencies.map((adjacency) => {
        const { storeyPrecondition, ...rest } = adjacency;
        void storeyPrecondition;
        return { ...rest, satisfied: true } as unknown as ResolvedAdjacency;
      })
    };
  }

  it('reads as undecided rather than as the claim it used to make', () => {
    // ADR-0027.1 Rule 4 makes approved artefacts immutable, so the old boolean
    // is still on disk. It is not translated into a precondition: that boolean
    // is precisely the claim ADR-0034 §4.1a superseded.
    const summary = computeLayoutSummary(legacyPlan());

    expect(summary.requiredAdjacencies.undecided).toBe(0);
    expect(summary.requiredAdjacencies.unknownSpace).toBe(summary.requiredAdjacencies.stated);
  });

  it('renders without claiming anything, and without throwing', () => {
    expect(() => describeLayoutSummary(computeLayoutSummary(legacyPlan()))).not.toThrow();
    expect(describeLayoutSummary(computeLayoutSummary(legacyPlan()))).not.toMatch(/satisfied/i);
  });
});

// --- the Geometry Specification ---------------------------------------------

interface Wiring {
  readonly spaces: readonly string[];
  readonly walls: readonly (readonly [string, string])[];
  readonly doors: readonly (readonly [string, string])[];
}

function specificationFor(wiring: Wiring): GeometrySpecification {
  const space = (spaceId: string): SpecifiedSpace => ({
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

  const wall = ([a, b]: readonly [string, string], index: number): SpecifiedWall => ({
    id: `wall-${index}`,
    storey: 0,
    start: { x: 0, y: 0 },
    end: { x: 3, y: 0 },
    thickness: 0.1,
    role: WALL_ROLES.Internal,
    height: 2.5,
    separates: [`polygon-${a}`, `polygon-${b}`],
    realises: []
  });

  const door = ([a, b]: readonly [string, string], index: number): SpecifiedOpening => ({
    id: `door-${index}`,
    wallId: `wall-${index}`,
    kind: OPENING_KINDS.Door,
    distanceAlongWall: 1.5,
    width: 0.9,
    height: 2.1,
    sill: 0,
    connects: [a, b]
  });

  return createGeometrySpecification({
    sourceGeometry: { geometryGraphId: 'graph', geometryGraphRevision: 1 },
    storeys: [{ index: 0, elevation: 0, height: 2.7 }],
    spaces: wiring.spaces.map(space),
    walls: wiring.walls.map(wall),
    openings: wiring.doors.map(door)
  });
}

const SPACES = [
  { id: 'hall', zone: FUNCTIONAL_ZONES.Circulation },
  { id: 'living', zone: FUNCTIONAL_ZONES.Day },
  { id: 'bed', zone: FUNCTIONAL_ZONES.Night }
];

describe('the Geometry Specification gives the first real verdict', () => {
  const joined = specificationFor({
    spaces: ['hall', 'living', 'bed'],
    walls: [
      ['hall', 'living'],
      ['hall', 'bed']
    ],
    doors: [
      ['hall', 'living'],
      ['hall', 'bed']
    ]
  });

  const sealed = specificationFor({
    spaces: ['hall', 'living', 'bed'],
    walls: [
      ['hall', 'living'],
      ['hall', 'bed']
    ],
    // The bedroom shares a wall with the hallway and has no doorway through it.
    doors: [['hall', 'living']]
  });

  it('passes a required relationship a doorway actually honours', () => {
    const compliance = evaluateSpecification({
      specification: joined,
      intents: [{ fromSpaceId: 'bed', toSpaceId: 'hall', strength: 'required', reason: 'privacy' }],
      spaces: SPACES
    });

    expect(compliance.summary.evaluatedStage).toBe(EVALUATION_STAGES.GeometrySpecification);
    expect(compliance.summary.total).toMatchObject({ evaluated: 3, failed: 0 });
    expect(compliance.failures).toEqual([]);
  });

  it('fails it when only a wall joins them, and names the reason', () => {
    const compliance = evaluateSpecification({
      specification: sealed,
      intents: [{ fromSpaceId: 'bed', toSpaceId: 'hall', strength: 'required', reason: 'privacy' }],
      spaces: SPACES
    });

    const failure = compliance.failures.find((entry) =>
      entry.constraint.id.startsWith('bed::hall')
    );

    expect(failure?.outcome).toBe(CONSTRAINT_OUTCOMES.Fail);
    expect(failure?.reasonCode).toBe(CONSTRAINT_REASON_CODES.RelationAbsent);
    expect(failure?.reason).toMatch(/no traversable opening/i);
  });

  it('does not answer "opens onto" with "shares a wall"', () => {
    // The same pair, the same Specification, two relations, two answers. This is
    // the distinction the whole of ADR-0034 turns on.
    const compliance = evaluateSpecification({
      specification: sealed,
      intents: [
        { fromSpaceId: 'bed', toSpaceId: 'hall', strength: 'preferred', reason: 'near' },
        { fromSpaceId: 'bed', toSpaceId: 'hall', strength: 'required', reason: 'through' }
      ],
      spaces: SPACES
    });

    const byRelation = new Map(
      compliance.results.map((result) => [result.constraint.relation, result.outcome])
    );

    expect(byRelation.get(CONSTRAINT_RELATIONS.Adjacent)).toBe(CONSTRAINT_OUTCOMES.Pass);
    expect(byRelation.get(CONSTRAINT_RELATIONS.TraversableConnection)).toBe(
      CONSTRAINT_OUTCOMES.Fail
    );
  });

  it('reports the failure to a reader, with the denominator visible', () => {
    const rendered = describeSpecificationCompliance(
      evaluateSpecification({ specification: sealed, intents: [], spaces: SPACES })
    );

    expect(rendered).toMatch(/Met: 1 of 2 checked/);
    expect(rendered).toMatch(/cannot be reached/i);
    expect(rendered).not.toMatch(/%/);
  });

  it('says nothing at all when the programme stated nothing', () => {
    const rendered = describeSpecificationCompliance(
      evaluateSpecification({
        specification: joined,
        intents: [],
        spaces: [{ id: 'hall', zone: FUNCTIONAL_ZONES.Circulation }]
      })
    );

    expect(rendered).toMatch(/nothing to check/i);
    expect(rendered).not.toMatch(/100|Met:/);
  });
});

// --- independence -----------------------------------------------------------

describe('independence (ADR-0034 §7)', () => {
  it('follows the openings where the artefact’s own fields say the opposite', () => {
    // A Layout Plan whose every relation is marked `possible` — the generator's
    // most optimistic reading — feeding a Specification in which the bedroom is
    // sealed. The verdict follows the doorways.
    const plan = layoutFor(APARTMENT);
    const optimistic: LayoutPlan = {
      ...plan,
      adjacencies: plan.adjacencies.map((adjacency) => ({
        ...adjacency,
        storeyPrecondition: STOREY_PRECONDITIONS.Possible
      }))
    };

    expect(computeLayoutSummary(optimistic).constraints.total.passed).toBe(0);

    const compliance = evaluateSpecification({
      specification: specificationFor({
        spaces: ['hall', 'bed'],
        walls: [['hall', 'bed']],
        doors: []
      }),
      intents: [{ fromSpaceId: 'bed', toSpaceId: 'hall', strength: 'required', reason: 'x' }],
      spaces: [
        { id: 'hall', zone: FUNCTIONAL_ZONES.Circulation },
        { id: 'bed', zone: FUNCTIONAL_ZONES.Night }
      ]
    });

    expect(compliance.summary.total.passed).toBe(0);
    expect(compliance.summary.total.failed).toBe(2);
  });

  it('ignores a rationale that contradicts the facts', () => {
    const compliance = evaluateSpecification({
      specification: specificationFor({
        spaces: ['hall', 'bed'],
        walls: [['hall', 'bed']],
        doors: []
      }),
      intents: [
        {
          fromSpaceId: 'bed',
          toSpaceId: 'hall',
          strength: 'required',
          // The exact sentence BUG-011 records as having been read as a
          // requirement met. It is carried, and it establishes nothing.
          reason: 'Every space opens off the hallway.'
        }
      ],
      spaces: [
        { id: 'hall', zone: FUNCTIONAL_ZONES.Circulation },
        { id: 'bed', zone: FUNCTIONAL_ZONES.Night }
      ]
    });

    expect(compliance.summary.total.passed).toBe(0);
  });
});
