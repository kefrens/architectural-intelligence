# BUG-008 — Findings and fix plan

> **Status:** Investigated. **Phases 1 and 2 landed** in `archisimple`; Phase 3 (this repository) is next
> **Investigated at:** `architectural-intelligence` `53388df` (v0.2.0), `archisimple` `2d9fc6a`
> **Answers:** [BUG-008](bug-008-end-to-end-design-realisation.md) §5 (hypotheses) and §6 (method)

---

## 0. Status

**Phase 1 is implemented, in `archisimple` only** — Sprint 036.2b, "truthful
realisation state" (`archisimple/docs/sprints/sprint-036.2b-truthful-realisation-state.md`).

A host-supplied `realisation` Context Provider reports, from the project's own
`RealisationRecordRegistry`, whether the approved Geometry Specification has
actually been built: `no-specification` | `not-realised` | `realised` | `refused`
| `failed`, with the realisation guard's own verdict beside it. A system-prompt
rule tells the model to read that state rather than infer it. The assistant can
no longer report a building that does not exist — AC-2 and AC-8 are closed.

It needed **no cross-repository contract**: the fragment is assembled entirely in
`apps/web`, out of state `apps/web` owns, so nothing in this repository changed
and no release ordering applies. Nothing in this document's §2 evidence was
contradicted by the implementation.

**Phase 2 is implemented, also in `archisimple` only** — **ADR-0032 revision
2.2** and Sprint 037.0, "AI-approved realisation"
(`archisimple/docs/sprints/sprint-037.0-ai-approved-realisation.md`). §4's
recommendation **(ii)** was approved.

G-8 is closed. A `Proposal` carries a realisation **subject** —
`{ specificationId, revision }`, an identity and never a plan — and approving it
delegates to a host `RealisationSink` implemented with the existing
`realiseApprovedSpecification`. Revision 2.2 makes two things normative: _there
SHALL be exactly one realisation path_, and _the proposal SHALL NOT carry
executable realisation machinery_. `ProposalExecutionResult` gained an optional
`outcome: succeeded | refused | failed | not-attempted`, so a guard's refusal is
no longer indistinguishable from a crash.

The realisation **tool** is contributed by the host, for the reason §4 gave:
everything it must know is state `apps/web` owns.

**Phase 3 is this repository's, and is unstarted.** Two items, both from §5:

- a realisation lane in the deterministic classifier, so "build it" stops falling
  into Direct Execution — today the model reaches the tool because the tool is
  offered, not because a lane routes to it;
- the realisation fact in `deriveWorkflowState`, which needs a read port —
  the one genuinely new cross-repository contract, and the one that deserves an
  ADR-AI.

Phase 3 consumes a released `@archisimple/ai-engine` (ADR-0030 Rule 8); in the
linked local workspace that is a build order rather than a publish order.

---

## 1. Result in one line

**H1, and structurally so.** No execution request is produced, because
Architectural Intelligence has no way to express one and the host offers no tool
that would carry it. The realisation pipeline is reachable from exactly one place
— a ribbon command — and the AI is not wired to it.

The trace stops before it starts:

```text
User: "build it"
  → AI planning state        ✓ Specification approved
  → emitted action           ✗ nothing exists to emit
  → ArchiSimple endpoint     — never reached
  → model mutation           — never happened
  → AI response              "I'll now create the walls and openings."
```

H2–H6 are all excluded below.

---

## 2. Evidence

### There is no realisation tool, and no realisation lane

In this repository:

- `PLANNING_TOOL_NAMES` ([`src/tools/planning-tool-names.ts`](../../src/tools/planning-tool-names.ts))
  is a **total** record over `PLANNING_STAGES` — five tools, ending at
  `planning_generateSpecification`. Nothing follows the Specification.
- `REQUEST_LANES` ([`src/brief/request-classification.ts`](../../src/brief/request-classification.ts))
  has eight lanes. None of them is "build the approved design"; the eighth and
  last added, `brief-revision`, goes back _up_ the pipeline.
- `grep -i 'realis\|realiz\|buildplan'` over `src/` matches only geometry-graph
  and specification wording. There is no client of the realisation capability
  anywhere in the reasoning layer.

So when a user says "build it", the request falls to **Direct Execution** — the
default lane, by design (Story 27.8.3) — and reaches a general model with no tool
that builds anything. The model does the only thing left available to it and
narrates.

### The receiving side works, and has exactly one caller

