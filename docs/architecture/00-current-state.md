# Architectural Intelligence — Current State Architecture

**Generated:** 2026-08-09, from the implementation at commit `248d60d` plus Sprint 1.1
**Package:** `@archisimple/architectural-intelligence` `0.1.1`
**Companion:** [00-current-state.yaml](00-current-state.yaml) — the same facts, machine-readable

This document describes **what is implemented**. Anything that appears only in
an ADR, a sprint document or a comment about future work belongs in
_What is not implemented_ at the end, and it is there. Source code wins over
this document.

Verified for this snapshot rather than assumed: `tsc -b` builds clean,
`eslint .` reports nothing, and `vitest run` passes **492 tests across 11
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

10,334 lines of production TypeScript across ten directories, published as one
ES module with a single entry point.

Two things reach a host from here:

- **Five planning artefacts** — Architectural Brief, Space Programme, Layout
  Plan, Geometry Graph, Geometry Specification — each separately reviewed and
  approved, each immutable once approved, each carrying provenance for the one
  above it.
- **One `ArchitecturalPlan`** carrying Automation `CommandRequest`s, for
  requests that state their own geometry and need no design pipeline at all.

Since Sprint 1.1 the design pipeline is **complete**: it ends at the Geometry
Specification, a CAD-independent description carrying wall thickness, height,
centrelines and dimensioned openings — everything a consuming application needs
to build the design without taking a single architectural decision of its own
(ADR-AI-0001). What happens after that is somebody else's repository.

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

# The front door: six lanes

`ArchitecturalIntelligenceService.interpret` classifies one utterance
**deterministically, host-side, before any provider is consulted**, and routes
it into one of six lanes ([src/brief/request-classification.ts](../../src/brief/request-classification.ts)):

| Lane                     | Produces                         | Reachable only when             |
| ------------------------ | -------------------------------- | ------------------------------- |
| `direct-execution`       | `ArchitecturalPlan` → `Proposal` | always                          |
| `brief-generation`       | `ArchitecturalBrief`             | enough was said to write one    |
| `clarification-required` | one focused question             | a mandatory topic is unanswered |
| `programme-generation`   | `SpaceProgramme`                 | an approved Brief exists        |
| `layout-generation`      | `LayoutPlan`                     | an approved Programme exists    |
| `geometry-generation`    | `GeometryGraph`                  | an approved Layout exists       |

The three artefact lanes are gated on what the project has actually approved,
read through an optional `PlanningArtefactReader` the host supplies. A host that
supplies none classifies exactly as it did before those lanes existed: "show me
the spaces" with no Brief behind it is a question about a project, not a
programme request, and stays where it has always been.

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
| `architecture-compliance.test.ts`            |     231 |
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
| **Total**                                    | **492** |

`pipeline.test.ts` runs the design pipeline through the real `AiSessionController`,
and `specification.test.ts` runs the full chain — utterance to Geometry
Specification — with no editor, no building model, no network and no approval
surface. That the reasoning is testable this way is a design property, not a
convenience.

`architecture-compliance.test.ts` is a static scan of the production sources,
parameterised per file, asserting the four structural claims above plus two the
geometry stages carry: **nothing under `src/geometry/` names `CommandRequest` or
imports `automation-api`** (ADR-AI-0001 Rule 1 — the design pipeline terminates
in an artefact), and the Geometry Graph's own files carry no wall thickness,
which is the Specification's to own. `__tests__/`
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

- **A classification lane** for the Specification. `REQUEST_LANES` has six
  values and `classifyRequest` has no `hasApprovedGeometry` gate: Sprint 1.1
  reaches the stage through the tool and the service, not through an utterance.
  **Sprint 1.2.**
- **Staleness reporting.** `matchesGeometryGraph` makes a stale Specification
  detectable and `generateSpecification` uses it to decide revision-versus-new,
  but nothing tells the user their specification no longer matches the geometry
  (ADR-0027.1 Rule 12). **Sprint 1.2.**
- **Windows.** The Geometry Graph produces opening candidates only between two
  rooms, so there is no candidate in an external wall for a window to sit in.
  The Specification records this in its own assumptions rather than inventing
  them.
- **Load-bearing determination.** A wall's role is external or internal; which
  walls carry load needs a structural model this repository does not have, and
  guessing would be worse than declining.
- **A seventh lane** reaching it. `REQUEST_LANES` has six values and
  `classifyRequest` has no `hasApprovedGeometry` gate. **Sprint 1.2.**
- **Constraint optimisation** of an approved Geometry Graph. `reviseGeometryGraph`
  exists as its entry point and nothing in the production sources calls it —
  of the four `revise*` functions, only `reviseBrief` has a production caller
  (brief assembly, folding a clarification answer into a draft). ADR-0027.1
  Rule 13 describes the stage; the sprint was never written.
- **Non-rectilinear room polygons.** The built-in packer produces axis-aligned
  rectangles, and `evaluatePacking` refuses shapes it cannot judge.
- **Room resize and opening insertion** as planned operations. Both actions are
  recognised and answered with an `unsupported` blocker and alternatives.
- **Any reasoning path that calls a language model.** The provider adapter is
  pattern matching; a model reaches this layer only through host-resolved tool
  calls, and no provider emits artefact JSON.
- **Sprint documents for the work that predates the extraction.**
  `docs/sprints/` holds Sprint 1.1 and nothing earlier; every sprint cited in
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
