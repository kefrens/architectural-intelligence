/**
 * Deriving the workflow state (Sprint 1.2, Epic 2 — ADR-AI-0002).
 *
 * A pure function of what the host holds. It reads the artefact port, walks the
 * pipeline table once, and answers. It generates nothing, builds no `Proposal`,
 * touches no draft and consults no provider — reading the state of a workflow is
 * not a step in it (Rule 12), which is what makes it safe to call on every
 * render.
 *
 * ```text
 *   PlanningArtefactReader ─┐
 *                           ├─▶ deriveWorkflowState() ─▶ ArchitecturalWorkflowState
 *   "is a brief drafted?" ──┘
 * ```
 *
 * ## Why the draft arrives as a boolean
 *
 * The service owns what "an open draft" means — `continueClarification` has
 * decided that since Sprint 27.8, and it involves the store, completeness and
 * whether the last answer moved anything. Passing the store here would put a
 * second opinion about it in a second place; passing the answer keeps one.
 */

import { PLAN_BLOCKER_REASONS, type PlanBlocker } from '../planning/architectural-plan.js';
import type { PlanningStage } from '../planning/planning-stage.js';
import type {
  ApprovedArtefact,
  PlanningArtefactReader
} from '../artefacts/planning-artefact-reader.js';
import { WORKFLOW_PIPELINE, type WorkflowStageDescriptor } from './pipeline.js';
import {
  STAGE_ARTEFACT_STATES,
  WORKFLOW_ACTIONS,
  type ArchitecturalStageState,
  type ArchitecturalWorkflowState,
  type ArtefactIdentity,
  type SkippedStageReason,
  type StaleDerivation,
  type WorkflowAction
} from './workflow-state.js';

export interface DeriveWorkflowStateOptions {
  /**
   * Where approved artefacts are read from. Omitted means the projection reports
   * five untouched stages rather than throwing — this package is an *optional*
   * dependency of its host (ADR-0030 Rule 2), and a projection that failed when
   * partially wired would make the degraded path the broken path (Rule 11).
   */
  readonly artefacts?: PlanningArtefactReader;
  /** Whether an unfinished Brief is open in the conversation. */
  readonly hasBriefDraft?: boolean;
  /**
   * Stages this design will never hold an artefact for, and why (Sprint 046.4b
   * — ADR-0044 revision 1.1 Rule 2).
   *
   * A design **extracted from a drawing** enters the pipeline at the Geometry
   * Graph, so the three stages above it are absent by construction rather than
   * merely undone. Without this they read as `none`, and a host or a model
   * looking at the projection reports a missing Brief as an outstanding step —
   * nagging forever about an artefact that is not coming.
   *
   * **Supplied rather than inferred**, and that is the same argument
   * `hasBriefDraft` already makes: whether a design came from a drawing is the
   * *host's* fact, recorded on the Graph's provenance (ADR-0044 open question 4),
   * and re-deriving it here would put a second opinion about it in a second
   * place.
   *
   * An approved artefact **wins**: a user who traced a plan and later wrote a
   * Brief has a Brief, and describing the building you traced does not
   * retroactively make that Brief the Graph's source.
   */
  readonly skippedStages?: Readonly<Partial<Record<PlanningStage, SkippedStageReason>>>;
}

export function deriveWorkflowState(
  options: DeriveWorkflowStateOptions = {}
): ArchitecturalWorkflowState {
  const stages: ArchitecturalStageState[] = [];

  for (const descriptor of WORKFLOW_PIPELINE) {
    // The table is in pipeline order, so the upstream stage is always the one
    // just derived. Reading it back rather than recomputing is what makes
    // staleness transitive in one pass (Rule 6).
    const upstream = descriptor.upstream === undefined ? undefined : stages[stages.length - 1];
    stages.push(deriveStage(descriptor, upstream, options));
  }

  const complete =
    stages.every((stage) => stage.approved !== undefined) &&
    stages.every((stage) => stage.stale === undefined);

  const currentStage = firstStaleStage(stages) ?? firstUnbuiltEligibleStage(stages);

  return {
    stages,
    ...(currentStage === undefined ? {} : { currentStage }),
    complete
  };
}