In `archisimple`, `realiseApprovedSpecification` has one production caller:
`realiseApprovedDesign` in
`apps/web/src/app/useAppCommandHandlers.ts:331` — the **Build Approved Design**
command shipped by Sprint 036.2, whose own comment records that it is "the only
place `realiseApprovedSpecification` is called from production code".

That handler already does everything AC-1 to AC-4 ask of the receiving side: it
propagates the guard's refusal untouched, distinguishes a built-but-unrecorded
design from a complete one, and reports counts from the returned
`RealisedBuildPlanDto`. Nothing about it needs fixing. It is simply not reachable
from a conversation.

### The contract cannot carry a realisation — this is G-8

Even a tool would not close it today:

- `ResolvedToolCall` (`packages/ai-engine/src/tool.ts`) is
  `request | proposal | blocked`, and `ProposalOperation.request` is a
  `CommandRequest`.
- Realisation is an **Operation**, not a Request, deliberately: ADR-0032 Rule 5
  requires one atomic `automation.realiseBuildPlan`, and explicitly forbids a
  generic "run these Requests atomically" escape hatch that would let a consumer
  assemble its own undo groupings.
- `AiSessionController.executeProposal` therefore branches two ways only — record
  an artefact, or run `CommandRequest`s in sequence with no shared rollback.

This is precisely the gap ADR-0032 already names and authorises:

> **G-8 — a `Proposal` carrying an `AutomationOperation`.** Realisation from an
> **AI approval**, as opposed to executing an already-approved design. Additive,
> and explicitly not a second approval mechanism (Rule 5).

### Why the assistant claims success

`deriveWorkflowState` ([`src/workflow/workflow-derivation.ts`](../../src/workflow/workflow-derivation.ts))
walks five stages and reports `complete` when all five are approved and none is
stale. **Realisation is not one of the facts it holds**, so the `architecture`
context fragment — the one thing that tells a model where the design has got to,
added in Sprint 1.4 for exactly this class of bug — reports a complete design and
says nothing about whether a building exists.

The model is told the design is finished, has no tool that builds it, and is not
told that nothing was built. AC-2's false success is the predictable result.

### H2–H6, excluded

| Hypothesis                             | Verdict                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| H2 wrong execution capability          | Excluded — no action is emitted at all.                                                  |
| H3 artefact not actually approved      | Excluded — the Specification is approved and readable; `realiseApprovedDesign` finds it. |
| H4 reached ArchiSimple and was refused | Excluded — the guard is never entered. No `RealisationRecord` of any outcome is written. |
| H5 result not observed                 | Excluded — there is no result.                                                           |
| H6 stale UI                            | Excluded — no mutation occurred, so there is nothing for the UI to be stale about.       |

---

## 3. Stop conditions (§12) — met, and already decided

Conditions **1** and **2** are met: Architectural Intelligence cannot reach the
realisation capability with the current integration contract, and closing it
requires a change to a shared contract (`@archisimple/ai-engine`).

This is **not a new boundary**. ADR-0032 identified it, named it G-8, ruled it
additive rather than a second approval mechanism, and left the amendment to "the
sprint that makes the change". Sprints 033.2b, 036.2 and 036.3 each restate that
G-8 remains open and does not gate them.

So the correct outcome is not to stop, and certainly not to work around it: it is
to schedule the sprint ADR-0032 has been describing since revision 2.0, in
`archisimple`, and only then wire this repository to it.

---

## 4. Design decision to make first

Two shapes satisfy G-8. They differ in where the Build Plan is assembled, which is
the whole of AC-6 and §10.2.

### (i) Literal — `Proposal` carries an `AutomationOperation`

`ProposalOperation` gains an operation variant; `AiSessionController` gains an
`OperationDispatcher`; approval dispatches it.

The tool must then _build_ the operation payload at resolve time — read the
Specification, run the guard, call `translateToBuildPlan`, and hand back
`realiseBuildPlanOperation(plan)`. That splits `realiseApprovedSpecification`
across resolve and approval, and puts the guard and the translator behind a second
entry point. Sprint 036.2 §2.1 forbids that of the UI in the same words BUG-008
§10.2 forbids it of the AI: the guard is not to be reproduced.

### (ii) Recommended — a realisation subject, executed by a host port

`Proposal.subject` already discriminates: approving an _artefact_ proposal calls
`this.artefacts.approve(artefact)` rather than dispatching Requests. Add a third
subject — a realisation, carrying the Specification's `{ id, revision }` — and a
host-supplied port beside `artefacts`, which `apps/web` implements with the
existing `realiseApprovedSpecification`.

Then:

