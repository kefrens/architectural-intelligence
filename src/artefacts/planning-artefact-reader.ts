/**
 * Reading what the project has already approved (Sprint 27.9, Story 27.9.0 —
 * ADR-0027.1 Rule 5).
 *
 * Sprint 27.8 gave this layer a {@link BriefDraftStore} for the Brief it is
 * still working out, and gave the *host* an approval sink for the Brief once
 * the user accepts it. Those are two different stores on purpose — a draft
 * belongs to the conversation, an approved artefact belongs to the project.
 *
 * The consequence, which only became a problem in this sprint, is that at the
 * moment a Brief is approved this layer loses sight of it entirely: the draft
 * is cleared, and the approved copy lives in a registry in `apps/web` that
 * nothing here can reach. A Space Programme is derived from an approved Brief,
 * so it needs a way back in. This is that way, and it is deliberately
 * **read-only**: promoting an artefact into the project is still approval's job,
 * through the one entry point Rule 7 allows.
 *
 * A port, like every other store this package touches. The host's
 * implementation is the same registry the approval sink writes to, so there is
 * one set of approved artefacts rather than a reading copy and a writing copy.
 */

/**
 * One approved artefact, as the host holds it.
 *
 * Structurally the shape `ai-engine`'s `ProposalArtefact` and `persistence`'s
 * `PlanningArtefactSnapshot` both carry, restated here rather than imported so
 * this package does not depend on `persistence` for a four-field record — the
 * same seam `EntitySnapshot` has always had with `core`'s `Entity`.
 */
export interface ApprovedArtefact {
  readonly kind: string;
  readonly id: string;
  readonly revision: number;
  /** Opaque to the reader; narrowed by whoever knows the kind. */
  readonly value: unknown;
}

export interface PlanningArtefactReader {
  /**
   * The artefact of this kind currently in force — the highest revision — or
   * `undefined` when the project has approved none.
   *
   * "Currently in force" rather than "the only one": ADR-0027.1 Rule 4
   * supersedes rather than replaces, so a project may hold several revisions
   * and this answers which one counts.
   */
  current(kind: string): ApprovedArtefact | undefined;
}

/**
 * A reader over a fixed set of artefacts.
 *
 * For tests and for a caller composing a pipeline by hand. The host's reader is
 * backed by the live registry, so it reflects an approval that happened a moment
 * ago; this one reflects whatever it was built with.
 */
export function createInMemoryPlanningArtefactReader(
  artefacts: readonly ApprovedArtefact[]
): PlanningArtefactReader {
  return {
    current: (kind) =>
      artefacts
        .filter((artefact) => artefact.kind === kind)
        .reduce<
          ApprovedArtefact | undefined
        >((latest, artefact) => (latest === undefined || artefact.revision > latest.revision ? artefact : latest), undefined)
  };
}
