/**
 * How a page reaches a model, without this package reaching anything
 * (Sprint 1.9; ADR-0026, ADR-0044 revision 1.1 Rule 8).
 *
 * This repository holds **no credential, no endpoint and no HTTP client**, and
 * this sprint does not change that. The host implements this port over
 * `apps/ai-service`'s `images` capability — the relay ArchiSimple Sprint 046.4
 * built, which is why 046.4 built it.
 *
 * The shape is `AiWorkspaceStore`'s and for the same reason: a port the host
 * supplies keeps this layer testable with a fake, and keeps the browser reaching
 * no provider directly.
 *
 * **A host with no vision-capable provider supplies no port**, and `readPlan`
 * answers with a blocker. That symmetry is deliberate — `runImportPlan`'s absent
 * `requestExtraction` already ends the same way, and nothing about this feature
 * may make the application unusable when the model is not there.
 */

/** One rendered page, as bytes the host has already produced. */
export interface PlanVisionImage {
  /** `image/png`, `image/webp` — whatever the host rendered to. */
  readonly mediaType: string;
  /** Base64, matching `AiImagePartDto` on the wire. */
  readonly data: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

export interface PlanVisionInput {
  readonly image: PlanVisionImage;
  /** The instruction this package composed. The host relays it unchanged. */
  readonly instruction: string;
}

/**
 * What came back.
 *
 * `text` is the provider's structured reply, **not** prose to mine. ADR-0027.1
 * Rule 6 forbids parsing an artefact out of what a model said; what this reads
 * is a structured channel the host asked the provider to answer through, and a
 * reply that does not parse is a blocker rather than a scrape (§4.4).
 */
export interface PlanVisionReply {
  readonly text: string;
  /**
   * The provider stopped at its output limit, so `text` is a fragment
   * (Sprint 1.12 / ArchiSimple 047.4).
   *
   * A **fact about the reply**, not the provider's word for it. The host knows
   * `finish_reason`, `stop_reason` and whatever the next provider calls it; this
   * package knows only whether what it was handed is whole. Naming a completion
   * vocabulary here would put provider knowledge in the one package that holds
   * no endpoint, no credential and no HTTP client.
   *
   * It matters because a truncated reply and a malformed one fail at the same
   * `JSON.parse` and mean opposite things: one is a limit to raise, the other is
   * a model that cannot answer in the schema. Told apart, the blocker can say
   * which — and the first real reading this caught was a correct one, cut off at
   * 1024 tokens and reported as "the model did not answer".
   */
  readonly truncated?: boolean;
}

export interface PlanVisionPort {
  read(input: PlanVisionInput): Promise<PlanVisionReply>;
}
