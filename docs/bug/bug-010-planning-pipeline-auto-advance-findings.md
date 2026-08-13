# BUG-010 — Findings

> **Status:** **Fixed.** Shape B, in two sprints: the continuation lane (1.8) and the post-approval advance (ArchiSimple 037.2)
> **Investigated at:** `architectural-intelligence` (Sprint 1.7 + BUG-009), `archisimple` (Sprint 037.1)
> **Answers:** [BUG-010](bug-010-planning-pipeline-auto-advance.md) §5 (stage lifecycle) and §15 (stop conditions)

---

## 1. Result in one line

BUG-010 asks for two different things, and only one of them is a defect.

| Ask                                                    | Verdict                                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| "I should not have to type `ok` / `move to programme`" | **A real defect**, cheap to fix, needs no decision — §4                                         |
| "I should not have to approve five times"              | **Not a defect**: it is ADR-0027.1's artefact lifecycle working. Changing it is a decision — §5 |

And the bug is internally inconsistent about the second one: **§2's flow and §8's
rule cannot both hold** (§3). Resolving that is the decision, and it is why this
stops here rather than proceeding.

---

## 2. The lifecycle §5 asks for, established from the code

| Stage           | Generating capability               | Input it reads                 | Recorded by         | Next stage needs       |
| --------------- | ----------------------------------- | ------------------------------ | ------------------- | ---------------------- |
| Brief           | `planning_captureBrief`             | the conversation               | approval sink       | **approved** Brief     |
| Space Programme | `planning_generateProgramme`        | `intelligence.approvedBrief()` | approval sink       | **approved** Programme |
| Layout Plan     | `planning_generateLayout`           | `approvedProgramme()`          | approval sink       | **approved** Layout    |
| Geometry Graph  | `planning_generateGeometry`         | `approvedLayout()`             | approval sink       | **approved** Graph     |
| Specification   | `planning_generateSpecification`    | `approvedGeometry()`           | approval sink       | realisation            |
| Realisation     | host `realiseApprovedSpecification` | approved Specification         | `RealisationRecord` | —                      |

Verified by direct reading — every one of the five tools opens with
`intelligence.approved*()` and returns `blocked` when it is absent.

**So the answer to §5.5 ("approval requirement") is: every stage, and it is not an
implementation convenience.** It is what makes each artefact reviewable
(ADR-0027.1 Rule 7), and it is the only reason the pipeline has five artefacts
rather than one function call.

The other lifecycle answers, for completeness:

- **generated ≠ recorded.** A generated artefact lives only in the `Proposal`
  until the user approves; the registry is the approval sink.
- **blocking information** — only the Brief has any (storeys, bedrooms,
  bathrooms). The four downstream stages need no user input at all: they are
  derivations.
- **auto-advance eligibility** — every downstream stage is _computationally_
  ready the moment its predecessor is approved. Nothing but approval stands
  between them.
- **refusal / failure** — `blocked` with a `PlanBlocker`; no artefact, no state
  change. §7's requirement already holds.

---

## 3. §2 and §8 contradict each other

```text
§2  Brief → Programme → Layout → Geometry → Specification → approval → STOP
§8  "planning capability succeeds → proposal → card → Approve → approved artefact.
     The system SHALL NOT automatically cross that boundary."
```

Every arrow in §2 crosses an approval boundary, because every stage reads an
**approved** predecessor. §2 asks for four automatic crossings; §8 forbids them.

