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
import type {
  PlanningStage,
  PlanningStageCapability,
  PlanningStageProvider
} from './planning-stage';

export class ArchitecturalPlanner {
  private readonly providers = new Map<string, ArchitecturalOperationProvider>();
  private readonly byAction = new Map<string, ArchitecturalOperationProvider>();
  /**
   * Stage providers (Sprint 27.9), in registration order per stage.
   *
   * A separate index from `byAction` rather than a widened one: the two answer
   * different questions with different contracts, and a single map keyed on
   * "action or stage" would make every lookup narrow a union it did not need.
   * Ids are still unique across both, which is what {@link takenId} enforces.
   */
  private readonly byStage = new Map<PlanningStage, PlanningStageProvider[]>();

  /** @throws when the provider id, or any action it declares, is already registered. */
  registerProvider(provider: ArchitecturalOperationProvider): void {
    if (this.takenId(provider.id)) {
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

  /**
   * Removes a provider and every action it declared.
   *
   * Since Sprint 27.9 this also removes a stage provider registered under the
   * same id — ids are unique across both kinds, so a caller unregistering what
   * it registered does not have to remember which kind it was.
   */
  unregisterProvider(id: string): boolean {
    const provider = this.providers.get(id);
    if (provider === undefined) {
      return this.unregisterStageProvider(id);
    }
    for (const action of provider.actions) {
      if (this.byAction.get(action) === provider) {
        this.byAction.delete(action);
      }
    }
    return this.providers.delete(id);
  }

  registeredProviderIds(): readonly string[] {
    return [...this.providers.keys(), ...this.stageProviderIds()];
  }

  /** Every action currently plannable, and which provider owns it. */
  capabilities(): readonly ArchitecturalCapability[] {
    return [...this.byAction.entries()].map(([action, provider]) => ({
      action,
      providerId: provider.id
    }));
  }

  // --- Planning stages (Sprint 27.9, ADR-0027.1 Rule 10) -------------------------

  /**
   * Registers a provider that enriches a planning artefact.
   *
   * A stage is **not** exclusive: several providers may enrich one stage, and
   * they run in registration order. Only the id is unique — across operation and
   * stage providers alike, so one `unregisterProvider` call means one thing.
   *
   * @throws when the provider id is already registered.
   */
  registerStageProvider(provider: PlanningStageProvider): void {
    if (this.takenId(provider.id)) {
      throw new Error(`Duplicate architectural provider id "${provider.id}".`);
    }
    const existing = this.byStage.get(provider.stage);
    if (existing === undefined) {
      this.byStage.set(provider.stage, [provider]);
      return;
    }
    existing.push(provider);
  }

  /** Removes a stage provider. Returns whether one was registered under this id. */
  unregisterStageProvider(id: string): boolean {
    for (const [stage, providers] of this.byStage) {
      const index = providers.findIndex((provider) => provider.id === id);
      if (index === -1) {
        continue;
      }
      providers.splice(index, 1);
      if (providers.length === 0) {
        this.byStage.delete(stage);
      }
      return true;
    }
    return false;
  }

  /** The providers enriching this stage, in registration order. */
  stageProviders(stage: PlanningStage): readonly PlanningStageProvider[] {
    return this.byStage.get(stage) ?? [];
  }

  /** Every stage currently enriched, and by whom. */
  stageCapabilities(): readonly PlanningStageCapability[] {
    return [...this.byStage.entries()].flatMap(([stage, providers]) =>
      providers.map((provider) => ({ stage, providerId: provider.id }))
    );
  }

  /**
   * Folds every provider for `stage` over `artefact`, each seeing what the
   * previous one produced.
   *
   * A provider that throws is skipped and the fold continues from the last good
   * artefact — the same isolation {@link plan} gives an operation provider, and
   * for the same reason: a misbehaving plugin should cost its own contribution,
   * not the user's programme. A provider that returns `undefined` or a non-object
   * is treated as having abstained rather than as having emptied the artefact.
   */
  enrich<TArtefact extends object>(
    stage: PlanningStage,
    artefact: TArtefact,
    knowledge: BuildingKnowledge
  ): TArtefact {
    let current = artefact;
    for (const provider of this.stageProviders(stage)) {
      try {
        const enriched = (provider as PlanningStageProvider<TArtefact>).enrich(current, knowledge);
        if (typeof enriched === 'object' && enriched !== null) {
          current = enriched;
        }
      } catch {
        // Deliberately swallowed: there is no conversational turn to report this
        // in — enrichment happens inside building an artefact the user has not
        // seen yet — and the alternative is losing the whole artefact to one
        // provider's bug.
        continue;
      }
    }
    return current;
  }

  private stageProviderIds(): readonly string[] {
    return [...this.byStage.values()].flatMap((providers) =>
      providers.map((provider) => provider.id)
    );
  }

  /** Ids are unique across both kinds of provider, so unregistering by id is unambiguous. */
  private takenId(id: string): boolean {
    return this.providers.has(id) || this.stageProviderIds().includes(id);
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
