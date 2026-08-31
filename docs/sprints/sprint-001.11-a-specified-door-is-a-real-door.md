# Sprint 1.11 — A specified door is a real door

> **Status:** **Complete** (2026-08-31)
> **Version:** 1.0
> **Repository:** `architectural-intelligence` — the host half is **ArchiSimple Sprint 053.1**
> **Related ADRs:** ADR-AI-0001 (the Geometry Specification); ArchiSimple ADR-0038 Rules 2, 6, 16; ArchiSimple ADR-0057 Rule 11
> **Prerequisites:** ArchiSimple **053.0** (the canonical library exists) and **053.1** (its reader accepts the field)
> **Next:** unassigned. Furniture is **not** a follow-up to this — see §9.

---

## 1. Objective

Let a Geometry Specification name the **catalogue entry** for each door it
specifies, so that a design this layer produced is built with the same door a
person would have placed by hand.

```text
Geometry Graph  →  opening candidate
                     ↓  this stage picks a kind          (unchanged)
                     ↓  this stage picks dimensions      (unchanged)
                     ↓  this stage names a standard door (NEW)
                   SpecifiedOpening { kind, width, height, sill, assetDefinitionId? }
                     ↓  the host reads it                (ArchiSimple 053.1)
                   createOpening → Opening.assetDefinitionId → its own plan symbol
```

Today this layer specifies a **0.90 m** door opening. That is not a French
standard: the NF P20-101 leaf series is 63 / 73 / 83 / 93, and with a standard
bloc-porte huisserie those need openings of 0.73 / 0.83 / 0.93 / 1.03. A 0.90 m
opening corresponds to no leaf anybody can order.

So this sprint is not only about identity. It is about specifying a door that
exists.

---

## 2. Two sprints, and the host goes first

| Sprint          | Repository                   | Delivers                                                    |
| --------------- | ---------------------------- | ----------------------------------------------------------- |
| **053.0**       | `archisimple`                | the canonical library, and the symbols to carry             |
| **053.1**       | `archisimple`                | `SpecifiedOpening.assetDefinitionId?`, read and translated  |
| **1.11** (this) | `architectural-intelligence` | writing it, and the door dimensions that make it meaningful |

**The host first**, unusually — the reverse of Sprint 1.7. The field is only
meaningful once something reads it, and a Specification carrying an identity the
host discards is a field that looks like it works.

**No platform package changes on either side**, so ADR-0030 Rule 8's
"the platform releases first" does not apply, exactly as Sprint 1.7 recorded.
In the linked local workspace this is a **build order, not a release order**, and
**no npm publish is required by either half.**

### The two `SpecifiedOpening` types are mirrors, not a shared type

This repository declares `SpecifiedOpening` in
[`src/geometry/geometry-specification.ts`](../../src/geometry/geometry-specification.ts);
the host declares its own in `apps/web/src/realisation/geometrySpecification.ts`.
Neither imports the other — the artefact crosses as **JSON**, and each side
validates the shape it needs.

That is why this costs no platform version: the field is added to two
independent mirrors of one document shape, and the seven `peerDependencies` are
untouched.

---

## 3. Inherited — do not re-derive

| Fact                                                                                        | Where it was decided                                |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Thickness, height and opening size are **architectural decisions and belong to this stage** | `construction-defaults.ts`'s own header             |
| An asset id is **stable across releases of its provider**                                   | ArchiSimple ADR-0038 Rule 2                         |
| A realised entity **records the definition that produced it**                               | ArchiSimple ADR-0038 Rule 6 — "identity, not audit" |
| An unresolvable definition is **completely normal** and degrades to the built-in symbol     | ArchiSimple ADR-0038 Rule 16                        |
| The Specification's **own dimensions stay authoritative**; the id is identity               | ArchiSimple 053.1                                   |
| The host **does not resolve** the id, and never blocks a build over one                     | ArchiSimple 053.1                                   |
| A size designation names the **leaf**; the opening is the **baie**                          | ArchiSimple ADR-0057 Rule 11                        |

---

## 4. The decision: this stage names a product, it does not read a catalogue

`ConstructionDefaults.opening.door` gains an `assetDefinitionId`, as a
**constant in this repository**:

```ts
door: Object.freeze({
  assetDefinitionId: 'archisimple:door-single-leaf-83',
  width: 0.93,   // the baie for an 83 leaf with a standard bloc-porte huisserie
  height: 2.1,
  sill: 0
}),
passage: Object.freeze({ width: 1.2, height: 2.1, sill: 0 })  // unchanged; no id
```

### Why a constant and not a catalogue read

A read port was considered and **rejected**. Three reasons, and the third is
decisive:

1. **This stage already owns the decision.** `construction-defaults.ts` states
   that opening size is an architectural decision belonging here. _Which standard
   door_ is the same kind of decision, and a `porte 83` is nameable from
   architectural knowledge — it does not require knowing what a particular
   machine has installed.
