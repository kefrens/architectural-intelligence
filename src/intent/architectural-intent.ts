/**
 * The Architectural Intent (Sprint 24.5, Epic 1).
 *
 * What the user is asking for, once the words have been read but before
 * anything has been looked up. An intent names an `action` and, when the
 * request pointed at something, a {@link IntentTarget} describing *what* — by
 * selection ("this room") or by name ("the kitchen"). It resolves nothing: the
 * kitchen may not exist, and finding out is the understanding layer's job
 * (`understanding/building-knowledge.ts`), not this one's.
 *
 * Splitting recognition from resolution is what makes "I do not know what you
 * mean" and "I know what you mean but there is no kitchen" two different
 * answers, which Story 24.5.11 needs them to be.
 *
 * Actions are plain strings rather than a closed enum on purpose: the
 * built-in ones are listed in {@link ARCHITECTURAL_ACTIONS} for readability,
 * but an {@link import('../planning/architectural-operation').ArchitecturalOperationProvider}
 * contributed by a plugin declares its own, and the planner dispatches on the
 * string. A closed union here would make the extension point a lie.
 */

/**
 * What kind of thing the user asked for.
 *
 * `Ambiguous` and `Unknown` are outcomes, not failures: they carry the same
 * intent shape as the others so Story 24.5.11's "explain why this cannot be
 * completed" has something structured to explain from.
 */
export const ARCHITECTURAL_INTENT_KINDS = {
  /** A read: the answer is information, and nothing is proposed. */
  Question: 'question',
  /** A write: the answer is a Proposal the user may approve. */
  Modification: 'modification',
  /** Recognised, but the request left out something needed to act on it. */
  Ambiguous: 'ambiguous',
  /** Not recognised at all. */
  Unknown: 'unknown'
} as const;

export type ArchitecturalIntentKind =
  (typeof ARCHITECTURAL_INTENT_KINDS)[keyof typeof ARCHITECTURAL_INTENT_KINDS];

/** How the request pointed at the thing it is about. */
export const INTENT_TARGET_KINDS = {
  /** "this room", "these walls" — resolve against the current selection. */
  Selection: 'selection',
  /** "the kitchen" — resolve by name against the Building Model. */
  Named: 'named',
  /** The request is about the project as a whole, or about nothing in particular. */
  None: 'none'
} as const;

export type IntentTargetKind = (typeof INTENT_TARGET_KINDS)[keyof typeof INTENT_TARGET_KINDS];

export interface IntentTarget {
  readonly kind: IntentTargetKind;
  /** Present for `named` targets — the words the user used, not a resolved id. */
  readonly name?: string;
  /** `Room`, `Wall`, `Opening`, … when the request said which; absent when it did not. */
  readonly objectKind?: string;
}

export const NO_INTENT_TARGET: IntentTarget = { kind: INTENT_TARGET_KINDS.None };

export interface ArchitecturalIntent {
  readonly kind: ArchitecturalIntentKind;
  /** The action id a question answerer or an operation provider dispatches on. */
  readonly action: string;
  /** The user's words, kept verbatim so an explanation can quote them back. */
  readonly utterance: string;
  readonly target: IntentTarget;
  /** Whatever the phrasing carried — a distance, a property name, a new name. */
  readonly parameters: Readonly<Record<string, unknown>>;
}

/**
 * The action ids the built-in recognizer produces and the built-in question
 * answerer and operation providers respond to.
 *
 * Two namespaces, because they are answered by different halves of the
 * platform: `question.*` is answered from the Building Platform and proposes
 * nothing; `edit.*` becomes a plan and then a Proposal.
 */
export const ARCHITECTURAL_ACTIONS = {
  // --- Questions (Epic 2) ---
  roomCount: 'question.roomCount',
  loadBearingWalls: 'question.loadBearingWalls',
  floorArea: 'question.floorArea',
  roomAdjacency: 'question.roomAdjacency',
  projectOverview: 'question.projectOverview',
  describeSelection: 'question.describeSelection',
  openingOrientation: 'question.openingOrientation',
  naturalLight: 'question.naturalLight',

  // --- Modifications (Epic 3) ---
  moveRoom: 'edit.moveRoom',
  renameRoom: 'edit.renameRoom',
  setWallProperty: 'edit.setWallProperty',
  alignWalls: 'edit.alignWalls',
  deleteSelection: 'edit.deleteSelection',
  resizeRoom: 'edit.resizeRoom',
  addOpening: 'edit.addOpening'
} as const;

export type ArchitecturalAction =
  (typeof ARCHITECTURAL_ACTIONS)[keyof typeof ARCHITECTURAL_ACTIONS];

export function createIntent(input: {
  readonly kind: ArchitecturalIntentKind;
  readonly action: string;
  readonly utterance: string;
  readonly target?: IntentTarget;
  readonly parameters?: Readonly<Record<string, unknown>>;
}): ArchitecturalIntent {
  return {
    kind: input.kind,
    action: input.action,
    utterance: input.utterance,
    target: input.target ?? NO_INTENT_TARGET,
    parameters: input.parameters ?? {}
  };
}

/** Whether this intent is one the planner should try to turn into a Proposal. */
export function isModification(intent: ArchitecturalIntent): boolean {
  return intent.kind === ARCHITECTURAL_INTENT_KINDS.Modification;
}
