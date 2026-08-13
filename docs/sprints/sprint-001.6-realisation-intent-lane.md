# Sprint 1.6 — Realisation Intent Lane

> **Status:** Complete
> **Version:** 2.1 (revised after code review; supersedes the draft numbered 037.1 in the `archisimple` repository. §16 records what implementation changed)
> **Repository:** `architectural-intelligence`
> **Related ADRs:** ADR-AI-0002 **revision 1.3** (accepted 2026-08-13 — the ownership row and the two rule extensions this sprint depends on); ArchiSimple ADR-0032 revision 2.2; ADR-0030
> **Prerequisites:** BUG-008 Phase 1 (ArchiSimple 036.2b); Phase 2 / ArchiSimple 037.0; G-8 closed
> **Next:** Sprint 1.7 — realisation state in the projection, and the read port it needs
> **Deliverables:** a realisation lane, realisation proposal generation, regression tests, documentation

---

## 0. What changed from the reviewed draft

The first draft was numbered 037.1 and filed under `archisimple/docs/sprints/`.
Its architecture was sound; the review found three things that would have made it
fail as written, and they are folded in below.

| #   | Finding                                                                                                                          | Where it lands       |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | Three of the draft's own example phrases classify into **existing** lanes today, two of which regenerate a planning artefact.    | §5, §6, §11          |
| 2   | "Already realised" and "a prior attempt failed" are **not knowable** in this layer. The draft's §8 asked for both.               | §8                   |
| 3   | The sprint belonged to the other repository's numbering. `interpret()` is this repository's; ArchiSimple sprints number its own. | this file's location |

Also corrected: the draft described the host tool as something the model reaches
_accidentally_. It is the designed path for a language-model provider (§2.1).

---

## 1. Objective

Make **realisation a first-class intent** in Architectural Intelligence.

After an approved Geometry Specification, "build it" must be understood as
_realise the approved design_ and answered with the realisation `Proposal`
ArchiSimple Sprint 037.0 already accepts — instead of falling into Direct
Execution, or, worse, into a lane that regenerates part of the design.

This sprint changes **classification and proposal generation only.**

```text
Architectural Intelligence
        │  Realisation proposal { specificationId, revision }
        ▼
ai-engine  ── approval ──▶  ArchiSimple host
                                └── realiseApprovedSpecification()   ← the one path
```

---

## 2. What is actually broken, and for whom

### 2.1 Two paths, and only one of them is broken

`classifyRequest` runs inside `ArchitecturalIntelligenceService.interpret`, whose
**only caller is the Architectural Assistant adapter**. A language-model provider
never reaches the classifier: it reaches capability through ArchiSimple's Tool
Broker, and since Sprint 037.0 that includes `automation_realiseApprovedDesign`.
For that provider the tool **is** the designed path (ADR-0032 revision 2.2), not
an accident, and it already answers "already built" cleanly because it reads the
host's `realisation` context fragment.

So this sprint fixes the **deterministic assistant**, which today has no way to
express realisation at all. Say that plainly rather than implying the model path
is broken.

### 2.2 What the classifier does today — measured, not assumed

Against a project that has approved all five stages (which is exactly when a user
says "build it"):

| Utterance                                                  | Lane today                 | Consequence                        |
| ---------------------------------------------------------- | -------------------------- | ---------------------------------- |
| "Build it." / "Let's build it." / "Go ahead and build it." | `direct-execution`         | the BUG-008 symptom                |
| "Build the approved design."                               | `direct-execution`         | the BUG-008 symptom                |
| "Turn the approved design into the building."              | `direct-execution`         | the BUG-008 symptom                |
| **"Realise the design."**                                  | `geometry-generation`      | **regenerates the Geometry Graph** |
| **"Create the building from this specification."**         | `specification-generation` | **regenerates the Specification**  |
| **"Build the apartment."**                                 | `clarification-required`   | **starts a briefing interview**    |

The cause is that **every stage stays `eligible` once approved** — regeneration is
always available, so `hasApprovedLayout` and `hasApprovedGeometry` are still
`true` in a finished project, and the geometry and specification lanes remain
open. `GEOMETRY_WORDS` already matches `realise|realize`; `SPECIFICATION_WORDS` +
`PROGRAMME_VERBS` already match "build … specification"; `DWELLING_WORDS` +
`DESIGN_VERBS` already match "build the apartment".

**This is the sprint's central implementation constraint**, and §6 is written
around it.

