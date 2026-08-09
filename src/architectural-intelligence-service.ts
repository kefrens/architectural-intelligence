/**
 * The Architectural Intelligence Service (Sprint 24.5, Architecture Delta).
 *
 * The one new platform capability this sprint introduces, and the coordinator
 * the sprint's own pipeline diagram names:
 *
 * ```text
 * User Request
 *      v
 * AI Workspace
 *      v
 * Architectural Intelligence   <- you are here
 *      v
 * Building Platform            (Building / Spatial / Inspector, via BuildingKnowledge)
 *      v
 * Automation Platform          (the Requests a plan carries)
 *      v
 * Proposal Workflow            (approve / reject, in ai-engine)
 *      v
 * Runtime
 * ```
 *
 * Four responsibilities, in order, and nothing else:
 *
 * 1. **Understand the intent** — `recognizeIntent`.
 * 2. **Inspect the Building Model** — `BuildingKnowledge`, on demand, read-only.
 * 3. **Build an execution plan** — `ArchitecturalPlanner` and its providers.
 * 4. **Generate a Proposal** — `toProposal`, handed to the existing workflow.
 *
 * ## What it owns
 *
 * No project state, no document access, no execution. It holds a knowledge
 * facade and a planner; neither holds a `CommandDispatcher`. Every write in
 * this sprint happens in exactly the place writes already happened before it:
 * `AiSessionController.approveProposal`, dispatching through the Automation
 * API. That is why "Automation remains the single execution mechanism" is a
 * structural property here rather than a rule someone has to remember.
 *
 * ## Why questions and modifications share one entry point
 *
 * Because a user does not label their messages. `interpret` reads one utterance
 * and answers with whichever of the two it turned out to be — or with an
 * explanation of why it can be neither (Story 24.5.11). A caller renders an
 * {@link ArchitecturalResponse} without having to decide first what kind of
 * thing it asked for.
 *
 * ## The front door (Sprint 27.8)
 *
 * That same argument is why Intent Completeness Analysis went *here* rather than
 * into the provider adapter or the AI Workspace panel. A user does not label a
 * message "this one is a programme" either, so `interpret` now classifies first
 * and routes into one of ADR-0027.1's three lanes:
 *
 * ```text
 * interpret(utterance)
 *   |
 *   |-- an open clarification dialogue?  -> fold the answer into the draft
 *   |
 *   |-- direct-execution      -> interpretIntent, exactly as before this sprint
 *   |-- brief-generation      -> an Architectural Brief, offered for approval
 *   |-- clarification-required-> one focused question, draft kept for next turn
 *   |-- programme-generation  -> a Space Programme from the approved Brief (27.9)
 *   |-- layout-generation     -> a Layout Plan from the approved Programme (28.0)
 *   `-- geometry-generation   -> a Geometry Graph from the approved Layout (28.1a)
 * ```
 *
 * `interpretIntent` is deliberately *not* classified. It is the entry point a
 * language model reaches through the host's Tool Broker, and a tool call has
 * already named its action and parameters — it is Direct Execution by
 * construction. That is what keeps Story 27.8.3's promise mechanical rather than
 * remembered: every path that worked before this sprint still reaches the
 * planner without passing through a classifier.
 *
 * Sprint 27.9 added the fourth lane and nothing else to this shape. It is
 * reachable only when a {@link PlanningArtefactReader} is supplied *and* the
 * project has an approved Brief, so a host that has not opted in classifies
 * exactly as it did in 27.8.
 */

