# Sprint 1.10 — Reading a Drawing, Semantically

> **Status:** **Complete and green** (2026-08-20)
>
> **Version:** 1.0 · **Prerequisites:** Sprint 1.9 (the reader),
> **ArchiSimple Sprint 046.7w** — the platform contract, released first per
> ADR-0030 Rule 8
>
> **Scope:** the consumer side of the new `PlanReading`. No substrate
> extraction, no semantic-to-geometry association, `canReadVector` untouched.
>
> **One thing needs a decision before this is useful in practice:** §6.

---

# 1. What changed

The reader asked a model for **wall endpoints in pixels**. It now asks what the
drawing **means**.

| | before | after |
| --- | --- | --- |
| a wall | `from`, `to` | `wallKind`, `region`, `separates` |
| kinds parsed | 3 | 6 — space, wall, opening, dimension, annotation, text |
| wall kinds | — | `loadBearing`, `external`, `partition`, `unknown` |
| "I could not tell" | nothing | `PlanReading.blockers` |
| text provenance | none | `source`, and document-stated runs supplied to the prompt |

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
dimensions exactly as printed; and every mark that is *not* building fabric.

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

And on uncertainty: say so in `blockers` or use `unknown`; *"do not replace
uncertainty with a precise-looking answer."*

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

| | |
| --- | --- |
| reading tests | ✅ 33 passed |
| package tests | ✅ 924 passed, 1 pre-existing failure (§7) |
| `tsc -b` | ✅ |
| `eslint .` | ✅ clean |
| prettier | ✅ my files clean; 12 pre-existing docs unformatted, one fewer than before |
| ArchiSimple host typecheck / tests / depcruise / validators / build | ✅ all green |

The mutation-resistant tests the sprint asked for: no `from`/`to` **anywhere in
the serialised payload**; a wall offering endpoints is refused; regions survive;
`separates` survives; all six kinds and all four wall kinds accepted and a fifth
rejected; blockers survive and an out-of-vocabulary reason does not; a
non-finite or out-of-range confidence is refused rather than clamped; and the
absent-port path still answers with a blocker and stays usable.

---

# 6. **The threshold now blocks every wall, and I did not change it**

Run end to end against a live model on `PlanSimple`, the reader produces a valid
`PlanReading` — and **zero wall observations**. `READING_CONFIDENCE_THRESHOLD` is
**0.8**, and what the model actually reports sits well below it:

| kind | blocked by the threshold | confidence range |
| --- | --- | --- |
| wall | 14 | 0.45 – 0.60 |
| opening | 8 | 0.40 – 0.60 |
| dimension | 7 | 0.55 – 0.70 |
| annotation | 3 | 0.40 – 0.50 |
| text | 2 | 0.70 |
| **space** | **0** | **0.85 and up — the only kind that clears it** |

Two runs, same shape: everything that survives is a `space`, plus whatever text
and annotation happen to land high. **Not one wall has ever cleared 0.8.**

That `space` is the sole survivor is itself informative — it is the one claim a
model makes from reading a printed label, and it matches 046.7u's finding that
all three independent readings agreed on all seven rooms.

That is the code doing exactly what Rule 5 says. It is also useless in practice,
and the reason is a calibration that predates the contract: **0.8 was chosen for
coordinate extraction**, where a wrong observation put a wall 157 mm off. Under
the new contract a wall observation is a *claim* that a deterministic resolver
will test against real geometry, and whose failure mode is "finds nothing" or
"asks the user" — not a mislocated wall.

**I have not touched the number.** Recalibrating a threshold so a small sample
passes is how a measurement becomes a guarantee, and 046.7s measured that band
at close to a coin toss. The options, for a decision rather than a drift:

1. lower the threshold for semantic kinds, with a stated rationale;
2. apply it per kind — the measured spread differs sharply by kind, and `space`
   clearing it while nothing else does is the clearest evidence for this;
3. leave it, and let the **resolver** be the filter: a claim that selects no
   geometry costs nothing, which is arguably what Rule 12 already implies.

Option 3 is the one that needs no new number and no new rule. It is not this
sprint's to choose.

## 6.1 One behaviour change, and why it is not a weakening

A doubtful observation used to refuse the **whole** reading. It now becomes a
`low-confidence` blocker and the rest of the reading survives.

The original objection was about *silence* — "a plan silently missing the walls
the model was unsure of has holes exactly where a user would have looked twice".
The contract now has a field for saying so, so nothing is silent. Nothing
low-confidence reaches a caller either way, and the host's `judgeObservations`
already produced per-item blockers at the same threshold: this aligns the two
rather than relaxing either.

---

# 7. Remaining issues

**One pre-existing test failure**, unrelated and untouched:
`bug-011-constraint-evaluation.test.ts > cannot name the second bedroom in a
constraint`. Verified failing identically on a clean tree at `0b43998`.

**No ADR contradiction found.** Rules 11 and 12 were implementable as written;
§6 is a calibration question the ADR does not decide and this sprint does not
either.

**Not done:** substrate extraction, semantic-to-geometry association, any
version bump or publish.