- the Build Plan is assembled where it already is, once, inside the one function;
- the guard, the translator, the Operation and the `RealisationRecord` stay behind
  a single entry point — no second mechanism, no new Request (AC-6);
- ADR-0032 Rule 5's actual requirement is met, because
  `realiseApprovedSpecification` dispatches exactly one `AutomationOperation` and
  gets its atomicity from `automation.realiseBuildPlan`;
- ADR-0027.1 Rule 7 keeps one approval mechanism —
  `Proposal` + `approveProposal` — which is what G-8 was careful to preserve.

The cost is that ADR-0032's wording ("a `Proposal` **carrying** an
`AutomationOperation`") is met in substance rather than literally, so the
implementing sprint owes ADR-0032 a revision saying so. That is cheaper than the
duplicated guard (i) requires, and the revision is the honest record either way.

**Recommendation: (ii).** It is the shape the artefact subject already
established, and it is the only one of the two that cannot grow a second
realisation path.

---

## 5. Plan

### Phase 1 — stop lying, before anything is built (`archisimple`, small) — **done, Sprint 036.2b**

Independent of G-8, and worth landing first because it removes the dangerous
half of the bug (AC-2, AC-8) without waiting for the mechanism.

1. Report realisation as **state** in the AI's context: whether the current
   Specification revision has been realised, from the `RealisationRecordRegistry`
   the project already owns. The `architecture` fragment reports state and never
   instructs, so this is a fact — `realised: false` — not a prompt rule.
2. A prompt rule that an execution claim requires an execution result: the
   assistant describes what it _will propose_, never what it has done.

After Phase 1, a user who asks to build gets a truthful "I cannot build this from
here — use Build Approved Design", which is a far better failure than a fictional
building.

### Phase 2 — G-8 (`archisimple`, ADR + sprint) — **done, ADR-0032 revision 2.2 + Sprint 037.0**

3. ADR-0032 revision recording the chosen shape from §4.
4. `ai-engine`: realisation subject on `Proposal`, host port beside `artefacts`,
   `executeProposal` branch, and a `ProposalExecutionResult` that distinguishes
   **succeeded / refused / failed / not attempted** (AC-3, AC-4, AC-7). Today it
   carries `success: boolean` and a summary string, which cannot tell a refusal
   from a crash.
5. `apps/web`: implement the port with `realiseApprovedSpecification`, and
   contribute the realisation **tool** — the host contributes it, not this
   repository, because the host owns the Specification reader, the guard and the
   record. Its `resolve` checks that an approved, unrealised Specification exists
   and returns either a `blocked` message or a realisation proposal. It builds
   nothing.
6. Sprint 036.3's refusal/failure UX is where the per-blocker wording belongs;
   this phase only has to carry the distinction, not present it.

### Phase 3 — the conversational surface (`architectural-intelligence`)

7. A ninth lane — a realisation request — gated on an approved, unrealised
   Specification, so the deterministic classifier answers truthfully too rather
   than dropping "build it" into Direct Execution.
8. Extend the workflow projection with the realisation fact, so
   `ArchitecturalDesignStage` and the `architecture` fragment can say _the design
   is approved and not yet built_ and name the action that changes it. This needs
   the `PlanningArtefactReader` port (or a sibling) to answer it — the cross-repo
   contract point, and the one thing here that deserves an ADR-AI.
9. Truthful reporting: the execution result already flows back as the proposal's
   `executionResult`; make refusal and failure distinguishable in what the user
   reads.

### Phase 4 — evidence (§8, §9)

10. Scenarios A–E as tests: valid approved design; no approved design; refused
    design; forced execution failure; repeat build against the already-realised
    guard. A and E at the `apps/web` boundary, where the real pipeline is; B and C
    on both sides.
11. Browser verification of A, with the project before, the build action, the
    resulting model and the user-facing result — BUG-008 §9 asks for it and the
    path is UI-visible.

### Ordering

ADR-0030 Rule 8: the platform releases first, the intelligence consumes a released
version. Phases 1 and 2 are `archisimple`; Phase 3 follows in this repository
against them. In the linked local workspace this is a build order rather than a
publish order.

---

## 6. What this plan deliberately does not do

- No second execution mechanism, and no `CreateWallRequest` / `CreateOpeningRequest`
  constructed anywhere in this repository (AC-6, §10.2).
- No redesign of the Geometry Specification pipeline — it is correct, and it emits
  openings as well as walls.
- No change to ADR-0032's execution architecture; only the amendment ADR-0032
  itself deferred.
- No new Automation Request, no Automation contract bump, no project-file change.
