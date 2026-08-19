# Sprint 1.8b — Skipped Stages

> **Status:** Complete — see §7 for what implementation found
> **Version:** 1.0 — written after the fact, which §8 is honest about
> **Repository:** `architectural-intelligence`
> **Also known as:** **ArchiSimple Sprint 046.4b**. It is named that in
> [ArchiSimple 046.4 §8.8](https://github.com/kefrens/archisimple/blob/main/docs/sprints/sprint-046.4-plan-understanding-foundation.md),
> which is where it was reassigned from — see §8
> **Related ADRs:** ArchiSimple **ADR-0044 revision 1.1 Rule 2** (upstream artefacts are absent, not fabricated); ADR-AI-0002 (architectural workflow state); ADR-0027.1 Rule 4 (approved artefacts are immutable)
> **Prerequisite:** ArchiSimple Sprint 046.4 Epics 1, 2 and 4 (landed)
> **Commit:** `a8bc95b`

---

## 1. Objective

Let a stage say **"this will never hold an artefact"**, distinctly from "this
does not hold one yet".

A design traced from a drawing enters the pipeline at the Geometry Graph
(ADR-0044 Rule 1). It has no Architectural Brief, no Space Programme and no
Layout Plan — and it never will. Before this sprint all three read as `none`,
which means *not done yet*:

```text
before   Brief: none  Programme: none  Layout: none  Graph: approved
         └─ a host renders three outstanding steps, and a model says so out loud

after    Brief: skipped (extracted-from-drawing)   …   Graph: approved
         └─ absent by construction, and the projection says which
```

The projection is read by a model, which **will** say something about it. A
workflow that reports three missing artefacts nags forever about artefacts that
are not coming.

---

## 2. Why not fabricate them instead

The alternative is to synthesise a Brief from the drawing: infer objectives,
invent a Space Programme, back-fill a Layout Plan, and hand the pipeline the
shape it expects.

ADR-0044 Rule 2 forbids it, and the reason is specific rather than dogmatic. The
Brief's entire value is that **a human stated it**. A generated one is a
plausible document nobody agreed to, sitting at the head of a lineage every
downstream artefact claims to derive from — and the first revision of it silently
marks a traced building's Graph as stale against objectives its author never had.

Recording the absence is cheaper and truthful.

---

## 3. What was built

| Piece                                        | Where                                                     |
| -------------------------------------------- | --------------------------------------------------------- |
| `STAGE_ARTEFACT_STATES.Skipped`              | `src/workflow/workflow-state.ts`                          |
| `SKIPPED_STAGE_REASONS.ExtractedFromDrawing` | `src/workflow/workflow-state.ts`                          |
| `SkippedStage`, `ArchitecturalStageState.skipped?` | `src/workflow/workflow-state.ts`                    |
| `DeriveWorkflowStateOptions.skippedStages?`  | `src/workflow/workflow-derivation.ts`                     |
| 143 lines of test                            | `src/__tests__/workflow-skipped-stages.test.ts`           |

**A reason, not a flag.** A stage skipped because the design came from a drawing
and one skipped for some later cause are different facts, and the projection is
read by a model that will describe whichever it finds.

---

## 4. The three rules that decide the edges

### 4.1 Supplied, never inferred

`skippedStages` is an **option**, the same way `hasBriefDraft` is.

Whether a design came from a drawing is the *host's* fact — recorded on the
Graph's provenance (ADR-0044 open question 4). Re-deriving it here, by noticing
that a Graph exists with nothing above it, would put a second opinion about it in
a second place, and the two would eventually disagree about a project somebody
built by hand from the Graph stage down.

### 4.2 An approved artefact wins

A user who traced a plan and **later wrote a Brief** has a Brief.

Describing the building you traced is a legitimate act, and doing it does not
retroactively make that Brief the Graph's source. So `skipped` is considered only
where nothing was approved — an artefact in hand is an artefact, whatever the
design's origin.

### 4.3 A draft beats skipped

Half-written beats never-coming. A user mid-way through a Brief for a traced
building is doing something, and reporting that stage as skipped would erase it
from under them.

---

## 5. Testing

`workflow-skipped-stages.test.ts` — the three rules above, each as its own case,
plus the shape invariant: `skipped` is present **exactly when** `artefact` is
`skipped`.

That last one is the test that earned its place. See §7.

---

## 6. Scope

**In:** the state, the reason, the option, the derivation, the tests.

**Out:**

- **Setting it.** Nothing in this repository decides a design was extracted; the
  host passes the option. Nothing passes it yet, because nothing extracts yet —
  that is Sprint 1.9 and ArchiSimple 046.7.
- **A second reason.** `extracted-from-drawing` is the only one there is
  evidence for. Inventing companions now would be inventing vocabulary for cases
  nobody has met.
- **Rendering it.** How a host or a card shows a skipped stage is the host's.

---

## 7. What implementation found

**The invariant was wrong on the first pass, and the sprint's own test caught it.**

`deriveStage` initially attached `skipped` from the **option** rather than from
the resolved artefact state. Because a draft beats skipped (§4.3), a stage
reporting `artefact: 'draft'` came back carrying a skipped reason — contradicting
the field's own documented contract, *"present exactly when `artefact` is
skipped"*.

The fix is one line and the comment beside it is longer than the code, because
the shape of the mistake is more instructive than the correction: two facts
derived from the same input, in the wrong order, one of them stale.

```ts
// **Derived from the resolved state, not from the option.**
const skipped =
  artefact === STAGE_ARTEFACT_STATES.Skipped && skippedReason !== undefined
    ? { reason: skippedReason }
    : undefined;
```

---

## 8. Why this document is late, and why it exists anyway

The work was reassigned mid-sprint. ArchiSimple 046.4 planned this as its Epic 3,
then found that `ArchitecturalWorkflowState` lives **entirely** in this
repository — so the epic could not be implemented where it was written. 046.4
revision 1.1 moved it out and named it 046.4b.

What it did not do was give it a document *here*, so a change to this
repository's workflow model was recorded only in the other repository's sprint
notes. That is exactly the trail that goes cold: the next person reading
`workflow-state.ts` finds `Skipped`, greps this repository's sprints, and finds
nothing.

Numbered **1.8b** in this repository's own sequence, and cross-referenced both
ways in the header, so either name finds it.
