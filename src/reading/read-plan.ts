/**
 * A page becomes observations, and stops there (Sprint 1.9; ADR-0044
 * revision 1.1 Rules 1, 3, 4, 5).
 *
 * ```text
 * page raster ──▶ instruction ──▶ [ host's port ] ──▶ structured reply
 *                                                          │
 *                                                          ▼
 *                                                  PlanReading, or a blocker
 * ```
 *
 * ## Where this stops, and why the stop is the design
 *
 * At observations. It assembles **no artefact** — the Geometry Graph is composed
 * by the host, field by field, from these (Rule 3, ArchiSimple Sprint 046.7). It
 * produces **no `Proposal`**: a proposal is what the host makes of a reading, and
 * ADR-0027.1 Rule 7's one approval mechanism stays one.
 *
 * It computes **nothing**. Not a length, not an angle, not an area, not an
 * association. All six of those are Skills that already exist and are already
 * proven (ArchiSimple Sprint 046.6), and Rule 9 puts them there rather than here
 * and *emphatically* rather than in the model.
 *
 * ## Not a Tool, and not a lane
 *
 * **Not a Tool**, because a Tool is something a model calls, and a model calling
 * "read this drawing" is circular — the drawing is what it is being shown.
 *
 * **Not a lane.** The nine lanes classify an *utterance*. This is not one: nobody
 * typed anything and there is nothing to disambiguate. The host has a page and
 * wants it read. Routing it through the classifier would mean inventing a
 * sentence to classify, and invented plumbing reads as a feature later.
 *
 * It is a capability the host asks for directly.
 */

import {
  PLAN_OBSERVATION_KINDS,
  type ObservedPoint,
  type PlanObservation,
  type PlanReading
} from '@archisimple/ai-engine';
import { PLAN_BLOCKER_REASONS, type PlanBlocker } from '../planning/index.js';
import { planReadingInstruction } from './plan-reading-prompt.js';
import type { PlanVisionImage, PlanVisionPort } from './plan-vision-port.js';

/**
 * How sure an observation must be to be used.
 *
 * The same 0.8 the host's `judgeObservations` applies (ArchiSimple Sprint
 * 046.4). Stated here because a reading is refused *before* it travels, and a
 * caller that never sees a low-confidence observation cannot accidentally act
 * on one (Rule 5 — low confidence is a blocker, not a guess).
 */
export const READING_CONFIDENCE_THRESHOLD = 0.8;

export interface ReadPlanRequest {
  readonly image: PlanVisionImage;
  /** Which page this is, carried through so a reading can be placed. */
  readonly pageIndex: number;
}

export type ReadPlanOutcome =
  | { readonly ok: true; readonly reading: PlanReading }
  | { readonly ok: false; readonly blocker: PlanBlocker };

const blocked = (
  reason: PlanBlocker['reason'],
  message: string,
  suggestions: readonly string[]
): ReadPlanOutcome => ({ ok: false, blocker: { reason, message, suggestions } });

