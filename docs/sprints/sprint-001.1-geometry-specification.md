# Sprint 1.1 — Geometry Specification

> **Status:** Planned
>
> **Version:** 1.0
>
> **Repository:** `architectural-intelligence`
>
> **Related ADRs:** ADR-AI-0001 (revision 2.0), ADR-0031 (ArchiSimple), ADR-0027.1 (revision 2.3), ADR-0027, ADR-0030
>
> **Prerequisites:** Sprint 30.3 (extraction) — and **one ArchiSimple platform release**, see _Architecture Prerequisites_
>
> **Next Sprint:** 1.2 — End-to-End Reasoning

---

# Sprint Design Contract

Every sprint extends the existing architecture. The authoritative source is
[docs/architecture/00-current-state.md](../architecture/00-current-state.md),
generated 2026-08-09 at `248d60d`. Where this sprint conflicts with it, this
sprint is wrong.

This sprint MUST NOT: recreate an artefact, add a second approval surface, add a
second registry, add a second execution path, or re-implement geometry
mathematics that `@archisimple/skills` owns.

It extends four existing seams and adds no new kind of thing:

| Existing seam                             | How this sprint uses it                          |
| ----------------------------------------- | ------------------------------------------------ |
| The artefact + provenance + revision shape | A fifth artefact, built exactly like the fourth   |
| `Proposal` / `approveProposal`             | One more artefact through the same gate           |
| `gateGeometryGraph`'s invariant gate       | The same pattern, one stage down                  |
| `ToolDefinition`                           | A ninth tool, appended                            |

---

# Why this is Sprint 1.1

This repository was extracted from the ArchiSimple monorepo in **Sprint 30.3**
(ADR-0030). Its implementation history up to that point — Sprints 24.5 through
30.3 — is documented in the ArchiSimple repository and is cited that way
throughout the source.

From here the repository keeps **its own** sprint numbering, starting at 1.1.
Code written by this sprint cites `Sprint 1.1` and code written before it
continues to cite the ArchiSimple numbers. Both are correct; the discontinuity
is the extraction, and it is recorded here so a reader who meets `Sprint 28.1a`
three lines above `Sprint 1.1` knows why.

---

# Current State

Four planning artefacts are implemented, each separately approved, immutable
once approved, and carrying provenance for the one above it:

```text
Architectural Brief → Space Programme → Layout Plan → Geometry Graph
```

The Geometry Graph is the first stage where coordinates exist. Room polygons
bound the **finished face** of each space; wall candidates are the edges two
polygons share; opening candidates name where a candidate must be crossed.

It owns **no thickness, no height, and nothing buildable**. The
`ArchitecturalPlan` that carries `CommandRequest`s belongs to the Direct
Execution lane, not to this pipeline.

436 tests pass across 10 files; `tsc -b` and `eslint .` are clean.

---

# Why

Wall thickness, finished-face offsets, wall centrelines, opening dimensions and
wall height currently belong **nowhere**.

Leaving them to the consuming application means every CAD host invents its own
architectural interpretation, two hosts build different buildings from the same
approved design, and the user approves room areas that construction then
silently reduces. ADR-AI-0001 exists to prevent exactly that, and Rule 3 places
those decisions here: they follow from construction type, load-bearing role,
separation requirements and what the Brief said — facts that exist only in this
repository.

This sprint adds the fifth and final design artefact:

```text
Architectural Brief → Space Programme → Layout Plan → Geometry Graph → Geometry Specification
```

The reasoning pipeline is complete once it exists. Everything below it —
translation, build plan, commands, model — is ArchiSimple's (ADR-0031).

---

# Architecture Prerequisites

## The blocking one: geometric realisation skills, released

The algorithms this sprint needs — thickness insertion, centreline derivation,
colinear run merging, junction classification — **do not exist yet**, in either
repository. They belong in `@archisimple/skills`, which lives in ArchiSimple and
arrives here as a `peerDependency` at `^0.1.0`.

Two rules make that placement non-negotiable, and the second is the decisive one:

- **ADR-0027.1 Rule 9 / ADR-AI-0001 Rule 11.** Deterministic computation belongs
  to Skills. No stage re-implements geometry maths.
