/**
 * A Space Programme, offered for approval (Sprint 27.9, Story 27.9.3 —
 * ADR-0027.1 Rule 7).
 *
 * The exact twin of `brief/brief-proposal.ts`, and that it *is* a twin is the
 * whole return on Sprint 27.8's `Proposal` generalisation: a second planning
 * artefact reached the approval gate without a second approval surface, a second
 * store, or a second confirmation rule. The only thing this sprint had to add
 * was a label.
 */

import { createArtefactProposal, type Proposal } from '@archisimple/ai-engine';
import { contributionNotes } from '../artefacts/enriched-artefact';
import {
  isProgrammeComplete,
  SPACE_PROGRAMME_KIND,
  summarizeProgramme,
  type SpaceProgramme
} from './space-programme';

const EXPECTED_OUTCOME =
  'The programme is recorded with the project. Still nothing is drawn: the next step arranges these spaces into a layout.';

export function toProgrammeProposal(programme: SpaceProgramme): Proposal {
  if (!isProgrammeComplete(programme)) {
    throw new Error('An empty space programme cannot be proposed for approval.');
  }

  return createArtefactProposal({
    artefact: {
      kind: SPACE_PROGRAMME_KIND,
      id: programme.id,
      revision: programme.revision,
      value: programme
    },
    title:
      programme.revision === 1
        ? 'Space programme'
        : `Space programme (revision ${programme.revision})`,
    explanation: summarizeProgramme(programme),
    reasoning:
      'This turns the approved brief into the building itself — which spaces exist, how large each should be, and which belong together — while there is still nothing to redraw.',
    // Sprint 28.3: what an installed extension added is named beside
    // what the platform assumed, in the same list the user already reads.
    assumptions: [...programme.assumptions, ...contributionNotes(programme)],
    warnings: programme.warnings,
    expectedOutcome: EXPECTED_OUTCOME
  });
}

/**
 * The message that accompanies the proposal.
 *
 * Short, like the Brief's: the card below already lists every space, its area
 * and its zone. What the message adds is the two numbers a user checks first —
 * how many rooms, and how big in total.
 */
export function describeProgramme(programme: SpaceProgramme): string {
  const rooms = programme.spaces.reduce((total, space) => total + space.count, 0);

  return [
    `I have written a space programme from the approved brief — ${rooms} space${rooms === 1 ? '' : 's'}, about ${programme.totalArea} m² in total.`,
    '',
    'Review it below. Approving records it with the project; nothing is drawn until you do.'
  ].join('\n');
}
