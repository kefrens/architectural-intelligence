# Architectural Intelligence — Current State Architecture

**Generated:** 2026-08-10, from the implementation at commit `44e0f43` plus Sprints 1.2 through 1.5
**Package:** `@archisimple/architectural-intelligence` `0.2.0` (staged; not yet published)
**Companion:** [00-current-state.yaml](00-current-state.yaml) — the same facts, machine-readable

This document describes **what is implemented**. Anything that appears only in
an ADR, a sprint document or a comment about future work belongs in
_What is not implemented_ at the end, and it is there. Source code wins over
this document.

Verified for this snapshot rather than assumed: `tsc -b` builds clean,
`eslint .` reports nothing, and `vitest run` passes **642 tests across 15
files**.

This is the first current-state pair this repository has had. Until Sprint 30.3
extracted it (ADR-0030), the fact was recorded in ArchiSimple's own pair, which
still carries entries describing a package that no longer lives there.

---

# Executive Summary

This package is the **reasoning layer**: the capability that lets a user talk to
a project in architectural language and get back either an answer drawn from the
Building Platform or a reviewable proposal.

It owns **reasoning and nothing else**. No project state, no document reference,
no `CommandDispatcher` — a fact asserted against the production sources by its
own compliance test rather than trusted to the layering. It reads the Building
Platform through the services that already derive it, and it emits work that
somebody else executes, after a user has approved it.

11,770 lines of production TypeScript across eleven directories, published as
one ES module with a single entry point.

Three things reach a host from here:

- **Five planning artefacts** — Architectural Brief, Space Programme, Layout
  Plan, Geometry Graph, Geometry Specification — each separately reviewed and
  approved, each immutable once approved, each carrying provenance for the one
  above it.
- **One `ArchitecturalPlan`** carrying Automation `CommandRequest`s, for
  requests that state their own geometry and need no design pipeline at all.
- **One workflow-state projection** (Sprint 1.2) — where the design is, what has
  gone stale, and what can be asked for next, derived on every call and stored
  nowhere.

Since Sprint 1.1 the design pipeline is **complete**: it ends at the Geometry
Specification, a CAD-independent description carrying wall thickness, height,
centrelines and dimensioned openings — everything a consuming application needs
to build the design without taking a single architectural decision of its own
(ADR-AI-0001). What happens after that is somebody else's repository.

Since Sprint 1.2 the pipeline can also **describe itself**. `workflowState()`
answers where a design is without owning any of it, and the same derivation gates
the conversation — so a panel and a conversation cannot disagree about which
stage a project is on (ADR-AI-0002).

---

# Where this package sits

```text
host application (apps/web, or any other)
      │  composes one ArchitecturalIntelligenceContribution
      ▼
@archisimple/ai-engine          conversations, proposals, approval
      ▼
architectural-intelligence      ← this package: intent, knowledge, artefacts, plans
      ▼
building-model / spatial / inspector      the Building Platform (read-only)
      ▼
@archisimple/automation-api     the only way anything is written
```

The seven platform packages are declared as **`peerDependencies`** at `^0.2.0`,
so the host and this package share one `automation-api` and one `ai-engine`.
Two copies of the Automation boundary would be a `Proposal` one half does not
recognise.

The range moved from `^0.1.0` when ArchiSimple's Sprint 31.0 published the wall
realisation maths — `geometry.insertWallThickness`, `mergeColinearRuns`,
`classifyJunction`, `findJunctions` — that the Geometry Specification will call.
The platform released first and this repository consumed a released version, in
ADR-0030 Rule 8's order.

Two packages are forbidden and the compliance test says so out loud:
`@archisimple/core` (Runtime state — ADR-0023 Rule 1) and
`@archisimple/automation-mcp` (a second execution pipeline).

## What "owns no state" means concretely

| Property                    | Value                                                                         |
| --------------------------- | ----------------------------------------------------------------------------- |
| Owns project state          | No                                                                            |
| Holds a document reference  | No                                                                            |
| Holds a `CommandDispatcher` | No — asserted by `architecture-compliance.test.ts`                            |
| Executes anything           | No                                                                            |
| Imports React or Three.js   | No                                                                            |
| Emits `CommandRequest`s     | Yes, in the Direct Execution lane — dispatched **by the host** after approval |

The last row is the one that is easy to misread. Producing a Request is not
executing it. Every write originating here happens in
`AiSessionController.approveProposal`, in the host, through the same dispatcher
a button click uses.

---

# The front door: eight lanes

`ArchitecturalIntelligenceService.interpret` classifies one utterance
**deterministically, host-side, before any provider is consulted**, and routes
it into one of eight lanes ([src/brief/request-classification.ts](../../src/brief/request-classification.ts)):