- **ADR-0031 Rule 1.** ArchiSimple's Geometry Translator **may not import this
  package**. If junction and centreline maths lives in `src/geometry/` here, the
  translator has to reimplement it — two implementations of the same geometry on
  opposite sides of the contract, which is the duplication the contract exists to
  remove. In Skills, both sides call one.

So, in ADR-0030 Rule 8's order, **before this sprint starts**:

1. An ArchiSimple sprint adds the realisation skills below to
   `packages/skills/src/geometry-realisation/`, with the exhaustive tests that
   directory's rectangle predicates already set the standard for.
2. ArchiSimple bumps and releases the platform — **`0.2.0`**.
3. This repository raises its `peerDependencies` (and `devDependencies`) to
   `^0.2.0` as this sprint's first commit.

| Added                                | Answers                                                              |
| ------------------------------------ | -------------------------------------------------------------------- |
| `insertWallThickness` (a **Skill**)  | Given rectilinear finished-face polygons and a thickness per wall line: the repositioned polygons, **the wall centrelines**, and how much the envelope grew |
| `mergeColinearRuns`                  | Adjacent colinear segments of equal thickness, as one run, carrying the ids it merged |
| `classifyJunction`                   | Whether wall ends meet as a corner, a tee, a cross or a continuation, and where |

Three, not four: after rail equalisation the rail **is** the centreline, so
`insertWallThickness` returns them and no separate derivation exists to disagree
with it. ArchiSimple Sprint 31.0 specifies all three and the release.

Nothing else in this sprint depends on an ArchiSimple change. The i18n artefact
label is a follow-up, not a prerequisite — see _Known Follow-Ups_.

## What is already available

`geometry-realisation/` already ships `boundsOf`, `cornersOf`, `isRectilinear`,
`sharedEdge`, `edgesOf`, `polygonEdges`, `isSimpleRectilinear`,
`isStrictlyInside`, `polygonsOverlap`, `interiorPoint`, `sharedPolygonEdges`,
`packLayout`, `evaluatePacking` and `runPackingConformance`. The new skills sit
beside them and reuse them.

---

# Goal

Architectural Intelligence transforms user intent into a **complete, validated,
CAD-independent Geometry Specification**, and stops there.

---

# The Geometry Specification Contract

## What it owns

| Owns                                        | Never owns                          |
| ------------------------------------------- | ----------------------------------- |
| Wall thickness                              | Topology nodes                      |
| Wall role (external, internal, partition)   | Wall joins and mitres               |
| Wall centrelines                            | Host entity identifiers             |
| Wall height, storey height                  | `CommandRequest`s                   |
| Colinear wall runs                          | Transactions, undo grouping         |
| Opening kind, position, width, height, sill | Persistence of a built model        |
| Space boundaries, after thickness insertion | Selection or editor state           |
| Metric conventions, stated explicitly       | An architectural decision left open |

The line is geometry versus topology. A centreline with a thickness is
architecture. The node where three of them meet is a data structure, and which
data structure depends entirely on the CAD system (ADR-AI-0001, ownership table).

## Fully resolved, always

Every coordinate is a number (ADR-AI-0001 Rule 4). `constraints` records **why**
a wall sits where it does and is never an instruction a consumer must solve — a
consumer that runs a solver is doing architectural reasoning, which ADR-0031
forbids it. Anything unresolvable becomes a blocker or a warning, never a
constraint shipped forward.

---

# The Thickness Insertion Contract

**The hardest problem in this sprint, and the one that decides whether approved
areas survive it.**

## The problem

A Geometry Graph polygon bounds the finished face of a space, and packing
invariant `I2` permits polygons to touch. The built-in slicing-tree packer
produces exactly that: adjacent rooms share an edge with **zero** room for a
wall between them.

Inserting a wall of thickness `t` therefore has two possible answers:

- **Shrink the rooms.** The envelope is unchanged and every room loses `t/2` on
  each internal side. Rejected: ADR-0027.1 states it directly — the areas the
  user approved would be systematically under-delivered by a stage they never
  saw. A 12 m² bedroom would silently become 11.6 m².
- **Push the rooms apart.** Every room keeps its exact dimensions and the
  **building grows**. Accepted. It is a visible change to approved geometry
  rather than a silent shortfall.

## The decision

**No room shrinks. The envelope grows.**

