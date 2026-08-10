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

**Architectural Brief → Space Programme → Layout Plan → Geometry Graph →
Geometry Specification**

| Stage                      | Owns                                                 | Does not own   |
| -------------------------- | ---------------------------------------------------- | -------------- |
| **Architectural Brief**    | Intent, constraints, site facts, occupants           | Any room list  |
| **Space Programme**        | The rooms, their areas, their adjacency requirements | Any coordinate |
| **Layout Plan**            | Zones, circulation, relative arrangement             | Any coordinate |
| **Geometry Graph**         | Coordinates — where the first real geometry appears  | Wall thickness |
| **Geometry Specification** | Thickness, height, centrelines, opening dimensions   | Topology, ids  |

Each artefact is reviewable, approvable, and persisted by the host. The first
three own **no geometry at all**.

The **Geometry Specification** (ADR-AI-0001) is where the pipeline ends and the
only artefact meant to leave this repository. It describes the building
completely enough that a consuming CAD application builds it without taking a
single architectural decision — and it stops exactly there: no topology nodes,
no wall joins, no entity ids, no commands. Those depend on the CAD system, and
choosing them is not architecture.

It carries its own `contractVersion`, and its own metric conventions as fields,
because a consumer outside this project has no documentation of ours to read.

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

An utterance is sorted into one of eight lanes by
`brief/request-classification.ts` **before a provider is consulted**. The four
stage lanes are each gated on approval state, so a stage is unreachable for a
caller that has not opted in. That gating _is_ the pipeline's sequencing — there
is no orchestrator object.

Since Sprint 1.2 the gates are read off the workflow state and mean **approved
_and_ current**: a stage whose input was superseded closes, and the stage that
fixes it stays open. Sprint 1.3 added the eighth lane, the only one that reaches
back up the pipeline — a revision of the approved Brief.

---

## Workflow state

Where a design is, and what can be asked for next — derived on every call, stored
nowhere (ADR-AI-0002).

```ts
const state = intelligence.workflowState();

state.currentStage; // 'layout'
state.complete; // false

for (const stage of state.stages) {
  stage.stage; // 'brief' | 'programme' | 'layout' | 'geometry' | 'specification'
  stage.artefact; // 'none' | 'draft' | 'approved'
  stage.approved; // { id, revision } — navigate to it
  stage.revisions; // every revision the project holds, oldest first
  stage.stale; // which revision it came from, which is in force, and whether inherited
  stage.blockers; // PlanBlocker[] — empty exactly when eligible
  stage.eligible; // the stage above is approved and current
  stage.actions; // 'generate' | 'regenerate'
}
```

The fields are orthogonal on purpose: an approved artefact can be stale and
remain approved, and a stage can be blocked by something two stages above while
holding a perfectly good artefact of its own. Staleness is transitive — revising
a Brief marks the Programme stale directly and everything below it by
inheritance.

## Revisions

An approved artefact is never edited (ADR-0027.1 Rule 4). Changing one produces
**revision n+1 of the same lineage**, and the superseded revision stays readable.

```ts
// Revise the brief: same id, next revision, everything below goes stale.
intelligence.reviseApprovedBrief('actually make it 4 bedrooms');

// Regenerate a stale stage: revision n+1, derived from the revision now in force.
intelligence.generateProgramme(intelligence.approvedBrief()!);
```

Every stage regenerates the same way, and a `generate*` call handed an artefact
the project has superseded is **refused** rather than acted on — with a
`superseded` blocker naming what to do instead.

To read the lineage, supply `all()` on the artefact reader. It is optional and
takes no argument, so a host that already keeps every revision satisfies it
without changing anything.

**It carries nothing about proposals.** Approval state is the host's: this
package builds a `Proposal`, hands it over, and never learns its fate — what it
learns is that an artefact became readable. A host showing "awaiting approval"
merges its own pending-proposal view onto this projection. For the same reason
`actions` never lists `approve`, `revise` or `navigate`.

The shape is plain JSON and every identifier is a stable string, so a host
restates it structurally rather than importing it, and maps the identifiers to
its own labels.

The same projection reaches a **model** through the `architecture` context
fragment, which carries `design` beside the capabilities it always reported:

```ts
design: {
  (currentStage, // 'programme', or null when the design is complete
    complete,
    stages, // stage · artefact · revision · stale · eligible · blockedBecause
    nextTool); // 'planning_generateProgramme' — what moves this forward
}
```

`nextTool` is the field that stops a model guessing which tool comes next. It
promises nothing about availability: the host's broker still decides which tools
it offers.

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
const specification = intelligence.generateSpecification(intelligence.approvedGeometry()!);

// Or ask where the design is. Derived, read-only, safe to call on every render.
const state = intelligence.workflowState();
```

Every call is **synchronous** and returns an `ArchitecturalResponse`: a message,
and — when the stage could be completed — the artefact plus a `Proposal` for the
host to offer. When something is missing it carries a `PlanBlocker` instead. It
never returns a mutation, and it never performs one.

`briefDrafts` and `artefacts` are optional ports and each one omitted narrows
what is reachable: no `briefDrafts` means no multi-turn clarification, and no
`artefacts` means no stage lane is reachable and `workflowState()` reports five
untouched stages rather than throwing.

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
- **Model construction.** The pipeline ends at the Geometry Specification.
  Translating one into walls, topology and commands belongs to the consuming
  application (ArchiSimple ADR-0031), and nothing here can do it: this package
  holds no dispatcher and imports no Runtime.
- **Windows, and load-bearing walls.** No opening candidate exists in an
  external wall for a window to sit in, and deciding which walls carry load
  needs a structural model this repository does not have. Both are recorded in
  the specification's own assumptions rather than guessed.

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