| Lane                       | Produces                         | Reachable only when               |
| -------------------------- | -------------------------------- | --------------------------------- |
| `direct-execution`         | `ArchitecturalPlan` → `Proposal` | always                            |
| `brief-generation`         | `ArchitecturalBrief`             | enough was said to write one      |
| `clarification-required`   | one focused question             | a mandatory topic is unanswered   |
| `programme-generation`     | `SpaceProgramme`                 | an approved Brief exists          |
| `layout-generation`        | `LayoutPlan`                     | an approved Programme exists      |
| `geometry-generation`      | `GeometryGraph`                  | an approved Layout exists         |
| `specification-generation` | `GeometrySpecification`          | an approved Geometry Graph exists |

The four artefact lanes are gated on what the project has actually approved,
read through an optional `PlanningArtefactReader` the host supplies. A host that
supplies none classifies exactly as it did before those lanes existed: "show me
the spaces" with no Brief behind it is a question about a project, not a
programme request, and stays where it has always been.

Since Sprint 1.2 each gate means **approved _and_ current**, and all four are
read off the workflow-state projection rather than derived a second time inside
`interpret` (ADR-AI-0002 Rules 7 and 8). Arranging a superseded Programme would
produce a Layout that is stale on the day it is approved, so that lane closes and
the stage that fixes it stays open.

The **revision lane** (Sprint 1.3) is the only one that reaches back _up_ the
pipeline, and it is gated on a different question from the four stage lanes:
`hasBriefToRevise` asks whether there is a Brief to change, not whether the stage
below it can be built. It fires only when the utterance carries a revision cue —
_actually, instead, change, make it_ — **and** states a brief topic the reader
recognises. A cue alone is not enough: "actually, move the kitchen wall 200 mm"
is a correction and a modelling command, and the direct lane keeps it.

The specification lane's word set is the narrowest in the file, and deliberately:
it matches `walls` **plural** and never `wall`. "Create a wall from (0,0) to
(4,0)" says `wall` and says `create`, and a lane that hijacked it would interrupt
a working modelling command with a design stage — the one outcome Story 27.8.3
exists to forbid.

Mandatory Brief topics are **storeys, bedrooms, bathrooms**. Nine topics exist
in total; the other six are optional.

`interpretIntent` is deliberately **not** classified. It is the entry point a
language model reaches through the host's Tool Broker, and a tool call has
already named its action and its parameters — it is Direct Execution by
construction.

---

# The design pipeline — five artefacts

Each stage is a separate artefact, separately approved, immutable once approved,
and revised rather than edited. All five flow through the **same** `Proposal`
and the same `AiSessionController.approveProposal`; there is no second approval
surface anywhere in this package.

```text
Architectural Brief     intent            — no areas, no coordinates
        ↓
Space Programme         logical building  — target areas, adjacency, zoning
        ↓
Layout Plan             organisation      — resolved adjacency, circulation, storeys
        ↓
Geometry Graph          semantic geometry — polygons, candidates, no thickness
        ↓
Geometry Specification  buildable geometry — thickness, height, openings
```

## Architectural Brief (Sprint 27.8)

Captures user intent across nine topics. Every requirement records whether it
was **stated** or **assumed**, and assumed values also appear in `assumptions`,
so a review card can show the user what the platform decided on their behalf.

Assembled by the host from resolved tool calls and typed data
([brief-assembly.ts](../../src/brief/brief-assembly.ts)) — never parsed out of
model prose. An unfinished Brief lives in a `BriefDraftStore` between turns; an
approved one lives in the project file. Those are deliberately different places:
a draft is a conversation in progress, an approved artefact is something the
project has committed to.

## Space Programme (Sprint 27.9)

Which spaces exist, what each is for, what matters most, and what should be near
what. Priorities are `required` / `expected` / `optional`; zones are `day` /
`night` / `service` / `circulation`; adjacency strength is `required` /
`preferred` / `avoid`.

Every **number** comes from `@archisimple/skills`' `allocateSpaceAreas`, which is
why the same Brief cannot produce two different programmes. The honesty rule is a
field: `AREA_SOURCES` records per space whether a target area was scaled to a
total the user stated, or came from the platform's typical-area table.

Carries `sourceBrief` provenance and `matchesBrief` to detect a Brief revised
underneath it.

## Layout Plan (Sprint 28.0)

Resolves the Programme's intended adjacencies into an arrangement: a graph of
space and circulation nodes joined by `adjacent`, `connected`, `separated` and
`vertical-connection` edges, plus storey assignment.

It **resolves**; it does not redesign. No space is added, removed, resized,
renamed or re-zoned here. When an approved adjacency cannot be satisfied, it
records `satisfied: false` and a warning rather than dropping the requirement
quietly.

