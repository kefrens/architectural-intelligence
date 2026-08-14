# ADR-AI-0001: Geometry Specification as the Final Architectural Artefact

- **Status:** Accepted
- **Revision:** 2.1
- **Date:** 2026-08-14
- **Deciders:** ArchiSimple Project
- **Relates to:** ArchiSimple ADR-0027.1 (planning pipeline), ADR-0030 (repository separation), ADR-0031 (geometry execution pipeline)

---

## Revision History

| Revision | Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0      | 2026-08-09 | Initial proposal. Named the artefact "Geometry Proposal" and terminated the pipeline at it.                                                                                                                                                                                                                                                                                                                                 |
| 2.0      | 2026-08-09 | Reviewed against the implementation. **Renamed to Geometry Specification** — "Geometry Proposal" already names the approval envelope around a Geometry Graph. **Placed after the Geometry Graph** rather than in place of it, and corrected the pipeline diagram, which had listed a mechanism (`Planning`) and an algorithm (`Packing Strategy`) as stages. Assigned **wall thickness to this repository** and said why. Added the ownership table, self-validation, the contract version, provenance, metric conventions, and numbered Rules. Scoped the "emits no commands" absolute to the design lane, which Direct Execution has always been exempt from. |
| 2.1      | 2026-08-14 | ArchiSimple BUG-012 Finding 4 audited what was, until now, only a source comment: thickness insertion is permitted to enlarge the approved geometry and is never permitted to shrink it. **Added Rule 12**, stating that contract explicitly and making it citable, rather than leaving it discoverable only by reading `insertWallThickness` and `synthesizeSpecification`. No behaviour changed — the implementation already did this and already reported it through `warnings`/`assumptions`; this revision closes the gap between what the code does and what the ADR says it may do. |

---

## Context

Architectural Intelligence transforms a user's intent into progressively more
concrete architectural artefacts. Four are implemented and each is separately
approved:

```
Architectural Brief        intent
        ↓
Space Programme            the logical building
        ↓
Layout Plan                spatial organisation
        ↓
Geometry Graph             semantic geometry — polygons, wall candidates, no thickness
```

At the Geometry Graph the architectural intent has been resolved into
coordinates, but it still cannot be realised by a CAD application. A wall
_candidate_ is an edge two rooms share. It has no thickness, no height and no
position for the wall that will be built along it.

Something has to make those decisions. Revision 1.0 of this ADR left open who,
and that is the gap this revision closes: if the reasoning layer stops at
candidates, every consuming application invents its own thickness, its own
offsetting and its own junction resolution — which is precisely the duplication
this ADR exists to prevent. The user would also be approving geometry whose
final dimensions nobody has shown them.

A fifth and final artefact is therefore required: one that completely describes
the proposed building geometry, metrically and unambiguously, while remaining
independent of any CAD engine.

---

## Decision

Architectural Intelligence shall produce a **Geometry Specification** as the
final artefact of its design pipeline.

```
Architectural Brief
        ↓
Space Programme
        ↓
Layout Plan
        ↓
Geometry Graph             semantic geometry — where and how large
        ↓
Geometry Specification     buildable geometry — how thick, how tall, exactly where
```

The Geometry Specification is the public boundary between architectural
reasoning and model execution. It describes a building completely enough that a
consuming application can construct it without making a single architectural
decision.

Architectural Intelligence ends there. It does not mutate building models, it
does not construct topology, and it does not depend on any host application's
geometry engine.

---

## Naming --- why not "Geometry Proposal"

`Proposal` is the single approval envelope of ArchiSimple's ADR-0027.1 Rule 7,
and this repository already ships four factories that wrap an artefact in one:
`toBriefProposal`, `toProgrammeProposal`, `toLayoutProposal`, and — in
[`src/geometry/geometry-proposal.ts`](../../src/geometry/geometry-proposal.ts) —
`toGeometryProposal`, which offers a **Geometry Graph** for approval.

"Geometry Proposal" therefore already means _the envelope around the Geometry
Graph_. Reusing it for the final artefact would give one phrase two referents in
the same directory, and `toGeometryProposal` would stop saying which of the two
it returns.

The artefact is called the **Geometry Specification**; its kind string is
`geometry-specification`; its envelope factory is
`toGeometrySpecificationProposal`. Each envelope factory is named after the
artefact it carries, which makes the existing `toGeometryProposal` a
misnomer — it is renamed `toGeometryGraphProposal` in the same sprint. The
package is on a `0.x` train where the public API is unstable by convention
(ADR-0029), so the rename costs a line in the release notes and nothing else.

---

## Position --- after the Geometry Graph, never in place of it

The Geometry Specification is a **fifth stage**. It reads an approved Geometry
Graph and adds metric resolution to it.