import type { Proposal } from '@archisimple/ai-engine';
import {
  answerClarification,
  assembleBrief,
  ARCHITECTURAL_BRIEF_KIND,
  classifyRequest,
  clarificationFor,
  describeBrief,
  describeClarification,
  isBriefComplete,
  REQUEST_LANES,
  startBriefDraft,
  toBriefProposal,
  type ArchitecturalBrief,
  type BriefDraftStore,
  type ClarificationDialogue,
  type RequestClassification
} from './brief/index.js';
import {
  ARCHITECTURAL_INTENT_KINDS,
  recognizeIntent,
  type ArchitecturalIntent
} from './intent/index.js';
import {
  ArchitecturalPlanner,
  createBuiltInOperationProviders,
  type ArchitecturalCapability,
  type ArchitecturalOperationProvider,
  type PlanBlocker,
  type PlanningStageCapability,
  type PlanningStageProvider
} from './planning/index.js';
import {
  describeProgramme,
  SPACE_PROGRAMME_KIND,
  synthesizeProgramme,
  toProgrammeProposal,
  type SpaceProgramme
} from './programme/index.js';
import {
  describeLayout,
  LAYOUT_PLAN_KIND,
  synthesizeLayout,
  toLayoutProposal,
  type LayoutPlan
} from './layout/index.js';
import {
  describeGeometry,
  describeSpecification,
  expectedInstances,
  gateGeometryGraph,
  gateGeometrySpecification,
  GEOMETRY_GRAPH_KIND,
  GEOMETRY_SPECIFICATION_KIND,
  matchesGeometryGraph,
  reviseGeometrySpecification,
  synthesizeGeometry,
  synthesizeSpecification,
  toGeometryGraphProposal,
  toGeometrySpecificationProposal,
  type GeometryGraph,
  type GeometrySpecification
} from './geometry/index.js';
import { PLANNING_STAGES } from './planning/planning-stage.js';
import {
  type ApprovedArtefact,
  type PlanningArtefactReader
} from './artefacts/planning-artefact-reader.js';
import { toProposal } from './proposal/proposal-builder.js';
import {
  answerArchitecturalQuestion,
  type ArchitecturalAnswer,
  type BuildingKnowledge
} from './understanding/index.js';

export interface ArchitecturalIntelligenceServiceOptions {
  readonly knowledge: BuildingKnowledge;
  /**
   * Defaults to a planner carrying the built-in operation providers. Pass one
   * to register additional providers, or a narrower set.
   */
  readonly planner?: ArchitecturalPlanner;
  /**
   * Where an unfinished Brief lives between turns (Sprint 27.8). Omitted means
   * no multi-turn clarification: each request is classified on its own, and an
   * incomplete one is answered with its questions every time rather than
   * remembering what was already answered.
   */
  readonly briefDrafts?: BriefDraftStore;
  /**
   * Where this project's approved planning artefacts are read from (Sprint
   * 27.9). Omitted means programme generation is unavailable: the classifier
   * never reaches its lane, and a request for one is answered by saying a brief
   * has to be approved first.
   */
  readonly artefacts?: PlanningArtefactReader;
}

/**
 * One turn's outcome.
 *
 * `message` is always present and always sufficient on its own — a caller that
 * renders nothing else still says something true. `answer`, `proposal` and
 * `blocker` are the structured forms of the same turn, for a caller that can
 * render more.
 */
export interface ArchitecturalResponse {
  readonly intent: ArchitecturalIntent;
  /** Markdown, ready to become a conversation message. */
  readonly message: string;
  /** Present when the turn was a question the Building Platform could answer. */
  readonly answer?: ArchitecturalAnswer;
  /** Present when the turn produced a reviewable change. Never executed here. */
  readonly proposal?: Proposal;
  /** Present when the turn could not be completed, with what to try instead (Story 24.5.11). */
  readonly blocker?: PlanBlocker;
  /** Which lane the turn took (Sprint 27.8). Absent for {@link ArchitecturalIntelligenceService.interpretIntent}, which does not classify. */
  readonly classification?: RequestClassification;
  /** Present when the turn produced a complete Brief. Carried by `proposal` too, for a caller that only renders proposals. */
  readonly brief?: ArchitecturalBrief;
  /** Present when the turn asked for something the Brief still needs (Story 27.8.2). */
  readonly clarification?: ClarificationDialogue;
  /** Present when the turn produced a Space Programme (Sprint 27.9). Carried by `proposal` too. */
  readonly programme?: SpaceProgramme;
  /** Present when the turn produced a Layout Plan (Sprint 28.0). Carried by `proposal` too. */
  readonly layout?: LayoutPlan;
  /** Present when the turn produced a Geometry Graph (Sprint 28.1a). Carried by `proposal` too. */
  readonly geometry?: GeometryGraph;
  /** Present when the turn produced a Geometry Specification (Sprint 1.1). Carried by `proposal` too. */
  readonly specification?: GeometrySpecification;
}

