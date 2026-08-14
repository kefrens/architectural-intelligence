# Sprint 1.8 — Authoritative Constraint Evaluation

> **Status:** Complete — see §16 for what implementation changed
> **Version:** 1.2 (1.0 review draft; 1.1 recorded the four decisions; 1.2 records what implementation found)
> **Repository:** `architectural-intelligence` — the platform half is **ArchiSimple Sprint 037.3** (landed)
> **Related ADRs:** ArchiSimple **ADR-0034** (Accepted, revision 1.2) — not modified by this sprint; ADR-AI-0003 (explicit spatial relationships); ArchiSimple ADR-0027.1 Rules 4, 6, 9, 12; ADR-0030 Rule 8
> **Prerequisites:** ArchiSimple Sprint 037.3 — `constraints.evaluate`, `storeyPrecondition`, `storeyCoverage`, the `scoreLayout` tallies
> **Related bug:** BUG-011 — this closes the artefact half
> **Next:** BUG-011 closure

---

## 1. Objective

Stop this layer claiming that a design satisfies something nobody checked, and
make it read the platform's authoritative constraint evaluator instead.

BUG-011 reached a user as four lines on a Layout review card:

```text
- Programme satisfied: 100%
- Required adjacencies met: 100%
- Preferred adjacencies met: 100%
- Circulation reaches: 100% of storeys
```

over a plan containing a bedroom with no doorway to the hallway. Every one of
those lines is rendered by [`describeLayoutQuality`](../../src/layout/layout-quality.ts),
in this repository. ArchiSimple Sprint 037.3 removed the platform's ability to
produce them. This sprint removes the rendering, and replaces it with what the
evaluator actually establishes.

```text
Layout Plan            → constraints.evaluate at stage `layout`
                         → NOT_APPLICABLE, and the card says so
Geometry Specification → constraints.evaluate at stage `geometry-specification`
                         → PASS / FAIL, from the Specification's own openings
```

---

## 2. Two sprints, in this order

| Sprint             | Repository                   | Delivers                                                                                  |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------------------------- |
| **037.3** (landed) | `archisimple`                | `constraints.evaluate`; `storeyPrecondition`; `storeyCoverage`; the `scoreLayout` tallies |
| **1.8** (this)     | `architectural-intelligence` | the migration, the Specification-stage evaluation, the rendering, the tests               |

ADR-0030 Rule 8's ordering is satisfied: the platform changed first. **No npm
release is required by either half for this sprint to be developed** — both
repositories are linked in the local `~/Dev/IA` workspace and this sprint
consumes the platform's current source directly (see §11).

---

## 3. Inherited — do not re-derive

| Area                             | Established fact                                                                                         | Consequence here                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| The three relations              | ADR-0034 §6, fixed: `adjacent`, `traversable-connection`, `circulation-reachability`. There is no fourth | Used as given. A fourth is a stop condition (§10, S4) |
| The result semantics             | ADR-0034 §12: PASS / FAIL / NOT_APPLICABLE, `evaluatedStage` on every result                             | Consumed, never reinterpreted                         |
| The evaluation authority         | ADR-0034 §4: exactly one, and it is `constraints.evaluate`                                               | This layer presents; it does not compute              |
| The Layout stage decides nothing | ADR-0034 §7 + the 037.3 stage table: a Layout Plan has no boundaries and no openings                     | The Layout card claims nothing. That is the fix       |
| Storey-sharing                   | ADR-0034 §4.1a: a necessary condition, never a sufficient one                                            | `storeyPrecondition` replaces `satisfied` end to end  |
| The empty denominator            | ADR-0034 §4.1b: the absence of constraints is not compliance                                             | Counts with denominators, never a share               |
| `avoid` is a requirement         | Sprint 27.9 and ADR-AI-0003: not the absence of one                                                      | Maps to the evaluator's `avoid` strength unchanged    |
| Explicit beats assumed           | ADR-AI-0003 Rules 4 and 5: `source`, ordering, and the pair guard                                        | §6's template work must not weaken either             |
| Derived facts are recomputed     | This repository's CLAUDE.md; no quality is stored on an artefact                                         | No evaluation result is persisted. Still true after   |
| Repeated-space instance identity | ADR-0034 §17.1: a separate ADR is required                                                               | Not solved here. TC-03/04/05 stay blocked (§9)        |

