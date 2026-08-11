# Bug 003 — the Brief loses a stated total area

**Status:** Fixed\
**Severity:** High\
**Affected area:** Architectural Intelligence — Architectural Brief assembly
(originally reported against Space Programme generation)\
**Discovered:** 2026-08-11\
**Repository:** `architectural-intelligence`

## Summary

A design request stating a total floor area produced a Space Programme that
ignored it.

The request was:

> Build me a 100m2 appartment with 2 bedrooms, 1 bathrooms, and a small office.
> Kitchen and Dining/Lounge area are separated

The generated Programme totalled **91 m²** and stated _"No total was stated"_.

The original report attributed this to the Programme generator reasoning from
generic dwelling heuristics instead of treating the Brief as a constraint set.
**That diagnosis was wrong**, and the correction is the useful part of this
document — see [Root cause](#root-cause). The generator honours a stated total
and always has. The Brief it read did not contain one.

## Root cause

Three defects, in the order they bite.

### 1. The model path discards what the model omits — the reported bug

`planning_captureBrief` has exposed a `totalArea` argument since Sprint 27.8.
The model did not pass it.

`assembleBriefFromFields` built requirements from the tool call and from nothing
else, so the topic simply did not exist. `synthesizeProgramme` then behaved
exactly as designed: no stated total, so size from `TYPICAL_SPACE_AREAS`, and
say so. The sentence _"No total was stated"_ was **true of the Brief** and false
of the conversation.

The number was never hard to find. The deterministic reader that the _offline_
path uses finds it in the original sentence:

```
readBriefTopics('Build me a 100m2 appartment with 2 bedrooms, 1 bathrooms, …')
  → bedrooms  2   stated
  → bathrooms 1   stated
  → totalArea 100 stated
```

`assembleBrief` calls that reader. `assembleBriefFromFields` never did. So the
two paths that `brief-assembly.ts` has claimed since Sprint 27.8 will agree,
did not — and which one you got depended on whether a language model was
answering.

### 2. A count given as a tool argument never became a space

Found while fixing the above, and more severe than the reported symptom.

The tool offers `bedrooms` and `bathrooms` as dedicated numeric arguments _and_
accepts a `spaces` array. A model that fills in the first and leaves those rooms
out of the second has answered what it was asked. But
`assembleBriefFromFields` set `desiredSpaces` to the supplied array verbatim, so
the counts stayed in `requirements`, where nothing downstream reads them as
spaces:

```
requirements: storeys 1, bedrooms 3, bathrooms 2
spaces:       [kitchen]
      ↓
programme:    kitchen, living room, hallway
```

A three-bedroom house, programmed with no bedrooms in it. The offline path never
had this gap — `assembleBrief` derives both from the counts.

### 3. Space names were matched literally

Two places in `programme-synthesis.ts` compared space names character by
character:

- implied spaces were skipped on exact lowercase equality, so the brief's
  `dining/lounge` did not look like a living room and **a second one was added
  underneath it** — 24 m² of duplicate day space in a 100 m² flat, which is most
  of the reason the total looked arbitrary;
- `ADJACENCY_TEMPLATE` anchored on `/^dining room$/i`, so the kitchen adjacency
  that should have attached to the dining half attached to nothing, and only the
  generic living↔kitchen relationship survived into the review.

`@archisimple/skills` had the matching gap in its data: `TYPICAL_SPACE_AREAS` is
keyed by one canonical name per space, and neither `office` nor `lounge` was a
key. Both fell to the generic `DEFAULT_SPACE_AREA` of 10 m² while `home office`
and `living room` sat in the table directly above them. An unrecognised name is
not merely a missed warning — it enters the allocation at 10 m² and moves the
proportions of every other space with it.

## What was _not_ wrong

Recorded because the original report proposed rebuilding all of it.

| Reported as missing                                | Already implemented                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Treat the Brief as an authoritative constraint set | `BriefRequirement[]` + `desiredSpaces`, read by `synthesizeProgramme`                    |
| Allocate the target area before accepting defaults | `allocateSpaceAreas` skill, scaling every space by one factor (ADR-0027.1 Rule 9)        |
| Distinguish explicit / derived / heuristic         | `BRIEF_REQUIREMENT_SOURCES`, `SPACE_PRIORITIES`, `AREA_SOURCES` — three separate records |
| Keep assumptions explicit                          | `SpaceProgramme.assumptions` and `warnings`, both rendered on the review card            |

A `ProgrammeConstraints` type would have been a fourth vocabulary for the same
three distinctions, which is what ADR-0027.1 Rule 8 exists to prevent.

Likewise, the proposed validation gate comparing `programme.totalArea` to
`brief.targetArea`, space counts and storey count would have been
**tautological**: the generator derives all three _from_ the Brief, so the gate
cannot fail. Validation belongs where information is lost, which is the Brief
tool.

## The fix

### `architectural-intelligence`

**`brief-assembly.ts`** — a deterministic backstop. `withBackstopTopics` re-reads
the user's own message and supplies only the topics the caller left out, applied
to the caller's fields _before_ any folding, so defaults, revision and
change-detection behave exactly as they do for a caller who passed the topic.

Restricted to `totalArea`, `storeys`, `bedrooms` and `bathrooms`. The reader is
permissive by design — `Budget` matches a currency amount in any clause — and
filling a gap from a loose pattern is a worse failure than leaving it open,
because an invented requirement is not visibly missing. The backstop only ever
fills: a topic the caller supplied stays the caller's, because the model read the
whole conversation and this reads one message.

`withCountedSpaces` closes defect 2, reusing `desiredSpacesFrom` over an empty
text so that only the count-derived spaces are added — re-reading the names
would let `NAMED_SPACES` match inside a compound the user chose and turn
`dining/lounge` into a second, separate living room.

**`brief-tools.ts`** — passes the conversation's last user message as
`userMessage`, distinct from `utterance`. The two have different jobs: the Brief
quotes `utterance` back, and the model's objective is still the better quote
because it summarises the whole conversation, where the last message may be
"yes please".

**`programme-synthesis.ts`** — `SPACE_ROLES` replaces literal name matching. A
name maps to every role it performs, so one compound space satisfies two: a
`dining/lounge` _is_ the dining room and the living room, and neither is added
again. Adjacency templates resolve by role, with an unordered pair guard so the
same two spaces cannot be stated twice under two strengths — the template is
ordered strongest first, so a required adjacency is not downgraded by a
preference describing the same pair.

### `@archisimple/skills`

`SPACE_ALIASES` maps other names onto existing table keys, and a compound
separator (`/`, `+`, `&`, `and`) resolves combined rooms. A compound is
**summed**: a dining/lounge must seat people for dinner _and_ hold a sofa, so it
needs the area of both; taking the larger would produce a room that cannot do the
second thing it was named for. A compound with one unknown half stays unknown
rather than being sized from the half we recognise.

`snug` is deliberately still unrecognised. It is a small sitting room, not a
synonym for a living room, and guessing 24 m² for it would be worse than
admitting the table does not know.

This is additive data plus a resolver — no API change, so no consumer has to move
with it.

## Result

The same tool call, with `totalArea` still absent from the model's arguments:

| Space         | Area                  |
| ------------- | --------------------- |
| bedroom × 2   | 13.043 m² each        |
| bathroom      | 5.435 m²              |
| office        | 9.783 m²              |
| kitchen       | 13.043 m²             |
| dining/lounge | 39.13 m²              |
| hallway       | 6.522 m² _(expected)_ |
| **Total**     | **99.999 m²**         |

> Target areas are scaled to the 100 m² you asked for, keeping the usual
> proportions between rooms.

No duplicate living room, no unrecognised-space warning, and the kitchen
adjacency attaches to the space holding the dining half.

## Tests

`src/__tests__/brief-fidelity.test.ts` — 17 assertions, starting at the **tool
call** rather than at a hand-built Brief. This matters: a test that constructs a
Brief carrying `totalArea: 100` and asserts the programme totals 100 passed
before any of this was fixed, and would have gone on passing while the bug
shipped. Nine of the seventeen fail against the previous code.

Covered: recovery of the stated total and its `stated` source; the model winning
every topic it did supply; nothing filled when there is no user message; a bare
budget deliberately _not_ recovered; counts becoming spaces without duplicating
a space the model also listed; the full reported scenario; and 70 m² / 120 m²
boundary cases.

`packages/skills/src/__tests__/programme-skills.test.ts` gains alias resolution,
compound summing, part-resolution refusal, and a guard that a genuinely unknown
space is still reported as unknown.

Full suites green: 659 tests in `architectural-intelligence`, the whole
`archisimple` workspace, and `pnpm depcruise` clean.

## Still open

The explicit **"Kitchen and Dining/Lounge area are separated"** constraint is
still not carried. This is not a regression and not a Programme defect: the Brief
has no vocabulary for relationships at all — `DesiredSpace` is `{ name, count }`
and `planning_captureBrief` has no relationships argument. The downstream target
already exists (`IntendedAdjacency`, including `ADJACENCY_STRENGTHS.Avoid`), but
it carries no provenance, so "a generated relationship must not contradict an
explicit one" is unenforceable as things stand.

That is a new capability spanning two artefact schemas and a tool schema, not a
bug fix. Tracked as **bug-004**, and it needs an ADR before it is built.

## Definition of Done

- [x] A 100 m² Brief cannot produce an unexplained 91 m² Programme.
- [x] Explicit Brief spaces and quantities are preserved.
- [x] Derived spaces are distinguishable from explicit spaces.
- [x] Generic assumptions cannot contradict explicit Brief requirements.
- [x] Unit tests cover target-area recovery and space derivation.
- [x] The real 100 m² / 2-bedroom / 1-bathroom / office scenario is a regression test.
- [x] Existing Architectural Intelligence tests remain green.
- [x] No geometry or ArchiSimple execution changes were required.
- [ ] Explicit Brief relationships are preserved structurally — **deferred to bug-004**.
- [ ] ~~Programme validation runs before the Programme is proposed~~ — withdrawn;
      the proposed checks are tautological against the generator, and validation
      was added where the loss actually occurs.

## Architectural principle

The principle in the original report stands, and is worth keeping:

> **The Space Programme is a faithful spatial interpretation of the approved
> Brief. It may add derived information and fill unspecified gaps, but it must
> never discard, contradict, or silently relax an explicit Brief constraint.**

What this bug adds to it is one stage earlier, and is the lesson:

> **A Brief assembled from a model's fields must be no poorer than one assembled
> from the same sentence offline.** Where the two paths can disagree, the
> artefact's quality depends on which provider answered — the exact failure
> ADR-0027.1 Rule 6 exists to prevent.
