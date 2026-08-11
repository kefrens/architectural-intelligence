# Bug 005 — regenerating an unchanged stage starves the one below it

**Status:** Fixed\
**Severity:** High\
**Affected area:** Architectural Intelligence — stage regeneration, Brief capture\
**Discovered:** 2026-08-11\
**Repository:** `architectural-intelligence`\
**Transcript:** [bug-005-prompissues.md](bug-005-prompissues.md)

## Summary

A user typed `ok` four times after approving a Brief and received Space
Programme revisions 1, 2, 3 and 4 — identical every time — and never a Layout.

The original report read this as the model bypassing approval gates and
proposed five workstreams to constrain it. **The gates were never breached.**
Every one of them fired correctly throughout the conversation. What broke is one
stage higher and much smaller, and the report's framing was inverted: nothing
jumped ahead, the pipeline was _starved_.

## The actual mechanism

On `ok` the model fires all four generation tools. With a Brief and a Programme
approved, they resolve like this:

```text
planning_generateProgramme    → proposal    (revision N+1, identical content)
planning_generateLayout       → proposal    (a perfectly good Layout)
planning_generateGeometry     → blocked     (no approved layout)
planning_generateSpecification→ blocked     (no approved geometry)
```

`apps/web`'s `aiServiceProvider` carries **one** artefact proposal per reply and
keeps the _first_ one; the rest become "1 further action was proposed alongside
this plan and left out". The model calls `generateProgramme` first, so:

1. The churned Programme claims the single proposal slot.
2. The Layout — legal, correct, already built — is **silently dropped**.
3. The user approves the churned Programme, superseding the revision the dropped
   Layout was derived from.
4. Repeat forever. The design can never advance past the Programme.

That is the whole bug. It is visible in the transcript as the recurring pair:

> Space programme (revision 3) … 1 further action was proposed alongside this
> plan and left out. Ask again to apply it.

The "further action" was the Layout, every single time.

## Findings, corrected

### Finding 1 — the Brief lost the stated total (confirmed, re-diagnosed)

The report attributed this to the conversational `BriefGeneration` path bypassing
Bug 003's backstop. It does not: `assembleBrief` has called `readBriefTopics`
directly since Sprint 27.8, and it recovers `totalArea = 100` from that sentence.

The transcript shows the Brief came from the **tool** path. Its requirement
statements are `no garage` / `a office` / `no accessibility` — the
`FLAG_ARGUMENTS` template in `brief-tools.ts`. The offline reader would have
written "a home office", and `withDefaults` "no specific accessibility
requirement".

So the model called `planning_captureBrief` and omitted `totalArea`, and Bug
003's backstop did not fire. Two reasons, and **only the second was fixable
here**:

1. `context['conversation'].lastUserMessage` is read but **nothing in the
   platform ever populates it**. `AssembledContext` is keyed by context-provider
   id and the only ids are `document`, `view`, `tool`. That assumption predates
   Bug 003 — `brief-tools.ts` already used the same key to pick `utterance` — and
   Bug 003 inherited it.
2. Even wired, it would not have helped **this** conversation. The first capture
   omitted `storeys`, so the host asked, the user answered "single storey", and
   the model called again. At that moment the last user message was
   `"single storey"`; the 100 m² was two turns behind.

What did still carry the figure was the model's own objective, inside the same
tool call: _"design a 100m2 apartment with 2 bedrooms, 1 bathroom, and a small
office"_. So the backstop now reads that too.

### Finding 2 — "ok triggers multiple generation stages" (inverted)

Confirmed that four tools fire, and confirmed that this **cannot** bypass a gate.
With only a Brief approved:

```text
generateProgramme      -> proposal
generateLayout         -> blocked: There is no approved space programme yet…
generateGeometry       -> blocked: There is no approved layout yet…
generateSpecification  -> blocked: There is no approved geometry yet…
```

The report's `Brief → Programme → Layout → Geometry → Specification` diagram is
unreachable. The real defect is the opposite: a legal downstream proposal is
**dropped**, not an illegal one admitted.

### Findings 3 and 4 — generation conflated with approval (confirmed, merged)

One defect, not two. `generateProgramme` revised unconditionally whenever the
project already held a programme, so an acknowledgement read as a regeneration.
The Brief has answered this since Sprint 1.5 (`BRIEF_ALREADY_SAYS_THAT` →
`NothingToDo`); the four stages below it never got the equivalent.

### Finding 5 — the model narrates artefacts that do not exist (new)

Not in the original report, and arguably the most damaging thing in the
transcript. With **no Layout ever approved**, the assistant said:

> Your 100m² apartment … has been planned. Here's the layout: Office: 9 m²,
> Kitchen: 12 m² … The hallway connects the living room to the kitchen … Would
> you like me to proceed with creating the geometry and specification?

That is the Programme restated as prose and presented as a Layout. The user
answered "yes" and got two more blocked calls. Blockers currently surface as
warnings _beside_ a fluent narrative, and the narrative wins.