---

## 4. Exact migration sites

Four sites **fail to compile** today. Nine more read a field that survives but
whose meaning changed. Every one is listed; none is discovered later.

### 4.1 Compile failures — the platform API changed under them

| #   | Site                      | Symptom                                                            | Cause                                               |
| --- | ------------------------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| 1   | `layout-synthesis.ts:263` | `Property 'satisfied' does not exist on type 'ResolvedRelation'`   | ADR-0034 §4.1a removed it                           |
| 2   | `layout-quality.ts:78`    | `Property 'storeyPrecondition' is missing`                         | The same removal, on the way back in                |
| 3   | `layout-quality.ts:86`    | `Property 'score' does not exist on type 'ScoreCirculationOutput'` | Renamed `storeyCoverage`; the input key renamed too |
| 4   | `layout-quality.ts:95`    | `ScoreLayoutOutput` no longer has the four `LayoutQuality` fields  | ADR-0034 §4.1b replaced shares with tallies         |

### 4.2 Readers of `ResolvedAdjacency.satisfied` — this repository's own field

`ResolvedAdjacency` ([`layout-plan.ts:143`](../../src/layout/layout-plan.ts)) is
**this repository's artefact type**, not the platform's. Its `satisfied: boolean`
still compiles. It is now populated from nothing, and every reader below is
therefore reading a claim with no source.

| #   | Site                      | What it does with it                                              |
| --- | ------------------------- | ----------------------------------------------------------------- |
| 5   | `layout-synthesis.ts:140` | `buildGraph` emits an `adjacent` edge when `satisfied`            |
| 6   | `layout-synthesis.ts:293` | Warns about an unsatisfied **required** adjacency                 |
| 7   | `layout-plan.ts:294`      | `summarizeLayoutPlan` lists "Could not be placed together"        |
| 8   | `layout-proposal.ts:62`   | `describeLayout` counts unsatisfied relationships for the message |
| 9   | `layout-quality.ts:82`    | Feeds it back into `scoreLayout` — site 2                         |

### 4.3 The unconditional claims BUG-011 named

| #   | Site                          | The claim                                                                           |
| --- | ----------------------------- | ----------------------------------------------------------------------------------- |
| 10  | `layout-synthesis.ts:121–129` | Every space gets a `Connected` edge to its storey's circulation node, with no check |
| 11  | `layout-synthesis.ts:186–187` | `Every space opens off the ${…}.` for **every** single-storey plan, unconditionally |

### 4.4 The second satisfaction authority — geometry stage

`GeometryGraph.adjacencies[].satisfied` is computed at
[`geometry-synthesis.ts:226`](../../src/geometry/geometry-synthesis.ts) from
`touching` — real shared polygon edges, not a storey comparison. **It is an
evaluation, and it is a good one**, which is exactly why it is a problem:
ADR-0034 §4 forbids a second implementation of the same satisfaction
calculation, naming "geometry generation" explicitly.

| #   | Site                             | Reads it for                                |
| --- | -------------------------------- | ------------------------------------------- |
| 12  | `geometry-synthesis.ts:233`      | Which adjacencies become opening candidates |
| 13  | `geometry-synthesis.ts:256`      | Warnings about unrealised adjacencies       |
| 14  | `specification-synthesis.ts:334` | Constraint-record provenance prose          |

**Q1 — decided: migrate them, in this sprint.** Leaving a second authority intact
while writing a sprint whose subject is that there shall be one would be the
cheapest possible way to lose the rule.

**With one constraint the decision added, and it is not a loophole.** A
geometric fact — two polygons touching, a shared edge, `sharedPolygonEdges` —
remains a legitimate **generation fact and candidate input**. Synthesis may go
on asking "do these two rooms share an edge I could put a door in", because that
is how an opening candidate is chosen.

What may not happen is calling that fact satisfaction, storing it under a name
that reads as satisfaction, or letting a reader take it for one. Concretely:

| Legitimate                                          | Forbidden                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `touching(a, b)` selects where an opening can go    | `satisfied: touching` on the artefact                              |
| A shared edge decides a door versus a cased opening | A warning saying a requirement was or was not met, from `touching` |
| Geometry chooses a candidate to try                 | Any prose or field asserting a constraint outcome                  |

`constraints.evaluate` remains the sole satisfaction authority. Generation
proposes; the evaluator judges — which is ADR-0034 §8's diagram, one stage
lower than it drew it.

### 4.5 Not a migration site

`geometry-evaluation.ts:106` and `geometry-synthesis.ts:296` read
`InvariantResult.satisfied` from `evaluatePacking`. That is the **Packing
Contract** — _validation_, asking whether an artefact is well-formed, which
ADR-0034 §4 keeps deliberately distinct from evaluation. Untouched.

---

## 5. The dependency on the new platform API

One new import, from a package already in the allow-list. **No eighth
dependency**, no new peer, and `@archisimple/spatial` gains no new use.

```ts
import {
  evaluateConstraints,
  summariseConstraintResults,
  CONSTRAINT_OUTCOMES,
  CONSTRAINT_RELATIONS,
  CONSTRAINT_STRENGTHS,
  EVALUATION_STAGES,
  type ConstraintEvaluationSummary,
  type ConstraintResult,
  type SpaceConstraint,
  type StageFacts
} from '@archisimple/skills';
```

Renames to absorb, from the same package:

| Was                                 | Now                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `ResolvedRelation.satisfied`        | `ResolvedRelation.storeyPrecondition`                                                   |
| `ScoreCirculationOutput.score`      | `ScoreCirculationOutput.storeyCoverage`                                                 |
| `ScoreLayoutInput.circulationScore` | `ScoreLayoutInput.circulationStoreyCoverage`                                            |
| `ScoreLayoutOutput` — four shares   | `programme`, `requiredAdjacencies`, `preferredAdjacencies`, `circulationStoreyCoverage` |

`scoreLayout` and `scoreCirculation` **stay in use**. They are no longer quality
metrics; they are counts and coverage, and both remain true statements about a
Layout Plan.

---

## 6. How the evaluator is consumed

### 6.1 The rule this sprint holds itself to

> This layer **builds constraints and facts, calls the evaluator, and renders
> results.** It never decides an outcome, never re-derives one, and never states
> a relationship the evaluator did not establish.

### 6.2 Constraints — from `IntendedAdjacency`, which already exists

A `SpaceConstraint` is assembled from the Programme's own intents. Nothing new
is invented, and nothing is read from prose (ADR-0027.1 Rule 6).

| `IntendedAdjacency`   | `SpaceConstraint`                                 |
| --------------------- | ------------------------------------------------- |
| `fromSpaceId`         | `subjectSpaceId`                                  |
| `toSpaceId`           | `objectSpaceId`                                   |
| `strength: required`  | `strength: 'required'`                            |
| `strength: preferred` | `strength: 'preferred'`                           |
| `strength: avoid`     | `strength: 'avoid'`                               |
| `reason`              | `rationale` — carried, never read as evidence     |
| —                     | `relation`: see below                             |
| —                     | `id`: `${fromSpaceId}::${toSpaceId}::${relation}` |

**Relation choice — Q2, decided.** An `IntendedAdjacency` means _these two rooms
belong together_, which ADR-0034 §6 splits into two questions. The mapping is
fixed as:

| Strength    | Relation                 | Why                                                                                                                                                                                                                                        |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `required`  | `traversable-connection` | ADR-AI-0003 Rule 3 makes an explicit relationship `required` or `avoid`, and the template's reasons are about passage — "the entrance reaches the living space without passing through another room". Sharing a wall does not satisfy that |
| `avoid`     | `traversable-connection` | The negative of the same question: a WC must not **open onto** a dining room. Two rooms may share a wall and be fine                                                                                                                       |
| `preferred` | `adjacent`               | A preference for two rooms to be near each other is about the boundary, not a demand for a door                                                                                                                                            |

