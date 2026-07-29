/**
 * The Intent Recognizer (Sprint 24.5, Story 24.5.1).
 *
 * Turns "Move the kitchen 2 m north" into an {@link ArchitecturalIntent}. It is
 * ordered pattern matching over a fixed rule table — not natural-language
 * understanding — and this file is deliberate about saying so, exactly as
 * `ai-engine`'s Demo Provider is about its own canned replies. Two reasons it
 * is worth having anyway:
 *
 * 1. **It is the offline path.** The Architectural Assistant provider
 *    (`provider/architectural-provider-adapter.ts`) runs with no network and no
 *    model, so the sprint's whole pipeline — understand, inspect, plan,
 *    propose — is exercisable, testable and demonstrable without one.
 * 2. **It is the shared vocabulary.** A real language model reaches the same
 *    operations through the Tool Registry, and both paths end in the same
 *    {@link ArchitecturalIntent} → plan → Proposal chain. There is one planner,
 *    not one per provider.
 *
 * ## What it deliberately does not do
 *
 * It resolves nothing. "the kitchen" comes out as a `named` target carrying the
 * word `kitchen`, whether or not a room by that name exists — see
 * `architectural-intent.ts` for why that separation matters to Story 24.5.11.
 *
 * It also never guesses a missing parameter. "Move the kitchen", with no
 * distance and no direction, is `Ambiguous` rather than a move by some invented
 * default: a proposal the user did not ask for is worse than a question.
 */

import {
  ARCHITECTURAL_ACTIONS,
  ARCHITECTURAL_INTENT_KINDS,
  createIntent,
  INTENT_TARGET_KINDS,
  NO_INTENT_TARGET,
  type ArchitecturalIntent,
  type ArchitecturalIntentKind,
  type IntentTarget
} from './architectural-intent';

/** The document's internal unit. Every distance parameter is normalised to it. */
const MILLIMETRES_PER_METRE = 1000;
const MILLIMETRES_PER_CENTIMETRE = 10;

/**
 * Words that point at the current selection rather than name something.
 * "here" is included: "Add a window here" means the current context, and the
 * only thing the platform can read as "here" is what is selected.
 */
const SELECTION_WORDS =
  /\b(this|these|those|it|them|here|current(?:ly)?\s+selected|the\s+select(?:ed|ion))\b/i;

/** Object kinds a phrase can name, mapped to the Building Model's kind strings. */
const OBJECT_KIND_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\brooms?\b|\bspaces?\b/i, 'Room'],
  [/\bwalls?\b|\bpartitions?\b/i, 'Wall'],
  [/\bwindows?\b|\bdoors?\b|\bopenings?\b/i, 'Opening'],
  [/\bfloors?\b|\blevels?\b|\bstor(?:e?y|ies)\b/i, 'Floor']
];

function objectKindOf(utterance: string): string | undefined {
  for (const [pattern, kind] of OBJECT_KIND_WORDS) {
    if (pattern.test(utterance)) {
      return kind;
    }
  }
  return undefined;
}

/**
 * The named thing a phrase is about, if it named one.
 *
 * `subject` is whatever the rule captured after its verb ("the kitchen", "this
 * room", "kitchen"). A capture that is only a kind word ("room", "wall") or a
 * selection word is *not* a name — "Move this room" points at the selection,
 * and treating "room" as a room called "room" would send the resolver looking
 * for something that cannot exist.
 */
function targetFrom(utterance: string, subject: string | undefined): IntentTarget {
  const kind = objectKindOf(utterance);
  const cleaned = (subject ?? '').trim().replace(/^(?:the|my|our|a|an)\s+/i, '');

  if (cleaned.length > 0 && !SELECTION_WORDS.test(cleaned) && objectKindOf(cleaned) === undefined) {
    return {
      kind: INTENT_TARGET_KINDS.Named,
      name: cleaned,
      ...(kind === undefined ? {} : { objectKind: kind })
    };
  }
  if (SELECTION_WORDS.test(utterance)) {
    return {
      kind: INTENT_TARGET_KINDS.Selection,
      ...(kind === undefined ? {} : { objectKind: kind })
    };
  }
  return kind === undefined
    ? NO_INTENT_TARGET
    : { kind: INTENT_TARGET_KINDS.None, objectKind: kind };
}