It would have been simpler to widen the Geometry Graph until it carried
thickness too, and that is rejected for the reason ADR-0027.1 Rule 3 exists: the
Graph is what constraint optimisation revises (Rule 13), and an optimiser that
can reshape an arrangement must not be able to silently re-thicken a wall the
user already approved. Coordinates and thickness stay one artefact apart, and
each is approved on its own terms.

Two stages that revision 1.0 listed are **not** stages and do not appear:

- **Planning** is the `ArchitecturalPlanner` — a mechanism that serves every
  lane, and the entry point of Direct Execution. It produces no reviewable
  artefact of its own.
- **Packing Strategy** is an algorithm inside `geometry-synthesis.ts`. It
  produces a Geometry Graph; it is not a thing a user approves.

The design pipeline has **five** approval gates, matching ADR-0027.1's count
plus this one. It does not have seven.

---

## Ownership

| Capability                             | Geometry Graph | Geometry Specification | Consuming application |
| -------------------------------------- | :------------: | :--------------------: | :-------------------: |
| Room polygons (finished faces)         |       ✓        |                        |                       |
| Wall candidates, opening candidates    |       ✓        |                        |                       |
| Storey count and elevations            |       ✓        |                        |                       |
| Wall thickness                         |                |           ✓            |                       |
| Wall role (external, party, partition) |                |           ✓            |                       |
| Wall centrelines, offset from faces    |                |           ✓            |                       |
| Wall height, storey height             |                |           ✓            |                       |
| Colinear run merging                   |                |           ✓            |                       |
| Endpoint coincidence within tolerance  |                |           ✓            |                       |
| Opening position, width, height, sill  |                |           ✓            |                       |
| Topology nodes                         |                |                        |           ✓           |
| Wall joins, mitres, cleanup            |                |                        |           ✓           |
| Model entity identifiers               |                |                        |           ✓           |
| Command generation and ordering        |                |                        |           ✓           |
| Undo grouping, transactions            |                |                        |           ✓           |
| Persistence of the built model         |                |                        |           ✓           |

The line is drawn between **geometry** and **topology**. A centreline with a
thickness is architecture; the node where three of them meet is a data
structure, and which data structure depends entirely on the CAD system.

---

## Wall thickness belongs here

The decision this revision exists to record.

Thickness is an **architectural** decision, not a CAD one. It follows from
construction type, whether the wall is load-bearing, whether it separates
dwellings, what acoustic or fire separation the programme implies, and what the
Brief said about how the building is built. Every one of those facts lives
upstream in this repository and none of them is available to a translator.

Three consequences follow, and all three are the point:

- **The user approves real dimensions.** A Geometry Graph polygon is a finished
  face; a 12 m² room stays 12 m² only if something offsets adjacent polygons
  apart to make room for the wall between them. ADR-0027.1 assigned that
  offsetting to the stage that owns thickness, and this is that stage. The
  change in the plan is visible and reviewable rather than a silent shortfall
  discovered after construction.
- **The consuming application cannot get it wrong**, because it is never asked.
- **Two consumers of the same Specification build the same building.** If
  thickness were the host's, they would not.

The Specification carries a **default** derived from the Brief and an explicit
value per wall. A host may not override it silently; a host that wants different
thickness asks for a new revision, which is a design change and reviewed as one.

---

## The artefact

A sketch, not the schema — the sprint owns the exact field list.

```ts
export const GEOMETRY_SPECIFICATION_KIND = 'geometry-specification';
export const GEOMETRY_CONTRACT_VERSION = '1.0.0';

interface GeometrySpecification extends EnrichedArtefact {
  readonly kind: typeof GEOMETRY_SPECIFICATION_KIND;
  readonly id: string;
  readonly revision: number;
  readonly createdAt: number;

  /** The contract this artefact conforms to. Not the package version. */
  readonly contractVersion: string;
  /** Units, precision, origin, winding, elevation datum — stated, never assumed. */
  readonly conventions: MetricConventions;
  /** The Geometry Graph this was resolved from, by id and revision. */
  readonly sourceGeometry: GeometryProvenance;

  readonly storeys: readonly SpecifiedStorey[]; // index, elevation, height
  readonly spaces: readonly SpecifiedSpace[]; // stable id, boundary, area
  readonly walls: readonly SpecifiedWall[]; // centreline, thickness, role, height
  readonly openings: readonly SpecifiedOpening[]; // wall, position along, width, height, sill

  /** Why the geometry is what it is. Provenance, never instructions — see Rule 4. */
  readonly constraints: readonly GeometryConstraintRecord[];

  readonly assumptions: readonly string[];
  readonly warnings: readonly string[];
}
```

Identifiers are **stable across revisions** wherever the element survives: a
wall that only changed thickness keeps its id. Nothing in revision 1 of the
translator depends on that, and everything about incremental execution later
does.

