/**
 * Sprint 046.4b — skipped is not pending (ADR-0044 revision 1.1 Rule 2).
 *
 * A design traced from a drawing enters the pipeline at the **Geometry Graph**
 * (ADR-0044 Rule 1), so it has no Brief, no Space Programme and no Layout Plan —
 * and it never will. Until this sprint those stages reported `none`, which means
 * "not done **yet**", and a host or a model reading the projection would report
 * a missing Brief as an outstanding step: nagging forever about an artefact that
 * is not coming.
 *
 * Rule 2 is explicit that the upstream artefacts are **absent, not fabricated**.
 * Inventing objectives from a drawing to satisfy the pipeline's shape would
 * fabricate the one artefact whose whole value is that a human stated it, so the
 * projection records the absence honestly instead.
 *
 * ## What has no producer yet
 *
 * Nothing sets `skippedStages` in production. Whether a design came from a
 * drawing is the **host's** fact, recorded on the Graph's provenance
 * (ADR-0044 open question 4), and that provenance arrives with the extraction
 * sprints. This is the vocabulary and its derivation; the value lands later.
 */

import { describe, expect, it } from 'vitest';
import {
  deriveWorkflowState,
  SKIPPED_STAGE_REASONS,
  STAGE_ARTEFACT_STATES,
  stageState
} from '../workflow/index.js';
import { PLANNING_STAGES } from '../planning/planning-stage.js';

const tracedFromDrawing = {
  [PLANNING_STAGES.Brief]: SKIPPED_STAGE_REASONS.ExtractedFromDrawing,
  [PLANNING_STAGES.Programme]: SKIPPED_STAGE_REASONS.ExtractedFromDrawing,
  [PLANNING_STAGES.Layout]: SKIPPED_STAGE_REASONS.ExtractedFromDrawing
} as const;

describe('a design that came from a drawing', () => {
  it('reports its upstream stages as skipped rather than untouched', () => {
    const state = deriveWorkflowState({ skippedStages: tracedFromDrawing });

    for (const stage of [
      PLANNING_STAGES.Brief,
      PLANNING_STAGES.Programme,
      PLANNING_STAGES.Layout
    ]) {
      expect(stageState(state, stage)?.artefact).toBe(STAGE_ARTEFACT_STATES.Skipped);
    }
  });

  it('says **why**, because a projection a model reads should not have to guess', () => {
    const state = deriveWorkflowState({ skippedStages: tracedFromDrawing });

    expect(stageState(state, PLANNING_STAGES.Brief)?.skipped).toEqual({
      reason: SKIPPED_STAGE_REASONS.ExtractedFromDrawing
    });
  });

  it('leaves the stages it was not told about untouched', () => {
    // Only the three above the Graph are skipped. The Graph itself and the
    // Specification are ordinary stages with ordinary work outstanding.
    const state = deriveWorkflowState({ skippedStages: tracedFromDrawing });

    expect(stageState(state, PLANNING_STAGES.Geometry)?.artefact).toBe(STAGE_ARTEFACT_STATES.None);
    expect(stageState(state, PLANNING_STAGES.Geometry)?.skipped).toBeUndefined();
  });

  it('is not the same as an untouched project', () => {
    // The distinction the whole sprint is for: `none` and `skipped` must not be
    // the same value, or the nagging comes back.
    const untouched = deriveWorkflowState();

    expect(stageState(untouched, PLANNING_STAGES.Brief)?.artefact).toBe(STAGE_ARTEFACT_STATES.None);
    expect(stageState(untouched, PLANNING_STAGES.Brief)?.skipped).toBeUndefined();
  });
});

describe('what still beats skipped', () => {
  it('a Brief the user wrote afterwards', () => {
    // Rule 2: "A user may still write a Brief afterwards — describing the
    // building they traced is a legitimate act." Having one is having one, and
    // it does not retroactively become the Graph's source.
    const state = deriveWorkflowState({
      skippedStages: tracedFromDrawing,
      hasBriefDraft: true
    });

    expect(stageState(state, PLANNING_STAGES.Brief)?.artefact).toBe(STAGE_ARTEFACT_STATES.Draft);
    expect(stageState(state, PLANNING_STAGES.Brief)?.skipped).toBeUndefined();
  });

  it('and a draft is still only a draft for the stage that can hold one', () => {
    // The Brief is the one stage with a draft store. A draft flag must not
    // rescue the Programme or the Layout from being skipped.
    const state = deriveWorkflowState({
      skippedStages: tracedFromDrawing,
      hasBriefDraft: true
    });

    expect(stageState(state, PLANNING_STAGES.Programme)?.artefact).toBe(
      STAGE_ARTEFACT_STATES.Skipped
    );
  });
});

describe('the invariant `skipped` documents about itself', () => {
  it('is present exactly when the stage reports skipped', () => {
    // The bug this sprint's first version had: the reason was attached from the
    // option rather than from the resolved state, so a stage reporting `draft`
    // carried a `skipped` reason beside it. Asserted across the whole
    // projection rather than for one stage, because the invariant is the type's.
    for (const options of [
      {},
      { skippedStages: tracedFromDrawing },
      { skippedStages: tracedFromDrawing, hasBriefDraft: true },
      { hasBriefDraft: true }
    ]) {
      for (const stage of deriveWorkflowState(options).stages) {
        expect(stage.skipped !== undefined).toBe(stage.artefact === STAGE_ARTEFACT_STATES.Skipped);
      }
    }
  });
});

describe('the projection stays honest about what can be done', () => {
  it('does not make a skipped stage ineligible', () => {
    // Skipping is a statement about what the project *holds*, not about what a
    // user may do. Someone who traced a plan and then wants to write a Brief
    // must not find the stage refused — Rule 2 says exactly the opposite.
    const state = deriveWorkflowState({ skippedStages: tracedFromDrawing });

    expect(stageState(state, PLANNING_STAGES.Brief)?.eligible).toBe(true);
  });

  it('reports the design as incomplete, because it is', () => {
    // A skipped stage is not a satisfied one. Nothing is approved here, so the
    // design is not complete and the projection must not claim otherwise.
    const state = deriveWorkflowState({ skippedStages: tracedFromDrawing });

    expect(state.complete).toBe(false);
  });
});
