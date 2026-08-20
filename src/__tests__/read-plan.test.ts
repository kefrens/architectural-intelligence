/**
 * Reading a drawing (Sprint 1.9; rewritten for the semantic contract by
 * Sprint 1.10 / ArchiSimple 046.7w).
 *
 * The reader is the first thing in this arc that cannot be tested
 * deterministically — and these tests are mostly about **how little** of it is
 * that. The port is faked, so everything except the model itself is exercised
 * exactly as it ships.
 *
 * What is not here is a test against a real provider. A vision model's output is
 * not reproducible, and a CI job that fails when a provider changes its mind
 * teaches people to ignore CI.
 *
 * The load-bearing assertions are the **negative** ones. Under ADR-0044 Rule 11
 * the model has no coordinates to give, and the single most likely regression is
 * a well-meaning change that lets `from`/`to` back through "for compatibility".
 * Several tests exist only to fail if that happens.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ANNOTATION_KINDS,
  OBSERVED_WALL_KINDS,
  PLAN_OBSERVATION_KINDS,
  TEXT_SOURCES
} from '@archisimple/ai-engine';
import { PLAN_BLOCKER_REASONS } from '../planning/index.js';
import {
  isAutomaticallyEligible,
  READING_CONFIDENCE_THRESHOLD,
  readPlan,
  type ReadPlanRequest
} from '../reading/read-plan.js';
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

const REGION = { x: 100, y: 320, width: 140, height: 30 };

const wall = (confidence = 0.94, extra: Record<string, unknown> = {}) => ({
  kind: 'wall',
  wallKind: 'partition',
  region: REGION,
  separates: ['CHAMBRE 1', 'SEJOUR'],
  confidence,
  ...extra
});

const replyWith = (...observations: unknown[]): string => JSON.stringify({ observations });
const replyFull = (observations: unknown[], blockers: unknown[]): string =>
  JSON.stringify({ observations, blockers });

const instructionOf = async (
  port: PlanVisionPort,
  req: ReadPlanRequest = request
): Promise<string> => {
  await readPlan(req, port);
  const call = (port.read as ReturnType<typeof vi.fn>).mock.calls[0];
  return String((call?.[0] as { instruction?: unknown })?.instruction ?? '');
};

describe('all six kinds survive the boundary', () => {
  it('accepts a space, wall, opening, dimension, annotation and text', async () => {
    const outcome = await readPlan(
      request,
      porting(
        replyWith(
          {
            kind: 'space',
            label: 'CHAMBRE 1',
            region: { x: 90, y: 185, width: 145, height: 145 },
            confidence: 0.85
          },
          wall(),
          {
            kind: 'opening',
            symbol: 'door',
            region: { x: 337, y: 330, width: 38, height: 12 },
            connects: ['CHAMBRE 2', 'SEJOUR'],
            confidence: 0.91
          },
          {
            kind: 'dimension',
            text: '3,40',
            region: { x: 40, y: 300, width: 60, height: 14 },
            measures: 'SEJOUR',
            confidence: 0.88
          },
          {
            kind: 'annotation',
            annotationKind: 'northArrow',
            region: { x: 512, y: 128, width: 52, height: 26 },
            confidence: 0.85
          },
          { kind: 'text', at: { x: 50, y: 12 }, text: 'RDC', confidence: 0.88 }
        )
      )
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reading.observations.map((entry) => entry.kind)).toEqual([
      'space',
      'wall',
      'opening',
      'dimension',
      'annotation',
      'text'
    ]);
  });

  it('accepts all four wall kinds and no others', async () => {
    // `unknown` is the one that matters: a model that cannot tell must have
    // somewhere to say so, or it will pick.
    const outcome = await readPlan(
      request,
      porting(
        replyWith(
          ...Object.values(OBSERVED_WALL_KINDS).map((kind) => wall(0.9, { wallKind: kind })),
          wall(0.9, { wallKind: 'structural' })
        )
      )
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reading.observations).toHaveLength(4);
    expect(outcome.reading.observations.map((e) => (e as { wallKind: string }).wallKind)).toEqual([
      'loadBearing',
      'external',
      'partition',
      'unknown'
    ]);
  });

  it('carries the page the reading came from', async () => {
    const outcome = await readPlan(request, porting(replyWith(wall())));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reading).toMatchObject({
      pageIndex: 2,
      pixelWidth: 1240,
      pixelHeight: 1754
    });
  });

  it('unwraps a fenced reply, because providers fence JSON', async () => {
    const outcome = await readPlan(request, porting('```json\n' + replyWith(wall()) + '\n```'));

    expect(outcome.ok && outcome.reading.observations).toHaveLength(1);
  });
});

describe('no geometry crosses the boundary (Rule 11)', () => {
  it('emits no from/to on any observation, ever', async () => {
    const outcome = await readPlan(
      request,
      porting(
        replyWith(
          { kind: 'space', label: 'SEJOUR', region: REGION, confidence: 0.9 },
          wall(),
          {
            kind: 'opening',
            symbol: 'door',
            region: REGION,
            confidence: 0.9
          },
          { kind: 'text', at: { x: 1, y: 2 }, text: 'x', confidence: 0.9 }
        )
      )
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    for (const observation of outcome.reading.observations) {
      expect(observation).not.toHaveProperty('from');
      expect(observation).not.toHaveProperty('to');
    }
    // The whole payload, not just the top level — a nested `from` would pass the
    // per-key check above and still be geometry.
    expect(JSON.stringify(outcome.reading)).not.toMatch(/"(from|to)"\s*:/);
  });

  it('REFUSES a wall that offers endpoints rather than stripping them', async () => {
    // The single most likely regression: a model answering the old schema, and
    // a kind-looking change that keeps the region and drops the coordinates.
    // A reply carrying endpoints has misunderstood the instruction, and what it
    // said about that wall is suspect for the same reason.
    const outcome = await readPlan(
      request,
      porting(
        replyWith(
          wall(0.9, { from: { x: 10, y: 20 }, to: { x: 90, y: 20 } }),
          wall(0.9, { to: { x: 90, y: 20 } }),
          wall()
        )
      )
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reading.observations).toHaveLength(1);
  });

  it('drops a length, a thickness and a room it volunteered', async () => {
    // The type cannot hold them, and neither can the boundary. A `length` here
    // is a number the model computed, and Rule 9 puts every number in a Skill.
    const outcome = await readPlan(
      request,
      porting(replyWith(wall(0.94, { length: 3.4, thickness: 0.2, roomId: 'kitchen' })))
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(Object.keys(outcome.reading.observations[0]!).sort()).toEqual([
      'confidence',
      'kind',
      'region',
      'separates',
      'wallKind'
    ]);
  });

  it('refuses a region that is not a real box rather than passing NaN along', async () => {
    // A region with a NaN extent matches everything or nothing depending on
    // which comparison runs first, which is worse than having no region.
    const outcome = await readPlan(
      request,
      porting(
        replyWith(
          wall(0.9, { region: { x: 0, y: 0, width: Number.NaN, height: 10 } }),
          wall(0.9, { region: { x: 0, y: 0, width: -5, height: 10 } }),
          wall(0.9, { region: { x: 0, y: 0 } }),
          wall()
        )
      )
    );

    expect(outcome.ok && outcome.reading.observations).toHaveLength(1);
  });

  it('discards an unknown kind rather than passing it on', async () => {
    const outcome = await readPlan(
      request,
      porting(replyWith({ kind: 'staircase', region: REGION, confidence: 0.9 }, wall()))
    );

    expect(outcome.ok && outcome.reading.observations).toHaveLength(1);
  });
});

describe('separates is the selector, and it survives parsing', () => {
  it('turns the wire pair into anchors, unnormalised', async () => {
    // Matching a label to a space is the host's; normalising twice is how two
    // spellings of one room become two rooms.
    const outcome = await readPlan(
      request,
      porting(replyWith(wall(0.9, { separates: ['chambre 1', ' SEJOUR'] })))
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reading.observations[0]).toMatchObject({
      separates: [{ label: 'chambre 1' }, { label: ' SEJOUR' }]
    });
  });

  it('keeps the wall but omits separates when the pair is unusable', async () => {
    // Rule 12: a wall the model can see but cannot attribute is a real reading,
    // left unresolved rather than resolved by proximity.
    const cases = [
      ['CHAMBRE 1'],
      ['CHAMBRE 1', 'SEJOUR', 'CUISINE'],
      ['CHAMBRE 1', ''],
      ['CHAMBRE 1', 7],
      'CHAMBRE 1|SEJOUR'
    ];

    for (const separates of cases) {
      const outcome = await readPlan(request, porting(replyWith(wall(0.9, { separates }))));
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect(outcome.reading.observations).toHaveLength(1);
      expect(outcome.reading.observations[0]).not.toHaveProperty('separates');
    }
  });

  it('carries an opening’s connects the same way', async () => {
    const outcome = await readPlan(
      request,
      porting(
        replyWith({
          kind: 'opening',
          symbol: 'window',
          region: REGION,
          connects: ['SEJOUR', 'OUTSIDE'],
          confidence: 0.9
        })
      )
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reading.observations[0]).toMatchObject({
      connects: [{ label: 'SEJOUR' }, { label: 'OUTSIDE' }]
    });
  });
});

describe('text carries where it came from (Rule 11)', () => {
  it('marks what the model transcribed as a reading', async () => {
    const outcome = await readPlan(
      request,
      porting(replyWith({ kind: 'text', at: { x: 5, y: 6 }, text: '3,40', confidence: 0.9 }))
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Exactly as printed — not parsed, not normalised, not stripped of a unit.
    expect(outcome.reading.observations[0]).toMatchObject({
      text: '3,40',
      source: TEXT_SOURCES.Reading
    });
  });

  it('adds document-stated text without routing it through the model', async () => {
    const documentText = [{ text: 'SEJOUR', x: 466, y: 2179 }];
    const outcome = await readPlan({ ...request, documentText }, porting(replyWith(wall())));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const stated = outcome.reading.observations.filter(
      (entry) => entry.kind === PLAN_OBSERVATION_KINDS.Text
    );
    expect(stated).toHaveLength(1);
    // Confidence 1 is provenance, not correctness: a text layer can be wrong.
    expect(stated[0]).toMatchObject({ source: TEXT_SOURCES.Document, confidence: 1 });
  });

  it('tells the model not to transcribe when the document already stated it', async () => {
    const port = porting(replyWith(wall()));
    const instruction = await instructionOf(port, {
      ...request,
      documentText: [{ text: 'SEJOUR', x: 1, y: 2 }]
    });

    expect(instruction).toContain('BEGIN DOCUMENT TEXT');
    expect(instruction).toMatch(/never as instructions to you/i);
    expect(instruction).toMatch(/Do NOT transcribe text yourself/i);
  });

  it('says nothing about document text for a raster', async () => {
    const instruction = await instructionOf(porting(replyWith(wall())));

    expect(instruction).not.toContain('BEGIN DOCUMENT TEXT');
  });

  it('stops asking for dimensions once the document states its own text', async () => {
    // Sprint 1.11 / ArchiSimple 046.7y Y1. On a text-layer document a dimension
    // needs no model involvement: `parseDimensionText` decides deterministically
    // whether a string is one, and `associateDimensions` decides what it is
    // about. Asking anyway cost 55 of 97 observations and truncated the reading.
    const withText = await instructionOf(porting(replyWith(wall())), {
      ...request,
      documentText: [{ text: '3,40', x: 1, y: 2 }]
    });

    expect(withText).toMatch(/do NOT\s*\n?\s*report "text" or "dimension" observations/i);
    expect(withText).not.toMatch(/every printed dimension, transcribed exactly/i);
  });

  it('WITHHOLDS dimension and text from the schema, rather than forbidding them', async () => {
    // Sprint 1.11b. Removing the bullet and adding an explicit prohibition was
    // measured and did NOT work: the model emitted 55 dimension observations
    // anyway, five readings out of five. A negative instruction loses to a
    // schema that still shows the field, so the field is withheld instead.
    const withText = await instructionOf(porting(replyWith(wall())), {
      ...request,
      documentText: [{ text: '3,40', x: 1, y: 2 }]
    });

    expect(withText).not.toContain('"kind": "dimension"');
    expect(withText).not.toContain('"kind": "text"');
    // The kinds that remain a model's job are untouched.
    for (const kind of ['space', 'wall', 'opening', 'annotation']) {
      expect(withText).toContain(`"kind": "${kind}"`);
    }
  });

  it('shows a raster the whole schema, every kind included', async () => {
    const raster = await instructionOf(porting(replyWith(wall())));

    for (const kind of Object.values(PLAN_OBSERVATION_KINDS)) {
      expect(raster).toContain(`"kind": "${kind}"`);
    }
  });

  it('still asks for dimensions on a raster, where nothing else can read them', async () => {
    // The condition is the point: same vocabulary, different producer
    // (ADR-0044 Rule 11). Deleting the bullet outright would blind the raster
    // path, which has no text layer to fall back on.
    const raster = await instructionOf(porting(replyWith(wall())));

    expect(raster).toMatch(/every printed dimension, transcribed exactly/i);
    expect(raster).toMatch(/"3,40" stays "3,40"/);
  });
});

describe('blockers survive parsing (ADR-0027.1 Rule 8)', () => {
  it('carries what the model said it could not determine', async () => {
    const outcome = await readPlan(
      request,
      porting(
        replyFull(
          [wall()],
          [
            { reason: 'low-confidence', detail: { between: ['SEJOUR', 'CUISINE'] } },
            { reason: 'not-stated', detail: {} }
          ]
        )
      )
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reading.blockers).toHaveLength(2);
    expect(outcome.reading.blockers[0]).toMatchObject({
      reason: 'low-confidence',
      detail: { between: ['SEJOUR', 'CUISINE'] }
    });
  });

  it('refuses a blocker reason outside the one vocabulary', async () => {
    // A second set of meanings is what Rule 8 forbids; a free-text reason here
    // would become one the first time somebody switched on it.
    const outcome = await readPlan(
      request,
      porting(replyFull([wall()], [{ reason: 'because-it-is-blurry', detail: {} }]))
    );

    expect(outcome.ok && outcome.reading.blockers).toHaveLength(0);
  });

  it('gives every reading a blockers array, even an empty one', async () => {
    const outcome = await readPlan(request, porting(replyWith(wall())));

    expect(outcome.ok && outcome.reading.blockers).toEqual([]);
  });
});

describe('confidence controls automatic eligibility, not semantic existence', () => {
  it('keeps a low-confidence wall in the reading, ineligible but present', async () => {
    // The governing rule of Sprint 1.10b. Every wall claim measured on a real
    // drawing sat at 0.45–0.60, and those are the claims that recovered five
    // real partitions in 046.7u. Dropping them here would throw away the
    // evidence the resolver exists to test.
    const outcome = await readPlan(request, porting(replyWith(wall(0.94), wall(0.5))));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reading.observations).toHaveLength(2);
    expect(outcome.reading.observations.map(isAutomaticallyEligible)).toEqual([true, false]);
  });

  it('does not convert low confidence into a blocker', async () => {
    // The shape Sprint 1.10 had, and the one this replaces: not silent, but
    // still throwing the claim away. `blockers` means "the model could not
    // determine this", and nothing else may quietly join it.
    const outcome = await readPlan(request, porting(replyWith(wall(0.2), wall(0.5))));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reading.blockers).toEqual([]);
    expect(outcome.reading.observations).toHaveLength(2);
  });

  it('discards nothing across the whole measured confidence range', async () => {
    // The distribution actually observed, kind by kind: space 0.85+, dimension
    // 0.55–0.70, wall 0.45–0.60, opening 0.40–0.60, annotation 0.40–0.50,
    // text 0.70. Exactly one clears the gate; all six survive the reading.
    const outcome = await readPlan(
      request,
      porting(
        replyWith(
          { kind: 'space', label: 'SEJOUR', region: REGION, confidence: 0.85 },
          { kind: 'dimension', text: '3,40', region: REGION, confidence: 0.55 },
          wall(0.45),
          { kind: 'opening', symbol: 'door', region: REGION, confidence: 0.4 },
          { kind: 'annotation', annotationKind: 'furniture', region: REGION, confidence: 0.4 },
          { kind: 'text', at: { x: 1, y: 2 }, text: 'RDC', confidence: 0.7 }
        )
      )
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reading.observations).toHaveLength(6);
    expect(outcome.reading.blockers).toEqual([]);
    expect(outcome.reading.observations.filter(isAutomaticallyEligible)).toHaveLength(1);
    expect(outcome.reading.observations.filter(isAutomaticallyEligible)[0]?.kind).toBe('space');
  });

  it('lets a space above the threshold proceed automatically', async () => {
    const outcome = await readPlan(
      request,
      porting(replyWith({ kind: 'space', label: 'CHAMBRE 1', region: REGION, confidence: 0.85 }))
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(isAutomaticallyEligible(outcome.reading.observations[0]!)).toBe(true);
  });

  it('gates at exactly the threshold, and it is one global number', async () => {
    // A single gate, not one per kind: the measured spread is one drawing and
    // one sample, which justifies keeping a gate and not six of them.
    const just = READING_CONFIDENCE_THRESHOLD;
    const under = READING_CONFIDENCE_THRESHOLD - 0.01;
    const outcome = await readPlan(
      request,
      porting(
        replyWith(
          { kind: 'space', label: 'A', region: REGION, confidence: just },
          { kind: 'space', label: 'B', region: REGION, confidence: under },
          wall(just),
          wall(under)
        )
      )
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Same boundary for every kind — a per-kind threshold would break this.
    expect(outcome.reading.observations.map(isAutomaticallyEligible)).toEqual([
      true,
      false,
      true,
      false
    ]);
  });

  it('still refuses a confidence that is not one, rather than clamping it', async () => {
    // Unchanged by 1.10b. A model that answered `NaN` has told us nothing, and
    // clamping would manufacture certainty. This is malformed output, which is
    // a different thing from low confidence.
    for (const confidence of [5, -1, Number.NaN, 'high', null, undefined]) {
      const outcome = await readPlan(
        request,
        porting(replyWith(wall(0.9, { confidence }), wall()))
      );
      expect(outcome.ok && outcome.reading.observations).toHaveLength(1);
    }
  });

  it('still blocks when nothing at all could be read', async () => {
    // The one remaining whole-reading refusal, and it is about emptiness rather
    // than doubt: returning nothing and reporting success is indistinguishable
    // from failing.
    const outcome = await readPlan(request, porting(replyWith({ kind: 'staircase' })));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.blocker.reason).toBe(PLAN_BLOCKER_REASONS.NothingToDo);
  });
});

describe('a low-confidence claim is harmless (ADR-0044 Rule 12)', () => {
  it('creates no geometry, at any confidence', async () => {
    // The claim carries a region and a relationship; neither is geometry, and
    // there is no field in which geometry could arrive. A claim that selects no
    // substrate simply promotes nothing — it cannot invent a wall, because
    // nothing in this layer can express one.
    const outcome = await readPlan(
      request,
      porting(
        replyWith(
          wall(0.05, { separates: ['NOWHERE', 'NOTHING'] }),
          wall(0.99, { separates: ['ALSO NOWHERE', 'STILL NOTHING'] })
        )
      )
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(JSON.stringify(outcome.reading)).not.toMatch(/"(from|to)"\s*:/);
    for (const observation of outcome.reading.observations) {
      expect(observation).not.toHaveProperty('from');
      expect(observation).not.toHaveProperty('to');
      // A region is a box. It has no endpoints and cannot be read as a line.
      expect(Object.keys((observation as { region: object }).region).sort()).toEqual([
        'height',
        'width',
        'x',
        'y'
      ]);
    }
  });

  it('names spaces that may not exist, and that is the resolver’s problem', async () => {
    // `separates` is a claim, not an assertion of fact. Nothing here checks that
    // the rooms exist — the resolver either finds geometry on their shared
    // boundary or finds none, and finding none costs nothing.
    const outcome = await readPlan(
      request,
      porting(replyWith(wall(0.5, { separates: ['ROOM THAT IS NOT ON THE PLAN', 'SEJOUR'] })))
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reading.observations[0]).toMatchObject({
      separates: [{ label: 'ROOM THAT IS NOT ON THE PLAN' }, { label: 'SEJOUR' }]
    });
  });
});

describe('every refusal is a PlanBlocker (ADR-0027.1 Rule 8)', () => {
  it('says so when no vision port was supplied, and stays usable', async () => {
    // The ordinary case, and the feature detection the host relies on: a host
    // with no vision-capable provider still imports, places and traces plans.
    const outcome = await readPlan(request, undefined);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.blocker.reason).toBe(PLAN_BLOCKER_REASONS.Unsupported);
    expect(outcome.blocker.suggestions.join(' ')).toMatch(/by hand/i);
  });

  it('asks the supplied port exactly once, and asks about this page', async () => {
    // The other half of the absent-port case: when there IS a port it is used,
    // once, with the image it was given. Catches a reader that reads twice, or
    // one that answers from something other than the page it was handed.
    const port = porting(replyWith(wall()));
    await readPlan(request, port);

    const read = port.read as ReturnType<typeof vi.fn>;
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[0]).toMatchObject({ image: IMAGE });
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

  it('refuses a reply with no observations array at all', async () => {
    const outcome = await readPlan(request, porting(JSON.stringify({ walls: [] })));

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

  it('tells a cut-off answer apart from one the model wrote wrong', async () => {
    /*
     * Sprint 1.12. Both fail at the same `JSON.parse` and mean opposite things.
     * The real case that forced this: a correct reading of ten rooms, truncated
     * at the provider's default 1024-token limit, reported as "the model did not
     * answer" — which sent the operator looking for an error the provider never
     * logged, because there wasn't one.
     */
    const fragment = replyWith(wall()).slice(0, 60);
    const truncated: PlanVisionPort = { read: vi.fn(async () => ({ text: fragment, truncated: true })) };

    const cutOff = await readPlan(request, truncated);
    const malformed = await readPlan(request, porting(fragment));

    expect(cutOff.ok).toBe(false);
    expect(malformed.ok).toBe(false);
    if (cutOff.ok || malformed.ok) return;

    // Same reason — the platform could not do it either way — different advice,
    // because only one of these is something the reader can act on.
    expect(cutOff.blocker.reason).toBe(PLAN_BLOCKER_REASONS.Unsupported);
    expect(cutOff.blocker.message).not.toBe(malformed.blocker.message);
    expect(cutOff.blocker.message).toMatch(/cut off/i);
    expect(cutOff.blocker.suggestions.join(' ')).toMatch(/limit/i);
    expect(malformed.blocker.suggestions.join(' ')).not.toMatch(/limit/i);
  });

  it('does not blame truncation for a reply that parsed', async () => {
    // `truncated` is a fact about the transport, not a verdict on the reading.
    // A whole JSON object that happens to arrive flagged still reads.
    const whole: PlanVisionPort = {
      read: vi.fn(async () => ({ text: replyWith(wall()), truncated: true }))
    };

    expect((await readPlan(request, whole)).ok).toBe(true);
  });

  it('offers a way forward on every blocker', async () => {
    // The four ways a reading can fail outright. Low confidence is deliberately
    // NOT among them since Sprint 1.10b — a 0.2 wall is a kept observation, not
    // a refusal.
    const outcomes = await Promise.all([
      readPlan(request, undefined),
      readPlan(request, porting('not json')),
      readPlan(request, porting(replyWith())),
      readPlan(request, porting(replyWith({ kind: 'staircase' })))
    ]);

    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.blocker.suggestions.length).toBeGreaterThan(0);
      expect(outcome.blocker.message).not.toBe('');
    }
  });
});