The artefact carries no wall _identifiers of the host_, no topology nodes, no
selections, no commands, no transactions and no persistence concerns. Those
belong to the consuming application.

---

## Rules

Numbered so sprints, compliance tests and ArchiSimple ADR-0031 can cite them.

### Rule 1 --- The design pipeline terminates at the Geometry Specification

No stage of the design pipeline emits a `CommandRequest`, mutates a building
model, or names a host entity.

**This scopes to the design lane only.** ArchiSimple ADR-0027.1's Direct
Execution lane is untouched: "move the kitchen wall 200 mm" states its own
geometry, enters at the `ArchitecturalPlanner`, and continues to produce
`ArchitecturalPlan`s carrying `CommandRequest`s against the versioned
`@archisimple/automation-api` contracts. Revision 1.0 of this ADR stated the
prohibition absolutely, which would have made this repository non-compliant with
its own ADR on the day it was written, and required deleting five shipped
operation providers to fix.

The distinction is not "commands are CAD-coupling". `automation-api` is a
versioned public contract and a `peerDependency` here. The distinction is that
**a command sequence is not reviewable as architecture and cannot be revised**:
it has no notion of a revision, an assumption, a warning or an approval, so
Rules 4 and 13 of ADR-0027.1 cannot apply to it. Design output must be an
artefact for that reason, not for a dependency-graph reason.

**Enforceable**: the compliance test already asserts no `CommandDispatcher`; it
gains an assertion that no file under `src/geometry/` imports `CommandRequest`.

### Rule 2 --- The Specification follows the Geometry Graph

It is produced from an **approved** Geometry Graph and never from a Layout Plan,
a Programme or an utterance. A host that has approved no Geometry Graph cannot
reach this stage, and the classifier does not offer it.

### Rule 3 --- Thickness, height and offsetting are owned here

Stated above and repeated as a rule because it is the one a later sprint is
tempted to break. A consuming application that computes a thickness has taken a
decision this repository owes it.

### Rule 4 --- The Specification is fully resolved

Every coordinate is a number. Constraints are recorded as **provenance** — why
this edge sits where it does — and are never instructions a consumer must solve.
A consumer that runs a solver is doing architectural reasoning, which ADR-0031
forbids it, and the two documents would contradict each other.

Unresolvable constraints do not ship as constraints. They become blockers
(Rule 7) or warnings.

### Rule 5 --- Metric conventions are stated, not assumed

Unit (metre), precision (0.001), coordinate origin, polygon winding and
elevation datum are fields of the artefact. A consumer outside this project has
no `CLAUDE.md` to read them from, and a convention that lives only in
documentation is one a second consumer will get wrong.

### Rule 6 --- Provenance is carried, staleness is detectable

`sourceGeometry` records the Geometry Graph id **and revision**. A Graph revised
after a Specification was built leaves it stale, and
`matchesGeometryGraph(spec, graph)` makes that a checkable fact rather than a
silent inconsistency — the same shape `matchesLayout` already has one stage up
(ADR-0027.1 Rule 12: divergence is reported, not reconciled).

### Rule 7 --- The Specification validates itself

`validateGeometrySpecification` is exported beside the artefact and returns
`PlanBlocker`s from `PLAN_BLOCKER_REASONS` — the single vocabulary of
ADR-0027.1 Rule 8. Self-intersecting boundaries, openings wider than their wall,
walls that do not meet within tolerance, storey mismatches: all are caught here,
before approval.

A consuming application's own validation is a **safety net that should never
fire**. When it does, that is a defect in this repository, reported as a bug —
not a user-facing workflow. A rejection surfaced at execution time would be a
second failure surface for a design the user already approved, against Rule 7 of
ADR-0027.1.

### Rule 8 --- The contract is versioned in the artefact

`contractVersion` is semantic and independent of the npm package version,
exactly as `@archisimple/automation-api` carries its own `1.3.0`. The two
repositories are deliberately not lockstep (ADR-0029 Rule 5 as amended in 2.1),
so the package version cannot serve as the contract version.

A **major** bump means a consumer must change. Adding an optional field does
not. A consumer checks the major and refuses a Specification it cannot read,
rather than reading it partially.

### Rule 9 --- Revision, never mutation

An approved Specification is immutable. A change produces a new revision through
`reviseGeometrySpecification`, with its own approval, and the superseded
revision remains readable. ADR-0027.1 Rule 4, restated here because this
artefact is the one a host is most tempted to patch in place.

### Rule 10 --- One approval mechanism

`toGeometrySpecificationProposal` produces the same `Proposal` that the four
artefacts above it produce, approved through `AiSessionController.approveProposal`.
No second approval surface, store or confirmation rule (ADR-0027.1 Rule 7).