const isPoint = (value: unknown): value is ObservedPoint => {
  const point = value as { x?: unknown; y?: unknown } | null;
  return (
    point !== null &&
    typeof point === 'object' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
};

const isConfidence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * One entry of the reply, or `undefined` if it is not an observation.
 *
 * Every field is checked. A reply is a model's output, so "it has a `kind`,
 * therefore the rest is there" is not a safe read — and an observation missing
 * a coordinate would place a wall at `NaN`, which draws nothing and reports
 * success.
 *
 * **Unknown fields are dropped rather than carried.** A model that volunteers a
 * `length` is offering a number Rule 4 forbids, and letting it through the
 * boundary because the type does not mention it is how it ends up read by
 * something later.
 */
function toObservation(entry: unknown): PlanObservation | undefined {
  const value = entry as Record<string, unknown> | null;
  if (value === null || typeof value !== 'object' || !isConfidence(value.confidence)) {
    return undefined;
  }
  const confidence = value.confidence;

  if (value.kind === PLAN_OBSERVATION_KINDS.Wall && isPoint(value.from) && isPoint(value.to)) {
    return {
      kind: PLAN_OBSERVATION_KINDS.Wall,
      from: { x: value.from.x, y: value.from.y },
      to: { x: value.to.x, y: value.to.y },
      confidence
    };
  }
  if (
    value.kind === PLAN_OBSERVATION_KINDS.Opening &&
    isPoint(value.from) &&
    isPoint(value.to) &&
    typeof value.symbol === 'string'
  ) {
    return {
      kind: PLAN_OBSERVATION_KINDS.Opening,
      from: { x: value.from.x, y: value.from.y },
      to: { x: value.to.x, y: value.to.y },
      symbol: value.symbol,
      confidence
    };
  }
  if (
    value.kind === PLAN_OBSERVATION_KINDS.Text &&
    isPoint(value.at) &&
    typeof value.text === 'string'
  ) {
    // Exactly as read. Not trimmed of its unit, not normalised, not parsed.
    return {
      kind: PLAN_OBSERVATION_KINDS.Text,
      at: { x: value.at.x, y: value.at.y },
      text: value.text,
      confidence
    };
  }
  return undefined;
}

/**
 * The reply's observations, or `undefined` if it is not a reply at all.
 *
 * Tolerates the fencing providers wrap JSON in, and nothing else. That is the
 * line ADR-0027.1 Rule 6 draws: unwrapping a code fence is reading a structured
 * channel; recovering three walls out of forty with a regex is mining prose, and
 * it produces a confident, wrong, partial building whose missing half is
 * invisible.
 */
function parseObservations(text: string): unknown[] | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    const parsed: unknown = JSON.parse(candidate);
    const observations = (parsed as { observations?: unknown } | null)?.observations;
    return Array.isArray(observations) ? observations : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads one page.
 *
 * `port` absent is the ordinary case rather than an error path: a host with no
 * vision-capable provider is a host that still imports, places and traces plans.
 */
export async function readPlan(
  request: ReadPlanRequest,
  port: PlanVisionPort | undefined
): Promise<ReadPlanOutcome> {
  if (port === undefined) {
    return blocked(
      PLAN_BLOCKER_REASONS.Unsupported,
      'No model that can look at an image is configured, so this drawing cannot be read automatically.',
      ['Trace the plan by hand over the placed drawing.']
    );
  }

  const reply = await port.read({
    image: request.image,
    instruction: planReadingInstruction({
      pixelWidth: request.image.pixelWidth,
      pixelHeight: request.image.pixelHeight
    })
  });

  const entries = parseObservations(reply.text);
  if (entries === undefined) {
    return blocked(
      PLAN_BLOCKER_REASONS.Unsupported,
      'The model did not answer with a reading of the drawing.',
      ['Try again.', 'Trace the plan by hand over the placed drawing.']
    );
  }

  const observations: PlanObservation[] = [];
  for (const entry of entries) {
    const observation = toObservation(entry);
    if (observation !== undefined) {
      observations.push(observation);
    }
  }

  if (observations.length === 0) {
    // **A blocker, not an empty success.** An extraction returning nothing and
    // reporting success is indistinguishable from one that failed, and leaves a
    // user looking at an empty plan wondering whether that is the answer.
    return blocked(
      PLAN_BLOCKER_REASONS.NothingToDo,
      'Nothing on this page could be read as a floor plan.',
      [
        'Check that this page is the plan and not a title sheet or an elevation.',
        'Trace the plan by hand over the placed drawing.'
      ]
    );
  }

  const uncertain = observations.filter(
    (observation) => observation.confidence < READING_CONFIDENCE_THRESHOLD
  );
  if (uncertain.length > 0) {
    // Rule 5. The whole reading is refused rather than the doubtful parts
    // filtered out: a plan silently missing the walls the model was unsure of
    // is a plan with holes in it, and the holes are exactly where a user would
    // have looked twice.
    return blocked(
      PLAN_BLOCKER_REASONS.MissingInformation,
      `${uncertain.length} of ${observations.length} readings from this drawing are not certain enough to build on.`,
      [
        'Try a higher-resolution scan of the same drawing.',
        'Trace the plan by hand over the placed drawing.'
      ]
    );
  }

  return {
    ok: true,
    reading: {
      pageIndex: request.pageIndex,
      pixelWidth: request.image.pixelWidth,
      pixelHeight: request.image.pixelHeight,
      observations
    }
  };
}
