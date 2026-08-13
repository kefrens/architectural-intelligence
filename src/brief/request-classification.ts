/**
 * Intent Completeness Analysis (Sprint 27.8, Story 27.8.0).
 *
 * The pipeline's front door: three lanes, chosen deterministically from the
 * user's words before any provider is consulted.
 *
 * ```text
 * "create a wall from 0,0 to 4,0"     -> direct-execution
 * "design a 2-storey, 3-bed, 2-bath   -> brief-generation
 *  family home"
 * "design a family home"              -> clarification-required
 * ```
 *
 * ## Why the default lane is Direct Execution
 *
 * Because the cost of the two mistakes is not symmetric. Sending a genuinely
 * architectural request down the direct lane produces geometry a user can
 * inspect, reject and ask again for. Sending "create a wall" down the brief lane
 * interrupts a working modelling command with an interview, which is the one
 * outcome Story 27.8.3 exists to forbid. So the classifier looks for positive
 * evidence of a *programme* and falls through to the existing pipeline when it
 * finds none — Direct Execution is a lane of this architecture rather than an
 * exception to it (ADR-0027.1 Rule 2), and it is the lane everything shipped
 * before this sprint stays in.
 *
 * ## What counts as evidence
 *
 * A dwelling. `house`, `apartment`, `T4` — a whole building somebody will live
 * in. Not an area, and not the word "design": "create a room of 16 m²" states
 * its own programme and is a modelling command; "how many rooms does my house
 * have?" names a dwelling but asks a question the Building Platform can already
 * answer, and questions are recognised first for exactly that reason.
 */

import { ARCHITECTURAL_INTENT_KINDS } from '../intent/architectural-intent.js';
import { recognizeIntent } from '../intent/intent-recognizer.js';
import { BRIEF_TOPICS } from './architectural-brief.js';
import { DWELLING_WORDS, readBriefTopics } from './brief-topics.js';

export const REQUEST_LANES = {
  /** Straight to the existing pipeline. Everything that worked before this sprint. */
  DirectExecution: 'direct-execution',
  /** Enough was said to write a Brief without asking anything. */
  BriefGeneration: 'brief-generation',
  /** Architectural, but mandatory information is missing. */
  ClarificationRequired: 'clarification-required',
  /**
   * The project has an approved Brief and the user is asking for the programme
   * that follows from it (Sprint 27.9).
   *
   * Reachable only when an approved Brief actually exists — see
   * {@link ClassifyRequestOptions.hasApprovedBrief}. "Show me the spaces" with
   * no brief behind it is not a programme request, it is a question about a
   * project, and it stays in the direct lane where it has always been.
   */
  ProgrammeGeneration: 'programme-generation',
  /**
   * The project has an approved Programme and the user is asking for the layout
   * that follows from it (Sprint 28.0).
   *
   * Guarded the same way the programme lane is, by
   * {@link ClassifyRequestOptions.hasApprovedProgramme} — so it is unreachable
   * for every caller that has not opted in, including every Sprint 27.8 and
   * 27.9 test.
   */
  LayoutGeneration: 'layout-generation',
  /**
   * The project has an approved Layout Plan and the user is asking for the
   * geometry that follows from it (Sprint 28.1a).
   *
   * Guarded like the two lanes above it, by
   * {@link ClassifyRequestOptions.hasApprovedLayout}, so it is unreachable for
   * every caller that has not opted in.
   */
  GeometryGeneration: 'geometry-generation',
  /**
   * The project has an approved Geometry Graph and the user is asking for the
   * buildable specification that follows from it (Sprint 1.2, Story 1.2.1 —
   * ADR-AI-0001 Rule 2).
   *
   * The seventh lane, and the last: the design pipeline has five artefacts and
   * this is the one that reaches the fifth. Until this sprint the stage existed
   * and was reachable only through `planning_generateSpecification` — a model
   * could ask for it and a user could not.
   *
   * Guarded like the three lanes above it, by
   * {@link ClassifyRequestOptions.hasApprovedGeometry}.
   */
  SpecificationGeneration: 'specification-generation',
  /**
   * The project has an approved Brief and the user is changing what they asked
   * for (Sprint 1.3, Story 1.3.6 — ADR-0027.1 Rule 4).
   *
   * The eighth lane, and the only one that reaches *back* up the pipeline. It
   * produces revision n+1 of the approved Brief rather than a second Brief, and
   * everything downstream goes stale as a consequence — which the workflow state
   * has been able to report since Sprint 1.2 and could not be reached until now.
   *
   * Guarded by {@link ClassifyRequestOptions.hasBriefToRevise}, which asks a
   * different question from the four stage gates beside it: not "is the next
   * stage available" but "is there a Brief here to revise at all".
   */
  BriefRevision: 'brief-revision',
  /**
   * The project has an approved Geometry Specification and the user is asking
   * for it to be **built** (Sprint 1.6 — BUG-008 Phase 3; ADR-AI-0002
   * revision 1.3, extension to Rule 8).
   *
   * The ninth lane, and **the first whose subject is not a planning stage.**
   * Every lane above asks for an artefact this layer can produce; this one asks
   * for something only the host can do, and produces the *identity* of the
   * design to build. Approving the proposal reaches ArchiSimple's one
   * realisation entry point (ADR-0032 revision 2.2), which decides whether the
   * build may happen and performs it.
   *
   * Guarded by {@link ClassifyRequestOptions.hasApprovedSpecification}, which —
   * like `hasBriefToRevise` and unlike the four stage gates — asks whether there
   * is something *here*, not whether a stage below may run.
   */
  Realisation: 'realisation'
} as const;