export class ArchitecturalIntelligenceService {
  private readonly knowledge: BuildingKnowledge;
  private readonly planner: ArchitecturalPlanner;
  private readonly briefDrafts: BriefDraftStore | undefined;
  private readonly artefacts: PlanningArtefactReader | undefined;

  constructor(options: ArchitecturalIntelligenceServiceOptions) {
    this.knowledge = options.knowledge;
    this.planner = options.planner ?? defaultPlanner();
    this.briefDrafts = options.briefDrafts;
    this.artefacts = options.artefacts;
  }

  /**
   * The knowledge facade this service reasons over.
   *
   * Exposed so a host composing the Architectural Context Provider does not
   * have to build a second facade over the same services — it is stateless, but
   * two of them would still be two things to keep wired to the same set.
   */
  buildingKnowledge(): BuildingKnowledge {
    return this.knowledge;
  }

  /** Every action currently plannable — what a prompt or a preferences screen can advertise. */
  capabilities(): readonly ArchitecturalCapability[] {
    return this.planner.capabilities();
  }

  /** Registers an additional operation provider after construction. */
  registerOperationProvider(provider: ArchitecturalOperationProvider): void {
    this.planner.registerProvider(provider);
  }

  /**
   * Registers a provider that enriches a planning artefact (Sprint 28.3,
   * ADR-0027.1 Rule 10).
   *
   * The stage seam has existed on the planner since Sprint 27.9; this is the
   * passthrough that makes it reachable from a host holding only the service,
   * mirroring {@link registerOperationProvider} beside it. No second registry —
   * the provider lands on the same planner, under the same duplicate-id rule.
   *
   * @throws when the provider id is already registered, stage or operation alike.
   */
  registerPlanningStageProvider(provider: PlanningStageProvider): void {
    this.planner.registerStageProvider(provider);
  }

  /** Removes a provider of either kind. Returns whether one was registered. */
  unregisterProvider(id: string): boolean {
    return this.planner.unregisterProvider(id);
  }

  /** Every stage currently enriched, and by whom. */
  stageCapabilities(): readonly PlanningStageCapability[] {
    return this.planner.stageCapabilities();
  }

  /**
   * Reads one utterance and answers it.
   *
   * Never throws for an unusable request: a phrase this layer cannot act on
   * comes back as a `blocker` with suggestions, because "I cannot do that, try
   * this" is a turn in the conversation and an exception is not.
   *
   * From Sprint 27.8 this is the pipeline's front door — see the file header for
   * the three lanes and why `interpretIntent` is not one of them.
   */
  interpret(utterance: string): ArchitecturalResponse {
    const continued = this.continueClarification(utterance);
    if (continued) {
      return continued;
    }

    const approvedBrief = this.approvedBrief();
    const approvedProgramme = this.approvedProgramme();
    const approvedLayout = this.approvedLayout();
    const classification = classifyRequest(utterance, {
      hasApprovedBrief: approvedBrief !== undefined,
      hasApprovedProgramme: approvedProgramme !== undefined,
      hasApprovedLayout: approvedLayout !== undefined
    });
    const intent = recognizeIntent(utterance);

    if (classification.lane === REQUEST_LANES.DirectExecution) {
      return { ...this.interpretIntent(intent), classification };
    }

    if (classification.lane === REQUEST_LANES.GeometryGeneration) {
      return approvedLayout === undefined
        ? { intent, message: NO_APPROVED_LAYOUT, classification }
        : { ...this.generateGeometry(approvedLayout, intent), classification };
    }

    if (classification.lane === REQUEST_LANES.LayoutGeneration) {
      // Reachable only when the reader answered, so `approvedProgramme` is
      // present here by construction; the guard is for the type.
      return approvedProgramme === undefined
        ? { intent, message: NO_APPROVED_PROGRAMME, classification }
        : { ...this.generateLayout(approvedProgramme, intent), classification };
    }

    if (classification.lane === REQUEST_LANES.ProgrammeGeneration) {
      // The lane is only reachable when the reader answered, so `approvedBrief`
      // is present here by construction; the guard is for the type, not for a
      // case that can occur.
      return approvedBrief === undefined
        ? { intent, message: NO_APPROVED_BRIEF, classification }
        : { ...this.generateProgramme(approvedBrief, intent), classification };
    }

    if (classification.lane === REQUEST_LANES.BriefGeneration) {
      const brief = assembleBrief({ utterance, classification });
      return {
        intent,
        message: describeBrief(brief),
        proposal: toBriefProposal(brief),
        brief,
        classification
      };
    }

    const draft = startBriefDraft({ utterance, classification });
    this.briefDrafts?.save(draft);
    const clarification = clarificationFor(draft, draft.openQuestions);
    return {
      intent,
      message: describeClarification(clarification),
      clarification,
      classification
    };
  }

