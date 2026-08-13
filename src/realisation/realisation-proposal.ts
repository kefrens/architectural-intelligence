/**
 * The approved design, offered to be built (Sprint 1.6 — BUG-008 Phase 3;
 * ArchiSimple ADR-0032 revision 2.2).
 *
 * The sixth proposal this package builds, and the first that is not an artefact.
 * The five above it end with "approving records this with the project"; this one
 * ends with something being **built**, by the host, through the one realisation
 * path ADR-0032 revision 2.2 fixes in place.
 *
 * ## What it carries, and what it therefore cannot do
 *
 * `{ specificationId, revision }`. An identity, never a plan. There is no Build
 * Plan here, no wall, no opening, no `CommandRequest` and no callback — not
 * because this file is careful, but because that is the whole of the subject
 * `ai-engine` accepts. The host resolves the identity against its current state
 * and invokes its existing realisation capability; whether the design *may* be
 * built is its decision and not this package's.
 *
 * ## Why the identity comes from the workflow projection
 *
 * Not from the Specification value, and never from anything the user or a model
 * said (ADR-0027.1 Rule 6). `ArchitecturalStageState.approved` is the identity
 * the host's registry holds, arriving through the one derivation the classifier
 * and the context fragment already read (ADR-AI-0002 Rule 8). One answer to
 * "which design is in force", not three.
 *
 * ## What it does not claim
 *
 * That anything has been built. This package cannot observe realisation at all
 * (ADR-AI-0002 revision 1.3, extension to Rule 2), so the proposal describes what
 * approving it *will ask for*, and the outcome comes back from the host as the
 * proposal's execution result. BUG-008 is what the other habit cost.
 */

import { createRealisationProposal, type Proposal } from '@archisimple/ai-engine';

/** The two fields the host's realisation subject is keyed on. */
export interface RealisationSubject {
  readonly specificationId: string;
  readonly revision: number;
}

const EXPECTED_OUTCOME =
  'The approved design appears in the drawing as walls, openings and named rooms. One undo removes all of it.';

export function toRealisationProposal(subject: RealisationSubject): Proposal {
  return createRealisationProposal({
    realisation: subject,
    title:
      subject.revision === 1
        ? 'Build the approved design'
        : `Build the approved design (revision ${subject.revision})`,
    explanation:
      'Building the approved geometry specification: its walls, openings and named rooms are created in one step.',
    reasoning:
      'The specification is approved and current, so the design is settled and nothing further has to be decided before it is built. Approving this asks the application to build it; it checks whether the design can be built and reports what happened.',
    expectedOutcome: EXPECTED_OUTCOME
  });
}

/**
 * The message that accompanies the proposal.
 *
 * Deliberately in the future tense throughout. An assistant that says "I have
 * built it" beside a proposal awaiting approval is BUG-008 with better
 * punctuation.
 */
export function describeRealisation(subject: RealisationSubject): string {
  return [
    `Revision ${subject.revision} of the geometry specification is approved and has not been built yet.`,
    '',
    'Review the proposal below. Approving it asks the application to build the design — nothing is drawn until you do, and nothing here decides whether it can be.'
  ].join('\n');
}
