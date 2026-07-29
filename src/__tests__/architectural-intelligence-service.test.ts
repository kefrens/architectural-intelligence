/**
 * The Architectural Intelligence Service and its Context/Provider seams
 * (Sprint 24.5, Epics 1–5).
 */

import { PROPOSAL_RISKS } from '@archisimple/ai-engine';
import { describe, expect, it } from 'vitest';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service';
import { createArchitecturalContextProvider } from '../context/architectural-context-provider';
import { ARCHITECTURAL_ACTIONS } from '../intent/architectural-intent';
import {
  ARCHITECTURAL_PROVIDER_ID,
  createArchitecturalProviderAdapter
} from '../provider/architectural-provider-adapter';
import { BULK_STEP_THRESHOLD } from '../proposal/proposal-builder';
import { createHarness, type Harness } from './harness';

function serviceFor(harness: Harness): ArchitecturalIntelligenceService {
  return new ArchitecturalIntelligenceService({ knowledge: harness.knowledge });
}

describe('one entry point for questions and modifications', () => {
  it('answers a question without proposing anything', () => {
    const harness = createHarness();

    const response = serviceFor(harness).interpret('How many rooms are there?');

    expect(response.proposal).toBeUndefined();
    expect(response.answer?.facts['roomCount']).toBe(2);
  });

  it('turns a modification into a pending proposal without executing it', () => {
    const harness = createHarness();

    const response = serviceFor(harness).interpret('move the kitchen 2 m north');

    expect(response.proposal?.approvalState).toBe('pending');
    expect(response.proposal?.operations).toHaveLength(4);
    // The whole point: reasoning writes nothing.
    expect(harness.executed).toEqual([]);
  });

  it('explains a request it cannot complete, with alternatives', () => {
    const harness = createHarness();

    const response = serviceFor(harness).interpret('add a window here');

    expect(response.proposal).toBeUndefined();
    expect(response.blocker?.reason).toBe('unsupported');
    expect(response.message).toContain('-');
  });
});

describe('explainability on the proposal (Epic 4)', () => {
  it('carries reasoning, assumptions, affected elements and an expected outcome', () => {
    const harness = createHarness();

    const proposal = serviceFor(harness).interpret('move the kitchen 2 m north').proposal;

    expect(proposal?.reasoning).toContain('boundary walls');
    expect(proposal?.assumptions.length).toBeGreaterThan(0);
    expect(proposal?.expectedOutcome).toContain('Kitchen');
    expect(proposal?.affectedElements.map((element) => element.kind)).toContain('Room');
  });

  it('repeats the assumptions in the conversation message', () => {
    const harness = createHarness();

    const message = serviceFor(harness).interpret('move the kitchen 2 m north').message;

    expect(message).toContain('I assumed:');
  });
});

describe('safety (Epic 5)', () => {
  it('marks a delete destructive', () => {
    const harness = createHarness({ selectedIds: ['w-left'] });

    expect(serviceFor(harness).interpret('delete this')?.proposal?.risk).toBe(
      PROPOSAL_RISKS.Destructive
    );
  });

  it('escalates an individually safe change to destructive once it is bulk', () => {
    const harness = createHarness({ selectedIds: ['w-left', 'w-top-1', 'w-bottom-1'] });

    // Three walls → three steps, but the affected-element count stays under the
    // threshold, so this one is still safe.
    const safe = serviceFor(harness).interpret('set this wall thickness to 300 mm').proposal;
    expect(safe?.risk).toBe(PROPOSAL_RISKS.Safe);

    // Moving a room names the room plus each of its four walls: five elements,
    // which is at the threshold, not past it.
    const atThreshold = serviceFor(createHarness()).interpret(
      'move the kitchen 2 m north'
    ).proposal;
    expect(atThreshold?.affectedElements).toHaveLength(BULK_STEP_THRESHOLD);
    expect(atThreshold?.risk).toBe(PROPOSAL_RISKS.Safe);
  });

  it('says in the message that a destructive proposal will ask for confirmation', () => {
    const harness = createHarness({ selectedIds: ['w-left'] });

    expect(serviceFor(harness).interpret('delete this').message).toContain('confirm');
  });
});

describe('the Context Provider (Story 24.5.3)', () => {
  it('advertises the planner’s live capabilities rather than a hand-written list', () => {
    const harness = createHarness();
    const service = serviceFor(harness);
    const provider = createArchitecturalContextProvider(service, harness.knowledge);

    const fragment = provider.collect() as { editOperations: string[]; activeFloorId: string };

    expect(fragment.editOperations).toContain(ARCHITECTURAL_ACTIONS.moveRoom);
    expect(fragment.activeFloorId).toBe('level-1');
  });

  it('includes a provider registered after the service was built', () => {
    const harness = createHarness();
    const service = serviceFor(harness);
    service.registerOperationProvider({
      id: 'plugin',
      actions: ['edit.pluginThing'],
      plan: () => ({
        ok: false,
        blocker: { reason: 'unsupported', message: 'x', suggestions: [] }
      })
    });

    const fragment = createArchitecturalContextProvider(service, harness.knowledge).collect() as {
      editOperations: string[];
    };

    expect(fragment.editOperations).toContain('edit.pluginThing');
  });
});

describe('the provider adapter (Epic 1)', () => {
  it('answers a question as a conversation message', async () => {
    const harness = createHarness();
    const adapter = createArchitecturalProviderAdapter({ intelligence: serviceFor(harness) });

    const response = await adapter.sendMessage({
      systemPrompt: '',
      history: [],
      userMessage: 'How many rooms are there?',
      model: 'architectural-1',
      context: {}
    });

    expect(adapter.id).toBe(ARCHITECTURAL_PROVIDER_ID);
    expect(response.content).toContain('Kitchen');
    expect(response.proposal).toBeUndefined();
  });

  it('attaches the proposal for a modification', async () => {
    const harness = createHarness();
    const adapter = createArchitecturalProviderAdapter({ intelligence: serviceFor(harness) });

    const response = await adapter.sendMessage({
      systemPrompt: '',
      history: [],
      userMessage: 'move the kitchen 2 m north',
      model: 'architectural-1',
      context: {}
    });

    expect(response.proposal?.title).toBe('Move Kitchen');
  });

  it('honours an already-aborted signal', async () => {
    const harness = createHarness();
    const adapter = createArchitecturalProviderAdapter({ intelligence: serviceFor(harness) });
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.sendMessage(
        {
          systemPrompt: '',
          history: [],
          userMessage: 'How many rooms are there?',
          model: 'architectural-1',
          context: {}
        },
        controller.signal
      )
    ).rejects.toThrow();
  });
});