Storey assignment, adjacency resolution and circulation scoring all live in
`@archisimple/skills`. `LayoutQuality` is computed on demand by
`computeLayoutQuality` and **never stored** — a verdict written into an artefact
is stale the moment a later revision lands.

## Geometry Graph (Sprint 28.1a)

The first stage where coordinates exist, and the last before they become walls.
Room polygons bound the **finished face** of a space, so a polygon of 12 m² is a
room of 12 m² and the Programme's target areas mean what they say. Wall
candidates are edges a wall will later be built along — no thickness, no
material, no height, no `CommandRequest`.

Both areas are recorded: `requestedArea` beside `achievedArea`. A reader who
cannot see a shortfall cannot disagree with it.

Placement comes from `@archisimple/skills`' `packLayout`, and **every clause of
the packing contract is judged by `evaluatePacking` over the produced artefact
before it is offered** (`gateGeometryGraph`). A violated invariant is a hard
failure naming the clause, with no proposal. That gate is not belt-and-braces
over the conformance suite: it is the only thing that makes the guarantee true
for a packing strategy this repository did not write.

Shapes are **axis-aligned rectangles** — a stated limitation. The built-in
packer produces nothing else, and constraining it turned robust general-polygon
predicates into interval arithmetic that could be tested exhaustively.
`evaluatePacking` refuses a shape it cannot judge rather than judging it wrongly.

Evaluation, like layout quality, is computed on demand and never stored.

## Geometry Specification (Sprint 1.1)

The last artefact, and the only one that crosses to a consuming CAD application.
It carries wall thickness, role and height; wall centrelines merged into runs;
openings with a kind, a position along their wall, a width, a height and a sill;
space boundaries as they stand once the walls are in; and the metric conventions
to read all of it by — unit, precision, origin, winding, elevation datum — stated
as fields, because a consumer outside this project has no `CLAUDE.md`.

It carries a `contractVersion` of its own (`1.0.0`), semantic and independent of
the npm version, because the two repositories are deliberately not lockstep. A
consumer checks the **major** through `isContractCompatible` and refuses what it
was not written for rather than reading it partially.

**Thickness is an architectural decision and it is taken here.** It follows from
construction type, from what separates what — facts that exist only in this
repository. Leaving it to a consumer would mean two consumers building two
different buildings from one approved design.
[construction-defaults.ts](../../src/geometry/construction-defaults.ts) holds
every such number in one shape, and `describeDefaults` turns it into the
sentences a reviewer reads, so 300 mm is visibly the platform's opinion rather
than the user's requirement.

### Rooms grow; they never shrink

Geometry Graph polygons bound finished faces and are allowed to touch, so
inserting a wall needs room that is not there. `insertWallThickness` pushes the
rooms apart rather than shrinking them — and where one room _spans_ a wall line
inserted across it, that room absorbs the wall and grows. A room delivering more
than was approved is visible and reported in `warnings`; a room delivering less
would be a silent shortfall, which is the failure ADR-0027.1 exists to prevent.

The skill takes **one storey at a time**, because a rail is a line in one plan
and storeys are packed independently. Synthesis loops and concatenates.

### The gate, and why validation is exported

`gateGeometrySpecification` runs after enrichment and before the proposal,
checking `S1`–`S7`: no space under-delivered, no two spaces touching, every wall
and opening the geometry named present, wall ends meeting exactly, openings
inside their walls, boundaries simple, the artefact self-describing.

`validateGeometrySpecification` is exported from the package, which is unusual
for an internal check and deliberate: ADR-0031 Rule 4 makes a _consumer's_
rejection a defect in **this** repository rather than a question for the user. A
consumer's own validation is a safety net that should never fire.

### Regenerating produces a revision

Generating a Specification when the project already approved one for the same
Geometry Graph returns **revision n+1** rather than a second artefact at revision

1. It is the first production caller of any `revise*` function in this package —
   above this stage, only tests exercise them.

---

# The workflow state (Sprint 1.2)

`ArchitecturalIntelligenceService.workflowState()` answers where a design is and
what can be asked for next. It is a **projection**, not a thing: derived from the
artefact reader and the draft store on every call, stored nowhere, and carrying
no `kind`, no revision and no persistence (ADR-AI-0002 Rule 1).

```text
PlanningArtefactReader ─┐
                        ├─▶ deriveWorkflowState() ─▶ ArchitecturalWorkflowState
"is a brief drafted?" ──┘
```

Five stage states, in pipeline order, each with **orthogonal fields** rather than
one status string — because an approved artefact can be stale and remain
approved, and a stage can be blocked by something two stages above while holding
a perfectly valid artefact of its own:

