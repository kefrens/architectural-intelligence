/**
 * Does the Specification satisfy the Programme? (Sprint 1.8, ArchiSimple ADR-0034.)
 *
 * **The first stage in this pipeline that can answer that question, and the
 * first place a real PASS or FAIL is rendered to a user.**
 *
 * ## Why not earlier
 *
 * Brief, Programme and Layout own no geometry at all, and the Geometry Graph
 * owns coordinates but no openings. The three relations ADR-0034 §6 fixes need
 * boundaries and doorways to decide, so every stage above this one returns
 * `NOT_APPLICABLE` — honestly, and by the evaluator's own stage table rather
 * than by anything this file decides.
 *
 * BUG-011 is what claiming otherwise cost: a Layout review card reporting
 * "Required adjacencies met: 100%" over a plan whose bedroom had no door to the
 * hallway. The claim came four stages before anything could have checked it.
 *
 * ## What it evaluates against
 *
 * The Specification's **own** openings and walls. `SpecifiedOpening.connects`
 * already names the two spaces an opening joins, and `kind` is already `door`
 * or `passage` — the same two `@archisimple/spatial` treats as traversable at
 * the built stage. So the traversable-connection relation is a projection of a
 * field this artefact has carried since Sprint 1.1; nothing new is modelled, and
 * this layer acquires no dependency on a built model it never sees.
 *
 * ## What it does not do
 *
 * It computes no outcome. Every verdict below comes from `constraints.evaluate`,
 * which is the single authority ADR-0034 §4 requires — this file builds input,
 * reads results, and renders them.
 */

import {
  createSkillContext,
  evaluateConstraints,
  summariseConstraintResults,
  CONSTRAINT_OUTCOMES,
  CONSTRAINT_REASON_CODES,
  CONSTRAINT_RELATIONS,
  EVALUATION_STAGES,
  type ConstraintEvaluationSummary,
  type ConstraintResult,
  type SpacePair
} from '@archisimple/skills';
import {
  circulationReachabilityConstraints,
  circulationRootIds,
  relationshipConstraints,
  spacePair,
  type ConstrainedSpace,
  type ConstraintSource
} from '../constraints/index.js';
import type { GeometrySpecification } from './geometry-specification.js';

const SKILL_CONTEXT = createSkillContext();

export interface SpecificationCompliance {
  readonly summary: ConstraintEvaluationSummary;
  readonly results: readonly ConstraintResult[];
  /** Only the failures, in evaluation order — what a reviewer reads first. */
  readonly failures: readonly ConstraintResult[];
}

export interface EvaluateSpecificationInput {
  readonly specification: GeometrySpecification;
  /**
   * The relationships the Programme stated, carried through the Layout and the
   * Graph. Structural rather than an artefact type, so this function does not
   * pull three artefacts into one signature.
   */
  readonly intents: readonly ConstraintSource[];
  /** Every space, with its zone — the roots come from the circulation ones. */
  readonly spaces: readonly ConstrainedSpace[];
}

/**
 * Evaluates one Specification against the relationships the Programme asked for.
 *
 * A skill failure yields an empty compliance rather than a thrown error: the
 * Specification is still reviewable, and reporting nothing is honest where
 * reporting a fabricated verdict would not be.
 */
export function evaluateSpecification(input: EvaluateSpecificationInput): SpecificationCompliance {
  // **Programme** space ids, not polygon ids. A space with `count: 2` becomes
  // two `SpecifiedSpace` rows sharing one `spaceId`, and constraints name the
  // space — so the fact base must too, deduplicated.
  const known = new Set(input.specification.spaces.map((space) => space.spaceId));
  const spaceIds = [...known];

  const constraints = [
    ...relationshipConstraints(input.intents),
    ...circulationReachabilityConstraints(input.spaces.filter((space) => known.has(space.id)))
  ];

  const evaluated = evaluateConstraints.execute(
    {
      stage: EVALUATION_STAGES.GeometrySpecification,
      constraints,
      facts: {
        spaceIds,
        adjacentPairs: adjacentPairsOf(input.specification),
        traversablePairs: traversablePairsOf(input.specification)
      },
      circulationRootSpaceIds: circulationRootIds(input.spaces).filter((id) => known.has(id))
    },
    SKILL_CONTEXT
  );

  if (!evaluated.ok) {
    return {
      summary: summariseConstraintResults(EVALUATION_STAGES.GeometrySpecification, []),
      results: [],
      failures: []
    };
  }

  return {
    summary: evaluated.value.summary,
    results: evaluated.value.results,
    failures: evaluated.value.results.filter(
      (result) => result.outcome === CONSTRAINT_OUTCOMES.Fail
    )
  };
}