export type RequestLane = (typeof REQUEST_LANES)[keyof typeof REQUEST_LANES];

export interface RequestClassification {
  readonly lane: RequestLane;
  /** One sentence, quotable in an explanation, saying why this lane. */
  readonly reason: string;
  /** The programme evidence found. Empty for Direct Execution. */
  readonly signals: readonly string[];
  /**
   * Mandatory topics the request left out. Non-empty exactly when the lane is
   * {@link REQUEST_LANES.ClarificationRequired}.
   */
  readonly missing: readonly string[];
}

/**
 * The topics a dwelling brief cannot be completed without.
 *
 * Three, and no more. Every additional mandatory topic is another question
 * between the user and their first drawing, and each of these three changes the
 * building fundamentally — there is no defensible default for how many bedrooms
 * somebody wants. Everything else has a default (`brief-assembly.ts`), which is
 * how "clarification stops as soon as the brief is complete" stays true of a
 * short conversation rather than a long one.
 */
export const MANDATORY_BRIEF_TOPICS: readonly string[] = [
  BRIEF_TOPICS.Storeys,
  BRIEF_TOPICS.Bedrooms,
  BRIEF_TOPICS.Bathrooms
];

/** Verbs that ask for a building to be conceived rather than an entity to be drawn. */
const DESIGN_VERBS = /\b(design|plan|lay\s?out|conceive|sketch|propose|create|build|make)\b/i;

export interface ClassifyRequestOptions {
  /**
   * Topics already settled by an earlier turn — the requirements of an open
   * draft. A follow-up that supplies the last missing answer classifies as
   * {@link REQUEST_LANES.BriefGeneration}, not as another round of questions.
   */
  readonly known?: readonly string[];
  /**
   * Whether this project has an approved Architectural Brief (Sprint 27.9).
   *
   * Defaults to `false`, which is what keeps the programme lane invisible to
   * every caller that has not opted in — including every Sprint 27.8 caller and
   * every one of its tests.
   */
  readonly hasApprovedBrief?: boolean;
  /**
   * Whether this project has an approved Space Programme (Sprint 28.0).
   * Defaults to `false`.
   */
  readonly hasApprovedProgramme?: boolean;
  /**
   * Whether this project has an approved Layout Plan (Sprint 28.1a).
   * Defaults to `false`.
   */
  readonly hasApprovedLayout?: boolean;
  /**
   * Whether this project has an approved Geometry Graph (Sprint 1.2).
   * Defaults to `false`.
   */
  readonly hasApprovedGeometry?: boolean;
  /**
   * Whether this project holds an approved Brief that could be revised
   * (Sprint 1.3). Defaults to `false`.
   *
   * **A different question from the four above.** Those ask whether the stage
   * *below* the named artefact can be generated — `hasApprovedBrief` gates the
   * programme lane and therefore means "there is a current Brief to build a
   * programme from". This one asks whether there is a Brief to *change*, which
   * is true even when it has been superseded and false when the project has
   * none. Two questions, two options, rather than one option meaning two things
   * depending on the lane that reads it.
   */
  readonly hasBriefToRevise?: boolean;
  /**
   * Whether this project holds an approved Geometry Specification — a design
   * that could be built (Sprint 1.6). Defaults to `false`.
   *
   * **Approved, not "approved and current"**, which is the third distinct
   * question in this options object. A stale Specification is still a design the
   * user meant to build, and closing the lane on it would answer "build it" with
   * whatever the fall-through happens to produce. Opening the lane lets
   * `interpret` say the design is out of date and name the fix, from the same
   * projection this gate came from (ADR-AI-0002 Rules 8 and 13).
   */
  readonly hasApprovedSpecification?: boolean;
}

