/**
 * Planning and the built-in operations (Sprint 24.5, Epics 3, 4 and 5).
 *
 * Every case here goes through the real planner and the real Building Platform
 * (`harness.ts`), so what is asserted is the Automation Requests a plan would
 * actually run — never a mocked stand-in for them.
 */

import { describe, expect, it } from 'vitest';
import { recognizeIntent } from '../intent/intent-recognizer.js';
import { createIntent, ARCHITECTURAL_INTENT_KINDS } from '../intent/architectural-intent.js';
import { ArchitecturalPlanner } from '../planning/architectural-planner.js';
import { createBuiltInOperationProviders } from '../planning/operations/index.js';
import { PLAN_BLOCKER_REASONS, planned, type PlanResult } from '../planning/architectural-plan.js';
import { PROPOSAL_RISKS } from '@archisimple/ai-engine';
import { createHarness, type Harness } from './harness.js';

function planFor(utterance: string, harness: Harness): PlanResult {
  const planner = new ArchitecturalPlanner();
  for (const provider of createBuiltInOperationProviders()) {
    planner.registerProvider(provider);
  }
  return planner.plan(recognizeIntent(utterance), harness.knowledge);
}

function expectPlan(result: PlanResult) {
  if (!result.ok) {
    throw new Error(`Expected a plan, got blocker: ${result.blocker.message}`);
  }
  return result.plan;
}

function expectBlocker(result: PlanResult) {
  if (result.ok) {
    throw new Error(`Expected a blocker, got plan: ${result.plan.title}`);
  }
  return result.blocker;
}

describe('moving a room (Story 24.5.9 — one proposal, several operations)', () => {
  it('moves every boundary wall by the same delta', () => {
    const harness = createHarness();

    const plan = expectPlan(planFor('move the kitchen 2 m north', harness));

    expect(plan.steps).toHaveLength(4);
    expect(plan.steps.map((step) => step.request)).toEqual(
      ['w-left', 'w-bottom-1', 'w-shared', 'w-top-1'].map((entityId) => ({
        type: 'automation.moveEntity',
        entityId,
        delta: { x: 0, y: 2000 }
      }))
    );
  });

  it('names the room and its walls as affected elements (Story 24.5.8)', () => {
    const harness = createHarness();

    const plan = expectPlan(planFor('move the kitchen 2 m north', harness));

    expect(plan.steps[0]?.affects[0]).toMatchObject({ kind: 'Room', name: 'Kitchen' });
    expect(
      plan.steps.flatMap((step) => step.affects).filter((a) => a.kind === 'Wall')
    ).toHaveLength(4);
  });

  it('warns that a shared wall drags the adjacent room with it', () => {
    const harness = createHarness();

    const plan = expectPlan(planFor('move the kitchen 2 m north', harness));

    expect(plan.warnings.join(' ')).toContain('adjacent room');
  });

  it('asks for the distance rather than inventing one', () => {
    const harness = createHarness();

    const blocker = expectBlocker(planFor('move the kitchen', harness));

    expect(blocker.reason).toBe(PLAN_BLOCKER_REASONS.MissingInformation);
    expect(blocker.suggestions.join(' ')).toContain('2 m north');
  });

  it('offers the rooms that exist when the named one does not', () => {
    const harness = createHarness();

    const blocker = expectBlocker(planFor('move the ballroom 2 m north', harness));

    expect(blocker.reason).toBe(PLAN_BLOCKER_REASONS.Ambiguous);
    expect(blocker.suggestions.join(' ')).toContain('Kitchen');
  });
});

describe('renaming a room (Story 24.5.7)', () => {
  it('writes the name through the Automation API as a typed property', () => {
    const harness = createHarness({ selectedIds: ['surface-1'] });

    const plan = expectPlan(planFor('rename this room to Living Room', harness));

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.request).toEqual({
      type: 'automation.updateProperty',
      entityId: 'surface-1',
      key: 'name',
      value: { kind: 'string', value: 'Living Room' },
      label: 'Rename Room'
    });
  });

  it('warns that a detected room can lose its name when its walls change', () => {
    const harness = createHarness({ selectedIds: ['surface-1'] });

    expect(
      expectPlan(planFor('rename this room to Living Room', harness)).warnings.join(' ')
    ).toContain('detected');
  });

  it('asks which room when nothing is selected', () => {
    const harness = createHarness();

    const blocker = expectBlocker(planFor('rename this room to Living Room', harness));

    expect(blocker.reason).toBe(PLAN_BLOCKER_REASONS.Ambiguous);
  });
});

describe('changing a wall property (Story 24.5.7)', () => {
  it('routes through the Inspector’s own request rather than a second write path', () => {
    const harness = createHarness({ selectedIds: ['w-left'] });

    const plan = expectPlan(planFor('set this wall thickness to 300 mm', harness));

    expect(plan.steps[0]?.request).toMatchObject({
      type: 'inspector.setProperty',
      group: 'geometry',
      key: 'thickness',
      value: 0.3
    });
  });

  it('refuses a value outside the bounds the Inspector validates against', () => {
    const harness = createHarness({ selectedIds: ['w-left'] });

    const blocker = expectBlocker(planFor('set this wall thickness to 8 m', harness));

    expect(blocker.reason).toBe(PLAN_BLOCKER_REASONS.MissingInformation);
    expect(blocker.message).toContain('5');
  });

  it('asks for a wall when none is selected', () => {
    const harness = createHarness();

    expect(expectBlocker(planFor('set this wall thickness to 300 mm', harness)).reason).toBe(
      PLAN_BLOCKER_REASONS.Ambiguous
    );
  });
});