2. **A port would make a design host-dependent.** The same Brief on two machines
   would produce different Specifications depending on which libraries each user
   had imported. An approved artefact is immutable (ADR-0027.1 Rule 4); it must
   not be a function of somebody's IndexedDB.
3. **This repository builds and tests alone** (ADR-0030 Rule 4), with an
   allow-list of exactly seven dependencies. A catalogue port would be a new
   host coupling for a value this layer can simply state.

**A stable id is precisely what makes the constant safe.** ADR-0038 Rule 2
guarantees `archisimple:door-single-leaf-83` means the same thing across
releases; that guarantee is what a hard-coded reference is entitled to rely on.

### What happens when the host has never heard of it

Nothing bad, and this is load-bearing. ArchiSimple 053.1 does not resolve the id
and does not block a build over one. An unknown id builds an opening that draws
the built-in drafting mark — **today's behaviour exactly**. So a host without the
canonical library is not degraded by this sprint; it is unchanged by it.

---

## 5. Behaviour

| Situation                                  | Before                        | After                                                 |
| ------------------------------------------ | ----------------------------- | ----------------------------------------------------- |
| A door between two spaces                  | 0.90 m opening, no identity   | **0.93 m** opening, `archisimple:door-single-leaf-83` |
| A cased opening (passage)                  | 1.20 m, no identity           | unchanged, and still **no identity**                  |
| A door narrowed to fit a short shared wall | width reduced, warning raised | unchanged, **and the identity is still recorded**     |
| A window                                   | not produced at all           | **still not produced at all** — §8                    |

### A narrowed door keeps its identity

`openingsFor` narrows a door when the shared wall is too short, and warns. The
identity is **still written**, and that is deliberate: the Specification's
dimensions are authoritative (053.1), the host scales the symbol to the actual
width, and the record of _which door was intended_ is worth more than a silence.

The existing warning already tells the reviewer the door was narrowed. Dropping
the identity as well would hide the intent without adding information.

### Why the assumption text changes

`describeAssumptions` currently says _"Doors are 900 × 2.1 m …"_. It must now
name the product, because that is what the reviewer is approving:

> "Doors are a standard 83 leaf in a 930 × 2.1 m opening, centred on the wall
> they cross."

---

## 6. Scope

### In

- `SpecifiedOpening.assetDefinitionId?: string` on **this repository's** type.
- `OpeningDefaults.assetDefinitionId?: string`, and the door default set to the 83.
- The door opening width **0.90 → 0.93**.
- `specification-synthesis.ts` writes the id through from the defaults.
- `specification-validation.ts` validates **shape only** — present ⇒ non-empty string.
- The assumption text names the product.

### Out

| Not in this sprint                                               | Why                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Furniture in any artefact**                                    | A different problem with a different owner — §9                                                                   |
| A catalogue read port                                            | §4                                                                                                                |
| Windows                                                          | §8 — a window has no opening candidate to be placed in                                                            |
| Per-room door sizing (a 73 to a bedroom, an 83 to a living room) | The Space Programme knows room roles and this stage does not consult them. A real improvement, and a separate one |
| Any `automation-api` change                                      | The contract is untouched, in both repositories                                                                   |

---

## 7. Validation is shape-only, here as well as there

`specification-validation.ts` checks the field is a non-empty string when
present, and **nothing else**. It does not check the grammar, does not resolve
it, and does not know what a provider is.

The same posture the host takes (053.1) and the same posture this repository
already takes for `connects`: _provenance is validated as a shape and resolved by
nobody_.

---

## 8. Windows remain unreachable, and this sprint does not change that

`OPENING_KINDS` here is `door | passage`. There is no window, and
`describeAssumptions` says so in the artefact itself:

> "There are no windows: the approved geometry records no opening in an external
> wall for one to be placed in."

That is a **Geometry Graph** gap — nothing upstream produces an opening candidate
on an external wall — not a naming gap. ArchiSimple 053.0 ships four canonical
windows and this pipeline can reach none of them.

Recorded here so the next person does not read "the canonical library has
windows" and assume the pipeline can specify one. Closing it means teaching the
Graph to want a window, which is an architectural question about daylight and
elevation, not a catalogue question.

---

## 9. Furniture is a different sprint, and a much larger one

Doors were small because **the artefact already models them**. Furniture is not,
and the difference is structural rather than a matter of size:

|                                               | A door                                 | A piece of furniture                                                              |
| --------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| Already in the Specification?                 | **Yes** — `SpecifiedOpening`           | **No** — a new collection on some artefact                                        |
| What it becomes                               | an `Opening`, via `createOpening`      | an `AssetInstance`, via `placeAsset` — a different Request and a different entity |
| Does the build plan carry it?                 | yes, already                           | **no** — `realiseBuildPlan` would change what "build" means                       |
| Can this layer name it from first principles? | **Yes.** A _porte 83_ is a standard    | **No.** A sofa is not standardisable; this genuinely needs a catalogue port       |
| What decides where it goes                    | the Geometry Graph's opening candidate | which room, what rotation, does it fit, does it block a door — **layout**         |