/**
 * Since Sprint 1.2 each of these four means **approved _and_ current**, not
 * merely approved (ADR-AI-0002 Rule 7). The service derives them from the
 * workflow-state projection, which is the only place the pipeline's prerequisite
 * rules live — arranging a superseded Programme produces a Layout that is stale
 * on the day it is approved, so the lane closes and the stage above it stays
 * open until the user regenerates.
 *
 * The names did not change because the meaning is the same question asked more
 * precisely, and a caller passing plain booleans still classifies exactly as it
 * did.
 */

/**
 * Words that ask for the programme rather than for a building.
 *
 * Deliberately narrow. This lane is only reachable when an approved Brief
 * exists, so the classifier can afford to want an explicit request — and a
 * user who says something else entirely after approving a Brief has changed the
 * subject, not asked for a programme.
 */
const PROGRAMME_WORDS =
  /\b(space\s+programme|space\s+program|programme|program|room\s+schedule|schedule\s+of\s+accommodation|room\s+list|the\s+spaces)\b/i;

/**
 * Words that ask for the construction rather than for the geometry.
 *
 * ## Why `wall` singular is missing, and stays missing
 *
 * The narrowest word set in this file, and deliberately the narrowest, because
 * this lane is the one that could break Story 27.8.3's promise. "Create a wall
 * from (0,0) to (4,0)" is a modelling command, it says `wall`, and it says
 * `create` — which is in {@link PROGRAMME_VERBS}. A word set containing `wall`
 * would hijack it the moment a project approved its geometry, which is exactly
 * the failure the classifier's direct-lane bias exists to prevent.
 *
 * **Plural only.** A user drawing one wall names one wall; a user asking for the
 * construction of a whole design asks for "the walls". "Move the kitchen wall
 * 200 mm" and every other single-wall command stay in the direct lane by
 * construction rather than by a special case.
 */
const SPECIFICATION_WORDS =
  /\b(walls|wall\s+thickness|thickness|construction|buildable|specification|spec)\b/i;

/**
 * Verbs that ask for the construction to be resolved.
 *
 * Beside {@link PROGRAMME_VERBS} rather than inside it: `give` belongs to "give
 * it walls" and to nothing else in this pipeline, and widening the shared verb
 * set would change three lanes to serve one.
 */
const SPECIFICATION_VERBS = /\b(specify|resolve|thicken|give)\b/i;

/**
 * Words that ask for geometry rather than for the arrangement.
 *
 * Checked before the layout words, for the same reason those are checked before
 * the programme words: a project that already has an approved layout and asks to
 * "draw the rooms" wants the next stage, not the one it has.
 */
const GEOMETRY_WORDS =
  /\b(geometry|geometric|room\s+shapes?|shapes?|polygons?|draw(?:\s+the)?\s+(?:rooms?|plan)|realise|realize|dimensions?|sizes?)\b/i;

/**
 * Words that ask for the layout rather than for the programme.
 *
 * Checked before the programme words, because "arrange the spaces" names both
 * and means the later stage — a project that already has an approved Programme
 * is not asking for another one.
 */
const LAYOUT_WORDS =
  /\b(layout|lay\s?out|plan\s+the\s+spaces|arrangement|arrange|floor\s+plan|floorplan|organise|organize|zoning|circulation)\b/i;

/**
 * Phrases that change a decision rather than ask for a new one (Sprint 1.3).
 *
 * A cue is necessary but never sufficient: the utterance must **also** state a
 * brief topic the reader recognises. Both halves are required for the same
 * reason the specification lane matches only plural `walls` — "actually, move
 * the kitchen wall 200 mm" is a correction *and* a modelling command, and the
 * direct lane is where it belongs. Requiring a brief topic is what tells the two
 * apart mechanically rather than by intuition.
 */
const REVISION_CUES =
  /\b(actually|instead|rather|revise|change|update|correct|make\s+it|no,|scrap|amend)\b/i;

/**
 * Verbs that ask for the approved design to become a building (Sprint 1.6).
 *
 * `make` is absent deliberately: "make it wider" is a modelling command, and the
 * one realisation phrase that uses it — "make it real" — is matched whole by
 * {@link REALISATION_PHRASES} instead of widening the verb set for one idiom.
 */
const REALISATION_VERBS = /\b(build|rebuild|realise|realize|construct|erect|create)\b/i;