Most rooms keep their dimensions exactly. A room that *spans* a wall line
inserted across it — a hall running under three rooms separated by two internal
walls — absorbs those walls and grows, because a 9 m hall and a 9.2 m row above
it cannot both hold. Preserving every dimension is over-determined, and
ArchiSimple Sprint 31.0's `insertWallThickness` resolves it by growing rather
than shrinking, reporting every room it stretched.

The growth is reported: the Specification records the storey envelope before and
after, and the total growth, in `assumptions`. Where the Brief stated a total
area or a site constraint that the grown envelope now exceeds, that is a
**warning** — visible on the review card, not a blocker, because the user is
looking at the number and can revise the Programme if they disagree.

## Rail equalisation — how

Per axis, independently, and deterministically.

1. **Rails.** Group polygon edges that are colinear and connected into wall
   lines. Each rail is one variable: its centreline coordinate.
2. **Constraints.** For a room bounded by rails `L` and `R` with thickness
   `t(L)` and `t(R)`, its width is preserved exactly:
   `x(R) − x(L) = width + t(L)/2 + t(R)/2`.
3. **Solve.** Propagate from the minimum rail outward. The rectilinear dissection
   the packer produces yields a consistent system; solve it by traversal, not by
   search, so the same Geometry Graph always produces the same Specification.
4. **Inconsistency is a blocker**, never a nudge. A rectilinear arrangement whose
   constraints cannot all hold — two paths to the same rail disagreeing beyond
   the stated precision — produces a `PlanBlocker`, not an approximation.

This preserves every `achievedArea` from the Geometry Graph exactly, which is
what makes the Specification's areas checkable against the artefact above it.

## Invariants