  /**
   * The Brief this project has approved, if any (Sprint 27.9, Story 27.9.0).
   *
   * Read through the injected port and narrowed here — the reader answers with
   * an opaque `value`, because the layer that stores artefacts is not the layer
   * that knows their shapes. A stored artefact of the right kind whose value is
   * not an object is treated as absent rather than trusted.
   */
  approvedBrief(): ArchitecturalBrief | undefined {
    const artefact = this.artefacts?.current(ARCHITECTURAL_BRIEF_KIND);
    return isArtefactValue(artefact) ? (artefact.value as ArchitecturalBrief) : undefined;
  }

  /**
   * The Space Programme this project has approved, if any (Sprint 28.0).
   *
   * Narrowed the same way {@link approvedBrief} is: the reader answers with an
   * opaque `value`, because the layer that stores artefacts is not the layer
   * that knows their shapes.
   */
  approvedProgramme(): SpaceProgramme | undefined {
    const artefact = this.artefacts?.current(SPACE_PROGRAMME_KIND);
    return isArtefactValue(artefact) ? (artefact.value as SpaceProgramme) : undefined;
  }

  /**
   * The Layout Plan this project has approved, if any (Sprint 28.1a).
   */
  approvedLayout(): LayoutPlan | undefined {
    const artefact = this.artefacts?.current(LAYOUT_PLAN_KIND);
    return isArtefactValue(artefact) ? (artefact.value as LayoutPlan) : undefined;
  }

  /**
   * Builds and offers the Geometry Graph for an approved Layout (Sprint 28.1a).
   *
   * Order matters here and is the sprint's own rule: synthesise, **enrich**,
   * **then gate**. A stage provider that breaks an invariant is caught by the
   * same check as a broken packer, and neither reaches the user.
   */
  generateGeometry(
    layout: LayoutPlan,
    intent: ArchitecturalIntent = recognizeIntent('')
  ): ArchitecturalResponse {
    const synthesized = synthesizeGeometry({ layout });
    if (!synthesized.ok) {
      return { intent, message: synthesized.message };
    }

    const geometry = this.planner.enrich(
      PLANNING_STAGES.Geometry,
      synthesized.graph,
      this.knowledge
    );

    const gate = gateGeometryGraph(geometry, layout);
    if (!gate.ok) {
      return { intent, message: gate.message };
    }

    return {
      intent,
      message: describeGeometry(geometry),
      proposal: toGeometryGraphProposal(geometry, { expected: expectedInstances(layout) }),
      geometry
    };
  }

  /** The Geometry Graph this project has approved, if any (Sprint 1.1). */
  approvedGeometry(): GeometryGraph | undefined {
    const artefact = this.artefacts?.current(GEOMETRY_GRAPH_KIND);
    return isArtefactValue(artefact) ? (artefact.value as GeometryGraph) : undefined;
  }

  /** The Geometry Specification this project has approved, if any (Sprint 1.1). */
  approvedSpecification(): GeometrySpecification | undefined {
    const artefact = this.artefacts?.current(GEOMETRY_SPECIFICATION_KIND);
    return isArtefactValue(artefact) ? (artefact.value as GeometrySpecification) : undefined;
  }