| Field      | Says                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| `artefact` | `none`, `draft` or `approved`. `draft` is reachable for the Brief only. |
| `approved` | the artefact's identity, so a host can navigate to it                   |
| `stale`    | which upstream revision it was derived from, and which is in force now  |
| `blockers` | why it cannot be generated — `PlanBlocker`, the one vocabulary          |
| `eligible` | the stage above is approved **and** current                             |
| `actions`  | `generate` or `regenerate` — what _this layer_ can be asked to do       |

Plus `currentStage` (the earliest stale stage, or failing that the first
buildable one) and `complete`.

## Staleness is transitive

An artefact is stale when its own provenance diverges from the upstream artefact
in force, **or when the stage above it is stale** (Rule 6):

```text
Brief v2  (approved)
    ↓
Programme v1  ← stale, inherited: false — derived from Brief v1
    ↓
Layout v1     ← stale, inherited: true  — its provenance is intact; its input is not
```

Sprint 1.2 gave `matchesBrief`, `matchesProgramme` and `matchesLayout` their
first production callers. Before it, staleness was detectable and never detected.

A stage's own staleness is never a blocker: regenerating it is the fix, so it
stays eligible and offers `regenerate`. What is blocked is the stage **below** a
stale one, with the `superseded` reason Sprint 1.2 added to
`PLAN_BLOCKER_REASONS` — one vocabulary extended, never a second list beside it
(ADR-0027.1 Rule 8).

## What it deliberately does not carry

**Anything about proposals.** No `proposalId`, no pending state, no
`ready-for-approval`. `ProposalApprovalState` and `pendingProposal()` are
session-scoped in `@archisimple/ai-engine`: this package builds a `Proposal`,
hands it over, and never learns its fate — what it learns is that an artefact
became readable, which is approval arriving by the only route that crosses the
boundary. A host renders "awaiting approval" by merging its own view onto this,
and it is the only participant that can be right about it (Rule 2).

For the same reason `actions` lists no `approve`, `revise` or `navigate`: each is
the host's, and an action a consumer cannot route back to a method here is a
promise the contract cannot keep (Rule 3).

## It crosses as plain data

The host restates the shape structurally and imports nothing (ADR-0030 Rule 2,
ADR-0031 Rule 1), so every value is JSON: string unions, numbers, booleans,
arrays, plain objects. Every identifier is a stable string the host maps to its
own labels — `apps/web` forbids hardcoded UI strings, and a label emitted from
here would arrive as one (Rule 9).

With no artefact reader wired it answers five untouched stages rather than
throwing: this package is an optional dependency of its host, and a projection
that failed when partially wired would make the degraded path the broken path
(Rule 11).

---

# Revision and lineage (Sprint 1.3)

Every artefact carries the id and revision it was derived from, and has since the
sprint that introduced it. What Sprint 1.3 added is the guarantee that those
identities form **one lineage per stage**.

```text
Brief#a v1 ──▶ Programme#b v1 ──▶ Layout#c v1
   │
   │ "actually make it 4 bedrooms"
   ▼
Brief#a v2 ──▶ Programme#b v2 ──▶ Layout#c v2
   ▲               ▲                 ▲
   └───────────────┴─────────────────┴─── same id, next revision, all readable
```

Before this sprint the left-hand column was a lie. Re-describing a building went
through `assembleBrief`, which mints a **new id at revision 1** — so the project
held `Brief#a` and `Brief#b` with nothing connecting them. Staleness was still
detected, because `matchesBrief` compares the id as well as the revision, but the
record of what the user approved _first_ was disconnected from what they approved
instead.

## Every path that produces a Brief folds into the one it has

Sprint 1.3 gave four stages "producing an artefact for a project that already has
one is a **revision** of it" and left the Brief three paths that _created_ one.
All three forked, and two forks made the project unusable: a second lineage sets
an `ambiguous` blocker on the Brief stage itself, which leaves no stage eligible
and no way back (Bug 002).

Sprint 1.5 closed all three. They fold through one function:

```text
   a tool call ──┐
   an utterance ─┼──▶ reviseBriefFromFields(approved, fields)
   a draft ──────┘              │
                                ├─ nothing moved  → undefined → NothingToDo
                                └─ something moved → revision n+1, same id
```

`planning_captureBrief` became `createCaptureBriefToolDefinition(intelligence)` to
make that possible — it was the one planning tool that was a standalone `const`,
so it held no service, could not read `approvedBrief()`, and could not know a
Brief existed. Its **name, schema and arguments are unchanged**; only the host's
composition differs.

Change is judged on what the caller **supplied**, never on the merged result:
`mergeSpaces` also derives spaces from the requirements, and comparing the merged
list would make every identical re-capture look like a change — the loop Bug 002
actually produced.

