# Sprint 1.13 — Sun Questions

> **Status:** **Complete** (2026-09-27)
> **Version:** 1.1 (2026-09-27) — reviewed against the code before implementation;
> §7 lists what the review settled.
> **Repository:** `architectural-intelligence` — the host half is **ArchiSimple
> Sprint 085.1** (one end-to-end test; no host code)
> **Related ADRs:** ADR-AI-0004 (why a port, and when one is not needed);
> ArchiSimple ADR-0091 (the solar model), ADR-0092 (Sun Settings), ADR-0030
> revision 2.0 (the splice)
> **Prerequisites:** ArchiSimple **084.1** (`getSunPosition`, `getSolarDay`) and
> **085.0** (nothing published; built through the splice)
> **Next:** Sprint 1.14 — the sun lane (setting the sun), ArchiSimple 085.2.

---

## 1. Objective

The Architectural Assistant, with no language model, answers questions about
the project's sun: when it rises and sets, how high it climbs, where it is at
the project's moment or on a named day.

```text
"When does the sun rise on 21 December?"
  → recognizeIntent: question.sun, day "12-21"
  → BuildingKnowledge.solarDay("2027-12-21")     (getSolarDay, through the host's QueryDispatcher)
  → answerArchitecturalQuestion → "On 21 December the sun rises at 08:13 …"
```

Today such a question falls to `unknown`, or — with "daylight" in it — to the
`naturalLight` rule, which talks about windows. ArchiSimple's language-model path
already has the sun (084.2's context fragment, 084.7's `sun_show`); this is the
deterministic path's.

---

## 2. Current state

- **No sun anywhere here.** Nothing names `sun`, `solar`, `getSunPosition` or
  `getSolarDay` (src, docs, manifests).
- **`BuildingKnowledge` already reads the platform through Queries.** It holds
  the host's `QueryDispatcher` (`building-knowledge.ts` options L60-66) and runs
  typed Queries through it (`getProjectStructureQuery`,
  `getBuildingMaterialCatalogueQuery`, … L35-48). `automation-api` is on the
  seven-package allow-list, and allowed in `understanding/`.
- **Questions** are recognised by the ordered `RULES` in `intent-recognizer.ts`
  (questions first, first match wins) and answered by
  `answerArchitecturalQuestion`'s `switch` (`architectural-question.ts`
  L66-90), which returns `{ text, facts, limitation? }` in English Markdown.
  `classifyRequest` sends any Question to `direct-execution`, so no lane is
  added.
- **The `naturalLight` rule** (`intent-recognizer.ts` L210-213) matches
  `natural light`, `daylight` and `no windows`.
- **`@archisimple/solar` is not on the allow-list**, and need not be: the
  Queries answer with typed DTOs, and the sun's maths stays on the platform
  (ArchiSimple ADR-0091 Rule 9).

---

## 3. Decisions

**DEC-1 — No port: the Queries.** ADR-AI-0004 made the realisation state a
host-supplied port because nothing on the boundary answers it and the context
fragment is untyped. Neither holds for the sun: `getSunPosition` and
`getSolarDay` are versioned Queries with typed DTOs, reachable through the
`QueryDispatcher` this layer already holds. A port would be a second road to one
answer. `BuildingKnowledge` gains two reads:

- `sunAt(moment?)` → `getSunPositionQuery(moment ?? {})`;
- `solarDay(localDate?)` → `getSolarDayQuery(...)`.

**DEC-2 — One question action, `question.sun`,** answering with what the
question needs, not a sub-lane per phrasing:

- the **day**: sunrise, solar noon (with its height), sunset, day length — or
  polar day / polar night, as values;
- the **position** at the project's moment (or at a named time): direction as
  an eight-point word and degrees from true north, and height;
- the **state**: whether the sun is on in the view, and at which moment.

`facts` carries each value structured, beside the text.

**DEC-3 — Recognition, and the collision with `naturalLight`.** A new rule,
placed **before** `naturalLight`:

- matches `sunrise`, `sunset`, `solar noon`, `sun` + (`rise`/`set`/`high`/
  `where`/`position`/`angle`/`time`), `day length`, `how long is the day`;
- `unless` a setting verb (`show`, `set`, `turn`, `put`, `move to`) — those are
  Sprint 1.14's;
- `daylight` stays `naturalLight`'s. "Sunlight" in a room ("does the kitchen get
  sunlight") is exposure, which nothing computes yet (ArchiSimple V2 phase D):
  it goes to `question.sun` and answers with a `limitation` saying exactly that,
  rather than to `naturalLight`'s window talk.

**DEC-4 — Days, named in English.** A small parser in `understanding/` reads:

- `on 21 December`, `December 21`, `21 Dec`, `2027-12-21`, `21/12`;
- `the June solstice`, `the March equinox`, and `the summer/winter solstice`,
  resolved by hemisphere from the Site's latitude (June is winter in Sydney),
  to the reference days `getSolarDay` already returns;
- a time: `at 10`, `at 10:30`, `at 3 pm`.

A day without a year takes the project moment's year, else the present year.
A day it cannot read is a `limitation`, never a guess.

**DEC-5 — The clock.** When the project has no moment and none is named, the
answer uses the present, passing `now` to `getSolarDay` as ArchiSimple's
`sun_show` does; the Query itself reads no clock. `BuildingKnowledge` takes an
optional `now?: () => number` (default `Date.now`), so tests fix it.

**DEC-6 — Honest absences.** Not located: "The project has no place yet, so it
has no sun" (the Queries' `not-located`). Sun off: the answer still gives the
sun, and says the 3D view is not showing it. Time zone approximate: says so,
as ArchiSimple's editor does.