**One intent produces exactly one constraint.** Emitting both relations was
considered and rejected: two results for one thing the user said is two chances
to report it met, and a reader cannot tell which one their sentence became.

**Circulation reachability** is one constraint per non-circulation space,
`required`, `subjectSpaceId` = the space, no object. Roots are the Programme's
own `FUNCTIONAL_ZONES.Circulation` spaces — supplied, never derived
(ADR-0034 §6.1, and the entrance question stays closed, §7 item 9).

### 6.3 Facts — per stage

| Stage                    | `spaceIds`                    | `adjacentPairs`                           | `traversablePairs`                                       |
| ------------------------ | ----------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| `layout`                 | `plan.spaces` ids             | omitted — a Layout Plan has no boundaries | omitted — it has no openings                             |
| `geometry-specification` | the Specification's space ids | from `GeometryGraph` shared edges         | from `SpecifiedOpening.connects`, `kind` in door/passage |

**`SpecifiedOpening.connects` is the traversable-connection capability, at this
layer's own stage.** It already carries `readonly [string, string]` — the two
spaces an opening joins — and `kind` is already `door` or `passage`, the same two
`packages/spatial` treats as traversable. Nothing new is modelled; the pair list
is a projection of a field this repository has shipped since Sprint 1.1.

At the built stage the same relation comes from `packages/spatial`, and that path
is the **host's** (ArchiSimple Sprint 037.3 wired it in
`apps/web/src/__tests__/constraintEvaluationIntegration.test.ts`). This layer
never sees a built model and acquires no dependency on one.

### 6.4 Calling it

Because the evaluator refuses missing-but-decidable facts, the Layout call omits
both pair lists and gets `NOT_APPLICABLE` for everything — which is the whole
point, and is asserted rather than assumed (§8).

---

## 7. How `layout-quality.ts` changes

### 7.1 The type — Q4, decided

`LayoutQuality` and `computeLayoutQuality` are **removed**, not adapted. The four
`number` fields are ADR-0034 §4.1b's superseded shares, and keeping them under
any name would recreate the second authority item 4 of the brief forbids.

The replacement is **`LayoutSummary` / `computeLayoutSummary`** — deliberately
not `LayoutFit`. "Fit" is still a judgement word; what the function returns is
descriptive facts and counts, and the name should not smuggle back the verdict
the sprint exists to remove. The file becomes `layout-summary.ts`.

```ts
/**
 * What can be said about a Layout Plan — which is less than it used to claim.
 * Facts and counts. No share, no percentage, and no verdict computed here.
 */
export interface LayoutSummary {
  /** Counts from `scoreLayout`. Denominators visible (ADR-0034 §5). */
  readonly programme: ProgrammeCoverage;
  readonly requiredAdjacencies: LayoutAdjacencyTally;
  readonly preferredAdjacencies: LayoutAdjacencyTally;
  /** Storeys that *have* circulation. Presence, never reachability. */
  readonly circulationStoreyCoverage: number;
  /** The authority's answer, at this stage. Every entry NOT_APPLICABLE here. */
  readonly constraints: ConstraintEvaluationSummary;
}
```

A rename is a compile error at every caller, which is the legible reversal
ADR-0034 §4.1 asks for.

### 7.2 The rendering

`describeLayoutQuality` → **`describeLayoutSummary`**, and the four percentage lines
are replaced by counts and an explicit not-yet-evaluable statement. Illustrative,
not final wording:

```text
**What this layout contains**
- Programme: 6 of 6 required spaces
- Required relationships stated: 3 — 1 ruled out by the storey assignment
- Preferred relationships stated: 2
- Circulation: on 1 of 1 storeys

**Not yet checked**
A layout has no walls or doorways yet, so whether these relationships are
actually met cannot be established here. They are checked when the design
reaches geometry.
```

Three properties this must hold (item 7 of the brief, ADR-0034 §10):

1. no sentence asserts a constraint is met;
2. every count shows its denominator;
3. "not yet checked" is distinguishable from "checked and passed" and from
   "nothing was asked" — item 8's four states, in the reader's own words.

### 7.3 The new Specification-stage function