describe('the instruction asks for meaning and forbids geometry', () => {
  it('forbids every kind of arithmetic and every kind of coordinate', async () => {
    const instruction = await instructionOf(porting(replyWith(wall())));
    const lower = instruction.toLowerCase();

    // Named in the prompt rather than merely absent from it: a model told what
    // not to compute volunteers it far less often than one left to infer.
    for (const forbidden of [
      'length',
      'thickness',
      'area',
      'scale',
      'metres',
      'swing',
      'endpoints',
      'coordinates',
      'centrelines'
    ]) {
      expect(lower).toContain(forbidden);
    }
    expect(instruction).toContain('NEVER create geometry');
    expect(instruction).toMatch(/already known from the document itself/i);
    // The frame a region is stated in, so a model does not invent a normalised one.
    expect(instruction).toContain('1240 by 1754');
  });

  it('asks for each of the six kinds and each of the four wall kinds', async () => {
    const instruction = await instructionOf(porting(replyWith(wall())));

    for (const kind of Object.values(PLAN_OBSERVATION_KINDS)) {
      expect(instruction).toContain(`"${kind}"`);
    }
    for (const kind of Object.values(OBSERVED_WALL_KINDS)) {
      expect(instruction).toContain(kind);
    }
    for (const kind of Object.values(ANNOTATION_KINDS)) {
      expect(instruction).toContain(kind);
    }
  });

  it('asks for what a wall divides, and for a room footprint not a label box', async () => {
    const instruction = await instructionOf(porting(replyWith(wall())));

    expect(instruction).toMatch(/WHAT IT DIVIDES/);
    expect(instruction).toMatch(/separates/);
    // The distinction 046.7u's trap rejection depends on entirely.
    expect(instruction).toMatch(/never the box\s*\n?\s*around its printed name/i);
  });

  it('tells the model to say it cannot tell rather than answer precisely', async () => {
    const instruction = await instructionOf(porting(replyWith(wall())));

    expect(instruction).toMatch(/blockers/);
    expect(instruction).toMatch(/Do not replace uncertainty with a precise-looking answer/i);
    expect(instruction).toMatch(/Use "unknown" rather than choosing/i);
  });
});