/** A distance in millimetres, or `undefined` when the phrase named none. */
function distanceMillimetres(utterance: string): number | undefined {
  const match =
    /(\d+(?:[.,]\d+)?)\s*(mm|millimetres?|millimeters?|cm|centimetres?|centimeters?|m|metres?|meters?)\b/i.exec(
      utterance
    );
  if (match === null) {
    return undefined;
  }
  const amount = Number(match[1]!.replace(',', '.'));
  if (!Number.isFinite(amount)) {
    return undefined;
  }
  const unit = match[2]!.toLowerCase();
  if (unit.startsWith('mm') || unit.startsWith('milli')) {
    return amount;
  }
  if (unit.startsWith('cm') || unit.startsWith('centi')) {
    return amount * MILLIMETRES_PER_CENTIMETRE;
  }
  return amount * MILLIMETRES_PER_METRE;
}

/**
 * A unit direction in world axes, or `undefined`.
 *
 * `+x` is east/right and `+y` is north/up, matching how the floor plan's world
 * coordinates are already read everywhere else in the application.
 */
const DIRECTIONS: readonly (readonly [RegExp, { readonly x: number; readonly y: number }])[] = [
  [/\b(?:north|up|upwards?)\b/i, { x: 0, y: 1 }],
  [/\b(?:south|down|downwards?)\b/i, { x: 0, y: -1 }],
  [/\b(?:east|right)\b/i, { x: 1, y: 0 }],
  [/\b(?:west|left)\b/i, { x: -1, y: 0 }]
];

function directionOf(utterance: string): { readonly x: number; readonly y: number } | undefined {
  for (const [pattern, vector] of DIRECTIONS) {
    if (pattern.test(utterance)) {
      return vector;
    }
  }
  return undefined;
}

/** A compass word named anywhere in the phrase — what an orientation question is asking about. */
function compassOf(utterance: string): string | undefined {
  const match = /\b(north|south|east|west)\b/i.exec(utterance);
  return match === null ? undefined : match[1]!.toLowerCase();
}

interface RecognitionRule {
  readonly action: string;
  readonly kind: ArchitecturalIntentKind;
  readonly pattern: RegExp;
  /**
   * A veto. A phrase matching this is *not* this rule's, even if `pattern`
   * matched — the escape hatch for vocabulary that appears on both sides of the
   * question/modification split. "load-bearing" is the case that forces it to
   * exist: it names a question ("which walls are load-bearing?") and a property
   * to set ("make this wall load-bearing"), and question rules are tried first.
   */
  readonly unless?: RegExp;
  /**
   * Pulls the rule's parameters out of the phrase. Returning `undefined` for a
   * parameter the rule needs is what makes an intent `Ambiguous` — see
   * {@link REQUIRED_PARAMETERS}.
   */
  readonly parameters?: (
    utterance: string,
    match: RegExpExecArray
  ) => Readonly<Record<string, unknown>>;
}

/**
 * Parameters an action cannot proceed without.
 *
 * A recognised action whose required parameters did not appear in the phrase
 * becomes `Ambiguous` carrying the same action, so the assistant can name
 * exactly what is missing (Story 24.5.11's "missing information") instead of
 * falling back to "I did not understand".
 */
const REQUIRED_PARAMETERS: Readonly<Record<string, readonly string[]>> = {
  [ARCHITECTURAL_ACTIONS.moveRoom]: ['deltaX', 'deltaY'],
  [ARCHITECTURAL_ACTIONS.renameRoom]: ['newName'],
  [ARCHITECTURAL_ACTIONS.setWallProperty]: ['property', 'value']
};

/**
 * Ordered: the first rule that matches wins.
 *
 * Questions come before modifications because a question can contain a
 * modification's verb without asking for one ("how big can I make this room?"),
 * and the more specific modification rules come before the more general ones
 * ("make this room larger" is a resize, not a wall property change).
 */
