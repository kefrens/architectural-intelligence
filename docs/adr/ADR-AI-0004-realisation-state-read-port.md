# ADR-AI-0004: Realisation State Read Port

- **Status:** Accepted
- **Revision:** 1.0
- **Date:** 2026-08-13
- **Deciders:** ArchiSimple Project
- **Relates to:** ADR-AI-0002 (workflow state — the ownership split, and Rules 8–13 this ADR inherits), ArchiSimple ADR-0032 revision 2.2 (the one realisation path), ADR-0029 (Rules 2 and 3 — restated shapes), ADR-0030 (Rules 2 and 4 — repository separation), BUG-008
- **Implemented by:** Sprint 1.7, with its host half in ArchiSimple Sprint 037.1

---

## Revision History

| Revision | Date       | Change                                                                                                                                                                   |
| -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.0      | 2026-08-13 | Initial decision, accepted the day it was written. Gives this layer an authoritative, read-only view of whether the approved design has been built, and forecloses the three cheaper ways of getting one. Rule 9 was narrowed from seven fields to five during acceptance: a field is admitted when a behaviour needs it, never because the host already computes it. |

---

## Context

Sprint 1.6 gave this layer a realisation **lane**: "build it" after an approved
Geometry Specification produces a `Proposal` carrying `{ specificationId,
revision }`, and the host builds it through the one entry point ADR-0032
revision 2.2 fixes in place.

It did not give this layer realisation **state**. So the assistant can ask for a
build and cannot tell:

| It cannot distinguish                     | Which means                                                 |
| ----------------------------------------- | ----------------------------------------------------------- |
| approved, never built                     | the normal case                                             |
| already built                             | asking again is a duplicate building the host will refuse   |
| a previous attempt refused                | a retry is normal and the user should be told there was one |
| a previous attempt failed and rolled back | the drawing is unchanged; a retry is normal                 |
| a different revision was built            | this one cannot be built without reconciling what exists    |

Today all five produce the same proposal, and four of them are refused by the
host's guard at approval. That refusal is authoritative and truthful — it is
the outcome Sprint 1.6 deliberately accepted — but it is a poor conversation: the
user is asked to approve something that was never going to happen.

### Why the obvious answers are wrong

Three cheaper mechanisms exist. Each is wrong for a reason worth recording,
because each will look attractive again.

**The `realisation` context fragment already crosses this boundary.** ArchiSimple
Sprint 036.2b contributes it, and it arrives in `AiProviderRequest.context` on
every turn — where this repository's provider adapter currently discards it. It
is not the channel, for two reasons:

- `AssembledContext` is `Record<string, ContextFragment>`: string-keyed,
  `unknown`-valued, with no compile-time check on either side of the boundary. A
  host that renamed a field would break this layer's reasoning silently, and
  nothing in either repository would fail first.
- **A plugin can shadow it.** `assembleContext` assigns `context[provider.id]`
  and the host spreads plugin-contributed providers _after_ its own, so a plugin
  registering the id `realisation` replaces the authoritative fragment. That is
  acceptable for prompt text a model reads with judgement. It is not acceptable
  for a fact the assistant must not be wrong about.

**The workflow-state projection could carry it.** It must not, and ADR-AI-0002
revision 1.3 already says why the temptation is structural: the projection is
derived on every call and must be safe on every render, while realisation state
is the host's execution state. A projection that mixed the two would report
planning facts and execution facts through one shape, and the first consumer to
treat "complete" and "built" as one thing is BUG-008 happening again one layer up.

**A model could be told and trusted to remember.** ADR-AI-0002 revision 1.3,
extension to Rule 2 — this layer never infers execution from conversation.

---

## Decision

**The host supplies Architectural Intelligence with a read-only
`RealisationStateReader`, and it is the only source of realisation state.**

A port, in the shape `PlanningArtefactReader` and `BriefDraftStore` already
established: this layer declares the interface, the host satisfies it
structurally, and nothing is imported across the repository boundary
(ADR-0029 Rule 2, ADR-0030 Rule 2).

```text
        ┌────────────────────────────────────────────────────────┐
        │ Host                                                   │
        │  PlanningArtefactReader   BriefDraftStore              │
        │  RealisationStateReader   ← new; over the same         │
        │                             RealisationRecordRegistry  │
        └──────────────┬─────────────────────────────────────────┘
                       │ read, per turn, never stored
                       ▼
        ┌────────────────────────────────────────────────────────┐
        │ Architectural Intelligence                             │
        │   realisation lane · what to say · whether to propose   │
        └──────────────┬─────────────────────────────────────────┘
                       │ Proposal { specificationId, revision }
                       ▼
        ┌────────────────────────────────────────────────────────┐
        │ Host — guard, translator, Operation, record            │
        └────────────────────────────────────────────────────────┘
```

