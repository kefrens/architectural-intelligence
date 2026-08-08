# CLAUDE.md — @archisimple/architectural-intelligence

Guidance for Claude Code when working **inside this package**. The repository's
root [CLAUDE.md](../../CLAUDE.md) still applies; this narrows it.

This is **layer 4** — the reasoning half of the AI platform. It reads the
semantic layer, plans, and emits `CommandRequest`s. It owns no state, and it
executes nothing.

---

## Three facts that are enforced, not encouraged

[`src/__tests__/architecture-compliance.test.ts`](src/__tests__/architecture-compliance.test.ts)
statically scans every production source and fails CI on any of these:

1. **No `@archisimple/core`.** This layer reaches the document only through the
   Automation API (ADR-0023 Rule 1).
2. **No `CommandDispatcher`** — held, imported, or called. A plan _carries_
   Requests; `AiSessionController` is what runs them. "No Runtime modification
   occurs during reasoning" is a structural fact here, not a convention.
3. **No `@archisimple/automation-mcp`**, and no dispatcher stood up locally. One
   execution pipeline, not two.

`__tests__/` is excluded, because the harness legitimately builds a recording
dispatcher to prove which Requests a plan _would_ run.

### The dependency allow-list is exactly seven

```
@archisimple/ai-engine      @archisimple/automation-api   @archisimple/building-model
@archisimple/inspector      @archisimple/shared           @archisimple/skills
@archisimple/spatial
```

Adding an eighth fails both the compliance test and `pnpm depcruise`
(`architectural-intelligence-deps`). If you need something that isn't here, that
is a design signal — say so rather than widening the list.

---

## The pipeline (ADR-0027.1)

**Architectural Brief → Space Programme → Layout Plan → Geometry Graph**

Each is a reviewable, approvable artefact persisted in project file version 3.
The first three own **no geometry at all**. The fourth is where coordinates begin
and still owns no wall thickness.

Turning an approved Geometry Graph into walls (the Geometry _Plan_) is **not
implemented**. If a task seems to need it, it doesn't exist yet — say so.

### The rules that bite here most

| Rule | In one line                                                                       |
| ---- | --------------------------------------------------------------------------------- |
| 2    | High-level intent never becomes geometry directly.                                |
| 3    | One responsibility per artefact — a Brief with coordinates is malformed.          |
| 4    | Approved artefacts are immutable; change = new revision.                          |
| 6    | **The host assembles the artefact.** Nothing is parsed out of model prose.        |
| 7    | One approval mechanism: `Proposal` + `AiSessionController.approveProposal`.       |
| 8    | One vocabulary for missing information: `PlanBlocker` / `PLAN_BLOCKER_REASONS`.   |
| 9    | Deterministic computation belongs to Skills, never to the model.                  |
| 10   | Stage providers register on the **existing** planner — never a new registry.      |
| 13   | Optimisation revises an artefact; it never adds a stage or reads the stage above. |

**Derived facts are recomputed, not stored.** Layout quality and packing
evaluation are deliberately absent from their artefacts, because a stored verdict
goes stale the moment a later revision lands. Resist adding one.

---

## Layout

| Path                                    | What lives there                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `architectural-intelligence-service.ts` | The service. `interpret`, `generate{Programme,Layout,Geometry}`, `approved*`, provider registration. |
| `brief/`                                | Stage 1, plus `request-classification.ts` — the six lanes.                                           |
| `programme/` · `layout/` · `geometry/`  | Stages 2–4. Synthesis and evaluation.                                                                |
| `planning/`                             | `ArchitecturalPlanner`, `planning-stage.ts`, `architectural-plan.ts`.                                |
| `planning/operations/`                  | `ArchitecturalOperationProvider` implementations.                                                    |
| `artefacts/`                            | Artefact reading and enrichment plumbing.                                                            |
| `intent/` · `understanding/`            | Intent recognition; `BuildingKnowledge`.                                                             |
| `proposal/` · `provider/` · `context/`  | Proposal building, the provider adapter, context contribution.                                       |

### Classification is deterministic and host-side

[`brief/request-classification.ts`](src/brief/request-classification.ts) sorts an
utterance into one of six lanes **before any provider is consulted**. The three
stage lanes are each gated on approval state (`hasApprovedBrief`,
`hasApprovedProgramme`, `hasApprovedLayout`), so they are unreachable for a caller
that has not opted in. That gating _is_ the pipeline's sequencing — there is no
orchestrator object, and adding one would be a new execution path.

---

## Service + Provider + Registry — the sixth implementation

`ArchitecturalPlanner` / `ArchitecturalOperationProvider` is the odd one out on
purpose: providers contribute **capability** (how to plan an action) rather than
data, which is why they register with a planner.

`PlanningStageProvider` registers on that **same** planner rather than creating a
registry of its own. A stage is not exclusive — several providers may enrich one,
and they run in registration order, each seeing what the previous produced.

> A new capability extends one of these. It does not add a registry.
> (ADR-0025, ADR-0027.1 Rule 10)

Since Sprint 28.3 (ADR-0028) both seams are reachable from installed packages.
Contributed providers get **plain frozen data and no execution seam** — no
dispatcher, no `Proposal`, no document handle. Never widen that.

---

## What is deliberately not here

- **Packing.** `packing-strategy`, `packing-evaluation` and `packing-conformance`
  live in `@archisimple/skills` (`src/geometry-realisation/`). This package
  _consumes_ them. It never reimplements geometry, spatial or unit maths
  (ADR-0027).
- **Provider networking and credentials.** All of it is in `apps/ai-service`
  (ADR-0026). This package exports a provider _adapter_; it orchestrates no
  providers and must acquire no network dependency.
- **Any UI.** No React, no Three.js, anywhere below `apps/`.
- **State.** Rooms are derived, areas are computed. Nothing is cached beside the
  thing it was derived from.

---

## Commands

```bash
pnpm --filter @archisimple/architectural-intelligence test
pnpm --filter @archisimple/architectural-intelligence build
pnpm depcruise          # run before declaring any structural change done
```

`tsc -b` project references. Never hand-edit `dist/` or `*.tsbuildinfo`.

---

## In flight — ADR-0029 (not yet true)

Two sprints change how this package is _reached_, never what it is:

- **29.1** — `apps/web` stops importing this package. The service, the four
  `planning_*` tools and the provider adapter arrive through a registration seam
  (Rule 2). The tools move _into_ this package.
- **29.2** — this package publishes as `@archisimple/architectural-intelligence`
  on a lockstep `0.x` train (Rules 1, 5).

**The package does not move repositories.** ADR-0029 Rule 1 leaves topology
undecided; Rule 9 names the evidence that would reopen it. Until then this is a
package in the monorepo that happens to be installable.

**ADR-0029 Rule 3 protects an existing seam**: the four-field artefact envelope
(`kind`, `id`, `revision`, `value`) is mirrored by `ProposalArtefact`,
`PlanningArtefactSnapshot` and this package's `ApprovedArtefact` **on purpose**.
Do not consolidate it — Sprint 29.0 proposed exactly that and was withdrawn.
