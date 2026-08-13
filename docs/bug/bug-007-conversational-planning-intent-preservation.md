# BUG-007 — Conversational Planning Intent Preservation

> **Status:** Open  
> **Priority:** High  
> **Repository:** `architectural-intelligence`  
> **Affected flow:** Conversation → Brief → Programme → Layout → Geometry → Specification  
> **Downstream consumer:** `archisimple`  
> **Related work:** ArchiSimple Sprint 036.2 — Build Approved Design

---

## 1. Summary

Explicit user intent is not reliably preserved as it moves through the Architectural Intelligence planning pipeline.

A real end-to-end conversation exposed two concrete contradictions:

1. The user explicitly requested a **100 m²** apartment, but the generated Programme states **"No total was stated"** and allocates 85 m².
2. The user explicitly requested **a small home office**, but the generated Brief contains the office while simultaneously recording **"no home office"** as an assumption/requirement.

The problem is upstream of ArchiSimple's realisation layer. ArchiSimple can consume an approved Geometry Specification, but the specification is only as correct as the planning artefacts produced by `architectural-intelligence`.

This bug therefore belongs primarily to `architectural-intelligence`.

---

## 2. Reproduction

### User conversation

The user asks:

> Can you build me a 100m2 appartment?

The conversation captures:

- single storey;
- 2 bedrooms;
- 2 bathrooms;
- small home office;
- modern style;
- no budget.

The planning pipeline then proceeds through:

```text
Brief
  ↓
Programme
  ↓
Layout
  ↓
Geometry
  ↓
Specification
```

### Observed Brief

The Brief correctly contains a home office, but also contains contradictory information:

```text
Spaces
- home office
- 2 × bedroom
- 2 × bathroom

Requirements
- 1 storey
- 2 bedrooms
- 2 bathrooms
- modern style
- a budget of no budget
- no garage
- no home office
- no specific accessibility requirement
```

The assumptions also state:

> No home office, since none was mentioned.

This is false: the user explicitly mentioned a small home office.

### Observed Programme

The Programme contains:

```text
home office — 9 m²
kitchen — 12 m²
living room — 24 m²
bedroom × 2 — 12 m² each
bathroom × 2 — 5 m² each
hallway — 6 m²

Total — 85 m²
```

and states:

> No total was stated.

This contradicts the original request for a 100 m² apartment.

---

## 3. Expected behaviour

The pipeline must preserve information explicitly supplied by the user.

For the reproduced scenario, the semantic state must remain equivalent to:

```text
target area: 100 m²
storeys: 1
bedrooms: 2
bathrooms: 2
home office: explicitly requested
style: modern
budget: no budget
```

### Brief

The Brief MUST preserve:

- target area = 100 m²;
- single storey;
- 2 bedrooms;
- 2 bathrooms;
- home office requested;
- modern style;
- no budget.

It MUST NOT infer or record that the user did not request a home office.

### Programme

The Programme MUST retain access to:

- target area = 100 m²;
- 2 bedrooms;
- 2 bathrooms;
- requested home office.

It MUST NOT state that no target area was supplied.

The Programme may still derive room allocations according to its existing synthesis rules. A temporary allocation that does not exactly equal 100 m² is not, by itself, the bug.

The defect is loss or denial of the **100 m² target**.

### Downstream stages

The explicit requirements must remain recoverable through:

```text
Brief → Programme → Layout → Geometry → Specification
```

A downstream artefact does not need to repeat every upstream field verbatim. It must not silently contradict or erase an explicit requirement that it is responsible for carrying forward.

---

## 4. Core semantic rule

The pipeline must distinguish at least conceptually between:

```text
explicitly requested
unspecified
explicitly rejected
```

In particular:

> **Unspecified MUST NOT become false.**

And:

> **An explicit user request MUST take precedence over an inferred default.**

For example:

```text
User: "I need a small home office."
```

must not result in:

```text
home office = requested
home office = not requested
```

within the same coherent planning artefact.

Likewise:

```text
User: "100 m² apartment."
```

must not become:

```text
target area = unspecified
```

during Programme synthesis.

---

## 5. Investigation requirement

Do not patch each generated artefact independently.

Identify the **first incorrect transformation** in the pipeline.

Trace:

```text
Conversation
    ↓
brief extraction / assembly
    ↓
Brief
    ↓
synthesizeProgramme
    ↓
Programme
    ↓
synthesizeLayout
    ↓
Layout
    ↓
synthesizeGeometry
    ↓
Geometry
    ↓
synthesizeSpecification
    ↓
Specification
```

For each transition determine:

- the authoritative source;
- the field carrying the information;
- whether the value is explicit, inferred, or defaulted;
- where the value is first lost or contradicted.

The fix should be made at that first incorrect transition.

---

## 6. Canonical regression scenario

The reproduced conversation becomes the canonical regression scenario.

### Input

```text
Apartment
Target area: 100 m²
Storeys: 1
Bedrooms: 2
Bathrooms: 2
Additional space: small home office
Style: modern
Budget: no budget
```

