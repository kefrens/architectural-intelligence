# BUG-010 — Planning Workflow Advances Without Authoritative Execution

**Status:** Proposed  
**Repositories:** `architectural-intelligence` + `archisimple`  
**Type:** Cross-repository behavioural / orchestration bug  
**Priority:** High  
**Related:** BUG-008, BUG-009, ADR-AI-0002, ADR-AI-0004, ADR-0032, Sprint 037.0 / 037.1

---

## 1. Summary

The conversational planning workflow can **describe progression through the design pipeline without the corresponding authoritative artefacts or model state actually existing**.

In the reported reproduction, the user asked:

> "Build me a 100 m² apartment", 2 bedrooms, 2 bathrooms

The conversation then appeared to progress through:

**Brief → Programme → Layout → Geometry → Specification → Realisation → Final Review**

but the user did not see geometry, no visible design was produced, and no walls/openings were created.

The workflow also required the user to repeatedly type `ok` or equivalent commands between stages even when:

- the required information was already available;
- no approval/refusal decision was pending; and
- the next stage could have been generated automatically.

At the end, the provider reported:

> `"planning_request" could not be carried out here, so it was left out.`

This message is itself part of the bug investigation. Its exact cause must be established rather than assumed.

---

## 2. User-visible symptoms

The reproduction exhibits four symptoms:

1. **The assistant says an artefact was generated, but the artefact is not necessarily present.**
2. **The assistant asks the user to type `ok` to continue when no user decision is required.**
3. **The conversation can claim that geometry/specification/realisation happened without visible geometry or actual model mutation.**
4. **A planning tool request can be left out with `"planning_request" could not be carried out here"` instead of producing a truthful, actionable failure at the stage where execution failed.**

The key distinction is:

> **Narration is not execution.**

A sentence such as "I will generate the geometry" or "the geometry is generated" is not evidence that the corresponding authoritative project state exists.

---

## 3. Core invariant

### Conversation state SHALL NOT advance beyond authoritative project state.

At every planning stage:

```text
Conversation claims stage complete
            ==
Authoritative artefact/state for stage exists
```

The following must be impossible:

```text
Conversation: "Geometry generated"
Project:      no Geometry Graph
```

```text
Conversation: "Specification generated"
Project:      no Geometry Specification
```

```text
Conversation: "Design realised"
Project:      0 walls / 0 openings
```

If a stage cannot execute, the assistant SHALL stop at that stage and explain the actual blocker. It SHALL NOT continue narrating later stages.

---

## 4. Second invariant — no unnecessary conversational gating

The workflow SHALL automatically continue when:

- all mandatory information is available;
- the next operation requires no user choice;
- no approval is required at that boundary; and
- the previous operation succeeded authoritatively.

The user SHALL NOT have to type `ok`, "continue", "move to layout", etc. merely to advance an already-determined workflow.

Conversely, the workflow MUST stop when it genuinely needs:

- missing information;
- an explicit user decision;
- approval;
- refusal;
- or a correction to an existing artefact.

This establishes the intended interaction model:

```text
Needs user input?
    yes → ask
    no  → continue

Needs approval?
    yes → present approval UI and wait
    no  → continue

Execution succeeded?
    yes → continue
    no  → stop and report
```

---

## 5. Reported pipeline

The intended pipeline is:

```text
Brief
  ↓
Programme
  ↓
Layout
  ↓
Geometry
  ↓
Geometry Specification
  ↓
Approval
  ↓
Realisation
  ↓
Final Review
```

The bug is not simply that the UI waits too often.

The deeper problem is that the **conversation appears to traverse this pipeline without proving that the authoritative pipeline did**.

---

## 6. Required investigation

The implementation MUST first trace the real execution path for the reported scenario.

For each stage, determine:

1. Which tool/request/proposal is invoked?
2. Which repository owns the capability?
3. What authoritative artefact/state is written?
4. How is success detected?
5. How does the reasoning layer learn that the stage succeeded?
6. What happens if the operation is unavailable?
7. What happens if the operation is refused?
8. What message is produced when execution fails?
9. Why does the assistant subsequently continue to the next stage?
10. Why does the user have to send another message to advance?

### Specific investigation: `planning_request`

The message:

> `"planning_request" could not be carried out here, so it was left out.`

MUST be traced to its source.

Do not assume it is a new bug before establishing:

- which provider emitted the request;
- whether `planning_request` is an available tool/capability;
- whether it was exposed to the active provider;
- whether the request was malformed;
- whether the provider was on the Architectural Assistant path or language-model path;
- whether the request was discarded by the host/tool broker;
- and whether the failure happened before or after any planning artefact was created.