---

## 3. Scope

### 3.1 In scope

1. A ninth lane, `realisation`, in `REQUEST_LANES`.
2. A gate for it, read from the workflow projection like every other lane
   (ADR-AI-0002 Rule 8).
3. Lane **precedence** that survives §2.2.
4. Routing in `interpret` to a realisation proposal built with `ai-engine`'s
   existing `createRealisationProposal`.
5. Subject resolution from the approved Specification the project already holds.
6. A truthful answer when there is no approved Specification.
7. Tests: positive formulations, the three collisions above, and the negatives.
8. Documentation.

### 3.2 Explicitly out of scope

This sprint SHALL NOT:

- execute a realisation, or call any host execution code;
- construct a Build Plan, a `CommandRequest`, or any geometry;
- reproduce the realisation guard, the Specification reader or the translator;
- add a second realisation path, or a second proposal shape;
- **contribute a realisation tool from this repository** — Sprint 037.0 decided
  the host owns it, and two tools proposing the same subject is the ambiguity
  that decision avoided;
- read realisation state, or add a workflow-state read port (Sprint 1.7);
- derive or store any new persistent state;
- change the Automation contract or the project-file format;
- require an npm release. The workspace link resolves `@archisimple/ai-engine`
  locally and it already exports `createRealisationProposal`.

---

## 4. Existing machinery to reuse

| Capability                         | Owner        | Use here                                                        |
| ---------------------------------- | ------------ | --------------------------------------------------------------- |
| `Realisation` proposal subject     | `ai-engine`  | unchanged                                                       |
| `createRealisationProposal`        | `ai-engine`  | unchanged                                                       |
| `PlanningArtefactReader`           | host port    | already wired; already answers §7                               |
| `approvedSpecification()`          | this service | already exists — returns the value carrying `id` and `revision` |
| `workflowState()` / `stageState`   | this service | the lane's gate, per ADR-AI-0002 Rule 8                         |
| `realiseApprovedSpecification`     | host         | never called from here                                          |
| `RealisationSink`                  | host         | never called from here                                          |
| `automation_realiseApprovedDesign` | host         | not duplicated here                                             |
| the `realisation` context fragment | host         | **not consumed** — see §8                                       |

The subject needs no new contract: the artefact registry stores the
Specification's own `id` and `revision`, which is exactly what the host's
realisation subject is keyed on.

---

## 5. Intent recognition

### 5.1 Positive

Semantic, not phrase-matching:

- "Build it." · "Let's build it." · "Go ahead and build it."
- "Build the approved design." · "Build the apartment."
- "Realise the design." · "Realize it."
- "Create the building from this specification."
- "Turn the approved design into the building."

### 5.2 Negative — "build" alone is not enough

- "Can you build a wall here?" → direct authoring.
- "Move this wall 20 cm." → direct authoring.
- "Delete this wall." → direct authoring.

The semantic subject must be **the approved design**, not an element of it. The
existing precedent is exact and should be followed rather than reinvented:
`SPECIFICATION_WORDS` matches plural `walls` and deliberately not singular
`wall`, because one wall is a modelling command.

### 5.3 The gate

The lane opens only when the workflow projection reports the **Specification
stage approved and current**. With no approved Specification the lane is
unreachable, the answer explains that a design must be approved first, and no
proposal with guessed identifiers is ever built.

---

## 6. Precedence — the part §2.2 forces

The realisation lane SHALL be evaluated **before** the specification and geometry
lanes. This inverts the "later stage first" ordering the four stage lanes follow,
and the reason is worth a comment in the code: those lanes are ordered by
pipeline position because each asks for the stage above; realisation is not a
stage, and asking to _build_ the design must not be read as asking to _redesign_
it.

Two mechanical consequences:

1. **`realise` / `realize` must resolve to realisation when a current
   Specification exists.** Today they live in `GEOMETRY_WORDS`. The geometry lane
   keeps them for a project that has not reached a Specification.
2. **A dwelling word plus a design verb must not out-rank the lane.** "Build the
   apartment" currently reaches the clarification lane; with a current
   Specification it is a realisation request, and re-interviewing a user about a
   design they have already approved is the outcome Story 27.8.3 forbids.