const RULES: readonly RecognitionRule[] = [
  // --- Epic 2: questions about the building -------------------------------
  {
    action: ARCHITECTURAL_ACTIONS.roomCount,
    kind: ARCHITECTURAL_INTENT_KINDS.Question,
    pattern: /\bhow\s+many\s+(?:rooms?|spaces?)\b/i
  },
  {
    action: ARCHITECTURAL_ACTIONS.loadBearingWalls,
    kind: ARCHITECTURAL_INTENT_KINDS.Question,
    pattern: /\bload[\s-]?bearing\b/i,
    unless: /\b(?:set|make|change|turn|mark)\b/i
  },
  {
    action: ARCHITECTURAL_ACTIONS.naturalLight,
    kind: ARCHITECTURAL_INTENT_KINDS.Question,
    pattern: /\bnatural\s+light\b|\bdaylight\b|\bno\s+windows?\b/i
  },
  {
    action: ARCHITECTURAL_ACTIONS.openingOrientation,
    kind: ARCHITECTURAL_INTENT_KINDS.Question,
    pattern: /\b(?:windows?|doors?|openings?)\b[^?]*\b(?:face|facing|orientation|oriented)\b/i,
    parameters: (utterance) => {
      const compass = compassOf(utterance);
      return compass === undefined ? {} : { compass };
    }
  },
  {
    action: ARCHITECTURAL_ACTIONS.roomAdjacency,
    kind: ARCHITECTURAL_INTENT_KINDS.Question,
    pattern:
      /\b(?:adjacent|adjoins?|adjoining|next\s+to|neighbours?|neighbors?|neighbouring|neighboring)\b/i,
    parameters: (utterance) => {
      const match = /\b(?:to|of)\s+(?:the\s+)?([\w' -]+?)\s*\??$/i.exec(utterance);
      return match === null ? {} : { subject: match[1]! };
    }
  },
  {
    action: ARCHITECTURAL_ACTIONS.floorArea,
    kind: ARCHITECTURAL_INTENT_KINDS.Question,
    pattern: /\b(?:floor\s+area|total\s+area|surface\s+area|how\s+(?:big|large)\b)/i,
    parameters: (utterance) => {
      const match = /\b(?:of|is)\s+(?:the\s+)?([\w' -]+?)\s*\??$/i.exec(utterance);
      return match === null ? {} : { subject: match[1]! };
    }
  },
  {
    action: ARCHITECTURAL_ACTIONS.describeSelection,
    kind: ARCHITECTURAL_INTENT_KINDS.Question,
    pattern: /\b(?:what|which)\b[^?]*\bselect(?:ed|ion)\b/i
  },
  {
    action: ARCHITECTURAL_ACTIONS.projectOverview,
    kind: ARCHITECTURAL_INTENT_KINDS.Question,
    pattern:
      /\b(?:describe|summar(?:y|ise|ize)|overview|tell\s+me\s+about)\b[^?]*\b(?:project|building|plan|design)\b/i
  },

  // --- Epic 3: modifications ------------------------------------------------
  {
    action: ARCHITECTURAL_ACTIONS.renameRoom,
    kind: ARCHITECTURAL_INTENT_KINDS.Modification,
    pattern:
      /\b(?:rename|re-name)\s+(?<subject>[\w' -]+?)(?:\s+(?:to|as)\s+(?<newName>.+?))?\s*[.!?]?$/i,
    parameters: (_utterance, match) => {
      const newName = match.groups?.['newName']?.trim();
      return newName === undefined || newName.length === 0 ? {} : { newName: unquote(newName) };
    }
  },
  {
    action: ARCHITECTURAL_ACTIONS.renameRoom,
    kind: ARCHITECTURAL_INTENT_KINDS.Modification,
    pattern:
      /\b(?:call|name)\s+(?<subject>this|it|these|the\s+[\w' -]+?)\s+(?<newName>.+?)\s*[.!?]?$/i,
    parameters: (_utterance, match) => {
      const newName = match.groups?.['newName']?.trim();
      return newName === undefined || newName.length === 0 ? {} : { newName: unquote(newName) };
    }
  },
  {
    action: ARCHITECTURAL_ACTIONS.resizeRoom,
    kind: ARCHITECTURAL_INTENT_KINDS.Modification,
    pattern:
      /\b(?:make|resize|enlarge|expand|shrink|grow)\b[^.!?]*\b(?:room|space|kitchen|bedroom|bathroom|hall)\b[^.!?]*\b(?:larger|bigger|smaller|wider|narrower)?\b|\b(?:enlarge|shrink|resize)\b/i,
    parameters: (utterance) => {
      const distance = distanceMillimetres(utterance);
      return distance === undefined ? {} : { distanceMm: distance };
    }
  },
  {
    action: ARCHITECTURAL_ACTIONS.addOpening,
    kind: ARCHITECTURAL_INTENT_KINDS.Modification,
    pattern: /\b(?:add|insert|place|put)\b[^.!?]*\b(?<opening>window|door|opening)s?\b/i,
    parameters: (_utterance, match) => ({
      openingType: (match.groups?.['opening'] ?? 'opening').toLowerCase()
    })
  },
  {
    action: ARCHITECTURAL_ACTIONS.alignWalls,
    kind: ARCHITECTURAL_INTENT_KINDS.Modification,
    pattern: /\balign\b/i,
    parameters: (utterance) => {
      const axis = /\bvertical(?:ly)?\b/i.test(utterance)
        ? 'x'
        : /\bhorizontal(?:ly)?\b/i.test(utterance)
          ? 'y'
          : undefined;
      return axis === undefined ? {} : { axis };
    }
  },
  {
    action: ARCHITECTURAL_ACTIONS.setWallProperty,
    kind: ARCHITECTURAL_INTENT_KINDS.Modification,
    pattern:
      /\b(?:set|make|change)\b[^.!?]*\b(?<property>thickness|height|load[\s-]?bearing|thicker|thinner|taller|shorter)\b/i,
    parameters: (utterance, match) => wallPropertyParameters(utterance, match.groups?.['property'])
  },
  {
    action: ARCHITECTURAL_ACTIONS.moveRoom,
    kind: ARCHITECTURAL_INTENT_KINDS.Modification,
    pattern:
      /\b(?:move|shift|translate|displace)\s+(?<subject>[\w' -]+?)(?=\s+(?:\d|north|south|east|west|up|down|left|right|by)|\s*[.!?]?$)/i,
    parameters: (utterance) => {
      const distance = distanceMillimetres(utterance);
      const direction = directionOf(utterance);
      if (distance === undefined || direction === undefined) {
        return {};
      }
      return { deltaX: direction.x * distance, deltaY: direction.y * distance };
    }
  },
  {
    action: ARCHITECTURAL_ACTIONS.deleteSelection,
    kind: ARCHITECTURAL_INTENT_KINDS.Modification,
    pattern: /\b(?:delete|remove|erase|get\s+rid\s+of)\b/i
  }
];

/** Strips a single layer of surrounding quotes a user typed around a new name. */
function unquote(value: string): string {
  return value.replace(/^["'“”']+|["'“”']+$/g, '').trim();
}

/**
 * Which wall property is being changed, and to what.
 *
 * The comparative forms ("thicker", "taller") name a property but not a value,
 * so they resolve to the property with no `value` — which makes the intent
 * `Ambiguous` and lets the assistant ask "how thick?" rather than picking a
 * number the user never said.
 */
function wallPropertyParameters(
  utterance: string,
  property: string | undefined
): Readonly<Record<string, unknown>> {
  const normalised = (property ?? '').toLowerCase().replace(/[\s-]/g, '');
  if (normalised === 'loadbearing') {
    const negated = /\b(?:not|non|no longer|stop being)\b/i.test(utterance);
    return { property: 'loadBearing', value: !negated };
  }

  const key =
    normalised === 'thickness' || normalised === 'thicker' || normalised === 'thinner'
      ? 'thickness'
      : 'height';
  // The Inspector's wall properties are in metres (see the Building Inspector
  // Provider's bounds), so this is the one place a phrase's millimetres are
  // converted back rather than forward.
  const millimetres = distanceMillimetres(utterance);
  return millimetres === undefined
    ? { property: key }
    : { property: key, value: millimetres / MILLIMETRES_PER_METRE };
}

/**
 * Reads one utterance.
 *
 * Always answers: an unrecognised phrase becomes an `Unknown` intent rather
 * than `undefined`, so every path downstream has something to explain from.
 */
export function recognizeIntent(utterance: string): ArchitecturalIntent {
  const trimmed = utterance.trim();

  for (const rule of RULES) {
    if (rule.unless?.test(trimmed) === true) {
      continue;
    }
    const match = rule.pattern.exec(trimmed);
    if (match === null) {
      continue;
    }

    const parameters = rule.parameters?.(trimmed, match) ?? {};
    const subject = match.groups?.['subject'] ?? (parameters['subject'] as string | undefined);
    const missing = (REQUIRED_PARAMETERS[rule.action] ?? []).filter(
      (name) => parameters[name] === undefined
    );

    return createIntent({
      kind: missing.length > 0 ? ARCHITECTURAL_INTENT_KINDS.Ambiguous : rule.kind,
      action: rule.action,
      utterance: trimmed,
      target: targetFrom(trimmed, subject),
      parameters: missing.length > 0 ? { ...parameters, missing } : parameters
    });
  }

  return createIntent({
    kind: ARCHITECTURAL_INTENT_KINDS.Unknown,
    action: 'unknown',
    utterance: trimmed,
    target: targetFrom(trimmed, undefined)
  });
}