function deriveStage(
  descriptor: WorkflowStageDescriptor,
  upstream: ArchitecturalStageState | undefined,
  options: DeriveWorkflowStateOptions
): ArchitecturalStageState {
  const record = readArtefact(options.artefacts, descriptor.kind);
  const approved = record === undefined ? undefined : { id: record.id, revision: record.revision };
  const revisions = revisionsOf(options.artefacts, descriptor.kind, approved);

  const blockers = blockersFor(descriptor, upstream, revisions);
  const eligible = blockers.length === 0;
  const stale = record === undefined ? undefined : staleness(descriptor, record.value, upstream);

  // Skipped only where nothing was approved: an artefact in hand is an artefact,
  // whatever the design's origin (Rule 2's "a user may still write a Brief").
  const skippedReason =
    approved === undefined ? options.skippedStages?.[descriptor.stage] : undefined;

  const artefact = artefactState(
    descriptor,
    approved !== undefined,
    options.hasBriefDraft === true,
    skippedReason
  );

  // **Derived from the resolved state, not from the option.** A draft beats
  // skipped (see `artefactState`), so reading the option directly here would
  // attach a reason to a stage reporting `draft` — and `skipped` documents
  // itself as present exactly when `artefact` is `skipped`. The first version of
  // this sprint got that wrong and a test caught it.
  const skipped =
    artefact === STAGE_ARTEFACT_STATES.Skipped && skippedReason !== undefined
      ? { reason: skippedReason }
      : undefined;

  return {
    stage: descriptor.stage,
    artefact,
    ...(approved === undefined ? {} : { approved }),
    revisions,
    ...(stale === undefined ? {} : { stale }),
    ...(skipped === undefined ? {} : { skipped }),
    blockers,
    eligible,
    actions: actionsFor(eligible, approved !== undefined)
  };
}

/**
 * Every revision of this kind the project holds, oldest first (Sprint 1.3).
 *
 * Falls back to the revision in force when the host's reader supplies no
 * `all()` — the lineage is unknown, not empty, and reporting the one identity
 * that *is* known beats reporting none (Rule 11).
 */
function revisionsOf(
  artefacts: PlanningArtefactReader | undefined,
  kind: string,
  approved: ArtefactIdentity | undefined
): readonly ArtefactIdentity[] {
  const all = artefacts?.all?.();
  if (all === undefined) {
    return approved === undefined ? [] : [approved];
  }

  return all
    .filter((artefact) => artefact.kind === kind)
    .map((artefact) => ({ id: artefact.id, revision: artefact.revision }))
    .sort((left, right) => left.revision - right.revision);
}

/** More than one artefact id for one stage: two lineages, and nothing says which counts. */
function brokenLineage(revisions: readonly ArtefactIdentity[]): readonly string[] | undefined {
  const ids = [...new Set(revisions.map((revision) => revision.id))];
  return ids.length > 1 ? ids : undefined;
}

/**
 * The artefact the project holds for this kind, narrowed.
 *
 * A stored artefact whose value is not an object is treated as absent rather
 * than trusted — the same narrowing the service's `approved*` accessors have
 * applied since Sprint 27.9, because the layer that stores artefacts is not the
 * layer that knows their shapes.
 */
function readArtefact(
  artefacts: PlanningArtefactReader | undefined,
  kind: string
): (ApprovedArtefact & { readonly value: object }) | undefined {
  const artefact = artefacts?.current(kind);
  return artefact !== undefined && typeof artefact.value === 'object' && artefact.value !== null
    ? (artefact as ApprovedArtefact & { readonly value: object })
    : undefined;
}

/** Reachable for the Brief only — see {@link STAGE_ARTEFACT_STATES.Draft}. */
function artefactState(
  descriptor: WorkflowStageDescriptor,
  hasApproved: boolean,
  hasBriefDraft: boolean,
  skippedReason: SkippedStageReason | undefined
): ArchitecturalStageState['artefact'] {
  if (hasApproved) {
    // An approved artefact wins over a draft beside it. A user re-describing a
    // building they have already briefed has a conversation in progress, not a
    // project without a brief; Sprint 1.3 turns that draft into a revision.
    return STAGE_ARTEFACT_STATES.Approved;
  }
  // A draft beats skipped, and deliberately: a user who traced a plan and has
  // now started describing the building is no longer skipping that stage, they
  // are part-way through it.
  if (descriptor.upstream === undefined && hasBriefDraft) {
    return STAGE_ARTEFACT_STATES.Draft;
  }
  return skippedReason === undefined ? STAGE_ARTEFACT_STATES.None : STAGE_ARTEFACT_STATES.Skipped;
}

/**
 * Why this stage cannot be generated.
 *
 * About the stage **above**, always. A stage's own staleness is not a blocker:
 * regenerating it is exactly the fix, and blocking it would leave a user with a
 * stale design and no way forward (Rule 7).
 */