That last row is the real one. Furniture placement **is** layout, and this
pipeline has a Layout Plan stage that owns layout and deliberately owns no
geometry. Deciding whether furniture belongs to the Layout Plan (which cannot
hold coordinates), to the Geometry Specification (which is a _construction_
contract), or to a fifth artefact is an **ADR-0027.1 question**, not a sprint
detail — and Rule 13 forbids adding a stage casually.

It would also be the first thing here that needs a catalogue port, for the reason
§4 says a door does not: this layer cannot invent a sofa the way it can name a
standard door.

> ArchiSimple's `00-current-state.yaml` records
> `assets in the planning pipeline — no artefact gains furniture` under
> `notImplemented`. **This sprint narrows that to openings and leaves it
> standing.** Do not delete the line when this lands.

---

## 10. Testing

**Unit**

- `specification-synthesis` writes the door's `assetDefinitionId` and writes none for a passage.
- A narrowed door keeps its identity and still warns.
- `specification-validation` accepts an absent field, accepts a non-empty string, rejects `''` and a non-string, and **accepts an id naming nothing**.
- `describeAssumptions` names the product and the 930 opening.

**Regression**

- Every existing Specification fixture reads and validates unchanged.
- Golden-Specification tests are updated for `0.90 → 0.93`; **the diff must be exactly the door widths and the assumption line**, and any other movement is a defect.
- `architecture-compliance.test.ts` passes — in particular no eighth dependency, and no `@archisimple/core`.

**End to end** (needs the linked workspace, both halves)

- A Brief through to realisation produces `Opening`s carrying `archisimple:door-single-leaf-83`, drawing the canonical symbol.
- The same design on a host **without** the canonical library still builds, and the doors draw the built-in mark.

---

## 11. Definition of done

- [ ] Build, lint, tests, `architecture-compliance`
- [ ] Seven dependencies, unchanged
- [ ] No `automation-api` change and no contract version bump — **in either repository**
- [ ] `docs/architecture/00-current-state.{md,yaml}` updated
- [ ] ADR-AI-0001 annotated in place: a `SpecifiedOpening` may name a catalogue entry, and validation is shape-only
- [ ] The `notImplemented` furniture line **narrowed, not removed**

---

## 12. Stop conditions

| Stop if                                                                                                 | Because                                                                         |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| The host's reader rejects an unknown `assetDefinitionId`                                                | 053.1's degradation is the premise of §4. Fix the host before writing the field |
| The 0.93 change moves anything in a golden Specification other than door widths and the assumption line | A construction default is leaking into geometry that should not see it          |
| Naming the door requires reading the catalogue                                                          | Then §4's argument is wrong, and this needs an ADR before it needs code         |

---

## 13. What implementation changed

**Everything in §6 landed.** Three things are worth recording.

### The design in §4 held, unchanged

A constant, not a catalogue port. Nothing in the implementation pushed back on
it: naming `archisimple:door-single-leaf-83` needed no new dependency, no new
port and no host coupling, and this repository still builds and tests alone with
its seven dependencies. The argument that _which standard door_ is the same kind
of architectural decision as _how wide a door is_ — which this stage already owns
— survived contact.

### The width change was the substantive half

`0.90 → 0.93` is what makes the identity mean anything. A 0.90 m opening
corresponds to no leaf in NF P20-101, so before this sprint the pipeline
specified a door nobody could order **and** named nothing. Either fix alone would
have been half a sprint.

`describeDefaults` now says _"Doors are a standard 83 leaf in a 930 mm × 2.1 m
opening"_, because a reviewer approving a Specification is approving a product,
and three numbers do not name one.

### The cross-repo seam is proven by a captured artefact, not by a claim

The two `SpecifiedOpening` types are independent mirrors and neither repository
imports the other, so nothing inside either one can prove they agree. A real
Specification from this pipeline was captured as
`archisimple/fixtures/geometry-specification/e-named-doors.json` — three
openings, all three naming the 83 at 0.93 m — and archisimple's reader and
translator are asserted against it there.

That fixture is the honest test of the seam, and it is the same practice the four
existing fixtures already follow: _what the reasoning layer actually sends, not
what a test author imagined it might._

### What did not change, deliberately

Windows are still unreachable (§8) — a Geometry Graph gap, not a naming one.
Passages still name nothing. `OPENING_KINDS` is unchanged. No `automation-api`
change was needed **here**; the host's half took one (`BuildPlanOpeningDto`,
contract 1.19.0), which its own sprint records.

### One pre-existing red test

`bug-011-constraint-evaluation.test.ts` › _"cannot name the second bedroom in a
constraint"_ fails, and did before this sprint — verified by stashing. It is
BUG-011's executable stop condition: two bedrooms are one `LayoutSpace` with
`count: 2`, so there is one id for both. Untouched by this work.