The only way to have both is to change what an artefact must be before the next
stage may read it — which §6 half-proposes ("generated / recorded / usable as the
next planning input / approved") and which is **a new state in the artefact
lifecycle**. Today "usable as the next planning input" and "approved" are the
same thing.

That is a new architectural boundary, so per BUG-010 §15.5 and §16: **stopping
and proposing the decision rather than implementing.**

---

## 4. The part that is a real defect, and needs no decision

On the deterministic Architectural Assistant, **no continuation word advances
anything**. Measured, with every stage gate open:

```text
"ok"                  → direct-execution
"ok, continue"        → direct-execution
"next"                → direct-execution
"continue"            → direct-execution
"move to programme"   → direct-execution
"yes please"          → direct-execution
"generate the programme" → programme-generation   ← the only thing that works
```

So a user who has just approved a Brief must know to type the _name of the next
artefact_. That is the "user as workflow orchestrator" complaint, exactly, and it
is a gap in the classifier rather than a question about approval: the projection
already knows which stage is next (`workflowState().currentStage`, and the
`architecture` fragment's `nextTool`), and nothing consults it when the user says
"ok".

**A continuation lane fixes it** — a tenth lane, gated on the projection like
every other (ADR-AI-0002 Rule 8): a continuation word plus an eligible next stage
generates that stage. No new state, no approval change, no new contract, and it
is the workflow layer providing the authoritative transition that §3.2 asks for
rather than the model choosing.

It does not remove the approve clicks. It removes the typing.

---

## 5. The decision: what may feed the next stage

Three shapes. Only the first delivers §2's picture.

### Shape A — one approval, at the end

Artefacts become **recorded but unapproved**, and a stage may read its
predecessor in that state. The user approves once, at the Specification.

What it costs, and none of it is optional:

- a second store for unapproved artefacts, or a state flag on the registry that
  is currently the _approval_ sink (ADR-0027.1 Rule 7's own object);
- a fifth value in the workflow projection's `artefact` state
  (`none | draft | approved` today) — **ADR-AI-0002**;
- a revision to **ADR-0027.1 Rule 7**, because "approved" stops being the gate
  between stages;
- the user reviews a Specification derived from a Brief, a Programme, a Layout
  and a Geometry they never saw. When the result is wrong, the pipeline offers no
  place to have caught it earlier — which is the reason the five artefacts exist.

### Shape B — five approvals, no typing _(recommended as the next step)_

Keep the lifecycle exactly as it is. Remove the _typing_ (§4's continuation lane)
and, optionally, have the host offer the next stage automatically **the moment a
card is approved** — approval is the user's explicit act, so nothing crosses a
boundary and §8 is satisfied literally.

The user's experience becomes: describe the building → **Approve** ×5 → **Approve**
the build. Six presses, no typing, and every artefact seen.

Cost: a continuation lane here, and a host-side "advance on approval" trigger in
`apps/web` (see §6). No ADR, no new state, no contract.

### Shape C — five proposals in one reply

Blocked by a constraint neither repository can absorb quietly: a
`ConversationMessage` carries **one** `Proposal`, and `composeProposal` keeps the
first artefact proposal and reports the rest as skipped (Sprint 27.6, deferred to
"27.7", never done). Five cards in one turn is a conversation-model change plus a
workspace migration. Larger than Shape A, and it still asks for five clicks.

---

## 6. Where orchestration must live

Not in this repository, for the reason BUG-009 established: advancing after an
approval requires **observing** approval, and this layer structurally cannot
(ADR-AI-0002 Rule 2 — it learns that an artefact appeared, never that a proposal
was approved). `AiSessionController.approveProposal` is where the fact exists.

That also satisfies §10: a host-side trigger works for the deterministic
assistant and for a language-model provider alike, whereas anything driven by the
model works for neither reliably — which §3.2 already forbids.

The continuation **lane** (§4) belongs here; the "advance when approved"
**trigger** belongs in `apps/web`. They are the two halves of Shape B.

---

## 7. What is already true, and needs nothing

BUG-010's §3.1, §7 and §9 describe behaviour the platform already has:

- a `blocked` tool produces no artefact and no state change — the chain stops by
  construction, because the next tool reads an artefact that is not there;
- narration changes nothing: BUG-009 added the prompt rule ("never describe a
  document you have not produced") and, more importantly, no narrated artefact
  can be _read_ by anything;
- realisation is governed exactly as §9 requires — one host path, one guard, one
  record (ADR-0032 revision 2.2, Sprints 037.0/037.1).

The residual risk in §3.1 is a model that narrates convincingly. That is bounded
by the fact that the next stage refuses, and by BUG-009's prompt rule; it cannot
be closed further without the host driving the whole conversation.

---

## 8. Stop conditions triggered

| §15           | Condition                                                                                              | Status                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 3             | Auto-advance would bypass an approval boundary                                                         | **Yes, under §2's flow** — four boundaries. §3 of these findings.               |
| 5             | A new cross-repository contract without an existing decision                                           | **Yes, under Shape A** — the artefact lifecycle and the projection both change. |
| 1, 2, 4, 6, 7 | model-driven execution, indeterminate approval, second paths, fabricated artefacts, second realisation | No.                                                                             |

---

## 9. Decided, and what landed

**Shape B**, on 2026-08-13: the artefact lifecycle is not redesigned, and BUG-010
is narrowed to orchestration.

### The continuation lane (Sprint 1.8) — done

A tenth lane. "ok", "yes", "next", "continue", "go ahead", "carry on",
"proceed" — with a stage waiting — generates that stage.

| Property                     | Choice, and why                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Gate                         | `canContinue`, from `workflowState().currentStage` — the projection's own answer (ADR-AI-0002 Rule 8)                     |
| The Brief is excluded        | It is written from what the user said; "ok" says nothing about a building. This is §2's "no additional information" rule. |
| Pattern **anchored**         | A continuation is the whole utterance. "ok, now delete that wall" stays a modelling command (Story 27.8.3).               |
| Checked **last** among lanes | It carries no evidence of its own, so anything that names what it wants has already had its chance.                       |
| One generator                | The four named stage lanes and this one route through `generateStage`, so "generate the layout" and "ok" cannot disagree. |

Measured before and after, with a Brief approved:

```text
before:  "ok" · "next" · "continue" · "go ahead"  → direct-execution   (nothing happens)
after:   "ok" ×4                                   → programme, layout, geometry, specification
         "ok" (pipeline complete)                  → direct-execution   (building is not "carrying on")
         "Build it."                               → realisation
```

28 tests in `pipeline-advance.test.ts`, 827 in the suite. No contract change, no
new state, no ADR.

### What it does not do

It removes the **typing**, not the **approving**. Five cards still appear and the
user still presses Approve on each, which is the whole of Shape B: §8's boundary
is never crossed automatically.

---

## 10. The second half — ArchiSimple Sprint 037.2

Option (c) was chosen: a small additive `AiSessionController` capability, with the
host resolving the next stage itself. Approving a planning artefact now puts the
next one on screen immediately.

| Piece           | Where                                                                     |
| --------------- | ------------------------------------------------------------------------- |
| `offerProposal` | `packages/ai-engine` — an _assistant_ message carrying a pending Proposal |
| the advance     | `apps/web/src/ai/planningAdvance.ts`                                      |
| the trigger     | `AiWorkspacePanel.onProposalApproved` → `App`                             |

What it does not do, and each was a live temptation:

- **no fabricated user message** — the alternative cost nothing and would have
  been BUG-009 again, in a different place;
- **no model in the loop** — the transition is the workflow layer's (§3.2), which
  is also why it behaves identically on both provider paths (§10);
- **no approval bypass** — every offer is pending (§8);
- **no reach past the pipeline** — it stops at the approved Specification,
  because realisation is a separate act with its own intent. That falls out of
  the projection rather than being a special case.

The Brief is never offered: it is written from what the user said, and an empty
project is waiting for a person rather than a derivation.

### The whole of BUG-010, closed

```text
"Build me a 100 m² apartment, 2 bedrooms, 2 bathrooms"
  → Brief          [Approve]  → Programme appears
  → Programme      [Approve]  → Layout appears
  → Layout         [Approve]  → Geometry appears
  → Geometry       [Approve]  → Buildable design appears
  → Specification  [Approve]  → stop
  → "Build it."               → realisation proposal → walls
```

No `ok`. No "move to programme". Six presses and two sentences, and every artefact
still seen and approved — which is Shape B.

**Browser verification is the one thing outstanding**, and it is what §13 asks
for: the sequence above, pressed rather than typed.
