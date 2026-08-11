# Sprint 1.5 — Brief Lifecycle Integrity

> **Status:** Completed — 2026-08-10
>
> **Version:** 1.1 — implemented; see _Implementation Notes_
>
> **Repository:** `architectural-intelligence`
>
> **Related ADRs:** ADR-0027.1 (Rules 4, 6, 8), ADR-AI-0002 (Rules 1, 5, 7, 13), ADR-0029 Rule 3
>
> **Predecessor:** Sprint 1.4 — Workflow State in Context
>
> **Origin:** [bug-002-lineage-findings.md](../bug/bug-002-lineage-findings.md) — a regression in Sprint 1.3
>
> **Numbered 1.5**, not 1.4: that number belongs to the workflow-state sprint that has already landed.

---

# Sprint Design Contract

The authoritative source is
[docs/architecture/00-current-state.md](../architecture/00-current-state.md).
Where this sprint conflicts with it, this sprint is wrong.

This sprint **closes three paths that fork the Brief's lineage** and widens one
word set. It adds no artefact, no stage, no registry, no execution path, and no
ADR.

- [x] The lineage validation is **not** weakened and no lineage is auto-chosen.
- [x] No second revision rule: everything folds through one function.
- [x] The `planning_captureBrief` **name and schema are unchanged** — no model sees a difference.
- [x] No model output is read anywhere (ADR-0027.1 Rule 6).

---

# Current State

Sprint 1.3 established that regenerating a stage the project holds is a
**revision** of it, never a second artefact, and gave four of the five stages
that behaviour (Story 1.3.7). The Brief got a revision path through the
conversation (Story 1.3.5) and **kept every path that creates one**.

There are three, and all three fork:

| Path                                        | Today                                      |
| ------------------------------------------- | ------------------------------------------ |
| `planning_captureBrief`                     | `createBrief` → new id, revision 1, always |
| `interpret` → `brief-generation`            | `assembleBrief` → new id, revision 1       |
| `interpret` → clarification completes       | the draft's own id becomes the artefact    |
| `interpret` → `brief-revision` (Sprint 1.3) | folds into the approved Brief ✓            |

The tool is the one planning tool that is a standalone `const` rather than a
factory bound to the service, so it cannot read `approvedBrief()` and cannot know
a Brief exists. That is why it was the one stage Story 1.3.7 could not reach.

Sprint 1.3 also made the consequence terminal. A second lineage sets the
`ambiguous` blocker on the Brief stage itself, which sets `eligible: false`, which
empties `actions`, which leaves `currentStage` undefined — every surface offers
the user nothing, and there is no way back.

---

# Why

Bug 002, reproduced exactly:

```
capture #1 -> c2df8abb rev 1
capture #2 -> 85f3adfb rev 1        same lineage? false
currentStage = undefined
```

Two turns from a fresh project to a dead one. Story 1.3.4's justification —
"there are no projects created before this sprint" — reasoned only about
pre-existing files and missed the live path entirely.

The guard itself is correct and stays. What changes is that the state it guards
against stops being reachable through ordinary use.

---

# The rule

> **Producing a Brief for a project that already has one is a revision of it.**

Story 1.3.7's rule, applied to the fifth stage and to every door that reaches it.
One folding function, three callers, so there is no second opinion about what
"the same Brief, changed" means.

```text
                         requirements from …
   a tool call ──┐
   an utterance ─┼──▶ reviseBriefFromFields(approved, fields)
   a draft ──────┘              │
                                ├─ nothing moved  → undefined → NothingToDo
                                └─ something moved → revision n+1, same id
```

`reviseBriefFrom(approved, utterance)` — Sprint 1.3's entry point — becomes a
thin reader in front of it: read topics from the utterance, then fold. Its
behaviour is unchanged.

## What folding means

Settled in Sprint 1.3 and restated because two more callers now depend on it:
requirements stated in the new input **override their topic**, everything else is
carried forward **with its original `source`**, and `objectives` are carried
forward — a correction is not a new purpose. Desired spaces are merged.

`utterance` is replaced only when the caller has one. A tool call has structured
fields and no sentence of its own, so the Brief keeps the words it was first
described with.

---

# Epics

## Epic 1 — Revision-safe Brief production

### Story 1.5.1 — `reviseBriefFromFields`

The one folding function, beside `assembleBriefFromFields`. Answers `undefined`
when neither requirements nor desired spaces moved, exactly as
`reviseBriefFrom` already answers `undefined` for an utterance that restates
what the Brief says.

`reviseBriefFrom` is reimplemented on top of it. Two readers, one rule.

### Story 1.5.2 — The capture tool becomes service-bound

`captureBriefToolDefinition` → `createCaptureBriefToolDefinition(intelligence)`,
like its four siblings. The function name, the schema and every argument stay
exactly as they are: this changes who composes the tool, not what a model sees.

