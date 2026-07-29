/**
 * Intent recognition (Sprint 24.5, Story 24.5.1 and 24.5.2).
 *
 * The five phrasings the sprint's acceptance criteria names verbatim are
 * asserted first and by name, so a regression in any one of them is reported as
 * the acceptance criterion it breaks rather than as an anonymous pattern.
 */

import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURAL_ACTIONS,
  ARCHITECTURAL_INTENT_KINDS,
  INTENT_TARGET_KINDS
} from '../intent/architectural-intent';
import { recognizeIntent } from '../intent/intent-recognizer';

describe('the requests Story 24.5.1 names', () => {
  it('reads "Move the kitchen" as a move naming the kitchen', () => {
    const intent = recognizeIntent('Move the kitchen');

    expect(intent.action).toBe(ARCHITECTURAL_ACTIONS.moveRoom);
    expect(intent.target).toEqual({ kind: INTENT_TARGET_KINDS.Named, name: 'kitchen' });
  });

  it('reads "Make this room larger" as a resize of the selection', () => {
    const intent = recognizeIntent('Make this room larger');

    expect(intent.action).toBe(ARCHITECTURAL_ACTIONS.resizeRoom);
    expect(intent.target.kind).toBe(INTENT_TARGET_KINDS.Selection);
  });

  it('reads "Add a window here" as adding an opening', () => {
    const intent = recognizeIntent('Add a window here');

    expect(intent.action).toBe(ARCHITECTURAL_ACTIONS.addOpening);
    expect(intent.parameters['openingType']).toBe('window');
  });

  it('reads "Rename this room to Kitchen" as a rename carrying the new name', () => {
    const intent = recognizeIntent('Rename this room to Kitchen');

    expect(intent.action).toBe(ARCHITECTURAL_ACTIONS.renameRoom);
    expect(intent.kind).toBe(ARCHITECTURAL_INTENT_KINDS.Modification);
    expect(intent.parameters['newName']).toBe('Kitchen');
    expect(intent.target.kind).toBe(INTENT_TARGET_KINDS.Selection);
  });

  it('reads "Align these walls" as aligning the selected walls', () => {
    const intent = recognizeIntent('Align these walls');

    expect(intent.action).toBe(ARCHITECTURAL_ACTIONS.alignWalls);
    expect(intent.target).toEqual({
      kind: INTENT_TARGET_KINDS.Selection,
      objectKind: 'Wall'
    });
  });
});

describe('the questions Story 24.5.4 names', () => {
  it.each([
    ['How many rooms are there?', ARCHITECTURAL_ACTIONS.roomCount],
    ['Which walls are load-bearing?', ARCHITECTURAL_ACTIONS.loadBearingWalls],
    ['What is the floor area?', ARCHITECTURAL_ACTIONS.floorArea],
    ['Which windows face south?', ARCHITECTURAL_ACTIONS.openingOrientation],
    ['Which rooms have no natural light?', ARCHITECTURAL_ACTIONS.naturalLight]
  ])('reads %s as a question', (utterance, action) => {
    const intent = recognizeIntent(utterance);

    expect(intent.kind).toBe(ARCHITECTURAL_INTENT_KINDS.Question);
    expect(intent.action).toBe(action);
  });
});

describe('parameters', () => {
  it('normalises a distance and a compass direction into a world-space delta', () => {
    const intent = recognizeIntent('move the kitchen 2 m north');

    expect(intent.kind).toBe(ARCHITECTURAL_INTENT_KINDS.Modification);
    expect(intent.parameters).toMatchObject({ deltaX: 0, deltaY: 2000 });
  });

  it.each([
    ['500 mm east', { deltaX: 500, deltaY: 0 }],
    ['30 cm west', { deltaX: -300, deltaY: 0 }],
    ['1.5 metres south', { deltaX: 0, deltaY: -1500 }]
  ])('converts "%s" to millimetres', (phrase, expected) => {
    expect(recognizeIntent(`move the kitchen ${phrase}`).parameters).toMatchObject(expected);
  });

  it('converts a wall thickness back to metres, the unit the Inspector uses', () => {
    const intent = recognizeIntent('set this wall thickness to 300 mm');

    expect(intent.parameters).toMatchObject({ property: 'thickness', value: 0.3 });
  });

  it('reads a negated load-bearing request as false', () => {
    expect(recognizeIntent('make this wall not load-bearing').parameters).toMatchObject({
      property: 'loadBearing',
      value: false
    });
  });

  it('strips quotes a user typed around a new name', () => {
    expect(recognizeIntent('rename this room to "Living Room"').parameters['newName']).toBe(
      'Living Room'
    );
  });
});

describe('what it refuses to guess', () => {
  it('makes a move with no distance ambiguous rather than inventing one', () => {
    const intent = recognizeIntent('Move the kitchen');

    expect(intent.kind).toBe(ARCHITECTURAL_INTENT_KINDS.Ambiguous);
    expect(intent.parameters['missing']).toEqual(['deltaX', 'deltaY']);
  });

  it('makes a rename with no new name ambiguous', () => {
    const intent = recognizeIntent('rename this room');

    expect(intent.kind).toBe(ARCHITECTURAL_INTENT_KINDS.Ambiguous);
    expect(intent.parameters['missing']).toEqual(['newName']);
  });

  it('makes "make this wall thicker" ambiguous — a comparative is not a value', () => {
    const intent = recognizeIntent('make this wall thicker');

    expect(intent.kind).toBe(ARCHITECTURAL_INTENT_KINDS.Ambiguous);
    expect(intent.parameters).toMatchObject({ property: 'thickness' });
    expect(intent.parameters['missing']).toEqual(['value']);
  });

  it('answers Unknown for a phrase it cannot place, rather than throwing', () => {
    const intent = recognizeIntent('what is the weather like');

    expect(intent.kind).toBe(ARCHITECTURAL_INTENT_KINDS.Unknown);
    expect(intent.action).toBe('unknown');
  });
});

describe('targets', () => {
  it('does not mistake a kind word for a name', () => {
    expect(recognizeIntent('move the room 1 m north').target.kind).toBe(INTENT_TARGET_KINDS.None);
  });

  it('keeps the user’s own words for a named target rather than resolving them', () => {
    expect(recognizeIntent('move the master bedroom 1 m north').target).toMatchObject({
      kind: INTENT_TARGET_KINDS.Named,
      name: 'master bedroom'
    });
  });

  it('preserves the utterance verbatim so an explanation can quote it', () => {
    expect(recognizeIntent('  Delete this  ').utterance).toBe('Delete this');
  });
});