---

## Rules

### Rule 1 — The reader is the only source of realisation state

Whether an approved Geometry Specification has been built is answered from the
reader and from nowhere else.

### Rule 2 — Realisation is never inferred

This layer SHALL NOT conclude that a design was built from: the presence of walls
or openings; the Geometry Graph; the Geometry Specification; any planning
artefact; conversation history; a previous proposal; or the presence or absence
of a realisation proposal.

ADR-AI-0002 revision 1.3's extension to Rule 2 states the principle — an artefact
becoming readable means it was _approved_. This is the same rule with a source
attached.

### Rule 3 — The port carries no execution capability

It SHALL NOT expose `realiseApprovedSpecification`, a `CommandDispatcher`, an
operation dispatcher, a Build Plan, the realisation guard, the translator, or any
executable machinery. Reading realisation state SHALL be impossible to turn into
execution by accident, and the compliance test asserts it on the sources rather
than trusting it.

### Rule 4 — The reader informs the conversation; the guard remains the authority

This layer may decline to propose a build and explain why. That refusal is
**conversational**. Whether a build may happen is the host's decision, taken by
the existing guard at approval, and this layer never becomes a second guard —
which is ADR-0032 revision 2.2's invariant seen from this side.

The practical consequence, and the reason the rule is worth stating: a user whose
reader says "already built" and who asks again anyway must not be left with no
route to the authority. The assistant explains; it does not enforce.

### Rule 5 — Read fresh, never stored

No field, no memo, no copy handed over at composition time. A cached realisation
verdict goes stale the moment a build lands, and a UI would trust it anyway
(ADR-AI-0002 Rule 1, for the same reason).

### Rule 6 — An absent reader degrades, never throws

A host may supply none — a test, a headless client, an older host. Everything
Sprint 1.6 does remains valid in that case: the lane still classifies, the
proposal is still built, and the host's guard still decides
(ADR-AI-0002 Rule 11).

### Rule 7 — One derivation, two readers

The port and the host's `realisation` context fragment SHALL be **the same host
function**. The fragment is what a model reads; the port is what this layer's
reasoning consumes, and two computations of one fact would eventually disagree
about whether a building exists — visibly, in the same reply.

### Rule 8 — Realisation state stays out of the workflow projection

The projection is planning workflow state (ADR-AI-0002). Realisation is host
execution state. They are read side by side and never merged, and no consumer may
report `complete` as though it meant built.

### Rule 9 — The vocabulary is the host's, restated

The read model is the host's existing realisation vocabulary — the outcomes it
persists in its record, plus the two values describing the _absence_ of one, plus
the guard's own verdict:

| Field                                  | Why this layer needs it                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `status`                               | `no-specification` \| `not-realised` \| `realised` \| `refused` \| `failed` — the answer    |
| `specificationId`, `specificationRevision` | **which design was answered about**, so a state describing another one is not believed      |
| `guardAllowsBuild`                     | whether to propose at all                                                                   |
| `guardBlockerCode`                     | which refusal to explain — a stable identifier, never a sentence                            |

Three of the five status values are the host's persisted outcomes verbatim. **No
new vocabulary is invented here**, and in particular no seventh status: a design
the guard refuses because a _different_ revision was built is reported as its
status plus a guard code, exactly as the host reports it, not as a status of its
own (ADR-0027.1 Rule 8, ADR-AI-0002 Rule 4 — one vocabulary, extended, never a
parallel one).

**Five fields, and the list is a maximum rather than a starting point.** A field
is admitted only when a conversational behaviour needs it, never because the host
already computes it — the host's `realisation` context fragment carries more, and
the surplus stays there:

- **the built counts** (`wallCount`, `openingCount`, `namedRoomCount`) — this
  layer decides nothing with them, the host already reports them to the user, and
  a second copy is a second place for them to be wrong;
- **`attempts`** — redundant against `status`, which is `not-realised` exactly
  when no attempt was recorded for this revision;
- **`lastAttemptAt`** — no behaviour turns on when an attempt happened, and a
  timestamp this layer rendered would be presentation it does not own.

The identity fields earn their place for a specific reason: the host resolves the
state against the Specification in force (Rule 11), and this layer independently
knows which that is. If the two disagree, something is misconfigured — two
registries, most plausibly — and this layer must fall back to proposing rather
than assert an authoritative-looking answer about a design that is not the one
under discussion.

