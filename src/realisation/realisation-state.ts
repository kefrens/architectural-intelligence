/**
 * What the host knows about whether the approved design was built (Sprint 1.7 —
 * ADR-AI-0004).
 *
 * Sprint 1.6 gave this layer a realisation lane and no way to tell an unbuilt
 * design from a built one, so "build it" asked twice proposed twice and the
 * host's guard refused the second. This is the port that closes it: read-only,
 * host-supplied, and the **only** source of realisation state (Rule 1).
 *
 * ## Why a port, when the host already sends a fragment
 *
 * ArchiSimple's `realisation` context fragment reaches this repository on every
 * turn, inside `AiProviderRequest.context`. It is not the channel, for two
 * reasons ADR-AI-0004 records: `AssembledContext` is string-keyed and
 * `unknown`-valued, so a renamed field would break reasoning with nothing
 * failing first; and a plugin-contributed provider registering the same id
 * **replaces** it, because the host spreads plugin providers after its own.
 * Good enough for prompt text a model reads with judgement; not good enough for
 * a fact the assistant must not be wrong about.
 *
 * ## Five fields, and the list is a maximum
 *
 * A field is admitted when a behaviour in `proposeRealisation` needs it, never
 * because the host already computes it. The fragment carries the built counts,
 * an attempt count and a timestamp; none of them changes what this layer says,
 * so none of them is here (Rule 9).
 *
 * Because this interface is *narrower* than the fragment, the host's existing
 * derivation satisfies it structurally — one derivation, two readers, no adapter
 * between them (Rule 7). That is the whole reason there is no risk of two
 * answers to "was this built".
 *
 * ## What it is not
 *
 * No `RealisationRecord`, no dispatcher, no Build Plan, no guard, no translator
 * (Rule 3). And no artefact staleness: whether a Specification was derived from
 * a superseded Geometry Graph is *this* layer's knowledge, already in the
 * projection and already acted on since Sprint 1.6 (Rule 10).
 */

/** How the host describes the state of the design in force. */
export const REALISATION_STATUSES = {
  /** The project has approved no Geometry Specification. */
  NoSpecification: 'no-specification',
  /** Approved, and no attempt has been recorded against this revision. */
  NotRealised: 'not-realised',
  /** Built. Walls and openings exist because of it. */
  Realised: 'realised',
  /** The most recent attempt was refused before anything was mutated. */
  Refused: 'refused',
  /** The most recent attempt ran against the document and rolled back. */
  Failed: 'failed'
} as const;

export type RealisationStatus = (typeof REALISATION_STATUSES)[keyof typeof REALISATION_STATUSES];

export interface RealisationState {
  readonly status: RealisationStatus;
  /**
   * Which design was answered about.
   *
   * Not decoration: the host resolves state against the Specification in force,
   * and this layer independently knows which that is. A disagreement means
   * something is misconfigured — two record registries, most plausibly — and a
   * state about another design is not evidence about this one.
   */
  readonly specificationId: string | null;
  readonly specificationRevision: number | null;
  /** Whether the host's guard would admit a build of this revision now. */
  readonly guardAllowsBuild: boolean;
  /** Which refusal, as the host's stable identifier. Never a sentence. */
  readonly guardBlockerCode: string | null;
}

export interface RealisationStateReader {
  /**
   * The state now.
   *
   * Called once per turn and never stored (Rule 5): a cached verdict about
   * whether a building exists goes stale the moment one is built, and this
   * layer would keep saying so.
   */
  realisation(): RealisationState;
}

/**
 * A reader over a fixed state, for tests and for a caller composing by hand.
 *
 * The host's is backed by its live records; this one reflects whatever it was
 * built with — the same seam `createInMemoryPlanningArtefactReader` has.
 */
export function createInMemoryRealisationStateReader(
  state: RealisationState
): RealisationStateReader {
  return { realisation: () => state };
}
