# Sprint 1.2 — Architectural Workflow State

> **Status:** Completed — 2026-08-10
>
> **Version:** 2.1 — supersedes the "End-to-End Reasoning Workflow" draft, see _Revision History_
>
> **Repository:** `architectural-intelligence`
>
> **Related ADRs:** ADR-AI-0002 (this sprint's ADR), ADR-AI-0001, ADR-0027.1 (Rules 2, 4, 7, 8, 12), ADR-0029 (Rules 2, 3), ADR-0030 (Rules 1, 2, 8), ADR-0031 (Rule 1)
>
> **Predecessor:** Sprint 1.1 — Geometry Specification
>
> **Next Sprint:** 1.3 — Revision Lineage and Navigation
>
> **Platform release required:** none. This sprint ships from this repository alone.

---

# Sprint Design Contract

Every sprint extends the existing architecture. The authoritative source is
[docs/architecture/00-current-state.md](../architecture/00-current-state.md),
generated 2026-08-09 at `248d60d` + Sprint 1.1. Where this sprint conflicts with
it, this sprint is wrong.

This sprint MUST NOT: introduce an orchestrator, add a second approval surface,
add a registry, store or cache derived state, add a second vocabulary for
blockers, emit a UI label, or widen a port in a way that forces an ArchiSimple
release.

It extends four existing seams and adds no new kind of thing:

| Existing seam                          | How this sprint uses it                                                   |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `PLANNING_STAGES`                      | The five stages of the projection. Reused, not restated.                  |
| `matches*` provenance predicates       | Already written for all four derived artefacts; three have no caller yet. |
| `PlanBlocker` / `PLAN_BLOCKER_REASONS` | The one vocabulary, gaining one member.                                   |
| `REQUEST_LANES` + `classifyRequest`    | A seventh lane, gated exactly as the three before it.                     |

---

# Revision History

| Version | Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-08-10 | "End-to-End Reasoning Workflow". Six epics, 27 stories, covering the projection, the revision lineage and the pending-proposal view in one sprint.                                                                                                                                                                                                                                                                                                                                                                  |
| 2.0     | 2026-08-10 | Reviewed against the implementation before starting. **Removed the pending-proposal view** — this layer structurally cannot observe approval (ADR-AI-0002 Rule 2). **Removed two stories already delivered by Sprint 1.1** and replaced them with the lane that is actually missing. **Moved all revision and navigation work to Sprint 1.3.** Split the single `status` enum into orthogonal fields. Fixed the transcript, which showed an advance no component in this repository can perform. Added ADR-AI-0002. |
| 2.1     | 2026-08-10 | Implemented. Recorded in _Implementation Notes_ what shipped differently from the plan: the specification word set narrowed to plural `walls`, three test fixtures corrected, and Story 1.2.15 landed as an `index.ts` export with nothing added to the contribution.                                                                                                                                                                                                                                               |

---

# Why version 2.0 exists

The 1.0 draft was written from the pipeline as documented. Read against the
pipeline as **implemented**, five of its assumptions do not hold. They are
recorded here rather than quietly dropped, because each one is a mistake a later
sprint could make again.

### 1. "Which proposals are pending" is not knowable here

`ProposalApprovalState` and `pendingProposal()` live in
`@archisimple/ai-engine`, session-scoped, host-side. This package builds a
`Proposal`, hands it over, and never learns its fate — it only learns that an
artefact became readable through `PlanningArtefactReader`. A `proposalId` field
and a `ready-for-approval` status would have been fields nothing could fill.

**Consequence:** ADR-AI-0002 Rule 2. The host merges its own pending state onto
this projection.

### 2. Two of the Epic 5 stories were already delivered

| 1.0 story                                           | Already shipped in Sprint 1.1                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1.2.19 — Geometry Specification service entry point | `generateSpecification` at [architectural-intelligence-service.ts:443](../../src/architectural-intelligence-service.ts) |
| 1.2.20 — Register the Geometry Specification tool   | `createSpecificationToolDefinition`, registered last in [contribution.ts](../../src/contribution.ts)                    |

What is genuinely missing is named in this repository's own `notImplemented`
list, `plannedIn: Sprint 1.2`, and had **no story at all**: the seventh
classification lane. `REQUEST_LANES` has six values and `classifyRequest` has no
`hasApprovedGeometry` gate, so the final stage is reachable through the tool and
the service but never through an utterance. That is Epic 1 of this version.

### 3. There is no orchestrator to orchestrate

The 1.0 epic titled "Approval-Driven Orchestration" asked to "stop the pipeline".
There is no pipeline object. Sequencing **is** the classifier's stage gating, and
adding an orchestrator would be a second execution path through a layer whose
compliance test exists to guarantee there is one.

### 4. The transcript showed an advance nothing here can perform

> Assistant: The brief is approved. I'll generate the space programme.

Approval happens in the host. This package receives no callback, so the
generation of the next stage is triggered by the **user's next turn** — which is
what the classifier's lanes are for. An automatic advance on approval would be a
host behaviour, and it is not in this sprint or the next.

The corrected transcript is below.

### 5. Revision is a sprint, not a story

`reviseProgramme`, `reviseLayoutPlan` and `reviseGeometryGraph` are exported and
called **nowhere in production**. Re-briefing goes through `assembleBrief`, which
mints a new id at revision 1 — a new lineage, not `Brief v1 → Brief v2`. Story
1.2.18 of the draft ("revise through the production workflow") was therefore the
largest piece of work in the sprint, hidden in one bullet.

It is now Sprint 1.3.

---

# Current State

Five artefacts, each separately approved, each carrying provenance for the one
above it:

```text
Architectural Brief → Space Programme → Layout Plan → Geometry Graph → Geometry Specification
```

What exists and is reachable:

- `PlanningArtefactReader.current(kind)` — the artefact of a kind in force.
- `approvedBrief()`, `approvedProgramme()`, `approvedLayout()`,
  `approvedGeometry()`, `approvedSpecification()`.
- `generateProgramme`, `generateLayout`, `generateGeometry`,
  `generateSpecification` — all four public, all four called by their tool.
- `matchesBrief`, `matchesProgramme`, `matchesLayout`, `matchesGeometryGraph` —
  all four exported; only `matchesGeometryGraph` has a production caller.
- Six request lanes; three of them gated on `hasApprovedBrief`,
  `hasApprovedProgramme`, `hasApprovedLayout`, computed privately inside
  `interpret`.

What does not exist:

- any way to ask what state the pipeline is in;
- any lane reaching the Geometry Specification;
- any report that an artefact has been superseded.

---

# Goal

Expose the pipeline's state as a derived, read-only projection, and make the
final stage reachable by conversation.

After this sprint a consumer — the future IA panel, the Building Assistant, a
headless test — can render the whole workflow without re-deriving a single
architectural rule, and a user can reach all five stages by talking.

**Nothing about how artefacts are generated or approved changes.** This sprint
adds one lane and one read-only method, and wires four predicates that were
already written.

---

# The projection

Defined by ADR-AI-0002; the exact field list is this sprint's. The sketch:

```ts
export interface ArchitecturalWorkflowState {
  readonly stages: readonly ArchitecturalStageState[]; // always five, in order
  readonly currentStage?: PlanningStage;
  readonly complete: boolean;
}

export interface ArchitecturalStageState {
  readonly stage: PlanningStage;
  readonly artefact: 'none' | 'draft' | 'approved';
  readonly approved?: ArtefactIdentity;
  readonly stale?: StaleDerivation;
  readonly blockers: readonly PlanBlocker[];
  readonly eligible: boolean;
  readonly actions: readonly WorkflowActionId[];
}
```

Four properties of this shape are load-bearing, and each has a rule behind it:

- **Orthogonal fields, not one `status`** (Rule 5). A stale artefact is still
  approved. A stage can be blocked while holding a valid artefact of its own.
- **No `proposalId`, no pending state** (Rule 2).
- **`draft` is reachable for the Brief only** — it is the only stage with a
  draft store. The field is on every stage because the shape is uniform, and the
  sprint documents that four stages can never carry it.
- **Plain JSON throughout** (Rule 9). The host restates this structurally and
  imports nothing.

---

# Epics

## Epic 1 — The seventh lane

**Goal:** make the Geometry Specification reachable by conversation, closing the
`geometry-specification-lane` entry in `notImplemented`.

### Story 1.2.1 — `SpecificationGeneration` lane

Add the seventh value to `REQUEST_LANES`, gated on a new
`hasApprovedGeometry` option, defaulting to `false` — exactly as the three lanes
before it, so every existing caller and every existing test classifies unchanged.

### Story 1.2.2 — Specification words

A word set that asks for the walls rather than the arrangement — _walls,
thickness, construction, buildable, specification, build it_ — checked **before**
the geometry lane, for the reason the geometry lane is checked before the layout
lane: a project that has approved its geometry and asks to "give it walls" wants
the next stage, not the one it has.

### Story 1.2.3 — Route it in `interpret`

The lane reaches `generateSpecification(approvedGeometry)`, and a request with no
approved Graph is answered with the sentence the tool already uses rather than a
throw.

---

## Epic 2 — Derivation

**Goal:** compute the projection. No new state, no new registry, no orchestrator.

### Story 1.2.4 — Stage prerequisites

One table, in one module: which stage follows which, and what each needs. It is
the pipeline order made explicit — today it is implied by four `if` branches in
`interpret` and by the order of the `matches*` exports.

### Story 1.2.5 — Direct staleness

For each derived stage, compare the approved artefact's provenance against the
upstream artefact in force, using the `matches*` predicate that already exists.
Three of the four gain their first production caller here.

### Story 1.2.6 — Inherited staleness

Rule 6: a stage is stale when its own provenance diverges **or** when the stage
above it is stale. `StaleDerivation.inherited` distinguishes the two so a host
can say why without walking the chain itself.

### Story 1.2.7 — `superseded` blocker reason

Extend `PLAN_BLOCKER_REASONS` with `Superseded: 'superseded'`. One vocabulary
gaining a member, never a second list (Rule 4).

This is a public API addition on the `0.x` train and a breaking change for any
exhaustive `switch` over the reason union. It is noted in the release notes.

### Story 1.2.8 — Blockers per stage

A stage that cannot be generated carries `PlanBlocker`s saying why: the upstream
stage has no approved artefact (`missing-information`), or the upstream artefact
is stale (`superseded`). Messages are addressed to the user and carry
suggestions, like every other blocker in this repository.

### Story 1.2.9 — Eligibility

Rule 7: a stage is eligible when the stage above holds an approved artefact that
is **not stale**. Regenerating a stale stage is never blocked by its own
staleness — that is the fix.

### Story 1.2.10 — Actions

`generate` when there is no approved artefact and the stage is eligible;
`regenerate` when there is one. Stable identifiers, never labels (Rule 9). No
`approve`, no `revise`, no `navigate` — those are the host's (Rule 3).

### Story 1.2.11 — `currentStage` and `complete`

`currentStage` is the furthest stage that can be worked on now: the first stage
that is stale, then the first eligible stage without an approved artefact.
`complete` is every stage approved and none stale.

---

## Epic 3 — Exposure

**Goal:** one entry point, usable with no UI and no host.

### Story 1.2.12 — `workflowState()`

A method on `ArchitecturalIntelligenceService`. Pure: no artefact is generated,
no `Proposal` built, no draft touched, no provider consulted (Rule 12).

### Story 1.2.13 — Degradation

With no artefact reader: five stages, all `none`, the first eligible, no throw.
With no draft store: no stage is ever `draft` (Rule 11).

### Story 1.2.14 — The classifier consumes the projection

`interpret` computes the workflow state **once** and derives the four lane gates
from it, instead of calling `approvedBrief()`, `approvedProgramme()` and
`approvedLayout()` separately (Rule 8).

This is a behaviour change and the sprint's only one: the gates tighten from
_approved_ to _approved and current_. A project whose Brief was revised after its
Programme was approved stops offering the layout lane, and offers the programme
lane instead — which is the correct next step and was previously unreachable
without the user knowing to ask for it.

### Story 1.2.15 — Contribution export

The projection type and `WORKFLOW_ACTIONS` are exported from `index.ts`. Nothing
is added to `ArchitecturalIntelligenceContribution` — a host holding the
contribution already holds the service, and a second copy of a derived value is
the thing ADR-AI-0002 Rule 1 forbids.

---

## Epic 4 — Verification

**Goal:** prove the projection against the production path, not against a
hand-built fixture.

### Story 1.2.16 — Five-stage end to end

Utterance → Brief → approve → Programme → approve → Layout → approve → Geometry
→ approve → Specification → approve, driven through `interpret` and the in-memory
artefact reader, asserting the workflow state after **every** approval.

"Approve" in this test means what it means in production: the artefact the
proposal carries is written to the reader. There is no approval mechanism here to
invoke.

### Story 1.2.17 — Completion is not approval

The invariant the 1.0 draft named and put in the wrong place. Assert it at the
two gates that actually exist:

- the **lane**: with a complete but unapproved Brief, an utterance asking for the
  programme classifies as Direct Execution, not `ProgrammeGeneration`;
- the **tool**: `planning_generateProgramme` resolves to `blocked`.

Verified for at least two stages, one of them the new specification lane.

`generateProgramme(brief)` takes its artefact as an argument and cannot know
whether it was approved. That is not a hole — it is why both gates sit in front
of it — and the test says so in a comment rather than asserting a guard that does
not exist.

### Story 1.2.18 — Staleness reporting

Approve a Brief, a Programme and a Layout; approve a second revision of the
Brief; assert that the Programme reports `stale` with `inherited: false` and the
Layout reports `stale` with `inherited: true`, that the layout lane closes and
the programme lane stays open.

This closes the `specification-staleness-reporting` entry in `notImplemented`.

### Story 1.2.19 — The projection is derived

A compliance assertion: no production source holds a workflow-state value in a
field, and two consecutive calls with a changed reader return different results
(Rule 1).

---

## Epic 5 — Documentation and compliance

### Story 1.2.20 — ADR-AI-0002

Landed with this sprint, cited by the code it governs.

### Story 1.2.21 — Current state

`00-current-state.md` and `00-current-state.yaml` updated. The
`geometry-specification-lane` and `specification-staleness-reporting` entries
leave `notImplemented`; the workflow-state projection enters the inventory;
`latestImplementedSprint` becomes 1.2.

### Story 1.2.22 — README

The public workflow contract is new public surface, so it is named in the README
with the one paragraph a consumer needs: what it is, that it is derived, and what
the host still owns.

---

# The corrected transcript

The 1.0 draft's transcript is right about the state transitions and wrong about
who triggers them. What this sprint delivers:

```text
User:      Create an apartment, 100 m², with 3 bedrooms.
Assistant: How many bathrooms?
User:      2
Assistant: Here is the proposed brief: … Approve this brief?
User:      [approves the proposal in the host]

User:      Now write the space programme.
Assistant: [Programme proposal] Approve the programme?
User:      [approves]

User:      Arrange the spaces.
Assistant: [Layout proposal]
User:      [approves]

User:      Draw the rooms.
Assistant: [Geometry Graph proposal]
User:      [approves]

User:      Give it walls.                        ← the lane this sprint adds
Assistant: [Geometry Specification proposal]
User:      [approves]

           workflowState().complete === true
```

The wording is not contractual. The state transitions are, and so is the fact
that **each stage begins with a user turn**. A host that wants to offer the next
stage the moment a proposal is approved is welcome to — that is a host feature,
built on this projection, and it is not in this sprint.

---

# Out of Scope

Everything here is deliberate, and each has a home.

| Not in this sprint                                | Where it goes                    |
| ------------------------------------------------- | -------------------------------- |
| Revising an approved artefact through production  | Sprint 1.3                       |
| Artefact history and navigation, the `all()` port | Sprint 1.3                       |
| Pending proposals in the projection               | Host; ADR-AI-0002 Rule 2         |
| Automatic advance on approval                     | Host, if ever                    |
| The IA panel                                      | An ArchiSimple UI sprint         |
| The Building Assistant                            | Later, over this same projection |
| Anything downstream of the Specification          | ArchiSimple ADR-0031             |

---

# Testing Strategy

- **Unit** — prerequisites, direct staleness, inherited staleness, eligibility,
  actions, `currentStage`, `complete`, degradation with each port absent.
- **Classification** — the seventh lane, its gate, its precedence over the
  geometry lane, and that every pre-existing classification is unchanged.
- **End to end** — Epic 4, through `interpret` and the in-memory reader.
- **Compliance** — no stored derivation; no new registry; no `CommandDispatcher`;
  no UI label in an exported value.

---

# Definition of Done

## Architecture

- [x] The projection is derived on every call, stored nowhere.
- [x] No orchestrator type is introduced.
- [x] Approval state, proposals and session state remain the host's.
- [x] One blocker vocabulary; `superseded` is a member, not a second list.
- [x] The classifier derives its gates from the projection, not separately.
- [x] Every exported identifier is a stable string, not a label.
- [x] The projection is JSON-serialisable and restatable structurally.

## Implementation

- [x] Seventh lane, gated and routed.
- [x] `workflowState()` on the service.
- [x] Direct and inherited staleness.
- [x] Blockers and eligibility per stage.
- [x] `currentStage`, `complete`, actions.
- [x] Exported from `index.ts`.

## Verification

- [x] Five-stage E2E, asserting workflow state after each approval.
- [x] Completion-is-not-approval, at both real gates, for two stages.
- [x] Staleness E2E, direct and inherited.
- [x] Degradation with each port absent.
- [x] Build, lint, full suite pass.

## Documentation

- [x] ADR-AI-0002 landed.
- [x] `00-current-state.md` and `.yaml` updated; two `notImplemented` entries removed.
- [x] README names the workflow contract.
- [x] Release notes name the `PLAN_BLOCKER_REASONS` addition.
- [x] Sprint marked Completed only after all gates pass.

---

# Implementation Notes

## What shipped

Everything in the epics, plus one thing the plan did not anticipate.

| Story           | Landed as                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------ |
| 1.2.1 – 1.2.3   | `SpecificationGeneration` in `brief/request-classification.ts`, routed in `interpret`      |
| 1.2.4 – 1.2.11  | `src/workflow/` — `pipeline.ts` (the table), `workflow-derivation.ts`, `workflow-state.ts` |
| 1.2.7           | `PLAN_BLOCKER_REASONS.Superseded`                                                          |
| 1.2.12 – 1.2.15 | `workflowState()`, the four gates read off it, exports from `index.ts`                     |
| 1.2.16 – 1.2.19 | `src/__tests__/workflow-state.test.ts` (43), plus two compliance assertions                |

549 tests across 12 files, `tsc -b` clean, `eslint .` clean.

## Where this reads differently from the plan

### The specification word set is plural-only

The plan said "a word set that asks for the walls". Written literally, `wall`
would have hijacked `create a wall from (0,0) to (4,0)` — which says `wall` and
says `create`, a verb already in `PROGRAMME_VERBS` — the moment a project
approved its geometry. That is precisely Story 27.8.3's forbidden outcome.

The set matches `walls` **plural** and never the singular, and the three
single-wall modelling commands are asserted to stay in the direct lane. A user
drawing one wall names one wall; a user asking for the construction of a design
asks for "the walls".

### Three test fixtures were storing chains that cannot exist

`layout.test.ts` and `geometry.test.ts` built each artefact from a _separately
constructed_ upstream artefact and stored a different one beside it — so the
stored Programme named a Brief the project did not hold. Nothing looked before
this sprint, so the lanes opened anyway.

With the projection wired in, those projects are (correctly) stale and the lanes
close. The fixtures were corrected to store the artefact each downstream artefact
records having been derived from. This is the first evidence that the derivation
does what it claims, and it arrived as four red tests rather than as an
assertion — which is worth more.

### Story 1.2.15 added nothing to the contribution

The projection is exported from `index.ts` and reached through the service a host
already holds. Putting a copy on `ArchitecturalIntelligenceContribution` would
have been a second, staler answer to the same question — Rule 1, in the one place
it would have been easy to break by accident.

### A question about the walls stays a question

`which walls are load bearing?` names the walls, and the classifier recognises
questions before any lane. The new lane did not change that and the test says so.

## Deliberately not built

- No orchestrator, and no automatic advance on approval.
- No `proposalId`, no pending state (Rule 2).
- No artefact history, no `all()` on the reader — Sprint 1.3.
- No production revision path — Sprint 1.3.

---

# Known Follow-Ups

## Sprint 1.3 — Revision Lineage and Navigation

The projection says a stage is stale. It does not yet give the user a way to fix
it that goes through a revision rather than a new lineage. That is the next
sprint, and it is where the `all()` port widening and the production revision
paths land.

## ArchiSimple — the IA Perspective

A panel rendering five rows from this projection, merged with the host's own
pending-proposal view. An ArchiSimple UI sprint, not an Architectural
Intelligence one.

## The Building Assistant

A guided wizard over the same projection. It must not create a second workflow
model — which, after ADR-AI-0002, it structurally cannot: there is only one
derivation and it lives here.

---

# Architecture After This Sprint

```text
                        PlanningArtefactReader     BriefDraftStore
                                 │                        │
                                 └───────────┬────────────┘
                                             ▼
                                      workflowState()          derived, never stored
                                             │
                         ┌───────────────────┼───────────────────┐
                         ▼                   ▼                   ▼
                  classifyRequest      a headless client     the future IA panel
                   (lane gates)                               (+ the host's own
                         │                                     pending proposal)
                         ▼
        Brief → Programme → Layout → Geometry → Specification
                         each still approved through the one Proposal gate
```

One derivation, three consumers, and nothing new that owns state.
