/**
 * Where an unfinished Brief lives between turns (Sprint 27.8).
 *
 * A port, in the shape `AiWorkspaceStore` established in Sprint 23.1 and for
 * the same reason: this layer owns no state. A clarification dialogue
 * necessarily spans several messages — the question goes out in one turn and
 * the answer arrives in the next — so *something* has to hold the draft, and
 * making it a field on {@link ArchitecturalIntelligenceService} would have
 * turned a stateless reasoning service into a stateful one on behalf of a
 * single feature.
 *
 * The host backs this with the AI Workspace record, not with the project file:
 * a half-answered Brief is a conversation in progress, and ADR-0027.1 Rule 5
 * promotes an artefact into the project only when it is approved.
 *
 * A session with no store still works. Every request is then classified and
 * answered on its own, which costs the multi-turn dialogue and nothing else —
 * a complete request still produces a complete Brief.
 */

import type { ArchitecturalBrief } from './architectural-brief';

export interface BriefDraftStore {
  /** The open draft, or `undefined` when the last dialogue finished or none has started. */
  load(): ArchitecturalBrief | undefined;
  save(brief: ArchitecturalBrief): void;
  clear(): void;
}

/**
 * An in-memory store.
 *
 * Not a production implementation and not shipped as one — the host's is backed
 * by the AI Workspace record so a draft survives a reload. This exists so the
 * dialogue can be exercised in a test without one, which is what Story 27.8.0's
 * "validated using fake AI providers" needs.
 */
export function createInMemoryBriefDraftStore(): BriefDraftStore {
  let draft: ArchitecturalBrief | undefined;
  return {
    load: () => draft,
    save: (brief) => {
      draft = brief;
    },
    clear: () => {
      draft = undefined;
    }
  };
}