/**
 * Which spaces share a boundary, from the walls the Specification contains.
 *
 * A wall separating two spaces is the shared-boundary relation, and
 * `SpecifiedWall.separates` already records it — the same field
 * `validateGeometrySpecification` checks the cardinality of.
 *
 * ## Two id spaces, and they are not the same one
 *
 * `separates` names **polygon** ids, while `SpecifiedOpening.connects` names
 * **programme space** ids — a distinction that survives because a space with
 * `count: 2` becomes two polygons. Constraints name programme spaces, so the
 * wall pairs are translated through `SpecifiedSpace`, which carries both.
 *
 * A polygon with no space is skipped rather than passed through: an id from the
 * wrong vocabulary would look to the evaluator like a space that does not exist,
 * and be reported as a failure of the design rather than of this translation.
 */
function adjacentPairsOf(specification: GeometrySpecification): readonly SpacePair[] {
  const spaceOfPolygon = new Map(
    specification.spaces.map((space) => [space.id, space.spaceId] as const)
  );
  const pairs = new Map<string, SpacePair>();

  for (const wall of specification.walls) {
    const [firstPolygon, secondPolygon] = wall.separates;
    if (firstPolygon === undefined || secondPolygon === undefined) {
      continue;
    }

    const a = spaceOfPolygon.get(firstPolygon);
    const b = spaceOfPolygon.get(secondPolygon);
    // Two polygons of the *same* space share a wall without that being a
    // relationship between two spaces; `a === b` drops it.
    if (a === undefined || b === undefined || a === b) {
      continue;
    }

    pairs.set(key(a, b), spacePair(a, b));
  }

  return [...pairs.values()];
}

/**
 * Which spaces a person can pass directly between.
 *
 * Every `SpecifiedOpening` is traversable, and that is a property of this
 * artefact rather than an assumption: `OpeningKind` is `door | passage` and has
 * no `window` — a Specification does not describe glazing. The same two kinds
 * are what `@archisimple/spatial` treats as traversable at the built stage, and
 * the two agree because they are the same rule, not because either read the
 * other.
 *
 * So the filter here is on the pair, not the kind: an opening whose `connects`
 * names one space twice joins nothing.
 */
function traversablePairsOf(specification: GeometrySpecification): readonly SpacePair[] {
  const pairs = new Map<string, SpacePair>();

  for (const opening of specification.openings) {
    const [a, b] = opening.connects;
    if (a === b) {
      continue;
    }
    pairs.set(key(a, b), spacePair(a, b));
  }

  return [...pairs.values()];
}

