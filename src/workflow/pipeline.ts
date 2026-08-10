/**
 * The pipeline, as a table (Sprint 1.2, Story 1.2.4 — ADR-AI-0002).
 *
 * Which stage follows which, what each is stored under, and how each one says
 * where it came from. Until this sprint that knowledge existed three times over,
 * none of them readable: as four `if` branches in `interpret`, as the order of
 * the `matches*` exports, and as the sequence of the `approved*` accessors.
 *
 * ```text
 * brief → programme → layout → geometry → specification
 * ```
 *
 * ## The predicates were already written
 *
 * `matchesBrief`, `matchesProgramme`, `matchesLayout` and `matchesGeometryGraph`
 * have shipped since Sprints 27.9, 28.0, 28.1a and 1.1 respectively. Three of
 * them had no production caller at all — staleness was *detectable* and never
 * detected. This table is where they finally get one, and it deliberately calls
 * them rather than comparing provenance itself: the artefact module owns what
 * "derived from" means for its own artefact, and a second comparison here would
 * be a second definition.
 *
 * `derivedFrom` exists beside them because a predicate answers `false` and a
 * user needs to know *from which revision to which* — and because it doubles as
 * the guard that makes calling the predicate safe on a value that arrived
 * through an opaque store.
 */

import { ARCHITECTURAL_BRIEF_KIND } from '../brief/architectural-brief.js';
import {
  GEOMETRY_GRAPH_KIND,
  matchesLayout,
  type GeometryGraph
} from '../geometry/geometry-graph.js';
import {
  GEOMETRY_SPECIFICATION_KIND,
  matchesGeometryGraph,
  type GeometrySpecification
} from '../geometry/geometry-specification.js';
import { LAYOUT_PLAN_KIND, matchesProgramme, type LayoutPlan } from '../layout/layout-plan.js';
import { PLANNING_STAGES, type PlanningStage } from '../planning/planning-stage.js';
import {
  matchesBrief,
  SPACE_PROGRAMME_KIND,
  type SpaceProgramme
} from '../programme/space-programme.js';
import type { ArtefactIdentity } from './workflow-state.js';

export interface WorkflowStageDescriptor {
  readonly stage: PlanningStage;
  /** The kind string the host stores this artefact under. */
  readonly kind: string;
  /**
   * How this stage is named inside a sentence addressed to the user.
   *
   * Not a UI label — the host never renders it, and it never reaches a
   * component. It composes blocker messages, exactly as `NO_APPROVED_BRIEF` and
   * its siblings have since Sprint 27.9 (ADR-AI-0002 Rule 9 governs
   * *identifiers*, and every identifier here is a stable string).
   */
  readonly noun: string;
  /** The stage this one derives from. Absent for the Brief, which derives from an utterance. */
  readonly upstream?: PlanningStage;
  /**
   * Whether this artefact was derived from the upstream artefact now in force.
   *
   * Only ever called when {@link derivedFrom} answered, which is what makes the
   * cast safe: an artefact carrying readable provenance carries the field the
   * predicate reads.
   */
  readonly matches?: (value: object, upstream: ArtefactIdentity) => boolean;
  /** The upstream revision this artefact records having been derived from. */
  readonly derivedFrom?: (value: object) => ArtefactIdentity | undefined;
}

/** A provenance pair, or `undefined` when the stored value does not carry one. */
function identity(id: unknown, revision: unknown): ArtefactIdentity | undefined {
  return typeof id === 'string' && typeof revision === 'number' ? { id, revision } : undefined;
}

/**
 * The five stages, in order. Reuses `PLANNING_STAGES` — the pipeline has had
 * exactly these five since Sprint 1.1, and a second stage vocabulary would be
 * one more thing to keep in step with the first.
 */
export const WORKFLOW_PIPELINE: readonly WorkflowStageDescriptor[] = [
  {
    stage: PLANNING_STAGES.Brief,
    kind: ARCHITECTURAL_BRIEF_KIND,
    noun: 'brief'
  },
  {
    stage: PLANNING_STAGES.Programme,
    kind: SPACE_PROGRAMME_KIND,
    noun: 'space programme',
    upstream: PLANNING_STAGES.Brief,
    matches: (value, upstream) => matchesBrief(value as SpaceProgramme, upstream),
    derivedFrom: (value) => {
      const source = (value as Partial<SpaceProgramme>).sourceBrief;
      return identity(source?.briefId, source?.briefRevision);
    }
  },
  {
    stage: PLANNING_STAGES.Layout,
    kind: LAYOUT_PLAN_KIND,
    noun: 'layout',
    upstream: PLANNING_STAGES.Programme,
    matches: (value, upstream) => matchesProgramme(value as LayoutPlan, upstream),
    derivedFrom: (value) => {
      const source = (value as Partial<LayoutPlan>).sourceProgramme;
      return identity(source?.programmeId, source?.programmeRevision);
    }
  },
  {
    stage: PLANNING_STAGES.Geometry,
    kind: GEOMETRY_GRAPH_KIND,
    noun: 'geometry',
    upstream: PLANNING_STAGES.Layout,
    matches: (value, upstream) => matchesLayout(value as GeometryGraph, upstream),
    derivedFrom: (value) => {
      const source = (value as Partial<GeometryGraph>).sourceLayout;
      return identity(source?.layoutId, source?.layoutRevision);
    }
  },
  {
    stage: PLANNING_STAGES.Specification,
    kind: GEOMETRY_SPECIFICATION_KIND,
    noun: 'specification',
    upstream: PLANNING_STAGES.Geometry,
    matches: (value, upstream) => matchesGeometryGraph(value as GeometrySpecification, upstream),
    derivedFrom: (value) => {
      const source = (value as Partial<GeometrySpecification>).sourceGeometry;
      return identity(source?.geometryGraphId, source?.geometryGraphRevision);
    }
  }
];

/** The stage order alone, for a consumer that wants the sequence and not the table. */
export const WORKFLOW_STAGE_ORDER: readonly PlanningStage[] = WORKFLOW_PIPELINE.map(
  (descriptor) => descriptor.stage
);
