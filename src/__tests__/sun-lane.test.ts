/**
 * The sun lane (Sprint 1.14; ArchiSimple 085.2).
 *
 * "Show me the shadows on 21 December at 10" becomes one `setSunSettings`, over
 * the platform's Queries as recorded DTOs (Grenoble, Europe/Paris). What is
 * asserted: which phrases reach the lane, the one Request each branch plans,
 * that it routes directly (never as a design), and that ArchiSimple ADR-0093's
 * predicate accepts the proposal it makes.
 */

import { describe, expect, it } from 'vitest';
import { isAutoApprovable } from '@archisimple/ai-engine';
import {
  SET_SUN_SETTINGS_REQUEST_TYPE,
  type GetSolarDayQuery,
  type SiteDto,
  type SolarDayDto,
  type SolarEventDto
} from '@archisimple/automation-api';
import { classifyRequest, REQUEST_LANES } from '../brief/request-classification.js';
import {
  ARCHITECTURAL_ACTIONS,
  ARCHITECTURAL_INTENT_KINDS
} from '../intent/architectural-intent.js';
import { recognizeIntent } from '../intent/intent-recognizer.js';
import { createSetSunOperationProvider } from '../planning/operations/set-sun-operation.js';
import { PLAN_BLOCKER_REASONS, type PlanResult } from '../planning/architectural-plan.js';
import { toProposal } from '../proposal/proposal-builder.js';
import { createHarness } from './harness.js';

const at = (localTime: string): SolarEventDto => ({ kind: 'at', instant: '', localTime });

function day(
  localDate: string,
  noon: string,
  suggested?: { localDate: string; localTime: string }
): SolarDayDto {
  return {
    available: true,
    timeZone: 'Europe/Paris',
    timeZoneApproximate: false,
    utcOffsetMinutes: 60,
    summerTime: false,
    localDate,
    sunrise: at('08:13'),
    solarNoon: { instant: `${localDate}T11:35:00.000Z`, localTime: noon, altitudeDegrees: 21.4 },
    sunset: at('16:57'),
    dayLengthMinutes: 524,
    path: [],
    referenceDays: [],
    ...(suggested === undefined ? {} : { suggestedMoment: suggested })
  };
}

const GRENOBLE: SiteDto = { anchor: { latitude: 45.19, longitude: 5.72 }, country: 'FR' };
const PRESENT = Date.UTC(2027, 5, 21, 12, 32);

/** Plans an utterance against a Grenoble whose sun is `sun`. */
function plan(
  utterance: string,
  sun?: SiteDto['sun']
): { result: PlanResult; asked: GetSolarDayQuery[] } {
  const asked: GetSolarDayQuery[] = [];
  const harness = createHarness({
    site: { ...GRENOBLE, ...(sun === undefined ? {} : { sun }) },
    now: () => PRESENT,
    solarDay: (query) => {
      asked.push(query);
      if (query.now !== undefined) {
        return day('2027-06-21', '13:39', { localDate: '2027-06-21', localTime: '14:30' });
      }
      if (query.localDate !== undefined) return day(query.localDate, '12:35');
      return sun === undefined
        ? { available: false, reason: 'no-moment' }
        : day(sun.localDate, '13:39');
    }
  });
  const intent = recognizeIntent(utterance);
  return { result: createSetSunOperationProvider().plan(intent, harness.knowledge), asked };
}

const requestOf = (result: PlanResult) => {
  if (!result.ok) throw new Error(`blocked: ${result.blocker.message}`);
  expect(result.plan.steps).toHaveLength(1);
  return result.plan.steps[0]!.request;
};

const ON: SiteDto['sun'] = { enabled: true, localDate: '2027-06-21', localTime: '14:30' };
const OFF: SiteDto['sun'] = { enabled: false, localDate: '2027-06-21', localTime: '14:30' };

describe('reaching the lane (DEC-1, criterion 5)', () => {
  it.each([
    'Show me the shadows on 21 December at 10',
    'Show the sun at 3 pm',
    'Set the sun to 21 December',
    'Move the sun to 10',
    'Put the sun at noon on the winter solstice',
    'Turn the sun on',
    'Turn off the sun',
    'Sun off',
    'Hide the sun'
  ])('"%s" is edit.setSun', (utterance) => {
    const intent = recognizeIntent(utterance);
    expect(intent.action).toBe(ARCHITECTURAL_ACTIONS.setSun);
    expect(intent.kind).toBe(ARCHITECTURAL_INTENT_KINDS.Modification);
  });

  it('leaves questions to 1.13, and rooms to their own rules', () => {
    expect(recognizeIntent('When does the sun set?').action).toBe(ARCHITECTURAL_ACTIONS.sun);
    expect(recognizeIntent('Is the sun on?').action).toBe(ARCHITECTURAL_ACTIONS.sun);
    expect(recognizeIntent('Move the kitchen 2 m north').action).not.toBe(
      ARCHITECTURAL_ACTIONS.setSun
    );
  });

  it('reads off as off, and everything else as on', () => {
    expect(recognizeIntent('Turn the sun off').parameters['enabled']).toBe(false);
    expect(recognizeIntent('Hide the sun').parameters['enabled']).toBe(false);
    expect(recognizeIntent('Show me the shadows').parameters['enabled']).toBe(true);
  });

  it('routes directly, never as a design — even naming the house (review 1)', () => {
    for (const utterance of [
      'Show me the shadows on 21 December at 10',
      'Show me the shadows on my house at 10'
    ]) {
      expect(classifyRequest(utterance).lane).toBe(REQUEST_LANES.DirectExecution);
    }
  });
});