This is the "confident, wrong" failure Bug 002 was written about, one stage
later. It is **not fixed here** — see [Still open](#still-open).

## The fix

### `artefacts/artefact-revision.ts` (new)

`changesAnything(previous, patch)` — structural comparison over exactly the keys
a revision patch carries, so it cannot be fooled by `revision` or `createdAt`
and cannot silently ignore a field added to a patch later. `JSON.stringify`
would have been shorter and wrong: a patch is built field by field, so key order
need not match the artefact it is compared against.

`nothingToRegenerate({ stage, nextStage })` — a `PLAN_BLOCKER_REASONS.NothingToDo`
blocker whose suggestion names the **next** stage. That is deliberate: this
blocker's entire audience is a model that has just been told "ok" and is looking
for something to call, and the observed failure was a model with no better idea
than to regenerate. Telling it where to go is the difference between a loop and a
pipeline.

### `programme/space-programme.ts`

`withPreviousSpaceIds` re-uses the approved programme's space ids for spaces a
regeneration produced again, matched by name, and moves adjacency with them.

This is what makes the comparison possible at all — `synthesizeProgramme` mints a
fresh uuid per space on every call, so no two syntheses were ever equal. It also
closes a defect nobody reported: a Layout Plan's nodes **are** programme space
ids, so re-approving a programme with new ids left every downstream artefact
pointing at spaces that no longer existed. Detectable as staleness, but dangling
in a way staleness does not describe.

### `architectural-intelligence-service.ts`

All four generation stages now build their patch, compare, and answer
`NothingToDo` when it changes nothing. No tool changes were needed: the tools
already turn any response without a proposal into a blocker.

### `brief/brief-assembly.ts`

`backstopTexts` gives the backstop the user's message **and** the Brief's own
utterance and objectives, in that precedence order. `BACKSTOP_TOPICS` is what
makes reading a model's paraphrase safe — those four patterns need an explicit
number beside an explicit noun, so a restatement either contains the figure or
matches nothing. The relationship reader (Bug 004) reads the same texts.

## Result

The same four `ok`s, with the model firing all four tools every time:

| Turn | Claims the proposal slot | Approved       |
| ---- | ------------------------ | -------------- |
| 1    | `space-programme`        | revision 1     |
| 2    | `layout-plan`            | revision 1     |
| 3    | `geometry-graph`         | revision 1     |
| 4    | …                        | advances again |

Space programme revisions approved across the whole run: **`[1]`**. Previously
`[1, 2, 3, 4]`.

## Tests

`src/__tests__/pipeline-advance.test.ts` — 11 assertions. Verified load-bearing
by neutering each mechanism in turn: disabling `changesAnything` fails 6 of 11,
disabling `withPreviousSpaceIds` fails 7 of 11.

Covers: the gates blocking every downstream stage and naming the missing
predecessor (the part that was already correct, now guarded against regression);
regeneration refused with the `NothingToDo` vocabulary and a next-stage
suggestion; a real change still revising; space ids and adjacency surviving a
revision; and the observed conversation turn by turn — one stage per `ok`, one
programme revision, geometry reached.

`src/__tests__/brief-fidelity.test.ts` gains the "single storey" case: the
objective is read when the last user message no longer carries the figure.

Two existing tests encoded the old behaviour and were updated, not deleted:

- `revision-lineage.test.ts` "revises the programme rather than minting a second
  one" regenerated an _identical_ programme and expected revision 2 — precisely
  the churn. It now changes the brief first, so it still proves Story 1.3.7's
  same-id-next-revision claim.
- `brief-fidelity.test.ts` "fills nothing when there is no user message" is now
  "fills nothing when nothing readable is available at all", since objectives are
  a legitimate source.

Full suite: 699 tests green, `tsc -b` and lint clean.

## Definition of Done

- [x] Conversational Brief capture preserves stated `totalArea`.
- [x] Tool and conversational Brief capture converge on the same assembly semantics.
- [x] `planning_generateProgramme` requires an approved current Brief. _(already true)_
- [x] `planning_generateLayout` requires an approved current Programme. _(already true)_
- [x] `planning_generateGeometry` requires an approved current Layout. _(already true)_
- [x] `planning_generateSpecification` requires an approved current Geometry. _(already true)_
- [x] Approval does not imply generation of downstream stages.
- [x] Repeated `ok` does not create identical Programme revisions.
- [x] The observed conversation is covered by a regression.
- [x] Downstream stages cannot execute against stale predecessor artefacts. _(already true, `supersededInput`)_
- [x] Existing Architectural Intelligence tests remain green.
- [x] No ArchiSimple execution changes are required.
- [ ] ~~A single conversational turn cannot execute multiple design-generation
      stages~~ — **withdrawn**. The gates already make multi-stage execution
      impossible; a per-turn cap would live in `apps/web` and would now forbid
      nothing that can happen.

## Still open

**The dropped proposal is silent.** `aiServiceProvider` keeps the first artefact
proposal and reports the rest as "further actions … left out", which reads as a
minor aside. With the churn fixed the Layout now wins the slot, so this no longer
bites — but a legal artefact being discarded because another tool was called
first is a design question, not a detail. It lives in `apps/web`.

**Finding 5 — the model narrating artefacts that do not exist.** Unfixed, and the
most user-visible problem left. A blocker surfaced as a warning beside confident
prose does not stop the prose being believed. Fixing it properly probably means
the host refusing to render a design narrative when the turn produced no
artefact, which is a conversation-layer decision.

**The dead `conversation` context key.** Still read, still never populated. Now
harmless — the objectives path covers the real case — but it should either be
wired in `apps/web` or removed so the next reader is not misled.

## Architectural principle

The report's principle stands, with its emphasis corrected:

> **Architectural Intelligence proposes one design stage at a time. Approval
> advances the design; generation creates or revises an artefact.**

What this bug adds is the clause that was missing:

> **A regeneration that changes nothing is not a revision.** An artefact whose
> content is unchanged must refuse to supersede itself — not because the extra
> revision is untidy, but because every stage below it pays for the churn.
