# Bug 004 — the Brief cannot record a relationship between two spaces

**Status:** Open — needs an ADR before implementation\
**Severity:** Medium\
**Affected area:** Architectural Intelligence — Architectural Brief, Space Programme\
**Discovered:** 2026-08-11 (split out of [bug-003](bug-003-programme-generator.md))\
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

## Notes for whoever picks this up

**Persistence is not a blocker.** `PlanningArtefactSnapshot` in
`@archisimple/persistence` stores each artefact's `value` **opaquely** — it
validates `kind`, `id`, `revision` and `approvedAt`, and nothing inside. Adding
an optional field to the Brief therefore needs no file-version bump and no
platform release, so the whole change stays in this repository and avoids the
ADR-0030 Rule 8 release ordering entirely.

**ADR-0027.1 Rule 4 needs thought, not avoidance.** Approved artefacts are
immutable and a user may already hold an approved Brief. A new field must be
optional, and a Brief without it must stay valid and readable — the same
constraint Sprint 27.9 worked around when it declined to add a priority field to
the Brief and derived `SPACE_PRIORITIES` from the existing `source` instead.
Whether that reasoning applies again here, or whether relationships genuinely
warrant a new field, is the decision the ADR has to make.

**Rule 3 is the trap.** A relationship is not geometry and must not acquire a
distance, a wall, or a shared edge. "Separated" means _not adjacent_; it does not
mean "at least 3 m apart".

## Definition of Done

- [ ] An ADR records the decision, with numbered rules later work can cite.
- [ ] Explicit Brief relationships survive into the Space Programme structurally.
- [ ] A generated relationship cannot contradict an explicit one, and provenance
      makes the difference visible on the review card.
- [ ] The offline and model paths produce the same relationships from the same
      sentence.
- [ ] The reported scenario is a regression test: kitchen and dining/lounge are
      recorded as separated, and no template relationship overrides it.
- [ ] Existing tests remain green, including bug-003's `brief-fidelity.test.ts`.
