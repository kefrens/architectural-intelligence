# Sprint 1.14 — Sun Lane

> **Status:** **Complete** (2026-09-27)
> **Version:** 1.0 (2026-09-27) — written against the code, reviewed in §7.
> **Repository:** `architectural-intelligence` — the host half is **ArchiSimple
> Sprint 085.2** (one end-to-end test; no host code)
> **Related ADRs:** ArchiSimple ADR-0092 Rules 1–2 (the sun as Site data, one
> Request), ADR-0093 (auto-apply), ADR-0027.1 Rule 7 (one approval path)
> **Prerequisites:** Sprint 1.13 (sun questions; the day reader; the sun reads on
> `BuildingKnowledge`)
> **Next:** unassigned in this repository; ArchiSimple V2 phase C/D.

---

## 1. Objective

The Architectural Assistant, with no language model, **sets** the project's
sun: "show me the shadows on 21 December at 10" becomes a proposal of one
`automation.setSunSettings`, approved on the one path — and applied at once
when the user has allowed it (ArchiSimple ADR-0093), because that rule reads the
proposal, not who made it.

```text
"Show me the shadows on 21 December at 10"
  → recognizeIntent: edit.setSun { day 12-21, time 10:00 }
  → classifyRequest: direct-execution (no dwelling is designed)
  → planner → set-sun provider → one step: setSunSettingsRequest({ enabled, localDate, localTime })
  → toProposal (safe) → Approve, or ADR-0093's auto-apply
```

---

## 2. Current state

- **Sprint 1.13** recognises sun **questions**, and its rule vetoes `show`,
  `turn`, `put`, `move`, `change`, `make` and "set the sun" — those phrases
  fall through to the modification rules, where nothing matches them today.
- **A modification** is planned by an `ArchitecturalOperationProvider`
  (`planning/architectural-operation.ts`) registered in
  `createBuiltInOperationProviders()` (`planning/operations/index.ts`); its
  `PlanStep`s carry `request`s, and `toProposal` builds the Proposal
  (`rename-room-operation.ts` is the template: `planned({...})` or
  `blocked(reason, message, suggestions)`).
