# Bug 006 — the model abandons the pipeline after the Programme

**Investigated:** 2026-08-11\
**Status:** Partly fixed — synthesis pinned down, execution consumer outstanding\
**Severity:** High — an approved design cannot become a building model\
**Repository:** `architectural-intelligence` (the outstanding half is `archisimple`)\
**Transcript:** [bug-006-promptissues2.md](bug-006-promptissues2.md) · **Screenshot:** [bug-006-image.png](bug-006-image.png)

> Retitled. The original title — _"Geometry Generation Is Still Model-Driven"_ —
> attributes the failure to a stage that never ran. Keeping it would have sent
> the fix into the geometry synthesiser, which is the one part of this that
> works.

## Executive summary

A 100 m² apartment brief produced a floor plan containing one 10 × 10 m square
and one 3.354 m square. The report concluded that the geometry stage had fallen
back to model-driven CAD operations.

**The geometry stage never ran.** Neither did the layout stage. The pipeline
stopped after the Space Programme, and everything visible in that screenshot was
produced by `createRoom` — the direct-edit tool in `apps/web` — behaving exactly
as designed.

Run properly, the pipeline produces precisely the plan the report asks for. The
genuine gap is at the other end: **nothing consumes a Geometry Specification**,
so even a complete one draws nothing.

## The evidence

Artefact stages render a card. Compare what the transcript shows:

```text
Architectural brief     card: Reasoning / Expected outcome / "Recorded with the project"
Space programme         card: Reasoning / Expected outcome / "Recorded with the project"
"Layout: First Floor…"  bare prose. No card. Nothing recorded.
"Create a 10 × 10 m room"  createRoom — the direct-edit lane
```

There is no Layout Plan, no Geometry Graph and no Geometry Specification
anywhere in that run. `planning_generateLayout` was never called. The model
narrated a layout, then reached for the modelling tools.

The screenshot corroborates the rest: exactly two shapes, matching
_"5 further actions were proposed alongside this plan and left out"_ — the
single-proposal-slot behaviour already recorded in
[bug-005](bug-005-conversational-design-pipeline.md).

## What the pipeline actually produces

The report's Step 1 asks whether the specification would contain the seven spaces
and their resolved geometry. Run on the same Brief, it does:

```text
POLYGONS 7
  bedroom       x[0..2.909]      y[0..5.157]      14.9995 m²
  bedroom       x[2.909..5.817]  y[0..5.157]      14.9995 m²
  office        x[0..3.740]      y[5.157..8.165]  11.2496 m²
  bathroom      x[3.740..5.817]  y[5.157..8.165]   6.2498 m²
  living room   x[5.817..12.247] y[0..4.666]      29.9990 m²
  kitchen       x[5.817..10.104] y[4.666..8.165]  14.9995 m²
  hallway       x[10.104..12.247] y[4.666..8.165]  7.4998 m²

sum = 99.997 m²   envelope 12.247 × 8.165 m
wallCandidates 15 · openingCandidates 3
SPECIFICATION ok · 7 spaces · 10 walls · 3 openings · validates clean
```

Seven tiled, non-overlapping spaces with shared boundaries, inside a single
envelope of the requested area. That is a coherent plan, not a pile of squares.

## Findings, corrected

### Finding 1 — the 100 m² target became a room (correct diagnosis, wrong stage)

Real, and exactly as damaging as described. But it is `createRoom` doing what it
is for: _"make a room of 100 m²"_ is a direct modelling command, and a 10 × 10 m
square is the right answer to it. The pipeline never turns a total into a space —
the acceptance test now asserts that the largest polygon is under half the target.

### Findings 2 and 3 — `area → sqrt(area) → square` (not the pipeline)

Same cause. `createRoom` squares an area because that is the only sensible reading
of an area with no other constraint. The geometry synthesiser never does this; it
packs against the layout graph, which is why the bedrooms above are 2.909 × 5.157
rather than 3.873 square.

### Finding 4 — "the Layout is still descriptive rather than spatially resolved"

**Withdrawn.** The Layout Plan is a graph — six nodes and nine edges for this
brief — and the geometry stage resolves it into the packing above. What the
transcript shows under the heading "Layout" is the model's prose, produced
because the layout tool was never called.

### Finding 5 — independent rooms at the origin (correct, wrong stage)

Every `createRoom` places its south-west corner at the origin, so six independent
calls stack six rooms on the same point. Correct for a direct command, wrong for
a design. The pipeline places exactly one polygon at the origin; the acceptance
test asserts it.

### Finding 6 — fluent narration of work that did not happen (confirmed)