`describeSpecificationCompliance(specification, programme)` — the place a real
verdict is finally rendered, in `src/geometry/`. This is what makes the sprint
worth doing: without it BUG-011's user learns only that nothing could be
checked, and never that the bedroom is unreachable.

```text
**Programme requirements**
- Met: 4 of 5 checked
- bedroom 2 → hallway — no traversable opening connects them
- Not applicable: 0
```

**Q3 — decided: it stays in this sprint.** A sprint that removes a false claim
and adds no true one leaves the user worse informed than before. The two stages
divide as:

| Stage                  | What the card must do                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| Layout                 | say **explicitly** that constraints are not yet checkable, and claim nothing |
| Geometry Specification | give the **first real PASS/FAIL**, naming what failed and why                |

---

## 8. What happens to the existing quality summaries

| Consumer                                       | Today                                              | After                                                                                                              |
| ---------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Layout proposal card (`layout-proposal.ts:44`) | "How well it fits the programme" + 4 percentages   | "What this layout contains" + counts + "not yet checked"                                                           |
| `describeLayout` message (`:62`)               | "Everything the programme asked for is satisfied." | Counts what the storeys **ruled out**; claims nothing about the rest                                               |
| `summarizeLayoutPlan` (`layout-plan.ts:294`)   | "Could not be placed together"                     | Same list, from `storeyPrecondition === 'impossible'` — which is authoritative                                     |
| `CirculationStrategy.description`              | "Every space opens off the …" unconditionally      | States which spaces serve circulation on each storey; asserts no reachability                                      |
| Planning graph circulation edges               | Every space → circulation node                     | **Removed at the Layout stage.** No opening exists to justify one                                                  |
| `GeometryGraph.adjacencies[].satisfied`        | Computed here from `touching`                      | From `constraints.evaluate` at `geometry-specification`. `touching` survives as a **generation input only** (§4.4) |

**Nothing is persisted.** No evaluation result is written onto an artefact —
this repository's rule that derived facts are recomputed is unchanged, and a
stored verdict would go stale on the next revision.

### 8.1 `ResolvedAdjacency.satisfied` — the artefact field

Replaced by `storeyPrecondition: 'possible' | 'impossible' | 'unknown-space' | 'not-constraining'`,
mirroring the platform's vocabulary rather than inventing a second one.

**Project-file compatibility.** `LayoutPlan` is persisted in project file
version 3. An approved plan written before this sprint carries `satisfied` and no
`storeyPrecondition`. Per ADR-0027.1 Rule 4 approved artefacts are immutable, so
they are not rewritten; per ADR-AI-0003 Rule 8's precedent, deserialising an
older artefact must yield the current shape. **An absent `storeyPrecondition`
reads as `unknown-space`** — honest for a plan whose claim we have decided not to
trust — and no consumer branches on file version. Asserted by test (§9).

---

## 9. Scope

### In scope

1. All fourteen sites of §4.
2. `ADJACENCY_TEMPLATE` (§4 of the brief, item 6). The reproduction's required
   denominator was **1** — one assumed `hallway ↔ living room` intent — and no
   hallway→bedroom or hallway→bathroom intent existed at all. Correcting the
   reporting does not give the user the requirement they believed they had. The
   template gains the entries a dwelling actually implies, each `assumed` per
   ADR-AI-0003 Rule 4, seeded after explicit relationships per Rule 5.
3. Specification-stage evaluation and its rendering (§7.3, pending Q3).
4. `docs/architecture/00-current-state.{md,yaml}` — `skillsUsage` gains
   `evaluateConstraints`; the layout-quality entry changes.

### Out of scope

- **An `Entrance` concept** (brief item 9). Roots come from the Programme's
  circulation zoning. ArchiSimple finding I-39 records why.
- **Repeated-space instance identity** (item 10). ADR-0034 §17.1. TC-03/04/05
  stay blocked, and the two `it.todo`s stay.
- **Modifying ADR-0034** (item 12).
- **Publishing anything** (items 13, 14). §11.
- **A constraint-authoring UI**, persisted constraints, a global quality score.
- **Divergence detection** (ADR-0027.1 Rule 12) — comparing the Programme's
  denominator against the plan's own remains unbuilt, and this sprint does not
  build it.

