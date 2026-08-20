/**
 * A page becomes **semantic** observations, and stops there (Sprint 1.9;
 * rewritten by Sprint 1.10 / ArchiSimple 046.7w. ADR-0044 revision 1.4
 * Rules 1, 3, 4, 5, 11, 12).
 *
 * ```text
 * page raster ──▶ instruction ──▶ [ host's port ] ──▶ structured reply
 *   (+ document text, if the document has any)              │
 *                                                           ▼
 *                                                   PlanReading, or a blocker
 * ```
 *
 * ## Where this stops, and why the stop is the design
 *
 * At observations, and now at *semantic* ones. It assembles **no artefact** —
 * the Geometry Graph is composed by the host, field by field (Rule 3). It
 * produces **no `Proposal`**: a proposal is what the host makes of a reading,
 * and ADR-0027.1 Rule 7's one approval mechanism stays one.
 *
 * It computes **nothing**, and since Sprint 1.10 it **locates nothing**. Not a
 * length, not an angle, not an area, not an association, and not a coordinate.
 * Rule 11: the model is never the geometric source, for any document. Geometry
 * comes from the document's own paths or from ink discovered in the raster, and
 * a semantic claim is what selects among it (Rule 12).
 *
 * ## The parser is the boundary
 *
 * Every field is checked, and **a reply that offers geometry is refused rather
 * than trimmed**. `toObservation` returning `undefined` for a wall carrying
 * `from`/`to` is not defensiveness about malformed JSON — it is the one place
 * where a model could reintroduce the coordinates ADR-0044 spent six sprints
 * removing, and where doing so would look like a small compatibility kindness.
 *
 * ## Not a Tool, and not a lane
 *
 * **Not a Tool**, because a Tool is something a model calls, and a model calling
 * "read this drawing" is circular — the drawing is what it is being shown.
 *
 * **Not a lane.** The nine lanes classify an *utterance*. This is not one: nobody
 * typed anything and there is nothing to disambiguate. Routing it through the
 * classifier would mean inventing a sentence to classify, and invented plumbing
 * reads as a feature later.
 *
 * It is a capability the host asks for directly.
 */

import {
  ANNOTATION_KINDS,
  OBSERVED_WALL_KINDS,
  PLAN_OBSERVATION_KINDS,
  PLAN_READING_BLOCKER_REASONS,
  TEXT_SOURCES,
  type AnchorRef,
  type AnnotationKind,
  type ObservedRegion,
  type ObservedWallKind,
  type PlanObservation,
  type PlanReading,
  type PlanReadingBlocker
} from '@archisimple/ai-engine';
import { PLAN_BLOCKER_REASONS, type PlanBlocker } from '../planning/index.js';
import { planReadingInstruction, type SuppliedTextRun } from './plan-reading-prompt.js';
import type { PlanVisionImage, PlanVisionPort } from './plan-vision-port.js';

/**
 * How sure an observation must be to be acted on **automatically**.
 *
 * ## Confidence controls automatic eligibility, not semantic existence
 *
 * The governing rule of Sprint 1.10b, and the reason this constant no longer
 * removes anything from a reading. A claim below it is still a claim: it is
 * reported, it reaches the deterministic resolver, and the resolver either finds
 * substrate geometry that supports it or does not. A claim that selects nothing
 * **produces no promotion, and that is the whole of its cost** (ADR-0044
 * Rule 12) — it cannot cause geometry to be invented, because nothing in this
 * layer or the next can invent geometry at all.
 *
 * Dropping it here instead would throw away the evidence that made the resolver
 * work: 046.7u recovered five real partitions from `separates` claims, and every
 * wall claim measured on that drawing sat between 0.45 and 0.60.
 *
 * ## Why the number is 0.8, and stays 0.8
 *
 * The same threshold the host's `judgeObservations` applies (ArchiSimple Sprint
 * 046.4), so there is **one global gate** rather than two. It is deliberately
 * left where it is even though the measured distribution sits mostly below it:
 *
 * | kind | measured confidence |
 * | --- | --- |
 * | space | 0.85 and up — the only kind that clears this consistently |
 * | dimension | 0.55 – 0.70 |
 * | wall | 0.45 – 0.60 |
 * | opening | 0.40 – 0.60 |
 * | annotation | 0.40 – 0.50 |
 * | text | 0.70 |
 *
 * A conservative automatic gate is the right shape when everything below it is
 * still available to a step that verifies claims against real geometry.
 * **No per-kind thresholds**: the spread above is one drawing and one sample,
 * which is enough to justify keeping a gate and nowhere near enough to justify
 * six of them.
 */
