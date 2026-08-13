# BUG-009 — Findings

> **Status:** **Fixed.** Root cause and both contributing defects; the reported conversation now reaches a buildable design
> **Investigated at:** `architectural-intelligence` (Sprint 1.7), `archisimple` (Sprint 037.1)
> **Answers:** [BUG-009](bug-009.generated-designn-not-approved.md) §4 (investigation questions)

---

## 1. Result in one line

**Typing "approved" cannot approve anything, anywhere, on any provider path** —
there is no approval intent, no approval lane, no approval tool and no approval
Request. The only route to `ArtefactApprovalSink` is
`AiSessionController.approveProposal(messageId)`, and its only production caller
is the **Approve button** in the AI Workspace panel.

So the report is accurate and the diagnosis is certain. But it is the _symptom_.
The reporter's answer — **"I never had an option card, that's why I said
approved"** — settles §4 in favour of H-B and points at the real cause, which is
one step earlier and is reproduced in §4.1: **the pipeline never produced an
artefact at all.**

The most consequential finding is architectural, and it contradicts a premise in
the bug: **the fix cannot live in `architectural-intelligence`** (§6).

---

## 2. Which path the session was on — the message says

The observed refusal is quoted exactly, and it exists in one place:

```text
"There is no approved design to build yet. The design pipeline has to reach an
 approved Geometry Specification first."
        → apps/web/src/ai/realisationTool.ts:58   (ArchiSimple, Sprint 037.0)
```

The reasoning layer's own version of that sentence ends differently — _"Approve a
geometry specification first and I will offer to build it."_ — so this was **not**
the Architectural Assistant. It was a **language-model provider**: the model
called `automation_realiseApprovedDesign`, the host tool read the `realisation`
context fragment, found no approved Specification, and returned `blocked`.

That single fact settles a design question in §6, because the model path **never
reaches `interpret()`** — `classifyRequest`, the nine lanes and everything Sprints
1.6 and 1.7 added are on the other provider.

The assistant's prose confirms it independently. _"Please review the design and
let me know if you approve it to be built"_ is model text; the deterministic
assistant says _"Review it below."_

---

## 3. Answers to §4's questions

| #   | Question                                                                      | Answer                                                                                                                           |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | How is `"approved"` classified?                                               | On the model path, not at all — it is sent to the model as text. On the assistant path it is `direct-execution`.                 |
| 2   | Does an approval lane exist?                                                  | **No**, deliberately: approval is the host's (ADR-AI-0002 ownership table).                                                      |
| 3   | Does an approval proposal exist?                                              | No, and one would be circular — a proposal to approve a proposal, which the user would approve by clicking.                      |
| 4   | Is `ArtefactApprovalSink` reachable from conversational interpretation?       | **No.** It is reachable only from `approveProposal`, called by the panel's button.                                               |
| 5   | Why does the host not approve on "approved"?                                  | Nothing asks it to. No code path connects a chat message to `approveProposal`.                                                   |
| 6   | How would the conversational layer identify the artefact?                     | It cannot. The pending proposal is **session state the host owns**, and this layer never observes approval (ADR-AI-0002 Rule 2). |
| 7   | Can approval bind to the current candidate without a model-supplied identity? | Yes — **host-side**, from `pendingProposal()`. Not from anything the model says. See §6.                                         |
| 8   | The edge cases                                                                | §7.                                                                                                                              |

---

## 4. What the user was looking at — two hypotheses

Both are consistent with everything reported. They need different fixes, so the
first job is to tell them apart.

### H-A — the cards were there and the user answered in chat

Each planning tool returns a `proposal`, which the panel renders with **Approve**
and **Cancel**. If the first four stages were approved by clicking, the fifth
card was on screen when the user typed "approved", and nothing consumed it.

Supporting: the pipeline **cannot advance without approval** — every planning
tool reads its upstream artefact from the registry and returns `blocked` when it
is absent (`programme-tools.ts:45`, `specification-tools.ts` likewise). Reaching a
Specification at all implies four real approvals.

### H-B — the model narrated a pipeline that never ran

A model whose tool calls were refused will often describe the artefacts anyway.
Every stage would have returned `blocked`, the refusals surface as reply
**warnings** (`aiServiceProvider.ts`, `composeProposal`), and a user reading prose
rather than warnings sees five stages that never existed. This is BUG-005/006's
failure mode.

### Confirmed: H-B, and here is why

The reporter never saw a card. Not at the Specification — **not at any stage**.

### 4.1 The root cause, reproduced

`planning_captureBrief` returns **`blocked`** when a mandatory topic is missing,
and a `blocked` result renders as a _warning on the reply_, never as a card. Run
against the shipped build:

```text
{ bedrooms: 2, bathrooms: 2 }            → blocked  "How many storeys should the building have?"
{ storeys: 1, bedrooms: 2, bathrooms: 2 } → proposal (a card)
```

The reproduction in BUG-009 §2 supplies **exactly the first of those**: 2
bedrooms, 2 bathrooms, and no storeys. Nobody says "one storey" about a 100 m²
apartment — it is not information a user withholds, it is information they do not
know is wanted — and the model did not supply it either.

So the conversation entered a loop it could not leave:

```text
"Build me a 100m² apartment"      → captureBrief → blocked: how many storeys?   (no card)
"2 bedrooms, 2 bathrooms"         → captureBrief → blocked: how many storeys?   (no card)
…the model narrates a Programme, a Layout, a Geometry, a Specification…
"approved"                        → text, consumed by nobody
"Build it."                       → the realisation tool, correctly: nothing is approved
```

Every downstream stage was **narration**: each tool would have refused for want
of its upstream artefact, and the model described the artefacts anyway. The
assistant's "let me know if you approve it" was the last step of a story in which
nothing had happened.

**The mandatory-topic rule itself is right** — `brief-tools.ts` says so in its own
header, and Bug 006 is what guessing costs. What is wrong is that the question is
asked in prose the model is free to paraphrase, forget or answer for itself, with
no card ever appearing to show the user where they are.

---

## 5. Two real defects found while reviewing — **both fixed**

Both are certain, both are small, and both sit exactly where the user got stuck.
Neither is the root cause; both would have made the failure harder to read.

### 5.1 A Geometry Specification card is labelled **"The brief"**

`ARTEFACT_LABEL_KEYS` in `AiWorkspacePanel.tsx` maps four artefact kinds and not
the fifth. `geometry-specification` therefore falls back to
`ai.workspace.proposal.artefact`, whose English value is **"The brief"** (French:
_"Le cahier des charges"_).

So a user walking five stages sees "The brief", "The programme", "The layout",
"The geometry" — and then **"The brief"** again for the buildable specification.
The fallback was designed to be generic; it is not, because the generic key was
given the Brief's own text.

Sprint 1.1 added the fifth artefact and never added the fifth label. One line and
two translations.

### 5.2 A realisation proposal renders an empty "Operations" list

`ProposalCard` branches on `isArtefactProposal` — artefact, or "everything else
has operations". Sprint 037.0 added a **third** subject kind whose `operations`
are deliberately empty, so a realisation proposal renders an _Operations_ heading
with nothing under it. Approve/Cancel work; the card just looks broken at the
final, most consequential step.

Introduced by Sprint 037.0, which added a subject kind without updating the one
place that branches on them.

---

## 6. The architectural finding — the fix cannot live here

BUG-009 §3 proposes that the conversational layer "recognise approval intent…
create an approval proposal/intent using the existing contribution boundary".
That is not implementable in this repository, for two independent reasons:

1. **This layer cannot know what is pending.** `pendingProposal()` is
   `AiSessionController`'s, and ADR-AI-0002's ownership table assigns it to the
   host precisely so this package never holds session state. Rule 2: this layer
   learns that an artefact _appeared_, never that a proposal was approved. To
   approve "the current generated design" it would have to be told what is on
   screen — which is the coupling that rule exists to prevent.
2. **The reported session never reaches this layer.** §2: the failure was on the
   model path, where `interpret()` is not called. An approval lane here would
   have no effect on the bug as reported.

**Conversational approval, if it happens, is host-side** — in `apps/web`, where
the pending proposal already lives, where it covers both provider paths, and
where it can call the one existing mechanism.

That is not a second approval mechanism. It is a second **trigger** for
`approveProposal`, in exactly the shape ADR-0032 revision 2.2 already sanctioned
for realisation: two triggers, one path (the ribbon command and the AI approval
both reach `realiseApprovedSpecification`). ADR-0027.1 Rule 7 forbids a second
approval _surface_; a text trigger that calls the same method is not one.

---

## 7. What to do about it

The decision taken on the review's first draft was **Option 1 — do not accept
typed approval**; the assistant must instead stop asking for approval it cannot
receive. That still holds, but §4.1 changes what "Option 1" has to say: telling a
model to point at the Approve card is useless when no card exists. The prompt is
the _last_ of three fixes, not the first.

### 7.1 Break the clarification loop _(the root cause; needs a decision)_

A mandatory topic the user will never volunteer is a dead end. Three ways out,
and they are not exclusive:

| #   | Change                                                                                                                      | Cost | Risk                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------- |
| A   | **Default `storeys` to 1 for a dwelling that implies it** (apartment, flat, studio), recorded as an assumption on the Brief | tiny | a genuinely multi-storey apartment starts at 1 and is revised — visible |
| B   | Keep it mandatory, and have the **host** ask it as a card-shaped question rather than as model prose                        | med  | a new interaction shape; more design than this bug needs                |
| C   | Prompt the model: a mandatory topic it cannot infer must be **asked of the user**, never omitted and never guessed          | tiny | advice a model may ignore — which is how we got here                    |

