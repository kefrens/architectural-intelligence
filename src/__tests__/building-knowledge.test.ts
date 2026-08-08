/**
 * Building Knowledge and architectural questions (Sprint 24.5, Epic 2).
 *
 * Asserted against the real Building, Spatial and Inspector services (see
 * `harness.ts`), because the claim under test is precisely that these answers
 * come from the existing Building Platform rather than from anything this
 * package computes for itself.
 */

import { describe, expect, it } from 'vitest';
import { ARCHITECTURAL_ACTIONS, createIntent } from '../intent/architectural-intent.js';
import { ARCHITECTURAL_INTENT_KINDS, INTENT_TARGET_KINDS } from '../intent/architectural-intent.js';
import { answerArchitecturalQuestion } from '../understanding/architectural-question.js';
import { createHarness, WALLS } from './harness.js';

function ask(action: string, parameters: Record<string, unknown> = {}, selectedIds?: string[]) {
  const harness = createHarness(selectedIds === undefined ? {} : { selectedIds });
  const intent = createIntent({
    kind: ARCHITECTURAL_INTENT_KINDS.Question,
    action,
    utterance: 'test',
    parameters
  });
  return answerArchitecturalQuestion(intent, harness.knowledge);
}

describe('reading the building', () => {
  it('reports the rooms the Spatial Model detected, with their areas', () => {
    const answer = ask(ARCHITECTURAL_ACTIONS.roomCount);

    expect(answer?.facts['roomCount']).toBe(2);
    expect(answer?.text).toContain('Kitchen');
  });

  it('reports load-bearing walls from the document rather than from a copy of it', () => {
    const answer = ask(ARCHITECTURAL_ACTIONS.loadBearingWalls);

    expect(answer?.facts['loadBearingWallIds']).toEqual(['w-left', 'w-shared']);
    expect(answer?.facts['wallCount']).toBe(WALLS.length);
  });

  it('totals the floor area across every detected room', () => {
    const answer = ask(ARCHITECTURAL_ACTIONS.floorArea);

    expect(answer?.facts).toMatchObject({ totalArea: 32, roomCount: 2 });
  });

  it('answers about one named room when the question named one', () => {
    const answer = ask(ARCHITECTURAL_ACTIONS.floorArea, { subject: 'kitchen' });

    expect(answer?.facts).toMatchObject({ name: 'Kitchen', area: 16 });
  });

  it('reports adjacency through the shared wall (Story 24.5.5)', () => {
    const answer = ask(ARCHITECTURAL_ACTIONS.roomAdjacency, { subject: 'Kitchen' });

    expect(answer?.facts['adjacentRoomNames']).toEqual(['Room 2']);
  });

  it('summarises the whole project in Building Model terms', () => {
    const answer = ask(ARCHITECTURAL_ACTIONS.projectOverview);

    expect(answer?.facts).toMatchObject({
      projectName: 'Test House',
      floorCount: 1,
      wallCount: 7,
      loadBearingWallCount: 2,
      roomCount: 2,
      openingCount: 1
    });
  });

  it('describes the selection in the Building Model’s vocabulary, not the runtime’s', () => {
    const answer = ask(ARCHITECTURAL_ACTIONS.describeSelection, {}, ['w-left']);

    expect(answer?.facts).toMatchObject({
      count: 1,
      selected: [{ entityId: 'w-left', kind: 'Wall' }]
    });
  });
});

describe('questions it cannot answer (Story 24.5.11 applied to reads)', () => {
  it('says why window orientation is unavailable, and what to ask instead', () => {
    const answer = ask(ARCHITECTURAL_ACTIONS.openingOrientation, { compass: 'south' });

    expect(answer?.facts['openingCount']).toBe(1);
    expect(answer?.limitation?.message).toContain('hosts');
    expect(answer?.limitation?.suggestions.length).toBeGreaterThan(0);
  });

  it('says why natural light per room is unavailable', () => {
    const answer = ask(ARCHITECTURAL_ACTIONS.naturalLight);

    expect(answer?.limitation).toBeDefined();
    expect(answer?.facts).toMatchObject({ roomCount: 2, openingCount: 1 });
  });

  it('names the rooms that do exist when a question names one that does not', () => {
    const answer = ask(ARCHITECTURAL_ACTIONS.floorArea, { subject: 'ballroom' });

    expect(answer?.limitation?.suggestions.join(' ')).toContain('Kitchen');
  });

  it('returns undefined for an action it does not answer, rather than inventing one', () => {
    expect(ask(ARCHITECTURAL_ACTIONS.moveRoom)).toBeUndefined();
  });
});

describe('resolving what a request points at', () => {
  it('resolves a named room through the Spatial Model’s own names', () => {
    const harness = createHarness();

    const resolved = harness.knowledge.resolveTarget({
      kind: INTENT_TARGET_KINDS.Named,
      name: 'kitchen'
    });

    expect(resolved.rooms.map((room) => room.name)).toEqual(['Kitchen']);
  });

  it('reports a name that matched nothing rather than resolving to empty', () => {
    const harness = createHarness();

    const resolved = harness.knowledge.resolveTarget({
      kind: INTENT_TARGET_KINDS.Named,
      name: 'ballroom'
    });

    expect(resolved.unresolvedName).toBe('ballroom');
    expect(resolved.rooms).toEqual([]);
  });

  it('resolves a selection target through the Automation API’s selection query', () => {
    const harness = createHarness({ selectedIds: ['w-left', 'w-shared'] });

    const resolved = harness.knowledge.resolveTarget({ kind: INTENT_TARGET_KINDS.Selection });

    expect(resolved.walls.map((wall) => wall.id)).toEqual(['w-left', 'w-shared']);
    expect(resolved.entityIds).toEqual(['w-left', 'w-shared']);
  });

  it('exposes the Inspector’s editable properties with the bounds it validates against', () => {
    const harness = createHarness();
    const object = harness.knowledge.buildingObjectForEntity('w-left');

    const editable = harness.knowledge.editableProperties(object!.id);

    expect(editable.map((property) => property.key).sort()).toEqual([
      'height',
      'loadBearing',
      'thickness'
    ]);
    expect(
      editable.find((property) => property.key === 'thickness')?.descriptor.definition
    ).toMatchObject({ min: 0.01, max: 5 });
  });
});