export const READING_CONFIDENCE_THRESHOLD = 0.8;

/**
 * Whether an observation may be acted on without anything else confirming it.
 *
 * The predicate form of the rule above, exported so a consumer applies the same
 * gate this package documents rather than comparing against a number it chose.
 * Everything else is still a real observation — it needs the resolver, or a
 * person, to confirm it.
 */
export function isAutomaticallyEligible(observation: PlanObservation): boolean {
  return observation.confidence >= READING_CONFIDENCE_THRESHOLD;
}

export interface ReadPlanRequest {
  readonly image: PlanVisionImage;
  /** Which page this is, carried through so a reading can be placed. */
  readonly pageIndex: number;
  /**
   * Text the document itself states (ADR-0044 Rule 11).
   *
   * Present for a document with a text layer, absent for a raster. Supplied to
   * the model as **data** and emitted as observations with
   * `source: 'document'` — this package neither opens the file nor extracts
   * them; the host does, because the host is what holds the document.
   */
  readonly documentText?: readonly SuppliedTextRun[];
}

export type ReadPlanOutcome =
  | { readonly ok: true; readonly reading: PlanReading }
  | { readonly ok: false; readonly blocker: PlanBlocker };

const blocked = (
  reason: PlanBlocker['reason'],
  message: string,
  suggestions: readonly string[]
): ReadPlanOutcome => ({ ok: false, blocker: { reason, message, suggestions } });

const isConfidence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const isPoint = (value: unknown): value is { x: number; y: number } => {
  const point = value as { x?: unknown; y?: unknown } | null;
  return (
    point !== null &&
    typeof point === 'object' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
};

/**
 * A coarse box, or nothing.
 *
 * A negative or non-finite extent is refused rather than clamped: a region is a
 * filter over candidates, and one with a `NaN` width matches everything or
 * nothing depending on which comparison runs first.
 */
const toRegion = (value: unknown): ObservedRegion | undefined => {
  const box = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null;
  if (box === null || typeof box !== 'object') return undefined;
  const { x, y, width, height } = box;
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return undefined;
  }
  if ((width as number) < 0 || (height as number) < 0) return undefined;
  return {
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number
  };
};

/**
 * Two named things, or nothing.
 *
 * The wire carries plain strings and the contract carries `AnchorRef`s; that
 * conversion is this function and it is the only place it happens. A pair of one
 * is not a relationship, and a blank label anchors nothing.
 */
const toPair = (value: unknown): readonly [AnchorRef, AnchorRef] | undefined => {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [first, second] = value;
  if (typeof first !== 'string' || typeof second !== 'string') return undefined;
  if (first.trim() === '' || second.trim() === '') return undefined;
  // Not normalised, not upper-cased, not trimmed to a canonical form: matching a
  // label to a space is the host's, and normalising twice is how two spellings
  // of one room become two rooms.
  return [{ label: first }, { label: second }];
};

const isWallKind = (value: unknown): value is ObservedWallKind =>
  typeof value === 'string' &&
  (Object.values(OBSERVED_WALL_KINDS) as readonly string[]).includes(value);

const isAnnotationKind = (value: unknown): value is AnnotationKind =>
  typeof value === 'string' &&
  (Object.values(ANNOTATION_KINDS) as readonly string[]).includes(value);

/**
 * One entry of the reply, or `undefined` if it is not an observation.
 *
 * Every field is checked. A reply is a model's output, so "it has a `kind`,
 * therefore the rest is there" is not a safe read.
 *
 * **A wall that carries `from`/`to` is refused outright**, not stripped. Under
 * ADR-0044 Rule 11 a model has no coordinates to give; one that offers them has
 * misunderstood the instruction, and everything else it said about that wall is
 * suspect for the same reason. Silently keeping the `region` and dropping the
 * endpoints would turn a misunderstanding into a plausible observation.
 *
 * **Unknown fields are dropped rather than carried.** A model that volunteers a
 * `length` is offering a number Rule 4 forbids, and letting it through the
 * boundary because the type does not mention it is how it ends up read by
 * something later.
 */