| Utterance                                                | Expected lane                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| "Build it" (current Specification)                       | `realisation`                                                                                      |
| "Build the approved design"                              | `realisation`                                                                                      |
| "Realise the design" (current Specification)             | `realisation`                                                                                      |
| "Realise the design" (approved Layout, no Specification) | `geometry-generation` — unchanged                                                                  |
| "Give it walls" (approved Graph, no Specification)       | `specification-generation` — unchanged                                                             |
| "Generate the layout"                                    | `layout-generation` — unchanged                                                                    |
| "Approve the design"                                     | `direct-execution` — **there is no approval lane**; approval is the host's (ADR-AI-0002 ownership) |
| "Change the bedroom to 14 m²"                            | `brief-revision` — unchanged                                                                       |
| "Move this wall 20 cm" / "Build a wall here"             | `direct-execution` — unchanged                                                                     |

---

## 7. Proposal generation

When the lane is selected, the response carries a proposal built from the
approved Specification's identity and nothing else:

```text
Realisation
  specificationId
  revision
```

No Build Plan, no Requests, no command constructors, no translated walls or
openings, no callbacks, and no guard verdict repackaged as an instruction. This
is ADR-0032 revision 2.2's single-path invariant, and this repository's half of
it is that there is nothing here to execute.

---

## 8. What this layer cannot know, and what it does instead

ADR-AI-0002 revision 1.3, extension to Rule 2: **an artefact becoming readable
means it was approved, never that it was built.** This layer has no access to the
`RealisationRecord`, and this sprint does not give it any.

| Host state                       | This layer sees | Behaviour                                                                          |
| -------------------------------- | --------------- | ---------------------------------------------------------------------------------- |
| No approved Specification        | yes             | Explain that a design must be approved first. No proposal.                         |
| Approved, not realised           | yes             | Realisation proposal.                                                              |
| **Already realised**             | **no**          | Proposes; the host guard refuses at approval; the assistant reports that refusal.  |
| **Prior attempt refused/failed** | **no**          | Same. Never described as built.                                                    |
| Specification superseded         | n/a             | Structurally impossible to propose — the layer always reads the revision in force. |

Rows 3 and 4 are the accepted cost of not inventing a state model (§13 of the
draft, kept). The refusal is authoritative and truthful; a guess made here would
be neither. Sprint 1.7 removes the gap, and ADR-AI-0002 revision 1.3 records why
it needs a read port to do so — `AiProviderRequest.context` exists only during a
turn, and the projection must answer on every render.

**Note the asymmetry this leaves**: the host tool answers "already built"
cleanly, the assistant lane does not. That is a known, bounded difference between
the two providers until Sprint 1.7, not a defect to work around here.

---

## 9. Conversation continuity

"Build it" after a design sequence resolves against the **project's current
approved Specification**, never against a design mentioned earlier in the
conversation. The user is not asked to repeat an identifier, and no identifier
from conversation history is ever used — the subject comes from the artefact
reader (ADR-0027.1 Rule 6: nothing is parsed out of model prose or user text).

---

## 10. Boundary

> **Architectural Intelligence expresses the user's realisation intent;
> ArchiSimple owns the decision and the execution.**

Nothing added by this sprint may import ArchiSimple application code, call a
`RealisationSink`, dispatch an Automation command, construct a `CommandRequest`
or a `BuildPlanDto`, implement the guard, or duplicate the translator or the
Operation. A source-level test SHALL pin this, following the pattern the existing
architecture-compliance tests use.

---

## 11. Testing

### 11.1 Classification

1. "Build it" with a current Specification → `realisation`.
2. "Build the approved design" → `realisation`.
3. "Realise the design" with a current Specification → `realisation`.
4. **"Realise the design" with an approved Layout and no Specification →
   `geometry-generation`** (the regression §2.2 found).
5. **"Create the building from this specification" with a current Specification →
   `realisation`**, not `specification-generation`.
6. **"Build the apartment" with a current Specification → `realisation`**, not
   `clarification-required`.
7. "Give it walls" with an approved Graph and no Specification →
   `specification-generation`.
8. "Generate the layout" → `layout-generation`.
9. "Move this wall" / "Build a wall here" → `direct-execution`.
10. "Build it" with **no** approved Specification → not `realisation`.

### 11.2 Proposal

One end-to-end test through `interpret`:

```text
approved Specification → realisation intent → Realisation proposal { specificationId, revision }
```

asserting the subject matches the approved artefact's identity, `operations` is
empty, and no Build Plan or Request exists anywhere in the response.

### 11.3 Negative

- no approved Specification → no realisation proposal, and a message that says
  why;