---

## 4. Out of scope

- Setting the sun (Sprint 1.14, ArchiSimple 085.2).
- Exposure per room or window (ArchiSimple V2 phase D).
- Localised answers: this layer answers in English, as every answer does.

---

## 5. Acceptance criteria

1. "When does the sun rise on 21 December?" for Grenoble answers 08:13, from
   `getSolarDay`, with the facts structured. (DEC-1, DEC-2, DEC-4)
2. "Where is the sun?" answers the direction and height at the project's
   moment, and says whether the view shows it. (DEC-2, DEC-6)
3. "How high is the sun at noon on the winter solstice?" resolves the December
   solstice in Grenoble and the June one in Sydney. (DEC-4)
4. Tromsø in June: "the sun does not set"; in December: "the sun does not
   rise". (DEC-2)
5. "Is there enough daylight in the kitchen?" still reaches `naturalLight`;
   "does the kitchen get sunlight?" answers with the exposure limitation;
   "show me the shadows at 10" is **not** `question.sun`. (DEC-3)
6. A project with no place answers the limitation; an unreadable day answers a
   limitation naming what could not be read. (DEC-4, DEC-6)
7. The allow-list is unchanged (seven packages) and `@archisimple/solar` is not
   imported; the suite, lint, `tsc -b --force` and `pnpm depcruise` pass
   through the splice. (DEC-1)

---

## 6. Testing strategy

- **Unit:** the rule and its collisions; the day parser (each form, the
  hemisphere, a bad day); the answer from a fake `QueryDispatcher` returning
  recorded DTOs (Grenoble 21 June and 21 December, Tromsø, not located, sun
  off).
- **End to end:** ArchiSimple 085.1's test composes this layer with the real
  host and asks the questions against a located Site.
- **Gates:** as criterion 7, through the splice (`against-platform-source`).

---

## 7. Review 1.1 (2026-09-27)

1. **The day is read at recognition.** A `RecognitionRule` already returns
   `parameters` from its match (`intent-recognizer.ts`, `parameters?`), so the
   day and time phrases are extracted there, raw; the hemisphere is resolved
   when answering, because it needs the Site (DEC-4).
2. **The Site is a third Query.** "No place" and "which hemisphere" both come
   from `getSiteQuery` (`anchor`), read through the same dispatcher (DEC-1).
3. **No compliance rule touches `intent/` or `understanding/`**; `automation-api`
   is already imported by `building-knowledge.ts`. Nothing new is allowed or
   needed.
4. **The test harness throws on a Query it does not know.** It gains the three
   sun Queries with honest defaults (no place; no sun), and tests supply
   recorded DTOs — the values `@archisimple/solar` computes for Grenoble and
   Tromsø. The real composition is ArchiSimple 085.1's test.
5. **A time is read as written, on a 24-hour clock.** "At 3" is 03:00, and the
   answer names the time it used, so a wrong reading is visible, never silent.

## Outcome

### What landed

- `src/intent/architectural-intent.ts`: `ARCHITECTURAL_ACTIONS.sun`
  (`question.sun`).
- `src/intent/sun-phrases.ts`: `parseSunPhrase` — the day (four date forms,
  the month-named and season-named reference days) and the time (24-hour,
  `am`/`pm`, noon), with `unreadable` for anything it recognises and cannot
  read.
- `src/intent/intent-recognizer.ts`: the rule, before `naturalLight`, with its
  veto and an `exposure` flag.
- `src/understanding/building-knowledge.ts`: `site()`, `sunAt(moment)`,
  `solarDay(localDate?)`, `presentInstant()`, and the injectable `now`.
- `src/understanding/sun-question.ts`: the answer; `architectural-question.ts`
  routes to it.
- `src/__tests__/harness.ts`: the three sun Queries, defaulting to no place.
- `src/__tests__/sun-questions.test.ts`: 38 tests.

### Decisions that held

All six. DEC-1 (no port) is the one that mattered: the host's half is a test,
not code.

### Found

- **`pnpm depcruise` is not set up here.** CLAUDE.md says to run it; the
  repository has no script and no dependency-cruiser config, so the command
  prints the tool's usage. The seven-package allow-list is enforced by
  `architecture-compliance.test.ts`, which passes. Recorded, not fixed: setting
  it up is its own change.

### Acceptance criteria, walked

1. **21 December, 08:13, from `getSolarDay`, facts structured.**
   `sun-questions.test.ts` "21 December in Grenoble" (asserts the Query asked
   with `localDate: '2027-12-21'` and the facts); and against the real platform,
   ArchiSimple's `assistantSunQuestions.test.ts`.
2. **Where the sun is, and whether the view shows it.** "“Where is the sun?”
   answers at the project’s moment…", and the sun-off case; the real platform
   in ArchiSimple's test.
3. **The winter solstice by hemisphere.** "the winter solstice is December’s in
   Grenoble and June’s in Sydney"; ArchiSimple's test resolves 2027's to the
   22nd from the real Query.
4. **Tromsø.** "Tromsø: the sun does not set in June, and does not rise in
   December".
5. **The collisions.** "leaves daylight to naturalLight, and setting the sun to
   Sprint 1.14"; "marks a question about how much sun a room gets as exposure";
   "how much sun a room gets is exposure".
6. **No place; an unreadable day.** The two named tests, and ArchiSimple's
   "says a project with no place has no sun".
7. **Seven packages, no `solar`, the gates.** `architecture-compliance.test.ts`
   passes unchanged; the suite 1,019 passed, 1 expected fail, 1 skipped,
   2 todo; lint clean; `tsc -b --force` clean. `pnpm depcruise`: not set up
   (Found).
