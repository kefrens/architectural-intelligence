/**
 * The Architectural Operation Provider (Sprint 24.5, "Tool Registry extended:
 * Building operations").
 *
 * The extension point this sprint adds: one provider owns one or more
 * architectural actions and knows how to turn an {@link ArchitecturalIntent}
 * plus {@link BuildingKnowledge} into an {@link ArchitecturalPlan} — or into a
 * {@link PlanBlocker} saying why it cannot.
 *
 * This is the fifth application of the platform's Service + Provider + Registry
 * shape (after Building, Navigation, Spatial and Inspector), deliberately and
 * not by accident: a provider declares an id, contributes by declaration,
 * refuses to register twice under the same id, and can be unregistered. What it
 * contributes is *capability* rather than data, which is the one difference —
 * and the reason it registers with the planner rather than with one of the four
 * existing services.
 *
 * ## What a provider may not do
 *
 * Write. A provider returns Requests; it never executes one. Nothing in this
 * package holds a `CommandDispatcher`, which is what makes "No Runtime
 * modification occurs during reasoning" a structural fact rather than a
 * convention.
 */

import type { ArchitecturalIntent } from '../intent/architectural-intent';
import type { BuildingKnowledge } from '../understanding/building-knowledge';
import type { PlanResult } from './architectural-plan';

export interface ArchitecturalOperationProvider {
  /** Unique among registered providers; duplicate registration is an error. */
  readonly id: string;
  /**
   * The action ids this provider answers for. The planner routes by exact
   * match, so a provider that wants to shadow a built-in registers the same
   * action id — and the planner refuses that too, for the same reason two
   * Building Providers may not contribute the same object id.
   */
  readonly actions: readonly string[];
  /**
   * Plans one intent. Called only for actions this provider declared.
   *
   * Must be side-effect free: it may read anything through `knowledge`, and
   * write nothing anywhere.
   */
  plan(intent: ArchitecturalIntent, knowledge: BuildingKnowledge): PlanResult;
}

/** What a provider needs to describe itself to a model or a preferences screen. */
export interface ArchitecturalCapability {
  readonly action: string;
  readonly providerId: string;
}