## Three things now produce revisions

- **`reviseBriefFrom`** — the production path for changing an approved Brief.
  Topics stated in the new utterance override their topic; everything else is
  carried forward with its original `source`, so correcting the bathroom count
  does not downgrade the storey count to an assumption. `objectives` are carried
  forward too: a correction is not a new purpose. `utterance` is replaced,
  because it is the sentence _this_ revision was built from — and the superseded
  revision keeps the previous words, which is what the lineage is for.
- **Regenerating any stage.** `generateProgramme`, `generateLayout`,
  `generateGeometry` and `generateSpecification` revise what the project holds
  rather than minting a second artefact, and the revision's provenance records
  the upstream revision the regeneration actually read.
- **Each `revise*` patch** now accepts its provenance field, which is what makes
  the previous point expressible. A revision regenerated from a newer upstream
  must record that upstream, or staleness would be computed against a provenance
  that lies.

Sprint 1.1 made the Specification's revision conditional on
`matchesGeometryGraph` — revision only when the Graph was the same one. That
condition is dropped: it was the remaining way to split a lineage.

## Stale artefacts cannot become inputs

Every `generate*` takes its upstream artefact as an argument and, until this
sprint, believed it. Two refusals now stand in front:

1. **It is not the artefact in force** — a caller held one from before an
   approval, or one from another lineage.
2. **It is in force, and the projection says the stage cannot proceed** —
   because that artefact is itself stale.

The second is the one a _tool_ reaches. The layout tool reads the programme in
force and passes it faithfully, so the first check never fires; but if a Brief
revision left that programme out of date, a layout built on it is out of date
too. The refusal reuses the blocker the projection already computed, because
there is one place that decides why a stage cannot proceed and this is not it.

Sprint 1.2 deliberately shipped without these guards: until there was a revision
path, a refusal left the user with nowhere to go. Now regenerating from the
revision in force is one turn away, and the suggestion says so.

## Reading the lineage

`PlanningArtefactReader` gained one optional, argument-free method:

```ts
all?(): readonly ApprovedArtefact[];
```

`apps/web`'s `PlanningArtefactRegistry` has had exactly that signature since
Sprint 27.8, so the widening was satisfied **structurally, with no change in the
other repository** — no version bump, no release ordering (ADR-AI-0002 Rule 10).
The natural signature, `history(kind)`, would have forced all three for a
read-only method. A test in this repository pins the shape, because a future
change to it would compile here and fail at a consumer's `npm install`.

Each stage state carries `revisions`, oldest first. A host that supplies no
`all()` gets the identity in force and no lineage behind it, rather than an
error.

## A split lineage is a defect, not a workflow

More than one artefact id among a stage's revisions means the revision paths
regressed — there are no projects created before this sprint, so it cannot mean
anything else. It is reported as an `ambiguous` blocker on that stage and on the
one below it, and it is deliberately **not** repairable through the projection:
regenerating would revise whichever lineage happens to hold the highest revision
and orphan the other.

---

# What the model is told (Sprint 24.5, extended 1.4)

`createArchitecturalContextProvider` contributes the `architecture` fragment.
Three other fragments already say what the project _contains_; this one says what
the assistant can **do**, and since Sprint 1.4 where the design **is**.

| Field                 | Says                                                       |
| --------------------- | ---------------------------------------------------------- |
| `editOperations`      | action ids the planner can turn into a proposal, read live |
| `answerableQuestions` | questions the Building Platform answers without a proposal |
| `activeFloorId`       | where new geometry belongs                                 |
| `floorCount`          | how many storeys exist                                     |
| `design`              | **where the design has got to** (Sprint 1.4)               |

## `design`

Every field is derived from `workflowState()` — the same projection the
classifier's stage gates read, so a panel, a conversation and a model cannot
disagree about which stage a project is on (ADR-AI-0002 Rule 8). It is the
projection's second consumer and its first outside this package.

```ts
design: {
  currentStage: 'programme' | … | null,
  complete: boolean,
  stages: [{ stage, artefact, revision, stale, eligible, blockedBecause }, …],
  nextTool: 'planning_generateProgramme' | … | null
}
```

`null` rather than an absent key throughout: this crosses to a model as prompt
text, and a present `null` is read more reliably than a missing field.

### `nextTool` is the field Bug 001 is about

Everything else describes a state and leaves the model to infer an action. This
names it. The names live in one table keyed by `PLANNING_STAGES`
([planning-tool-names.ts](../../src/tools/planning-tool-names.ts)) which the five
tool schemas now read their own names from — so the table and the tools cannot
drift, and a sixth stage without a tool fails to compile.