  /**
   * Builds and offers the Geometry Specification for an approved Geometry Graph
   * (Sprint 1.1 — ADR-AI-0001).
   *
   * Same order as the stage above, and for the same reason: synthesise,
   * **enrich**, **then gate**. A stage provider that breaks an invariant is
   * caught by the same check as broken synthesis, and neither reaches the user.
   *
   * ## Regenerating produces a revision, not a second artefact
   *
   * Story 1.1.13. If the project already has an approved Specification for
   * *this* Graph revision, this returns revision n+1 of it rather than a new
   * artefact at revision 1 (Rule 9). Without that, approving twice would leave
   * two Specifications of the same geometry, both revision 1, with nothing to
   * say which the project meant — and `matchesGeometryGraph` is what makes "the
   * same geometry" checkable rather than assumed.
   */
  generateSpecification(
    graph: GeometryGraph,
    intent: ArchitecturalIntent = recognizeIntent('')
  ): ArchitecturalResponse {
    const synthesized = synthesizeSpecification({ graph });
    if (!synthesized.ok) {
      return { intent, message: synthesized.message };
    }

    const enriched = this.planner.enrich(
      PLANNING_STAGES.Specification,
      synthesized.specification,
      this.knowledge
    );

    const previous = this.approvedSpecification();
    const specification =
      previous !== undefined && matchesGeometryGraph(previous, graph)
        ? reviseGeometrySpecification(previous, {
            storeys: enriched.storeys,
            spaces: enriched.spaces,
            walls: enriched.walls,
            openings: enriched.openings,
            constraints: enriched.constraints,
            assumptions: enriched.assumptions,
            warnings: enriched.warnings
          })
        : enriched;

    const gate = gateGeometrySpecification(specification, graph);
    if (!gate.ok) {
      return { intent, message: gate.message };
    }

    return {
      intent,
      message: describeSpecification(specification),
      proposal: toGeometrySpecificationProposal(specification),
      specification
    };
  }

  /**
   * Builds and offers the Layout Plan for an approved Programme (Sprint 28.0).
   *
   * Public for the same reason {@link generateProgramme} is: the tool path calls
   * it directly, and so would a menu command.
   */
  generateLayout(
    programme: SpaceProgramme,
    intent: ArchitecturalIntent = recognizeIntent('')
  ): ArchitecturalResponse {
    const synthesized = synthesizeLayout({ programme });
    if (!synthesized.ok) {
      return { intent, message: synthesized.message };
    }

    // Rule 10: providers enrich before the artefact is offered, never after it
    // is approved. A layout the user approved is the layout the user saw.
    const layout = this.planner.enrich(PLANNING_STAGES.Layout, synthesized.plan, this.knowledge);

    return {
      intent,
      message: describeLayout(layout),
      proposal: toLayoutProposal(layout),
      layout
    };
  }

  /**
   * Builds and offers the Space Programme for an approved Brief (Story 27.9.1).
   *
   * Public so a host can generate one without going through an utterance — the
   * tool path does exactly that, and so would a menu command.
   */
  generateProgramme(
    brief: ArchitecturalBrief,
    intent: ArchitecturalIntent = recognizeIntent(brief.utterance)
  ): ArchitecturalResponse {
    const synthesized = synthesizeProgramme({ brief });
    if (!synthesized.ok) {
      return { intent, message: synthesized.message };
    }

    // Rule 10: providers enrich the artefact before it is offered, never after
    // it is approved. A programme the user approved is what the user saw.
    const programme = this.planner.enrich(
      PLANNING_STAGES.Programme,
      synthesized.programme,
      this.knowledge
    );

    return {
      intent,
      message: describeProgramme(programme),
      proposal: toProgrammeProposal(programme),
      programme
    };
  }

  /**
   * Folds this utterance into an open clarification dialogue, if there is one.
   *
   * Checked *before* classification, because an answer rarely looks like a
   * request: "two" classifies as Direct Execution on its own and would have
   * gone to the planner as an unrecognised phrase, abandoning a dialogue the
   * platform had just started. An open draft means the last thing the user was
   * asked is still outstanding, so their next sentence is read as the reply.
   *
   * Answering can complete the Brief — in which case the draft is cleared and
   * the Brief is offered for approval — or leave questions, in which case the
   * next one is asked.
   */
  private continueClarification(utterance: string): ArchitecturalResponse | undefined {
    const open = this.briefDrafts?.load();
    if (!open || isBriefComplete(open)) {
      return undefined;
    }

    const intent = recognizeIntent(utterance);
    const revised = answerClarification(open, utterance);

    // The answer moved nothing. Rather than ask the identical question a second
    // time as though nothing had been said, the utterance is treated as a fresh
    // request: a user who changes the subject mid-dialogue has changed it.
    if (revised.requirements.length === open.requirements.length) {
      this.briefDrafts?.clear();
      return undefined;
    }

    if (!isBriefComplete(revised)) {
      this.briefDrafts?.save(revised);
      const clarification = clarificationFor(revised, revised.openQuestions);
      return { intent, message: describeClarification(clarification), clarification };
    }

    this.briefDrafts?.clear();
    return {
      intent,
      message: describeBrief(revised),
      proposal: toBriefProposal(revised),
      brief: revised
    };
  }