---

## 10. Testing

### 10.1 BUG-011 tests that become green

`src/__tests__/bug-011-constraint-evaluation.test.ts`:

| Test                                                         | Made green by                          |
| ------------------------------------------------------------ | -------------------------------------- |
| `does not assert universal connection … prose`               | Site 11 — `buildCirculation` rewritten |
| `does not attach every space to circulation unconditionally` | Site 10 — `buildGraph` rewritten       |

**Two already pass, and pass for the wrong reason.** ArchiSimple Sprint 037.3
made `computeLayoutQuality` fall back to zeros, so
`does not report full circulation quality when a space cannot reach circulation`
sees `circulationQuality === 0` and its `.not.toBe(1)` holds by accident.
`has the disconnection visible in the graph …` was always green. **Both must be
rewritten to assert the evaluator's answer**, not the fallback's — a test that
passes because a computation broke is not evidence, and ADR-0034 §18 forbids
weakening these but expressly permits extending them.

### 10.2 Tests that remain red or blocked

| Test                                             | Why                                |
| ------------------------------------------------ | ---------------------------------- |
| `cannot name the second bedroom in a constraint` | ADR-0034 §17.1 — needs its own ADR |
| `it.todo` TC-04, TC-05                           | The same                           |

These stay exactly as they are. Passing them by inventing instance identity is
expressly forbidden.

### 10.3 Existing tests that must change

| Test                                                                          | Change                                                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `layout.test.ts` — `satisfies every intent in an ordinary two-storey home`    | Asserts `storeyPrecondition !== 'impossible'`; the title must stop saying "satisfies" |
| `layout.test.ts` — `is recomputed from the plan, and every metric is a share` | There are no shares. Asserts counts and the NOT_APPLICABLE summary                    |
| `layout.test.ts` — `records a cross-zone intent as unsatisfied`               | `storeyPrecondition === 'impossible'` — the authoritative half                        |
| `layout.test.ts` — `reflects a change to the plan …`                          | Recast against the tallies                                                            |

### 10.4 New tests

- **Independence.** A plan whose `ResolvedAdjacency` fields say one thing and
  whose Specification openings say another: the rendering follows the evaluator.
- **The Layout stage claims nothing.** Every result NOT_APPLICABLE; no rendered
  string matches `/satisfied|met|100%|opens off/i`.
- **The four states of item 8** are separately renderable.
- **Reachability end to end.** Brief → Programme → Layout → Geometry →
  Specification for the BUG-011 utterance, evaluated at the Specification stage,
  with a deliberately removed opening producing a named FAIL.
- **Deserialisation.** A Layout Plan fixture carrying the old `satisfied` yields
  `storeyPrecondition: 'unknown-space'` and renders without claiming anything.
- **`ADJACENCY_TEMPLATE`.** The BUG-011 utterance produces a required denominator
  greater than 1, and an explicit relationship still beats an assumed one
  (ADR-AI-0003 Rules 4 and 5 unweakened).

### 10.5 Browser verification

BUG-011 §7 Level 3, deferred by ArchiSimple Sprint 037.3 with cause — the figures
a user sees are rendered here, so a browser pass then would have verified
unchanged text. It belongs to this sprint.

The canonical scenario, in the running application: generate the 100 m² /
2-bedroom / 2-bathroom apartment, and compare **what the review card reports**
against **what the plan actually contains**, at both stages.

| Stage                  | Must be true of the card                                                     |
| ---------------------- | ---------------------------------------------------------------------------- |
| Layout                 | no percentage; no "Every space opens off …"; "not yet checked" present       |
| Geometry Specification | any unreachable space named, with its reason; counts show their denominators |

Requires `apps/web` running against this repository's source — the linked
workspace, not a published version.

---

## 11. Release implications

**Nothing is published by this sprint** (brief items 13 and 14).

- **No package version bump.** Not to make the local workspace compile, and not
  otherwise. The linked `~/Dev/IA` root resolves both repositories to source
  (`linkWorkspacePackages: true`), so the current platform is consumable as-is.
