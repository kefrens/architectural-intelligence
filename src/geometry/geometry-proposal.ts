/**
 * A Geometry Graph, offered for approval (Sprint 28.1a, Epic 7 —
 * ADR-0027.1 Rule 7).
 *
 * The fourth twin of `brief/brief-proposal.ts`, and by now the pattern is the
 * whole return on Sprint 27.8's `Proposal` generalisation: a fourth planning
 * artefact reached the approval gate with no second approval surface, no second
 * store, no second confirmation rule and no change to `ai-engine`. All this
 * sprint added was a label.
 *
 * The evaluation is folded into the explanation rather than into the artefact
 * (`geometry-evaluation.ts` says why), so a reviewer sees the state of the
 * geometry *as it stands at the moment of review*.
 */

import { createArtefactProposal, type Proposal } from '@archisimple/ai-engine';
import { contributionNotes } from '../artefacts/enriched-artefact.js';
import {
  GEOMETRY_GRAPH_KIND,
  isGeometryGraphComplete,
  summarizeGeometryGraph,
  type GeometryGraph
} from './geometry-graph.js';
import { describeEvaluation, evaluateGeometryGraph } from './geometry-evaluation.js';

const EXPECTED_OUTCOME =
  'The geometry is recorded with the project. Still no walls: the next step gives these edges thickness and builds them.';

export interface ToGeometryProposalOptions {
  readonly expected: readonly { readonly spaceId: string; readonly instances: number }[];
}

export function toGeometryProposal(
  graph: GeometryGraph,
  options: ToGeometryProposalOptions
): Proposal {
  if (!isGeometryGraphComplete(graph)) {
    throw new Error('An empty geometry graph cannot be proposed for approval.');
  }

  const evaluation = evaluateGeometryGraph(graph, { expected: options.expected });

  return createArtefactProposal({
    artefact: {
      kind: GEOMETRY_GRAPH_KIND,
      id: graph.id,
      revision: graph.revision,
      value: graph
    },
    title: graph.revision === 1 ? 'Geometry' : `Geometry (revision ${graph.revision})`,
    explanation: `${summarizeGeometryGraph(graph)}\n\n${describeEvaluation(evaluation)}`,
    reasoning:
      'This turns the approved layout into rooms with real dimensions — still without walls, so the shapes can be judged before anything is built from them.',
    // Sprint 28.3: what an installed extension added is named beside
    // what the platform assumed, in the same list the user already reads.
    assumptions: [...graph.assumptions, ...contributionNotes(graph)],
    warnings: graph.warnings,
    expectedOutcome: EXPECTED_OUTCOME
  });
}

/**
 * The message that accompanies the proposal.
 *
 * Short, like the three before it: the card lists every room by storey and
 * states what is guaranteed against what can be improved, so the message carries
 * only the two numbers a user checks first.
 */
export function describeGeometry(graph: GeometryGraph): string {
  const rooms = graph.polygons.length;
  const area = Math.round(
    graph.polygons.reduce((total, polygon) => total + polygon.achievedArea, 0)
  );

  return [
    `I have laid out ${rooms} room${rooms === 1 ? '' : 's'} across ${graph.storeys === 1 ? 'a single storey' : `${graph.storeys} storeys`}, about ${area} m² in all.`,
    '',
    'Review it below. Approving records it with the project; no walls are built until you do.'
  ].join('\n');
}