  /**
   * The kind string a host stores an approved Brief under — exposed so the
   * composition root does not have to import the brief module to wire its
   * draft store and approval sink to the same key.
   */
  static readonly briefArtefactKind = ARCHITECTURAL_BRIEF_KIND;

  /**
   * The same turn, starting from an intent somebody else built.
   *
   * This is the entry point a *language model* reaches: the host's Tool Broker
   * turns a model's structured tool call — which already names the action and
   * its parameters — straight into an {@link ArchitecturalIntent}, skipping the
   * pattern matching it does not need. Both paths meet here, so both produce
   * the same plans with the same reasoning, assumptions and safety rules.
   * There is one architectural pipeline, not one per provider.
   */
  interpretIntent(intent: ArchitecturalIntent): ArchitecturalResponse {
    if (intent.kind === ARCHITECTURAL_INTENT_KINDS.Question) {
      const answer = answerArchitecturalQuestion(intent, this.knowledge);
      if (answer !== undefined) {
        return { intent, message: answer.text, answer };
      }
    }

    // Everything else — modifications, ambiguous phrasings and unknown ones —
    // goes to the planner. An `Ambiguous` intent still reaches its provider so
    // the provider can name what is missing in its own terms; an `Unknown` one
    // reaches no provider and the planner answers for it.
    const result = this.planner.plan(intent, this.knowledge);
    if (!result.ok) {
      return { intent, message: describeBlocker(result.blocker), blocker: result.blocker };
    }

    const proposal = toProposal(result.plan);
    return { intent, message: describePlan(result.plan.reasoning, proposal), proposal };
  }
}

/** What a programme request gets when no Brief has been approved (Sprint 27.9). */
const NO_APPROVED_BRIEF =
  'There is no approved brief yet, so there is nothing to write a programme from. Tell me what you want to build and I will start one.';

/** What a layout request gets when no Programme has been approved (Sprint 28.0). */
const NO_APPROVED_PROGRAMME =
  'There is no approved space programme yet, so there is nothing to arrange. Approve a programme first and I will lay it out.';

/** What a geometry request gets when no Layout has been approved (Sprint 28.1a). */
const NO_APPROVED_LAYOUT =
  'There is no approved layout yet, so there is nothing to realise. Approve a layout first and I will draw the rooms.';

/** Whether a stored artefact really carries a document-shaped value. */
function isArtefactValue(
  artefact: ApprovedArtefact | undefined
): artefact is ApprovedArtefact & { readonly value: object } {
  return artefact !== undefined && typeof artefact.value === 'object' && artefact.value !== null;
}

function defaultPlanner(): ArchitecturalPlanner {
  const planner = new ArchitecturalPlanner();
  for (const provider of createBuiltInOperationProviders()) {
    planner.registerProvider(provider);
  }
  return planner;
}

/**
 * The prose for a turn that produced a proposal.
 *
 * Reasoning first, outcome second: the panel renders the proposal card with the
 * operations and the affected elements right underneath, so the message's job
 * is the part a card cannot show — why this, and what to expect.
 */
function describePlan(reasoning: string, proposal: Proposal): string {
  const lines = [reasoning, '', `**${proposal.title}** — ${proposal.expectedOutcome ?? ''}`.trim()];
  if (proposal.assumptions.length > 0) {
    lines.push('', 'I assumed:', ...proposal.assumptions.map((assumption) => `- ${assumption}`));
  }
  if (proposal.risk === 'destructive') {
    lines.push(
      '',
      'This one removes or replaces existing work, so approving it asks you to confirm.'
    );
  }
  return lines.join('\n');
}

/** The prose for a turn that could not be completed (Story 24.5.11). */
function describeBlocker(blocker: PlanBlocker): string {
  const lines = [blocker.message];
  if (blocker.suggestions.length > 0) {
    lines.push('', ...blocker.suggestions.map((suggestion) => `- ${suggestion}`));
  }
  return lines.join('\n');
}