**Recommendation: A + C.** A is the honest answer to "how many storeys is a 100 m²
apartment" — one, and say so as an assumption the user can correct, which is
exactly what the Brief's assumption list is for. C stops the same loop for the
topics A does not cover. B is the principled answer and belongs to whoever
designs the clarification surface, not to this bug.

**A is a domain decision, so it is yours.** It changes what a Brief assumes.

### 7.2 Make narration visible as narration

The model described four artefacts that were never generated, and nothing in the
conversation contradicted it. Two cheap, host-side steps:

- the `blocked` warnings already exist on the reply — they need to read as
  _questions the user must answer_, not as footnotes under prose that says the
  opposite;
- a prompt rule: **never describe an artefact you have not generated**; if a tool
  refused, say what it asked for and stop. Sprint 036.2b added the same rule for
  _execution_ ("never describe an action as done") and it stopped exactly this
  class of lie one layer down.

### 7.3 Then the approval prompt (the decided Option 1)

Once a card can actually appear: approval is a control the user operates on the
proposal card; ask them to use it; never treat a reply as approval; never
continue as though something were approved.

### Not doing

**Typed approval is not implemented** (the rejected Option 2), and §4.1 is why it
would not have helped: there was nothing pending to approve. Had it existed, it
would have approved nothing and the conversation would have looked _more_
convincing while being just as empty.

---

## 8. What must not change

Confirmed against the code, and none of it is at risk under either option:

- one approval mechanism — `Proposal` + `approveProposal` (ADR-0027.1 Rule 7);
- the host resolves the artefact identity; **no identity is ever taken from model
  output** (ADR-0027.1 Rule 6);
- approval and realisation stay distinct transitions (BUG-009 §6, and the
  realisation path is unchanged);
- no new Request, no AI mutation of project state, no duplicated guard;
- BUG-008 stays closed: realisation correctly refuses when nothing is approved —
  which is exactly what the reported session observed, working as designed.

---

## 9. What was done

Approved on 2026-08-13: **an apartment defaults to one storey**, and typed
approval stays unimplemented.

| §     | Change                                                                                                                                    | Where                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 7.1 A | `SINGLE_STOREY_DWELLINGS` — apartment, flat, studio, bungalow imply one storey, as an **assumption** stated in the Brief the user reviews | `brief/brief-topics.ts`      |
| 7.1 A | The assumption sentence, so the inference is in the list the reviewer reads beside "no garage, since none was mentioned"                  | `brief/brief-assembly.ts`    |
| 7.2   | Prompt: never describe a document no tool produced — ask for what the tool asked for, and stop                                            | `ai-engine/prompt-pipeline`  |
| 7.3   | Prompt: you cannot approve anything, and neither can the user by replying; approval is a control                                          | `ai-engine/prompt-pipeline`  |
| 5.1   | The Geometry Specification card is labelled "The buildable design", and the generic fallback no longer carries the Brief's text           | `AiWorkspacePanel.tsx`, i18n |
| 5.2   | A realisation proposal describes what will be built instead of listing no operations                                                      | `AiWorkspacePanel.tsx`, i18n |

### The one rule the implication had to earn

**Only the user's own words imply a storey count.** The Brief's backstop reads
the model's objective too — that is Bug 005's fix, recovering a number the user
gave from the model's paraphrase — but an _assumption_ about the shape of the
building may not come from the model calling something an apartment
(ADR-0027.1 Rule 6). `withBackstopTopics` therefore drops assumed-source
requirements from model-authored text, and `utterance` counts as model-authored
because the tool sets it from the model's objective.

Bug 006's rule is untouched: `storeys: 0` is still discarded rather than
corrected. Its two tests moved to a **house**, which genuinely leaves the
question open, and a new test pins the interaction on the apartment: the zero is
discarded _and_ the dwelling answers, so "0 storeys" still never reaches a Brief.

### Proof

`pipeline-advance.test.ts` walks the reported conversation end to end — "Build me
a 100 m² apartment", two bedrooms, two bathrooms — through capture, programme,
layout, geometry and specification, approving each as a clicking user does, and
then asks "Build it." and gets a realisation proposal. Before the fix it stopped
at the first step, forever.

813 tests here, 980 in ArchiSimple, both suites, lint, typecheck, `depcruise` and
the five validators green.

### Still open, deliberately

- **Typed approval is not implemented** (the rejected Option 2) and §4.1 is why
  it would not have helped: there was nothing pending to approve.
- A `house` still needs its storey count, which is the right question to ask.
- Browser verification of the whole conversation.
