# BUG-008 --- End-to-End Design Realisation

> **Status:** Proposed\
> **Repository:** `architectural-intelligence`\
> **Related repository:** `archisimple`\
> **Priority:** High\
> **Type:** Integration / orchestration bug\
> **Related capability:** Geometry Specification → ArchiSimple
> realisation\
> **Related ArchiSimple sprint:** 036.2 --- Build Approved Design\
> **Related ADR:** ADR-0032 --- Geometry Specification Execution

## 1. Summary

A user can ask Architectural Intelligence to design an apartment and progress through the planning stages --- brief, space programme, layout,
geometry and specification --- but the conversational flow can then continue as if the design has been built without an actual building
appearing in ArchiSimple.

The observed conversation contains statements such as:

> "I'll now create the walls and openings for your apartment."

and:

> "Now that the walls and openings are created..."

while the resulting ArchiSimple model contains no corresponding
geometry.

The failure domain is therefore different from BUG-007.

-   **BUG-007** concerns preserving the user's planning intent.
-   **BUG-008** concerns the hand-off from an approved design to actual
    ArchiSimple model realisation.

The system must never report that a design has been built unless the
realisation action has actually succeeded.

------------------------------------------------------------------------

## 2. User-visible problem

The intended experience is:

``` text
User asks for a building
        ↓
AI captures the brief
        ↓
AI generates programme
        ↓
AI generates layout
        ↓
AI generates geometry
        ↓
AI generates Geometry Specification
        ↓
Specification is approved
        ↓
User asks to build
        ↓
ArchiSimple realisation is executed
        ↓
Walls / openings appear in the model
        ↓
AI reports the actual result
```

The observed experience can instead become:

``` text
Specification generated
        ↓
AI says "I will create the walls and openings"
        ↓
No realisation action
        ↓
No model mutation
        ↓
AI continues the conversation as if construction occurred
```

This creates a dangerous false-success condition: the conversational
state claims progress that the authoritative application state does not
contain.

------------------------------------------------------------------------

## 3. Scope

### In scope

Investigate and, if confirmed, fix the complete AI → ArchiSimple
realisation path:

1.  Determine whether a Geometry Specification is actually approved.
2.  Determine how Architectural Intelligence requests realisation.
3.  Verify that the request reaches the ArchiSimple realisation
    capability.
4.  Verify that the approved Specification is converted into the
    existing build operation.
5.  Verify that ArchiSimple actually mutates the model.
6.  Verify that the realisation result is returned to Architectural
    Intelligence.
7.  Ensure the assistant reports success only after successful
    realisation.
8.  Ensure refusal and failure are reported truthfully.
9.  Ensure the AI cannot substitute conversational text for an execution
    result.

### Explicitly out of scope

-   Re-designing the Geometry Specification pipeline.
-   Changing ADR-0032's accepted execution architecture without evidence
    that it is insufficient.
-   Adding a second realisation mechanism in ArchiSimple.
-   Adding new ArchiSimple Requests merely to make the AI integration
    work.
-   Opening authoring UX.
-   General refusal UX improvements covered by the ArchiSimple UX
    roadmap.
-   Fixing unrelated planning-quality problems covered by BUG-007.

------------------------------------------------------------------------

## 4. Existing ArchiSimple capability

ArchiSimple already provides the receiving side required by this bug.

As of Sprint 036.2:

``` text
read approved Geometry Specification
        ↓
realiseApprovedSpecification
        ↓
realiseSpecification
        ↓
Build Plan translation
        ↓
automation.realiseBuildPlan
        ↓
atomic model mutation
        ↓
RealisationRecord
```

The ArchiSimple capability is exposed as the user-facing **Build
Approved Design** action.

036.2 established:

-   a realisation trigger;
-   production wiring;
-   model mutation through the existing realisation pipeline;
-   no second execution mechanism;
-   no new Request;
-   Automation contract remains `1.5.0`;
-   project file version remains `3`;
-   `File → New` clears approved planning artefacts;
-   successful realisation produces a realisation record;
-   refusal leaves the model unchanged.

Therefore BUG-008 should first determine whether the problem is
**before** this boundary, **at** the integration boundary, or **after**
it.

------------------------------------------------------------------------

## 5. Investigation hypothesis

The primary hypothesis is:

> Architectural Intelligence can generate and narrate a Geometry
> Specification but does not reliably invoke the ArchiSimple realisation
> capability when the user asks for the design to be built.

Possible failure modes must be distinguished rather than assumed.

### H1 --- No execution request is produced

The AI generates the specification and conversationally claims that it
will build it, but no executable action is emitted.

### H2 --- Wrong execution capability

An action is emitted, but it does not target the existing ArchiSimple
realisation capability.

### H3 --- Execution is attempted but the approved artefact is unavailable

Architectural Intelligence has a specification, but the corresponding
approved planning artefact is not actually committed/approved in the
state ArchiSimple reads.

### H4 --- Execution reaches ArchiSimple but is refused

The realisation pipeline correctly refuses the design.

In this case the bug is truthful error propagation if the AI
subsequently claims success.

### H5 --- Execution succeeds but the result is not observed

ArchiSimple builds the model, but Architectural Intelligence does not
receive or interpret the result correctly.

### H6 --- Execution succeeds but the UI/model state is stale

The authoritative model contains the building but the visible
application does not refresh.

This must be distinguished from H1--H5 before changing code.

------------------------------------------------------------------------

## 6. Investigation method

The investigation MUST trace one complete realisation attempt.

Use a known-good minimal Geometry Specification where possible, rather
than beginning with the full 100 m² apartment conversation.

The trace should identify:

``` text
AI user request
  → AI planning state
  → approval state
  → emitted action/tool/operation
  → ArchiSimple receiving endpoint
  → approved specification lookup
  → realisation guard
  → Build Plan
  → automation.realiseBuildPlan
  → model mutation
  → RealisationRecord
  → returned result
  → AI response
  → visible ArchiSimple model
```

The investigation should record the exact payloads/contracts at each
boundary where available.

------------------------------------------------------------------------

## 7. Acceptance criteria

### AC-1 --- Successful realisation

Given:

-   an approved valid Geometry Specification;
-   a project capable of realisation;
-   a user request to build the approved design;

the realisation capability is actually invoked and the ArchiSimple model
contains the resulting walls and openings.

### AC-2 --- No conversational false success

The assistant MUST NOT state that the building has been created unless
the execution result confirms successful realisation.

Statements such as:

> "The walls and openings are created."

are invalid unless the realisation result confirms that they were
created.

### AC-3 --- Refusal is truthful

If ArchiSimple refuses realisation:

-   no model mutation is reported;
-   the refusal is returned to the AI layer;
-   the assistant reports that the design was **not built**;
-   the refusal reason is preserved where available.

### AC-4 --- Execution failure is truthful

If the execution path fails unexpectedly:

-   the assistant MUST NOT report success;
-   the failure must be distinguishable from a successful build;
-   the user must be told that realisation did not complete.

### AC-5 --- Approval is authoritative

The AI cannot treat merely generated planning content as equivalent to
an approved Geometry Specification.

The realisation request must use the same approved artefact semantics
already established by ADR-0032 and ArchiSimple 036.2.

### AC-6 --- No second execution mechanism

The fix MUST use the existing ArchiSimple realisation capability.

It MUST NOT introduce a parallel path that constructs
`CreateWallRequest`, `CreateOpeningRequest`, or equivalent mutation
Requests directly from Architectural Intelligence.

### AC-7 --- Result reaches the AI

A successful ArchiSimple realisation must produce an execution result
that the Architectural Intelligence layer can distinguish from:

-   refused;
-   failed;
-   not attempted.

### AC-8 --- Model truth wins

The final user-facing claim must be based on the authoritative execution
result, not on the assistant's intended next action.

------------------------------------------------------------------------

## 8. Test scenarios

At minimum, the investigation/fix should cover these scenarios.

### Scenario A --- Valid approved design

1.  Create or obtain a valid Geometry Specification.
2.  Approve it.
3.  Ask to build it.
4.  Verify an execution action is emitted.
5.  Verify ArchiSimple realises it.
6.  Verify walls/openings exist.
7.  Verify a realisation record exists.
8.  Verify the assistant reports success.

### Scenario B --- No approved design

Ask to build when no approved Geometry Specification exists.

Expected:

``` text
No realisation.
No model mutation.
No false success.
```

### Scenario C --- Refused design

Use a Geometry Specification that reaches the realisation guard and is
refused.

Expected:

``` text
Realisation attempted.
Model unchanged.
Refusal returned.
Assistant reports refusal, not success.
```

### Scenario D --- Execution failure

Force or simulate a failure at the integration boundary.

Expected:

``` text
No false success.
Failure remains distinguishable from refusal.
```

### Scenario E --- Repeat build

After a successful realisation, request the same build again.

Expected:

``` text
Existing realisation record is respected.
No duplicate building is created.
The assistant reports that the design has already been realised.
```

------------------------------------------------------------------------

## 9. Evidence required

The investigation MUST produce a traceable evidence record.

At minimum record:

-   repository commit(s);
-   Architectural Intelligence commit;
-   ArchiSimple commit;
-   exact user request;
-   exact generated/approved planning artefact identifier;
-   action/tool/operation emitted by AI;
-   ArchiSimple receiving action;
-   realisation result;
-   model state before and after;
-   assistant response.

Where possible, include automated tests for the integration boundary.

If browser verification is required, capture:

-   the project before realisation;
-   the build action;
-   the resulting model;
-   the user-facing result.

------------------------------------------------------------------------

## 10. Architectural constraints

The following constraints are normative.

### 10.1 ArchiSimple remains the execution authority

Architectural Intelligence proposes and orchestrates.

ArchiSimple remains responsible for deciding whether a design can
actually be built and for mutating the model.

### 10.2 No duplicate geometry execution

Architectural Intelligence MUST NOT implement its own wall/opening
construction sequence.

### 10.3 No conversational execution fiction

Natural-language output is not evidence of execution.

An execution claim requires an execution result.

### 10.4 Existing realisation pipeline is the target

The expected target is the existing ArchiSimple capability introduced
through ADR-0032 and Sprint 036.2.

If that capability cannot be reached from Architectural Intelligence
using the existing integration contract, stop and document the
architectural boundary rather than silently introducing a second
mechanism.

------------------------------------------------------------------------

## 11. Definition of Done

-   [ ] Root cause identified and documented.
-   [ ] One complete AI → ArchiSimple realisation trace exists.
-   [ ] Successful build path is executable end-to-end.
-   [ ] A real model mutation is verified.
-   [ ] Successful result is returned to Architectural Intelligence.
-   [ ] AI reports success only after confirmed success.
-   [ ] Refusal is reported as refusal.
-   [ ] Execution failure is reported as failure.
-   [ ] No-approved-design case does not mutate the model.
-   [ ] Repeat-realisation guard is respected.
-   [ ] No second geometry execution mechanism introduced.
-   [ ] Tests cover the integration boundary.
-   [ ] Browser verification performed where the affected path is
    UI-visible.
-   [ ] Documentation updated with the final boundary and root cause.

------------------------------------------------------------------------

## 12. Stop conditions

Stop implementation and document the finding if:

1.  Architectural Intelligence cannot reach the existing ArchiSimple
    realisation capability with the current integration contract.
2.  A new cross-repository contract is required.
3.  The current approval semantics are insufficient to identify the
    authoritative Geometry Specification.
4.  A second execution mechanism appears necessary.
5.  The existing ArchiSimple realisation pipeline itself is found to be
    incorrect.
6.  The observed "nothing is built" behaviour is caused only by stale UI
    state rather than an execution failure.
7.  The AI layer cannot distinguish successful execution from
    refusal/failure with the existing result contract.

A stop condition is a result, not permission to work around the
boundary.

------------------------------------------------------------------------

## 13. Expected outcome

The desired end state is not merely:

> "The AI knows how to call Build Approved Design."

It is:

> **When the user asks Architectural Intelligence to build an approved
> design, the request crosses the existing realisation boundary,
> ArchiSimple performs the authoritative build, and the assistant
> reports the actual result.**

The complete chain must therefore be observable:

``` text
User
 ↓
Architectural Intelligence
 ↓
Approved Geometry Specification
 ↓
Realisation action
 ↓
ArchiSimple
 ↓
realiseApprovedSpecification
 ↓
automation.realiseBuildPlan
 ↓
Walls / openings in model
 ↓
RealisationRecord
 ↓
Execution result
 ↓
Architectural Intelligence
 ↓
Truthful user-facing response
```

BUG-008 is complete only when this chain works end-to-end or a precise
architectural boundary prevents it, in which case that boundary is
documented as the next architectural decision.
