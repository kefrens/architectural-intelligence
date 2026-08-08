/**
 * The Brief draft store, bound to the AI session (Sprint 27.8, moved here by
 * Sprint 29.1).
 *
 * An unfinished Brief belongs to the conversation, not to the project — so its
 * home is the AI Workspace record, reached through the session controller that
 * already owns it. The approved counterpart lives in the project file instead,
 * and that split is the point (ADR-0027.1 Rules 4 and 5).
 *
 * It lived in `apps/web/src/ai/planningArtefacts.ts` until ADR-0029 Rule 2.
 * Nothing about it was ever host-specific: it needs `AiSessionController` from
 * `@archisimple/ai-engine`, which this package already depends on, and the
 * Brief kind, which this package owns. Keeping it in the composition root only
 * forced the host to import `ARCHITECTURAL_BRIEF_KIND` and `ArchitecturalBrief`
 * to fill in a store this layer defined.
 */

import type { AiSessionController } from '@archisimple/ai-engine';
import { ARCHITECTURAL_BRIEF_KIND, type ArchitecturalBrief } from './architectural-brief.js';
import type { BriefDraftStore } from './brief-draft-store.js';

/**
 * The draft store, bound to the AI session that holds the workspace record.
 *
 * Late-bound on purpose. The Architectural Intelligence Service is built with
 * the rest of the infrastructure, and the session controller is built after it
 * — it needs the providers, which need the service. Rather than invert that
 * order for one field, the store is created empty and bound once the session
 * exists; until then it simply has no draft, which is the same behaviour a
 * session with no store at all has.
 *
 * Writing through the controller rather than to the workspace store directly
 * matters: the controller holds the record in memory and saves it whole, so a
 * second writer would have its changes overwritten by the next message.
 */
export interface BoundBriefDraftStore extends BriefDraftStore {
  bind(controller: AiSessionController): void;
}

export function createSessionBriefDraftStore(): BoundBriefDraftStore {
  let session: AiSessionController | undefined;

  return {
    bind: (controller) => {
      session = controller;
    },
    load: () => session?.draft(ARCHITECTURAL_BRIEF_KIND)?.value as ArchitecturalBrief | undefined,
    save: (brief) => {
      session?.putDraft({
        kind: ARCHITECTURAL_BRIEF_KIND,
        id: brief.id,
        revision: brief.revision,
        value: brief
      });
    },
    clear: () => {
      session?.clearDraft(ARCHITECTURAL_BRIEF_KIND);
    }
  };
}