It promises nothing about **availability**: the host's broker still checks each
tool's `requires` against what the Automation MCP server serves, exactly as it
always has.

A stale stage is eligible — regenerating it is the fix — so after a Brief
revision `nextTool` points at the _repair_, not at the stage that went stale
beneath it.

### What it never carries

- **Nothing about proposals or approval.** This layer cannot observe them
  (ADR-AI-0002 Rule 2), and a fragment claiming otherwise would be inventing.
- **No UI labels.** `blockedBecause` carries an existing `PlanBlocker` message —
  a sentence the platform already writes for the user — and everything else is a
  stable identifier.
- **No instruction.** The fragment reports state. Telling a model what it must do
  belongs to a system prompt, which is the host's.
- **Nothing read from the model.** No prose is parsed anywhere in this path
  (ADR-0027.1 Rule 6). Detecting an unbacked claim would mean judging model
  output, which is the failure mode that rule exists to prevent; the mechanism
  used instead is to make the true state available so the right action is the
  easy one.

With no artefact reader wired, `design` reports five untouched stages and
`nextTool: 'planning_captureBrief'` rather than throwing — the configuration Bug
001 ran in, described accurately.

---

# Direct Execution — the other lane

Shipped since Sprint 24.5, untouched by everything above it, and the reason this
package emits `CommandRequest`s at all.

"Move the kitchen 500 mm north" states its own geometry. There is no programme
to write and no brief to approve, so it goes straight to the
`ArchitecturalPlanner`, which routes the recognised action to whichever
`ArchitecturalOperationProvider` declared it and returns an `ArchitecturalPlan`:
`PlanStep`s carrying Requests, preview geometry, assumptions, risk and affected
elements. [proposal-builder.ts](../../src/proposal/proposal-builder.ts) flattens
that into a `Proposal`, adding exactly one rule of its own — a plan touching more
than `BULK_STEP_THRESHOLD` elements is escalated to `destructive`, because
sixteen individually safe moves the user did not expect are not a safe change.

**Fifteen actions** are recognised: eight questions and seven modifications.
Six operation providers are registered, and they register exactly the way a
plugin's would — the planner has no privileged path.

| Provider        | Actions                                                          |
| --------------- | ---------------------------------------------------------------- |
| `move-room`     | `edit.moveRoom`                                                  |
| `rename-room`   | `edit.renameRoom`                                                |
| `wall-property` | `edit.setWallProperty`                                           |
| `align-walls`   | `edit.alignWalls`                                                |
| `delete`        | `edit.deleteSelection`                                           |
| `unsupported`   | `edit.resizeRoom`, `edit.addOpening` — refused with alternatives |

The last row is deliberate rather than missing. "Resize this room" is answered
with why it cannot be done directly — a room is the space its walls enclose —
and what to ask instead. An action with no provider at all is answered the same
way: "nothing can do this" is a plannable outcome, not an exception, and
throwing would turn a conversational dead end into an error dialog.

Missing information has one vocabulary everywhere: `PlanBlocker` with four
reasons — `missing-information`, `ambiguous`, `unsupported`, `nothing-to-do`.
Clarification questions are generated from blockers, not from a parallel
taxonomy.

---

# Building Knowledge — a facade, not a model

[BuildingKnowledge](../../src/understanding/building-knowledge.ts) is what this
layer knows about a project, which is to say: nothing of its own. Every method
delegates to a platform service that already owns the answer.

```text
BuildingKnowledge
  ├── BuildingService     concepts and relationships
  ├── SpatialService      rooms, areas, adjacency
  ├── InspectorService    what can be edited, and within what bounds (optional)
  └── QueryDispatcher     the document, through the Automation API
```

Nothing caches, indexes or reshapes. Every call reads through on demand, so a
reading taken before an approved proposal and one taken after cannot disagree,
and there is no refresh lifecycle to get wrong.

It never searches text. Resolving "the kitchen" walks the Spatial Model's rooms
and compares their names — the same names the Navigation panel shows and the
Inspector edits. There is no index, no document scan and no second naming
vocabulary.

`InspectorService` is optional; without it, `editableProperties` answers empty
and property edits become unplannable.

---

# The Skills relationship

Deterministic computation belongs to `@archisimple/skills`, and this layer is
its first consumer. No stage re-implements geometry, unit or spatial maths, and
no stage asks a language model to perform it.

| Skill                 | Called by                                       |
| --------------------- | ----------------------------------------------- |
| `allocateSpaceAreas`  | Space Programme synthesis                       |
| `assignStoreys`       | Layout synthesis                                |
| `resolveAdjacencies`  | Layout synthesis                                |
| `compareLayoutSpaces` | Layout synthesis                                |
| `scoreCirculation`    | Layout quality                                  |
| `packLayout`          | Geometry synthesis                              |
| `evaluatePacking`     | Geometry evaluation, and the invariant gate     |
| `sharedPolygonEdges`  | Geometry synthesis                              |
| `insertWallThickness` | Specification synthesis — thickness, per storey |
| `mergeColinearRuns`   | Specification synthesis — segments into walls   |
| `findJunctions`       | Specification synthesis and validation          |