export function toObservation(entry: unknown): PlanObservation | undefined {
  const value = entry as Record<string, unknown> | null;
  if (value === null || typeof value !== 'object' || !isConfidence(value.confidence)) {
    return undefined;
  }
  const confidence = value.confidence;

  // Rule 11, enforced at the one place it can be. Applies to every kind: no
  // observation in this vocabulary has endpoints, so any entry claiming them is
  // answering a question that was not asked.
  if ('from' in value || 'to' in value) {
    return undefined;
  }

  const region = toRegion(value.region);

  switch (value.kind) {
    case PLAN_OBSERVATION_KINDS.Space: {
      if (region === undefined || typeof value.label !== 'string' || value.label.trim() === '') {
        return undefined;
      }
      return { kind: PLAN_OBSERVATION_KINDS.Space, label: value.label, region, confidence };
    }

    case PLAN_OBSERVATION_KINDS.Wall: {
      if (region === undefined || !isWallKind(value.wallKind)) return undefined;
      const separates = toPair(value.separates);
      // Absent or unusable `separates` is not a failure: a wall the model can
      // see but cannot attribute is a real reading, and Rule 12 leaves it
      // unresolved rather than letting the host guess at proximity.
      return separates === undefined
        ? { kind: PLAN_OBSERVATION_KINDS.Wall, wallKind: value.wallKind, region, confidence }
        : {
            kind: PLAN_OBSERVATION_KINDS.Wall,
            wallKind: value.wallKind,
            region,
            separates,
            confidence
          };
    }

    case PLAN_OBSERVATION_KINDS.Opening: {
      if (region === undefined || typeof value.symbol !== 'string' || value.symbol.trim() === '') {
        return undefined;
      }
      const connects = toPair(value.connects);
      return connects === undefined
        ? { kind: PLAN_OBSERVATION_KINDS.Opening, symbol: value.symbol, region, confidence }
        : {
            kind: PLAN_OBSERVATION_KINDS.Opening,
            symbol: value.symbol,
            region,
            connects,
            confidence
          };
    }

    case PLAN_OBSERVATION_KINDS.Dimension: {
      if (region === undefined || typeof value.text !== 'string') return undefined;
      const measures =
        typeof value.measures === 'string' && value.measures.trim() !== ''
          ? { label: value.measures }
          : undefined;
      // Exactly as read. Not trimmed of its unit, not normalised, not parsed —
      // `parseDimensionText` does all three, deterministically and later.
      return measures === undefined
        ? { kind: PLAN_OBSERVATION_KINDS.Dimension, text: value.text, region, confidence }
        : {
            kind: PLAN_OBSERVATION_KINDS.Dimension,
            text: value.text,
            region,
            measures,
            confidence
          };
    }

    case PLAN_OBSERVATION_KINDS.Annotation: {
      if (region === undefined || !isAnnotationKind(value.annotationKind)) return undefined;
      return {
        kind: PLAN_OBSERVATION_KINDS.Annotation,
        annotationKind: value.annotationKind,
        region,
        confidence
      };
    }

    case PLAN_OBSERVATION_KINDS.Text: {
      if (!isPoint(value.at) || typeof value.text !== 'string') return undefined;
      return {
        kind: PLAN_OBSERVATION_KINDS.Text,
        at: { x: value.at.x, y: value.at.y },
        text: value.text,
        // The model read it, so it is a reading. A run the *document* stated is
        // added by `readPlan` below and never arrives through here.
        source: TEXT_SOURCES.Reading,
        confidence,
        ...(region === undefined ? {} : { region })
      };
    }

    default:
      return undefined;
  }
}

