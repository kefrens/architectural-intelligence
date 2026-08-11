# ADR-AI-0003: Explicit Spatial Relationships

- **Status:** Accepted
- **Revision:** 1.0
- **Date:** 2026-08-11
- **Deciders:** ArchiSimple Project
- **Relates to:** ADR-AI-0001 (the five artefacts), ADR-AI-0002 (workflow state), ArchiSimple ADR-0027.1 (planning pipeline, Rules 3, 4, 6, 9, 11), ADR-0030 (Rule 4 — the platform arrives by version)
- **Implemented by:** Bug 004

---

## Revision History

| Revision | Date       | Change                                                                                                                                                       |
| -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.0      | 2026-08-11 | Initial decision. Gives the Architectural Brief a vocabulary for stated relationships between spaces, and the Space Programme the provenance to defend them. |

---

## Context

A user said this:

> Build me a 100m2 appartment with 2 bedrooms, 1 bathrooms, and a small office.
> **Kitchen and Dining/Lounge area are separated**

The platform discarded the second sentence, and then contradicted it. The Space
Programme's review card offered:

> living room ↔ kitchen — the two shared daytime spaces usually open onto each
> other

There was no defect to fix. `DesiredSpace` is `{ name, count }`, the Brief has no
relationship field, and `planning_captureBrief` has no relationships argument.
There is no path from that sentence to the artefact, so the constraint was never
lost — it was never captured.

### What already exists

The remarkable part is how little is missing. The **entire downstream chain
already handles separation**:

```text
IntendedAdjacency          strength: 'avoid'
        ↓                  (space-programme.ts — shipped Sprint 27.9)
resolveAdjacencies         'avoid' → relation: 'separated'
        ↓                  (@archisimple/skills — shipped Sprint 28.0)
LAYOUT_EDGE_KINDS.Separated  a separation edge in the planning graph
                           (layout-synthesis.ts — shipped Sprint 28.0)
```

Sprint 27.9's own commentary already argued the semantics this ADR needs:

> `avoid` is not the absence of a relationship — it is a requirement in its own
> right, and a layout that puts the WC off the dining room has violated
> something the programme said, not merely failed to satisfy something it wanted.

So the representation is settled and the consumers are built. What is missing is
the **source** — a way for the user to state one — and the **provenance** to stop
a template overriding it.

### Why provenance is the hard half

`IntendedAdjacency` carries `fromSpaceId`, `toSpaceId`, `strength` and a prose
`reason`. Nothing on it distinguishes a relationship the user demanded from one
`ADJACENCY_TEMPLATE` assumed because most dwellings are like that.

Without that distinction the rule this change exists to enforce —

> a generated relationship must never contradict an explicit one

— cannot even be stated, because there is no predicate for "explicit".