The balance shifts downward over time on purpose. `computeLayoutQuality` still
does real work above the skill; `evaluateGeometryGraph` does almost none, because
the packing rules are exported as a conformance suite a plugin author can test
against without depending on this package at all.

---

# Extension points

Both register on the **same** `ArchitecturalPlanner`. There is no second
registry, and adding a capability extends one of these rather than introducing a
seventh.

**`ArchitecturalOperationProvider`** (Sprint 24.5) — one provider, one or more
architectural actions, registered by id. A duplicate id is an error, and so is
two providers claiming one action. The six built-in providers use this seam, so
a plugin's operation is their peer.

**`PlanningStageProvider`** (Sprint 28.3, ADR-0028) — enriches an artefact at one
of five stages: `brief`, `programme`, `layout`, `geometry`, `specification`. A stage is **not**
exclusive: several providers may enrich one, and they run in registration order.
Enrichment runs **before** the geometry invariant gate, so a provider that breaks
a clause is caught by the same check as a broken packer.

What a provider contributed is attributed. An enriched artefact carries the
ordered ids of the providers that touched it (`EnrichedArtefact.contributors`),
so a Programme that gained a 9 m height limit can say it came from
`urban-rules.setback` before the user approves anything. The field is absent
until something enriches, so an artefact from a host with no AI plugins is
byte-identical to a pre-28.3 one.

---

# Composition — one value, not three imports

A host receives an **`ArchitecturalIntelligenceContribution`**
([src/contribution.ts](../../src/contribution.ts)) rather than constructing this
capability by name: the service, the tool descriptions, the provider adapter,
the context provider and the Brief draft store, as one registrable value.

Since Sprint 30.1 the contribution builds its own `BuildingKnowledge` from the
semantic services the host already holds, so the host names no type from this
layer at all. In ArchiSimple exactly one file is permitted to name this package
(`apps/web/src/ai/intelligenceLoader.ts`), it reaches it through a dynamic
import, and the application builds and runs without it.

Three host ports are mirrored structurally rather than imported —
`PlanningArtefactReader`, `PlanningStageProvider`, `PlanningStageCapability` —
which is what lets a host satisfy them without depending on this package.

---

# Tools and the provider

**Nine tool definitions** describe, to a language model, how to reach the five
planning stages and the Building operations. They **describe**; they never
execute. Every one resolves to a `Proposal` or a blocked sentence.

`planning_captureBrief`, `building_moveRoom`, `building_renameRoom`,
`building_setWallProperty`, `building_alignWalls`, `planning_generateProgramme`,
`planning_generateLayout`, `planning_generateGeometry`,
`planning_generateSpecification` — offered in that order, because
`listFunctionSchemas` hands the order to a model and reordering it is a
behaviour change wearing a refactor's clothes. New tools append; they never
insert.

`planning_captureBrief` is the only one that takes fields, because a Brief is
built from what the user said and the model is what read it. The four
`planning_generate*` tools take no artefact: each reads the approved artefact
behind the service's artefact reader, never from the model's arguments. The
empty schema is that guarantee made structural — there is no field through which
a model could suggest a wall thickness.

The **Architectural Assistant** provider adapter is deterministic, offline and
synchronous. Its "model" is this service, driven by pattern matching rather than
inference; it calls no language model and needs no network. A real model
provider reaches the same planner through the same tools.

---

# Tests

| File                                         |   Tests |
| -------------------------------------------- | ------: |
| `architecture-compliance.test.ts`            |     245 |
| `workflow-state.test.ts`                     |      43 |
| `revision-lineage.test.ts`                   |      40 |
| `brief-lifecycle.test.ts`                    |      32 |
| `architectural-context.test.ts`              |      17 |
| `programme.test.ts`                          |      38 |
| `layout.test.ts`                             |      38 |
| `geometry.test.ts`                           |      35 |
| `specification.test.ts`                      |      33 |
| `brief.test.ts`                              |      33 |
| `operations.test.ts`                         |      24 |
| `intent-recognizer.test.ts`                  |      24 |
| `building-knowledge.test.ts`                 |      15 |
| `architectural-intelligence-service.test.ts` |      13 |
| `pipeline.test.ts`                           |       8 |
| **Total**                                    | **642** |

