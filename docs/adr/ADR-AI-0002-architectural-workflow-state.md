# ADR-AI-0002: Architectural Workflow State

- **Status:** Accepted
- **Revision:** 1.4
- **Date:** 2026-08-10; revisions 1.3 and 1.4 accepted 2026-08-13
- **Deciders:** ArchiSimple Project
- **Relates to:** ADR-AI-0001 (the five artefacts), ArchiSimple ADR-0027.1 (planning pipeline, Rules 4, 7, 8, 12), ADR-0029 (Rules 2 and 3 — restated shapes), ADR-0030 (Rules 1, 2, 4, 8 — repository separation), ADR-0031 and ADR-0032 revision 2.2 (the host's execution lane, and the one realisation path), ADR-AI-0004 (the realisation state read port)
- **Implemented by:** Sprint 1.2 (the projection), Sprint 1.3 (lineage and navigation), Sprint 1.6 (the realisation lane — revision 1.3)

---

## Revision History

| Revision | Date       | Change                                                                                                                                                                                                                                                                     |
| -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0      | 2026-08-10 | Initial decision. Defines the workflow-state projection, the ownership split between this repository and its host, and the eleven rules that keep the split from eroding.                                                                                                  |
| 1.1      | 2026-08-10 | Sprint 1.3 implemented Rule 10, which is the rule this revision exists to report on. Records that the port widened with **no change in ArchiSimple**, and adds the two clauses Rule 7's enforcement turned out to need.                                                    |
| 1.2      | 2026-08-10 | Sprint 1.4 gave the projection its **second consumer** — the context fragment a model reads. Adds Rule 13, which says what a consumer may do with it and what it may never do.                                                                                             |
| **1.3**  | 2026-08-13 | BUG-008 Phase 3 adds the first lane whose subject is **not a planning stage**. Names realisation state as the host's, extends Rule 2 to say this layer never observes it, and extends Rule 8 to say what gates a non-stage lane. Adds no rule and changes no existing one. |
| **1.4**  | 2026-08-13 | Points at **ADR-AI-0004**, which decides the realisation state read port — and decides that realisation state is read _beside_ this projection rather than folded into it. Adds no rule and changes none.                                                      |

---

## Context

ADR-AI-0001 completed the design pipeline: five artefacts, each separately
approved, each carrying provenance for the one above it.

```text
Architectural Brief → Space Programme → Layout Plan → Geometry Graph → Geometry Specification
```

What the pipeline does not have is a way to **ask what state it is in**. Every
fact a consumer needs is derivable today and none of it is reachable:

- the classifier knows whether a stage is eligible — as three private booleans
  computed inside `interpret`;
- `matchesBrief`, `matchesProgramme`, `matchesLayout` and `matchesGeometryGraph`
  make staleness checkable — and three of the four have no production caller;
- each artefact records the id and revision it was derived from — and nothing
  reads that provenance back to say a downstream artefact has been superseded.

A host that wants to render the pipeline — an IA panel showing five stages, what
is approved, what went stale, what can be asked for next — has exactly two ways
to get those facts today. It can call `approvedBrief()`, `approvedProgramme()`
and their siblings and **re-derive the rules itself**, which puts architectural
reasoning in a React component. Or the reasoning layer can answer the question
once.

There is a second consumer already visible. ADR-0027.1's Building Assistant would
guide a user through the same five stages, and if the panel and the assistant
each derive their own view of the pipeline, the two will disagree — and the
disagreement will be about which stage the user is on, which is the one thing a
guided workflow cannot get wrong.

The temptation this ADR exists to refuse is the obvious one: make the workflow
state a **thing**. Store it, persist it in the project file beside the artefacts,
mutate it as stages complete. That is a state machine with its own memory, in the
one package in this platform that owns no state, and it would go stale the first
time a user opened a project whose artefacts were edited by a later version.

---

## Decision

**Architectural Intelligence exposes a read-only, derived workflow-state
projection over the project's current architectural artefacts.**

The projection is recomputed from the supplied artefact readers and draft state
on every call. It is never persisted and never cached. It does not own proposal
approval or session state.

```text
        ┌──────────────────────────────────────────────┐
        │ Host                                         │
        │                                              │
        │  PlanningArtefactReader   BriefDraftStore    │
        └───────────────┬──────────────────┬───────────┘
                        │ read             │ read
                        ▼                  ▼
        ┌──────────────────────────────────────────────┐
        │ Architectural Intelligence                   │
        │                                              │
        │   workflowState()  ── pure derivation ──▶    │
        │                                              │
        │   artefact relationships                     │
        │   current vs stale                           │
        │   stage prerequisites                        │
        │   blockers                                   │
        │   lane eligibility                           │
        └───────────────┬──────────────────────────────┘
                        │ plain data, restated structurally
                        ▼
        ┌──────────────────────────────────────────────┐
        │ Host                                         │
        │                                              │
        │   proposals · approval · pending proposal    │
        │   session · persistence · UI · navigation    │
        └──────────────────────────────────────────────┘
```

Everything flows one way. The projection is a **function of what the host
already holds**, and calling it changes nothing on either side of the line.

---

## Ownership

The table this ADR exists to fix in place. It is the contract the future IA
panel is built against, and every row was chosen because getting it wrong is a
plausible mistake rather than an obvious one.

### Architectural Intelligence owns

| Owns                                | Which means                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Artefact relationships**          | Which artefact derives from which, and by what provenance. The pipeline order is this layer's knowledge.                                                             |
| **Current-vs-stale**                | Whether an approved artefact was derived from the upstream revision now in force, transitively.                                                                      |
| **Stage prerequisites**             | What a stage needs before it can be generated at all.                                                                                                                |
| **Blockers**                        | Why a stage cannot proceed, in the one vocabulary of ADR-0027.1 Rule 8.                                                                                              |
| **Workflow predicates**             | `matchesBrief`, `matchesProgramme`, `matchesLayout`, `matchesGeometryGraph` and everything built on them.                                                            |
| **Conversational lane eligibility** | Whether an utterance may be classified into a lane. The same derivation, not a second one. Since revision 1.3 this includes a lane that is not a stage — see Rule 8. |

### The host owns

| Owns                          | Which means                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Proposals**                 | Building the envelope is this layer's; the envelope's life after it is handed over is not.                                                                                                                                                                                                                                |
| **Approval state**            | `ProposalApprovalState` — `pending`, `approved`, `rejected` — lives in `@archisimple/ai-engine`.                                                                                                                                                                                                                          |
| **The pending proposal**      | `AiSessionController.pendingProposal()`. This layer never learns that a proposal was approved, only that an artefact appeared.                                                                                                                                                                                            |
| **Session state**             | Conversations, messages, the AI workspace record.                                                                                                                                                                                                                                                                         |
| **Artefact persistence**      | The registry, the project file, revisions on disk.                                                                                                                                                                                                                                                                        |
| **UI**                        | Every label, icon, colour, panel and dock.                                                                                                                                                                                                                                                                                |
| **Navigation**                | Which artefact the user is looking at. Looking at one is not a workflow transition.                                                                                                                                                                                                                                       |
| **User interaction**          | Approve, reject, revise, edit, select — all of them are the host asking, never this layer deciding.                                                                                                                                                                                                                       |
| **Realisation state** _(1.3)_ | Whether an approved Geometry Specification has been **built** — the `RealisationRecord`, the realisation guard's verdict, and the outcome of any attempt. ArchiSimple ADR-0032 revision 2.2 assigns all of it to the host, behind one entry point. This layer neither derives it nor stores it, and cannot read it today. |

The line is drawn between **what the pipeline knows** and **what the user is
doing**. Staleness is a property of two artefacts and their provenance, so it is
this layer's. Whether the user has a proposal open in a panel is a property of a
session, so it is the host's.

---

## The projection

A sketch, not the schema — Sprint 1.2 owns the exact field list.

```ts
/** Reuses PLANNING_STAGES. The pipeline has five stages, and it has had them since Sprint 1.1. */
export type PlanningStage = (typeof PLANNING_STAGES)[keyof typeof PLANNING_STAGES];

export interface ArchitecturalWorkflowState {
  /** The five stages, in pipeline order, always all five. */
  readonly stages: readonly ArchitecturalStageState[];
  /** The furthest stage that can be worked on now. Absent when the design is complete. */
  readonly currentStage?: PlanningStage;
  /** Every stage has an approved artefact and none of them is stale. */
  readonly complete: boolean;
}

export interface ArchitecturalStageState {
  readonly stage: PlanningStage;
  /** What the project holds. `draft` is reachable for the Brief only — it is the only stage with a draft store. */
  readonly artefact: 'none' | 'draft' | 'approved';
  /** The envelope identity of the approved artefact, so a host can navigate to it. */
  readonly approved?: ArtefactIdentity;
  /** Every revision the project holds, oldest first (Sprint 1.3). */
  readonly revisions: readonly ArtefactIdentity[];
  /** Present when the approved artefact was derived from a superseded upstream revision. */
  readonly stale?: StaleDerivation;
  /** Empty exactly when the stage can be generated now. */
  readonly blockers: readonly PlanBlocker[];
  /** Whether a request for this stage is admissible — the same gate the classifier uses. */
  readonly eligible: boolean;
  /** Stable identifiers for what *this layer* can be asked to do. Never labels. */
  readonly actions: readonly WorkflowActionId[];
}

export interface StaleDerivation {
  readonly upstreamStage: PlanningStage;
  readonly derivedFrom: ArtefactIdentity;
  readonly nowInForce: ArtefactIdentity;
  /** True when this stage's own provenance still matches and the staleness was inherited from above. */
  readonly inherited: boolean;
}

export interface ArtefactIdentity {
  readonly id: string;
  readonly revision: number;
}

export const WORKFLOW_ACTIONS = {
  /** No approved artefact, and the prerequisites are met. */
  Generate: 'generate',
  /** An approved artefact exists; asking again produces the next revision. */
  Regenerate: 'regenerate'
} as const;
```

`approve`, `reject`, `revise` and `navigate` are deliberately **not** in
`WORKFLOW_ACTIONS`. They are things the host does; this layer cannot perform one
and must not advertise that it can (Rule 3).

The projection has no `kind`, no `createdAt` and no `contractVersion`. It is not
an artefact: it is never approved, never persisted and never versioned as a
document. Its **shape** is part of this repository's public API and versions with
the package on the `0.x` train.

---

## Rules

Numbered so sprints, compliance tests and ArchiSimple's own ADRs can cite them.

### Rule 1 --- The projection is derived, never stored

Every call recomputes from the artefact reader and the draft store. There is no
workflow-state field, no memo, no cache, and no entry in the project file's
planning section.

This is ADR-0027.1's existing rule about derived facts, applied to the one
derivation a host would most like to persist: layout quality and packing
evaluation are already deliberately absent from their artefacts because a stored
verdict goes stale the moment a later revision lands. A stored _workflow_ state
goes stale the same way and is worse, because it would be the thing a UI trusts.

**Enforceable**: the compliance test asserts that no production source assigns a
workflow-state value to a module-level or instance field, and that
`PlanningSnapshot` gains no workflow section.

### Rule 2 --- Approval is observed through its consequence, never reported

This layer never learns that a proposal was approved. It learns that an artefact
of a given kind and revision is now readable through `PlanningArtefactReader`,
which is the same thing arriving by the only route that crosses the boundary.

The projection therefore has **no `proposalId`, no pending state and no
`ready-for-approval` status**. A host that wants to show "awaiting approval"
merges its own `pendingProposal()` on top of this projection. That merge is a
host concern precisely because the host is the only participant that can be
right about it.

### Rule 2, extended --- realisation is not observed at all (revision 1.3)

Rule 2 says approval is observed through its consequence. Realisation has no
consequence this layer can observe, and revision 1.3 states the stronger form
rather than leaving it to be inferred:

**An artefact becoming readable means it was approved. It never means it was
built.** The projection reports `complete` when all five stages are approved and
current, and `complete` is a statement about the _design_, not about the model.

This is not a theoretical distinction. BUG-008 is what it costs: a user approved
a Geometry Specification, asked for it to be built, and was told the walls had
been created. Nothing had been. The assistant was not overreaching from a fact it
could have checked — the fact did not exist on this side of the boundary, and the
one thing standing between "the design is finished" and "the building exists" was
a word.

So a consumer of this projection **SHALL NOT** infer, report or imply that a
design has been realised. Where realisation state matters, the authority is the
host's — today through the `realisation` context fragment ArchiSimple's Sprint
036.2b contributes, which reaches a model as context and never reaches this
derivation.

#### Why realisation state is not in the projection (revision 1.3)

It is tempting to read the host's `realisation` fragment during a turn and fold
it in. That would be wrong for a structural reason worth recording before someone
tries it:

`AiProviderRequest.context` exists **only during a message turn**. The projection
is derived on every call and must be safe on every render (Rules 1 and 12) — an
IA panel calls it with no request in sight. A projection that were sometimes
enriched with realisation state and sometimes not is two answers to one question,
which is precisely what Rule 8 exists to prevent.

Realisation state can therefore enter the projection **only through a read port
of its own**, beside `PlanningArtefactReader`. Rule 10's "widen without forcing a
release" does not apply: the host would have to supply a new object to the
contribution, so both repositories change. That is a decision, not a detail, and
it belongs to the revision that makes it.

**Revision 1.4: the port exists, and the projection still does not
carry it.** ADR-AI-0004 decides the read port — and decides, deliberately, that
realisation state is read _beside_ this projection rather than folded into it.
The clause above stands unchanged as the reason a port was needed at all; what it
left open, ADR-AI-0004 settles. The projection remains planning workflow state,
and no consumer of it may report `complete` as though it meant built.

### Rule 3 --- Actions are what this layer can be asked to do

`WORKFLOW_ACTIONS` lists the operations `ArchitecturalIntelligenceService`
exposes. It does not list approval, rejection, revision-by-editing or
navigation, because performing any of those is the host's, and an action a
consumer cannot route back to a method is a promise the contract cannot keep.

### Rule 4 --- One vocabulary for what stops a stage

Blockers are `PlanBlocker` values carrying `PLAN_BLOCKER_REASONS` (ADR-0027.1
Rule 8). There is no `StalenessReason` type, no `BlockedReason` enum and no
second set of strings.

Where the existing reasons do not fit, the vocabulary is **extended** — one
shared list gaining a member, never a second list beside it. Sprint 1.2 adds
`superseded` for exactly this, because "the information is missing" and "the
information was replaced" are different sentences to a user and the same sentence
to the existing four reasons.

### Rule 5 --- Status is not one enum

Presence, staleness, eligibility and blockers are **orthogonal fields**. An
approved artefact can be stale and remain approved; a stage can be blocked
because of a stage two above it while holding a perfectly valid artefact of its
own.

A single `status` string forces one slot to carry two facts, and the consumer
that has to reconstruct the second one is the UI — which is where reasoning is
not allowed to live.

### Rule 6 --- Staleness is transitive

An approved artefact is stale when its provenance does not match the upstream
artefact now in force, **or when the upstream stage is itself stale**.

```text
Brief v2  (approved)
    ↓
Programme v1  ← stale: derived from Brief v1
    ↓
Layout v1     ← stale: its provenance matches Programme v1, which is stale
```

Without the second clause, revising a Brief would mark the Programme stale and
leave a Layout claiming to be current — derived, correctly, from a Programme
nobody should build on. `inherited` distinguishes the two so a host can say
_why_ without recomputing the chain.

### Rule 7 --- Eligibility means approved **and** current

A stage may be generated when the stage above it holds an approved artefact that
is not stale. This tightens the three booleans `classifyRequest` already takes:
`hasApprovedProgramme` becomes _has an approved Programme that is current_.

Arranging a superseded Programme produces a Layout that is stale on the day it is
approved. Regenerating the Programme is not blocked by its own staleness — that
is the fix, not the failure.

### Rule 7 in practice — the second refusal

Sprint 1.3 enforced Rule 7 at generation time and found that "the input must be
the artefact in force" is not sufficient. A **tool** reads the artefact in force
and passes it faithfully, so that check never fires — but if a revision upstream
left that artefact stale, what the tool builds is stale too.

So a refusal has two clauses, and the second one asks the projection rather than
re-deriving:

1. the input is not the artefact in force; or
2. it is, and the projection says the stage cannot proceed.

The second clause returns **the blocker the projection already computed**. One
place decides why a stage cannot proceed; a second opinion in the service would
be Rule 8's failure appearing between a lane and a tool instead of between two
lanes.

### Rule 8 --- The classifier consumes the projection

`classifyRequest`'s stage gates are read **from** the workflow state, not derived
a second time in `interpret`. One derivation, one answer.

Two derivations would eventually disagree, and the disagreement would appear as
a panel that offers a stage the conversation refuses — which is the exact class
of bug this ADR exists to prevent, appearing inside the repository that wrote it.

#### Rule 8, extended --- a lane need not be a stage (revision 1.3)

Every lane through revision 1.2 asks for a planning artefact, so "lane
eligibility" and "stage eligibility" were the same sentence. BUG-008 Phase 3 adds
one that is not: **realisation** asks for the approved design to be built, and
building is the host's.

Such a lane is admitted on two conditions, and both keep Rule 8 intact:

1. **Its gate is read from this projection like every other.** The realisation
   lane's gate is "the Specification stage is approved and current" — a fact the
   projection already holds. A lane gated on something the projection cannot
   answer is a lane this layer is not entitled to open.
2. **It carries intent, and never capability.** The lane produces the identity of
   what the user meant — for realisation, the approved Specification's `id` and
   `revision` — and the host decides whether that can be done and does it
   (ADR-0032 revision 2.2: exactly one realisation path).

What this layer consequently **cannot** decide is whether the design has already
been built, which the extension to Rule 2 above states. The lane may therefore
propose a realisation the host refuses, and that is the correct outcome: the
refusal is authoritative and arrives as the proposal's execution result, whereas
a guess made here would be neither.

A lane meeting neither condition is not a lane. It is execution wearing a
classifier's clothes.

### Rule 9 --- The contract crosses as plain data

The host restates this shape structurally and imports nothing (ADR-0030 Rule 2,
ADR-0031 Rule 1, and the seam `ApprovedArtefact` and `PlanningArtefactReader`
already use twice).

So the projection is JSON-serialisable throughout: string unions, numbers,
booleans, arrays and plain objects. No classes, no methods, no `Date`, no branded
types, no `Map`, and no enum object a consumer would have to import to compare
against. Every identifier is a **stable string** the host maps to its own
labels — `apps/web` forbids hardcoded UI strings, and a label emitted from here
would arrive as one.

### Rule 10 --- Ports widen without forcing a platform release

A new capability the host must supply is added as an **optional, argument-free
method** on the existing port, shaped so the host's existing object satisfies it
structurally.

`PlanningArtefactRegistry` in `apps/web` already exposes `all()` returning every
approved revision. A port that asks for `all?(): readonly ApprovedArtefact[]` is
satisfied by that object on the day it is declared; a port that asks for
`history(kind: string)` is not, and forces the whole ADR-0030 Rule 8 dance —
platform release, then this repository, then the host — for a read-only method.

Optional, because a host that supplies nothing must still get a well-formed
projection (Rule 11).

### Rule 10 in practice — Sprint 1.3

The rule's first real test, and it held. `PlanningArtefactReader` gained:

```ts
all?(): readonly ApprovedArtefact[];
```

`apps/web`'s `PlanningArtefactRegistry` already exposed exactly that signature,
so the widening was satisfied **structurally on the day it was declared**: no
change in ArchiSimple, no version bump, no release ordering, and the intelligence
shipped alone. A test in this repository pins the shape, because a future change
to `history(kind)` would compile here and fail at a consumer's `npm install`.

The rule is therefore worth stating more strongly than revision 1.0 did: **check
what the host already exposes before designing the method.** The natural
signature is not always the cheap one, and the difference is a coordinated
two-repository release.

### Rule 11 --- Absent inputs degrade, they never throw

`workflowState()` with no artefact reader returns five stages, all `none`, the
first eligible. With no draft store, no stage is ever `draft`.

`@archisimple/architectural-intelligence` is an optional dependency of its host
(ADR-0030 Rule 2), and a projection that threw when partially wired would make
the degraded path the broken path.

### Rule 12 --- Reading the projection advances nothing

`workflowState()` generates no artefact, builds no `Proposal`, mutates no draft
and consults no provider. It is safe to call on every render.

The rule ADR-0027.1 Rule 7 implies and no document has yet stated: completion is
not approval, and **observation is not completion**.

### Rule 13 --- A consumer reports the projection; it never re-decides it

Added by Sprint 1.4, when the projection acquired its second consumer.

Every consumer — the classifier's stage gates, the context fragment a model
reads, and any panel that follows — **maps** the projection. None of them
recomputes eligibility, re-derives staleness, or decides pipeline order for
itself. A second opinion in a consumer is Rule 8's failure with more distance
between the two answers, and the distance is what makes it hard to notice.

Two consequences that are easy to get wrong:

- **A consumer may flatten, and may not enrich.** Turning `stale?: StaleDerivation`
  into `stale: boolean` for a prompt is a projection of a projection and is fine.
  Computing "and therefore you should…" is a decision, and decisions live in the
  derivation.
- **A consumer may name an action it can route to.** The context fragment's
  `nextTool` names a tool _this package defines_, which is why it is allowed;
  it is not a promise the host will offer that tool, and it is not an
  instruction.

The rule reads narrow and it is the one that keeps the projection worth having:
a single derivation with three faithful readers stays true, and one with three
interpreters is three subtly different pipelines wearing one name.

---

## Rationale

### The reasoning belongs where the reasoning is

"Is this Layout stale?" is a question about provenance, revisions and pipeline
order. Every fact needed to answer it lives in this repository, and none of the
three consumers who want the answer — the IA panel, the Building Assistant, a
headless client — should be able to answer it differently.

### The boundary is what makes the panel cheap

An IA panel that renders this projection is a list of five rows. An IA panel that
derives it is a second implementation of the pipeline in React, which
ADR-0027.1 Rule 2 and this codebase's "components render, they never decide" rule
both forbid, and which would drift the first time a stage is added.

### Refusing to own approval is what keeps this stateless

The single most attractive extension to this projection is a `pending` status,
and it is the one that would break it. Knowing what is pending requires observing
approval, which requires either holding session state or receiving callbacks —
and a package that receives approval callbacks is one refactor away from acting
on them, which is ADR-0023 Rule 1.

### Headless by construction

The projection is exactly what a command-line generator or a test needs to drive
the pipeline without a UI, because it was never allowed to contain one.

---

## Consequences

### Positive

- one source of truth for pipeline state, for every consumer present and future
- the IA panel and the Building Assistant cannot disagree about which stage a
  project is on
- staleness becomes visible instead of merely detectable
- the classifier's gates stop being private booleans
- this repository stays stateless, and provably so

### Negative

- the host must merge its own approval state onto the projection to render
  "awaiting approval"; the panel is two sources, not one
- recomputing on every call is wasted work when nothing changed — accepted,
  because the derivation is a handful of comparisons over five records and a
  cache is the thing this ADR refuses
- a new public shape to version on the `0.x` train
- extending `PLAN_BLOCKER_REASONS` is a breaking change for an exhaustive
  `switch` in any consumer

---

## Alternatives Considered

### Persist workflow state in the project file

Rejected. It is a derived fact stored beside the thing it is derived from, which
ADR-0027.1 already forbids for layout quality and packing evaluation. A file
whose artefacts were written by a later version would carry a workflow verdict
that disagrees with them, and the verdict is what the UI would trust.

### One `status` enum per stage

Rejected — Rule 5. `approved` and `stale` are not alternatives: a stale artefact
is still approved, and a consumer given one slot has to guess.

### Let the host derive it

Rejected. It puts pipeline rules in the composition root and in React, duplicates
them for the Building Assistant, and guarantees the two drift. It also cannot
work at all in a headless client, which has no host to derive it.

### Include the pending proposal

Rejected — Rule 2. This layer structurally cannot observe approval, and giving it
the ability to would hand it session state and, eventually, execution.

### A `StalenessReason` vocabulary beside `PlanBlocker`

Rejected — ADR-0027.1 Rule 8. Two vocabularies for "why can't I proceed" is the
thing that rule was written about. The shared list gains a member instead.

### `history(kind: string)` on the artefact reader

Rejected — Rule 10. It is the natural signature and it is the expensive one: it
forces a coordinated release across two repositories for a read-only method,
where an argument-free `all()` is satisfied by the host object that already
exists.

---

## Out of Scope

This ADR does not define:

- how a host renders the projection, or what an IA panel looks like
- artefact **navigation** — which revision the user is inspecting is session state
- the Building Assistant's guided flow
- anything downstream of the Geometry Specification, which is ADR-0031 and
  ADR-0032. Revision 1.3 refines rather than reverses this: **realisation stays
  out of scope as a capability**, and what comes in scope is only the layer's
  ability to say a user asked for it, and its duty never to claim it happened.
- **whether realisation state joins the projection** (revision 1.3).
  The extension to Rule 2 says what such a revision would have to accept — a read
  port and a coordinated release — and deliberately does not take that decision
  here.

---

## Summary

Architectural Intelligence answers:

> **"Where is this design, and what can be asked for next?"**

The host answers:

> **"What is the user looking at, what have they approved, and what are they
> being shown?"**

The workflow state is the projection between those two questions, and the fact
that it is a projection — recomputed, never stored, never advancing anything —
is the whole decision.
