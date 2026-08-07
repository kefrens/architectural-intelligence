/**
 * Contribution attribution (Sprint 28.3, ADR-0028 Rule 10).
 *
 * Since Sprint 28.3 a planning artefact can be enriched by a provider an
 * *extension* contributed, not only by the platform. The moment that is true,
 * "where did this requirement come from?" stops having an obvious answer — and
 * "the assistant decided" is precisely the failure ADR-0027.1 exists to prevent.
 *
 * So an enriched artefact carries the ordered ids of the providers that touched
 * it. A Space Programme that gained a 9 m height limit can say it came from
 * `urban-rules.setback`, and the proposal card can put that in front of the user
 * before they approve anything.
 *
 * ## Why optional, and why this costs no migration
 *
 * The field is absent until something enriches, so an artefact produced by a
 * host with no AI plugins is byte-identical to a pre-28.3 one. And the project
 * file's planning section is opaque and keyed by artefact kind (Sprint 27.8), so
 * a new field inside an artefact round-trips at file version 3 with no migration
 * — the same property that let 27.9, 28.0 and 28.1a each add a kind without one.
 *
 * ## Why it is not a `provenance` field
 *
 * `provenance` answers "which revision of the artefact above was this derived
 * from" (ADR-0027.1 Rule 12, divergence). This answers "who added to it". They
 * are different questions with different lifetimes, and conflating them would
 * make divergence detection read a field that changes for an unrelated reason.
 */

export interface EnrichedArtefact {
  /**
   * The stage providers that enriched this artefact, in the order they ran.
   *
   * Absent when nothing enriched it — which is the shipped default, since the
   * platform contributes no stage providers of its own.
   */
  readonly contributedBy?: readonly string[];
}

/** The provider ids that enriched an artefact, or an empty list. */
export function contributorsOf(artefact: EnrichedArtefact): readonly string[] {
  return artefact.contributedBy ?? [];
}

/** Whether anything beyond the platform contributed to this artefact. */
export function wasEnriched(artefact: EnrichedArtefact): boolean {
  return contributorsOf(artefact).length > 0;
}

/**
 * The attribution line for a proposal card, or nothing.
 *
 * Folded into the artefact's existing `assumptions` rather than given a field of
 * its own on `Proposal`: the user is already reading that list to find out what
 * the platform decided for them, and "who decided it" belongs in the same
 * sentence. No second card, no second approval surface (ADR-0027.1 Rule 7).
 */
export function contributionNotes(artefact: EnrichedArtefact): readonly string[] {
  const contributors = contributorsOf(artefact);
  if (contributors.length === 0) {
    return [];
  }
  return [
    `Enriched by ${contributors.join(', ')} — installed ${contributors.length === 1 ? 'extension' : 'extensions'}, not the built-in planner.`
  ];
}