**This is a breaking change to the package's public API**, and it removes the
standalone export deliberately — leaving it would leave the fork path exported
beside the fixed one. See _Cross-repository_ below for the one consumer.

### Story 1.5.3 — Re-capture with no changes

Answers `blocked` with the `NothingToDo` vocabulary and a sentence naming what to
do instead. In Bug 002's transcript this alone ends the loop: the second "ok"
stops producing a Brief and says the project already has one.

### Story 1.5.4 — Re-capture with changes

Revision _n+1_, same id, provenance intact. The proposal's title already reads
"Architectural brief (revision 2)" — `toBriefProposal` has handled that since
Sprint 27.8 and needs no change.

### Story 1.5.5 — Production tests for both

Driven through the tool, not through the folding function, because the tool is
where the fork lived.

---

## Epic 2 — Conversational Brief lifecycle

### Story 1.5.6 — `brief-generation` consults the approved Brief

When one exists, the branch folds instead of assembling. A complete design
request that arrives without a revision cue —
`design a two-storey house with 4 bedrooms and 2 bathrooms` — currently forks;
it becomes a revision.

### Story 1.5.7 — A completed clarification folds too

The third path, and the one the findings only caught by probing. A draft
completed by `answerClarification` currently becomes the artefact **under the
draft's own id**. When a Brief is approved, the draft's requirements fold into it
instead.

### Story 1.5.8 — Unchanged input answers `NothingToDo`

Both conversational paths, matching the tool. `reviseApprovedBrief` already does
this and is reused rather than reimplemented.

### Story 1.5.9 — No conversational path can fork

Asserted directly: drive every lane that can produce a Brief against a project
that already holds one, and assert the registry still holds a single id.

---

## Epic 3 — Architectural request classification

### Story 1.5.10 — Dwelling recognition

`DWELLING_WORDS` is an exact-match list, so `appartment` — the French spelling and
a common English misspelling — names no dwelling, and
`Build me a 100m2 appartment, with 2 bedrooms and 1 bathroom` falls to Direct
Execution, where the planner answers "I did not recognise that" and lists seven
`edit.*` operations.

Cover `appartment` and `appartement`, and add the dwelling types the list simply
never had.

### Story 1.5.11 — Positive and negative classifier tests

Positive: each new spelling and type reaches the design lane. Negative: every
modelling command still stays in Direct Execution — the asymmetry the classifier
was built around does not move.

---

## Epic 4 — Regression

### Story 1.5.12 — Bug 002, as a test

The transcript, as far as this repository can drive it:

```text
request → Brief v1 → approve → re-capture unchanged ("ok")
                                    │
                                    └─▶ NothingToDo, and the registry is untouched
```

Asserted after the re-capture:

- Brief **lineages = 1**
- Brief **revisions = 1**
- the workflow state is alive: `currentStage` is `programme`, `nextTool` is
  `planning_generateProgramme`

### Story 1.5.13 — The full five stages, after a re-capture

The whole pipeline still completes when a re-capture happened partway through,
and the Brief still has one lineage at the end.

### Story 1.5.14 — The guard still guards

A project holding two lineages is still reported as `ambiguous`, and no lineage
is chosen for the user. Sprint 1.3's assertions stay exactly as they are — this
sprint makes the state unreachable, it does not make it acceptable.

---

# Cross-repository

`apps/web/src/ai/__tests__/architecturalBrief.test.ts` imports
`captureBriefToolDefinition` by name, in five places. It is the **only** consumer
in either repository, and it is a test — no production file in `apps/web` names
the tool, because tools arrive through the contribution (ADR-0029 Rule 2).

Story 1.5.2 breaks it. The fix is mechanical — build the tool from a service the
test already knows how to compose — and it belongs to ArchiSimple. It is done in
the same pass here only so the local workspace stays green, and it is called out
rather than folded in silently.

No platform release is involved: nothing about the platform changes.

---

# Out of Scope

| Not here                                            | Why                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| Repairing a project that already holds two lineages | Needs a user to choose between two designs; the choice needs a surface |
| Weakening or auto-resolving the lineage guard       | The bug report forbids it, and it is right to                          |
| Fuzzy or edit-distance matching of dwelling words   | See below                                                              |
| A "design verb + two mandatory topics" lane         | See below                                                              |
| The pending proposal, the IA panel, execution       | Unchanged from Sprints 1.2–1.4                                         |

## The classifier fix that is deliberately not taken

The findings offered a broader remedy: treat _a design verb plus two or more
mandatory brief topics_ as programme evidence even when no dwelling word matched,
on the grounds that "build me … with 2 bedrooms and 1 bathroom" is unambiguously
a design request whatever the noun was.

It is probably the better rule and it is **not** taken here, because it widens
the lane the classifier deliberately keeps narrow — the asymmetry documented in
`request-classification.ts`, where the cost of hijacking a modelling command is
higher than the cost of missing a design request. That trade deserves its own
decision rather than arriving inside a lineage fix.