- **`peerDependencies` stay `^0.2.0`.** The platform's semantic change is
  authorised by ADR-0034 §4.1 and, under `0.x`, needs no range change. Raising
  the range is part of a _release_, and this sprint is not one.
- **When a release does happen**, ADR-0030 Rule 8's order stands and is
  unchanged: `archisimple` publishes the platform, this repository raises its
  range and publishes, then `apps/web` points `optionalDependencies` at it.
- **ArchiSimple finding I-41** records the window in which a released platform
  and a released intelligence disagree. This sprint closes that window from this
  side; it does not remove the need for the cross-repository check the finding
  asks for.

---

## 12. Decisions — resolved at review (revision 1.1)

| #      | Question                                                | Resolution                                                                                                                                                          |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1** | Migrate `GeometryGraph.adjacencies[].satisfied`?        | **Yes** — §4.4. With the constraint that geometric facts (touching, shared edges) remain legitimate _generation_ inputs and may never be called satisfaction        |
| **Q2** | Which relation does each strength become?               | **The split** — `required` → `traversable-connection`, `avoid` → `traversable-connection`, `preferred` → `adjacent`. One intent, one constraint (§6.2)              |
| **Q3** | Specification-stage evaluation here, or Sprint 1.9?     | **Here.** Layout says explicitly that constraints are not yet checkable; the Specification gives the first real PASS/FAIL (§7.3)                                    |
| **Q4** | What replaces `LayoutQuality` / `computeLayoutQuality`? | **Removed**, and replaced by `LayoutSummary` / `computeLayoutSummary` — not `LayoutFit`, because the result is descriptive facts and counts, not a judgement (§7.1) |

### The standing prohibition this adds

> Do not recreate `satisfied`, `score`, percentages, or another derived quality
> authority under different names.

It applies to every field, function and rendered string this sprint touches, and
it is what §13's architecture checklist verifies. A rename that preserves the
semantics is the failure mode — `fit`, `health`, `compliance` and `confidence`
are all the same defect with a different label.

---

## 13. Definition of done

### Engineering

- [ ] `pnpm build`, `pnpm lint`, `pnpm test` pass in this repository
- [ ] `pnpm build` and `pnpm test` pass across the linked `~/Dev/IA` workspace
- [ ] `pnpm depcruise` passes in `archisimple`, with the dependency allow-list still exactly seven
- [ ] `architecture-compliance.test.ts` passes — no core, no dispatcher, no MCP

### Architecture

- [ ] No production reference to `ResolvedRelation.satisfied` remains
- [ ] No production reference to `ScoreCirculationOutput.score` remains
- [ ] Exactly one satisfaction authority — `constraints.evaluate` — and no percentage recreated
- [ ] **§12's prohibition holds**: no `satisfied`, no `score`, no percentage and
      no derived quality authority under any other name. Geometric facts appear
      only as generation inputs, never as an outcome (§4.4)
- [ ] No generated prose or graph edge asserts a relationship the evaluator did not establish
- [ ] Evaluated / failed / not-applicable / nothing-asked remain four distinguishable states
- [ ] No `Entrance` concept; no instance identity; ADR-0034 unmodified
- [ ] No eighth dependency; `@archisimple/spatial` gains no new use
- [ ] No evaluation result persisted on any artefact

### Product

- [ ] The BUG-011 card no longer claims 100% of anything
- [ ] An unreachable space is named to the user at the Specification stage
- [ ] Browser verification recorded (§10.5)
- [ ] A pre-sprint project file still loads and renders

---

## 14. Stop conditions

Implementation **stops for review** if:

- **S1** — the evaluator needs a fact this layer cannot supply at a stage it must
  report on. → the stage capability table is wrong, and that is ADR-0034's.
- **S2** — a BUG-011 target cannot be met without instance identity. → §17.1;
  the target stays blocked.
- **S3** — honouring item 7 would leave the Layout card with nothing useful to
  say. → the Specification-stage rendering is not optional after all (Q3).
- **S4** — a fourth relation is needed. → reopen ADR-0034 §6; do not add one.
- **S5** — `ADJACENCY_TEMPLATE` cannot be corrected without contradicting
  ADR-AI-0003 Rule 5. → an ADR-AI-0003 amendment, not an implementer's call.
