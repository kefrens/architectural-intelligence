/**
 * Reading a drawing (Sprint 1.9).
 *
 * The reader is the first thing in this arc that cannot be tested
 * deterministically — and these tests are mostly about **how little** of it is
 * that. The port is faked, so everything except the model itself is exercised
 * exactly as it ships.
 *
 * What is not here is a test against a real provider. A vision model's output is
 * not reproducible, and a CI job that fails when a provider changes its mind
 * teaches people to ignore CI.
 */

import { describe, expect, it, vi } from 'vitest';
import { PLAN_OBSERVATION_KINDS } from '@archisimple/ai-engine';
import { PLAN_BLOCKER_REASONS } from '../planning/index.js';
import { READING_CONFIDENCE_THRESHOLD, readPlan } from '../reading/read-plan.js';
import type { PlanVisionPort } from '../reading/plan-vision-port.js';

const IMAGE = {
  mediaType: 'image/png',
  data: 'aGVsbG8=',
  pixelWidth: 1240,
  pixelHeight: 1754
};

const request = { image: IMAGE, pageIndex: 2 };

/** A port that answers with whatever text the test names. */
const porting = (text: string): PlanVisionPort => ({ read: vi.fn(async () => ({ text })) });

const wall = (confidence = 0.94) => ({
  kind: 'wall',
  from: { x: 10, y: 20 },
  to: { x: 90, y: 20 },
  confidence
});

const replyWith = (...observations: unknown[]): string => JSON.stringify({ observations });

describe('what comes back', () => {
  it('reads walls, openings and text, keeping page pixels untouched', async () => {
    const outcome = await readPlan(
      request,
      porting(
        replyWith(
          wall(),
          {
            kind: 'opening',
            from: { x: 30, y: 20 },
            to: { x: 45, y: 20 },
            symbol: 'door',
            confidence: 0.91
          },
          { kind: 'text', at: { x: 50, y: 12 }, text: '3,40', confidence: 0.88 }
        )
      )
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reading.observations).toHaveLength(3);
    expect(outcome.reading.observations[0]).toEqual({
      kind: PLAN_OBSERVATION_KINDS.Wall,
      from: { x: 10, y: 20 },
      to: { x: 90, y: 20 },
      confidence: 0.94
    });
  });

  it('carries the page the reading came from', async () => {
    // An observation's pixels are meaningless without the raster they index
    // into, and a document read page by page has to be reassembled.
    const outcome = await readPlan(request, porting(replyWith(wall())));

    expect(outcome.ok && outcome.reading).toMatchObject({
      pageIndex: 2,
      pixelWidth: 1240,
      pixelHeight: 1754
    });
  });

  it('leaves a dimension string exactly as printed', async () => {
    // `parseDimensionText` converts it, later, deterministically. Normalising
    // here would put the model's idea of a decimal separator in the building.
    const outcome = await readPlan(
      request,
      porting(replyWith({ kind: 'text', at: { x: 1, y: 1 }, text: '3400 mm', confidence: 0.9 }))
    );

    expect(outcome.ok && outcome.reading.observations[0]).toMatchObject({ text: '3400 mm' });
  });

  it('unwraps a fenced reply, because providers fence JSON', async () => {
    const outcome = await readPlan(
      request,
      porting('```json\n' + replyWith(wall()) + '\n```')
    );

    expect(outcome.ok).toBe(true);
  });
});

