# Bug 004 — the Brief cannot record a relationship between two spaces

**Status:** Fixed\
**Severity:** Medium\
**Affected area:** Architectural Intelligence — Architectural Brief, Space Programme\
**Discovered:** 2026-08-11 (split out of [bug-003](bug-003-programme-generator.md))\
**Decided by:** [ADR-AI-0003](../adr/ADR-AI-0003-explicit-spatial-relationships.md)\
**Repository:** `architectural-intelligence`

## Summary

A user stated an explicit spatial constraint and the platform discarded it:

> Build me a 100m2 appartment with 2 bedrooms, 1 bathrooms, and a small office.
> **Kitchen and Dining/Lounge area are separated**

The Brief records the spaces. It records no relationship between them, because
it has nowhere to put one. The Space Programme then states the opposite of what
was asked, from its own template:

> living room ↔ kitchen — the two shared daytime spaces usually open onto each
> other

This is not a regression and not a defect in the Programme generator. It is a
capability that has never existed. Bug 003 fixed the three defects around it and
deliberately left this one out, because it is a schema change rather than a fix.

## Why it is not a small change

`DesiredSpace` is `{ name, count }`. There is no relationship field on the Brief,
and `planning_captureBrief` has no relationships argument, so there is no path
from the user's sentence to the artefact.

The downstream half already exists: `IntendedAdjacency` carries
`ADJACENCY_STRENGTHS.Avoid`, which ADR-0027.1's own commentary describes as _"a
requirement in its own right"_ — exactly the right representation for
"separated". So the target shape is settled; what is missing is the source, and
the provenance to defend it.

`IntendedAdjacency` has no provenance field. Without one, the rule the fix needs
to enforce —

> a generated relationship must not contradict an explicit one

— cannot be expressed, because nothing distinguishes the two. The Programme
already makes this exact distinction twice, for areas (`AREA_SOURCES`) and for
spaces (`SPACE_PRIORITIES`); relationships are the third thing the artefact
derives and the only one that does not say so.

## Scope

### In scope

- A relationship vocabulary on the Brief — at minimum "adjacent" and "separated"
  between two named spaces.
- A `relationships` argument on `planning_captureBrief`, and a deterministic
  reader for the offline path so the two agree (the lesson of bug-003).
- Provenance on `IntendedAdjacency`, mirroring the existing source vocabulary
  rather than inventing a fourth.
- Seeding `adjacenciesFor` from the Brief's relationships **before** the template
  applies, with explicit relationships winning any pair the template also names.
  The unordered pair guard added by bug-003 is the mechanism; it only needs the
  explicit set inserted first.
- Carrying the constraint into the Layout stage in machine-readable form.

### Out of scope

- Layout optimisation, geometry synthesis, wall thickness.
- Enforcing the constraint geometrically. Recording and propagating it is this
  bug; a layout that honours it is the Layout Plan's problem.

## What constrained the design

**Persistence was not a blocker.** `PlanningArtefactSnapshot` in
`@archisimple/persistence` stores each artefact's `value` **opaquely** — it
validates `kind`, `id`, `revision` and `approvedAt`, and nothing inside. Adding an
optional field to the Brief therefore needed no file-version bump and no platform
release, so the whole change stayed in this repository and avoided the ADR-0030
Rule 8 release ordering entirely. This is the one respect in which bug-004 was
cheaper than bug-003, whose skills half does have to ship first.

**ADR-0027.1 Rule 4 needed thought, not avoidance.** Approved artefacts are
immutable and a user may already hold an approved Brief. Sprint 27.9 faced the
same constraint and _declined_ to add a field, deriving `SPACE_PRIORITIES` from
the existing `source` instead. That reasoning does not carry here: a priority was
recoverable from what the Brief already recorded, and a relationship the user
stated is recoverable from nothing at all. So the field is real, and Rule 8 makes
it optional rather than avoiding it.

**Rule 3 was the trap.** A relationship is not geometry and must not acquire a
distance, a wall, or a shared edge. "Separated" means _not adjacent_; it does not
mean "at least 3 m apart". The type has four fields and a test asserts it stays
that way.

## The fix

Nine rules, in [ADR-AI-0003](../adr/ADR-AI-0003-explicit-spatial-relationships.md).
What landed:

**`architectural-brief.ts`** — `SPACE_RELATIONSHIP_KINDS` (`adjacent`,
`separated`) and `SpaceRelationship { from, to, kind, source }`, carrying space
**names** because `DesiredSpace` has no id (Rule 2). `withRelationship` replaces
by unordered pair, so a user changing their mind produces one relationship rather
than two contradicting each other. `relationships` defaults to empty, so a Brief
approved before this deserialises to the current shape (Rule 8).

**`brief-topics.ts`** — `readSpaceRelationships`, five phrasings, read per
sentence. The capture fragment bars connectives from _inside_ a space name, which
is what stops "A house with the kitchen next to the dining room" naming a space
called "house with the kitchen" — a lazy pattern does not help, because the engine
tries the earliest start position first.

**`brief-assembly.ts` / `brief-tools.ts`** — a `relationships` tool argument, and
`mergedRelationships` folding the deterministic reader in underneath it, so the
model wins a pair it stated and the reader still catches a pair it missed
(Rule 7). Same asymmetry bug-003 established for topics. An unrecognised `kind`
is dropped rather than defaulted: guessing between "adjacent" and "separated"
states the opposite of the requirement half the time.

**`space-programme.ts`** — `IntendedAdjacency.source`, reusing
`BriefRequirementSource` rather than adding a fourth provenance vocabulary
(Rule 4). `summarizeProgramme` now lists **You asked for** above **Should be
adjacent**, and shows separations — it filtered every `avoid` out of the card
before, which was tolerable while all of them were the platform's own idea and is
not once a user can state one.

**`programme-synthesis.ts`** — explicit relationships are resolved by role and
seeded **before** `ADJACENCY_TEMPLATE` runs. The unordered pair guard added by
bug-003 then makes any template naming that pair a no-op, so Rule 5 is a property
of ordering rather than a validation pass someone has to remember (the tautology
bug-003 declined to build). An unresolvable name warns and is dropped (Rule 6).

### Nothing below the Programme changed

As Rule 9 predicted. `resolveAdjacencies` has mapped `avoid` → `separated` since
Sprint 28.0, and `layout-synthesis.ts` has put a separation edge in the planning
graph ever since. The end-to-end test asserts that rather than trusting it.

## Result

The same tool call, with the model passing **no** relationships:

```text
Brief         kitchen ⇹ dining/lounge   separated, stated
Programme     kitchen ⇹ dining/lounge   avoid, source: stated
Layout        edge kind: separated
```

The template's `kitchen ↔ dining` _required_ adjacency — which previously
contradicted the user outright — is suppressed. The review card reads:

> **You asked for**
>
> - kitchen ⇹ dining/lounge — you asked for these to be kept separate
>
> **Should be adjacent**
>
> - hallway ↔ dining/lounge — the entrance reaches the living space…
> - bedroom ↔ bathroom — a bathroom is reachable from the sleeping area at night

## Tests

`src/__tests__/space-relationships.test.ts` — 26 assertions, organised by ADR
rule so a failure names the rule it broke. Covers the five readable phrasings and
the backwards-capture guard; both paths agreeing; the model overriding the
reader; an unrecognised kind dropped; no distance on the type; stated → `avoid` /
`required` but never `preferred`; provenance on both sides; role resolution
("lounge" finding the dining/lounge); the template suppressed on a stated pair
and free elsewhere; an unmatched name warning; a relationship-free Brief still
working; the full chain to a layout edge; and what the two review cards show.

Full suite: 684 tests green, lint and `tsc -b` clean.

## Definition of Done

- [x] An ADR records the decision, with numbered rules later work can cite.
- [x] Explicit Brief relationships survive into the Space Programme structurally.
- [x] A generated relationship cannot contradict an explicit one, and provenance
      makes the difference visible on the review card.
- [x] The offline and model paths produce the same relationships from the same
      sentence.
- [x] The reported scenario is a regression test: kitchen and dining/lounge are
      recorded as separated, and no template relationship overrides it.
- [x] Existing tests remain green, including bug-003's `brief-fidelity.test.ts`.

## Still open

**Enforcement is not verification.** The Layout receives the separation edge and
the packer arranges around it, but nothing asserts afterwards that the produced
arrangement actually kept the two apart. `layout-quality.ts` computes
`requiredAdjacencySatisfaction`; the equivalent for separations exists in
`ResolvedAdjacency.satisfied` and is not surfaced as its own figure. Worth a look
before anyone claims the constraint is _honoured_ rather than _carried_.

**Relationships between more than two spaces** ("bedrooms away from all living
areas") still have to be stated pairwise.
