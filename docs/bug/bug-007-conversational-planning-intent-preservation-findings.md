# BUG-007 — Findings and fix

> **Status:** Fixed
> **Investigated at:** `architectural-intelligence` `53388df` (v0.2.0), `archisimple` `2d9fc6a`
> **Answers:** [BUG-007](bug-007-conversational-planning-intent-preservation.md) §5 (investigation requirement)
>
> §§2–6 are the investigation, kept as written. §7 is the plan; §8 is what was
> delivered against it.

---

## 1. Result in one line

Two independent transitions are wrong, both inside **Conversation → Brief**. Nothing
downstream loses anything: the Programme, Layout, Geometry and Specification all
carry forward what the Brief gives them, and the Brief is what arrives empty.

No stop condition in §11 is met. The Brief contract can already represent
everything the user said, and `BriefRequirementSource` already distinguishes
`stated` / `answered` / `assumed` — no new taxonomy is needed.

---

## 2. Reproduction, exactly

Against `dist/` at the commit above, one call to `assembleBriefFromFields`
reproduces the reported Brief **verbatim**, including the "a budget of no budget"
artefact:

```js
assembleBriefFromFields({
  utterance:  'Design a modern single-storey apartment with 2 bedrooms, 2 bathrooms and a small home office',
  objectives: ['Design a modern single-storey apartment with 2 bedrooms, 2 bathrooms and a small home office'],
  spaces:     [{ name: 'home office', count: 1 }, { name: 'kitchen', count: 1 }],
  requirements: [
    { topic: 'storeys',   value: 1,           statement: '1 storey' },
    { topic: 'bedrooms',  value: 2,           statement: '2 bedrooms' },
    { topic: 'bathrooms', value: 2,           statement: '2 bathrooms' },
    { topic: 'style',     value: 'modern',    statement: 'modern style' },
    { topic: 'budget',    value: 'no budget', statement: 'a budget of no budget' }
  ],
  userMessage: 'modern style, and no budget constraint'
});
```

produces

```text
SPACES        1x home office, 1x kitchen, 2x bedroom, 2x bathroom
REQUIREMENTS  1 storey / 2 bedrooms / 2 bathrooms / modern style /
              a budget of no budget / no garage (assumed) /
              no home office (assumed) / no specific accessibility requirement (assumed)
ASSUMPTIONS   … 'No home office, since none was mentioned.' …
totalArea     ABSENT
```

Both reported contradictions, from one call. The shape of the arguments also
identifies the path: `a budget of no budget` can only be produced by
`brief-tools.ts`'s `` `a budget of ${budget}` `` from a model-supplied string, so
the conversation went through `planning_captureBrief`, not the offline path.

---

## 3. Defect A — "no home office" beside a home office

### First incorrect transformation

`withDefaults()` in [`src/brief/brief-assembly.ts`](../../src/brief/brief-assembly.ts).

It decides which defaults to apply by looking at `requirements` **and nothing
else**:

```ts
for (const candidate of DEFAULTED_TOPICS) {
  if (result.some((requirement) => requirement.topic === candidate.topic)) continue;
  // → office is absent from requirements, so office = false, 'no home office'
}
```

`desiredSpaces` is not in scope at that point, and the model had put the office
*there* — `planning_captureBrief` exposes an office both as a `spaces` entry and
as an `office` boolean, and a model that lists the space and omits the flag has
still said the office exists.

This is §4's rule violated literally: **unspecified became false**. The Brief then
carries a `home office` space and an `office = false` requirement at the same
time, and prints the assumption that denies it.

### Consequence downstream