- a user asserting "you already built it" changes nothing — no execution state is
  manufactured from conversation;
- the four planning lanes and Direct Execution are unchanged for every
  non-realisation utterance (the existing suites are the regression).

---

## 12. Regression protection

Unchanged after this sprint: planning tools still generate artefacts; approval
still belongs to the host; direct authoring still reaches the existing
mechanisms; `realiseApprovedSpecification` is still the single execution
implementation with exactly two callers; `automation_realiseApprovedDesign`
still serves the model path.

---

## 13. Documentation

- this repository's `docs/architecture` and `CLAUDE.md`: nine lanes, and what the
  ninth is;
- the BUG-008 findings: Phase 3 part one done, part two (Sprint 1.7) open;
- ADR-AI-0002 revision 1.3 moves from _proposed_ to _accepted_ if the decision is
  taken — this sprint depends on it and must not land before it.

---

## 14. Stop conditions

1. Realisation intent cannot be expressed with the existing `Realisation` subject
   without changing the shared contract.
2. Correct classification requires realisation state — i.e. §6's precedence
   cannot be made to work from artefact state alone.
3. A second realisation execution path appears necessary.
4. The host needs more than `{ specificationId, revision }`.
5. ADR-AI-0002 revision 1.3 is not accepted, or is accepted in a form these
   assumptions do not match.
6. Any existing lane regresses in a way §6 does not sanction.

---

## 15. Definition of Done

- [x] `realisation` is a lane, gated from the workflow projection.
- [x] It is evaluated before the specification and geometry lanes, with the
      reason recorded in the code.
- [x] **No realisation utterance regenerates a planning artefact**, and none
      starts a clarification interview.
- [x] "Build it" with a current Specification produces a realisation proposal
      carrying only `specificationId` and `revision`.
- [x] No Build Plan, Request or host call exists in this repository.
- [x] No approved Specification → no proposal, and a truthful explanation.
- [x] Nothing claims a design was built.
- [x] The three collisions in §2.2 have tests.
- [x] Existing lanes, tools and planning behaviour unchanged; full suite, lint
      and typecheck pass.
- [x] Documentation updated; no npm release.

_All met, with one qualification recorded in §16: "no approved Specification →
no proposal" holds, and the explanation is the fall-through's, not a realisation
one._

---

## 16. What implementation changed

Three things the plan did not fully anticipate. None changed the architecture.

**§8 row 1 — "no approved Specification → explain that a design must be approved
first" — is met by the fall-through, not by the lane.** The lane is gated on an
approved Specification existing, so with none it never opens and the utterance
classifies exactly as it did before this sprint. Opening it unconditionally to
produce a specific message would have broken §11.1's fourth test, which requires
"realise the design" with an approved Layout and no Specification to keep
reaching `geometry-generation` — the two cannot both hold, and the regression
matters more than the sentence. `NO_APPROVED_SPECIFICATION` exists for the
defensive branch every stage lane also carries.

**Staleness is answered, not gated.** `hasApprovedSpecification` means _approved_,
deliberately not _approved and current_ — the third distinct question in the
options object, after the four stage gates and `hasBriefToRevise`. A stale design
opens the lane and `interpret` returns a `superseded` `PlanBlocker` naming the
fix. Gating on currency would have closed the lane and answered "build it" with
whatever the fall-through produced. The staleness verdict comes from the same
projection the gate does, so this is one derivation with two readers
(ADR-AI-0002 Rules 8 and 13).

**Recognition needed a third condition, not two.** A verb and a subject were not
enough: `AUTHORING_SUBJECTS` excludes any utterance naming an element — wall,
door, window, room — which is what keeps "build a wall here" a modelling command
without listing phrases. It generalises `SPECIFICATION_WORDS`' plural-only rule
to the whole lane.

### Delivered

| Piece                                         | Where                                                              |
| --------------------------------------------- | ------------------------------------------------------------------ |
| the lane, its gate, its precedence, its words | `src/brief/request-classification.ts`                              |
| routing, staleness, the two messages          | `src/architectural-intelligence-service.ts` (`proposeRealisation`) |
| the proposal and its prose                    | `src/realisation/realisation-proposal.ts`                          |
| 31 behavioural tests                          | `src/__tests__/realisation-lane.test.ts`                           |
| the boundary, asserted on sources             | `src/__tests__/architecture-compliance.test.ts`                    |

778 tests pass (was 737), `tsc -b` and `eslint` clean, no release.
