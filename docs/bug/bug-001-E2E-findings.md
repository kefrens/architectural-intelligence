# Bug 001 — E2E findings

> **Investigated:** 2026-08-10 · no code changed
> **Verdict:** three broken boundaries, one of which explains the entire transcript
> **First broken boundary:** `apps/web` never gives the reasoning layer a
> `PlanningArtefactReader`. It writes approved artefacts and reads none back.

---

# The one-line answer

The Architectural Intelligence service is constructed **without its artefact
reader**. The approval sink is wired; the read port is not. So the project
records every approved artefact and the reasoning layer can never see one —
which makes stages 2 to 5 permanently unreachable, by construction, no matter
what the user or the model does.

The regression landed in **`dd5306d` ("Sprint 29.2 — Publishable Platform
Boundary")**, which moved construction out of the React hook and dropped the
wiring on the way — including the comment that explained why it mattered.

---

# The chain, stage by stage

The bug asks for six proofs per stage. Here is what is actually provable.

| Stage             | a. Proposal | b. Approved | c. Artefact written | d. Reader returns it | e. Provenance | f. `workflowState()` |
| ----------------- | :---------: | :---------: | :-----------------: | :------------------: | :-----------: | :------------------: |
| **Brief**         |     ✅      |     ✅      |         ✅          |          ❌          |      n/a      |   ❌ `not-started`   |
| **Programme**     |     ❌      |      —      |          —          |          —           |       —       |   ❌ `not-started`   |
| **Layout**        |     ❌      |      —      |          —          |          —           |       —       |   ❌ `not-started`   |
| **Geometry**      |     ❌      |      —      |          —          |          —           |       —       |   ❌ `not-started`   |
| **Specification** |     ❌      |      —      |          —          |          —           |       —       |   ❌ `not-started`   |

The chain breaks at **(d), on the very first stage**. Nothing downstream ever
gets to (a).

The transcript agrees precisely. The Brief renders a full proposal card and ends
with **"Recorded with the project."** — that string is
`PlanningArtefactRegistry.approve`'s own summary, so the write demonstrably
happened. Stages 2–5 render **no card and no summary**, because no proposal was
ever built for them.

---

# The proof

## 1. The reader is never passed

[`apps/web/src/ai/intelligenceLoader.ts`](../../../archisimple/apps/web/src/ai/intelligenceLoader.ts):

```ts
export interface IntelligenceServices {
  readonly queries: QueryDispatcher;
  readonly building: BuildingService;
  readonly spatial: SpatialService;
  readonly inspector?: InspectorService;
} // ← no `artefacts`

return module.createArchitecturalIntelligenceContribution({
  queries: services.queries,
  building: services.building,
  spatial: services.spatial,
  ...(services.inspector === undefined ? {} : { inspector: services.inspector })
}); // ← no `artefacts`
```

`main.tsx` calls it with exactly those four services. `artefacts` is an optional
option on `ArchitecturalIntelligenceServiceOptions`, so **omitting it compiles,
type-checks, lints and passes every test in both repositories.**

Inside the service, `this.artefacts` is therefore `undefined` for the entire life
of the application, and:

- `approvedBrief()`, `approvedProgramme()`, `approvedLayout()`,
  `approvedGeometry()`, `approvedSpecification()` → **always `undefined`**;
- every planning tool resolves to `blocked`, forever;
- `workflowState()` reports five untouched stages, forever — this is Rule 11
  degradation behaving exactly as designed, on a host that did not mean to
  degrade;
- the four stage lanes in `interpret` are unreachable, so a _typed_ "generate the
  programme" also falls to Direct Execution.

## 2. The sink **is** wired — which is what makes this invisible

[`apps/web/src/App.tsx:408`](../../../archisimple/apps/web/src/App.tsx):

```ts
new AiSessionController({
  …,
  // Sprint 27.8: approving an Architectural Brief records it with the
  // project rather than dispatching Requests (ADR-0027.1 Rule 7).
  artefacts: planningArtefacts,
})
```

So approval works, persistence works, the project file is correct. Only the way
back in is missing. **The write path and the read path were separated, and only
one of them survived a refactor.**

## 3. It used to be wired, and the deleted comment said why

`git log -S "artefacts: planningArtefacts"` points at `dd5306d`. Its diff of
`useAppInfrastructure.ts` removes:

```ts
        briefDrafts,
-       // Sprint 27.9: the same registry the approval sink writes to, so the
-       // Brief a user just approved is the Brief a programme is derived from.
-       artefacts: planningArtefacts
```

Sprint 27.9 wired it, wrote down the reason, and Sprint 29.2 deleted both while
doing something else. Nothing since has restored it.

## 4. Why it could not simply be carried over

`planningArtefacts` is created **inside** `useAppInfrastructure`
(`useMemo(() => createPlanningArtefactRegistry(), [])`, line 333), and since
Sprint 29.1/30.1 the contribution is composed in `main.tsx` **before the React
tree exists**. The registry does not exist yet at the moment the service is
built.

`briefDrafts` had the identical ordering problem and got an explicit solution —
`BoundBriefDraftStore.bind(session)`, called from an effect, with a comment
explaining the loop. The artefact reader hit the same wall and got nothing.

## 5. Why the Brief was the only stage that worked

Because it is the only stage that reads nothing.

`captureBriefToolDefinition` is a standalone `ToolDefinition` — not a factory
bound to the service — that assembles a Brief from the model's own arguments.
The other four are `create*ToolDefinition(intelligence)` and each begins by
calling an `approved*()` accessor.

That is the cleanest possible confirmation of the diagnosis: **exactly the tools
that need the reader failed, and exactly the one that does not need it
succeeded.**

## 6. The four blocked messages in the transcript are the tools, verbatim

Transcript lines 31–37 are word-for-word the four tools' `blocked` messages:

```
There is no approved brief yet, … Ask the user what they want to build first.        ← programme-tools.ts:48
There is no approved space programme yet, … Ask the user to approve a programme first. ← layout-tools.ts:42
There is no approved layout yet, … Ask the user to approve a layout first.            ← geometry-tools.ts:42
There is no approved geometry yet, … Ask the user to approve the geometry first.      ← specification-tools.ts:43
```

Four tool calls in one reply, four `blocked` results, no proposal —
`composeProposal` returns them as prose. Note these are the _service-facing_
wordings ("Ask the user…"), not the conversational ones, so they are the tools
and not `interpret`.

They appear once, early. After that the model stopped calling the planning tools
and narrated instead ("Now let's generate the space programme:" followed by
nothing). Which is the third finding, below.

---

# Second broken boundary: nothing consumes a Geometry Specification

```bash
grep -rl "GeometrySpecification\|geometry-specification" apps packages   # → no matches
```

**Zero consumers in ArchiSimple.** No translator, no Build Plan, no
`CommandRequest`, no `CompositeCommand`. ADR-0031 specifies the whole pipeline
and its sprint was never written; `00-current-state` records it as not
implemented.

This matters for the bug report's framing: **even a flawless five-stage run would
have produced no walls.** Fixing the reader makes the workflow complete and
approvable; it does not make a building. The Specification would be recorded with
the project and nothing would draw it.

Two independent gaps, and the transcript hides one behind the other.

---

# Third broken boundary: the model is never told where the design is

[`architectural-context-provider.ts`](../../src/context/architectural-context-provider.ts)
contributes exactly four fields:

```ts
{
  (editOperations, answerableQuestions, activeFloorId, floorCount);
}
```

Nothing about the pipeline. Not which artefacts are approved, not the current
stage, not what to call next. Sprint 1.2 built `workflowState()` and wired it to
the _classifier_ — the deterministic host-side lane gates — but **not to the
prompt**.

So after the Brief was approved the model had no way to know that
`planning_generateProgramme` had just become available and appropriate. It did
what a model does with no state: it narrated the plan it remembered
("Now let's generate the layout based on the space programme:") and asked for
confirmation, and the user's "ok" reached nothing.

This one is not caused by the reader gap and will not be fixed by fixing it. It
is a genuine missing wire between a projection that exists and the consumer that
most needs it.

---

# Why "i don't see any wall" produced a 6.325 × 6.325 m room

Three mechanisms in sequence, all working as designed:

**1. It classified to Direct Execution — correctly.** "i don't see any wall" is
not a stage request under any lane's word set. And even a phrase that _was_ one
would have fallen through, because every stage gate is computed from
`workflowState()`, which reports nothing approved (finding 1).

**2. The model fell back to `automation_createRoom`.** With no workflow state in
context and a user reporting an empty canvas, it re-planned the apartment from
scratch as five room-creation calls — the only tool it had that makes anything
visible.

**3. `composeProposal` keeps the first plan and discards the rest.**
[`aiServiceProvider.ts:212-218`](../../../archisimple/apps/web/src/ai/aiServiceProvider.ts):

```ts
case 'proposal':
  if (planned === undefined) {
    planned = resolved.proposal;      // the first plan wins
  } else {
    skippedAlongsidePlan += 1;        // every other one is dropped
  }
```

`createRoom` resolves to kind `proposal` (a four-wall plan), so five calls became
**one** room — the first, the 40 m² living area. √40 = 6.3245… → 6.325 m at the
project's 1 mm precision, enclosing 40.005625 m². The transcript's own
footnotes confirm the arithmetic: _"2 further actions were proposed alongside
this plan and left out"_ and _"The assistant repeated 2 identical actions; they
were applied once"_ — 5 calls, 2 deduplicated, 1 planned, 2 skipped.

This is the documented "one proposal per `ConversationMessage`" limitation, which
`aiServiceProvider.ts` says goes away in Sprint 27.7 — a sprint that shipped
per-action approval for something else and left this cap in place.

**So the arbitrary square room is not a reasoning failure. It is the first of
five direct-execution plans, and the other four were silently dropped.**

---

# Summary — the boundaries, in the order they break

| #   | Boundary                                                      | Status      | Consequence                                                             |
| --- | ------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| 1   | Host → reasoning layer: `PlanningArtefactReader`              | **missing** | Stages 2–5 unreachable. Everything in the transcript follows from this. |
| 2   | Geometry Specification → building model (ADR-0031 translator) | **missing** | Even a perfect run draws nothing.                                       |
| 3   | `workflowState()` → prompt context                            | **missing** | The model cannot know what to do next, so it narrates or improvises.    |
| 4   | Several plans in one reply → one proposal                     | known cap   | 5 rooms became 1.                                                       |

## Where each one is being fixed

| #   | Sprint                                                                                             |
| --- | -------------------------------------------------------------------------------------------------- |
| 1   | ArchiSimple **Sprint 32.0** — Architectural Intelligence E2E Wiring                                |
| 2   | ArchiSimple **Sprint 33.x** — Geometry Execution Pipeline (ADR-0031)                               |
| 3   | **Sprint 1.4** — [Workflow State in Context](../sprints/sprint-001.4-workflow-state-in-context.md) |
| 4   | ArchiSimple **Sprint 32.1** — one reply, several plans                                             |

Sprint 1.4 publishes first; Sprint 32.0 consumes it. Neither needs a platform
release — the platform released at `0.2.0` in ArchiSimple Sprint 31.0, which is
what ADR-0030 Rule 8 asks for.

Boundaries that are **intact** and were wrongly suspected: the approval sink, the
project-file round trip, the artefact envelope, `composeProposal`'s pass-through
of a lone artefact proposal (object identity preserved, as Sprint 24.5 promised),
the classifier, and every provenance/staleness rule from Sprints 1.2 and 1.3 —
none of which could run at all, because none of them was ever given an artefact
to look at.

---

# What fixing #1 will need (not done)

Recorded because the obvious one-liner does not exist: the registry is created
inside the React hook and the contribution is composed before React starts.

- **Option A — move the registry to the composition root.** Create it in
  `main.tsx`, pass it to `loadIntelligenceContribution` _and_ down into
  `useAppInfrastructure` as a prop, the way every other service is already
  supplied. One instance, no late binding. Requires checking that project
  open/save (`useAppCommandHandlers` → `toSnapshot`/`loadSnapshot`) still holds
  the same object.
- **Option B — a late bind, mirroring `briefDrafts`.** Add an artefact-reader
  port to the contribution that the host binds once the registry exists. Smaller
  diff, but it adds a second thing that is silently unbound if forgotten — which
  is the failure mode being fixed.

**A also needs a regression test that would have caught this**, because the
current suites cannot: both repositories test the service _with_ a reader, and
the host's tests never assert that the composition root supplies one. A test
asserting "the composed contribution can read back an artefact the session just
approved" is the one that fails today.

Option A is the recommendation: the absence should be impossible to express, not
merely remembered.