describe('aligning walls (Story 24.5.1)', () => {
  it('slides the odd wall out onto the mean axis and leaves the others alone', () => {
    const harness = createHarness({ selectedIds: ['w-left', 'w-shared'] });

    const plan = expectPlan(planFor('align these walls', harness));

    // Midpoints on X are 0 and 4000; the mean is 2000, so both move 2000 mm.
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps.map((step) => step.request)).toEqual([
      { type: 'automation.moveEntity', entityId: 'w-left', delta: { x: 2000, y: 0 } },
      { type: 'automation.moveEntity', entityId: 'w-shared', delta: { x: -2000, y: 0 } }
    ]);
  });

  it('says so rather than proposing nothing when the walls already line up', () => {
    const harness = createHarness({ selectedIds: ['w-top-1', 'w-bottom-1'] });

    // Both run horizontally, so the inferred axis is Y — where they differ.
    // Asking for X, on which their midpoints agree, is the no-op case.
    const planner = new ArchitecturalPlanner();
    for (const provider of createBuiltInOperationProviders()) {
      planner.registerProvider(provider);
    }
    const intent = recognizeIntent('align these walls vertically');

    const blocker = expectBlocker(planner.plan(intent, harness.knowledge));

    expect(blocker.reason).toBe(PLAN_BLOCKER_REASONS.NothingToDo);
  });

  it('needs at least two walls', () => {
    const harness = createHarness({ selectedIds: ['w-left'] });

    expect(expectBlocker(planFor('align these walls', harness)).reason).toBe(
      PLAN_BLOCKER_REASONS.Ambiguous
    );
  });
});

describe('deleting (Story 24.5.12)', () => {
  it('marks the plan destructive', () => {
    const harness = createHarness({ selectedIds: ['w-left'] });

    expect(expectPlan(planFor('delete this', harness)).risk).toBe(PROPOSAL_RISKS.Destructive);
  });

  it('warns that deleting a boundary wall destroys the room it encloses', () => {
    const harness = createHarness({ selectedIds: ['w-shared'] });

    const plan = expectPlan(planFor('delete this', harness));

    expect(plan.warnings.join(' ')).toContain('Kitchen');
  });

  it('asks what to delete when nothing is selected', () => {
    const harness = createHarness();

    expect(expectBlocker(planFor('delete this', harness)).reason).toBe(
      PLAN_BLOCKER_REASONS.Ambiguous
    );
  });
});

describe('what the platform cannot do (Story 24.5.11)', () => {
  it('explains why a room cannot be resized, and offers a real alternative', () => {
    const harness = createHarness({ selectedIds: ['surface-1'] });

    const blocker = expectBlocker(planFor('make this room larger', harness));

    expect(blocker.reason).toBe(PLAN_BLOCKER_REASONS.Unsupported);
    expect(blocker.message).toContain('Kitchen');
    expect(blocker.suggestions.join(' ')).toContain('move the north wall');
  });

  it('explains why an opening cannot be added', () => {
    const harness = createHarness();

    const blocker = expectBlocker(planFor('add a window here', harness));

    expect(blocker.reason).toBe(PLAN_BLOCKER_REASONS.Unsupported);
    expect(blocker.suggestions.length).toBeGreaterThan(0);
  });

  it('lists what it can plan when nothing recognises the request', () => {
    const harness = createHarness();

    const blocker = expectBlocker(planFor('paint the ceiling mauve', harness));

    expect(blocker.reason).toBe(PLAN_BLOCKER_REASONS.Unsupported);
    expect(blocker.suggestions.join(' ')).toContain('edit.moveRoom');
  });
});

describe('the planner as a registry', () => {
  const dummy = (id: string, actions: readonly string[]) => ({
    id,
    actions,
    plan: (): PlanResult =>
      planned({
        intent: createIntent({
          kind: ARCHITECTURAL_INTENT_KINDS.Modification,
          action: actions[0]!,
          utterance: ''
        }),
        title: 'x',
        reasoning: 'x',
        assumptions: [],
        expectedOutcome: 'x',
        steps: [],
        risk: PROPOSAL_RISKS.Safe,
        warnings: []
      })
  });

  it('refuses a duplicate provider id', () => {
    const planner = new ArchitecturalPlanner();
    planner.registerProvider(dummy('a', ['edit.one']));

    expect(() => planner.registerProvider(dummy('a', ['edit.two']))).toThrow(/Duplicate/);
  });

  it('refuses two providers claiming the same action', () => {
    const planner = new ArchitecturalPlanner();
    planner.registerProvider(dummy('a', ['edit.one']));

    expect(() => planner.registerProvider(dummy('b', ['edit.one']))).toThrow(/already provided/);
  });

  it('drops a provider’s actions when it is unregistered', () => {
    const planner = new ArchitecturalPlanner();
    planner.registerProvider(dummy('a', ['edit.one']));

    expect(planner.unregisterProvider('a')).toBe(true);
    expect(planner.capabilities()).toEqual([]);
  });

  it('isolates a provider that throws instead of failing the turn', () => {
    const harness = createHarness();
    const planner = new ArchitecturalPlanner();
    planner.registerProvider({
      id: 'broken',
      actions: ['edit.boom'],
      plan: () => {
        throw new Error('boom');
      }
    });

    const blocker = expectBlocker(
      planner.plan(
        createIntent({
          kind: ARCHITECTURAL_INTENT_KINDS.Modification,
          action: 'edit.boom',
          utterance: 'boom'
        }),
        harness.knowledge
      )
    );

    expect(blocker.message).toContain('boom');
  });
});