The transport MAY be restated structurally on each side; the semantics SHALL NOT
diverge. Plain data throughout, per ADR-AI-0002 Rule 9: string unions, numbers,
booleans, stable identifiers, nothing to import in order to compare.

A consequence worth stating, because it is what makes Rule 7 free: the host's
wider fragment **structurally satisfies** this narrower interface. One derivation
serves both readers with no adapter between them and no second computation.

### Rule 10 — Artefact staleness stays this layer's, and the port never reports it

Whether an approved Specification was derived from a superseded Geometry Graph is
provenance — this layer's own knowledge, already derived by the projection and
already acted on by the realisation lane since Sprint 1.6. The port SHALL NOT
carry it. Two sources for one fact is the failure ADR-AI-0002 Rules 8 and 13
exist to prevent, and this is the exact shape it would take.

The two facts sit beside each other and answer different questions:

```text
"was this design built?"          → the reader          (host)
"is this design still current?"   → the projection      (this layer)
```

### Rule 11 — Consistency is resolved against the current approved Specification

State is reported for the Specification revision now in force. A record belonging
to an older revision SHALL NOT be reported as the realisation of the current one:
a realised older revision does not make a newer approved revision "realised".

This is already true of the host's implementation, which filters its records by
`(specificationId, revision)` and asks its guard about the rest. The port
**exposes** that; it does not re-derive it.

---

## Ownership

| Concern                              | Owner                      |
| ------------------------------------ | -------------------------- |
| Specification approval               | host                       |
| Realisation guard, execution, record | host                       |
| The realisation state, and this port | host                       |
| Recognising realisation intent       | Architectural Intelligence |
| What to say about the state          | Architectural Intelligence |
| Building the realisation proposal    | Architectural Intelligence |
| Executing it                         | host                       |
| Artefact provenance and staleness    | Architectural Intelligence |

This layer **consumes** realisation state. It never owns, derives, caches or
corrects it.

---

## Consequences

### Positive

- the assistant distinguishes approved from built, truthfully and from an
  authority;
- a repeated "build it" is answered rather than proposed and refused;
- a previous refusal or failure can be mentioned, which is exactly the context a
  user needs before approving a retry;
- the host stays the sole execution authority, and no second realisation path is
  introduced;
- no platform package changes, so no `ai-engine` release is required.

### Negative

- both repositories must agree on a shape, and the agreement is structural rather
  than compiled — the same seam `PlanningArtefactReader` already accepts;
- the host must move its realisation record registry to its composition root to
  be able to supply the reader at all (its Sprint 037.1);
- a cross-repository development dependency, in the **reverse** of the usual
  direction — see below.

### Release ordering

**No platform package changes**, so ADR-0030 Rule 8's "the platform releases
first" does not bind here. The order that does apply is: this repository declares
the port, then the host satisfies it — AI first, host second, which is the
opposite of the usual direction and is stated so that nobody waits for a platform
release that is not needed. In the linked local workspace it is a build order
rather than a publish order.

---

## Alternatives considered

### Consume the `realisation` context fragment

Rejected — see §Context. It already crosses, it costs nothing, and it is
string-keyed, uncheckable and shadowable by a plugin. Acceptable as prompt text;
not acceptable as an authority.

### Put realisation state in the workflow projection

Rejected — Rule 8, and ADR-AI-0002 revision 1.3's structural argument. It would
also make every consumer of the projection a consumer of host execution state,
including the future IA panel, which is a much larger commitment than this
decision needs.

### Have this layer read the record and decide for itself

Rejected — Rule 4. Deciding whether a build may happen from a record is
reimplementing the guard, which ADR-0032 revision 2.2 forbids in the strongest
terms it has. The port reports the guard's verdict; it does not enable a second
one.

### Let the host tell this layer through a callback after each build

Rejected — ADR-AI-0002 Rule 2 and ADR-0023 Rule 1. A package that receives
execution callbacks is one refactor away from acting on them, and it would need
session state to hold what it was told.

---

## Explicit non-decisions

This ADR does not decide: automatic rebuilding after a Specification revision;
automatic retry of a failed realisation; whether realisation ever becomes a
planning stage (it is not one); any UI representation of realisation state; any
new execution mechanism; or the publication of either package.

---

## Summary

Architectural Intelligence answers **"what did the user ask for, and is this
design still current?"**

The host answers **"has it been built, and may it be?"**

This port is the second question crossing to where the first is being answered,
read-only, per turn, in the host's own words.
