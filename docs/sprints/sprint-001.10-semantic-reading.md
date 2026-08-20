# Sprint 1.10 — Reading a Drawing, Semantically

> **Status:** **Approved and complete** — 1.10 and 1.10b (2026-08-20)
>
> **Version:** 1.0 · **Prerequisites:** Sprint 1.9 (the reader),
> **ArchiSimple Sprint 046.7w** — the platform contract, released first per
> ADR-0030 Rule 8
>
> **Scope:** the consumer side of the new `PlanReading`. No substrate
> extraction, no semantic-to-geometry association, `canReadVector` untouched.
>
> **Sprint 1.10b** resolved the one open decision — §6. The threshold stays at
> 0.8 and stops removing anything: **confidence controls automatic eligibility,
> not semantic existence.**

---

# 1. What changed

The reader asked a model for **wall endpoints in pixels**. It now asks what the
drawing **means**.

|                    | before       | after                                                     |
| ------------------ | ------------ | --------------------------------------------------------- |
| a wall             | `from`, `to` | `wallKind`, `region`, `separates`                         |
| kinds parsed       | 3            | 6 — space, wall, opening, dimension, annotation, text     |
| wall kinds         | —            | `loadBearing`, `external`, `partition`, `unknown`         |
| "I could not tell" | nothing      | `PlanReading.blockers`                                    |
| text provenance    | none         | `source`, and document-stated runs supplied to the prompt |

Three files: `plan-reading-prompt.ts`, `read-plan.ts`, `reading/index.ts`. The
port is untouched — **no credential, no endpoint, no HTTP client, no second
provider path**, exactly as Sprint 1.9 left it.

---

# 2. The parser is the boundary

The one place a model could reintroduce the coordinates ADR-0044 spent six
sprints removing:

```ts
if ('from' in value || 'to' in value) {
  return undefined;
}
```

**Refused, not stripped.** A reply carrying endpoints has misunderstood the
instruction, and what it said about that wall is suspect for the same reason.
Keeping the region and quietly dropping the coordinates would turn a
misunderstanding into a plausible observation — and it is exactly the change
somebody makes later "for compatibility". A test exists only to fail if they do.

`separates` arrives as two strings and becomes two `AnchorRef`s. **Unnormalised**:
matching a label to a space is the host's, and normalising twice is how two
spellings of one room become two rooms. An unusable pair drops `separates` and
**keeps the wall** — Rule 12 leaves it unresolved rather than letting anything
fall back to proximity.

---

# 3. What the prompt tells the model

Asked: rooms by printed name with a **coarse footprint, never the box around the
label**; walls by **what they divide**; the four wall kinds with `unknown`
available rather than a forced choice; openings and what they connect;
dimensions exactly as printed; and every mark that is _not_ building fabric.

Forbidden by name: endpoints, coordinates, centrelines, paths, outlines, length,
thickness, area, angle, which walls meet, which wall hosts an opening, scale,
metres, door swing. Then:

> The exact geometry is already known from the document itself. It is not yours
> to produce, and a coordinate from you would silently become a building
> dimension. Your regions are used only to find geometry that already exists — a
> region that is roughly right is exactly as useful as one that is precisely
> right.
>
> **NEVER create geometry.**

And on uncertainty: say so in `blockers` or use `unknown`; _"do not replace
uncertainty with a precise-looking answer."_

## 3.1 Document text is supplied as data

When the host has a text layer, the runs go into the prompt between explicit
markers, labelled **data and never instructions**, and the model is told not to
transcribe. Those observations are added by `readPlan` **after** the model's
output and never through the parser — they did not come from the model and are
not a reading. `confidence: 1` describes **provenance, not correctness**: a text
layer can be wrong where fonts are mis-mapped.

---

# 4. The evidence, with its limits

Recorded in the prompt module's own doc comment so it travels with the thing it
justifies, and stated as measurements rather than guarantees:

- `loadBearing` was the strongest signal observed — 9 of 9, **on one plan, one
  page**;
- `partition` was substantially less reliable (3 of 8), and ten annotation marks
  were labelled `partition` in 046.7q. **A `partition` claim is a hypothesis for
  the resolver to test, not a finding**;
- confidence correlated with correctness **in a small sample**: 4 of 4 above
  0.85, near a coin toss at 0.5–0.6. A usable gate at the extreme, not a
  calibrated probability;
- `separates` recovered five partitions nothing else did (046.7u);
- vector and raster converge on this one contract.

---

# 5. Gates