If this proves to be an independent defect, split it into a follow-up BUG rather than hiding it inside BUG-010.

---

## 7. Stage-authority matrix

The implementation should produce a concrete matrix similar to:

| Stage | Authoritative artefact/state | Producer | Success evidence | User approval required? | Auto-advance? |
|---|---|---|---|---|---|
| Brief | Brief | planning tool | artefact exists | TBD | yes if complete |
| Programme | Programme | planning tool | artefact exists | TBD | yes |
| Layout | Layout | planning tool | artefact exists | TBD | yes |
| Geometry | Geometry Graph | planning tool | graph exists + visible | TBD | yes |
| Specification | Geometry Specification | planning tool | specification exists | **yes before realisation** | no past approval |
| Realisation | walls/openings/rooms + record | host realisation capability | model mutation + record | only if approval exists | yes after approval |
| Final review | authoritative project state | TBD | actual review state | TBD | TBD |

The exact entries MUST be verified against code rather than inferred.

---

## 8. Approval boundary

The approval boundary MUST remain explicit.

The workflow SHALL NOT interpret ordinary acknowledgement such as:

- `ok`
- `yes`
- `continue`

as approval unless the product explicitly defines that behaviour.

The existing approval mechanism remains authoritative.

In particular:

> **Approval is a decision boundary, not a generic workflow-advance button.**

Before approval, the assistant may automatically generate planning artefacts when no further information or decision is required.

After approval, realisation may proceed through the existing authoritative host capability.

---

## 9. No fabricated completion

The reasoning/model layer SHALL NOT claim:

- that a programme exists when no programme artefact exists;
- that a layout exists when no layout artefact exists;
- that geometry exists when no geometry exists;
- that a specification exists when no specification exists;
- that a design has been realised when no realisation record/model mutation exists.

If execution fails:

```text
tool failure
    ↓
authoritative stage remains incomplete
    ↓
assistant reports failure/blocker
    ↓
workflow stops
```

It MUST NOT become:

```text
tool failure
    ↓
assistant narrates success
    ↓
next stage
```

---

## 10. Auto-advance semantics

A successful stage should trigger progression without requiring a new user message when the next stage is deterministic.

Example:

```text
User:
"Build me a 100 m² apartment, 2 bedrooms, 2 bathrooms"

        ↓

Brief generated
        ↓
Programme generated
        ↓
Layout generated
        ↓
Geometry generated
        ↓
Specification generated
        ↓
STOP — user approval required
```

The user should only be interrupted at a genuine decision boundary.

If the system needs information:

```text
Brief incomplete
        ↓
Ask user
        ↓
Answer
        ↓
Resume automatically
```

If the system needs approval:

```text
Specification generated
        ↓
Present approval
        ↓
WAIT
```

If execution fails:

```text
Stage execution failed
        ↓
Report failure
        ↓
WAIT / request corrective action
```

---

## 11. Important distinction: generation vs narration

Every planning operation has two separate outputs:

1. **Authoritative state transition**
2. **Conversational explanation**

The explanation MUST be derived from the first.

The system MUST NOT use the model's intended action as evidence that the action succeeded.

For example:

```text
"I will now generate geometry"
```

means nothing has yet happened.

Only after the authoritative operation succeeds may the system say:

```text
"The geometry has been generated."
```

---

## 12. Regression scenario

The primary regression test SHALL reproduce:

> Build me a 100 m² apartment, 2 bedrooms, 2 bathrooms.

The test should use the real composition and verify the actual project state after each transition.

Expected sequence:

### 12.1 Brief

- brief exists;
- 100 m² is preserved;
- 2 bedrooms;
- 2 bathrooms;
- one-storey assumption is explicit if that domain rule remains accepted;
- no false claim of completion before the artefact exists.

### 12.2 Programme

- programme exists;
- total programme area is approximately 100 m²;
- no additional user message is required if no decision is pending.

### 12.3 Layout

- layout exists;
- no additional user message is required if no decision is pending.

### 12.4 Geometry

- geometry exists;
- geometry is exposed to the host/UI;
- the conversation reports geometry only after authoritative creation.

### 12.5 Specification

- Geometry Specification exists;
- it is presented as a real artefact;
- the workflow stops for approval.

### 12.6 Approval

- approval occurs only through the authoritative approval mechanism;
- approval is not inferred from `ok`.

### 12.7 Realisation

- `realiseApprovedSpecification` is used through the single approved realisation path;
- walls/openings/rooms exist;
- realisation record exists;
- one realisation history entry is created.

