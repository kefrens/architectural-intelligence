# Sprint 1.3 — Revision Lineage and Navigation

> **Status:** Completed — 2026-08-10
>
> **Version:** 1.1 — implemented; see _Implementation Notes_
>
> **Repository:** `architectural-intelligence`
>
> **Related ADRs:** ADR-AI-0002 (Rules 6, 7, 10, 11), ADR-AI-0001 (Rule 9), ADR-0027.1 (Rules 4, 12), ADR-0029 (Rule 3), ADR-0030 (Rules 2, 8)
>
> **Predecessor:** Sprint 1.2 — Architectural Workflow State
>
> **Platform release required:** none, if Rule 10 is honoured. See _The port widening_.

---

# Sprint Design Contract

The authoritative source is
[docs/architecture/00-current-state.md](../architecture/00-current-state.md).
Where this sprint conflicts with it, this sprint is wrong.

This sprint MUST NOT: mutate an approved artefact, delete a superseded one, add a
second approval surface, store the projection, or widen a port in a way that
forces an ArchiSimple release before this repository can ship.

It extends three existing seams:

| Existing seam                      | How this sprint uses it                                              |
| ---------------------------------- | -------------------------------------------------------------------- |
| `revise*` artefact functions       | Four exist and three have no production caller. This gives them one. |
| `PlanningArtefactReader`           | One optional, argument-free method.                                  |
| The Sprint 1.2 workflow projection | Gains lineage. The stage shape is extended, not replaced.            |

---

# Why this is its own sprint

Sprint 1.2 made staleness **visible**. This sprint makes it **fixable through a
revision rather than a new lineage**, which is a larger job than it looks and was
one bullet in the original 1.2 draft.

The reason it is larger: `reviseBrief`, `reviseProgramme`, `reviseLayoutPlan` and
`reviseGeometryGraph` all exist, all produce _same id, revision + 1_ — and only
`reviseGeometrySpecification` is called by anything in production. Today, a user
who re-describes their building after approving a Brief goes through
`assembleBrief`, which mints a **new id at revision 1**.

```text
what the ADR says                 what production does today
─────────────────────             ──────────────────────────
Brief#a v1                        Brief#a v1
    ↓ revise                          ↓ re-brief
Brief#a v2                        Brief#b v1        ← a new lineage, not a revision
```

Both are detected as stale downstream — `matchesBrief` compares the id as well as
the revision — so Sprint 1.2's projection is correct either way. What is lost is
the thing ADR-0027.1 Rule 4 exists to preserve: the record of what the user
approved **first**, connected to what they approved instead.

---

# Current State (after Sprint 1.2)

- The projection reports, per stage: presence, approval identity, direct and
  inherited staleness, blockers, eligibility, actions.
- Seven request lanes; stage gates derived from the projection.
- `PlanningArtefactReader.current(kind)` is the whole port — the projection can
  see the artefact **in force** and nothing behind it.
