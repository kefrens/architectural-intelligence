/**
 * The Architectural Assistant provider (Sprint 24.5, Epic 1).
 *
 * An {@link AiProviderAdapter} — the third one, after the Demo Provider and LM
 * Studio — whose "model" is the Architectural Intelligence Service. Extending
 * the AI Provider seam rather than adding a hook to `AiSessionController` is
 * what keeps this sprint's promise that "the AI does not introduce a new
 * execution model": conversations, context assembly, proposals and approval all
 * behave exactly as they did before, and the assistant plugs into the socket
 * that was already there.
 *
 * ```text
 * AiSessionController.sendMessage
 *        v  (AiProviderRequest, unchanged)
 * this adapter
 *        v
 * ArchitecturalIntelligenceService.interpret
 *        v
 * { message, proposal? }  ->  AiProviderResponse
 * ```
 *
 * ## Why local reasoning rather than a model
 *
 * Sprint 24.5 excludes cloud-only AI providers, and an architectural assistant
 * that only works when a language model is reachable would make every one of
 * this sprint's acceptance criteria conditional on a network. This adapter is
 * deterministic, offline and synchronous: the same pipeline a real model
 * reaches through the Tool Registry, driven by pattern matching instead of
 * inference. It is honest about that — the recognizer's own header says so —
 * and it is the reason the whole flow is testable end to end.
 *
 * A language model provider (LM Studio today) reaches the *same* planner
 * through the host's Tool Broker, so both paths produce the same proposals with
 * the same reasoning, assumptions and safety rules. There is one architectural
 * pipeline, not one per provider.
 */

import type {
  AiProviderAdapter,
  AiProviderRequest,
  AiProviderResponse
} from '@archisimple/ai-engine';
import type { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';

export const ARCHITECTURAL_PROVIDER_ID = 'architectural';

export interface CreateArchitecturalProviderAdapterOptions {
  readonly intelligence: ArchitecturalIntelligenceService;
  readonly label?: string;
  readonly models?: readonly string[];
}

export function createArchitecturalProviderAdapter(
  options: CreateArchitecturalProviderAdapterOptions
): AiProviderAdapter {
  const { intelligence } = options;

  return {
    id: ARCHITECTURAL_PROVIDER_ID,
    label: options.label ?? 'Architectural Assistant',
    models: options.models ?? ['architectural-1'],
    sendMessage: async (
      request: AiProviderRequest,
      signal?: AbortSignal
    ): Promise<AiProviderResponse> => {
      // Reasoning is synchronous and fast, but the contract is async and a
      // caller may still have cancelled between composing the request and this
      // running. Honouring the signal costs nothing and keeps the adapter
      // indistinguishable from a slow one.
      if (signal?.aborted === true) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const response = intelligence.interpret(request.userMessage);
      return {
        content: response.message,
        ...(response.proposal === undefined ? {} : { proposal: response.proposal })
      };
    }
  };
}