function key(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Compliance as markdown, for the review card.
 *
 * The first card in the pipeline permitted to say a requirement was met — and it
 * says it only because the evaluator established it. Counts show their
 * denominator (ADR-0034 §5), failures are named individually, and
 * `not applicable` is reported separately rather than folded into either side.
 *
 * The `specification` is taken only to translate a failure's space ids into the
 * names a reviewer already reads elsewhere on the card (BUG-012 Finding 2). The
 * evaluator stays id-based — `failure.reason` still carries the raw ids, and
 * nothing here recomputes or second-guesses its verdict, only how it reads.
 */
export function describeSpecificationCompliance(
  compliance: SpecificationCompliance,
  specification: GeometrySpecification
): string {
  const { total } = compliance.summary;

  if (total.stated === 0) {
    return [
      '**Programme requirements**',
      'The programme stated no relationships, so there was nothing to check.'
    ].join('\n');
  }

  const lines = [
    '**Programme requirements**',
    `- Met: ${total.passed} of ${total.evaluated} checked`
  ];

  if (total.notApplicable > 0) {
    lines.push(`- Could not be checked here: ${total.notApplicable}`);
  }

  for (const failure of compliance.failures) {
    lines.push(`- ${describeFailure(failure, specification)}`);
  }

  return lines.join('\n');
}

/**
 * One failure, in words a reviewer reads without needing the evaluator's ids.
 *
 * Built from the constraint's structured fields (`subjectSpaceId`,
 * `objectSpaceId`, `relation`, `reasonCode`) rather than by editing
 * `failure.reason` — the evaluator's own sentence is not a template this layer
 * should parse. Circulation roots are named collectively as "the circulation"
 * rather than resolved one by one: which spaces root reachability is an
 * evaluator detail, not something a reviewer needs named to act on the failure.
 */
function describeFailure(failure: ConstraintResult, specification: GeometrySpecification): string {
  const { constraint, reasonCode } = failure;
  const subject = nameOf(specification, constraint.subjectSpaceId);

  switch (reasonCode) {
    case CONSTRAINT_REASON_CODES.Unreachable:
      return `${subject} cannot be reached from the circulation.`;

    case CONSTRAINT_REASON_CODES.RelationAbsent: {
      const object = nameOf(specification, constraint.objectSpaceId!);
      return constraint.relation === CONSTRAINT_RELATIONS.Adjacent
        ? `${subject} and ${object} do not share a wall.`
        : `${subject} has no doorway or opening connecting it to ${object}.`;
    }

    case CONSTRAINT_REASON_CODES.RelationProhibited: {
      const object = nameOf(specification, constraint.objectSpaceId!);
      return constraint.relation === CONSTRAINT_RELATIONS.Adjacent
        ? `${subject} and ${object} share a wall, and were meant to be kept apart.`
        : `${subject} and ${object} are connected by an opening, and were meant to be kept apart.`;
    }

    case CONSTRAINT_REASON_CODES.UnknownSpace:
      // A space the constraint names is absent from this Specification's own
      // space list — an internal-consistency failure rather than a design one.
      // There is no name to resolve it to, so this stays generic on purpose.
      return 'A space the programme named is missing from this design.';

    default:
      // PASS/NOT_APPLICABLE reason codes never reach `compliance.failures`
      // (filtered to `CONSTRAINT_OUTCOMES.Fail` above); this is unreachable in
      // practice and falls back to the evaluator's own sentence rather than
      // throwing if that ever changes.
      return failure.reason;
  }
}

/**
 * A space id, resolved to what a reviewer reads elsewhere on the card.
 *
 * A Programme space with `count > 1` becomes several `SpecifiedSpace` rows
 * sharing one `spaceId` (ADR-0034 §17.1's repeated-space identity is deferred,
 * not modelled here) — so more than one name can answer to the same id. Rather
 * than guess which instance the evaluator meant, an ambiguous id falls back to
 * its generic form ("a bedroom") instead of picking one name arbitrarily.
 */
function nameOf(specification: GeometrySpecification, spaceId: string): string {
  const matches = specification.spaces.filter((space) => space.spaceId === spaceId);
  if (matches.length === 0) {
    return 'A space';
  }
  if (matches.length === 1) {
    return matches[0]!.name;
  }
  return genericNameOf(matches[0]!.name);
}

/** "Bedroom 2" → "a bedroom". Falls back to the name itself if it carries no instance suffix. */
function genericNameOf(name: string): string {
  const singular = name.replace(/\s+\d+$/, '').trim() || name;
  const article = /^[aeiou]/i.test(singular) ? 'an' : 'a';
  return `${article} ${singular.toLowerCase()}`;
}