### Required assertions

At minimum:

```text
Brief.targetArea === 100
Brief.homeOffice === requested

Programme.targetArea === 100
Programme contains homeOffice
```

The test should assert semantic/domain values rather than generated prose.

It should not depend on strings such as:

> "No total was stated."

The regression must fail because the underlying information is wrong, not because wording changes.

---

## 7. Additional regression cases

Where the existing contracts support the distinction, add cases for:

### Explicit positive

```text
User requests a home office.
```

Expected:

```text
home office = requested
```

### Unspecified

```text
User does not mention a garage.
```

Expected:

```text
garage = unspecified / inferred according to existing semantics
```

It must not be represented as though the user explicitly rejected a garage.

### Explicit negative

```text
User explicitly says they do not want a garage.
```

Expected:

```text
garage = explicitly rejected
```

The exact representation must follow the existing contract rather than introducing a new taxonomy solely for this bug.

---

## 8. Do not over-fix the 85 m² result

The observed Programme total of 85 m² does **not automatically mean that the programme synthesis algorithm is wrong**.

The first question is whether the Programme can represent:

```text
target area = 100 m²
allocated area = 85 m²
```

If so, preserving the target is sufficient for this bug.

If existing product semantics require the Programme to allocate exactly 100 m², that is a separate issue and should be identified explicitly rather than silently added to BUG-007.

---

## 9. Architectural boundary

This bug is primarily owned by:

```text
architectural-intelligence
```

ArchiSimple is the downstream consumer.

The relevant downstream boundary is:

```text
Geometry Specification
        ↓
ArchiSimple
        ↓
readApprovedGeometrySpecification
        ↓
realiseApprovedSpecification
        ↓
automation.realiseBuildPlan
```

That pipeline was established and verified in ArchiSimple Sprints 034.0–036.2.

BUG-007 does **not** require changes to that realisation architecture.

A change to ArchiSimple should only be made if investigation demonstrates that the AI-produced artefact is semantically correct but is subsequently misinterpreted by the consumer.

If that happens, record the issue separately or link the downstream finding rather than moving the ownership of BUG-007.

---

## 10. Scope

### In scope

- Brief extraction / assembly relevant to the reproduced scenario;
- preservation of explicit target area;
- preservation of explicitly requested spaces;
- distinction between explicit information and inferred assumptions;
- Programme synthesis consumption of Brief values;
- regression coverage for the complete planning path;
- documentation of any architectural limitation discovered.

### Out of scope

- UI changes;
- ribbon changes;
- approval UX;
- ArchiSimple authoring;
- ArchiSimple realisation mechanics;
- new Automation Requests or Operations;
- changing the project-file format;
- redesigning the Programme area-allocation algorithm unless required by an existing contract;
- introducing a parallel requirements taxonomy.

---

## 11. Stop conditions

Stop implementation and record an architectural finding if:

1. The existing Brief contract cannot represent information explicitly supplied by the user.
2. The Programme contract cannot preserve a required Brief value.
3. The existing semantic model intentionally collapses "unspecified" and "explicitly rejected" and changing that meaning would affect multiple capabilities.
4. Fixing the issue requires a cross-repository contract change.
5. The only solution is to hard-code the reproduced example.
6. A downstream stage intentionally discards an explicit requirement and there is no existing architectural decision authorising that behaviour.

A stop condition is an architectural result, not an invitation to patch around the boundary.

---

## 12. Definition of Done

- [ ] The first incorrect transformation has been identified.
- [ ] The 100 m² target survives Brief → Programme.
- [ ] The explicit home-office request survives Brief → Programme.
- [ ] The contradictory "no home office" statement is eliminated.
- [ ] Unspecified optional spaces are not falsely represented as explicitly rejected.
- [ ] The canonical 100 m² apartment scenario passes through the real planning pipeline.
- [ ] Regression tests assert semantic values.
- [ ] No example-specific hard-coded workaround exists.
- [ ] No parallel requirements taxonomy is introduced.
- [ ] Existing downstream ArchiSimple realisation remains compatible.
- [ ] `pnpm build` passes.
- [ ] `pnpm lint` passes with no new errors.
- [ ] `pnpm test` passes.
- [ ] Relevant repository validation passes.
- [ ] Any genuine architectural limitation is recorded in the appropriate findings register.

---

## 13. Expected outcome

After BUG-007 is fixed, the reproduced conversation must preserve the user's intent rather than silently rewriting it.

Instead of:

```text
User:
100 m²
small home office

Brief:
no home office

Programme:
"No total was stated."
```

the pipeline must produce semantically equivalent information to:

```text
Brief:
target area = 100 m²
home office = requested

Programme:
target area = 100 m²
home office = present
```

The exact architectural programme remains the responsibility of the existing synthesis rules.

The invariant this bug establishes is:

> **Architectural Intelligence must not forget or contradict explicit user intent while transforming a conversation into a buildable design.**

ArchiSimple should then receive a Geometry Specification that represents the design actually requested, rather than a specification derived from silently altered intent.
