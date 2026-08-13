# Sprint 1.7 — Authoritative Realisation State

> **Status:** Complete
> **Version:** 2.1 (the 1.0 draft carried §1 and §2 only; 2.0 filled the rest and split the host half out; 2.1 records what implementation changed, in §12)
> **Repository:** `architectural-intelligence` — the host half is **ArchiSimple Sprint 037.1**
> **Related ADRs:** ADR-AI-0004 (accepted — the read port); ADR-AI-0002 revisions 1.3 and 1.4 (accepted); ArchiSimple ADR-0032 revision 2.2
> **Prerequisites:** Sprint 1.6 (the realisation lane); ADR-AI-0004 accepted; ArchiSimple Sprint 037.1 supplying the reader — landed together
> **Related bug:** BUG-008 — this closes Phase 3
> **Next:** BUG-008 closure, and only a follow-up if end-to-end verification finds a defect

---

## 1. Objective

Give Architectural Intelligence an authoritative, read-only view of whether the
current approved Geometry Specification has actually been built — and use it to
answer a repeated "build it" instead of proposing something the host will refuse.

Sprint 1.6 accepted that gap deliberately. This closes it, and with it the last
open item of BUG-008:

```text
"build it"
  → realisation lane                     (1.6)
  → realisation state, from the host     (this sprint)
  → propose · explain · or decline to propose
  → approval → the host's one realisation path
  → the outcome, in the host's own words
```

**No second execution path**, and nothing about how ArchiSimple builds changes.

---

## 2. Two sprints, in this order

The port is declared here and satisfied there, so the work splits and the order
is not the usual one.

| Sprint         | Repository                   | Delivers                                                              |
| -------------- | ---------------------------- | --------------------------------------------------------------------- |
| **1.7** (this) | `architectural-intelligence` | the port declaration, the consumption, the behaviour, the tests       |
| **037.1**      | `archisimple`                | the reader implementation, and moving the record registry to reach it |

**No platform package changes**, so ADR-0030 Rule 8's "the platform releases
first" does not apply. The order that does: this repository declares the port,
the host then satisfies it structurally — AI first, host second. In the linked
local workspace that is a build order, and **no npm release is required by
either half**.

---

## 3. Inherited — do not re-derive

| Area                       | Established fact                                                                | Consequence here                                             |
| -------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| The realisation lane       | Sprint 1.6: gated on an approved Specification, checked before every stage lane | Unchanged. This sprint changes what happens _inside_ it.     |
| The proposal subject       | `{ specificationId, revision }`, an identity                                    | Unchanged. Still nothing executable.                         |
| Artefact staleness         | This layer's, from the projection; the lane already refuses a stale design      | Unchanged, and the port must not report it (ADR-AI-0004 R10) |
| The guard                  | The host's, and the authority on whether a build may happen                     | Never reproduced. The reader informs; it does not enforce.   |
| Realisation state          | The host's, keyed on `(specificationId, revision)`                              | Read through the port and nowhere else.                      |
| The `realisation` fragment | Reaches a model as context, and is plugin-shadowable                            | **Not** the channel for reasoning (ADR-AI-0004 §Context)     |

---

## 4. The port

Declared here, in the shape `PlanningArtefactReader` established: an interface
this repository owns, satisfied structurally by an object the host supplies, with
nothing imported across the boundary.

```ts
/** What the host knows about whether the approved design was built. */
export interface RealisationState {
  readonly status: 'no-specification' | 'not-realised' | 'realised' | 'refused' | 'failed';
  readonly specificationId: string | null;
  readonly specificationRevision: number | null;
  readonly guardAllowsBuild: boolean;
  readonly guardBlockerCode: string | null;
}

export interface RealisationStateReader {
  /** The state now. Read per turn; never stored (ADR-AI-0004 Rule 5). */
  realisation(): RealisationState;
}
```

Four things about this shape are decisions, not detail:

- **It is the host's vocabulary, restated** — three of the five status values are
  the outcomes ArchiSimple already persists in its realisation record. No new
  word is invented, and no seventh status for "superseded": that is the guard's
  verdict, carried as `guardBlockerCode` exactly as the host carries it
  (ADR-AI-0004 Rule 9).
- **Five fields, each earning its place.** The host's context fragment carries
  more — the built counts, `attempts`, `lastAttemptAt` — and the surplus stays
  there. Nothing in §5 turns on when an attempt happened or how many there were
  (`status` is `not-realised` exactly when there were none), and the counts of
  what was built are the host's to report.
