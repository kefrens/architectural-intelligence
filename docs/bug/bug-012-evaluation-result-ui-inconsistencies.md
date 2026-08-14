# BUG-012 — Evaluation result is not consistently reflected in the generated design UI

**Status:** Resolved  
**Scope:** ArchiSimple / Architectural Intelligence integration  
**Related:** BUG-011, ADR-0034, ADR-AI-0001, Sprint 037.3, Sprint 001.8  
**Priority:** High

## Resolution (2026-08-14)

All four findings were addressed in `architectural-intelligence` (the fifth is
documentation-only, in ADR-AI-0001):

- **Finding 1** — `describeEvaluation` (`src/geometry/geometry-evaluation.ts`)
  no longer prints a percentage for a `PackingEvaluation` objective. Objectives
  with nothing to report are omitted entirely; the remainder show the
  qualitative miss with no numeric score, so nothing on the Geometry Graph card
  competes with the Specification stage's authoritative "Met: N of M checked."
  The structural "Guaranteed" / "Not satisfied" invariant section is unchanged
  — it was never a percentage claim.
- **Finding 2** — `describeSpecificationCompliance`
  (`src/geometry/specification-compliance.ts`) now takes the `GeometrySpecification`
  alongside the `SpecificationCompliance` and renders each failure from the
  constraint's structured `subjectSpaceId` / `objectSpaceId` / `relation` /
  `reasonCode`, resolved to the space's `name`. An id shared by more than one
  instance (a repeated space) falls back to a generic form ("a bedroom")
  rather than guessing an instance — ADR-0034 §17.1's repeated-space identity
  stays deferred. The evaluator itself is untouched: `constraint-evaluation.ts`
  still reasons and reports in ids.
- **Finding 3** — `toGeometrySpecificationProposal`
  (`src/geometry/specification-proposal.ts`) adds a `warnings` entry when the
  compliance verdict has unmet requirements, naming the count. It renders
  through the same `ai-proposal__warnings` list the UI already shows
  (`color: var(--color-warning)`), visible beside the green
  `ai-proposal__outcome--success` "Recorded with the project." message rather
  than replacing it — the record did succeed, and this bug does not decide
  whether it should have been allowed to. No change to `success`, `outcome`,
  or `ArtefactApprovalSink` — no new approval semantics.
- **Finding 4** — audited. The growth-never-shrink behaviour was already
  intentional and already reported (`warnings` for the room, `assumptions` for
  the storey), so this is a documentation gap rather than a code defect: the
  contract lived only in source comments in `wall-realisation.ts` and
  `specification-synthesis.ts`, not in anything a later reader could cite.
  ADR-AI-0001 revision 2.1 adds **Rule 12**, stating it explicitly. No
  behaviour changed.

### Finding 1 follow-up (2026-08-14) — a second raw-id path in the Geometry card