`S1`–`S7`. A Specification violating one is malformed and is never offered
(Epic 3's gate refuses it).

1. **`S1` No space is under-delivered.** Every space's boundary area is greater
   than or equal to its Geometry Graph polygon's `achievedArea`, within the
   stated precision. Spaces that grew are named, with the amount, in
   `assumptions` — `insertWallThickness` reports them as `stretched`.
2. **`S2` Wall separation.** No two space boundaries touch or overlap. Every pair
   that shared an edge is now separated by exactly the thickness of the wall
   between them.
3. **`S3` Completeness.** Every wall candidate becomes at least one wall; every
   opening candidate becomes exactly one opening. Nothing is dropped.
4. **`S4` Coincidence.** Wall centreline endpoints that meet do so within the
   stated precision — the guarantee ADR-0031 Rule 3 lets the translator build on,
   so its merge is mechanical rather than interpretive.
5. **`S5` Openings fit.** Every opening lies wholly within its wall, is narrower
   than the wall run, and its head is below the wall height.
6. **`S6` Simple boundaries.** Every space boundary is closed, non-self-intersecting
   and rectilinear, as one stage up.
7. **`S7` Determinism.** No clock, no random source, no insertion-order
   dependency. The same Geometry Graph and the same defaults always produce the
   same Specification.

Envelope growth is deliberately **not** an invariant. It is a reported fact.

---

# Where the numbers come from

Nothing here may be invented silently. Every default is recorded in
`assumptions`, in the sentence a reviewer reads.

| Decision           | Source in this sprint                                             |
| ------------------ | ----------------------------------------------------------------- |
| External thickness | Default table, keyed by nothing yet — one value, stated            |
| Internal thickness | Default table                                                     |
| Partition thickness| Default table                                                     |
| Wall role          | `WallCandidate.external` → external; everything else internal      |
| Wall height        | Storey height minus slab allowance, from the default table        |
| Storey height      | Default table; storey elevations come from the Geometry Graph      |
| Opening kind       | `OpeningCandidate.reason` and the two spaces it connects          |
| Opening width      | Default per kind                                                  |
| Opening height     | Default per kind                                                  |
| Sill height        | Default per kind (zero for doors and passages)                     |
| Opening position   | Centred on the shared run, unless that would violate `S5`          |

**Load-bearing determination is out of scope.** A wall's role is external or
internal, and nothing in this sprint decides which walls carry load. That needs
a structural model this repository does not have, and guessing it would be worse
than declining it.

The defaults table is one module with one exported shape, so the sprint that
gives it a knowledge model replaces one thing.

---

# Epics

The order below is the dependency chain, and it is the order to build in.

## Epic 1 — The Geometry Specification artefact

### Story 1.1.1 — The model

Create `src/geometry/geometry-specification.ts` following
[geometry-graph.ts](../../src/geometry/geometry-graph.ts) exactly.

- `GEOMETRY_SPECIFICATION_KIND = 'geometry-specification'`
- `GEOMETRY_CONTRACT_VERSION = '1.0.0'` — semantic, independent of the package
  version, and the field a consumer checks (ADR-AI-0001 Rule 8)
- `MetricConventions` — unit (`metre`), precision (`0.001`), coordinate origin,
  polygon winding, elevation datum. Stated in the artefact, because a consumer
  outside this project has no `CLAUDE.md` to read them from (Rule 5)
- `GeometryProvenance` — `geometryGraphId` **and** `geometryGraphRevision`
- `SpecifiedStorey` — index, elevation, height
- `SpecifiedSpace` — id, `spaceId`, name, storey, boundary, area
- `SpecifiedWall` — id, storey, centreline, thickness, role, height, `separates`
- `SpecifiedOpening` — id, `wallId`, kind, distance along wall, width, height,
  sill, `connects`
- `GeometryConstraintRecord` — provenance only, never instructions
- `extends EnrichedArtefact`, so a stage provider's contribution is attributed
- `assumptions`, `warnings`

**Identifiers are stable across revisions** wherever the element survives: a wall
that only changed thickness keeps its id. Nothing in ArchiSimple's first
translator depends on that, and everything about incremental execution later
does.

### Story 1.1.2 — Lifecycle helpers

Mirroring the four artefacts above, and no new shape:

- `createGeometrySpecification()`
- `reviseGeometrySpecification()` — same identity, incremented revision, nothing
  mutated (ADR-AI-0001 Rule 9)
- `isGeometrySpecificationComplete()`
- `matchesGeometryGraph(spec, graph)` — id **and** revision, the twin of
  `matchesLayout` (Rule 6)
- `summarizeGeometrySpecification()` — the markdown the review card renders

### Story 1.1.3 — Proposal support

- `toGeometrySpecificationProposal()` and `describeSpecification()`, twins of
  `toGeometryProposal` / `describeGeometry`.
- **Rename** the existing `toGeometryProposal` → `toGeometryGraphProposal`, so
  every factory is named after the artefact it wraps rather than after the
  envelope. A `0.x` public-API rename; note it in the release notes.

The proposal's `expectedOutcome` says what approval actually does: the
Specification is recorded with the project. **No walls are built by this
repository, ever.**

---

## Epic 2 — Synthesis

### Story 1.1.4 — Consume the realisation skills

Raise `peerDependencies` and `devDependencies` to `^0.2.0`. This story is the
gate: it does not start until the platform release in _Architecture
Prerequisites_ has happened.

### Story 1.1.5 — The defaults table

One module, one exported shape, every value recorded as an assumption when used.
See _Where the numbers come from_.

### Story 1.1.6 — Thickness insertion and wall synthesis

`src/geometry/specification-synthesis.ts` — the one place a Specification is
built. It orchestrates; it computes nothing itself:

1. Assign a role and a thickness to every wall candidate.
2. `insertWallThickness` — rail equalisation, per axis. Returns the repositioned
   polygons **and** the centrelines, since the rail is the centreline.
3. `mergeColinearRuns` for walls of equal thickness and role.
4. Recompute space boundaries from the separated polygons; assert `S1`.
5. `classifyJunction` at every meeting point; assert `S4`.

It **never redesigns the Geometry Graph.** No space is added, removed, moved
between storeys or reshaped. If the arrangement is wrong, the Graph is revised —
a different artefact, a different approval, a different stage.

### Story 1.1.7 — Opening synthesis

Turn every opening candidate into a positioned, dimensioned opening from the
defaults table, centred on the shared run unless `S5` forbids it. Where a
candidate's wall run is too short for the default width, narrow it to fit and
warn — a door that does not fit is a fact the user should see.

### Story 1.1.8 — Provenance and envelope reporting

Carry `sourceGeometry`. Record the envelope before and after insertion, and the
growth, in `assumptions`; warn where a stated total area is now exceeded.

---

## Epic 3 — Validation and the gate

### Story 1.1.9 — `validateGeometrySpecification()`

Returns `PlanBlocker[]` from `PLAN_BLOCKER_REASONS` — the single vocabulary
(ADR-0027.1 Rule 8). Self-intersecting boundaries, openings wider than their
wall, walls that do not meet within tolerance, storey mismatches, unsolvable rail
constraints.

Exported from the package index, because ADR-0031 Rule 4 makes a translator
rejection a **defect in this repository**, not a user-facing workflow: the
Specification must catch its own malformations before approval.

### Story 1.1.10 — `gateGeometrySpecification()`

The `gateGeometryGraph` pattern, one stage down. The evaluation runs over the
produced artefact **before it is offered**, whichever strategy produced it, and a
violated invariant is a hard failure naming the clause, with no proposal.

Enrichment by a `PlanningStageProvider` runs **before** the gate, so a provider
that breaks `S1` is caught by the same check as a broken synthesis.

The gate is what makes the guarantee true for a strategy nobody here wrote. A
suite proves the built-in synthesis upholds the contract; the moment a plugin
ships, a card asserting "every structural requirement holds" would be repeating
a fact nobody checked.

---

## Epic 4 — Reachability and revision

### Story 1.1.11 — The tool

`createSpecificationToolDefinition` — `planning_generateSpecification`, taking
**no arguments**, appended **after** `planning_generateGeometry` in
`contribution.ts`. There is no field through which a model could suggest a
thickness.

Order matters: `listFunctionSchemas` hands it to a model, so a reordering is a
behaviour change wearing a refactor's clothes. Append; never insert.

Blocked when no approved Geometry Graph exists, the way the geometry tool is
blocked without a Layout.

### Story 1.1.12 — Service entry points

`approvedGeometry()` and `generateSpecification(graph)` on
`ArchitecturalIntelligenceService`, twinning `approvedLayout()` /
`generateGeometry()`.

**No new classification lane in this sprint.** The tool path reaches the service
directly, exactly as the geometry tool does; the seventh `REQUEST_LANES` value
and the conversational route belong to Sprint 1.2.

### Story 1.1.13 — Production revision

Every artefact above this one has `revise*` exported and **only tests call it**.
This sprint ends that for the Specification: calling `generateSpecification`
when the project already has an approved Specification for the same Geometry
Graph produces **revision n+1** through `reviseGeometrySpecification`, offered
through the same proposal workflow — not a second artefact at revision 1.

That is the cheapest honest production path to Rule 9, and it removes a real
bug: re-running generation after approval must not silently fork the artefact.

---

## Epic 5 — Compliance and documentation

### Story 1.1.14 — Compliance assertion

Extend `architecture-compliance.test.ts` with ADR-AI-0001 Rule 1: **no file
under `src/geometry/` imports `CommandRequest`**. The design lane terminates in
an artefact, and this is what keeps that structural rather than remembered. The
Direct Execution lane is untouched and its `CommandRequest` usage stays legal.

### Story 1.1.15 — Documentation

- `docs/architecture/00-current-state.md` and `.yaml` — move the Geometry
  Specification out of `notImplemented`, add the fifth artefact, the new skills,
  the ninth tool, the new test counts.
- `README.md` — the completed pipeline.
- ADR-AI-0001 — status of the contract version, if the schema drifted from the
  sketch during implementation.

---

# Architecture Changes

| Change                                    | Where                                         |
| ----------------------------------------- | --------------------------------------------- |
| Fifth artefact kind                       | `src/geometry/geometry-specification.ts`      |
| Synthesis                                 | `src/geometry/specification-synthesis.ts`     |
| Validation and gate                       | `src/geometry/specification-validation.ts`    |
| Defaults                                  | `src/geometry/construction-defaults.ts`       |
| Ninth tool                                | `src/tools/specification-tools.ts`            |
| Renamed factory                           | `toGeometryProposal` → `toGeometryGraphProposal` |
| Peer range                                | `^0.1.0` → `^0.2.0`                           |
| Four new skills                           | ArchiSimple, released first                   |

No new registry, no new approval surface, no new store, no change to
`ai-engine`, no change to the project file version. The planning section is
opaque and keyed by artefact kind, so a fifth kind round-trips at file version 3
with no migration — the same property that let 27.9, 28.0 and 28.1a each add one.

---

# Out of Scope

- Build Plan, Geometry Translator, command generation, model construction —
  ArchiSimple, ADR-0031.
- **New** Automation API integration. (The package keeps its existing
  `automation-api` peer dependency, and the Direct Execution lane keeps emitting
  `CommandRequest`s. Neither changes.)
- A classification lane for the Specification, and the conversational
  end-to-end — Sprint 1.2.
- Load-bearing determination, structural reasoning, materials.
- Non-rectilinear geometry. Rail equalisation assumes the rectilinear dissection
  the packer produces, and refuses anything else rather than approximating it.
- Constraint optimisation of the Specification. Revision is the mechanism; an
  optimiser is a later sprint.
- Incremental or partial execution, and any user-interface change.

---

# Testing Strategy

| What                                | How                                                              |
| ----------------------------------- | ---------------------------------------------------------------- |
| `S1`–`S7`                           | A conformance suite over synthesised Specifications, in the shape `runPackingConformance` set |
| Area preservation                   | Property test: every space's area equals its Graph polygon's `achievedArea` |
| Determinism (`S7`)                  | Same Graph twice, deep-equal but for `id` and `createdAt`         |
| Envelope growth                     | A two-room graph, exact expected envelope                         |
| Rail inconsistency                  | A hand-built inconsistent dissection → `PlanBlocker`, not an approximation |
| Openings                            | Default fit, narrow-to-fit with warning, refusal when impossible  |
| The gate                            | A deliberately broken synthesis is refused with the clause named  |
| Revision                            | Generate, approve, generate again → revision 2, one artefact      |
| Compliance                          | No `CommandRequest` under `src/geometry/`                         |
| End to end                          | `pipeline.test.ts` extended: utterance → Brief → Programme → Layout → Graph → Specification, with no editor and no network |

---

# Definition of Done

- [ ] Platform released at `0.2.0` with the four realisation skills; peer range raised here.
- [ ] `GeometrySpecification` exists as a first-class artefact with contract version, conventions, provenance and stable ids.
- [ ] Synthesised from an approved Geometry Graph, deterministically.
- [ ] `S1`–`S7` hold, asserted by a conformance suite, and enforced by `gateGeometrySpecification()` on every strategy.
- [ ] Every default is recorded in `assumptions`; envelope growth is reported; an exceeded stated total warns.
- [ ] Offered through the existing `Proposal` and approved through `approveProposal`. No second surface.
- [ ] `validateGeometrySpecification` is exported and produces `PlanBlocker`s.
- [ ] `planning_generateSpecification` appended last; existing tool order unchanged.
- [ ] **Production revision demonstrated**: regenerating over an approved Specification yields revision 2.
- [ ] Nothing under `src/geometry/` imports `CommandRequest`, asserted.
- [ ] `tsc -b`, `eslint .` and `vitest run` all pass; the end-to-end test reaches the Specification.
- [ ] `00-current-state.{md,yaml}` updated with what actually shipped, and only that.

---

# Known Follow-Ups

Not this sprint, and named so they are not forgotten:

- **The ArchiSimple i18n artefact label**
  (`ai.workspace.proposal.artefact.geometry-specification`). Sprint 28.1a shipped
  without its label and reviewed a Geometry Graph under a card headed "The
  brief". Host-side, one line, and it must land in the ArchiSimple release that
  follows this sprint.
- **`apps/web`'s `optionalDependencies`** pointing at the version this sprint
  publishes (ADR-0030 Rule 8, step 3).
- **Sprint 1.2** — the classification lane, the offline provider path, staleness
  and divergence when a Graph is revised under an approved Specification, and the
  conversational end-to-end.
- **ArchiSimple's translator sprints** — Geometry Translator, Build Plan, apply
  commands (ADR-0031).

---

# Architecture After This Sprint

```text
User Intent
     ↓
Architectural Brief
     ↓
Space Programme
     ↓
Layout Plan
     ↓
Geometry Graph
     ↓
Geometry Specification        ← the design pipeline ends here
     ╎
     ╎ public contract, versioned, restated structurally
     ▼
Build Plan                    (ArchiSimple, ADR-0031)
     ↓
Automation API
     ↓
Building Model
```

Architectural reasoning is complete. A Building Assistant will orchestrate this
pipeline; it introduces no additional reasoning, and no additional stage.

---

# Revision History

| Revision | Date       | Change            |
| -------- | ---------- | ----------------- |
| 1.0      | 2026-08-09 | Initial proposal. |
