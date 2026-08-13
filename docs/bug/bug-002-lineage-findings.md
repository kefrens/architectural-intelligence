# Bug 002 — lineage findings

> **Investigated:** 2026-08-10 · **Resolved** by
> [Sprint 1.5 — Brief Lifecycle Integrity](../sprints/sprint-001.5-brief-lifecycle-integrity.md)
> **Verdict:** my bug, from Sprint 1.3. The lineage _guard_ shipped; the thing it
> guards against was left reachable through both front doors.
> **Severity:** the affected project is **unrecoverable** — every stage becomes
> ineligible, including the Brief, and `currentStage` is `undefined`. The
> projection offers the user no action at all.

---

# The one-line answer

Sprint 1.3 made **regeneration a revision** for the four derived stages
(Story 1.3.7) and gave the Brief a revision path through the conversation
(Story 1.3.5). It did **not** stop either path that _creates_ a Brief from
minting a new lineage. So a second Brief is a second lineage, Sprint 1.3's own
integrity check correctly reports the project as ambiguous, and the check is
fatal because it makes the Brief stage ineligible too.

The guard is right. What is wrong is that an ordinary conversation can reach the
state it guards against, and that reaching it is terminal.

---

# Reproduced

Both halves, against the built `dist/`.

## The split

```
capture #1 -> c2df8abb rev 1
capture #2 -> 85f3adfb rev 1
same lineage? false
brief.eligible     = false | blockers: [ 'ambiguous' ]
programme.eligible = false | The brief this space programme derives from has
                             more than one lineage, so it cannot say which one
                             to build from.
currentStage = undefined
```

The message is the transcript's, verbatim. Note the last line: **no stage is
eligible and there is no current stage**. `nextTool` is `null`. A user in this
state is offered nothing, by every surface at once — the conversation, the
tools, and Sprint 1.4's context fragment.

## The classification

```
"Build me a 100m2 appartment, with 2 bedrooms and 1 bathroom"
  -> direct-execution | No whole dwelling is named, so this is a modelling request.

"Build me a 100m2 apartment,  with 2 bedrooms and 1 bathroom"
  -> clarification-required | signals: ["apartment"]
```

One transposed letter. That is the whole of the second question.

---

# Root cause: the Brief has two creation paths and neither can revise

Every other stage's tool is a **factory bound to the service**:

```ts
createProgrammeToolDefinition(intelligence); // can call intelligence.approvedProgramme()
createLayoutToolDefinition(intelligence);
createGeometryToolDefinition(intelligence);
createSpecificationToolDefinition(intelligence);
```

That binding is what let Story 1.3.7 give each of them "an approved artefact is
revised, never replaced".

The Brief's is not:

```ts
export const captureBriefToolDefinition: ToolDefinition = { … };   // a standalone const
```

It holds no service, so it **cannot read the artefact reader**, so it cannot know
a Brief exists. Every call runs `assembleBriefFromFields` → `createBrief` → a
fresh `createUuid()` at revision 1. It was the one stage that structurally could
not be given the Story 1.3.7 treatment, and I did not notice.

**The conversation path has the same hole.** `interpret`'s `BriefGeneration`
branch calls `assembleBrief` unconditionally, and the classifier still routes a
complete design request there even when a Brief is approved:

```
project already holds an approved Brief:
  "design a two-storey house with 4 bedrooms and 2 bathrooms"  -> brief-generation   ← forks
  "actually make it 3 bedrooms"                                 -> brief-revision     ← revises
```

Only an utterance carrying a **revision cue** reaches `reviseBriefFrom`. A
re-description without one mints a second lineage exactly as the tool does.

So Sprint 1.3 delivered a revision path and two intact fork paths.

---

# Why my Sprint 1.3 reasoning was wrong

Story 1.3.4, as written and as implemented:

> No migration, and no repair path for existing files: there are no projects
> created before this sprint. The report exists to catch a regression in the
> revision paths Epic 2 adds, not to accommodate history.

That reasons only about **pre-existing files**. It is true and irrelevant. The
split does not come from history — it comes from the live tool path, in a project
created seconds earlier, on the second call.

Having concluded the state was unreachable, I made it terminal: the blocker sits
on the stage's own `blockers`, which sets `eligible: false`, which empties
`actions`, which leaves `currentStage` undefined. For a defect that genuinely
could not occur that is defensible. For one an ordinary conversation reaches in
two turns, it is worse than the ambiguity it reports.

---

# Why the assistant kept re-capturing

"ok" classifies as **Direct Execution** — it names no dwelling and asks for
nothing. With a model driving through tools, the reply is the model's choice, and
before Sprint 1.4 nothing in its context said a Brief existed or that
`planning_generateProgramme` was the next move. It reached for the tool it had
just used successfully.