Browser verification after the fixes above still showed one raw space UUID in
the Geometry card's **"Can be improved"** section: `7d87a…22 ↔ fa47…38 ended
up adjacent — …`. Finding 2's fix covered the Specification-stage evaluator's
`ConstraintResult` (ADR-0034, `packages/skills/src/constraints/`); this is a
separate, older path that Finding 1's percentage removal did not touch, because
it lives one level down, in the legacy Geometry Packing Contract skill itself.

**Root cause.** `O1` (`adjacencySatisfaction`) and `O3`
(`separationRespected`) in
`packages/skills/src/geometry-realisation/packing-evaluation.ts` built their
`misses` strings directly from `EvaluatedAdjacency.fromSpaceId`/`toSpaceId` —
the Layout Plan's own space ids — rather than from a placed polygon's `name`,
even though the same function already has every placed polygon (with its name)
in scope as `usable`. `describeEvaluation` (`geometry-evaluation.ts`) just
renders `objective.misses` verbatim, so the id reached the user unchanged.

**Fix.** Added a package-local `nameOf(usable, spaceId)` in
`packing-evaluation.ts` — the same shape as Finding 2's resolver, but reading
`Placed.polygon.name` instead of `SpecifiedSpace.name`, since this evaluator
already carries placed polygons rather than a Specification. A space id with
exactly one placed instance resolves to that instance's name; an id shared by
more than one instance (a repeated space, e.g. `count: 2`) falls back to a
generic form ("a bedroom") rather than guessing which instance the miss is
about — the same ADR-0034 §17.1 deferral Finding 2 already respects. `O1` and
`O3` both call it; `evaluatePacking`'s ids-in, the constraint evaluator, ADR-0034
semantics, and workflow/approval semantics are all untouched — this is
presentation only, inside a skill that already documented its `misses` as
"each with a reason a user can read."

**Tests.** Two tests added to
`packages/skills/src/__tests__/geometry-realisation.test.ts`: one drives `O1`
and `O3` with UUID-shaped space ids matching the reported string and asserts
the ids are absent from the miss while the room names are present; the other
covers the repeated-space case and asserts the generic fallback ("a bedroom")
rather than either instance's specific name. All pre-existing `O1`/`O3` tests
still pass unchanged.

**Validation.** `@archisimple/skills`: 310 tests passed (2 pre-existing todo),
build and lint clean. `@archisimple/architectural-intelligence`: rebuilt against
the updated skill, 866 tests passed (1 pre-existing, unrelated failure in
`bug-011-constraint-evaluation.test.ts`, confirmed present on `main` before this
change via `git stash`), build and lint clean. `apps/web`: typecheck clean,
995 tests passed, `pnpm depcruise` clean (no dependency violations).

This closes Finding 1 fully; Finding 1's original acceptance criteria named
percentages specifically; raw ids in an objective's `misses` were a
pre-existing, adjacent defect this follow-up also removes rather than a
regression from the original fix.

Not addressed here, by design: what a `fail` verdict means for the workflow.
See the next ADR, and the `Explicitly out of scope` section below.

## Summary

Browser verification of the first end-to-end generated apartment exposed several remaining inconsistencies after the authoritative constraint-evaluation foundation was implemented.

The evaluator now correctly detects that the generated buildable specification does not satisfy all programme requirements. However, the user-facing pipeline still contains legacy quality information, exposes internal identifiers, and records a failed specification as if it were simply completed.

The underlying evaluator is **not** the problem demonstrated here. The problem is the integration and presentation of its result.

This report intentionally does **not** decide what the workflow should do when evaluation fails. That decision belongs to the next architectural decision: **what does FAIL mean for the planning/realisation workflow?**

---

# Finding 1 — Legacy percentage quality metrics remain visible

## Observed

The Geometry card still displays percentage-based quality claims such as:

- 100% adjacency
- 100% room size
- 0% avoided adjacency

These metrics were superseded by ADR-0034 and the authoritative evaluator.

## Problem

The browser is still showing information that no longer represents the authoritative evaluation model.

The evaluator says:

> 6 of 8 requirements met

while the Geometry card presents:

> 100% / 100% / 0%

A user cannot reliably understand which statement is authoritative.

## Expected

The UI should no longer present superseded percentage-based quality claims as authoritative design-quality claims.

## Acceptance criteria

- No legacy percentage-based quality claims remain in the Geometry review.
- No superseded `LayoutQuality`-style result is presented as authoritative.
- The UI does not imply that a percentage means programme compliance.
- ADR-0034 remains the source of truth.

---

# Finding 2 — Evaluation failures expose internal UUIDs

## Observed

The Specification card reports failures like:

```text
e1b5d4f8-a315-4ccb-8937-cb6376b4bb22
cannot be reached from
02373a94-eafc-44ab-98f5-c4decf5fcc69
```

These are internal space identifiers.

## Problem

The evaluator correctly operates on stable IDs. Those IDs should remain internal.

The presentation layer should translate them into human-readable architectural entities.

## Expected

The user should see something such as:

> Bedroom 1 cannot be reached from the circulation.

or, where instance identity is not yet available:

> A bedroom cannot be reached from the circulation.

The evaluator itself should remain ID-based.

## Acceptance criteria

- Evaluator result contracts continue to use stable IDs.
- User-facing messages do not expose raw UUIDs.
- Existing room names are used where they are unambiguous.
- The implementation does not prematurely introduce the repeated-space identity model deferred by ADR-0034 §17.1.
- Ambiguous repeated spaces fall back to safe human-readable wording.

---

# Finding 3 — Failed evaluation is presented as a completed specification

## Observed

The Specification stage reports:

```text
Programme requirements