/** Whole phrases a verb set cannot express without becoming dangerous. */
const REALISATION_PHRASES = /\bturn\b[^.]*\binto\b|\bmake\s+it\s+real\b/i;

/**
 * What a realisation request is *about*: the design as a whole.
 *
 * `it` and `this` are here because "build it" is the phrase the whole of BUG-008
 * is about, and after an approved Specification there is exactly one thing "it"
 * can mean. What keeps that safe is {@link AUTHORING_SUBJECTS} below, not
 * narrowness here.
 */
const REALISATION_SUBJECTS =
  /\b(it|this|that|everything|the\s+(approved\s+)?(design|specification|spec|plan|project)|the\s+(building|house|home|apartment|flat|dwelling))\b/i;

/**
 * Naming an element makes it a modelling command, not a realisation.
 *
 * The same reasoning as `SPECIFICATION_WORDS` matching plural `walls` and never
 * singular `wall`, applied to the whole lane: "create a wall from (0,0) to
 * (4,0)" contains a realisation verb and the word `a wall`, and it is Story
 * 27.8.3's canonical thing-that-must-not-be-hijacked. A user asking for the
 * building does not name a component of it.
 */
const AUTHORING_SUBJECTS =
  /\b(walls?|doors?|windows?|openings?|rooms?|partitions?|slabs?|roofs?|stairs?|floors?|ceilings?|columns?|beams?)\b/i;

/** Verbs that ask for something to be produced from what already exists. */
const PROGRAMME_VERBS =
  /\b(generate|create|build|make|write|draw\s+up|produce|prepare|work\s+out|now|next|continue|proceed|go\s+ahead)\b/i;

