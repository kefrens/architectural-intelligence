# Sprint 1.4 — Workflow State in Context

> **Status:** Completed — 2026-08-10 (release pending)
>
> **Version:** 1.1 — implemented; see _Implementation Notes_
>
> **Repository:** `architectural-intelligence`
>
> **Related ADRs:** ADR-AI-0002 (Rules 1, 3, 9, 11, 12 — gains revision 1.2), ADR-0027.1 (Rules 6, 8, 9), ADR-0023 Rule 1, ADR-0030 Rules 2 and 8
>
> **Predecessor:** Sprint 1.3 — Revision Lineage and Navigation
>
> **Origin:** [bug-001-E2E-findings.md](../bug/bug-001-E2E-findings.md), third broken boundary
>
> **Consumed by:** ArchiSimple Sprint 32.0, which **cannot complete until this sprint has published**

---

# Sprint Design Contract

The authoritative source is
[docs/architecture/00-current-state.md](../architecture/00-current-state.md).
Where this sprint conflicts with it, this sprint is wrong.

This sprint adds **fields to one existing context fragment** and publishes. It
adds no service, no registry, no lane, no tool, no artefact and no execution
path.

- [x] No second projection: the fields come from `workflowState()`, unchanged.
- [x] Nothing stored: the fragment is collected per turn, like every other.
- [x] No labels cross: stable identifiers only (Rule 9).
- [x] No prose is parsed: this sprint reads no model output whatsoever (Rule 6).

---

# Current State

`createArchitecturalContextProvider` contributes exactly four fields:

```text
editOperations · answerableQuestions · activeFloorId · floorCount
```

The first two say what the assistant _can do_; the last two say where geometry
goes. **None of them says where the design is.**

Meanwhile `workflowState()` has known since Sprint 1.2 which stage is current,
which artefacts are approved, which have gone stale and what may be asked for
next — and its only consumer is `classifyRequest`'s stage gates.

Fragments reach a model as structured data: `assembleContext` collects each
provider's fragment under its id and the prompt pipeline carries the assembled
object. So a field added here reaches the model with no change in `ai-engine` and
no change in any host.

---

# Why

Bug 001. A user walked the whole pipeline and the assistant narrated four stages
it never performed:

```text
ok for next step
→ "Great! Now let's generate the space programme based on your requirements:"
   … and nothing happened.
```

The primary cause of that run was a host wiring defect, and ArchiSimple Sprint
32.0 fixes it. But **this failure survives that fix**. Even with the artefact
reader wired, the model is told nothing about the pipeline's state: not that a
Brief was just approved, not that `planning_generateProgramme` has become
appropriate, not that four stages remain. A model with no state does what a model
with no state does — it narrates the plan it remembers and asks for confirmation.

The projection that answers all of this already exists. It has one consumer, and
the consumer that most needs it is not wired to it.

---

# Goal

The workflow state becomes the context fragment's fourth responsibility, so a
model knows where the design is before it decides what to say.

**Nothing else changes.** No new lane, no new tool, no change to what any tool
does, and no change to how anything is approved.

---

# What crosses, and what does not

## The fragment gains one nested object

A sketch; the exact field list is this sprint's.

```ts
export interface ArchitecturalContextFragment extends ContextFragment {
  readonly editOperations: readonly string[];
  readonly answerableQuestions: readonly string[];
  readonly activeFloorId: string | null;
  readonly floorCount: number;

  /** Where the design is (Sprint 1.4). Derived per turn; nothing is stored. */
  readonly design: {
    readonly currentStage: string | null;
    readonly complete: boolean;
    readonly stages: readonly {
      readonly stage: string;
      readonly artefact: string; // none | draft | approved
      readonly revision: number | null;
      readonly stale: boolean;
      readonly eligible: boolean;
      readonly blockedBecause: string | null; // a PlanBlocker message
    }[];
    /** The tool to call for the stage that is actionable now, or `null`. */
    readonly nextTool: string | null;
  };
}
```

## Why `nextTool` is worth the coupling

It is the field that actually closes Bug 001. Everything else describes a state
and leaves the model to infer the action; this names it.

The coupling it introduces is to **this package's own tool names**, which
`tools/index.ts` already owns — so the fragment names nothing it does not
already define. It is not a promise of availability: the host's broker still
checks each tool's `requires` against what the Automation MCP server serves, and
contributing a tool has never been the same as it being offered. A `nextTool`
naming a tool the host withheld is a tool the model simply will not have; that is
the pre-existing contract, not a new failure mode.

## What deliberately does not cross