Met: 6 of 8 checked
```

but then concludes:

> Recorded with the project.

## Problem

ADR-0034 defines how constraints are evaluated, but deliberately does not define what the workflow must do with a `fail` result.

The current behaviour nevertheless creates ambiguity:

- Is the specification valid?
- Is it approved?
- Can it be realised?
- Is the failure merely informational?
- Should the system try to improve it?

## Expected for this bug

Until failure semantics are decided, the UI must **not imply that a failed design is equivalent to a successfully compliant design**.

The result should be presented as a failed/partially satisfied evaluation without inventing workflow policy.

## Explicitly out of scope

This bug does **not** decide:

- whether FAIL blocks approval;
- whether FAIL automatically triggers optimisation;
- whether the user can explicitly accept a failing design;
- whether the system should offer “Improve design”;
- whether failed specifications should be persisted as approved artefacts.

Those decisions belong to the next ADR:

> **What does FAIL mean?**

---

# Finding 4 — Geometry approval is not obviously preserved by Specification generation

## Observed

The approved Geometry is reported as approximately:

```text
100 m²
```

The resulting Geometry Specification is reported as:

```text
101.7 m²
```

The specification explains:

> The ground floor grew by 900 mm × 800 mm to make room for the walls; the rooms kept their sizes and the building got bigger, rather than the other way round.

It also reports changes such as:

```text
bedroom grew by 100 mm × 0 mm because walls were inserted across it
bedroom grew by 0 mm × 100 mm because walls were inserted across it
living room grew by 100 mm × 0 mm because walls were inserted across it
...
```

## Problem

The user approved the Geometry artefact.

The Specification stage then appears to transform that approved geometry.

That may be intentional, but there is currently no demonstrated contract defining what changes are permitted.

This matters especially for future renovation workflows where approved geometry may contain constraints such as:

- do not move this wall;
- preserve this external boundary;
- preserve window positions;
- do not change room dimensions beyond a tolerance.

## Required investigation

Before treating this as a confirmed defect, establish the intended Geometry → Geometry Specification contract:

1. Is wall insertion explicitly allowed to enlarge the approved geometry?
2. Is the 1.7 m² increase within an existing tolerance?
3. Are room dimensions supposed to remain invariant?
4. Is the Specification a new derived artefact with permitted geometric changes, or a more concrete representation of exactly the approved geometry?
5. Do such changes require user visibility or approval?

## Acceptance criteria

Do not define final acceptance criteria until this contract has been audited.

If intentional, document the transformation contract.

If not intentional, create a dedicated fix with explicit regression tests.

---

# Relationship to BUG-011

BUG-011 exposed the broader problem:

> A generated plan does not fully satisfy the programme.

The evaluation foundation now detects the failure correctly.

The relationship is therefore:

```text
BUG-011
generation produced a non-conforming plan
        ↓
ADR-0034
authoritative evaluation foundation
        ↓
evaluator correctly detects failure
        ↓
BUG-012
UI/workflow does not yet represent that result consistently
```

BUG-011 should not be considered fully closed until the resulting failure can be presented and handled coherently.

The actual workflow semantics remain deferred to the next ADR.

---

# Scope

## In scope

- Remove obsolete quality percentages from user-facing design review.
- Present evaluator failures using human-readable architectural entities.
- Make the failed evaluation state visible without inventing approval semantics.
- Audit Geometry → Specification transformation and its contract.

## Out of scope

- Defining what `FAIL` means operationally.
- Automatic geometry optimisation.
- Repeated-space instance identity.
- New entrance semantics.
- PDF/import workflows.
- Renovation constraint authoring.

---

# Proposed implementation order

1. Audit the remaining Geometry UI quality path.
2. Remove legacy percentage-based claims.
3. Add presentation-layer resolution of evaluator IDs.
4. Audit the Geometry → Specification transformation.
5. Keep failed evaluation visible and truthful.
6. Do **not** introduce workflow behaviour for FAIL in this bug.
7. Create the next ADR defining the semantics of `FAIL`.

---

# Definition of Done

- [x] Legacy Geometry percentage metrics are removed or replaced with ADR-0034-compliant information.
- [x] Raw UUIDs are not exposed in user-facing evaluation messages.
- [x] Evaluation failures are visibly distinguished from successful compliance.
- [x] No new approval/optimisation semantics are introduced by this bug.
- [x] Geometry → Specification transformation has been audited and either documented as intentional or fixed with regression tests. — audited, found intentional and already reported to the user; now documented as ADR-AI-0001 Rule 12 rather than only in source comments.
- [x] BUG-011 status is updated to reflect that detection is solved but end-to-end failure handling remains pending.
- [ ] Browser verification confirms the corrected presentation. — a manual pass through the AI Workspace (2026-08-14) confirmed Findings 1–4 and surfaced the Finding 1 follow-up above (a second raw-id path in the Geometry card's "Can be improved" section). That follow-up is now fixed and covered by an automated regression test, but has not yet been re-verified in the browser — this item stays open until it is.
- [x] The next ADR can define FAIL semantics without having to undo presentation-layer work from this bug.

---

# Architectural principle

> **The evaluator reports architectural facts; the workflow decides what those facts mean operationally.**

This bug should improve the truthfulness and readability of the first without prematurely deciding the second.