- **S6** — the platform must change again. → back to `archisimple`; this
  repository does not work around a platform gap.
- **S7** — replacing `ResolvedAdjacency.satisfied` proves to break an approved
  artefact's readability. → a persistence decision, and ADR-0027.1 Rule 4's.

---

## 15. Why this is one sprint and not three

The migration, the template and the Specification-stage rendering look
separable, and are not. Splitting them produces, in order: a repository that
does not compile; a review card that claims nothing and explains nothing; and a
requirement the user believed they had, still absent. Each intermediate state is
worse for a user than the defect being fixed.

---

## 16. What implementation changed

Three things the design got wrong, each caught by a test rather than by review.

### 16.1 The `ADJACENCY_TEMPLATE` rows were wrong, and are **not** added

§9 scoped a `hallway → bedroom` and `hallway → bathroom` template row, on the
reasoning that the reproduction's required denominator was 1 and the user
believed they had asked for a reachable bedroom.

It was implemented, and `layout.test.ts` failed immediately: in a **two-storey**
house the bedrooms are upstairs and the hallway is on the ground floor, so the
new requirement resolves as `impossible` for every ordinary home. The platform
would have invented a requirement and then reported it unmeetable — Bug 003's
lesson exactly, that an invented requirement is worse than a missing one.

What a user means is _a bedroom is entered from circulation_, where circulation
is whichever space serves that storey — a landing upstairs, a hallway below.
`IntendedAdjacency` names two spaces and **cannot express "any circulation
space"**, so the requirement is not statable in the template at all.

It is statable as **circulation reachability**, which is a relation over the
whole circulation system rather than a pair, and which `constraints.evaluate`
now answers. `circulationReachabilityConstraints` states one per space, so
BUG-011's missing denominator is supplied — properly, and at a stage that can
check it. The template is left exactly as it was, with a comment recording why
the obvious row is absent.

**Item 6 of the brief is met by the reachability constraints, not by new
template rows.** That is a change to how, not to whether.

### 16.2 `evaluateSpecification` used the wrong id space

Caught by the first run of the rewritten BUG-011 Test C, which found no failure
where one plainly existed.

`SpecifiedSpace.id` is a **polygon** id and `SpecifiedSpace.spaceId` is the
programme space id, and the Specification mixes them: `SpecifiedOpening.connects`
names spaces, while `SpecifiedWall.separates` names polygons. Constraints name
spaces. The first implementation built its fact base from `space.id`, so every
constraint named something the facts did not contain and the whole evaluation
was silently vacuous.

Both are now translated explicitly, `separates` through `SpecifiedSpace`, with
the reason written down. A space with `count: 2` produces two polygons sharing
one `spaceId`, which is why the fact base deduplicates.

### 16.3 The last percentage was still there

`LayoutSummary` carried the platform's `circulationStoreyCoverage` — a 0–1 share
— and rendered it as `on 100% of storeys`. §12's prohibition covers it as much
as the four it was written for, and the rendered card matched a test asserting no
claim of satisfaction.

Replaced by `CirculationCoverage { storeys, withCirculation, unservedStoreys }`.
There is now **no share anywhere** in this repository's summary output.

### 16.4 Delivered

| Item                                         | Outcome                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| All 14 migration sites                       | Done, including §4.4's three under Q1                                            |
| `GeometryAdjacency.satisfied` → `sharesWall` | Done. The geometric fact survives as a generation input and names itself as one  |
| Layout stage                                 | Every constraint `NOT_APPLICABLE`, from the authority; the card says so          |
| Specification stage                          | First real PASS/FAIL, rendered on the review card                                |
| BUG-011 Test C                               | **All four assertions green**, two of them rewritten off their wrong-reason pass |
| BUG-011 Test D                               | **Still red**, still blocked by ADR-0034 §17.1                                   |
| Tests                                        | 24 files, 865 passing, 1 failing by design, 2 `it.todo`                          |

### 16.5 Still outstanding

- **Browser verification (§10.5)** has not been run. It needs `apps/web` driven
  against this source, and is the one Definition-of-done item left open.