|                                                                     |                                            |
| ------------------------------------------------------------------- | ------------------------------------------ |
| reading tests                                                       | ✅ 38 passed                               |
| package tests                                                       | ✅ 929 passed, 1 pre-existing failure (§7) |
| `tsc -b`                                                            | ✅                                         |
| `eslint .`                                                          | ✅ clean                                   |
| prettier                                                            | ✅ clean                                   |
| ArchiSimple host typecheck / tests / depcruise / validators / build | ✅ all green                               |

The mutation-resistant tests the sprint asked for: no `from`/`to` **anywhere in
the serialised payload**; a wall offering endpoints is refused; regions survive;
`separates` survives; all six kinds and all four wall kinds accepted and a fifth
rejected; blockers survive and an out-of-vocabulary reason does not; a
non-finite or out-of-range confidence is refused rather than clamped; and the
absent-port path still answers with a blocker and stays usable.

---

# 6. Confidence controls automatic eligibility, not semantic existence

Run end to end against a live model on `PlanSimple`, the reader produces a valid
`PlanReading`. What the model reports sits well below `READING_CONFIDENCE_THRESHOLD`:

| kind       | count | confidence range                                |
| ---------- | ----- | ----------------------------------------------- |
| wall       | 14    | 0.45 – 0.60                                     |
| opening    | 8     | 0.40 – 0.60                                     |
| dimension  | 7     | 0.55 – 0.70                                     |
| annotation | 3     | 0.40 – 0.50                                     |
| text       | 2     | 0.70                                            |
| **space**  | —     | **0.85 and up — the only kind that clears 0.8** |

That `space` is the sole kind clearing the gate is informative rather than merely
inconvenient: it is the one claim a model makes by reading a printed label, and
it matches 046.7u, where three independent readings agreed on all seven rooms.

## 6.1 The decision (Sprint 1.10b)

**The threshold stays at 0.8, and it stops removing anything.**

> A claim below the threshold is still a claim. It is reported, it reaches the
> deterministic resolver, and the resolver either finds substrate geometry that
> supports it or does not. **A claim that selects nothing produces no promotion,
> and that is the whole of its cost.**

0.8 remains a conservative _automatic_ gate — the same single global number the
host's `judgeObservations` applies, so there is one gate rather than two —
expressed as an exported predicate, `isAutomaticallyEligible`.

**No per-kind thresholds.** The spread above is one drawing and one sample, which
is enough to justify keeping a gate and nowhere near enough to justify six.

**No lowering.** Recalibrating so a small sample passes is how a measurement
becomes a guarantee, and 046.7s measured the 0.5–0.6 band near a coin toss.

## 6.2 Two earlier shapes, both wrong for the same reason

The loop that keeps observations has now had three forms, and the first two
decided in the reader what only the resolver can decide:

|             | behaviour                                                               | why it was wrong                                                                                                             |
| ----------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Sprint 1.9  | any doubtful observation refused the **whole reading**                  | on a real drawing that refuses every reading — a wall claim measures 0.45–0.60                                               |
| Sprint 1.10 | each doubtful observation became a **blocker**                          | not silent, but still throws the claim away — including the `separates` claims that recovered five real partitions in 046.7u |
| **1.10b**   | **every well-formed observation is kept; confidence gates eligibility** | a low-confidence claim is cheap to keep and expensive to lose                                                                |

`blockers` now carries **only what the model said it could not determine**, which
is what the field means.

**This is safe because of Rule 12, not in spite of it.** A semantic claim cannot
invent geometry — there is no field in this vocabulary in which geometry could
arrive, and a region is a box with four numbers and no endpoints. A claim naming
two rooms that do not exist resolves to nothing and costs nothing. That is
asserted by test, not by argument.

**The one remaining whole-reading refusal is about emptiness, not doubt**:
returning nothing while reporting success is indistinguishable from failing.

# 7. Remaining issues

**One pre-existing test failure**, unrelated and untouched:
`bug-011-constraint-evaluation.test.ts > cannot name the second bedroom in a
constraint`. Verified failing identically on a clean tree at `0b43998`.

**No ADR contradiction found**, in either 1.10 or 1.10b. Rules 11 and 12 were
implementable as written, and §6.1's rule is Rule 12 restated for confidence: a
claim promotes geometry or it does not, and nothing else follows from it. ADR-0044
does not decide the threshold, and §6.1 does not change what it does decide.

**Not done:** substrate extraction, semantic-to-geometry association, any
version bump or publish.