- The host registry already keeps every revision and already exposes
  `all(): readonly PlanningArtefactSnapshot[]`
  ([apps/web/src/ai/planningArtefacts.ts](https://github.com/kefrens/archisimple/blob/main/apps/web/src/ai/planningArtefacts.ts)).

So the history exists, in the host, unreachable.

---

# Goal

Make revision a first-class production path, and make the artefacts behind the
current one reachable.

After this sprint:

- revising an approved artefact produces revision _n + 1_ of the same lineage,
  through the same `Proposal` gate;
- the projection reports every revision of every stage, not only the one in
  force;
- a stale stage can be brought current by regenerating it from the upstream
  revision now in force, and the projection says so before and after.

---

# The port widening

The single design decision of this sprint, and the one that decides whether it
ships alone or waits on a platform release.

```ts
export interface PlanningArtefactReader {
  current(kind: string): ApprovedArtefact | undefined;
  /** Every approved artefact, every kind, every revision. Optional: a host may supply none. */
  all?(): readonly ApprovedArtefact[];
}
```

**Argument-free and optional, on purpose** (ADR-AI-0002 Rule 10).
`PlanningArtefactRegistry` in `apps/web` already has `all()` with exactly this
signature and returns `PlanningArtefactSnapshot[]`, which is assignable to
`ApprovedArtefact[]`. So the host satisfies the widened port **structurally, on
the day it is declared** — no change in ArchiSimple, no bump, no ADR-0030 Rule 8
release ordering.

`history(kind: string)` would have been the natural signature and would have cost
a coordinated release across two repositories for a read-only method. It is
rejected for that reason and for no other.

Optional, because Rule 11: a host that supplies no `all` gets a projection whose
lineage is the single current revision, and no error.

---

# Epics

## Epic 1 — Lineage in the projection

**Goal:** the projection reports what the project has approved over time, not
only what it holds now.

### Story 1.3.1 — `all()` on the reader

Declared optional and argument-free. `createInMemoryPlanningArtefactReader` gains
the implementation; the in-memory reader is what every test drives.

### Story 1.3.2 — Revisions per stage

`ArchitecturalStageState` gains `revisions: readonly ArtefactIdentity[]`, oldest
first, and it is `[approved]` — or `[]` — when the host supplies no `all`.

### Story 1.3.3 — Superseded artefacts stay readable

A superseded artefact is reported, never filtered out and never marked in error.
It is the record of a decision the user took, and ADR-0027.1 Rule 4 says
supersession is not deletion.

### Story 1.3.4 — Lineage integrity

A stage whose revisions carry more than one artefact **id** is a broken lineage —
the failure mode this sprint exists to end. The projection reports it as a
`PlanBlocker` rather than pretending the newest is a revision of the oldest.

No migration, and no repair path for existing files: there are no projects
created before this sprint. The report exists to catch a regression in the
revision paths Epic 2 adds, not to accommodate history.

> **Corrected by Sprint 1.5 (Bug 002).** This reasoning is about _pre-existing
> files_, and it is true and irrelevant. The split does not come from history: it
> comes from the paths that **create** a Brief, none of which this sprint
> touched. `planning_captureBrief` minted a new lineage on every call, so an
> ordinary conversation reached the state in two turns — and because the blocker
> leaves no stage eligible, reaching it killed the project. Sprint 1.5 closed all
> three creating paths; the blocker itself is unchanged and still correct.

---

## Epic 2 — Revision as a production path

**Goal:** the four `revise*` functions get their production callers.

### Story 1.3.5 — Revising the Brief

A user who re-describes their building when a Brief is already approved gets
revision _n + 1_ of that Brief, not a new one. The approved Brief is read back
through the port, the new requirements are folded in, and `reviseBrief` produces
the next revision.

This needs a decision the sprint must take explicitly and record in the code:
**what does a re-description mean — a patch or a replacement?** The recommendation
is a patch: requirements stated in the new utterance override their topic,
everything else is carried forward, and every carried-forward requirement keeps
its original `source`. A user correcting the bathroom count should not lose the
storey count they gave three turns ago.

### Story 1.3.6 — The revision lane

An eighth lane, or a widening of the brief lane — the sprint decides, and the
constraint is the one that has governed every lane since 27.8: a request that
does not clearly ask for a revision must stay in Direct Execution. "Actually make
it 4 bedrooms" is a revision; "move the kitchen wall" is not.

### Story 1.3.7 — Regeneration is revision

`generateProgramme`, `generateLayout` and `generateGeometry` gain the behaviour
`generateSpecification` already has (Story 1.1.13): when the project already
holds an approved artefact for **this** stage derived from **this** upstream
revision, produce revision _n + 1_ of it rather than a new artefact at revision 1.

The `matches*` predicate that decides this exists for all four stages and is
already used this way once.

### Story 1.3.8 — Regenerating from the revision now in force

A stale stage is regenerated from the **current** upstream artefact, and the
result's provenance records that. The stage's staleness clears; every stage below
it stays stale until regenerated in turn, which is Rule 6 doing its job rather
than a bug.

---

## Epic 3 — Enforcement

**Goal:** a stale artefact cannot silently become an input.

### Story 1.3.9 — Generation refuses a stale upstream

`generateProgramme`, `generateLayout`, `generateGeometry` and
`generateSpecification` are public and callable with any artefact. Where the
artefact passed is not the one in force, the call is refused with a `superseded`
blocker naming both revisions.

This is the guard Sprint 1.2's Story 1.2.17 deliberately did **not** add, because
until there is a revision path there is nothing a user could do about the
refusal. Now there is.

### Story 1.3.10 — The tools regenerate rather than fail

Each planning tool reads the artefact in force, so it is already correct by
construction. This story asserts it, and asserts that a tool called on a stale
stage produces a proposal for a fresh revision rather than a blocker — a model
that has been told to fix the layout should be able to.

---

## Epic 4 — Verification

### Story 1.3.11 — Revision E2E

Approve Brief v1, Programme v1, Layout v1. Revise the Brief through the
production path. Assert: Brief v2 carries the same id; the Programme and Layout
report stale, one directly and one inherited; both remain readable; the workflow
state names the revision each was derived from and the revision now in force.

### Story 1.3.12 — Recovery E2E

Continue: regenerate the Programme, assert it is v2 of the same lineage and no
longer stale, and that the Layout is **still** stale. Regenerate the Layout.
Assert the whole projection is current and `complete` is true.

### Story 1.3.13 — Lineage never breaks

Across the whole of 1.3.11 and 1.3.12, assert that each stage's `revisions` all
share one artefact id. This is the assertion the sprint is for.

### Story 1.3.14 — Degradation without `all()`

The full projection with a reader that supplies only `current`: `revisions` holds
the single current identity, staleness still works, nothing throws.

---

## Epic 5 — Documentation

### Story 1.3.15 — Current state

`00-current-state.md` and `.yaml`. The revision paths enter the inventory; if
anything remains unbuilt it enters `notImplemented` with evidence.

### Story 1.3.16 — ADR-AI-0002

Revision 1.1: record that the port widened as Rule 10 prescribed, and that the
host needed no change — the rule's first real test, and worth recording whether
it held.

---

# Out of Scope

| Not in this sprint                                         | Where                         |
| ---------------------------------------------------------- | ----------------------------- |
| Navigation state — which revision is on screen             | Host. It is session state.    |
| Diffing two revisions                                      | Later, if a panel needs it    |
| Pending proposals                                          | Host; ADR-AI-0002 Rule 2      |
| Constraint optimisation of an approved Graph               | ADR-0027.1 Rule 13, unwritten |
| Re-executing a revised Specification against a built model | ArchiSimple ADR-0031 Rule 5   |

The last one is worth stating plainly: this sprint makes revising an **approved**
design routine, and ArchiSimple currently **refuses** to apply a Specification
whose spaces are already built. Making revision easy upstream will make that
refusal the next thing a user meets. It is the right place for the pressure to
land, and it belongs to the other repository.

---

# Testing Strategy

- **Unit** — the patch-versus-replace decision for briefs, revision numbering,
  lineage integrity detection, the `all()`-absent path.
- **Classification** — the revision lane, and that Direct Execution is unchanged.
- **End to end** — Epics 4's four stories, through `interpret` and the in-memory
  reader.
- **Structural** — a test asserting that the host's `all()` signature satisfies
  the widened port, so a future signature change here is caught in this
  repository rather than at a consumer's `npm install`.

---

# Definition of Done

## Architecture

- [x] Revision means same id, next revision — through the one `Proposal` gate.
- [x] Superseded artefacts remain readable; nothing is deleted.
- [x] The port widened optionally and argument-free; ArchiSimple needed no change.
- [x] The projection is still derived on every call.
- [x] A broken lineage is reported, never papered over.

## Implementation

- [x] `all?()` on the reader, implemented by the in-memory reader.
- [x] `revisions` per stage in the projection.
- [x] Brief revision through production.
- [x] Regeneration produces revisions for all four derived stages.
- [x] Generation refuses a superseded upstream artefact.

## Verification

- [x] Revision E2E and recovery E2E pass.
- [x] Lineage integrity asserted throughout.
- [x] Degradation without `all()` verified.
- [x] Build, lint, full suite pass.

## Documentation

- [x] `00-current-state.{md,yaml}` updated.
- [x] ADR-AI-0002 revision 1.1.
- [x] Release notes name the port widening and any lane addition.

---

# Implementation Notes

## What shipped

Every epic. 589 tests across 13 files, `tsc -b` clean, `eslint .` clean, and
**no change in ArchiSimple** — the release-order property Rule 10 was written to
buy.

| Story           | Landed as                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------ |
| 1.3.1 – 1.3.4   | `all?()` on the port; `revisions` per stage; split-lineage reported as `ambiguous`         |
| 1.3.5 – 1.3.6   | `reviseBriefFrom`, `ArchitecturalIntelligenceService.reviseApprovedBrief`, the eighth lane |
| 1.3.7 – 1.3.8   | All four `generate*` revise what the project holds; `revise*` patches carry provenance     |
| 1.3.9 – 1.3.10  | `supersededInput`, two clauses; the tools assert both outcomes                             |
| 1.3.11 – 1.3.14 | `src/__tests__/revision-lineage.test.ts` (40)                                              |

## Where this reads differently from the plan

### The refusal needed a second clause the plan did not anticipate

Story 1.3.9 says "generation must require the current approved upstream
revision", and the obvious reading — refuse an artefact that is not the one in
force — is **not sufficient**. A tool reads the artefact in force and passes it
faithfully, so that check never fires; but if a Brief revision left that artefact
stale, what the tool builds is stale too.

This surfaced as a test whose name said "refuses" while its assertion expected a
proposal. The fix asks the projection instead of re-deriving: if the stage is not
eligible, the refusal **is** the blocker the projection already computed. One
place decides why a stage cannot proceed.

### Sprint 1.1's `matchesGeometryGraph` condition had to go

`generateSpecification` revised only when the Graph was the _same_ one, and forked
otherwise — the last remaining way to split a lineage. Dropping the condition
changed a Sprint 1.1 test from "starts a new artefact" to "revises rather than
forking", which is the sprint's whole point stated as a diff.

The predicate still answers "was this resolved from the Graph in force". It no
longer decides the artefact's identity.

### `revise*` patches had to accept provenance

Not in the plan, and load-bearing. `reviseProgramme(previous, {...})` keeps
`previous.sourceBrief` — so a revision regenerated from Brief v2 would have
claimed it came from v1, and staleness would then be computed against a
provenance that lies. All five patches gained their provenance field and
`contributedBy`, which also fixes a quiet Sprint 1.1 gap where enrichment
attribution was dropped on revision.

### `hasBriefToRevise` is a fifth gate, not a reuse of the first

`hasApprovedBrief` has meant "the _programme_ stage is eligible" since Sprint 1.2.
Revision asks a different question — is there a Brief to change — which is true
even when it is superseded. Two questions, two options, rather than one option
meaning two things depending on which lane reads it.

### A third incoherent fixture

`specification.test.ts` stored four separately-constructed artefacts, like
`layout.test.ts` and `geometry.test.ts` did before Sprint 1.2 corrected them. The
new guard refuses to build on that project, correctly, and five tests went red
until the fixture stored a chain that can exist.

## Deliberately not built

- Navigation state — which revision is on screen is the host's.
- Diffing two revisions.
- Any repair path for a split lineage: it is a defect, and there are no projects
  created before this sprint.

---

# Architecture After This Sprint

```text
Brief#a v1 ──▶ Programme#b v1 ──▶ Layout#c v1 ──▶ Geometry#d v1 ──▶ Spec#e v1
   │
   │ revise
   ▼
Brief#a v2 ──▶ Programme#b v2 ──▶ Layout#c v2 ──▶ Geometry#d v2 ──▶ Spec#e v2
   ▲               ▲                 ▲
   └───────────────┴─────────────────┴─── same lineage, next revision, both readable
```

Five lineages, each with its own history, each stage knowing which revision above
it produced the one it holds — and one projection that can say, at any moment,
which of them are current.