Sprint 1.4 addresses that half: the fragment now carries `design.nextTool`, which
after a Brief approval reads `planning_generateProgramme`. **It is guidance, not a
constraint.** A model may still call `planning_captureBrief` again, and today
that call still forks. Guidance narrows the odds; the tool has to stop being able
to fork at all.

If the transcript predates the local `pnpm build:ai` that picked up Sprint 1.4,
the model had no guidance whatsoever, which explains it entirely.

---

# The dwelling vocabulary is exact-match

```ts
const DWELLING_WORDS =
  /\b(house|home|apartment|flat|villa|bungalow|cottage|studio|dwelling|residence|maisonette)\b/i;
```

`appartment` — the French spelling, and one of the most common misspellings in
English — matches nothing, so `signals` is empty and the classifier falls through
to Direct Execution, where the planner answers "I did not recognise that as
something I can do to the building model" and lists its edit operations.

The fall-through is deliberate and correct in general: the classifier's own
comment explains that the cost of the two mistakes is asymmetric, so it wants
positive evidence of a programme. But "no dwelling was named" and "a dwelling was
named and I could not spell-match it" are different facts, and the second is
currently reported as the first.

Worth noting what the message does to a user: it is confident, it is wrong, and
it lists seven `edit.*` actions that have nothing to do with what was asked.

---

# Summary

| #   | Finding                                                                       | Severity                           |
| --- | ----------------------------------------------------------------------------- | ---------------------------------- |
| 1   | `captureBriefToolDefinition` mints a new lineage on every call                | **Fatal** — terminal project state |
| 2   | `interpret`'s `brief-generation` lane forks the same way                      | **Fatal**, same mechanism          |
| 3   | The lineage blocker makes the Brief stage ineligible, so there is no recovery | **Fatal**                          |
| 4   | `DWELLING_WORDS` is exact-match; `appartment` leaves the design pipeline      | High — a typo loses the workflow   |

Findings 1–3 are one bug wearing three faces: **the Brief can be created twice,
and being created twice is unrecoverable.**

---

# Resolution

Sprint 1.5 closed all three creating paths through one folding function,
`reviseBriefFromFields`. Findings 1–3 are fixed; finding 4 is fixed for the
reported spellings, with the broader classifier rule deliberately deferred and
recorded in `notImplemented`.

The guard was not weakened and no lineage is auto-chosen — Story 1.5.14 asserts
both. A project that already holds two lineages still cannot be repaired without
someone choosing between two designs; see _The already-damaged project_ below.

---

# What a fix has to do (as specified before implementation)

The bug report asks not to weaken the validation and not to auto-choose a
lineage. Agreed on both — the ambiguity is real and picking silently is how a
user ends up with a building derived from a brief they did not mean.

## 1. Producing a Brief for a project that has one is a **revision**

The rule Story 1.3.7 applied to four stages, applied to the fifth. Both doors:

- **The tool** becomes `createCaptureBriefToolDefinition(intelligence)`, like its
  four siblings, so it can read `approvedBrief()`. The tool's _name and schema do
  not change_, so no model sees a difference — only the host's composition does.
  It needs a field-based counterpart to `reviseBriefFrom`, since the tool holds
  the model's structured arguments rather than an utterance.
- **`interpret`'s `brief-generation` branch** folds into the approved Brief when
  one exists, instead of calling `assembleBrief` unconditionally.

A re-capture that changes nothing should answer the way `reviseApprovedBrief`
already does — a `NothingToDo` blocker — rather than producing revision _n+1_
identical to revision _n_. In the transcript that alone would have ended the
loop.

## 2. Then the guard becomes what it was meant to be

With both doors closed, a split lineage is once again only reachable through a
defect, and Story 1.3.4's blocker is the correct response to it.

## 3. The already-damaged project

It cannot be repaired without someone choosing a lineage, and that choice is the
user's. Two honest options, and I would not build the second yet:

- **Start a new project.** Zero code, and correct: the project holds two designs
  and no basis for preferring either.
- **An explicit "use this brief" action**, which needs a surface to present the
  two lineages — the IA panel, not a lane.

What I would _not_ do is soften the blocker so the project limps on, because the
limp is silent and the thing it silently picks is a building.

## 4. Misspellings

Separable, and smaller. Options in increasing cost: add the common variants
(`appartment`, `appartement`) to the word set; or treat "a design verb plus at
least two mandatory brief topics" as programme evidence even when no dwelling
word matched, since "build me … with 2 bedrooms and 1 bathroom" is unambiguously
a design request whatever the noun was.

I lean to the second — it stops the failure mode rather than one instance of
it — but it widens the lane the classifier deliberately keeps narrow, so it wants
its own decision rather than being smuggled in beside a lineage fix.