- **Routing:** `classifyRequest` sends a modification that names no dwelling
  to `direct-execution` (`request-classification.ts`, "No whole dwelling is
  named"), and one naming a dwelling without a design verb there too — "show
  me the shadows on my house" stays direct. `show` is not a design verb.
- **The platform:** `setSunSettingsRequest({ enabled?, localDate?, localTime? })`
  is a partial update; a **first** moment needs both halves (it has no
  default and reads no clock). ArchiSimple's host tool `sun_show` (084.7) fills a
  first moment from `getSolarDay({ now }).suggestedMoment`, or the named day's
  solar noon.
- **ADR-0093's predicate** (`isAutoApprovable`, in `ai-engine`) holds for a
  pending, `safe`, Automation-subject proposal whose every step is an
  allow-listed Request: `toProposal`'s output qualifies with no change.

---

## 3. Decisions

**DEC-1 — `edit.setSun`, a modification rule, first among modifications.**

- Matches a setting verb with the sun — `show … (sun|shadows|sunlight)`,
  `set / put / move … sun`, `turn (the) sun on|off`, `turn on|off the sun`,
  `sun on|off`, and a named moment with "shadows" ("the shadows at 10").
- Parameters: 1.13's `parseSunPhrase` (day, time, `unreadable`) and `enabled`:
  `false` for "off", else `true`.
- Placed before every other modification rule, so "move the sun to 10" is not
  a room move.

**DEC-2 — The `set-sun` provider** (`planning/operations/set-sun-operation.ts`),
built in:

- **No place** → blocked, `unsupported`: "the project has no place, so no sun".
- **Unreadable** day or time → blocked, `missing-information`, naming it.
- **Off** → one step `{ enabled: false }`.
- **On, with a moment named** → one step with the named half or halves; a day
  without a year takes the moment's year, as 1.13 does.
- **On, first time, a half missing** → filled as ArchiSimple's `sun_show`
  fills it (DEC-3).
- **Nothing would change** (on, already on, nothing named) → blocked,
  `nothing-to-do`, saying where the sun already is.
- `risk: safe`; `affects` nothing (the sun is not an element); no highlight.

**DEC-3 — One rule for a first moment, written once.** Two callers now fill a
first moment (`sun_show` in the host, this provider here): the present, to the
quarter hour, or solar noon if dark (`getSolarDay({ now }).suggestedMoment`,
ADR-0091 Rule 10's `initialMoment`), and — when only a day is named — that
day's solar noon. The first half is already one rule, on the platform. The
second is written into **ArchiSimple ADR-0092 Rule 2** by the host sprint, so
both callers implement one written rule, and each has a test pinning it.
Moving it into a Query would change a DTO's meaning for one convention; not
worth a contract version.

**DEC-4 — What the proposal says.** Title "Show the sun on 21 December 2027 at
10:00" (or "Turn the sun off"); reasoning that the sun is the project's study
condition and moves nothing; the expected outcome — the 3D view lit and
shadowed for that moment — with one honest caveat: shadows are a view switch
(_Shadows_ in the Sun row) this layer cannot see or set.

**DEC-5 — English, like every proposal here.**

---

## 4. Out of scope

- The _Shadows_ and _Sun path_ switches: view preferences, not Requests
  (ArchiSimple ADR-0092 Rule 1); this layer neither reads nor sets them.
- Relative moments ("an hour later", "tomorrow"): a later sprint if asked.

---

## 5. Acceptance criteria

1. "Show me the shadows on 21 December at 10" proposes one
   `setSunSettings({ enabled: true, localDate: '2027-12-21', localTime: '10:00' })`,
   `safe`, through `direct-execution`. (DEC-1, DEC-2)
2. "Turn the sun off" proposes `{ enabled: false }`; "turn the sun on" on a
   project whose sun is off proposes `{ enabled: true }` alone. (DEC-2)
3. A first sun with only a day named takes that day's solar noon; with nothing
   named, the Query's suggested moment for the present. (DEC-3)
4. "Show me the shadows" with the sun already on and nothing named is
   `nothing-to-do`; no place is `unsupported`; "on 30 February" names the day
   it could not read. (DEC-2)
5. "Move the sun to 10" is `edit.setSun`, not a room move; "when does the sun
   set?" is still 1.13's question. (DEC-1)
6. ArchiSimple ADR-0093's `isAutoApprovable` holds for the proposal, with the
   host's allow-list. (§2)
7. The allow-list stays seven; the suite, lint and `tsc -b --force` pass through
   the splice.

---

## 6. Testing strategy

- **Unit:** the rule and its neighbours; the provider over the harness's sun
  Queries (recorded DTOs), one case per branch of DEC-2; `isAutoApprovable` on
  the result with `['automation.setSunSettings']`.
- **End to end:** ArchiSimple 085.2's test — the real composition proposes, an
  approval moves the Site's sun, and the auto-apply candidate is recognised.

---

## 7. Review (2026-09-27)

1. **Routing is safe.** A modification naming no dwelling is direct; naming one
   ("my house") needs a design verb to become a Brief, and `show`/`set`/`turn`
   are not design verbs. Checked in `request-classification.ts`.
2. **1.13's veto already hands these phrases over.** Nothing downstream matches
   them today, so the new rule claims them without contest — but it must sit
   **first** among modifications, or "move the sun" could meet the room-move
   rule.
3. **Auto-apply needs nothing.** `toProposal` makes an Automation-subject,
   `safe`, single-Request proposal, which is what ADR-0093's predicate asks.
   The host's panel applies it when allowed, whichever provider answered.
4. **One real duplication** — the first-moment convention — handled by DEC-3:
   written once in ADR-0092, pinned by a test on each side.
5. **Shadows are a view switch the layer cannot see.** Said in the proposal,
   not guessed at (DEC-4).

---

## Outcome

### What landed

- `ARCHITECTURAL_ACTIONS.setSun` (`edit.setSun`) and its rule, first among
  the modifications; 1.13's question veto gained `hide` and a leading
  `sun on|off`, so a bare "sun off" is an instruction, not a question.
- `src/planning/operations/set-sun-operation.ts`, registered in
  `createBuiltInOperationProviders()`.
- `sun-question.ts` exports `namedDate`, so asking about a day and setting the
  sun to it read the day one way.
- `src/__tests__/sun-lane.test.ts` (19 tests), and 1.13's phrase tests gained
  the "to" rule.

### Found

- **"To" is a time word, and a trap.** "Move the sun to 17:30" was not read
  (the reader only knew "at") — a test caught it. Reading "to" as a time would
  have taken "set the sun to 21 December" for 21:00, so the time reader now
  refuses a number followed by a month or an ordinal, and a test pins both
  directions.

### Acceptance criteria, walked

1. **Named moment → one safe `setSunSettings`, direct.** `sun-lane.test.ts`
   "a named moment…" and "routes directly…"; ArchiSimple's
   `assistantSunLane.test.ts` against the real platform.
2. **Off; on alone.** "off, and on alone for a sun that is off"; and the host
   test's "turns the sun off".
3. **First moment.** "a first sun with only a day…" (12:35, that day's noon) and
   "…with nothing named…" (the suggested moment, `now` passed).
4. **Honest refusals.** "refuses honestly: nothing to do, no place, an
   unreadable day".
5. **The neighbours.** "reaching the lane" (nine phrasings) and "leaves
   questions to 1.13, and rooms to their own rules".
6. **ADR-0093.** "ADR-0093’s predicate accepts the proposal"; and the host
   test's `autoApplyCandidate`.
7. **Seven packages; the gates.** Compliance test unchanged and green; the
   suite 1,042 passed, 1 expected fail, 1 skipped, 2 todo; lint clean;
   `tsc -b --force` clean.