- **Nothing about proposals or approval.** ADR-AI-0002 Rule 2 — this layer cannot
  observe them, and a fragment claiming otherwise would be inventing.
- **No labels.** `stage`, `artefact` and tool names are stable identifiers. The
  one exception is `blockedBecause`, which carries an existing `PlanBlocker`
  message — a sentence the platform already writes for the user, not a UI string
  invented here (Rule 9).
- **No instruction to the model.** The fragment reports state. Telling a model
  what it must do belongs to a system prompt, which is the host's.

---

# Epics

## Epic 1 — The fragment

### Story 1.4.1 — Collect the workflow state

`collect()` calls `intelligence.workflowState()` and maps it. One call per turn,
result discarded with the fragment (Rule 1 — nothing is cached here either).

### Story 1.4.2 — Flatten the stages

Five entries, in pipeline order, each carrying stage, artefact state, revision,
staleness, eligibility and the first blocker's message. Flat and JSON-serialisable
throughout: this crosses a process boundary as prompt text.

`revision` is `null` rather than absent when there is no approved artefact — a
model reads a present `null` more reliably than a missing key.

### Story 1.4.3 — `nextTool`

Derived from the same projection: the tool bound to `currentStage` when that
stage is eligible, `null` otherwise. One table, beside the stage table that
already exists — not a second opinion about pipeline order.

### Story 1.4.4 — Degradation

A host that wired no artefact reader gets a well-formed `design` object reporting
five untouched stages and `currentStage: 'brief'`. It does not throw and it does
not omit the key (Rule 11).

`nextTool` is **`planning_captureBrief`**, not `null` — the brief stage is always
eligible, because it derives from an utterance rather than from an artefact. The
1.0 draft said `null` here and was simply wrong about its own rule.

This is the exact configuration Bug 001 ran in, and the fragment should describe
it accurately rather than disguising it.

---

## Epic 2 — Verification

### Story 1.4.5 — The fragment reports each stage in turn

Walk the five-stage approval chain and assert `design.currentStage`,
`design.nextTool` and the per-stage entries after every approval. The harness
from `workflow-state.test.ts` already drives this; what is new is the fragment.

### Story 1.4.6 — Staleness is visible

After revising an approved Brief, assert the Programme entry reports
`stale: true`, the Layout entry reports `stale: true`, and `nextTool` points back
at the programme tool.

### Story 1.4.7 — Serialisable

Assert `JSON.parse(JSON.stringify(fragment))` is deep-equal to the fragment. It
crosses to a model as text; a field that does not survive that trip is a field
the model never sees.

### Story 1.4.8 — Nothing is stored

Extend the compliance scan: no production source holds the fragment or the
projection in a field (ADR-AI-0002 Rule 1, already asserted for `workflowState`).

---

## Epic 3 — Publish

### Story 1.4.9 — Version

Bump to **`0.2.0`**. The published package is still `0.1.1`, which predates
Sprints 1.2, 1.3 and this one — so the register currently offers none of the
workflow state, neither of the new lanes, and no revision path.

The API changed in all three sprints: new exports, a new `PLAN_BLOCKER_REASONS`
member, a widened port, and `generateSpecification`'s revision rule. A minor bump
on a `0.x` train is the right size and the release notes carry the detail.

### Story 1.4.10 — Release

Through `release.yml`. **No platform release is required**: the platform is at
`0.2.0` and nothing here needs more of it, so ADR-0030 Rule 8's ordering is
already satisfied — the platform released first, in ArchiSimple Sprint 31.0.

### Story 1.4.11 — Verify installable

A published version is not the same as an installable one. Confirm the register
serves it before ArchiSimple Sprint 32.0 points at it.

### Story 1.4.12 — Documentation

`00-current-state.{md,yaml}`, the README's context section, and **ADR-AI-0002
revision 1.2**: the projection has a second consumer, and the ownership table
gains a row saying the fragment reports state and never instructs.

---

# Out of Scope

| Not here                                   | Where                                     |
| ------------------------------------------ | ----------------------------------------- |
| The artefact reader wiring                 | ArchiSimple Sprint 32.0 — the primary fix |
| Any system-prompt change                   | The host's; this contributes a fragment   |
| Checking whether the model's prose is true | Forbidden — see below                     |
| The IA panel                               | An ArchiSimple UI sprint                  |
| Executing a Geometry Specification         | ArchiSimple Sprint 33.x, ADR-0031         |

## Why "prevent narration without a lane" is not a story

Bug 001's most tempting remedy is to stop the assistant claiming it did something
it did not do. This sprint deliberately does not attempt it.