`programme-synthesis.ts`'s `priorityFor` reads `TOPIC_BY_SPACE['home office'] →
office`, finds the requirement's source is `assumed`, and demotes the office to
`SPACE_PRIORITIES.Optional` — a space the user explicitly asked for, marked as
one the layout planner may drop under pressure.

### Fix

Make the defaults **space-aware**, and only in the direction that removes the
contradiction:

1. `withDefaults(requirements, desiredSpaces)` — a defaulted topic whose space is
   already named is recorded as **satisfied and `stated`**, with no assumption
   text. A topic the caller *did* supply is still the caller's, whatever the
   spaces say: the rule only ever replaces a default, never an explicit value.
2. The converse, so the Programme actually contains what the Brief states:
   `withCountedSpaces` derives bedroom/bathroom spaces from counts today; extend
   the same derivation so `office = true` with no `home office` space produces
   one. Otherwise a model that passes the flag and not the space gets a Brief that
   requires an office and a Programme with no room for it.
3. Both directions read **one** topic ↔ space table. `programme-synthesis.ts`
   already holds half of it (`TOPIC_BY_SPACE`) and matches by role
   (`SPACE_ROLES`); lift the mapping into the brief module so a "study" and a
   "home office" cannot be answered differently in two files.

Call sites to update: `assembleBrief`, `answerClarification`, and
`assembleBriefFromFields` — all three call `withDefaults`, and all three know
their spaces.

---

## 4. Defect B — the 100 m² target disappears

### First incorrect transformation

The same call, but a different mechanism: the total area never enters the Brief at
all, so `synthesizeProgramme`'s `statedTotalArea()` correctly answers `undefined`
and correctly reports "No total was stated". The Programme is honest about a Brief
that is not.

Bug 003's backstop (`withBackstopTopics`) exists precisely to recover this, and it
works — supplying `userMessage: 'Can you build me a 100m2 appartment?'` to the
same call recovers `a total area of about 100 m² (stated)`. It failed here for two
reasons, either of which is sufficient on its own.

### B1 — `userMessage` is always `undefined` in production

`brief-tools.ts` reads the user's own words from
`context['conversation'].lastUserMessage`. **No `conversation` context fragment is
ever produced.**

- `AssembledContext` is keyed by Context Provider id
  (`packages/ai-engine/src/context-pipeline.ts`).
- The registered providers are `selection` (built into `ai-engine`), `document`,
  `view`, `tool`, `building`, `spatial`, `inspector`, `architecture` and whatever
  plugins add (`apps/web/src/App.tsx:382`).
- `lastUserMessage` appears nowhere in `archisimple` outside `dist/`. In this
  repository it appears only in test fixtures.

So the half of the backstop that reads what the *user* said has never run outside
tests. Only `utterance` and `objectives` — the model's own arguments — reach it.

### B2 — one message is not enough reach

Even once populated, `lastUserMessage` is the *latest* turn. The reported
conversation asked for 100 m² in turn 1 and the Brief was captured several turns
later, after the storeys / bedrooms / bathrooms clarifications. Bug 005 already
recorded this failure mode and answered it by reading the model's objectives back;
that works only when the model's paraphrase happens to repeat the number, and here
it did not.

### Fix

1. **`ai-engine` gains a built-in `conversation` Context Provider**, beside
   `createSelectionContextProvider` — the one existing precedent for a provider
   that lives in `ai-engine` because only it can answer honestly.
   `AiSessionController` owns the active conversation, so it is the only component
   that can report it, and adding it in `assembledContext()` avoids the circular
   wiring a host-side provider would need (the providers are constructed *before*
   the controller in `App.tsx`).
   Fragment: `{ lastUserMessage, userMessages }` — user turns only, newest first,
   capped.
2. **Widen the backstop's reach** from one message to those turns.
   `backstopTexts()` becomes `[...userMessages(newest first), utterance,
   ...objectives]`. Precedence is already correct by construction:
   `withBackstopTopics` fills a topic once and skips it thereafter, so the most
   recent statement wins and a user who revises 100 m² → 120 m² is not overruled
   by their first sentence.
3. Nothing widens *what* may be backstopped. `BACKSTOP_TOPICS` stays the same four
   patterns that demand an explicit number beside an explicit noun — that is what
   made re-reading a paraphrase safe in Bug 005, and it is what makes re-reading
   an older turn safe here.

---

## 5. What is **not** broken

Verified while tracing, so the fix does not wander:

| Transition               | State                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Brief → Programme        | Correct. `statedTotalArea` reads the topic, `allocateSpaceAreas` scales to it, `AREA_SOURCES.ScaledToStatedTotal` records why. |
| Programme → Layout       | Consumes programme areas; carries no independent copy of the target.                                                          |
| Layout → Geometry → Spec | Correct. The Specification emits walls **and** openings (`openingsFor`).                                                      |
| 85 m² vs 100 m²          | Not a defect (§8). Once the target survives, the allocation scales to it.                                                     |

Per §8, no change to the area-allocation algorithm is proposed.

---

## 6. Minor, adjacent, not in scope

`budget: "no budget"` becomes the requirement `a budget of no budget` with the
value `'no budget'` — a stated budget whose content is the absence of one. It is
cosmetic today because nothing consumes `budget`, and fixing it means deciding
what an explicitly-refused topic looks like, which §7 of the bug asks for as
*existing contract* rather than new taxonomy. Recorded here; not fixed by this
work unless asked.

---

## 7. Plan

| #   | Change                                                                              | Where                                       |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | `conversation` Context Provider (`lastUserMessage`, `userMessages`)                  | `archisimple` `packages/ai-engine`          |
| 2   | One topic ↔ space-role table, shared by defaults and the Programme                   | `src/brief/`                                |
| 3   | `withDefaults` becomes space-aware; a named space satisfies its topic as `stated`    | `src/brief/brief-assembly.ts`               |
| 4   | `withCountedSpaces` derives the space from a stated flag (the converse)              | `src/brief/brief-assembly.ts`               |
| 5   | `backstopTexts` reads the conversation's user turns, newest first                    | `src/brief/brief-assembly.ts`               |
| 6   | Canonical regression: the §6 scenario through the real pipeline, asserting semantics | `src/__tests__/`                            |
| 7   | Explicit-positive / unspecified / explicit-negative cases (§7)                       | `src/__tests__/`                            |

Step 1 is in the other repository and is purely additive — no Automation contract
change, no project-file change. Per ADR-0030 Rule 8 it lands and releases first;
in the local linked workspace it is simply built first.

Steps 2–5 are confined to `src/brief/`. No new artefact field, no cross-repo
contract, no example-specific special case.

### Assertions the regression must make

Semantic, never prose (§6):

```text
briefRequirement(brief, 'totalArea').value === 100
briefRequirement(brief, 'office').value    === true
briefRequirement(brief, 'office').source   !== 'assumed'
brief.desiredSpaces contains 'home office'
brief.assumptions does not deny the office

