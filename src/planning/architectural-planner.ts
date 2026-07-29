/**
 * The Architectural Planner (Sprint 24.5, Story 24.5.6).
 *
 * The registry half of the operation extension point: it holds the registered
 * {@link ArchitecturalOperationProvider}s, routes an action to the one that
 * declared it, and answers for the actions nobody declared.
 *
 * It contains no operation logic of its own. Every plan comes from a provider —
 * including the built-in ones (`operations/`), which are registered exactly the
 * way a plugin's would be. There is no privileged path.
 *
 * ## Why unknown actions are answered here
 *
 * Because "nothing can do this" is a plannable outcome, not an exception. An
 * action with no provider produces an `unsupported` blocker listing what the
 * planner *can* do, which is precisely Story 24.5.11's "unsupported operations
 * … whenever possible, alternative suggestions are proposed". Throwing would
 * turn a conversational dead end into an error dialog.
 */

import {
  ARCHITECTURAL_INTENT_KINDS,
  type ArchitecturalIntent
} from '../intent/architectural-intent';
import type { BuildingKnowledge } from '../understanding/building-knowledge';
import type {
  ArchitecturalCapability,
  ArchitecturalOperationProvider
} from './architectural-operation';
import { blocked, PLAN_BLOCKER_REASONS, type PlanResult } from './architectural-plan';

export class ArchitecturalPlanner {
  private readonly providers = new Map<string, ArchitecturalOperationProvider>();
  private readonly byAction = new Map<string, ArchitecturalOperationProvider>();

  /** @throws when the provider id, or any action it declares, is already registered. */
  registerProvider(provider: ArchitecturalOperationProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Duplicate architectural operation provider id "${provider.id}".`);
    }
    for (const action of provider.actions) {
      const existing = this.byAction.get(action);
      if (existing !== undefined) {
        throw new Error(
          `Architectural action "${action}" is already provided by "${existing.id}"; "${provider.id}" cannot also provide it.`
        );
      }
    }

    this.providers.set(provider.id, provider);
    for (const action of provider.actions) {
      this.byAction.set(action, provider);
    }
  }

  /** Removes a provider and every action it declared. */
  unregisterProvider(id: string): boolean {
    const provider = this.providers.get(id);
    if (provider === undefined) {
      return false;
    }
    for (const action of provider.actions) {
      if (this.byAction.get(action) === provider) {
        this.byAction.delete(action);
      }
    }
    return this.providers.delete(id);
  }

  registeredProviderIds(): readonly string[] {
    return [...this.providers.keys()];
  }

  /** Every action currently plannable, and which provider owns it. */
  capabilities(): readonly ArchitecturalCapability[] {
    return [...this.byAction.entries()].map(([action, provider]) => ({
      action,
      providerId: provider.id
    }));
  }

  /**
   * Plans one intent.
   *
   * An `Ambiguous` intent is still routed to its provider: the recognizer knows
   * *that* something is missing, and the provider knows *what it is for* — the
   * provider writes the better message, so it gets the chance.
   */
  plan(intent: ArchitecturalIntent, knowledge: BuildingKnowledge): PlanResult {
    const provider = this.byAction.get(intent.action);
    if (provider === undefined) {
      return blocked(
        PLAN_BLOCKER_REASONS.Unsupported,
        intent.kind === ARCHITECTURAL_INTENT_KINDS.Unknown
          ? 'I did not recognise that as something I can do to the building model.'
          : `I understand "${intent.action}", but nothing in this build knows how to perform it.`,
        this.suggestions()
      );
    }

    try {
      return provider.plan(intent, knowledge);
    } catch (error) {
      // A provider that throws is isolated the same way a Building Provider or
      // a Context Provider is: it becomes a visible, explainable outcome rather
      // than taking the conversation down with it.
      return blocked(
        PLAN_BLOCKER_REASONS.Unsupported,
        `The "${provider.id}" operation provider failed: ${error instanceof Error ? error.message : String(error)}`,
        this.suggestions()
      );
    }
  }

  private suggestions(): readonly string[] {
    const actions = [...this.byAction.keys()].sort();
    return actions.length === 0
      ? []
      : [`I can currently plan: ${actions.map((action) => `\`${action}\``).join(', ')}.`];
  }
}