Detecting an unbacked claim means **reading the model's prose and judging it**,
and ADR-0027.1 Rule 6 exists to keep exactly that out of this pipeline: the host
assembles artefacts, and nothing is parsed out of what a model said. A prose
checker would be a second, weaker classifier operating on output instead of
input, and its false positives would suppress correct answers.

The mechanism this sprint uses instead is the honest one: **make the true state
available so the right action is the easy one, and make the project's actual
contents visible to the user** — the second half being the IA panel, which is out
of scope here and named as a follow-up. A model that can see four stages
outstanding and a named tool to call has no reason to improvise; one that
improvises anyway is contradicted by a panel the user can read.

---

# Testing Strategy

- **Unit** — the mapping, per stage, including the degraded configuration.
- **Serialisation** — round-trip equality.
- **End to end** — the fragment across the five-stage chain and across a revision.
- **Compliance** — nothing stored, no `CommandDispatcher`, no new dependency.

---

# Definition of Done

## Architecture

- [x] The fragment is derived per turn and stored nowhere.
- [x] No second projection and no second stage table.
- [x] No proposal or approval state crosses.
- [x] Identifiers are stable strings; no UI labels.
- [x] No model output is read anywhere in this sprint.

## Implementation

- [x] `design` on the architectural fragment, with all five stages.
- [x] `nextTool` derived from the projection.
- [x] Degradation verified with no artefact reader.

## Verification

- [x] Five-stage fragment assertions.
- [x] Staleness visible after a revision.
- [x] JSON round-trip.
- [x] Build, lint, full suite pass.

## Release

- [ ] `0.2.0` published. **The publish itself is deliberate and manual.**
- [ ] Verified installable from the register.
- [x] Release notes name the 1.2, 1.3 and 1.4 API changes together.

## Documentation

- [x] `00-current-state.{md,yaml}` updated.
- [x] README context section updated.
- [x] ADR-AI-0002 revision 1.2.
- [x] Sprint marked Completed for implementation; the release gates remain open.

---

# Implementation Notes

## What shipped

All three epics except the publish itself, which is deliberate and manual. 610
tests across 14 files, `tsc -b` clean, `eslint .` clean.

| Story         | Landed as                                                                  |
| ------------- | -------------------------------------------------------------------------- |
| 1.4.1 – 1.4.4 | `design` on the architectural fragment; `describeDesign` beside it         |
| 1.4.3         | `src/tools/planning-tool-names.ts` — one table, keyed by `PLANNING_STAGES` |
| 1.4.5 – 1.4.7 | `src/__tests__/architectural-context.test.ts` (17)                         |
| 1.4.8         | Two more assertions in the compliance scan                                 |
| 1.4.9         | `0.2.0` in `package.json`                                                  |

## Where this reads differently from the plan

### The tool names had to be extracted first

Each name existed once, as a string literal inside its own function schema. A
second copy in a lookup table would have been two definitions of the same
string, and the one that drifts is always the one nobody calls. The five schemas
now read their name from `PLANNING_TOOL_NAMES`, so the table and the tools cannot
disagree — and the record is typed as total over `PlanningStage`, which makes a
sixth stage without a tool fail to compile.

### The degradation story contradicted its own rule

The 1.0 draft said a host with no artefact reader gets `nextTool: null`. It gets
`planning_captureBrief`: the brief stage is always eligible because it derives
from an utterance, not from an artefact. Corrected above, and the test asserts
the real answer — which is also the more useful one, since that configuration is
exactly the one Bug 001 ran in.

### The compliance assertion needed narrowing

The first version forbade any `readonly x: ArchitecturalDesignState`, which
caught `ArchitecturalContextFragment`'s own field — the fragment legitimately has
one, being the per-turn value itself. Narrowed to class fields and module
bindings, which is what holding one _between_ turns actually requires.

## Not done here

- **The publish.** `0.2.0` is staged in `package.json` and nothing is pushed to
  the register. A published version cannot be withdrawn, so it stays a deliberate
  act.
- Stories 1.4.10 and 1.4.11 remain open in the Definition of Done for that
  reason, and ArchiSimple Sprint 32.0's Story 32.0.7 cannot be verified until
  they close.

---

# Known Follow-Ups

**ArchiSimple Sprint 32.0** consumes this. It cannot complete until `0.2.0` is
installable, because its own acceptance includes a five-stage run through the
composed host — which needs both the reader wiring and this fragment.

**The IA panel** is the other half of the honest mechanism: a user who can see
"Programme — not started" while the assistant claims otherwise does not need the
platform to police prose. An ArchiSimple UI sprint.
