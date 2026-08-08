/**
 * The whole pipeline, end to end (Sprint 24.5, Testing § Integration Tests).
 *
 * ```text
 * User Request -> AI Workspace -> Architectural Intelligence
 *              -> Building Platform -> Automation Platform
 *              -> Proposal Workflow -> Runtime
 * ```
 *
 * Driven through the *real* `AiSessionController`, so what is asserted is the
 * thing the sprint actually claims: that this layer introduces no execution
 * model of its own. Nothing is dispatched until a user approves, everything
 * dispatched goes through the `CommandDispatcher` the Workspace already used,
 * and a destructive proposal does not move until it is confirmed.
 *
 * The Runtime end of the chain is a recording dispatcher rather than a real
 * document: `automation-api`'s own suite already proves a Request reaches the
 * document, and what is under test here is which Requests arrive and when.
 */

import {
  AiSessionController,
  EMPTY_AI_WORKSPACE_DATA,
  type AiWorkspaceProjectData,
  type AiWorkspaceStore
} from '@archisimple/ai-engine';
import type { CommandDispatcher, CommandRequest } from '@archisimple/automation-api';
import { beforeEach, describe, expect, it } from 'vitest';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import { createArchitecturalProviderAdapter } from '../provider/architectural-provider-adapter.js';
import { createHarness, type Harness } from './harness.js';

function memoryStore(): AiWorkspaceStore {
  const values = new Map<string, AiWorkspaceProjectData>();
  return {
    load: (projectId) => values.get(projectId) ?? EMPTY_AI_WORKSPACE_DATA,
    save: (projectId, data) => {
      values.set(projectId, data);
    }
  };
}

interface Pipeline {
  readonly session: AiSessionController;
  readonly dispatched: CommandRequest<unknown>[];
  readonly harness: Harness;
}

function createPipeline(harnessOptions: Parameters<typeof createHarness>[0] = {}): Pipeline {
  const harness = createHarness(harnessOptions);
  const dispatched: CommandRequest<unknown>[] = [];
  const commands = {
    execute: (<TResult>(request: CommandRequest<TResult>): TResult => {
      dispatched.push(request as CommandRequest<unknown>);
      return true as unknown as TResult;
    }) as CommandDispatcher['execute'],
    register: () => undefined,
    unregister: () => false,
    canHandle: () => true,
    registeredTypes: () => [],
    canUndo: () => false,
    canRedo: () => false,
    undo: () => undefined,
    redo: () => undefined,
    clearHistory: () => undefined
  } satisfies CommandDispatcher;

  const intelligence = new ArchitecturalIntelligenceService({ knowledge: harness.knowledge });
  const session = new AiSessionController({
    projectId: 'project-1',
    store: memoryStore(),
    providers: [createArchitecturalProviderAdapter({ intelligence })],
    queries: harness.queries,
    commands
  });

  return { session, dispatched, harness };
}

describe('a question turn', () => {
  it('reaches the conversation and writes nothing', async () => {
    const pipeline = createPipeline();

    const { reply } = await pipeline.session.sendMessage('How many rooms are there?');

    expect(reply.content).toContain('Kitchen');
    expect(reply.proposal).toBeUndefined();
    expect(pipeline.dispatched).toEqual([]);
  });
});

describe('a modification turn', () => {
  let pipeline: Pipeline;

  beforeEach(() => {
    pipeline = createPipeline();
  });

  it('proposes without executing', async () => {
    const { reply } = await pipeline.session.sendMessage('move the kitchen 2 m north');

    expect(reply.proposal?.approvalState).toBe('pending');
    expect(pipeline.dispatched).toEqual([]);
  });

  it('executes every operation through the Automation API on approval', async () => {
    const { reply } = await pipeline.session.sendMessage('move the kitchen 2 m north');

    expect(pipeline.session.approveProposal(reply.id)).toBe(true);

    expect(pipeline.dispatched.map((request) => request.type)).toEqual([
      'automation.moveEntity',
      'automation.moveEntity',
      'automation.moveEntity',
      'automation.moveEntity'
    ]);
  });

  it('records the outcome on the stored proposal', async () => {
    const { reply } = await pipeline.session.sendMessage('move the kitchen 2 m north');
    pipeline.session.approveProposal(reply.id);

    const stored = pipeline.session.activeConversation()?.messages.at(-1)?.proposal;

    expect(stored?.approvalState).toBe('approved');
    expect(stored?.executionResult?.success).toBe(true);
  });

  it('executes nothing when the proposal is rejected', async () => {
    const { reply } = await pipeline.session.sendMessage('move the kitchen 2 m north');

    pipeline.session.rejectProposal(reply.id);

    expect(pipeline.dispatched).toEqual([]);
    expect(pipeline.session.activeConversation()?.messages.at(-1)?.proposal?.approvalState).toBe(
      'rejected'
    );
  });
});

describe('a destructive turn (Story 24.5.12)', () => {
  it('refuses to execute without an explicit confirmation', async () => {
    const pipeline = createPipeline({ selectedIds: ['w-left'] });
    const { reply } = await pipeline.session.sendMessage('delete this');

    expect(pipeline.session.approveProposal(reply.id)).toBe(false);

    expect(pipeline.dispatched).toEqual([]);
    expect(pipeline.session.activeConversation()?.messages.at(-1)?.proposal?.approvalState).toBe(
      'pending'
    );
  });

  it('executes once confirmed', async () => {
    const pipeline = createPipeline({ selectedIds: ['w-left'] });
    const { reply } = await pipeline.session.sendMessage('delete this');

    expect(pipeline.session.approveProposal(reply.id, { confirmed: true })).toBe(true);

    expect(pipeline.dispatched).toEqual([{ type: 'automation.deleteEntity', entityId: 'w-left' }]);
  });
});

describe('a rename turn, all the way to the Building Model', () => {
  it('proposes the property write the room DTO reads a name back from', async () => {
    const pipeline = createPipeline({ selectedIds: ['surface-2'] });

    const { reply } = await pipeline.session.sendMessage('rename this room to Study');
    pipeline.session.approveProposal(reply.id);

    expect(pipeline.dispatched).toEqual([
      {
        type: 'automation.updateProperty',
        entityId: 'surface-2',
        key: 'name',
        value: { kind: 'string', value: 'Study' },
        label: 'Rename Room'
      }
    ]);
  });
});
