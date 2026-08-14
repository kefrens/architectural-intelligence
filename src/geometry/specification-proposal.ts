/**
 * A Geometry Specification, offered for approval (Sprint 1.1, Story 1.1.3 —
 * ADR-AI-0001 Rule 10).
 *
 * The fifth twin of `brief/brief-proposal.ts`, and the last one. A fifth
 * planning artefact reaches the approval gate with no second approval surface,
 * no second store, no second confirmation rule and no change to `ai-engine`.
 *
 * ## What approval means here, and what it does not
 *
 * It records the specification with the project. **It builds nothing.** Turning
 * this into walls is a consuming application's job, through its own translator
 * and its own commands (ADR-0031), and this repository has no way to do it even
 * if it wanted to — it holds no dispatcher and imports no Runtime.
 *
 * Saying that in `expectedOutcome` matters more here than at any stage above,
 * because this is the first artefact that *looks* buildable. A user reading
 * "walls, 300 mm, 2.75 m high" will reasonably assume something is about to be
 * drawn, and it is not.
 */

import { createArtefactProposal, type Proposal } from '@archisimple/ai-engine';
import { contributionNotes } from '../artefacts/enriched-artefact.js';
import {
  describeSpecificationCompliance,
  type SpecificationCompliance
} from './specification-compliance.js';
import {
  GEOMETRY_SPECIFICATION_KIND,
  isGeometrySpecificationComplete,
  summarizeGeometrySpecification,
  type GeometrySpecification
} from './geometry-specification.js';

const EXPECTED_OUTCOME =
  'The specification is recorded with the project. Nothing is built from it here: turning it into walls belongs to the application that consumes it.';

export function toGeometrySpecificationProposal(
  specification: GeometrySpecification,
  /**
   * The evaluator's verdict on this Specification (Sprint 1.8).
   *
   * Optional so a caller with no Programme to check against still gets a
   * proposal — and **absent means the card says nothing about compliance**,
   * never that it complied.
   */
  compliance?: SpecificationCompliance
): Proposal {
  if (!isGeometrySpecificationComplete(specification)) {
    throw new Error('An empty geometry specification cannot be proposed for approval.');
  }

  return createArtefactProposal({
    artefact: {
      kind: GEOMETRY_SPECIFICATION_KIND,
      id: specification.id,
      revision: specification.revision,
      value: specification
    },
    title:
      specification.revision === 1
        ? 'Geometry specification'
        : `Geometry specification (revision ${specification.revision})`,
    explanation:
      compliance === undefined
        ? summarizeGeometrySpecification(specification)
        : `${summarizeGeometrySpecification(specification)}\n\n${describeSpecificationCompliance(compliance, specification)}`,
    reasoning:
      'This gives the approved geometry real walls — thickness, height and openings — so the design is complete enough for a CAD application to build without deciding anything further.',
    // Sprint 28.3: what an installed extension added is named beside what the
    // platform assumed, in the same list the user already reads.
    assumptions: [...specification.assumptions, ...contributionNotes(specification)],
    // BUG-012 Finding 3: approving a Specification only records it — it is not
    // this stage's place to decide what a failing evaluation should mean for
    // approval (that is the next ADR's question, not this one's). What this
    // stage can do honestly today is make sure "recorded" is never the only
    // thing said about a specification that did not satisfy the programme, so
    // a shortfall stays visible through the same warnings list the card
    // already renders next to the approval outcome, not tucked inside prose
    // the eye skips.
    warnings: [...specification.warnings, ...complianceWarnings(compliance)],
    expectedOutcome: EXPECTED_OUTCOME
  });
}

/**
 * Whether this compliance verdict deserves a warning on the proposal card.
 *
 * Empty when there is nothing to check, and empty when every stated
 * requirement passed — a warning that always fires would be noise, and the
 * point is to surface the one case the card would otherwise understate.
 * Deliberately just a warning: it does not withhold `expectedOutcome`, refuse
 * the proposal, or otherwise change what approving it does (BUG-012 Finding 3
 * is explicit that this bug does not decide FAIL semantics).
 */
function complianceWarnings(compliance: SpecificationCompliance | undefined): readonly string[] {
  if (compliance === undefined) {
    return [];
  }
  const { total } = compliance.summary;
  if (total.stated === 0 || total.passed === total.evaluated) {
    return [];
  }
  return [
    `This design does not yet satisfy the programme in full — ${total.passed} of ${total.evaluated} requirements met. Approving records it as evaluated, not as complete.`
  ];
}

/**
 * The message that accompanies the proposal.
 *
 * Two numbers and a sentence about what approval does not do. The card carries
 * the detail; repeating it here would make the conversation harder to read, not
 * easier.
 */
export function describeSpecification(specification: GeometrySpecification): string {
  const walls = specification.walls.length;
  const openings = specification.openings.length;

  return [
    `The design is complete: ${walls} ${walls === 1 ? 'wall' : 'walls'} with real thickness and height, and ${openings} ${openings === 1 ? 'opening' : 'openings'} through them.`,
    '',
    'Review it below. Approving records it with the project — no walls are drawn here; that is the CAD application’s side of the contract.'
  ].join('\n');
}