function blockersFor(
  descriptor: WorkflowStageDescriptor,
  upstream: ArchitecturalStageState | undefined,
  revisions: readonly ArtefactIdentity[]
): readonly PlanBlocker[] {
  // A defect, not a workflow (Sprint 1.3, Story 1.3.4). There are no projects
  // created before this sprint, so a stage holding two lineages means the
  // revision paths regressed — and nothing here can repair it, because
  // regenerating would revise whichever lineage happens to hold the highest
  // revision and orphan the other.
  const ids = brokenLineage(revisions);
  if (ids !== undefined) {
    return [
      {
        reason: PLAN_BLOCKER_REASONS.Ambiguous,
        message: `This project holds ${ids.length} separate ${descriptor.noun}s rather than revisions of one, so there is no single ${descriptor.noun} to build on.`,
        suggestions: ['Report this: an artefact lineage was split, which is a defect.']
      }
    ];
  }

  if (upstream === undefined) {
    // The Brief. It derives from an utterance, so it is always available.
    return [];
  }

  const upstreamNoun = nounFor(upstream.stage);

  // The same defect one stage up. Building on an ambiguous input would produce
  // an artefact whose provenance names one of two lineages, silently.
  if (brokenLineage(upstream.revisions) !== undefined) {
    return [
      {
        reason: PLAN_BLOCKER_REASONS.Ambiguous,
        message: `The ${upstreamNoun} this ${descriptor.noun} derives from has more than one lineage, so it cannot say which one to build from.`,
        suggestions: ['Report this: an artefact lineage was split, which is a defect.']
      }
    ];
  }

  if (upstream.approved === undefined) {
    return [
      {
        reason: PLAN_BLOCKER_REASONS.MissingInformation,
        message: `There is no approved ${upstreamNoun} yet, so there is nothing to build the ${descriptor.noun} from.`,
        suggestions: [`Approve a ${upstreamNoun} first.`]
      }
    ];
  }

  if (upstream.stale !== undefined) {
    return [
      {
        reason: PLAN_BLOCKER_REASONS.Superseded,
        message: `The approved ${upstreamNoun} is out of date, so a ${descriptor.noun} built from it would be out of date too.`,
        suggestions: [`Regenerate the ${upstreamNoun} first.`]
      }
    ];
  }

  return [];
}

/**
 * Whether this artefact is still derived from the revision in force.
 *
 * Two ways to be stale, and the difference is what a user needs to hear:
 * *this* artefact was built from something that has since been replaced, or
 * everything about it is fine and the stage above it is the problem.
 */
function staleness(
  descriptor: WorkflowStageDescriptor,
  value: object,
  upstream: ArchitecturalStageState | undefined
): StaleDerivation | undefined {
  const inForce = upstream?.approved;
  if (
    upstream === undefined ||
    inForce === undefined ||
    descriptor.derivedFrom === undefined ||
    descriptor.matches === undefined
  ) {
    // The Brief, or a stage whose upstream the project no longer holds. Nothing
    // to compare against is not the same as diverging from something, and the
    // blocker on the stage below already says the chain is broken.
    return undefined;
  }

  // Reading the provenance first is what makes calling the predicate safe: an
  // artefact that arrived through an opaque store may carry anything, and a
  // value with readable provenance is a value the predicate can read.
  const derivedFrom = descriptor.derivedFrom(value);
  if (derivedFrom === undefined) {
    return undefined;
  }

  const diverged = !descriptor.matches(value, inForce);
  if (diverged) {
    return { upstreamStage: upstream.stage, derivedFrom, nowInForce: inForce, inherited: false };
  }

  return upstream.stale === undefined
    ? undefined
    : { upstreamStage: upstream.stage, derivedFrom, nowInForce: inForce, inherited: true };
}

function actionsFor(eligible: boolean, hasApproved: boolean): readonly WorkflowAction[] {
  if (!eligible) {
    return [];
  }
  return hasApproved ? [WORKFLOW_ACTIONS.Regenerate] : [WORKFLOW_ACTIONS.Generate];
}

/** The first stage whose artefact is no longer current — the earliest thing to fix. */
function firstStaleStage(stages: readonly ArchitecturalStageState[]): PlanningStage | undefined {
  return stages.find((stage) => stage.stale !== undefined)?.stage;
}

/** Failing that, the first stage that can be generated and has not been. */
function firstUnbuiltEligibleStage(
  stages: readonly ArchitecturalStageState[]
): PlanningStage | undefined {
  return stages.find((stage) => stage.eligible && stage.approved === undefined)?.stage;
}

function nounFor(stage: PlanningStage): string {
  return WORKFLOW_PIPELINE.find((descriptor) => descriptor.stage === stage)?.noun ?? stage;
}