- **It carries no artefact staleness.** That is this layer's own knowledge and
  the lane already acts on it (Rule 10).
- **It is optional.** A host that supplies none leaves Sprint 1.6's behaviour
  exactly as it is (Rule 6, ADR-AI-0002 Rule 11).

The identity fields are not decoration: the host resolves state against the
Specification in force, this layer independently knows which that is, and a
disagreement means something is misconfigured — two registries, most plausibly.
Row 7 of §5 is what this layer does about it.

Because the interface is narrower than the fragment, the host's existing
derivation **satisfies it structurally**: no adapter, no second computation, and
Rule 7 costs nothing to keep.

---

## 5. Behaviour

The lane opens exactly as in Sprint 1.6. What changes is what it does once open.
Read in order — the first row that matches wins.

| #   | State                                             | Answer                                                                                                        | Proposal |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Specification **stale** (this layer's projection) | "out of date — regenerate the specification, then ask me to build it"                                         | no       |
| 2   | `status: realised`                                | "this design has already been built" — and what to do instead: revise the design, then build the new revision | no       |
| 3   | `guardAllowsBuild: false`, some other code        | the guard's reason, in a sentence keyed on `guardBlockerCode`                                                 | no       |
| 4   | `status: refused` or `failed`, guard allows       | propose, **and say there was a previous attempt and how it ended**                                            | yes      |
| 5   | `status: not-realised`                            | propose (Sprint 1.6's answer, unchanged)                                                                      | yes      |
| 6   | **no reader supplied**                            | propose (Sprint 1.6's answer, unchanged)                                                                      | yes      |
| 7   | the reader describes a **different** design       | propose (Sprint 1.6's answer) — the state is about something else, so it is not evidence about this design    | yes      |

Row 1 stays first because it is the fact this layer owns: a design derived from a
superseded Graph should be regenerated whatever the host thinks about building
it, and the answer names the fix.

Rows 2 and 3 are **conversational refusals** (ADR-AI-0004 Rule 4). The assistant
explains; it does not enforce. The host's guard remains the authority, and a user
who asks again anyway must still be able to reach it — so the wording says what
is true and what would change it, and never "you cannot".

Row 4 is the row worth building this port for. "The last attempt was refused
because the design had already been built at revision 2" is exactly the context a
user needs before approving a retry, and it is unavailable without an authority.

---

## 6. Scope

### In scope

1. `RealisationStateReader` and `RealisationState`, declared here.
2. An optional `realisation` option on `ArchitecturalIntelligenceService` and on
   the contribution factory, beside `artefacts`.
3. Consumption in `proposeRealisation` only, per §5.
4. Prose for each row, in this layer's existing register — no host UI strings.
5. Tests: every row of §5, plus the negatives in §8.
6. Documentation: `00-current-state.{md,yaml}`, `CLAUDE.md`, the BUG-008
   findings.

### Out of scope

- changing `realiseApprovedSpecification`, the Operation, the guard, the
  translator or the Automation contract;
- adding realisation state to the workflow projection (ADR-AI-0004 Rule 8);
- reading the `realisation` context fragment for reasoning;
- automatic rebuilding, automatic retry;
- reporting realisation state anywhere other than the realisation lane;
- UI, project-file changes, npm releases.

---

## 7. Where the reader is consulted, and where it is not

**Only `proposeRealisation`.** Not in `classifyRequest` — the lane's gate stays
"is there a design here to build", which is artefact state and belongs to the
projection (ADR-AI-0002 Rule 8). Not in `workflowState()`, which must answer on
every render and carries planning state only (ADR-AI-0004 Rule 8). Not in any
tool, and not in the context provider.

A test asserts the call site count, because the second consumer is how a
per-turn read becomes a projection input by accident.

---

## 8. Testing

### 8.1 Each row of §5

Six tests, one per row, each asserting both halves — the message and whether a
proposal was produced. Row 4 additionally asserts the previous attempt is
mentioned; row 2 asserts the message does **not** claim the assistant built it.

### 8.2 Consistency (ADR-AI-0004 Rule 11)

- a record for an **older** revision does not make the current revision
  `realised` — the state is the host's, and this asserts this layer reports what
  it is given rather than interpreting it;
- a `realised` state for a **different** Specification id is not this design's.

Both are already true of the host's implementation; the tests exist so this layer
cannot start "helping".

### 8.3 The boundary

- with no reader supplied, every Sprint 1.6 test still passes unchanged
  (Rule 6);
- the reader is called at most once per turn and its result is never stored
  (Rule 5) — asserted with a counting fake;
- `realisation/` still names no Request, Build Plan, guard, translator or host
  entry point — the Sprint 1.6 compliance block, extended to the new file;
- the reader is consulted from exactly one production call site (§7).

### 8.4 Truthfulness

- a `realised` state plus a user asserting "you haven't built it yet" still
  answers _built_ — conversation does not override the authority, in either
  direction (ADR-AI-0004 Rule 2);
- no message in any row claims this layer built anything.

---

## 9. Definition of done

- [x] `RealisationStateReader` declared here, optional, plain data.
- [x] Consumed in `proposeRealisation` and nowhere else.
- [x] All six rows of §5 implemented and tested.
- [x] A repeated "build it" after a successful build explains rather than
      proposes.
- [x] A retry after a refusal or failure proposes **and** says what happened
      before.
- [x] No reader supplied → Sprint 1.6 behaviour, unchanged, proved by its own
      suite.
- [x] Nothing claims a design was built; nothing enforces what the guard decides.
- [x] No realisation state in the workflow projection.
- [x] Full suite, typecheck and lint pass; no npm release.
- [x] Documentation updated, including the BUG-008 findings' Phase 3 status.

---

## 10. Stop conditions

1. The host cannot supply the state without exposing execution capability.
2. Answering §5 needs a fact the port does not carry — say which, rather than
   widening the port silently.
3. The reader turns out to be needed in `classifyRequest` or `workflowState()` —
   that is ADR-AI-0004 Rule 8 reopening, not an implementation detail.
4. Two sources for artefact staleness appear (Rule 10).
5. ADR-AI-0004 is not accepted, or is accepted in a form §4 does not match.
6. ArchiSimple Sprint 037.1 cannot supply the reader without changing the
   realisation path.

---

## 11. End-to-end verification (BUG-008 closure)

The whole point, and the thing no unit test proves. In the browser, one
conversation:

1. describe a building → Brief → approve;
2. programme, layout, geometry, specification → approve each;
3. **"build it"** → a realisation proposal → approve → walls, openings and named
   rooms appear;
4. **"build it"** again → _"this design has already been built"_, no proposal;
5. undo → the drawing empties, and the record still says it was built — asking
   again still explains rather than proposes, because a realisation is an event,
   not a survivor (ADR-0032 Rule 7).

Step 5 is the one to look at hardest: it is where a naive implementation would
"helpfully" notice the empty drawing and offer to rebuild, which is exactly the
inference ADR-AI-0004 Rule 2 forbids.

Record the pass in the BUG-008 findings with what was seen at each step.

---

## 12. What implementation changed

**One field renamed, before anything was built on it.** The port declared
`revision`; the host's derivation calls it `specificationRevision`. Renaming
_this_ side was the right direction — Rule 9 says the vocabulary is the host's,
restated — and it preserved the property the ADR leans on: the host's wider
result satisfies this narrower interface **structurally**, with no adapter and no
second computation.

**The host's restatement is a union, not `string`.** `exactOptionalPropertyTypes`
caught it: `status: string` does not satisfy `RealisationStatus`. So ArchiSimple's
`IntelligenceServices` spells the five values out, and the two vocabularies are
now checked against each other at one line, at compile time. That is a benefit
the context fragment could not have given at any price — `AssembledContext` is
`unknown`-valued, so the same divergence there fails in a conversation or not at
all. Worth recording as evidence for ADR-AI-0004's central decision rather than
as a detail.

**A dropped field, caught by the end-to-end test rather than the compiler.**
`loadIntelligenceContribution` names each option explicitly instead of spreading
its input, so the new `realisation` field passed from `main.tsx` was silently not
forwarded — and it compiled. That is Bug 001's exact shape, and it survived a
green type-check. The fix is one line; the lesson is in the comment beside it.

### Delivered

| Piece                                            | Where                                           |
| ------------------------------------------------ | ----------------------------------------------- |
| the port and its vocabulary                      | `src/realisation/realisation-state.ts`          |
| the six-row behaviour, and the four new messages | `src/architectural-intelligence-service.ts`     |
| 15 behavioural tests                             | `src/__tests__/realisation-state.test.ts`       |
| one call site and no cached state, asserted      | `src/__tests__/architecture-compliance.test.ts` |

799 tests pass here (was 782); ArchiSimple 978 (was 967), including the BUG-008
scenario end to end. `tsc -b`, `eslint` and `depcruise` clean. No release.
