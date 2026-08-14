# BUG-011 --- Generated plan does not fully satisfy the programme

**Status:** Partially resolved --- detection solved, end-to-end handling pending\
**Repository:** architectural-intelligence + ArchiSimple\
**Type:** Bug / validation and generation quality\
**Priority:** High\
**Related:** BUG-008, BUG-009, BUG-010, BUG-012, ADR-0034

> **2026-08-14 update.** The authoritative constraint-evaluation foundation
> (ADR-0034, Sprint 037.3) closes the defect this report opened with: the
> evaluator now correctly detects that a generated Specification does not
> satisfy every programme requirement, using stable ids rather than any
> generator's own satisfaction claim. BUG-012 then found, and fixed, the
> presentation gaps that detection alone did not close — legacy percentage
> claims left visible beside the authoritative count, raw ids in failure
> messages, and a "Recorded with the project" summary that read as compliance
> regardless of the verdict.
>
> **What remains open** is not a bug this report or BUG-012 can close: what a
> `fail` verdict should *mean* for the workflow — whether it blocks approval,
> triggers optimisation, or is merely informational — is deliberately
> undecided pending the next ADR (BUG-012's own scope boundary). This report
> stays open until that ADR lands and an end-to-end run reflects it, but the
> specific claim in Problem §1 below — that the system could report a plan as
> 100% satisfying the programme while a required doorway was missing — no
> longer reproduces: the same scenario now reports the shortfall by name.


------------------------------------------------------------------------

## 1. Problem

The generated apartment plan provides a concrete example of a broader
defect:

The approved Space Programme stated:

> **Circulation --- Every space opens off the hallway.**

The generated Layout reported:

-   Programme satisfied: **100%**
-   Required adjacencies met: **100%**
-   Preferred adjacencies met: **100%**
-   Circulation reaches: **100% of storeys**

However, inspection of the generated floor plan showed that **Bedroom 2
had no doorway connection to the hallway/circulation**.

The critical defect is therefore:

> **The system can claim that a generated plan satisfies the programme
> when the resulting plan does not actually satisfy that requirement.**

This bug should not be fixed merely by changing the particular apartment
layout. It should establish whether the programme constraints, generated
layout, actual topology/geometry, and reported quality are using a
trustworthy common source of truth.

------------------------------------------------------------------------

## 2. Reproduction

### Brief

``` text
100 m² apartment
1 storey
2 bedrooms
2 bathrooms
```

### Programme

The generated programme included:

-   living room
-   kitchen
-   2 bedrooms
-   2 bathrooms
-   hallway

and the relationship:

``` text
Every space opens off the hallway.
```

### Observed result

The layout reported 100% satisfaction, but Bedroom 2 had no visible
connection to the hallway.

### Expected result

Either:

1.  the generated layout satisfies the requirement; or
2.  the evaluator reports the violation and the UI does not claim 100%
    satisfaction.

------------------------------------------------------------------------

## 3. Investigation scope

Trace the complete path:

``` text
Brief
  ↓
Space Programme
  ↓
Programme constraints
  ↓
Layout generation
  ↓
Layout topology / geometry
  ↓
Constraint evaluation
  ↓
Reported satisfaction
  ↓
UI
```

Determine whether the defect is in:

-   constraint representation;
-   layout generation;
-   layout validation;
-   geometry realisation;
-   quality calculation;
-   UI reporting;
-   or more than one layer.

Do not prescribe the fix before identifying the failing layer.

------------------------------------------------------------------------

# 4. Multi-scenario regression suite

This bug should establish a reusable set of **architectural test
cases**, not just a regression for the original apartment.

Each scenario should define:

1.  a brief;
2.  expected programme constraints;
3.  expected layout properties;
4.  required constraints;
5.  preferred constraints;
6.  expected validation result.

The exact generated dimensions do not need to be identical between runs.
The tests should verify the architectural properties that matter.

------------------------------------------------------------------------

## TC-01 --- Original reproduction

**Brief**

``` text
100 m² apartment
1 storey
2 bedrooms
2 bathrooms
```

**Required**

-   all bedrooms reachable from circulation;
-   all bathrooms reachable from circulation;
-   kitchen and living space reachable from circulation.

**Critical assertion**

The reported required-adjacency result MUST agree with the actual layout
topology.

------------------------------------------------------------------------

## TC-02 --- Small apartment baseline

**Brief**

``` text
60 m² apartment
1 storey
1 bedroom
1 bathroom
```

Verify:

-   one bedroom;
-   one bathroom;
-   circulation;
-   bedroom reachable from circulation;
-   bathroom reachable from circulation.

Purpose: ensure validation does not depend on repeated spaces.

------------------------------------------------------------------------

## TC-03 --- Repeated spaces

**Brief**

``` text
120 m² apartment
1 storey
3 bedrooms
2 bathrooms
```

All three bedroom instances must be checked individually.

The evaluator MUST NOT consider:

``` text
bedroom × 3
```

satisfied merely because one bedroom is correctly connected.

------------------------------------------------------------------------

## TC-04 --- Specific room relationships

**Brief**

``` text
100 m² apartment
1 storey
2 bedrooms
2 bathrooms
```

Required:

``` text
Bedroom 1 ↔ Bathroom 1
Bedroom 2 ↔ Bathroom 2

Bedroom 1 → circulation
Bedroom 2 → circulation
Bathroom 1 → circulation
Bathroom 2 → circulation
```

Purpose: distinguish generic counts/reachability from relationships
between particular spaces.

------------------------------------------------------------------------

## TC-05 --- Hallway as primary circulation

**Brief**

``` text
100 m² apartment
1 storey
2 bedrooms
2 bathrooms
```

Requirement:

``` text
The hallway is the primary circulation space.
All bedrooms and bathrooms open directly onto the hallway.
```

The evaluator must distinguish:

``` text
Bedroom → Hallway
```

from:

``` text
Bedroom → another room → Hallway
```

when direct adjacency is required.

------------------------------------------------------------------------

## TC-06 --- Required versus preferred adjacency

**Brief**

``` text
100 m² apartment
1 storey
2 bedrooms
2 bathrooms
```

Required:

``` text
Bedrooms → circulation
Bathrooms → circulation
```

Preferred:

``` text
Living room ↔ kitchen
Bedroom ↔ bathroom
```

Verify that required and preferred constraints are reported separately.

A preferred constraint failing must not hide a required constraint
failure.

------------------------------------------------------------------------

## TC-07 --- Deliberately invalid candidate

Construct or inject a layout where:

``` text
Bedroom 2 has no opening to circulation.
```

Expected:

``` text
required constraint = FAILED
```

The evaluator MUST NOT return:

``` text
100% satisfied
```

The failure should identify the violated constraint sufficiently for
diagnostics.

------------------------------------------------------------------------

## TC-08 --- Disconnected circulation

Create two disconnected regions:

``` text
Region A:
  entrance
  hallway
  bedroom 1
  bathroom 1

Region B:
  bedroom 2
  bathroom 2
```

Expected:

-   Region B is detected as disconnected from circulation;
-   the required constraints fail.

This prevents local adjacency checks from being mistaken for valid
circulation.

------------------------------------------------------------------------

## TC-09 --- Valid layout, invalid reporting

Where technically possible, create a valid topology and verify that the
reported constraint state is also valid.

Purpose:

> quality reporting must be derived from actual model state, not from an
> optimistic generator assertion.

------------------------------------------------------------------------

## TC-10 --- Invalid layout, optimistic reporting

Reproduce the core failure deliberately:

``` text
Programme:
  Bedroom 2 → Hallway required

Actual layout:
  no Bedroom 2 → Hallway connection

Reported result:
  100%
```

This MUST fail until the underlying defect is corrected.

This should become the canonical regression test for BUG-011.

------------------------------------------------------------------------

## TC-11 --- Layout → geometry preservation

Generate a layout that satisfies its required constraints, then realise
it into walls/openings.

Re-evaluate the resulting geometry.

Expected:

``` text
Valid Layout
    ↓
Realisation
    ↓
Valid Geometry
```

Required relationships must survive realisation.

If realisation invalidates a constraint, that failure must be detected
rather than silently hidden.

------------------------------------------------------------------------

# 5. Source of truth

The investigation SHALL identify the authoritative computation for:

-   required adjacency satisfaction;
-   preferred adjacency satisfaction;
-   circulation reachability;
-   overall constraint/quality status.

There SHOULD be one authoritative evaluation path.

Avoid independent calculations in:

-   programme generation;
-   layout generation;
-   geometry generation;
-   UI reporting.

The UI should consume the authoritative result rather than inventing its
own score.

This is an investigation requirement, not a prescribed API design.

------------------------------------------------------------------------

# 6. Approval safety

A generated Layout MUST NOT be presented as fully compliant when a
required programme constraint is known to fail.

For example:

``` text
Required constraints: 4 / 5
```

is preferable to:

``` text
Required constraints: 100%
```

when one required constraint is actually violated.

The exact approval UX is not the main scope unless the current
implementation makes it impossible to prevent a false claim.

------------------------------------------------------------------------

# 7. Test levels

### Level 1 --- Headless deterministic tests

Fast tests for:

-   programme constraints;
-   layout topology;
-   constraint evaluation.

### Level 2 --- End-to-end pipeline tests

Exercise:

``` text
Brief
 → Programme
 → Layout
 → Geometry
```

and evaluate the final model against the original requirements.

### Level 3 --- Browser verification

The canonical TC-01 scenario MUST be verified in the browser.

The browser pass must inspect both:

1.  the reported constraint result;
2.  the actual visible floor plan.

A test that only asserts text such as "100% satisfied" is insufficient.

------------------------------------------------------------------------

# 8. Acceptance criteria

-   [ ] The original 100 m² / 2 bedroom / 2 bathroom scenario no longer
    produces a false 100% satisfaction result.
-   [ ] Required adjacency is evaluated against the actual generated
    layout.
-   [ ] Every repeated space instance is checked.
-   [ ] Direct adjacency is distinguished from indirect reachability
    where required.
-   [ ] Required and preferred constraints are evaluated separately.
-   [ ] Disconnected circulation is detected.
-   [ ] Layout → geometry realisation preserves validated constraints,
    or reports a failure.
-   [ ] The UI cannot claim 100% required satisfaction when the actual
    model violates a required constraint.
-   [ ] Multiple briefs are covered by the regression suite.
-   [ ] At least one deliberately invalid candidate is correctly
    rejected.
-   [ ] At least one complete Brief → Programme → Layout → Geometry
    pipeline is covered.
-   [ ] Browser verification confirms that the reported result matches
    the visible plan.
-   [ ] No new architectural requirement is invented merely to make the
    existing reproduction pass.

------------------------------------------------------------------------

# 9. Explicit non-goals

BUG-011 does NOT attempt to:

-   create a complete architectural optimisation engine;
-   solve every possible spatial-planning constraint;
-   implement renovation mode;
-   implement PDF plan import;
-   implement structural analysis;
-   create the complete future constraint-authoring UI;
-   make the AI produce architecturally optimal plans.

Those capabilities may build on the constraint foundation established
here.

------------------------------------------------------------------------

# 10. Stop conditions

Implementation MUST stop for review if:

1.  the programme does not contain enough structured information to
    determine whether the requirement is satisfied;
2.  the model cannot represent the required relationship without
    introducing a new architectural concept;
3.  constraint evaluation and generation use fundamentally incompatible
    representations;
4.  fixing the issue requires changing the Automation contract;
5.  fixing the issue requires introducing a second competing source of
    truth for quality/constraint state;
6.  the implementation requires guessing architectural requirements not
    present in the programme;
7.  the failure cannot be deterministically reproduced;
8.  browser verification contradicts the headless result.

------------------------------------------------------------------------

# 11. Deliverables

### Investigation

-   Trace Programme → Layout → Geometry → Validation.
-   Identify the exact origin of the false 100% result.
-   Identify the authoritative constraint representation and evaluator.
-   Record any architectural gap discovered.

### Implementation

-   Correct the underlying defect.
-   Add the multi-scenario regression suite.
-   Add deliberately-invalid candidate tests.
-   Add end-to-end pipeline coverage.
-   Preserve the existing approval and realisation boundaries.

### Documentation

Update relevant:

-   current-state documentation;
-   architecture findings;
-   test/audit documentation;
-   BUG-011 outcome.

------------------------------------------------------------------------

# 12. Success criterion

> **The system must never tell the user that a generated plan satisfies
> a required programme constraint when inspection of the actual plan
> proves otherwise.**

The original apartment is the reproduction.

**The multi-scenario regression suite is the real deliverable.**