describe('what the model is not allowed to smuggle through (Rule 4)', () => {
  it('drops a length, a thickness and a room it volunteered', async () => {
    // The type cannot hold them, and neither can the boundary. A `length` here
    // is a number the model computed, and Rule 9 puts every number in a Skill.
    const outcome = await readPlan(
      request,
      porting(
        replyWith({
          ...wall(),
          length: 3.4,
          thickness: 0.2,
          roomId: 'kitchen'
        })
      )
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(Object.keys(outcome.reading.observations[0]!).sort()).toEqual([
      'confidence',
      'from',
      'kind',
      'to'
    ]);
  });

  it('discards an observation missing a coordinate rather than placing it at NaN', async () => {
    // A wall at `NaN` draws nothing and reports success, which is the worst
    // available outcome.
    const outcome = await readPlan(
      request,
      porting(replyWith({ kind: 'wall', from: { x: 1, y: 2 }, confidence: 0.9 }, wall()))
    );

    expect(outcome.ok && outcome.reading.observations).toHaveLength(1);
  });

  it('discards an unknown kind rather than passing it on', async () => {
    const outcome = await readPlan(
      request,
      porting(replyWith({ kind: 'staircase', from: { x: 1, y: 1 }, confidence: 0.9 }, wall()))
    );

    expect(outcome.ok && outcome.reading.observations).toHaveLength(1);
  });
});

describe('confidence is a blocker, not a filter (Rule 5)', () => {
  it('refuses the whole reading when any observation is uncertain', async () => {
    // Filtering the doubtful ones out leaves a plan with holes in it, and the
    // holes are exactly where a user would have looked twice.
    const outcome = await readPlan(request, porting(replyWith(wall(0.94), wall(0.6))));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.blocker.reason).toBe(PLAN_BLOCKER_REASONS.MissingInformation);
    expect(outcome.blocker.message).toMatch(/1 of 2/);
  });

  it('accepts a reading exactly at the threshold', async () => {
    const outcome = await readPlan(request, porting(replyWith(wall(READING_CONFIDENCE_THRESHOLD))));

    expect(outcome.ok).toBe(true);
  });

  it('rejects a confidence that is not one', async () => {
    const outcome = await readPlan(
      request,
      porting(replyWith({ ...wall(), confidence: 5 }, { ...wall(), confidence: 'high' }))
    );

    expect(outcome.ok).toBe(false);
  });
});

describe('every refusal is a PlanBlocker (ADR-0027.1 Rule 8)', () => {
  it('says so when no vision port was supplied, and stays usable', async () => {
    // The ordinary case. A host with no vision-capable provider still imports,
    // places and traces plans — symmetrical with the host's own absent
    // `requestExtraction`.
    const outcome = await readPlan(request, undefined);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.blocker.reason).toBe(PLAN_BLOCKER_REASONS.Unsupported);
    expect(outcome.blocker.suggestions.join(' ')).toMatch(/by hand/i);
  });

  it('refuses prose rather than mining it (ADR-0027.1 Rule 6)', async () => {
    // A regex recovering three walls out of forty produces a confident, wrong,
    // partial building whose missing half is invisible.
    const outcome = await readPlan(
      request,
      porting('I can see a floor plan with several walls. The kitchen is to the north.')
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.blocker.reason).toBe(PLAN_BLOCKER_REASONS.Unsupported);
  });

  it('treats an empty reading as a blocker, not a success', async () => {
    // Returning nothing and reporting success is indistinguishable from failing.
    const outcome = await readPlan(request, porting(replyWith()));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.blocker.reason).toBe(PLAN_BLOCKER_REASONS.NothingToDo);
    expect(outcome.blocker.suggestions.length).toBeGreaterThan(0);
  });

  it('offers a way forward on every blocker', async () => {
    const outcomes = await Promise.all([
      readPlan(request, undefined),
      readPlan(request, porting('not json')),
      readPlan(request, porting(replyWith())),
      readPlan(request, porting(replyWith(wall(0.2))))
    ]);

    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.blocker.suggestions.length).toBeGreaterThan(0);
      expect(outcome.blocker.message).not.toBe('');
    }
  });
});

describe('the instruction forbids what the Skills already do', () => {
  it('asks the model for none of the arithmetic', async () => {
    const port = porting(replyWith(wall()));
    await readPlan(request, port);

    const call = (port.read as ReturnType<typeof vi.fn>).mock.calls[0];
    const instruction = String((call?.[0] as { instruction?: unknown })?.instruction ?? '');
    // Named in the prompt rather than merely absent from it: a model told what
    // not to compute volunteers it far less often than one left to infer.
    for (const forbidden of ['length', 'thickness', 'area', 'scale', 'metres', 'swing']) {
      expect(instruction.toLowerCase()).toContain(forbidden);
    }
    expect(instruction).toMatch(/Do NOT report, calculate or infer/);
    // The frame the coordinates are in, so a model does not invent a normalised one.
    expect(instruction).toContain('1240 by 1754');
  });
});
