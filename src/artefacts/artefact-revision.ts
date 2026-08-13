/**
 * When regenerating a stage is a revision, and when it is nothing at all
 * (Bug 005).
 *
 * Story 1.3.7 made regeneration a *revision* of the stage a project already
 * holds — same id, next revision — because minting a second artefact splits the
 * lineage. What it did not add is the question that comes first: **did anything
 * actually change?**
 *
 * Without it, an acknowledgement regenerates. The observed conversation shows
 * what that costs. A user typing "ok" made the model call
 * `planning_generateProgramme`, which produced revision 2 of an identical
 * programme; the user approved it; and because `aiServiceProvider` carries one
 * artefact proposal per reply and the programme claimed the slot, the Layout
 * that was generated in the very same turn was **silently dropped**. Repeat, and
 * the pipeline can never advance past the Programme stage. Nothing bypassed an
 * approval gate — every gate held. The churn starved the stage below it.
 *
 * The Brief has answered this since Sprint 1.5: `reviseBriefFromFields` returns
 * `undefined` when nothing moved and the caller answers `NothingToDo`. The four
 * stages below it never got the equivalent. This is that equivalent, written
 * once so all four agree.
 */

import { PLAN_BLOCKER_REASONS, type PlanBlocker } from '../planning/architectural-plan.js';

/**
 * Structural equality, for artefact content.
 *
 * `JSON.stringify` comparison would be shorter and wrong: a revision patch is
 * built field by field, so its key order need not match the artefact it is
 * compared against, and two equal objects would serialise differently. Arrays
 * are order-sensitive on purpose — a programme that lists the same spaces in a
 * different order has changed something a layout planner reads.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((entry, index) => deepEqual(entry, b[index]))
    );
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!deepEqual(left[key], right[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Whether a freshly synthesised patch says anything the approved artefact does
 * not already say.
 *
 * Compares only the keys the patch carries, which is exactly the set of fields
 * a revision is allowed to change — so this cannot be fooled by `revision` or
 * `createdAt` differing, and cannot silently ignore a field somebody adds to a
 * patch later.
 *
 * **Identity must already be stable** for this to mean anything. A synthesis
 * that mints a fresh uuid per space produces a patch that never equals its
 * predecessor, so the caller reconciles ids first — see
 * `withPreviousSpaceIds` in `programme/space-programme.ts`.
 */
export function changesAnything<T extends object>(previous: T, patch: Partial<T>): boolean {
  const held = previous as Record<string, unknown>;
  return Object.entries(patch).some(([key, value]) => !deepEqual(held[key], value));
}

/**
 * What a regeneration answers when the stage already says exactly that.
 *
 * The suggestion names the **next** stage rather than offering a vague retry.
 * This blocker's whole job is to be read by a model that has just been told
 * "ok" and is looking for something to call, and the observed failure was a
 * model with no better idea than to regenerate what it had. Telling it where to
 * go is the difference between a loop and a pipeline.
 */
export function nothingToRegenerate(input: {
  /** How this stage names itself in a sentence: "space programme", "layout". */
  readonly stage: string;
  /** What to ask for next, or `undefined` at the end of the pipeline. */
  readonly nextStage?: string;
}): PlanBlocker {
  return {
    reason: PLAN_BLOCKER_REASONS.NothingToDo,
    message: `The ${input.stage} already says that, so there is nothing to revise.`,
    suggestions:
      input.nextStage === undefined
        ? [`Tell me what should change about the ${input.stage}.`]
        : [
            `Ask for the ${input.nextStage} — that is the next step.`,
            `Or tell me what should change about the ${input.stage}.`
          ]
  };
}
