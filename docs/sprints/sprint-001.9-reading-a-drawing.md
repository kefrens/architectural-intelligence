# Sprint 1.9 — Reading a Drawing

> **Status:** Draft
> **Version:** 1.0
> **Repository:** `architectural-intelligence` — the platform half is **ArchiSimple Sprints 046.4, 046.5 and 046.6** (all landed)
> **Related ADRs:** ArchiSimple **ADR-0044 revision 1.1** (Rule 1 — extraction produces a Geometry Graph; Rule 3 — the host assembles; Rule 4 — deterministic work is a Skill's; Rule 5 — confidence is a blocker; Rule 6 — the calibration is the authority; Rule 8 — the image reaches the model through the AI service; Rule 10 — two repositories, in order); ADR-0027.1 Rules 6, 7, 8, 9; ADR-0026 (the AI service owns credentials); ADR-0030 Rule 8
> **Prerequisites:** §2 — **one of them does not exist yet and is ArchiSimple's**
> **Next:** ArchiSimple 046.7 (observations become a Geometry Graph)

---

## 1. Objective

Turn a rendered page into a `PlanReading` — a list of observations in page
pixels, each with a confidence — and **nothing else**.

```text
page raster ──▶ [ this sprint ] ──▶ PlanReading { walls, openings, text }
                                          │
                                          ▼
                          ArchiSimple 046.7: the host assembles a Geometry Graph
```

Everything downstream of that arrow is the host's and is already specified.
Everything upstream is ArchiSimple's and has already landed. This sprint is the
middle, and it is the only piece of this arc that requires a language model at
all.

---

## 2. Inherited — do not re-derive

Landed in ArchiSimple, and this sprint must consume rather than restate:

| What                                        | Where                                                        |
| ------------------------------------------- | ------------------------------------------------------------ |
| The observation vocabulary                  | `apps/web/src/extraction/planObservation.ts` (046.4) — **see §3** |
| Confidence → blocker, threshold 0.8         | `apps/web/src/extraction/observationConfidence.ts` (046.4)    |
| An image on the wire, contract `1.1.0`      | `apps/ai-service/src/contract.ts` — `AiImagePartDto`, capability `images` (046.4) |
| The page raster, and where it came from     | `receiveUnderlayFile`, `UnderlayPageSnapshot` (046.0, 046.1)  |
| The entrance, and its `extract` path        | `runImportPlan`'s `requestExtraction` port (046.5) — has no callee, by design |
| All six plan-reading Skills                 | `packages/skills/src/plan-reading/` (046.6) — written, green, unwired |

**The Skills are the reason this sprint is smaller than it looks.** Parsing a
dimension string, projecting page pixels to metres, associating a string with the
wall it dimensions, reconciling drawn against stated, checking a printed area,
and turning a ratio into a candidate scale are all written and proven. This
sprint must not reimplement any of them, and must not ask a model to do any of
them (ADR-0027.1 Rule 9).

---

## 3. The prerequisite that does not exist yet

**The observation vocabulary is declared in the wrong repository.**

`PlanObservation`, `PlanReading` and `PLAN_OBSERVATION_KINDS` live in
`apps/web/src/extraction/planObservation.ts`. This repository cannot import from
an application, and `apps/web` must keep building with this package **absent**
(ADR-0030, `intelligenceLoader.ts`) — so neither side can import the other's.

Three ways out, and only one survives contact:

| Option                                     | Why not                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| This repository redeclares them            | Two structural declarations of one wire contract, kept in step by nobody. The first field that drifts is a silent misread. |
| The host imports them from this package    | `apps/web` must build without this package. A type-only import still needs it present at typecheck.                       |
| **Move them down to a shared package**     | ✅ It is a contract *between* the two, so it belongs where both see it and neither depends on the other.                   |

**`@archisimple/ai-engine` is the home.** It is already in the seven
`peerDependencies` this package declares, it already carries `Proposal` — the
other type that crosses this exact seam — and it sits below the boundary where a
vocabulary with no behaviour belongs.

That is an **ArchiSimple sprint**, and it must land and release first (ADR-0030
Rule 8). Call it **046.4c**. It is a move, not a redesign: the types are
unchanged, `apps/web` re-exports from the new home so 046.4's compliance test
keeps pointing somewhere real, and the file version and Automation contract are
untouched.

> **Do not start this sprint by declaring the types here.** It is the cheap
> move, it works on the first day, and it is the one decision that cannot be
> undone once both repositories have shipped against it.

---

## 4. What this sprint builds

### 4.1 `readPlan` — a service method, not a tool and not a lane

```ts
class ArchitecturalIntelligenceService {
  readPlan(request: ReadPlanRequest): Promise<ReadPlanOutcome>;
}
```

**Not a Tool**, because a Tool is something a model calls, and a model calling
"read this drawing" is circular — the drawing is what it is being shown.

**Not a lane.** The nine lanes classify an *utterance*
(`interpret` → `ARCHITECTURAL_INTENT_KINDS`). This is not an utterance: no user
typed anything, and there is nothing to disambiguate. The host has a page and
wants it read. Routing it through the classifier would mean inventing a sentence
to classify, which is the kind of plumbing that later reads as a feature.

It is a **capability the host asks for directly**, reached through the
contribution the same way `intelligence` already is.

### 4.2 `PlanVisionPort` — the host still owns the network

```ts
export interface PlanVisionPort {
  read(input: PlanVisionInput): Promise<PlanVisionReply>;
}
```

This repository holds **no credential, no endpoint and no HTTP client**, and
ADR-0026 is unchanged by this sprint. The host implements the port over
`apps/ai-service`'s `images` capability — the same relay 046.4 built, which is
why 046.4 built it.

The shape is `AiWorkspaceStore`'s: a port the host supplies, so this layer stays
testable with a fake and the browser still reaches no provider.

**A host with no vision-capable provider passes no port**, and `readPlan` returns
a blocker saying so. That is the same posture `runImportPlan`'s absent
`requestExtraction` already takes, and it must stay symmetrical: nothing about
this feature may make the application unusable when the model is not there.

### 4.3 The prompt, and what it may ask for

This repository owns the prompt. It is the only thing here that is genuinely
about *reading*, and it is the only place a model appears in this whole arc.

What it asks for, and what it must never ask for:

| Asked                                              | **Never asked**                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| "a line you believe is a wall, in page pixels"     | how long it is, how thick it is, what it connects to                |
| "an opening symbol, and whether it read door or window" | which wall hosts it, its swing, its hand                       |
| "a text run, exactly as it appears"                | what the number means, its unit, what it dimensions                |
| a confidence per observation                       | an overall "this drawing is 87% correct"                           |

Every entry in the right-hand column is either a Skill that exists (§2) or a
thing this platform deliberately does not model. `"3,40"` comes back as `"3,40"`.

### 4.4 Structured out, never scraped

ADR-0027.1 Rule 6 — *nothing is parsed out of model prose*.

Observations come back through the provider's structured-output channel. A reply
that does not parse is a **blocker**, not a best-effort scrape: a regex over
prose that recovers three walls out of forty produces a confident, wrong,
partial building, and the user has no way to see which forty-third it stopped at.

Rule 6 is not violated by this. What it forbids is a provider emitting an
**artefact**; an observation is not an artefact, which is precisely why 046.4
made the vocabulary this poor. The Geometry Graph is still assembled by the host,
field by field, in 046.7.

### 4.5 Blockers, in the one vocabulary

ADR-0027.1 Rule 8. Every refusal is a `PlanBlocker`:

- no vision port supplied
- the provider returned nothing parseable
- an observation below the 0.8 confidence threshold (046.4's `judgeObservations`)
- the page was read but nothing was found on it

**"Nothing was found" is a blocker and not an empty success.** An extraction that
returns zero walls and reports success is indistinguishable from one that failed,
and the user is left looking at an empty plan wondering whether that is the
answer.

---

## 5. Scope

**In:** `readPlan`, the port, the prompt, the structured parse, blockers, and
observations of all three kinds — wall, opening, text.

All three kinds even though only walls and text have a consumer today (046.6,
046.7). Openings are read and handed over unused until 046.8, because the
alternative is a second full-page model round-trip later for information the
first one was already looking at.

**Out:**

- **The Geometry Graph.** ADR-0044 Rule 3 — the host assembles it, in 046.7.
- **A Proposal.** This sprint produces observations; a proposal is what the host
  makes of them.
- **Any arithmetic.** All six Skills exist. Using them is the host's, at the
  call site.
- **Scale.** `proposedScale` turns a *read ratio* into a candidate; reading the
  ratio off the sheet is a `TextObservation` like any other, and no code here
  applies a scale to anything (Rule 6).
- **Multi-page reassembly.** One page in, one `PlanReading` out. The host already
  refuses split sheets by name (ADR-0048 Rule 6).
- **Workflow state.** 046.4b already made a stage `skipped` with reason
  `extracted-from-drawing`. This sprint sets nothing.

---

## 6. Testing

The reader is the first thing in this arc that cannot be tested deterministically,
and the sprint's testing strategy is mostly about **how little** of it is that.

**With a fake port — the whole of it except the model:**

- a reply with three walls and two dimension strings → three wall observations
  and two text observations, coordinates untouched
- a reply with an observation at confidence 0.6 → a blocker, not a filtered list
- an unparseable reply → a blocker naming that, not a partial reading
- no port → a blocker naming that, and the host stays usable
- a reply claiming a wall *length*, a *thickness*, or a room *area* → those
  fields do not survive into the observation, because the type cannot hold them

**Compliance:**

- this repository still holds no `CommandDispatcher` (existing test)
- `readPlan` reaches no network directly — no `fetch`, no endpoint, no key
- the reader computes no length, no angle and no area of its own

> **Not** "does not import `@archisimple/skills`" — this repository already
> imports it in 24 files and should. The rule is that §2's arithmetic is
> *called*, never re-derived: a hand-rolled `Math.hypot` over two observed points
> in this package is the violation, not the dependency.

**Against a real provider:** a small number of recorded fixtures, run manually
rather than in CI. A vision model's output is not reproducible, and a CI job that
fails when a provider changes its mind teaches people to ignore CI.

---

## 7. Definition of done

**Engineering**

- [ ] Build, lint, tests, and this repository's compliance tests
- [ ] `apps/web` still builds with this package **absent**

**Architecture**

- [ ] No credential, endpoint or HTTP client in this repository (ADR-0026)
- [ ] No arithmetic that duplicates a Skill (Rule 9)
- [ ] No artefact assembled here (Rule 3)
- [ ] No second approval surface — this sprint produces no `Proposal` at all

**Product**

- [ ] A drawing the application can read produces observations a user can review
- [ ] A drawing it cannot read says so, in one sentence, and the plan is still
      placed and traceable by hand

---

## 8. Stop conditions

Stop and write it down rather than working around it:

1. **The vocabulary has not moved** (§3). Declaring it here is the failure this
   sprint is most likely to commit, and the hardest to reverse.
2. **The prompt needs the model to compute something.** If a reading is only
   usable when the model returns a length, a thickness or an association, then
   ADR-0044 Rule 4 is wrong or the observation vocabulary is — and either is an
   ADR revision, not a prompt tweak.
3. **Confidence turns out to be uninformative.** If providers return 0.95 for
   everything, the 0.8 threshold is theatre and Rule 5 needs a different signal.
   Say so; do not lower the threshold until it passes.
4. **A page needs splitting to be read at all.** Large sheets may exceed what a
   provider will look at. Tiling is a real design problem with its own seam
   arithmetic, and it is a sprint, not a paragraph.

---

## 9. Why this is one sprint and not three

The tempting split is *port*, then *prompt*, then *parse*. It is a bad split:
none of the three is testable without the other two, and the first two would land
as scaffolding for something that has never once run end to end — which is the
condition under which scaffolding quietly becomes the feature.

What makes it a *small* sprint is not decomposition but §2. Every deterministic
thing this feature needs already exists and is already proven. What is left is
the one part that genuinely requires a model, and it is worth keeping that in a
single reviewable piece.
