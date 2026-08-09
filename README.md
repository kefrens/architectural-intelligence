# Architectural Intelligence

[![npm](https://img.shields.io/npm/v/@archisimple/architectural-intelligence.svg)](https://www.npmjs.com/package/@archisimple/architectural-intelligence)

`@archisimple/architectural-intelligence` is the **architectural reasoning
layer** of the [ArchiSimple](https://github.com/kefrens/archisimple) platform.

It turns a stated intent — _"a three-bedroom house of about 120 m² on a
north-facing plot"_ — into a chain of reviewable architectural artefacts, and
hands the last one to a host application to execute.

It is a library. It renders nothing, stores nothing, and executes nothing.

---

## Where it sits

This repository contains exactly one package: **layer 4** of the platform, the
reasoning half of its AI platform.

```
  host application (ArchiSimple, or your own)
        ▼
  (4) AI platform            ai-engine · skills   ← @archisimple/architectural-intelligence
        ▼
  (3) Semantic layer         building-model · spatial · inspector
        ▼
  (2) Automation API         automation-api  ← the single application boundary
        ▼
  (1) Runtime model          core · geometry · shared
```

Two structural facts follow, and a compliance test enforces both:

- **It never imports `@archisimple/core`.** It reaches the document only through
  the Automation API.
- **It holds no `CommandDispatcher`** — not imported, not called, not stood up
  locally. A plan _carries_ `CommandRequest`s; the host runs them. "No runtime
  modification occurs during reasoning" is a structural fact here, not a
  convention.

It proposes. Something else approves. Something else acts.

The rest of the platform — the application, the packages, the ADRs — lives at
**[kefrens/archisimple](https://github.com/kefrens/archisimple)**. This
repository was extracted from it in Sprint 30.3 (ADR-0030) and carries that
history. It arrives here from npm by version, never as a workspace link or a
sibling path: a clean clone builds with nothing else present.

---

## The pipeline

**Architectural Brief → Space Programme → Layout Plan → Geometry Graph**

| Stage                   | Owns                                                 | Does not own   |
| ----------------------- | ---------------------------------------------------- | -------------- |
| **Architectural Brief** | Intent, constraints, site facts, occupants           | Any room list  |
| **Space Programme**     | The rooms, their areas, their adjacency requirements | Any coordinate |
| **Layout Plan**         | Zones, circulation, relative arrangement             | Any coordinate |
| **Geometry Graph**      | Coordinates — where the first real geometry appears  | Wall thickness |

Each artefact is reviewable, approvable, and persisted by the host. The first
three own **no geometry at all**.

The rules that shape every change here (ADR-0027.1):

| Rule | In one line                                                                       |
| ---- | --------------------------------------------------------------------------------- |
| 2    | High-level intent never becomes geometry directly.                                |
| 3    | One responsibility per artefact — a Brief with coordinates is malformed.          |
| 4    | Approved artefacts are immutable; a change is a new revision.                     |
| 6    | **The host assembles the artefact.** Nothing is parsed out of model prose.        |
| 7    | One approval mechanism: a `Proposal`, approved by the host's session controller.  |
| 8    | One vocabulary for missing information: `PlanBlocker` / `PLAN_BLOCKER_REASONS`.   |
| 9    | Deterministic computation belongs to Skills, never to the model.                  |
| 13   | Optimisation revises an artefact; it never adds a stage or reads the stage above. |

**Derived facts are recomputed, not stored.** Layout quality and packing
evaluation are deliberately absent from their artefacts — a stored verdict goes
stale the moment a later revision lands.

### Classification is deterministic, and happens before any model call

An utterance is sorted into one of six lanes by `brief/request-classification.ts`
**before a provider is consulted**. The three stage lanes are each gated on
approval state (`hasApprovedBrief`, `hasApprovedProgramme`, `hasApprovedLayout`),
so a stage is unreachable for a caller that has not opted in. That gating _is_
the pipeline's sequencing — there is no orchestrator object.

---

## Installation

```bash
npm install @archisimple/architectural-intelligence
```

The seven platform packages it needs are **`peerDependencies`**, deliberately:

```
@archisimple/ai-engine        @archisimple/automation-api   @archisimple/building-model
@archisimple/inspector        @archisimple/shared           @archisimple/skills
@archisimple/spatial
```

The host already has `automation-api` and `ai-engine`. Making them
`dependencies` would give you a second copy of the Automation boundary — a
`Proposal` built by one half and not recognised by the other. Install them
alongside, at a matching version.

Requires Node ≥ 20. ESM only.

---

## Using it

A host supplies project storage, commands, geometry services and the approval
surface; this package supplies the reasoning.

```ts
import { ArchitecturalIntelligenceService } from '@archisimple/architectural-intelligence';

const intelligence = new ArchitecturalIntelligenceService({
  knowledge, // a BuildingKnowledge facade over the semantic layer
  briefDrafts, // where an unfinished Brief lives between turns
  artefacts // where this project's approved artefacts are read from
});

// One turn: classified deterministically, then answered.
const response = intelligence.interpret('a three-bedroom house of about 120 m²');

// Or drive a stage directly — the tool path and a menu command both do this.
const programme = intelligence.generateProgramme(intelligence.approvedBrief()!);
const layout = intelligence.generateLayout(intelligence.approvedProgramme()!);
const geometry = intelligence.generateGeometry(intelligence.approvedLayout()!);
```

Every call is **synchronous** and returns an `ArchitecturalResponse`: a message,
and — when the stage could be completed — the artefact plus a `Proposal` for the
host to offer. When something is missing it carries a `PlanBlocker` instead. It
never returns a mutation, and it never performs one.

`briefDrafts` and `artefacts` are optional ports and each one omitted narrows
what is reachable: no `briefDrafts` means no multi-turn clarification, and no
`artefacts` means programme generation is unavailable — the classifier never
reaches that lane.

### Extending it

`ArchitecturalPlanner` is a Service + Provider + Registry, the platform's
recurring pattern — but its providers contribute _capability_ (how to plan an
action) rather than data, which is why they register with a planner.

- **`ArchitecturalOperationProvider`** — teaches the planner to plan an action.
- **`PlanningStageProvider`** — enriches an artefact at a named stage. Several
  may enrich the same stage; they run in registration order, each seeing what
  the previous produced.

Both register on that **same** planner. A new capability extends one of these;
it does not add a registry (ADR-0025, ADR-0027.1 Rule 10).

Since ADR-0028 both seams are reachable from installed ArchiSimple packages.
Contributed providers get plain frozen data and no execution seam — no
dispatcher, no `Proposal`, no document handle. Enrichment must be synchronous,
must return a new object rather than mutate, and stays within a 50 ms budget.

---

## What is deliberately not here

- **Packing.** `packing-strategy`, `packing-evaluation` and `packing-conformance`
  live in `@archisimple/skills`. This package consumes them; it never
  reimplements geometry, spatial or unit maths (ADR-0027).
- **Provider networking and credentials.** All of it is in the host's AI service
  (ADR-0026). This package exports a provider _adapter_ and acquires no network
  dependency.
- **Any UI.** No React, no Three.js.
- **State.** Rooms are derived, areas are computed, nothing is cached beside the
  thing it was derived from.
- **The Geometry _Plan_.** Turning an approved Geometry Graph into walls is
  **not implemented**.

---

## Development

```bash
npm install
npm run build      # tsc -b
npm test           # vitest
npm run lint
```

`src/__tests__/architecture-compliance.test.ts` statically scans every
production source and fails CI on a `@archisimple/core` import, a
`CommandDispatcher`, or an eighth dependency outside the allow-list. If you need
something that isn't on that list, that is a design signal.

### Release order is not optional

**The platform releases first; this repository consumes a released version**
(ADR-0030 Rule 8). Publishing a version that peer-depends on a platform version
nobody can install fails at a _consumer's_ `npm install`, not in this CI.

A change spanning both, in order:

1. Land it in `archisimple`, bump, release.
2. Here: raise the `peerDependencies` range to that version, land, release.
3. There: point `apps/web`'s `optionalDependencies` at this new version.

Each repository is internally lockstep; the two are **not** lockstep with each
other.

---

## License

MIT