`pipeline.test.ts` runs the design pipeline through the real `AiSessionController`,
and `specification.test.ts` runs the full chain — utterance to Geometry
Specification — with no editor, no building model, no network and no approval
surface. `workflow-state.test.ts` walks all five stages one approval at a time
and asserts the projection after each, writing the approved artefact into the
reader itself — because there is no approval mechanism in this package to
invoke. `revision-lineage.test.ts` revises an approved Brief, watches staleness
propagate, regenerates each stage in turn and asserts one lineage per stage
throughout — the assertion that sprint exists for. `architectural-context.test.ts`
asserts what a _model_ is told, including that the fragment survives a JSON round
trip: a field that does not is a field the model never sees. That the reasoning is testable this way is a design property, not a
convenience.

`architecture-compliance.test.ts` is a static scan of the production sources,
parameterised per file, asserting the four structural claims above plus two the
geometry stages carry: **nothing under `src/geometry/` names `CommandRequest` or
imports `automation-api`** (ADR-AI-0001 Rule 1 — the design pipeline terminates
in an artefact), and the Geometry Graph's own files carry no wall thickness,
which is the Specification's to own. Sprint 1.2 added two more: **no production
source holds an `ArchitecturalWorkflowState` in a field, and none assigns
`workflowState()` to a binding** (ADR-AI-0002 Rule 1 — a cached projection
returns the right answer for every test that builds its project up front, and the
wrong one for a user who revised a brief an hour into a session). `__tests__/`
is excluded from the scan: its harness legitimately builds a recording
dispatcher to prove which Requests a plan would run.

---

# Repository, build and release

Standalone since Sprint 30.3. `npm`, not pnpm. `tsc -b` to `dist/`, one export
(`.`), `dist` the only published file, Node `>=20`.

`moduleResolution: NodeNext`, so relative imports carry `.js` in source — the
specifier names the emitted file. The same convention ArchiSimple adopted in
Sprint 30.0.

CI runs install → build → lint → test → **no-local-dependencies**, the last
being ADR-0030 Rule 4 asserted rather than trusted: a `workspace:`, `file:`,
`link:`, git or relative dependency would make "standalone" a description of
someone's laptop rather than a property of the repository. Publication is a
manual `workflow_dispatch`, never a side effect of merging.

**Release order (ADR-0030 Rule 8):** the platform releases first; this
repository consumes a released version. Publishing an intelligence that depends
on a platform version nobody can install fails at a consumer's `npm install`,
not in CI.

---

# What is not implemented

- **Artefact navigation.** The projection lists every revision of every stage;
  which one the user is _looking at_ is session state, and belongs to the host.
- **Diffing two revisions.** Both are readable and nothing computes a difference
  between them.
- **The pending proposal, in the workflow state.** By design, not by omission:
  approval state is session-scoped in `ai-engine` and this layer observes
  approval only as an artefact becoming readable (ADR-AI-0002 Rule 2).
- **Windows.** The Geometry Graph produces opening candidates only between two
  rooms, so there is no candidate in an external wall for a window to sit in.
  The Specification records this in its own assumptions rather than inventing
  them.
- **Load-bearing determination.** A wall's role is external or internal; which
  walls carry load needs a structural model this repository does not have, and
  guessing would be worse than declining.
- **Constraint optimisation** of an approved Geometry Graph. Sprint 1.3 gave
  `reviseGeometryGraph` a production caller — regeneration — but nothing revises
  a Graph in order to _satisfy a constraint_. ADR-0027.1 Rule 13 describes the
  stage; the sprint was never written.
- **Non-rectilinear room polygons.** The built-in packer produces axis-aligned
  rectangles, and `evaluatePacking` refuses shapes it cannot judge.
- **Room resize and opening insertion** as planned operations. Both actions are
  recognised and answered with an `unsupported` blocker and alternatives.
- **Any reasoning path that calls a language model.** The provider adapter is
  pattern matching; a model reaches this layer only through host-resolved tool
  calls, and no provider emits artefact JSON.
- **Sprint documents for the work that predates the extraction.**
  `docs/sprints/` holds Sprints 1.1 to 1.3 and nothing earlier; every sprint cited in
  source comments (24.5 through 30.3) is documented in the ArchiSimple
  repository.
- **A findings register of its own.** Source comments cite `I3`, `I7` and other
  `I-nn` findings that live in ArchiSimple's register.

---

# Needs verification

- Whether every `I-nn` cited in source comments still corresponds to an open
  finding in ArchiSimple's register.
- Which published version `apps/web` is currently composing (`0.1.1` is what
  this repository has published).
- Which ArchiSimple sprint documents should be mirrored or referenced here now
  that the code lives apart from them.
- Whether the optionality of `@archisimple/inspector` is exercised by any real
  consumer, or only by tests.