Adding spellings does not touch the trade: a word set that already accepts
`apartment` accepting `appartment` changes nothing about what counts as evidence.

## Repairing the damaged project

The project from Bug 002's transcript holds two designs and no basis for
preferring either. The honest options are to start a new project, or to build an
explicit "use this brief" action — which needs a surface that can show a user
both lineages, and that is the IA panel, not a lane.

---

# Implementation Notes

## What shipped

Every epic. **642 tests across 15 files** here, 731 across 88 in `apps/web`,
both repositories building and linting clean.

| Story           | Landed as                                                                       |
| --------------- | ------------------------------------------------------------------------------- |
| 1.5.1           | `reviseBriefFromFields`, with `reviseBriefFrom` reimplemented on top of it      |
| 1.5.2 – 1.5.5   | `createCaptureBriefToolDefinition(intelligence)`; the standalone export removed |
| 1.5.6 – 1.5.9   | Both conversational paths fold; `nothingToRevise()` shared by all three         |
| 1.5.10 – 1.5.11 | Spellings and missing dwelling types, with the negative half asserted           |
| 1.5.12 – 1.5.14 | `src/__tests__/brief-lifecycle.test.ts` (32)                                    |

## Where this reads differently from the plan

### Change is judged on the input, not the merged result

The first implementation compared the approved Brief's desired spaces against the
**merged** list, and every identical re-capture came back as a change — Bug 002's
loop, reproduced by the fix for it. `mergeSpaces` also _derives_ spaces from the
requirements, so a Brief whose spaces named only bedrooms gains a bathroom from
its own bathroom count, and that enrichment is not the user saying anything new.

Change is now judged on what the caller supplied. Three tests failed on the first
run and said so precisely, which is the argument for having written them first.

### The clarification path was the one worth probing for

Stories 1.5.6 and 1.5.2 came from the findings. Story 1.5.7 did not: a draft that
_completes_ becomes the artefact under the **draft's own id**, which is right for
a first Brief and a third fork for every one after it. It was only visible by
walking the lanes rather than reading them.

### `BRIEF_REQUIREMENT_SOURCES` needed guarding explicitly

Folding stamps a restated topic as `Stated` — a topic the caller mentioned is one
the user mentioned. Topics they did not mention keep the source they had, which
is what `withRequirement`'s replace-by-topic gives for free, and there is now a
test pinning it: a re-capture that never mentions the garage must not promote an
assumption into something the user said.

## Cross-repository

`apps/web/src/ai/__tests__/architecturalBrief.test.ts` was the only consumer of
the removed export, in five places. It now composes the tool through
`createArchitecturalIntelligenceContribution` over the same registry its approval
sink writes to — which the tests needed anyway, since the tool's answer now
depends on what the project already holds.

Done in the same pass so the local workspace stays green, and called out here
because it is a change in the other repository.

## Not done here

- Repairing a project that already holds two lineages. It holds two designs and
  no basis for preferring either; choosing needs a surface that can show both.
- The broader classifier rule (a design verb plus two mandatory topics, with no
  dwelling word). Recorded in `notImplemented` with its reasoning.

---

# Testing Strategy

- **Unit** — the folding function: override, carry-forward, source preservation, unchanged detection.
- **Tool** — capture with no Brief, re-capture unchanged, re-capture changed.
- **Classification** — new spellings positive; every modelling command negative.
- **Conversational** — all three producing lanes against a project that holds a Brief.
- **Regression** — Bug 002 end to end, plus the full five stages after a re-capture.

---

# Definition of Done

## Architecture

- [x] One folding rule; `reviseBriefFrom` and the tool share it.
- [x] No path in this package can produce a second Brief lineage.
- [x] The lineage guard is unchanged and no lineage is auto-chosen.
- [x] `planning_captureBrief`'s name and schema are byte-identical.
- [x] The classifier's direct-lane bias is unchanged.

## Implementation

- [x] `reviseBriefFromFields`, with `reviseBriefFrom` on top of it.
- [x] `createCaptureBriefToolDefinition(intelligence)`; the standalone export removed.
- [x] `brief-generation` and clarification completion both fold.
- [x] Unchanged input answers `NothingToDo` on every path.
- [x] Dwelling spellings and missing types covered.

## Verification

- [x] Bug 002's sequence leaves one lineage at revision 1.
- [x] No conversational path forks, asserted lane by lane.
- [x] The five-stage pipeline still completes.
- [x] Sprint 1.3's lineage assertions still pass unchanged.
- [x] Build, lint, full suite pass — both repositories.

## Documentation

- [x] `00-current-state.{md,yaml}` updated.
- [x] `bug-002-lineage-findings.md` cross-linked and marked resolved.
- [x] Sprint 1.3's Story 1.3.4 annotated with what its reasoning missed.
- [x] Sprint marked Completed only after all gates pass.