### Rule 11 --- Deterministic computation belongs to Skills

Offsetting, colinear merging, junction geometry and area recomputation call
`@archisimple/skills` — extending `geometry-realisation/` where the predicate it
needs does not exist yet. No stage re-implements geometry maths, and no stage
asks a language model to perform it (ADR-0027.1 Rule 9, ADR-0027).

### Rule 12 --- A room may grow to fit a wall; it may never shrink

Wall thickness is inserted **after** the Geometry Graph was approved (Rule 2),
along the boundary the packer drew with none. A room whose approved boundary a
wall line now crosses has to give up that strip to the wall somehow, and there
are exactly two places it can come from: the room can lose it, or the room can
absorb it and the building envelope grows around the room instead.

The first option is rejected, absolutely. It would mean a room the user approved
at 12 m² is delivered smaller than that — silently, unless every consumer of
this artefact happened to notice — which is precisely the failure ADR-0027.1
exists to prevent: an approved artefact quietly under-delivering what was
approved. So `insertWallThickness` (`@archisimple/skills`) takes the second
option unconditionally: a room spanning a wall line **grows** by that wall, the
building's envelope grows to match, and no room is ever delivered smaller than
the Geometry Graph said.

This is not unbounded licence to redesign. Rule 2 still holds — no space is
added, removed, reshaped or moved between storeys — and Rule 4 requires that
every growth be recorded rather than absorbed silently:

- `synthesizeSpecification` reports the affected room's growth as a
  `SpecifiedSpecification.warning`, in millimetres, naming the room.
- The building envelope's own growth, per storey, is reported as an
  `assumption` for the same reason `describeDefaults` reports a thickness
  the user did not state — a number this stage decided rather than received.

A future artefact carrying renovation constraints — *do not move this wall*,
*preserve this external boundary* — changes what a caller may hand
`insertWallThickness`, not this rule: a boundary marked immovable is one the
solver must fail against rather than grow around, which is new input validation
for that skill, not an exception carved into this Rule.

### The user approves the building they get

The strongest argument, and the one revision 1.0 missed. Approval at the
Geometry Graph is approval of an arrangement whose final dimensions have not
been decided. Approval at the Specification is approval of the building.

### CAD independence

A Geometry Specification is consumable by multiple applications without
modification, and two of them build the same building because every
architectural decision was already taken.

### Deterministic execution

The consuming application converts a fully resolved description into model
operations. There is nothing left to interpret, so the same Specification always
produces the same model.

### Testability

Reasoning is testable end to end — utterance to Specification — with no
graphical editor, no building model and no dispatcher.

### Future interoperability

ArchiSimple, command-line generators, cloud services, research tools and
alternative CAD systems consume one artefact.

---

## Consequences

### Positive

- completes the design pipeline
- establishes a stable, versioned public contract
- preserves CAD independence
- makes downstream execution mechanical
- keeps reasoning tests free of any editor

### Negative

- consuming applications must implement a translator
- a fifth approval gate in the design lane
- an additional artefact to version, persist and migrate
- thickness heuristics now live here and will need a knowledge model to do well;
  revision 1 ships defaults and records them as assumptions

---

## Alternatives Considered

### Terminate at the Geometry Graph (revision 1.0's implied position)

Rejected. It leaves thickness, offsetting and junction geometry to every
consumer independently, so two consumers produce different buildings from the
same approved design, and the user approves areas that construction then
silently reduces.

### Widen the Geometry Graph to carry thickness

Rejected. Constraint optimisation revises the Graph (ADR-0027.1 Rule 13); an
artefact that carries both arrangement and thickness lets an optimiser change a
wall the user approved without saying so. Coordinates and thickness stay one
artefact apart.

### Let the consuming application choose thickness

Rejected. It is an architectural decision made from facts that only exist in
this repository, and delegating it converts the translator into a reasoning
engine — which ADR-0031 forbids in the same breath as it asks for one.

### Emit CAD commands directly

Rejected. A command sequence carries no revision, assumption, warning or
approval, so none of the pipeline's rules can apply to it. It is also
untestable without an editor.

### Construct the building model directly

Rejected. Model mutation belongs to the consuming application. This repository
produces architectural intent, not editor state.

---

## Out of Scope

This ADR does not define:

- how a Geometry Specification becomes a building model
- command generation, topology construction or wall joins
- Automation API integration
- undo/redo behaviour
- re-execution of a revised Specification against an already-built model

Those belong to the consuming application, and for ArchiSimple they are
ADR-0031.

---

## Summary

Architectural Intelligence answers:

> **"What should the building be, exactly?"**

The consuming application answers:

> **"How is that building constructed within this CAD system?"**

The Geometry Specification is the architectural contract between those two
responsibilities, and the word "exactly" is what revision 2.0 added to the
first question.