### 12.8 Final state

The final conversational state MUST agree with the actual project state.

---

## 13. Negative regression cases

Tests MUST include:

### Missing information

If a mandatory topic is missing:

- ask for it;
- do not invent it unless an explicitly approved domain assumption applies;
- resume automatically after the answer.

### Execution failure

If a planning operation cannot execute:

- no later stage is reported as complete;
- no fabricated artefact is displayed;
- the user receives the actual blocker.

### Refusal

If the authoritative operation refuses:

- the refusal is surfaced;
- the workflow stops;
- no later stage is claimed.

### Already-existing artefact

If the artefact already exists and is current:

- do not regenerate unnecessarily;
- continue to the next stage if no decision is required.

### Approval required

If approval is required:

- stop;
- present the actual approval mechanism;
- do not treat `ok` as approval.

### Empty model after claimed realisation

If a realisation record says the design was built but the model is subsequently empty due to undo:

- the system MUST distinguish historical realisation state from current geometry;
- it MUST NOT claim that current walls still exist.

This case must follow the authoritative realisation semantics established by ADR-0032 / ADR-AI-0004.

---

## 14. Browser verification

A browser verification pass is mandatory.

The verifier SHALL use the exact primary scenario and visually confirm:

1. Brief appears.
2. Programme appears.
3. Layout appears.
4. **Geometry becomes visible in the floor-plan.**
5. Buildable Specification appears with the correct label.
6. The workflow stops for actual approval.
7. Approval produces the realisation.
8. Walls/openings/rooms become visible.
9. No unnecessary `ok` messages are required between deterministic stages.
10. If a tool fails, the assistant stops rather than narrating subsequent stages.

The verification log SHALL include screenshots at least for:

- generated geometry;
- generated specification;
- approval state;
- realised model.

---

## 15. Out of scope

BUG-010 SHALL NOT:

- introduce conversational approval;
- replace the authoritative approval mechanism;
- create a second realisation path;
- make the reasoning layer execute geometry directly;
- duplicate host-side validation;
- invent new planning artefacts;
- introduce generic refusal UX;
- weaken existing mandatory-information rules;
- silently treat tool failure as success.

---

## 16. Stop conditions

Stop implementation and report the finding if:

1. No single authoritative producer can be identified for one of the planning stages.
2. A stage has no reliable success signal.
3. The conversational layer cannot determine whether an artefact was actually created without duplicating host state.
4. Auto-advance requires inventing a new approval mechanism.
5. Fixing auto-advance would require bypassing an existing architectural boundary.
6. `planning_request` requires a new cross-repository contract not already covered by existing architecture.
7. Geometry cannot be made visible through the existing rendering/application path without an architectural decision.
8. The final workflow still permits conversational claims that contradict authoritative project state.

---

## 17. Definition of Done

BUG-010 is complete only when:

- [ ] Every planning stage has an identified authoritative producer.
- [ ] Every planning stage has an observable success/failure state.
- [ ] Conversation cannot advance beyond authoritative state.
- [ ] Deterministic successful stages auto-advance without requiring `ok`.
- [ ] Genuine information/approval boundaries still stop the workflow.
- [ ] Failed planning operations stop the workflow.
- [ ] `planning_request` has a verified root cause and resolution or is split into a follow-up bug.
- [ ] Geometry is actually generated and visible in the browser.
- [ ] Specification is actually generated and presented.
- [ ] Realisation produces actual walls/openings/rooms through the existing single path.
- [ ] The exact 100 m² / 2-bedroom / 2-bathroom scenario passes end-to-end.
- [ ] Regression tests cover fabricated completion and unnecessary manual advancement.
- [ ] Browser verification is recorded.
- [ ] Documentation reflects the authoritative pipeline and its real boundaries.
- [ ] Full workspace build, tests, lint, dependency validation and relevant validators are green.

---

## 18. Expected outcome

After this bug is fixed, a user should be able to say:

> "Build me a 100 m² apartment, 2 bedrooms, 2 bathrooms."

and, assuming no genuine information or approval boundary blocks progress:

```text
Brief
  ↓
Programme
  ↓
Layout
  ↓
Geometry       ← visibly exists
  ↓
Specification  ← visibly exists
  ↓
[USER APPROVAL]
  ↓
Realisation    ← walls/openings/rooms exist
  ↓
Final review
```

The assistant should not require meaningless `ok` messages between deterministic stages.

Most importantly:

> **The assistant must never tell the user that something was generated, approved, or built unless the corresponding authoritative state proves it.**