export function classifyRequest(
  utterance: string,
  options: ClassifyRequestOptions = {}
): RequestClassification {
  const trimmed = utterance.trim();

  // Questions first. "How many bedrooms does my house have?" names a dwelling
  // and is emphatically not a request to design one — and the Building
  // Platform can answer it today, which is the definition of Direct Execution.
  if (recognizeIntent(trimmed).kind === ARCHITECTURAL_INTENT_KINDS.Question) {
    return direct('This is a question about the existing project.');
  }

  // The realisation lane (Sprint 1.6), checked **before every stage lane** —
  // which inverts the ordering the four below it follow, and does so
  // deliberately.
  //
  // Those four are ordered by pipeline position because each asks for the stage
  // above the one it names. Realisation is not a stage: it asks for the finished
  // design to be built, and every stage stays *eligible* once approved because
  // regeneration is always available. So in exactly the project where a user
  // says "build it" — one that has approved all five stages — the geometry and
  // specification lanes are still open, and `realise the design` and `create the
  // building from this specification` would both regenerate part of the design
  // the user is asking to build (Sprint 1.6 §2.2, measured before it was fixed).
  if (options.hasApprovedSpecification === true && isRealisationRequest(trimmed)) {
    return {
      lane: REQUEST_LANES.Realisation,
      reason: 'This asks for the approved design to be built.',
      signals: ['approved specification'],
      missing: []
    };
  }

  // The specification lane (Sprint 1.2), checked before the geometry lane and
  // for the same reason that one is checked before the layout lane: a project
  // that has approved its geometry and asks to "give it walls" wants the stage
  // it does not have.
  if (options.hasApprovedGeometry === true && SPECIFICATION_WORDS.test(trimmed)) {
    if (PROGRAMME_VERBS.test(trimmed) || SPECIFICATION_VERBS.test(trimmed)) {
      return {
        lane: REQUEST_LANES.SpecificationGeneration,
        reason: 'This asks for the construction, and a geometry graph has been approved.',
        signals: ['approved geometry'],
        missing: []
      };
    }
    return direct('This mentions the construction but asks for nothing to be produced.');
  }

  // The geometry lane (Sprint 28.1a), checked before the layout lane.
  if (options.hasApprovedLayout === true && GEOMETRY_WORDS.test(trimmed)) {
    if (PROGRAMME_VERBS.test(trimmed) || /\bdraw|realise|realize\b/i.test(trimmed)) {
      return {
        lane: REQUEST_LANES.GeometryGeneration,
        reason: 'This asks for geometry, and a layout plan has been approved.',
        signals: ['approved layout'],
        missing: []
      };
    }
    return direct('This mentions geometry but asks for nothing to be produced.');
  }

  // The layout lane (Sprint 28.0), checked before the programme lane: a project
  // with an approved programme that asks to "arrange the spaces" wants the next
  // stage, not the one it already has.
  if (options.hasApprovedProgramme === true && LAYOUT_WORDS.test(trimmed)) {
    if (PROGRAMME_VERBS.test(trimmed) || /\barrange|organise|organize\b/i.test(trimmed)) {
      return {
        lane: REQUEST_LANES.LayoutGeneration,
        reason: 'This asks for the layout, and a space programme has been approved.',
        signals: ['approved programme'],
        missing: []
      };
    }
    return direct('This mentions the layout but asks for nothing to be produced.');
  }

  // The programme lane (Sprint 27.9), checked before the dwelling test because
  // "now write the programme for my house" names a dwelling *and* asks for the
  // next stage — and re-briefing a project that already has an approved brief
  // is the one thing the user cannot have meant.
  if (options.hasApprovedBrief === true && PROGRAMME_WORDS.test(trimmed)) {
    if (PROGRAMME_VERBS.test(trimmed)) {
      return {
        lane: REQUEST_LANES.ProgrammeGeneration,
        reason: 'This asks for the space programme, and a brief has been approved.',
        signals: ['approved brief'],
        missing: []
      };
    }
    // "What is in the programme?" is a question about an artefact, not a request
    // to build one, and this sprint has nothing that answers it.
    return direct('This mentions the programme but asks for nothing to be produced.');
  }

  // The revision lane (Sprint 1.3), checked before the dwelling test because
  // "actually make it a three-storey house" names a dwelling *and* a design
  // verb, and would otherwise assemble a second Brief for a project that
  // already has one — which is the lineage split this sprint exists to end.
  if (options.hasBriefToRevise === true && REVISION_CUES.test(trimmed)) {
    const restated = readBriefTopics(trimmed);
    if (restated.length > 0) {
      return {
        lane: REQUEST_LANES.BriefRevision,
        reason: 'This changes something the approved brief already states.',
        signals: restated.map((requirement) => requirement.topic),
        missing: []
      };
    }
    // A revision cue with no brief topic in it — "actually, move the kitchen
    // wall". The user is changing their mind about something that is not in the
    // Brief, and the direct lane is where that has always gone.
    return direct('This asks for a change, but names nothing the brief states.');
  }

  const signals: string[] = [];
  const dwelling = trimmed.match(DWELLING_WORDS);
  if (dwelling) {
    signals.push(dwelling[0].toLowerCase());
  }
  const typology = trimmed.match(/\b[TF]\s?[1-9]\b/i);
  if (typology) {
    signals.push(typology[0].toUpperCase());
  }

  if (signals.length === 0) {
    return direct('No whole dwelling is named, so this is a modelling request.');
  }

  // A dwelling can also be *mentioned* in a modelling command — "move the
  // kitchen in my house 2 m north". Requiring a design verb as well is what
  // keeps that in the direct lane.
  if (!DESIGN_VERBS.test(trimmed)) {
    return direct('A dwelling is mentioned, but nothing is asked to be designed.');
  }

  const stated = readBriefTopics(trimmed);
  const answered = new Set([
    ...stated.map((requirement) => requirement.topic),
    ...(options.known ?? [])
  ]);
  const missing = MANDATORY_BRIEF_TOPICS.filter((topic) => !answered.has(topic));

  if (missing.length > 0) {
    return {
      lane: REQUEST_LANES.ClarificationRequired,
      reason: `This is a design request, and ${missing.length === 1 ? 'one mandatory topic is' : `${missing.length} mandatory topics are`} unanswered.`,
      signals,
      missing
    };
  }

  return {
    lane: REQUEST_LANES.BriefGeneration,
    reason: 'This is a design request and every mandatory topic is answered.',
    signals,
    missing: []
  };
}

function direct(reason: string): RequestClassification {
  return { lane: REQUEST_LANES.DirectExecution, reason, signals: [], missing: [] };
}

/**
 * Whether this utterance asks for the approved design to be built (Sprint 1.6).
 *
 * Three conditions, and the third is the one that keeps Story 27.8.3's promise:
 *
 * 1. a verb that asks for construction, or a whole phrase that does;
 * 2. a subject that is the design *as a whole*;
 * 3. **no element named.** "Build a wall here" satisfies the first two and is a
 *    modelling command; naming a component is how a user says they mean one.
 */
function isRealisationRequest(utterance: string): boolean {
  if (AUTHORING_SUBJECTS.test(utterance)) {
    return false;
  }
  if (REALISATION_PHRASES.test(utterance)) {
    return true;
  }
  return REALISATION_VERBS.test(utterance) && REALISATION_SUBJECTS.test(utterance);
}
