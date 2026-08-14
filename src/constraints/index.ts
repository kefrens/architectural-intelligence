/**
 * Constraint adaptation (Sprint 1.8, ArchiSimple ADR-0034).
 *
 * This layer proposes intent; ArchiSimple evaluates reality. The directory is
 * the seam between those two sentences: it turns a Programme's intents into the
 * platform's `SpaceConstraint`s and hands them to `constraints.evaluate`.
 *
 * It carries **no artefact types**, deliberately. Every function here takes the
 * structural minimum it needs, so the same adapter serves the Programme, the
 * Layout Plan and the Geometry Specification without any of them importing the
 * others through it — and without this directory importing them back.
 */

export {
  circulationReachabilityConstraints,
  circulationRootIds,
  relationshipConstraints,
  spacePair,
  type ConstrainedSpace,
  type ConstraintSource
} from './constraint-adapter.js';