programme.spaces contains a space filling the office role
that space's priority === 'required'
programme totals scale to 100, and AREA_SOURCES is ScaledToStatedTotal
```

plus §7's three cases: an unmentioned garage stays `assumed`, an explicitly
refused garage stays `stated`/`false`, and neither is confused with the other.

---

## 8. What was delivered

Every step of §7, in both repositories.

### `archisimple` (`packages/ai-engine`)

`context-providers/conversation-context.ts` — the second built-in Context
Provider, beside the selection one. It reports `lastUserMessage` and
`userMessages` (newest first, capped at twelve), including the message currently
being sent, which is not in the conversation when `sendMessage` assembles the
context. `assembledContext` takes an optional pending message and contributes the
fragment only once something has been said, so the Context Inspector's empty
state stays true and no existing expectation changed.

### `architectural-intelligence`

| File                            | Change                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/brief/topic-spaces.ts`     | New. The one topic ↔ space table, matched by role.                                                                 |
| `src/brief/brief-assembly.ts`   | `withSpaceStatedTopics`; `withDefaults` takes the spaces; all three call sites pass them; the backstop reads turns. |
| `src/brief/brief-topics.ts`     | `desiredSpacesFrom` derives the space a stated boolean topic names.                                                 |
| `src/tools/brief-tools.ts`      | Reads `userMessages` off the fragment and passes it to both assembly paths.                                        |
| `src/programme/programme-synthesis.ts` | Its own literal `TOPIC_BY_SPACE` deleted; `priorityFor` reads the shared table.                             |

The completion rule is asymmetric on purpose: it replaces a **missing or
assumed** value and never a `stated` or `answered` one, so a named space cannot
overrule an explicit refusal. Counted topics are never inferred from a space —
"bedroom" in a space list says one exists, not how many.

### Verification

`src/__tests__/brief-intent-preservation.test.ts` — 13 tests, driving the real
`planning_captureBrief` tool behind a real conversation fragment and asserting
semantic values. Five of them fail against the unfixed sources; the other eight
pin behaviour that had to survive.

The reported conversation, run end to end through the built output:

```text
REQUIREMENTS  1 storey / 2 bedrooms / 2 bathrooms / modern style /
              a total area of about 100 m² (stated) /
              a home office (office=true, stated) /
              no garage (assumed) / no accessibility requirement (assumed)
ASSUMPTIONS   no garage; no step-free requirement          ← the office denial is gone
PROGRAMME     home office 10.588 m² (required, scaled-to-stated-total) … TOTAL 100 m²
```

`pnpm build`, `pnpm test` (737), `pnpm lint`, `pnpm depcruise` and the four web
validators all pass in `archisimple`; `npm run build`, `npm test` (737) and
`npm run lint` pass here.

### Not done, deliberately

§6's `budget: "no budget"` artefact. It is cosmetic, nothing consumes `budget`,
and fixing it means deciding what an explicitly-refused topic looks like — a
question BUG-007 §7 asks to be answered in the existing contract rather than
inside this fix.
