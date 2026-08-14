/**
 * Evaluating a Geometry Graph (Sprint 28.1a, Epic 4 — artefact layer).
 *
 * A thin wrapper, deliberately. Every clause of the Geometry Packing Contract
 * lives in `@archisimple/skills`' `geometry.evaluatePacking`; this file maps the
 * artefact onto the plain shape a skill can take, and formats the result.
 *
 * The balance is shifted *down* on purpose. Sprint 28.0's
 * `computeLayoutQuality` did real work above the skill; here the package
 * function does almost none, because Sprint 28.1b exports the rules as a
 * conformance suite (`runPackingConformance`) and a plugin author writing a
 * packing strategy tests against them without depending on the whole reasoning
 * layer.
 *
 * ## Never stored
 *
 * `evaluateGeometryGraph` is called on demand and its result is never a field on
 * the artefact. Elevating evaluation to a first-class concept must not be read
 * as licence to persist it: it is a view of an artefact at a moment, and
 * constraint optimisation revising the graph is precisely the moment a stored
 * one would be wrong.
 */

import { createSkillContext, evaluatePacking, type PackingEvaluation } from '@archisimple/skills';
import type { GeometryGraph } from './geometry-graph.js';

const SKILL_CONTEXT = createSkillContext();

export interface EvaluateGeometryGraphOptions {
  /**
   * Every space the Layout Plan contained, and how many instances each needs.
   *
   * Passed in rather than derived from the graph, because `I1` asks "did the
   * packer keep everything the layout required" — and a space it dropped would
   * be missing from both sides. Deriving the denominator from the numerator
   * would make the clause read satisfied forever, which is exactly the
   * regression it exists to catch.
   */
  readonly expected: readonly { readonly spaceId: string; readonly instances: number }[];
}

export function evaluateGeometryGraph(
  graph: GeometryGraph,
  options: EvaluateGeometryGraphOptions
): PackingEvaluation {
  const result = evaluatePacking.execute(
    {
      polygons: graph.polygons.map((polygon) => ({
        polygonId: polygon.id,
        spaceId: polygon.spaceId,
        name: polygon.name,
        storey: polygon.storey,
        corners: polygon.corners,
        requestedArea: polygon.requestedArea,
        achievedArea: polygon.achievedArea
      })),
      adjacencies: graph.adjacencies.map((adjacency) => ({
        fromSpaceId: adjacency.fromSpaceId,
        toSpaceId: adjacency.toSpaceId,
        strength: adjacency.strength,
        relation: adjacency.relation,
        reason: adjacency.reason
      })),
      storeys: graph.storeys,
      expected: options.expected
    },
    SKILL_CONTEXT
  );

  // A skill failure means the artefact is malformed at a level below the
  // clauses — an empty polygon list, a nonsensical storey count. Reporting every
  // invariant as unsatisfied is the honest answer: nothing could be checked, so
  // nothing can be claimed, and the gate refuses.
  return result.ok
    ? result.value
    : {
        invariants: [
          {
            id: 'I1',
            summary: result.failure.message,
            satisfied: false,
            offending: [result.failure.message]
          }
        ],
        valid: false,
        objectives: []
      };
}

/**
 * The evaluation as markdown, for the review card.
 *
 * **Presentation only.** It computes nothing — the same evaluation always
 * produces the same text, whichever graph it came from — which is what keeps
 * there being exactly one implementation of every clause.
 *
 * The invariant/objective split is the point. A bare adjacency score reads as a
 * failure; *"everything that must hold does, and two things can be improved"*
 * reads as what an intermediate artefact is. The wording names a **capability**,
 * never a sprint: a card that advertises unbuilt work stops being true the
 * moment that work moves.
 */
export function describeEvaluation(evaluation: PackingEvaluation): string {
  const lines: string[] = [];

  const failed = evaluation.invariants.filter((invariant) => !invariant.satisfied);
  if (failed.length === 0) {
    // Sprint 28.1b lifted 28.1a's restriction on this sentence. Until the
    // conformance suite shipped, "whatever produced it" was a claim about the
    // built-in packer asserted in a test; now the same clauses are published,
    // runnable by a third party, and checked at synthesis for every strategy.
    lines.push(
      `**Guaranteed** — all ${evaluation.invariants.length} structural requirements hold, whatever produced this geometry: every room placed, none overlapping, every floor connected. Any packing strategy is held to the same published contract.`
    );
  } else {
    lines.push('**Not satisfied**');
    for (const invariant of failed) {
      lines.push(`- ${invariant.id} ${invariant.summary}: ${invariant.offending.join('; ')}`);
    }
  }
  lines.push('');

  // BUG-012 Finding 1: a percentage here reads as a compliance measurement, and
  // this stage is not where one exists — ADR-0034's evaluator has no
  // Geometry Graph row (no openings exist yet to decide adjacency or
  // reachability from), so a score computed here can only be a packing
  // heuristic. Showing it as "adjacency — 100%" beside the Specification
  // stage's later, authoritative "6 of 8 requirements met" is exactly the
  // two-sources-of-truth confusion ADR-0034 exists to end. What survives is
  // the qualitative miss, with no numeric claim attached to it.
  const improvable = evaluation.objectives.filter((objective) => objective.misses.length > 0);
  if (improvable.length > 0) {
    lines.push('**Can be improved**');
    for (const objective of improvable) {
      lines.push(`- ${objective.summary}`);
      for (const miss of objective.misses) {
        lines.push(`  - ${miss}`);
      }
    }
    lines.push(
      '',
      'These are improved by constraint optimisation, which reshapes this geometry without changing the approved layout.'
    );
  }

  return lines.join('\n').trimEnd();
}