describe('planning (DEC-2)', () => {
  it('a named moment: one safe setSunSettings with both halves (criterion 1)', () => {
    const { result } = plan('Show me the shadows on 21 December at 10', ON);
    expect(requestOf(result)).toEqual({
      type: SET_SUN_SETTINGS_REQUEST_TYPE,
      enabled: true,
      localDate: '2027-12-21',
      localTime: '10:00'
    });
    if (!result.ok) return;
    expect(result.plan.risk).toBe('safe');
    expect(result.plan.title).toBe('Show the sun on 21 December 2027 at 10:00');
    expect(result.plan.steps[0]!.affects).toEqual([]);
    expect(result.plan.expectedOutcome).toContain('**Shadows**');
  });

  it('an existing sun keeps what was not named', () => {
    const { result } = plan('Move the sun to 17:30', ON);
    expect(requestOf(result)).toEqual({
      type: SET_SUN_SETTINGS_REQUEST_TYPE,
      enabled: true,
      localTime: '17:30'
    });
  });

  it('off, and on alone for a sun that is off (criterion 2)', () => {
    expect(requestOf(plan('Turn the sun off', ON).result)).toEqual({
      type: SET_SUN_SETTINGS_REQUEST_TYPE,
      enabled: false
    });
    expect(requestOf(plan('Turn the sun on', OFF).result)).toEqual({
      type: SET_SUN_SETTINGS_REQUEST_TYPE,
      enabled: true
    });
  });

  it('a first sun with only a day takes that day’s solar noon (criterion 3; ADR-0092 Rule 2)', () => {
    const { result } = plan('Show me the shadows on 21 December');
    expect(requestOf(result)).toEqual({
      type: SET_SUN_SETTINGS_REQUEST_TYPE,
      enabled: true,
      localDate: '2027-12-21',
      localTime: '12:35'
    });
    if (result.ok) expect(result.plan.assumptions.join(' ')).toContain('solar noon, 12:35');
  });

  it('a first sun with nothing named takes the suggested moment for the present (criterion 3)', () => {
    const { result, asked } = plan('Show me the shadows');
    expect(asked.some((query) => query.now === '2027-06-21T12:32:00.000Z')).toBe(true);
    expect(requestOf(result)).toEqual({
      type: SET_SUN_SETTINGS_REQUEST_TYPE,
      enabled: true,
      localDate: '2027-06-21',
      localTime: '14:30'
    });
  });

  it('refuses honestly: nothing to do, no place, an unreadable day (criterion 4)', () => {
    const shown = plan('Show me the shadows', ON).result;
    expect(shown.ok ? undefined : shown.blocker.reason).toBe(PLAN_BLOCKER_REASONS.NothingToDo);
    expect(shown.ok ? '' : shown.blocker.message).toContain('21 June 2027 at 14:30');

    const off = plan('Turn the sun off', OFF).result;
    expect(off.ok ? undefined : off.blocker.reason).toBe(PLAN_BLOCKER_REASONS.NothingToDo);

    const nowhere = createSetSunOperationProvider().plan(
      recognizeIntent('Show me the shadows at 10'),
      createHarness().knowledge
    );
    expect(nowhere.ok ? undefined : nowhere.blocker.reason).toBe(PLAN_BLOCKER_REASONS.Unsupported);

    const bad = plan('Show me the shadows on 30 February', ON).result;
    expect(bad.ok ? undefined : bad.blocker.reason).toBe(PLAN_BLOCKER_REASONS.MissingInformation);
    expect(bad.ok ? '' : bad.blocker.message).toContain('“30 February”');
  });
});

describe('auto-apply (criterion 6)', () => {
  it('ADR-0093’s predicate accepts the proposal, with the host’s allow-list', () => {
    const { result } = plan('Show me the shadows on 21 December at 10', ON);
    if (!result.ok) throw new Error('expected a plan');
    const proposal = toProposal(result.plan);
    expect(isAutoApprovable(proposal, [SET_SUN_SETTINGS_REQUEST_TYPE])).toBe(true);
    expect(isAutoApprovable(proposal, [])).toBe(false);
  });
});