This is the third time the Space Programme has needed to say where something came
from. It already does so for areas (`AREA_SOURCES`) and for spaces
(`SPACE_PRIORITIES`, derived from the Brief's `BRIEF_REQUIREMENT_SOURCES`).
Relationships are the one derived thing in the artefact that stays silent about
its own origin, and the review card consequently presents a template's opinion in
the same voice as the user's requirement.

### The temptation to refuse

The obvious move is to let a relationship carry a distance — "separated by at
least 3 m", "within 2 m". That is geometry, in the two artefacts ADR-0027.1
Rule 3 exists to keep free of it, and it would put coordinates two stages above
where coordinates begin. The Brief holds no areas; it will hold no distances
either.

---

## Decision

**The Architectural Brief gains a vocabulary for relationships between named
spaces, and the Space Programme records the provenance of every relationship it
holds. An explicit relationship outranks a derived one, always.**

A relationship is topological, never metric. It says _whether_ two spaces should
be together, never _how far apart_ they are.

```text
Brief.relationships          from: "kitchen", to: "dining/lounge", kind: "separated"
        ↓                    (names, resolved by role)
IntendedAdjacency            strength: 'avoid', source: 'stated'
        ↓                    (existing, unchanged)
Layout planning graph        a separation edge
```

---

## Rules

**Rule 1 — A Brief relationship is topological, never metric.**
The vocabulary is exactly two kinds: `adjacent` and `separated`. No distance, no
wall, no shared edge, no orientation. "Separated" means _not adjacent_; it does
not mean "at least 3 m apart" (ADR-0027.1 Rule 3).

**Rule 2 — Relationships name spaces, they do not identify them.**
`SpaceRelationship` carries the space **names** the Brief already uses.
`DesiredSpace` has no id and gains none: minting ids in the Brief would make the
artefact's identity graph a second thing to keep consistent across revisions, for
no consumer that needs it. The Space Programme resolves names to its own space
ids when it builds `IntendedAdjacency`, using the same role matching that decides
which spaces exist.

**Rule 3 — An explicit relationship is `required` or `avoid`, never `preferred`.**
`ADJACENCY_STRENGTHS.Preferred` means _the platform thinks this would be nice_. A
user who says two rooms are separated has not expressed a preference. `adjacent`
maps to `required`, `separated` maps to `avoid`, and nothing the user states
arrives as a preference.

**Rule 4 — Every `IntendedAdjacency` records where it came from.**
`source` reuses `BriefRequirementSource` — `stated`, `answered`, `assumed` —
rather than introducing a fourth provenance vocabulary. It is the same question
with the same three answers, and the Programme already derives `SPACE_PRIORITIES`
from that record. A relationship from `ADJACENCY_TEMPLATE` is `assumed`.

**Rule 5 — Explicit relationships are applied first, and a derived relationship
may not restate a pair.**
Synthesis seeds the Brief's relationships before `ADJACENCY_TEMPLATE` runs, and
the unordered pair guard makes any later template naming the same two spaces a
no-op. This is the enforcement mechanism for "generic assumptions cannot
contradict explicit requirements"; it is a property of ordering plus a guard, not
a validation pass that could be forgotten.

**Rule 6 — A relationship naming a space that does not exist is a warning, not a
failure.**
It is dropped, and `programme.warnings` says which one and why. A user who
mentions a room they did not ask for has made a small mistake; refusing the whole
programme over it would be the interrogation Story 27.8.2 exists to prevent.

**Rule 7 — Both capture paths produce the same relationships from the same
sentence.**
The model contributes relationships through a `planning_captureBrief` argument;
the offline path reads them from the utterance with a deterministic reader
(ADR-0027.1 Rule 6). The reader is deliberately narrow — it recognises explicit
separation and adjacency phrasings and nothing else — for the reason Bug 003
established: an invented requirement is worse than a missing one, because it is
not visibly missing.

**Rule 8 — The field is optional and a Brief without it stays valid.**
Approved artefacts are immutable (ADR-0027.1 Rule 4) and a user may already hold
an approved Brief in a project file. `relationships` defaults to empty,
deserialising an older Brief yields the current shape, and no consumer branches
on its presence.

**Rule 9 — Nothing below the Programme learns a new concept.**
`resolveAdjacencies` and the Layout Plan already turn `avoid` into a separation
edge. This change adds no stage, no artefact and no edge kind — it connects a
source to consumers that were built for it.

---

## Consequences

### What this buys

The stated constraint survives the whole pipeline, because the pipeline was
already built for it — only the first link was missing. The review card can
finally distinguish "you asked for this" from "homes are usually like this",
which is the difference between a user disagreeing with the platform and a user
correcting it.

Rule 4 also pays a debt unrelated to this bug: every existing template
relationship becomes visibly the platform's own opinion.

### What it costs

`IntendedAdjacency` gains a required field, so every construction site moves.
That is contained — the type is built in one function — but a `SpaceProgramme`
deserialised from a project file written before this change will have
relationships with no `source`. Rule 8 covers the Brief; the Programme needs the
same treatment, and `assumed` is the correct default for an artefact built
entirely from templates.

`space-programme.ts` gains a type-only import from `brief/`. The Programme
already declares `sourceBrief` provenance and `programme-synthesis.ts` imports
from `brief/` freely, so this introduces no cycle and no new coupling of
substance — but it is the first time the Programme _artefact_ names a Brief type,
and it is worth noticing rather than discovering later.

### What stays impossible

Stating how far apart two spaces should be. Stating a relationship between a
space and something that is not a space — a boundary, a view, the street. Both
are real architectural requirements and both are out of scope: the first is
geometry, and the second needs a vocabulary for site context that no artefact has
yet.

---

## Alternatives considered

**A third `SpaceRelationshipKind` for "near" or "close to".**
Rejected. It is `preferred` wearing a disguise, and it invites exactly the metric
reading Rule 1 forbids — the first question anyone asks about "near" is "how
near".

**Storing relationships on the Programme only, and having the model write them
there.**
Rejected. It puts a user requirement in a derived artefact, so revising the Brief
would silently drop it, and it makes the relationship's provenance
unreconstructible: a Programme regenerated from the Brief would lose exactly the
relationships the user cared most about. Requirements live in the Brief; the
Programme interprets them.

**A dedicated `ADJACENCY_SOURCES` record instead of reusing
`BriefRequirementSource`.**
Rejected. Three values with the same meanings under a second name is the
duplication ADR-0027.1 Rule 8 was written about, and the one distinction it would
add — "derived by template" — is already expressible as `assumed`.

**Adding ids to `DesiredSpace` so relationships can reference them.**
Rejected as disproportionate. It changes the shape of every Brief for the benefit
of one field, and name-based reference is sufficient because the Programme
already has to match Brief space names by role in order to decide which spaces
exist at all.

**Validating relationships in a gate before the Programme is proposed.**
Rejected, and worth recording because Bug 003's original report proposed it.
A gate asserting that every explicit relationship survived would be checking
synthesis against itself — the Programme derives its relationships _from_ the
Brief, so the gate cannot fail. Rule 5 makes the property structural instead.
