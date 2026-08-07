/**
 * Planning stages, and the providers that enrich them (Sprint 27.9, Story
 * 27.9.4 — ADR-0027.1 Rule 10).
 *
 * ADR-0027.1's plugin model has Template, Urban Rules, Budget and Energy
 * Providers contributing to planning artefacts *before* geometry exists. Rule 10
 * says they register on {@link ArchitecturalPlanner} rather than on a seventh
 * registry — but the planner has only ever indexed providers by
 * `intent.action`, and an enricher answers for a **stage**, not an action. This
 * is that second dimension.
 *
 * ## Why this is not an operation provider
 *
 * An {@link ArchitecturalOperationProvider} turns an intent into Automation
 * Requests. A stage provider takes an artefact and gives back a richer artefact,
 * and produces no Requests at all — an Urban Rules provider that discovers a
 * height limit changes the *programme*, and the fact that this eventually
 * changes the geometry is three stages away and somebody else's job. Same
 * registry, same ownership rules, different contract.
 *
 * ## Several providers per stage, in registration order
 *
 * Unlike actions, a stage is **not** exclusive. The ADR's own plugin table puts
 * Urban Rules *and* Budget on the Space Programme, so refusing a second provider
 * for a stage would make the documented plugin model impossible. Duplicate
 * provider **ids** are still an error, exactly as they are everywhere else in
 * this codebase — that is the composition bug worth refusing.
 *
 * Enrichment is therefore a fold: each provider sees what the previous one
 * produced. Order is registration order, which is the same guarantee
 * `SkillRegistry` and every other registry here gives.
 */

import type { BuildingKnowledge } from '../understanding/building-knowledge';

/**
 * The stages a provider may enrich.
 *
 * Only the artefact stages appear. The Geometry *Plan* — walls with thickness and
 * the Requests that build them — is still produced by operation providers
 * through the existing `actions` seam; `geometry` here is the Geometry *Graph*,
 * which is an artefact like the three above it.
 */
export const PLANNING_STAGES = {
  Brief: 'brief',
  Programme: 'programme',
  Layout: 'layout',
  /** Sprint 28.1a. Enrichment runs *before* the invariant gate, so a provider that breaks a clause is caught by the same check as a broken packer. */
  Geometry: 'geometry'
} as const;

export type PlanningStage = (typeof PLANNING_STAGES)[keyof typeof PLANNING_STAGES];

export interface PlanningStageProvider<TArtefact = unknown> {
  /** Unique among *all* registered providers, operation and stage alike. */
  readonly id: string;
  readonly stage: PlanningStage;
  /**
   * Returns an enriched artefact, or the one it was given when it has nothing
   * to add.
   *
   * Must be side-effect free and must not mutate its input: the artefact it
   * receives may already be held by a pending proposal. Returning a new object
   * is the contract, and returning the input unchanged is the correct way to
   * abstain.
   */
  enrich(artefact: TArtefact, knowledge: BuildingKnowledge): TArtefact;
}

/** What a stage provider looks like from outside — for a preferences screen or a diagnostic. */
export interface PlanningStageCapability {
  readonly stage: PlanningStage;
  readonly providerId: string;
}
