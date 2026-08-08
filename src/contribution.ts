/**
 * The Architectural Intelligence contribution (Sprint 29.1, ADR-0029 Rule 2).
 *
 * One entry point through which a host composes this capability: the service,
 * the planning tools a model reaches it through, and the provider adapter that
 * makes it selectable in the AI Workspace — as a single value the host
 * registers rather than three imports the host assembles.
 *
 * ## Why this exists
 *
 * Until this sprint `apps/web` imported `ArchitecturalIntelligenceService` by
 * name and built one, imported `createArchitecturalProviderAdapter` and called
 * it, and imported five tool factories and composed them. Ten files knew this
 * package existed.
 *
 * That is acyclic and it compiled. What it was not is *separable*: a host that
 * constructs a layer-4 service by name is coupled to a capability it should only
 * compose, and if this package ever ships from somewhere else the two would
 * consume each other. ADR-0029 Rule 2 removes the edge while everything still
 * lives in one repository, which is the cheapest moment it will ever be
 * available.
 *
 * It is the Service + Provider + Registry convention this codebase already
 * implements six times, applied to the capability that escaped it — and the
 * first application that removes a coupling rather than adding a capability.
 *
 * ## What crosses, and what does not
 *
 * A service, tool *descriptions*, and a provider adapter. No dispatcher, no
 * `Proposal` factory, no document handle — nothing here executes anything. The
 * tools resolve to proposals; approval remains the single path to the document
 * (ADR-0023 Rule 1, ADR-0027.1 Rule 7).
 *
 * The host still decides whether to offer a tool at all: `requires` is checked
 * against what the Automation MCP server actually serves, in the broker, exactly
 * as before. Contributing a tool is not the same as it being available.
 */

import type { AiProviderAdapter, ContextProvider, ToolDefinition } from '@archisimple/ai-engine';
import {
  ArchitecturalIntelligenceService,
  type ArchitecturalIntelligenceServiceOptions
} from './architectural-intelligence-service';
import { createSessionBriefDraftStore, type BoundBriefDraftStore } from './brief';
import { createArchitecturalContextProvider } from './context/architectural-context-provider';
import {
  ARCHITECTURAL_PROVIDER_ID,
  createArchitecturalProviderAdapter
} from './provider/architectural-provider-adapter';
import {
  captureBriefToolDefinition,
  createArchitecturalToolDefinitions,
  createGeometryToolDefinition,
  createLayoutToolDefinition,
  createProgrammeToolDefinition
} from './tools';

/**
 * The id this capability registers under. Stable, and the same string the
 * provider adapter already used — a host that has one has the other.
 */
export const ARCHITECTURAL_INTELLIGENCE_CONTRIBUTION_ID = ARCHITECTURAL_PROVIDER_ID;

/**
 * What a host receives when it composes this capability.
 *
 * Deliberately plain data plus one service instance: a registry can hold it,
 * stamp it with its owner and drop it again without knowing what any of it does.
 */
export interface ArchitecturalIntelligenceContribution {
  readonly id: string;
  readonly intelligence: ArchitecturalIntelligenceService;
  /** Every planning and Building tool, in the order Sprint 28.1a offered them. */
  readonly tools: readonly ToolDefinition[];
  /** The offline Architectural Assistant, for the provider registry. */
  readonly provider: AiProviderAdapter;
  /** What this capability tells the prompt pipeline about the project. */
  readonly contextProvider: ContextProvider;
  /**
   * Where an unfinished Brief lives between turns. The host binds it to the AI
   * session once that exists — late, because the session needs the providers,
   * which need this contribution.
   */
  readonly briefDrafts: BoundBriefDraftStore;
}

export interface ArchitecturalIntelligenceContributionOptions extends ArchitecturalIntelligenceServiceOptions {
  /** Shown in the provider dropdown. Defaults to the adapter's own label. */
  readonly providerLabel?: string;
  readonly providerModels?: readonly string[];
}

/**
 * Builds the service and everything that speaks for it.
 *
 * The tool order is the one `toolBroker` composed before this sprint —
 * Building operations, then Brief, Programme, Layout, Geometry — because
 * `listFunctionSchemas` hands that order to a model, and a reordering is a
 * behaviour change dressed as a refactor.
 */
export function createArchitecturalIntelligenceContribution(
  options: ArchitecturalIntelligenceContributionOptions
): ArchitecturalIntelligenceContribution {
  const { providerLabel, providerModels, ...serviceOptions } = options;
  // Built here rather than by the host: the store is this layer's contract,
  // keyed by this layer's artefact kind, and the host only ever filled it in.
  const briefDrafts = serviceOptions.briefDrafts ?? createSessionBriefDraftStore();
  return contributionFor(
    new ArchitecturalIntelligenceService({ ...serviceOptions, briefDrafts }),
    providerLabel,
    providerModels,
    briefDrafts as BoundBriefDraftStore
  );
}

/**
 * The same contribution around a service the caller already built.
 *
 * For a host that needs the service before it needs the contribution, and for
 * tests that construct one with a hand-made {@link BuildingKnowledge}. Nothing
 * about the result differs — this is the constructor split in two, not a second
 * way to compose.
 */
export function contributionForIntelligence(
  intelligence: ArchitecturalIntelligenceService,
  options: { readonly providerLabel?: string; readonly providerModels?: readonly string[] } = {}
): ArchitecturalIntelligenceContribution {
  return contributionFor(
    intelligence,
    options.providerLabel,
    options.providerModels,
    createSessionBriefDraftStore()
  );
}

function contributionFor(
  intelligence: ArchitecturalIntelligenceService,
  providerLabel: string | undefined,
  providerModels: readonly string[] | undefined,
  briefDrafts: BoundBriefDraftStore
): ArchitecturalIntelligenceContribution {
  return {
    briefDrafts,
    id: ARCHITECTURAL_INTELLIGENCE_CONTRIBUTION_ID,
    intelligence,
    tools: [
      // Sprint 27.8, and first on purpose. It was the *last* entry of the
      // broker's unconditional list and the contributed tools appended directly
      // after it, so leading with it here reproduces the previous order exactly
      // — and `listFunctionSchemas` hands that order to a model, which makes a
      // reordering a behaviour change wearing a refactor's clothes.
      //
      // The one tool here that takes fields, because a Brief is built from what
      // the user said and the model is what read it.
      captureBriefToolDefinition,
      ...createArchitecturalToolDefinitions(intelligence),
      // Sprints 27.9, 28.0 and 28.1a. Each bound to the service because the
      // approved artefact it reads lives behind that service's artefact reader,
      // never in the model's arguments.
      createProgrammeToolDefinition(intelligence),
      createLayoutToolDefinition(intelligence),
      createGeometryToolDefinition(intelligence)
    ],
    contextProvider: createArchitecturalContextProvider(
      intelligence,
      intelligence.buildingKnowledge()
    ),
    provider: createArchitecturalProviderAdapter({
      intelligence,
      ...(providerLabel === undefined ? {} : { label: providerLabel }),
      ...(providerModels === undefined ? {} : { models: providerModels })
    })
  };
}