The model narrated a layout, then room placements at named coordinates, then
alignment passes — none of which happened. This is
[bug-005's Finding 5](bug-005-conversational-design-pipeline.md#still-open),
still open, and this transcript is a worse instance of it.

### Finding 7 — `storeys: 0` was accepted (new)

Not in the original report. Brief revision 1 reads **"0 storeys"**, and it was
offered for approval as a complete Brief: the mandatory-topic check tested whether
`storeys` was _present_, not whether its value meant anything.
`synthesizeProgramme` then coerced it back to 1, so nothing downstream ever
noticed. It took a transcript to see it. **Fixed** — see below.

## What was fixed here

### `storeys: 0` (Finding 7)

`COUNT_ARGUMENTS` in `brief-tools.ts` gained a `minimum` per topic: 1 for
storeys, 0 for bedrooms and bathrooms — a studio genuinely has no separate
bedroom, and `desiredSpacesFrom` already declines to create a space for a count
of zero. Below the minimum the topic is left **absent** rather than corrected, so
the host asks its question instead of inventing a requirement:

```text
storeys: 0  →  blocked: "How many storeys should the building have?"
```

That is the rule `readBriefTopics` has applied to the offline path since Sprint
27.8; this makes the tool agree with it. `bareAnswerFor` got the same guard, so
answering "none" to the storey question re-asks rather than recording zero.

### The acceptance test (report §11, artefact half)

`src/__tests__/geometry-acceptance.test.ts` — 15 assertions running the real
Brief through all four stages and checking the report's own expectations: seven
spaces at ~100 m²; one polygon per programmed instance with no invented and no
missing space; no room materialising the target area; per-space areas matching
the programme; no two spaces overlapping; exactly one polygon at the origin;
every space sharing a boundary with a neighbour; a single envelope of about the
target area; and a Specification that carries every space, derives walls and
openings, records its provenance, and passes `validateGeometrySpecification`
clean.

It deliberately stops at the artefact. The `BuildingModel` half of §11 cannot
pass yet, and pretending otherwise would be the fluent narration this bug is
about.

## What is not fixed, and why

### The Geometry Specification has no consumer

Searching all of `apps/web` for `GeometrySpecification`, `geometry-specification`
or a build plan returns **one hit, in a test fixture string**. Nothing reads the
artefact. Approving a Specification today draws nothing, which matches the
platform's own recorded limitation that turning approved geometry into walls is
not implemented.

This reframes recommendation §8.1. The Specification does not need to be _made_
authoritative — it is already complete, validated and provenance-carrying. It
needs a **reader**: Specification → Build Plan → `CompositeCommand`. That is
greenfield work in `archisimple`, and it is the single highest-value item here.

**Agreed disposition:** an ADR and its own sprint. Not started.

### Direct-edit tools are reachable during a design pipeline

Recommendation §8.2 is the report's strongest idea and stands unchanged:
`createRoom` should remain available for ordinary modelling and should not be the
mechanism by which an approved design is materialised.

`createRoom` lives in `apps/web` (`roomTools.ts`), not in this repository, so
gating it against an active design pipeline is a cross-repo decision. It belongs
with the same ADR as the consumer above — both are about the same seam.

### Why the model skipped `planning_generateLayout`

Unexplained. The tool was available and the workflow state names the next stage,
but guidance is not enforcement — the lesson bug-005 already recorded. Worth
understanding before designing any gate, because a gate that assumes the model
was confused will be the wrong gate if it simply preferred the tools it knew.

## Acceptance criteria

Artefact level — **passing**:

- [x] Geometry Specification complete
- [x] 7 spaces
- [x] approximately 100 m²
- [x] no 100 m² "apartment" room
- [x] no duplicate spaces
- [x] no overlapping independent rooms
- [x] coherent shared boundaries
- [x] valid wall graph
- [x] `validateGeometrySpecification` succeeds

Execution level — **blocked on the consumer**:

- [ ] Build Plan generated
- [ ] Building Model contains the 7 expected spaces
- [ ] approximately 100 m² in the model
- [ ] valid topology
- [ ] one undoable `CompositeCommand`

Also fixed:

- [x] A Brief cannot record zero storeys.

## Conclusion

The report's closing statement is right, with one correction to where the work
falls:

> **Architectural Intelligence decides WHAT the building geometry is.
> ArchiSimple decides HOW that geometry becomes model topology.**

Architectural Intelligence already decides what the geometry is, correctly and
deterministically, and there is now a test that keeps it that way. ArchiSimple
does not yet decide how it becomes topology, because nothing there has been asked
to read the answer.

What this bug adds to the principle is the failure mode in between:

> **An artefact nobody reads is indistinguishable from an artefact nobody
> produced.** A pipeline whose output has no consumer will be routed around — by
> a model, by a user, or by both — and the route around it looks like progress.
