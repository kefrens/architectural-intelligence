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
  reviseBriefFrom,
  reviseBriefFromFields,
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
  PLAN_BLOCKER_REASONS,
  type ArchitecturalCapability,
  type ArchitecturalOperationProvider,
  type PlanBlocker,
  type PlanningStageCapability,
  type PlanningStageProvider
} from './planning/index.js';
import {
  describeProgramme,
  reviseProgramme,
  withPreviousSpaceIds,
  SPACE_PROGRAMME_KIND,
  synthesizeProgramme,
  toProgrammeProposal,
  type SpaceProgramme
} from './programme/index.js';
import {
  describeLayout,
  LAYOUT_PLAN_KIND,
  reviseLayoutPlan,
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
  reviseGeometryGraph,
  reviseGeometrySpecification,
  synthesizeGeometry,
  evaluateSpecification,
  synthesizeSpecification,
  toGeometryGraphProposal,
  toGeometrySpecificationProposal,
  type GeometryGraph,
  type GeometrySpecification
} from './geometry/index.js';
import { changesAnything, nothingToRegenerate } from './artefacts/artefact-revision.js';
import { PLANNING_STAGES, type PlanningStage } from './planning/planning-stage.js';
import {
  type ApprovedArtefact,
  type PlanningArtefactReader
} from './artefacts/planning-artefact-reader.js';
import { toProposal } from './proposal/proposal-builder.js';
import {
  describeRealisation,
  REALISATION_STATUSES,
  toRealisationProposal,
  type RealisationState,
  type RealisationStateReader,
  type RealisationStatus
} from './realisation/index.js';
import {
  answerArchitecturalQuestion,
  type ArchitecturalAnswer,
  type BuildingKnowledge
} from './understanding/index.js';
import {
  deriveWorkflowState,
  stageState,
  type ArchitecturalWorkflowState
} from './workflow/index.js';

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
  /**
   * Whether the approved design has actually been built (Sprint 1.7 —
   * ADR-AI-0004).
   *
   * Host-supplied and read-only. Omitted is a supported configuration, not a
   * degraded one: the realisation lane behaves exactly as it did in Sprint 1.6,
   * proposing a build and letting the host's guard decide (Rule 6).
   */
  readonly realisation?: RealisationStateReader;
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
  /**
   * The port, not its answer (Sprint 1.7 — ADR-AI-0004 Rule 5). Holding a
   * `RealisationState` here instead would be a cached verdict about whether a
   * building exists, and it would go stale the moment one is built.
   */
  private readonly realisation: RealisationStateReader | undefined;

  constructor(options: ArchitecturalIntelligenceServiceOptions) {
    this.knowledge = options.knowledge;
    this.planner = options.planner ?? defaultPlanner();
    this.briefDrafts = options.briefDrafts;
    this.artefacts = options.artefacts;
    this.realisation = options.realisation;
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
   * Where this design is, and what can be asked for next (Sprint 1.2, Story
   * 1.2.12 — ADR-AI-0002).
   *
   * The five stages with what the project holds for each, which of them have
   * gone stale, why a stage cannot proceed, and what this service can be asked
   * to do about it.
   *
   * **Derived on every call, stored nowhere** (Rule 1). There is no field behind
   * this method and no memo in front of it: the answer is a function of what the
   * artefact reader holds *now*, and a cached verdict about which revision is
   * current goes stale the instant a revision lands — the same reason layout
   * quality and packing evaluation are absent from their own artefacts.
   *
   * **It advances nothing** (Rule 12). No artefact is generated, no `Proposal`
   * built, no draft touched and no provider consulted, so it is safe to call on
   * every render.
   *
   * **It reports no proposal.** This service hands a `Proposal` to the host and
   * never learns whether the user approved it — what it learns is that an
   * artefact became readable. A host showing "awaiting approval" merges its own
   * `pendingProposal()` onto this (Rule 2).
   *
   * With no artefact reader wired, this answers five untouched stages rather
   * than throwing (Rule 11).
   */
  workflowState(): ArchitecturalWorkflowState {
    const draft = this.briefDrafts?.load();
    return deriveWorkflowState({
      ...(this.artefacts === undefined ? {} : { artefacts: this.artefacts }),
      // "Open" means the same thing here as it does to `continueClarification`:
      // a draft with questions still outstanding. A complete one is offered for
      // approval in the turn that completes it and cleared in the same breath.
      hasBriefDraft: draft !== undefined && !isBriefComplete(draft)
    });
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

    // Sprint 1.2, Story 1.2.14. The four stage gates come from one derivation
    // rather than from four separate `approved*` reads, so the lane a
    // conversation may take and the stage a panel may offer cannot disagree
    // (ADR-AI-0002 Rule 8). They also tighten in the process: a stage is gated on
    // its input being approved *and current*, so a project whose Brief was
    // revised after its Programme was approved stops offering the layout lane
    // and offers the programme lane instead — which is the correct next step and
    // was previously unreachable without the user knowing to ask for it.
    const workflow = this.workflowState();
    const classification = classifyRequest(utterance, {
      hasApprovedBrief: this.isEligible(workflow, PLANNING_STAGES.Programme),
      hasApprovedProgramme: this.isEligible(workflow, PLANNING_STAGES.Layout),
      hasApprovedLayout: this.isEligible(workflow, PLANNING_STAGES.Geometry),
      hasApprovedGeometry: this.isEligible(workflow, PLANNING_STAGES.Specification),
      // Sprint 1.3, and a different question from the four above: whether there
      // is a Brief to change, not whether the stage below it can be built.
      hasBriefToRevise: stageState(workflow, PLANNING_STAGES.Brief)?.approved !== undefined,
      // Sprint 1.6, and the same *kind* of question as the one above it: whether
      // there is a design here to build. Staleness is deliberately not part of
      // the gate — a stale design is still the one the user meant, and the
      // branch below answers it with the reason rather than the lane closing.
      hasApprovedSpecification:
        stageState(workflow, PLANNING_STAGES.Specification)?.approved !== undefined,
      // Sprint 1.8 (BUG-010). The fourth kind of question: is there a next step
      // that needs nothing from the user? The Brief is excluded because it is
      // written from what the user said, and "ok" says nothing about a building
      // — every stage below it is a derivation.
      canContinue: derivableNextStage(workflow) !== undefined
    });
    const intent = recognizeIntent(utterance);

    if (classification.lane === REQUEST_LANES.DirectExecution) {
      return { ...this.interpretIntent(intent), classification };
    }

    if (classification.lane === REQUEST_LANES.BriefRevision) {
      return { ...this.reviseApprovedBrief(utterance, intent), classification };
    }

    if (classification.lane === REQUEST_LANES.Realisation) {
      return { ...this.proposeRealisation(workflow, intent), classification };
    }

    // Sprint 1.8 (BUG-010). "ok" means whatever the project is waiting to do
    // next, and the projection is what knows — so this routes to the same
    // generator the named lane would have reached, rather than deciding
    // anything of its own (ADR-AI-0002 Rules 8 and 13).
    if (classification.lane === REQUEST_LANES.Continuation) {
      const next = derivableNextStage(workflow);
      return next === undefined
        ? { ...this.interpretIntent(intent), classification }
        : { ...this.generateStage(next, intent), classification };
    }

    if (classification.lane === REQUEST_LANES.SpecificationGeneration) {
      return { ...this.generateStage(PLANNING_STAGES.Specification, intent), classification };
    }

    if (classification.lane === REQUEST_LANES.GeometryGeneration) {
      return { ...this.generateStage(PLANNING_STAGES.Geometry, intent), classification };
    }

    if (classification.lane === REQUEST_LANES.LayoutGeneration) {
      return { ...this.generateStage(PLANNING_STAGES.Layout, intent), classification };
    }

    if (classification.lane === REQUEST_LANES.ProgrammeGeneration) {
      return { ...this.generateStage(PLANNING_STAGES.Programme, intent), classification };
    }

    if (classification.lane === REQUEST_LANES.BriefGeneration) {
      // Story 1.5.6. A complete design request arriving at a project that
      // already holds a Brief is a *revision* of it, not a second one. Before
      // Sprint 1.5 this branch called `assembleBrief` unconditionally and minted
      // a new lineage — one of Bug 002's three fork paths, and the one that fires
      // when a user re-describes their building without a revision cue.
      if (this.approvedBrief() !== undefined) {
        return { ...this.reviseApprovedBrief(utterance, intent), classification };
      }

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
    const superseded = this.supersededInput(
      LAYOUT_PLAN_KIND,
      layout,
      'layout',
      PLANNING_STAGES.Geometry
    );
    if (superseded !== undefined) {
      return { intent, message: superseded.message, blocker: superseded };
    }

    const synthesized = synthesizeGeometry({ layout });
    if (!synthesized.ok) {
      return { intent, message: synthesized.message };
    }

    const enriched = this.planner.enrich(
      PLANNING_STAGES.Geometry,
      synthesized.graph,
      this.knowledge
    );

    // Story 1.3.7 — revision, not replacement. See `generateProgramme`.
    const previousGraph = this.approvedGeometry();
    const patch = {
      polygons: enriched.polygons,
      wallCandidates: enriched.wallCandidates,
      openingCandidates: enriched.openingCandidates,
      adjacencies: enriched.adjacencies,
      assumptions: enriched.assumptions,
      warnings: enriched.warnings,
      sourceLayout: enriched.sourceLayout,
      ...(enriched.contributedBy === undefined ? {} : { contributedBy: enriched.contributedBy })
    };

    // Bug 005.
    if (previousGraph !== undefined && !changesAnything(previousGraph, patch)) {
      const blocker = nothingToRegenerate({ stage: 'geometry', nextStage: 'specification' });
      return { intent, message: describeBlocker(blocker), blocker };
    }

    const geometry =
      previousGraph === undefined ? enriched : reviseGeometryGraph(previousGraph, patch);

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
   * Story 1.1.13, generalised by Story 1.3.7. If the project already has an
   * approved Specification, this returns revision n+1 of it rather than a new
   * artefact at revision 1 (Rule 9).
   *
   * Sprint 1.1 made that conditional on `matchesGeometryGraph` — revision only
   * when the Graph was the *same* one — which left the other case minting a
   * second Specification at revision 1, so a project that revised its geometry
   * ended up holding two lineages with nothing to say which it meant. Sprint 1.3
   * drops the condition: a stage the project holds is always revised, and
   * `sourceGeometry` records which Graph this revision came from. The predicate
   * still answers that question; it no longer decides the artefact's identity.
   */
  generateSpecification(
    graph: GeometryGraph,
    intent: ArchitecturalIntent = recognizeIntent('')
  ): ArchitecturalResponse {
    const superseded = this.supersededInput(
      GEOMETRY_GRAPH_KIND,
      graph,
      'geometry',
      PLANNING_STAGES.Specification
    );
    if (superseded !== undefined) {
      return { intent, message: superseded.message, blocker: superseded };
    }

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
    const patch = {
      storeys: enriched.storeys,
      spaces: enriched.spaces,
      walls: enriched.walls,
      openings: enriched.openings,
      constraints: enriched.constraints,
      assumptions: enriched.assumptions,
      warnings: enriched.warnings,
      sourceGeometry: enriched.sourceGeometry,
      ...(enriched.contributedBy === undefined ? {} : { contributedBy: enriched.contributedBy })
    };

    // Bug 005. The last stage, so there is nowhere to send the user next — the
    // suggestion says what would make a revision meaningful instead.
    if (previous !== undefined && !changesAnything(previous, patch)) {
      const blocker = nothingToRegenerate({ stage: 'specification' });
      return { intent, message: describeBlocker(blocker), blocker };
    }

    const specification =
      previous === undefined ? enriched : reviseGeometrySpecification(previous, patch);

    const gate = gateGeometrySpecification(specification, graph);
    if (!gate.ok) {
      return { intent, message: gate.message };
    }

    // Sprint 1.8. The first stage that can answer whether the design satisfies
    // what the programme asked for, so it is the first that says so — and it
    // says it only because `constraints.evaluate` established it (ADR-0034 §4).
    //
    // The intents and the zones come from the approved Layout, which carries
    // both. Without one there is nothing to check against, and the card reports
    // no compliance rather than reporting compliance.
    const layout = this.approvedLayout();
    const compliance =
      layout === undefined
        ? undefined
        : evaluateSpecification({
            specification,
            intents: layout.adjacencies,
            spaces: layout.spaces
          });

    return {
      intent,
      message: describeSpecification(specification),
      proposal: toGeometrySpecificationProposal(specification, compliance),
      specification
    };
  }

  /**
   * Generates one derivable stage from the artefact above it (Sprint 1.8 —
   * BUG-010).
   *
   * The four named stage lanes and the continuation lane all arrive here, which
   * is the point: "generate the layout" and "ok" reach the same code, so they
   * cannot answer differently. Before this sprint each lane inlined its own
   * `approved*()` read and its own missing-input message — four copies of one
   * shape, and a fifth caller would have made five.
   *
   * Each `undefined` branch is unreachable by construction: the lane that routed
   * here was gated on the projection, which read the same artefacts. They are
   * kept because a type needs them, and because "unreachable" is a claim about
   * today's gates rather than tomorrow's.
   */
  private generateStage(stage: PlanningStage, intent: ArchitecturalIntent): ArchitecturalResponse {
    switch (stage) {
      case PLANNING_STAGES.Programme: {
        const brief = this.approvedBrief();
        return brief === undefined
          ? { intent, message: NO_APPROVED_BRIEF }
          : this.generateProgramme(brief, intent);
      }
      case PLANNING_STAGES.Layout: {
        const programme = this.approvedProgramme();
        return programme === undefined
          ? { intent, message: NO_APPROVED_PROGRAMME }
          : this.generateLayout(programme, intent);
      }
      case PLANNING_STAGES.Geometry: {
        const layout = this.approvedLayout();
        return layout === undefined
          ? { intent, message: NO_APPROVED_LAYOUT }
          : this.generateGeometry(layout, intent);
      }
      case PLANNING_STAGES.Specification: {
        const graph = this.approvedGeometry();
        return graph === undefined
          ? { intent, message: NO_APPROVED_GEOMETRY }
          : this.generateSpecification(graph, intent);
      }
      default:
        // The Brief, which is not derivable: it is written from what the user
        // said, and nothing here has anything to write it from.
        return this.interpretIntent(intent);
    }
  }

  /**
   * Offers the approved design to be built (Sprint 1.6 — BUG-008 Phase 3).
   *
   * The ninth lane's whole implementation, and it is short because almost
   * everything realisation involves belongs to the host: the Specification
   * reader, the guard, the translator, the atomic Operation and the record are
   * all behind ArchiSimple's one entry point (ADR-0032 revision 2.2). What is
   * left here is naming *which* design the user meant.
   *
   * ## The order of the answers, which is the whole of Sprint 1.7
   *
   * **Staleness first**, because it is the fact this layer owns: a design
   * derived from a superseded Geometry Graph should be regenerated whatever the
   * host thinks about building it, and the answer names the fix. Staleness is
   * what the projection exists to compute, and asking the host about it would be
   * a second source for one fact (ADR-AI-0004 Rule 10).
   *
   * **Then what the host says.** Sprint 1.6 could not ask, so it proposed and
   * let the guard refuse at approval — truthful, and a poor conversation.
   * Sprint 1.7 reads the host's own answer through the port and says it.
   *
   * A refusal produced here is **conversational** (Rule 4). The host's guard
   * remains the authority on whether a build may happen; this explains, and
   * never enforces. That is why every declining branch says what would change
   * the answer rather than "you cannot".
   *
   * Nothing here infers realisation from anything but the port — not from the
   * model, not from an artefact, not from the conversation, and not from the
   * drawing being empty (Rule 2). A realisation is an **event**: undoing the
   * geometry does not un-happen it.
   */
  private proposeRealisation(
    workflow: ArchitecturalWorkflowState,
    intent: ArchitecturalIntent
  ): ArchitecturalResponse {
    const state = stageState(workflow, PLANNING_STAGES.Specification);
    const approved = state?.approved;
    if (approved === undefined) {
      // Unreachable: the lane is gated on this artefact existing. Present for
      // the type, and for the same reason the four stage lanes above carry one.
      return { intent, message: NO_APPROVED_SPECIFICATION };
    }

    if (state?.stale !== undefined) {
      const blocker = staleDesignToBuild(approved.revision);
      return { intent, message: describeBlocker(blocker), blocker };
    }

    const subject = { specificationId: approved.id, revision: approved.revision };
    const propose = (): ArchitecturalResponse => ({
      intent,
      message: describeRealisation(subject),
      proposal: toRealisationProposal(subject)
    });

    // Read once, per turn, never stored (Rule 5). No reader is a supported
    // configuration and Sprint 1.6's answer is the right one for it (Rule 6).
    const realisation = this.realisation?.realisation();
    if (realisation === undefined || !describesTheSameDesign(realisation, subject)) {
      // A state about another design — a misconfigured host, most plausibly two
      // record registries — is not evidence about this one, and asserting from
      // it would be worse than not asking.
      return propose();
    }

    if (realisation.status === REALISATION_STATUSES.Realised) {
      const blocker = alreadyBuilt(subject.revision);
      return { intent, message: describeBlocker(blocker), blocker };
    }

    if (!realisation.guardAllowsBuild) {
      const blocker = hostWillNotBuild(realisation.guardBlockerCode);
      return { intent, message: describeBlocker(blocker), blocker };
    }

    // `refused` and `failed` both retry — the host's guard says so, and it is
    // the authority. What changes is that the user is told there was an earlier
    // attempt before they approve another one.
    if (
      realisation.status === REALISATION_STATUSES.Refused ||
      realisation.status === REALISATION_STATUSES.Failed
    ) {
      const proposal = propose();
      return {
        ...proposal,
        message: `${previousAttempt(realisation.status)}\n\n${proposal.message}`
      };
    }

    return propose();
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
    const superseded = this.supersededInput(
      SPACE_PROGRAMME_KIND,
      programme,
      'space programme',
      PLANNING_STAGES.Layout
    );
    if (superseded !== undefined) {
      return { intent, message: superseded.message, blocker: superseded };
    }

    const synthesized = synthesizeLayout({ programme });
    if (!synthesized.ok) {
      return { intent, message: synthesized.message };
    }

    // Rule 10: providers enrich before the artefact is offered, never after it
    // is approved. A layout the user approved is the layout the user saw.
    const enriched = this.planner.enrich(PLANNING_STAGES.Layout, synthesized.plan, this.knowledge);

    // Story 1.3.7 — revision, not replacement. See `generateProgramme`.
    const previous = this.approvedLayout();
    if (previous === undefined) {
      return {
        intent,
        message: describeLayout(enriched),
        proposal: toLayoutProposal(enriched),
        layout: enriched
      };
    }

    const patch = {
      spaces: enriched.spaces,
      graph: enriched.graph,
      adjacencies: enriched.adjacencies,
      circulation: enriched.circulation,
      assumptions: enriched.assumptions,
      warnings: enriched.warnings,
      sourceProgramme: enriched.sourceProgramme,
      ...(enriched.contributedBy === undefined ? {} : { contributedBy: enriched.contributedBy })
    };

    // Bug 005. Layout node ids are programme space ids, so they are already
    // stable when the programme's are — which is the other half of what
    // `withPreviousSpaceIds` buys.
    if (!changesAnything(previous, patch)) {
      const blocker = nothingToRegenerate({ stage: 'layout', nextStage: 'geometry' });
      return { intent, message: describeBlocker(blocker), blocker };
    }

    const layout = reviseLayoutPlan(previous, patch);

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
    const superseded = this.supersededInput(
      ARCHITECTURAL_BRIEF_KIND,
      brief,
      'brief',
      PLANNING_STAGES.Programme
    );
    if (superseded !== undefined) {
      return { intent, message: superseded.message, blocker: superseded };
    }

    const synthesized = synthesizeProgramme({ brief });
    if (!synthesized.ok) {
      return { intent, message: synthesized.message };
    }

    // Rule 10: providers enrich the artefact before it is offered, never after
    // it is approved. A programme the user approved is what the user saw.
    const enriched = this.planner.enrich(
      PLANNING_STAGES.Programme,
      synthesized.programme,
      this.knowledge
    );

    // Story 1.3.7. A stage the project already holds is *revised*, never
    // replaced — same id, next revision, provenance pointing at the Brief now in
    // force. Minting a second programme instead would split the lineage, and a
    // project holding two programmes cannot say which one it meant.
    const previous = this.approvedProgramme();
    if (previous === undefined) {
      return {
        intent,
        message: describeProgramme(enriched),
        proposal: toProgrammeProposal(enriched),
        programme: enriched
      };
    }

    // Bug 005. Ids are reconciled *before* the patch is built, so a regeneration
    // that changed nothing produces a patch equal to what the project already
    // holds — and so that a Layout built on this programme keeps pointing at
    // spaces that still exist.
    const stable = withPreviousSpaceIds(enriched, previous);
    const patch = {
      spaces: stable.spaces,
      adjacencies: stable.adjacencies,
      totalArea: stable.totalArea,
      assumptions: stable.assumptions,
      warnings: stable.warnings,
      sourceBrief: stable.sourceBrief,
      ...(stable.contributedBy === undefined ? {} : { contributedBy: stable.contributedBy })
    };

    if (!changesAnything(previous, patch)) {
      const blocker = nothingToRegenerate({
        stage: 'space programme',
        nextStage: 'layout'
      });
      return { intent, message: describeBlocker(blocker), blocker };
    }

    const programme = reviseProgramme(previous, patch);

    return {
      intent,
      message: describeProgramme(programme),
      proposal: toProgrammeProposal(programme),
      programme
    };
  }

  /**
   * The next revision of the approved Brief, from what the user just said
   * (Sprint 1.3, Story 1.3.5).
   *
   * Public because the tool path and a menu command would both want it, and for
   * the same reason `generateProgramme` is: a revision is a stage of the design,
   * not a conversational accident.
   *
   * The result is a `Proposal` like every other artefact's. Approving it
   * supersedes revision n and leaves every stage below the Brief stale — which
   * is the point, and which the workflow state reports without anything here
   * having to announce it.
   */
  reviseApprovedBrief(
    utterance: string,
    intent: ArchitecturalIntent = recognizeIntent(utterance)
  ): ArchitecturalResponse {
    const approved = this.approvedBrief();
    if (approved === undefined) {
      return { intent, message: NO_BRIEF_TO_REVISE };
    }

    const revised = reviseBriefFrom(approved, utterance);
    if (revised === undefined) {
      // The utterance restated what the Brief already says. Superseding revision
      // n with an identical revision n+1 would be supersession theatre, and the
      // vocabulary already has the word for it.
      const blocker = nothingToRevise();
      return { intent, message: blocker.message, blocker };
    }

    return {
      intent,
      message: describeBrief(revised),
      proposal: toBriefProposal(revised),
      brief: revised
    };
  }

  /**
   * Whether a stage can be generated now — its input is approved *and* current.
   *
   * The classifier's stage gates, read off the projection instead of recomputed
   * (Rule 8). Note the off-by-one that is not one: the gate named
   * `hasApprovedBrief` asks whether the **programme** stage is eligible, because
   * that is exactly the question "is there a current brief to build one from".
   */
  private isEligible(workflow: ArchitecturalWorkflowState, stage: PlanningStage): boolean {
    return stageState(workflow, stage)?.eligible === true;
  }

  /**
   * Refuses an input the project has superseded (Sprint 1.3, Story 1.3.9).
   *
   * Every `generate*` takes its upstream artefact as an argument and, until this
   * sprint, believed it. The lanes and the tools both read the artefact in force
   * so they could not pass a stale one — but the methods are public, a menu
   * command could hold one from before an approval, and the result would be a
   * design that is out of date the moment it is approved.
   *
   * Sprint 1.2 deliberately did **not** add this guard, because until there was
   * a revision path a refusal left the user with nowhere to go. Now regenerating
   * from the revision in force is one turn away, so the refusal is actionable
   * and the suggestion says so.
   *
   * Two ways an input is refused, and the second is the one a tool can reach:
   *
   * 1. **It is not the artefact in force.** A caller held one from before an
   *    approval, or one from another lineage entirely.
   * 2. **It is in force and the projection says the stage cannot proceed** —
   *    because that artefact is itself stale. The programme tool reads the
   *    programme in force and passes it faithfully; if a Brief revision left that
   *    programme out of date, a layout built on it is out of date too. Without
   *    this clause a tool could build exactly what the workflow state says is
   *    unavailable, which is the two-derivations bug ADR-AI-0002 Rule 8 exists to
   *    prevent, appearing between a lane and a tool instead of between two lanes.
   *
   * The second reason reuses the blocker the projection already computed. There
   * is one place that decides why a stage cannot proceed, and this is not it.
   *
   * Silent when the project holds nothing of this kind: an artefact the project
   * never approved is not one it superseded, and a caller composing a pipeline
   * by hand still works exactly as it did.
   */
  private supersededInput(
    kind: string,
    artefact: { readonly id: string; readonly revision: number },
    noun: string,
    stage: PlanningStage
  ): PlanBlocker | undefined {
    const inForce = this.artefacts?.current(kind);
    if (inForce === undefined) {
      return undefined;
    }

    if (inForce.id !== artefact.id || inForce.revision !== artefact.revision) {
      const message =
        inForce.id === artefact.id
          ? `That ${noun} is revision ${artefact.revision}, and the project now holds revision ${inForce.revision}.`
          : `That ${noun} is not the one this project holds.`;

      return {
        reason: PLAN_BLOCKER_REASONS.Superseded,
        message: `${message} Building on it would produce something out of date the moment it was approved.`,
        suggestions: [`Ask again and I will use the ${noun} in force.`]
      };
    }

    return stageState(this.workflowState(), stage)?.blockers[0];
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

    // Story 1.5.7, and the fork path only a probe found. A completed draft
    // becomes the artefact *under the draft's own id* — which is right for a
    // first Brief and a second lineage for every one after it. When the project
    // holds one, the answers fold into it instead.
    const approved = this.approvedBrief();
    if (approved !== undefined) {
      return { ...this.foldIntoApprovedBrief(approved, revised, intent) };
    }

    return {
      intent,
      message: describeBrief(revised),
      proposal: toBriefProposal(revised),
      brief: revised
    };
  }

  /**
   * A completed draft, folded into the Brief the project already holds
   * (Story 1.5.7).
   *
   * The draft's requirements are what the user just answered, so they are
   * exactly the fields to fold — the draft itself is discarded rather than
   * becoming an artefact of its own.
   */
  private foldIntoApprovedBrief(
    approved: ArchitecturalBrief,
    draft: ArchitecturalBrief,
    intent: ArchitecturalIntent
  ): ArchitecturalResponse {
    const revised = reviseBriefFromFields(approved, {
      requirements: draft.requirements,
      spaces: draft.desiredSpaces
    });

    if (revised === undefined) {
      return { intent, message: BRIEF_ALREADY_SAYS_THAT, blocker: nothingToRevise() };
    }

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

/**
 * The stage a continuation would generate, or `undefined` (Sprint 1.8, BUG-010).
 *
 * The projection's own answer, read rather than re-derived: the stage that needs
 * attention, if it can be generated now and is not the Brief. Excluding the
 * Brief is the whole of "no additional information is required" — every stage
 * below it is a derivation of the artefact above, and the Brief is the one that
 * needs the user.
 */
function derivableNextStage(workflow: ArchitecturalWorkflowState): PlanningStage | undefined {
  const stage = workflow.currentStage;
  if (stage === undefined || stage === PLANNING_STAGES.Brief) {
    return undefined;
  }
  return stageState(workflow, stage)?.eligible === true ? stage : undefined;
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

/** What every path answers when a re-description would change nothing (Sprint 1.5). */
function nothingToRevise(): PlanBlocker {
  return {
    reason: PLAN_BLOCKER_REASONS.NothingToDo,
    message: BRIEF_ALREADY_SAYS_THAT,
    suggestions: ['Name what should change — the number of bedrooms, storeys or bathrooms.']
  };
}

/** The sentence the tool and both conversational paths share (Story 1.5.8). */
const BRIEF_ALREADY_SAYS_THAT = 'The brief already says that, so there is nothing to revise.';

/** What a revision request gets when the project holds no Brief (Sprint 1.3). */
const NO_BRIEF_TO_REVISE =
  'There is no approved brief to revise yet. Tell me what you want to build and I will start one.';

/** What a realisation request gets when the project holds no Specification (Sprint 1.6). */
const NO_APPROVED_SPECIFICATION =
  'There is no approved design to build yet. Approve a geometry specification first and I will offer to build it.';

/**
 * What a realisation request gets when the design it names is out of date
 * (Sprint 1.6).
 *
 * `Superseded` rather than `Unsupported`: the input exists and a later revision
 * upstream replaced what it was derived from, which is the reason that member
 * was added for (ADR-AI-0002 Rule 4, ADR-0027.1 Rule 8).
 */
function staleDesignToBuild(revision: number): PlanBlocker {
  return {
    reason: PLAN_BLOCKER_REASONS.Superseded,
    message: `Revision ${revision} of the specification is out of date — the design it was derived from has been revised since. Building it would build something the project has already moved past.`,
    suggestions: ['Regenerate the specification, then ask me to build it.']
  };
}

/**
 * Whether the host answered about the design under discussion (Sprint 1.7).
 *
 * The host resolves realisation state against the Specification in force, and
 * this layer knows independently which that is. They agree in every correct
 * configuration; a disagreement means something is misconfigured — two record
 * registries is the plausible one — and the safe reading is that the state is
 * about something else (ADR-AI-0004 Rule 9).
 */
function describesTheSameDesign(
  state: RealisationState,
  subject: { readonly specificationId: string; readonly revision: number }
): boolean {
  return (
    state.specificationId === subject.specificationId &&
    state.specificationRevision === subject.revision
  );
}

/**
 * What a build request gets when the design is already built (Sprint 1.7).
 *
 * `NothingToDo` — understood, possible, and there is nothing to do — which is
 * the same reason the host's own guard gives it. The suggestion matters as much
 * as the message: this refusal is conversational (ADR-AI-0004 Rule 4), so it
 * says what would change the answer rather than closing the subject.
 */
function alreadyBuilt(revision: number): PlanBlocker {
  return {
    reason: PLAN_BLOCKER_REASONS.NothingToDo,
    message: `Revision ${revision} of the design has already been built, so there is nothing to build again. Undoing the drawing does not undo that — a realisation is something that happened, not the current contents of the model.`,
    suggestions: [
      'Change the design and I will produce a new revision, which can be built in its own right.'
    ]
  };
}

/**
 * What a build request gets when the host's guard refuses for its own reason
 * (Sprint 1.7).
 *
 * The code is the host's, and it is reported rather than interpreted: this
 * layer holds no table of what each one means, because a table here is a second
 * guard growing one row at a time. Naming the code is what lets a user say it
 * back to somebody who can look it up.
 */
function hostWillNotBuild(code: string | null): PlanBlocker {
  return {
    reason: PLAN_BLOCKER_REASONS.Unsupported,
    message:
      code === null
        ? 'The application will not build this design as it stands.'
        : `The application will not build this design as it stands (${code}).`,
    suggestions: ['Revise the design and I will offer the new revision for building.']
  };
}

/** The sentence that precedes a retry, so an earlier attempt is not silent (Sprint 1.7). */
function previousAttempt(status: RealisationStatus): string {
  return status === REALISATION_STATUSES.Failed
    ? 'An earlier attempt to build this design ran and was rolled back, so the drawing is unchanged.'
    : 'An earlier attempt to build this design was refused before anything was changed.';
}

/** What a construction request gets when no Geometry Graph has been approved (Sprint 1.2). */
const NO_APPROVED_GEOMETRY =
  'There is no approved geometry yet, so there is nothing to give thickness to. Approve the geometry first and I will specify the walls.';

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
