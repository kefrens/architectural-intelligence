/**
 * Programme intents → platform constraints (Sprint 1.8, ArchiSimple ADR-0034).
 *
 * The one place this layer turns what a user asked for into something the
 * authoritative evaluator can answer. It builds input and reads results; it
 * decides no outcome, and it never restates one.
 *
 * ## Why an adapter rather than a second vocabulary
 *
 * `IntendedAdjacency` already carries the whole of the user's intent — the two
 * spaces, the strength, the reason and its provenance (ADR-AI-0003 Rule 4). The
 * evaluator's `SpaceConstraint` is the same intent in the platform's words.
 * Translating is a projection, and a projection is the only honest amount of
 * work here: anything that *added* a requirement would be this layer inventing
 * one, which is what BUG-011 turned out to be.
 *
 * ## The relation each strength becomes (Sprint 1.8, Q2)
 *
 * ADR-0034 §6 splits "these two rooms belong together" into two questions, and
 * an intent has to pick one:
 *
 * ```text
 * required   → traversable-connection    you can walk from one to the other
 * avoid      → traversable-connection    ...and here you must not be able to
 * preferred  → adjacent                  they share a boundary
 * ```
 *
 * `required` and `avoid` are the two strengths ADR-AI-0003 Rule 3 reserves for
 * what a *user* stated, and the reasons the platform's own template carries are
 * about passage — "the entrance reaches the living space without passing through
 * another room". Sharing a wall does not satisfy that sentence. A `preferred`
 * relationship is the weaker wish it sounds like: near, not necessarily joined.
 *
 * **One intent produces exactly one constraint.** Emitting both relations was
 * considered and rejected: two results for one thing the user said is two
 * chances to report it met, and a reader cannot tell which one their sentence
 * became.
 *
 * ## What is read, and what is not
 *
 * Only the pair, the strength and the reason. Never a `satisfied` boolean, never
 * a score, never prose — ADR-0034 §7 forbids evaluation consuming any of them,
 * and the shapes below cannot express one.
 */

import {
  CONSTRAINT_RELATIONS,
  CONSTRAINT_STRENGTHS,
  type ConstraintRelation,
  type ConstraintStrength,
  type SpaceConstraint,
  type SpacePair
} from '@archisimple/skills';
import { ADJACENCY_STRENGTHS, FUNCTIONAL_ZONES } from '../programme/space-programme.js';
import type { FunctionalZone } from '../programme/space-programme.js';

/**
 * The minimum an intent must carry to become a constraint.
 *
 * Structural rather than nominal, because the same intent appears in three
 * artefacts under three names — `IntendedAdjacency` in the Programme,
 * `ResolvedAdjacency` in the Layout, and the Geometry Graph's own — and all
 * three carry these four fields with these meanings. A shared type would have
 * coupled the artefacts to each other for no gain.
 */
export interface ConstraintSource {
  readonly fromSpaceId: string;
  readonly toSpaceId: string;
  /** `required`, `preferred` or `avoid`. */
  readonly strength: string;
  readonly reason: string;
}

/** A space, as constraint-building needs it. */
export interface ConstrainedSpace {
  readonly id: string;
  readonly zone: FunctionalZone | string;
}

/** Q2's table, as code. Adding a row means reopening the decision. */
const RELATION_FOR: Readonly<Record<string, ConstraintRelation>> = Object.freeze({
  [ADJACENCY_STRENGTHS.Required]: CONSTRAINT_RELATIONS.TraversableConnection,
  [ADJACENCY_STRENGTHS.Avoid]: CONSTRAINT_RELATIONS.TraversableConnection,
  [ADJACENCY_STRENGTHS.Preferred]: CONSTRAINT_RELATIONS.Adjacent
});

const STRENGTH_FOR: Readonly<Record<string, ConstraintStrength>> = Object.freeze({
  [ADJACENCY_STRENGTHS.Required]: CONSTRAINT_STRENGTHS.Required,
  [ADJACENCY_STRENGTHS.Avoid]: CONSTRAINT_STRENGTHS.Avoid,
  [ADJACENCY_STRENGTHS.Preferred]: CONSTRAINT_STRENGTHS.Preferred
});

/**
 * The relationship constraints a set of intents states.
 *
 * An intent whose strength is unrecognised is **dropped**, not guessed at: the
 * evaluator refuses a strength outside its vocabulary, and refusing the whole
 * evaluation because one intent was malformed would lose the answer for every
 * other. Nothing is invented in its place.
 */
export function relationshipConstraints(
  intents: readonly ConstraintSource[]
): readonly SpaceConstraint[] {
  return intents
    .filter((intent) => RELATION_FOR[intent.strength] !== undefined)
    .map((intent) => {
      const relation = RELATION_FOR[intent.strength]!;
      return {
        // The pair and the relation together, so two intents over the same rooms
        // stay distinguishable and the id is stable across runs.
        id: `${intent.fromSpaceId}::${intent.toSpaceId}::${relation}`,
        relation,
        strength: STRENGTH_FOR[intent.strength]!,
        subjectSpaceId: intent.fromSpaceId,
        objectSpaceId: intent.toSpaceId,
        // Carried so a failure can quote why the requirement existed. ADR-0034
        // §7 forbids reading it as evidence, and the evaluator does not.
        rationale: intent.reason
      };
    });
}

/**
 * "Every space can be reached from the circulation system", as one constraint
 * per space.
 *
 * The circulation spaces themselves are excluded — a hallway reaching itself is
 * not a requirement anybody stated — and they are the roots instead
 * ({@link circulationRootIds}).
 *
 * This is the only place this layer states a constraint the Programme did not
 * literally write down, and it is precisely the one BUG-011 is about: the
 * sentence *"Every space opens off the hallway."* was printed for every
 * single-storey plan without the system ever holding it as a requirement or
 * testing it. It is stated here so that it can be checked, and from Sprint 1.8
 * it is checked before it is ever said.
 */
export function circulationReachabilityConstraints(
  spaces: readonly ConstrainedSpace[]
): readonly SpaceConstraint[] {
  const roots = new Set(circulationRootIds(spaces));

  return spaces
    .filter((space) => !roots.has(space.id))
    .map((space) => ({
      id: `${space.id}::${CONSTRAINT_RELATIONS.CirculationReachability}`,
      relation: CONSTRAINT_RELATIONS.CirculationReachability,
      strength: CONSTRAINT_STRENGTHS.Required,
      subjectSpaceId: space.id,
      rationale: 'every space is reached from the circulation system'
    }));
}

/**
 * Where reachability starts.
 *
 * The Programme's own circulation zoning, never a guess about which door is the
 * front door. ArchiSimple's Sprint 037.3 entrance audit found an exterior door
 * derivable and an entrance **not** — nothing in the model separates a front
 * door from a patio, balcony, garage or emergency door — and rooting
 * reachability here is what makes an `Entrance` concept unnecessary
 * (ADR-0034 §6.1).
 */
export function circulationRootIds(spaces: readonly ConstrainedSpace[]): readonly string[] {
  return spaces
    .filter((space) => space.zone === FUNCTIONAL_ZONES.Circulation)
    .map((space) => space.id);
}

/** An unordered pair, in the evaluator's shape. */
export function spacePair(aSpaceId: string, bSpaceId: string): SpacePair {
  return { aSpaceId, bSpaceId };
}