/** One thing the model could not determine, or `undefined`. */
function toBlocker(entry: unknown): PlanReadingBlocker | undefined {
  const value = entry as Record<string, unknown> | null;
  if (value === null || typeof value !== 'object') return undefined;
  if (
    typeof value.reason !== 'string' ||
    !(Object.values(PLAN_READING_BLOCKER_REASONS) as readonly string[]).includes(value.reason)
  ) {
    return undefined;
  }
  const detail = value.detail;
  return {
    reason: value.reason as PlanReadingBlocker['reason'],
    // Data, never a sentence — ADR-0019 keeps translation above this layer.
    detail: detail !== null && typeof detail === 'object' ? { ...(detail as object) } : {}
  };
}

interface ParsedReply {
  readonly observations: readonly unknown[];
  readonly blockers: readonly unknown[];
}

/**
 * The reply, or `undefined` if it is not a reply at all.
 *
 * Tolerates the fencing providers wrap JSON in, and nothing else. That is the
 * line ADR-0027.1 Rule 6 draws: unwrapping a code fence is reading a structured
 * channel; recovering three walls out of forty with a regex is mining prose, and
 * it produces a confident, wrong, partial building whose missing half is
 * invisible.
 */
function parseReply(text: string): ParsedReply | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    const parsed = JSON.parse(candidate) as { observations?: unknown; blockers?: unknown } | null;
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.observations)) {
      return undefined;
    }
    return {
      observations: parsed.observations,
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers : []
    };
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
      pixelHeight: request.image.pixelHeight,
      // Spread rather than assigned: `exactOptionalPropertyTypes` distinguishes
      // "absent" from "present and undefined", and a raster is the former.
      ...(request.documentText === undefined ? {} : { documentText: request.documentText })
    })
  });

  const parsed = parseReply(reply.text);
  if (parsed === undefined) {
    return blocked(
      PLAN_BLOCKER_REASONS.Unsupported,
      'The model did not answer with a reading of the drawing.',
      ['Try again.', 'Trace the plan by hand over the placed drawing.']
    );
  }

  const observations: PlanObservation[] = [];
  const blockers: PlanReadingBlocker[] = [];

  for (const entry of parsed.blockers) {
    const blocker = toBlocker(entry);
    if (blocker !== undefined) blockers.push(blocker);
  }

  /*
   * Every well-formed observation is kept, whatever its confidence.
   *
   * **Confidence controls automatic eligibility, not semantic existence**
   * (Sprint 1.10b). This loop had two earlier shapes and both were wrong for the
   * same reason — they decided here what only the resolver can decide:
   *
   * - Sprint 1.9 refused the **whole reading** if any observation was doubtful,
   *   which on real drawings refuses every reading, because a wall claim
   *   measures 0.45–0.60;
   * - Sprint 1.10 turned each doubtful observation into a blocker, which is not
   *   silent but still throws the claim away — including the `separates` claims
   *   that recovered five real partitions in 046.7u.
   *
   * A low-confidence claim is cheap to keep and expensive to lose: it either
   * selects substrate geometry, in which case something exact confirms it, or it
   * selects nothing and dies quietly. It cannot invent geometry — nothing in this
   * layer or the next can (ADR-0044 Rule 12).
   *
   * `blockers` therefore carries **only what the model said it could not
   * determine**, which is what the field means. Consumers gate with
   * `isAutomaticallyEligible`.
   */
  for (const entry of parsed.observations) {
    const observation = toObservation(entry);
    if (observation !== undefined) observations.push(observation);
  }

  // Text the document stated, added after the model's own output and never
  // through the parser: it did not come from the model and is not a reading
  // (ADR-0044 Rule 11). Confidence 1 describes **provenance, not correctness** —
  // a text layer can be wrong where fonts are mis-mapped.
  for (const run of request.documentText ?? []) {
    observations.push({
      kind: PLAN_OBSERVATION_KINDS.Text,
      at: { x: run.x, y: run.y },
      text: run.text,
      source: TEXT_SOURCES.Document,
      confidence: 1
    });
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

  return {
    ok: true,
    reading: {
      pageIndex: request.pageIndex,
      pixelWidth: request.image.pixelWidth,
      pixelHeight: request.image.pixelHeight,
      observations,
      blockers
    }
  };
}
