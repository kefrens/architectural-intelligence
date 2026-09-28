/**
 * Sun questions (Sprint 1.13; ArchiSimple 085.1).
 *
 * The recogniser, the day reader and the answer, over the platform's Queries
 * as recorded DTOs: the values `@archisimple/solar` computes for Grenoble
 * (45.19° N, 5.72° E, Europe/Paris), Sydney and Tromsø. What is asserted is this
 * layer's part — which Query it asks, with what, and what it says — never the
 * astronomy, which is the platform's and tested there against JPL Horizons.
 */

import { describe, expect, it } from 'vitest';
import type {
  GetSolarDayQuery,
  GetSunPositionQuery,
  ReferenceDayDto,
  SiteDto,
  SolarDayDto,
  SolarEventDto,
  SunPositionDto
} from '@archisimple/automation-api';
import {
  ARCHITECTURAL_ACTIONS,
  ARCHITECTURAL_INTENT_KINDS
} from '../intent/architectural-intent.js';
import { recognizeIntent } from '../intent/intent-recognizer.js';
import { parseSunPhrase } from '../intent/sun-phrases.js';
import { answerArchitecturalQuestion } from '../understanding/architectural-question.js';
import { createHarness } from './harness.js';

// --- Recorded platform answers ----------------------------------------------

const at = (localTime: string): SolarEventDto => ({ kind: 'at', instant: '', localTime });

function day(
  localDate: string,
  rise: SolarEventDto,
  noon: [string, number],
  set: SolarEventDto,
  dayLengthMinutes: number,
  summerTime: boolean,
  referenceDays: readonly ReferenceDayDto[] = []
): SolarDayDto {
  return {
    available: true,
    timeZone: 'Europe/Paris',
    timeZoneApproximate: false,
    utcOffsetMinutes: summerTime ? 120 : 60,
    summerTime,
    localDate,
    sunrise: rise,
    solarNoon: {
      instant: `${localDate}T12:00:00.000Z`,
      localTime: noon[0],
      altitudeDegrees: noon[1]
    },
    sunset: set,
    dayLengthMinutes,
    path: [],
    referenceDays
  };
}

const reference = (season: ReferenceDayDto['season'], localDate: string): ReferenceDayDto => ({
  season,
  localDate,
  sunrise: at('00:00'),
  solarNoon: { instant: '', localTime: '12:00', altitudeDegrees: 0 },
  sunset: at('00:00'),
  dayLengthMinutes: 0
});

/** 2027's, as the platform computes them: the December solstice is the 22nd. */
const REFERENCE_DAYS_2027 = [
  reference('march-equinox', '2027-03-20'),
  reference('june-solstice', '2027-06-21'),
  reference('september-equinox', '2027-09-23'),
  reference('december-solstice', '2027-12-22')
];

const GRENOBLE_DAYS: Readonly<Record<string, SolarDayDto>> = {
  '2027-06-21': day(
    '2027-06-21',
    at('05:50'),
    ['13:39', 68.3],
    at('21:28'),
    938,
    true,
    REFERENCE_DAYS_2027
  ),
  '2027-12-21': day(
    '2027-12-21',
    at('08:13'),
    ['12:35', 21.4],
    at('16:57'),
    524,
    false,
    REFERENCE_DAYS_2027
  ),
  '2027-12-22': day(
    '2027-12-22',
    at('08:14'),
    ['12:35', 21.4],
    at('16:58'),
    524,
    false,
    REFERENCE_DAYS_2027
  )
};

const position = (
  localDate: string,
  localTime: string,
  azimuth: number,
  altitude: number,
  enabled = true
): SunPositionDto => ({
  available: true,
  timeZone: 'Europe/Paris',
  timeZoneApproximate: false,
  utcOffsetMinutes: 60,
  summerTime: false,
  enabled,
  azimuthDegrees: azimuth,
  altitudeDegrees: altitude,
  aboveHorizon: altitude > -0.833,
  direction: { x: 0, y: 0, z: 0 },
  bearingDegrees: azimuth,
  instant: '',
  localDate,
  localTime
});

const GRENOBLE: SiteDto = { anchor: { latitude: 45.19, longitude: 5.72 }, country: 'FR' };

/** A located Grenoble whose Queries answer from the recordings, and a log of what was asked. */
function grenoble(sun?: SiteDto['sun'], now = Date.UTC(2027, 5, 21, 12, 32)) {
  const asked: { day: GetSolarDayQuery[]; position: GetSunPositionQuery[] } = {
    day: [],
    position: []
  };
  const harness = createHarness({
    site: { ...GRENOBLE, ...(sun === undefined ? {} : { sun }) },
    now: () => now,
    solarDay: (query) => {
      asked.day.push(query);
      const date = query.localDate ?? sun?.localDate ?? '2027-06-21';
      if (query.localDate === undefined && query.now === undefined && sun === undefined) {
        return { available: false, reason: 'no-moment' };
      }
      return GRENOBLE_DAYS[date] ?? { available: false, reason: 'no-moment' };
    },
    sunPosition: (query) => {
      asked.position.push(query);
      if (query.localDate === '2027-12-21' && query.localTime === '10:00') {
        return position('2027-12-21', '10:00', 144, 13);
      }
      if (query.instant !== undefined)
        return position('2027-06-21', '14:32', 214, 64, sun?.enabled ?? false);
      return position(
        sun?.localDate ?? '2027-06-21',
        sun?.localTime ?? '14:30',
        214,
        64,
        sun?.enabled ?? false
      );
    }
  });
  const ask = (utterance: string) => {
    const intent = recognizeIntent(utterance);
    return { intent, answer: answerArchitecturalQuestion(intent, harness.knowledge) };
  };
  return { ask, asked };
}

// --- Recognition ------------------------------------------------------------

describe('recognising a sun question (DEC-3)', () => {
  it.each([
    'When does the sun rise on 21 December?',
    'What time is sunset?',
    'Where is the sun?',
    'How high is the sun at noon on the winter solstice?',
    'When is solar noon?',
    'How long is the day on 2027-06-21?',
    'When does the sun set?',
    'What time is the sun set to?',
    'Where do the shadows fall at 10?'
  ])('"%s" is question.sun', (utterance) => {
    const intent = recognizeIntent(utterance);
    expect(intent.action).toBe(ARCHITECTURAL_ACTIONS.sun);
    expect(intent.kind).toBe(ARCHITECTURAL_INTENT_KINDS.Question);
  });

  it('leaves daylight to naturalLight, and setting the sun to Sprint 1.14 (criterion 5)', () => {
    expect(recognizeIntent('Is there enough daylight in the kitchen?').action).toBe(
      ARCHITECTURAL_ACTIONS.naturalLight
    );
    expect(recognizeIntent('Show me the shadows at 10').action).not.toBe(ARCHITECTURAL_ACTIONS.sun);
    expect(recognizeIntent('Set the sun to 21 December at 10').action).not.toBe(
      ARCHITECTURAL_ACTIONS.sun
    );
    expect(recognizeIntent('Turn the sun on').action).not.toBe(ARCHITECTURAL_ACTIONS.sun);
  });

  it('marks a question about how much sun a room gets as exposure', () => {
    const intent = recognizeIntent('Does the kitchen get sunlight?');
    expect(intent.action).toBe(ARCHITECTURAL_ACTIONS.sun);
    expect(intent.parameters['exposure']).toBe(true);
    expect(recognizeIntent('When does the sun rise?').parameters['exposure']).toBe(false);
  });
});

describe('reading the day and time (DEC-4)', () => {
  it.each([
    ['on 21 December', { kind: 'date', month: 12, day: 21 }],
    ['on December 21st', { kind: 'date', month: 12, day: 21 }],
    ['on 21 Dec 2028', { kind: 'date', month: 12, day: 21, year: 2028 }],
    ['on 2027-12-21', { kind: 'date', month: 12, day: 21, year: 2027 }],
    ['on 21/12', { kind: 'date', month: 12, day: 21 }],
    ['at the June solstice', { kind: 'reference', reference: 'june-solstice' }],
    ['at the winter solstice', { kind: 'reference', reference: 'winter-solstice' }],
    ['on the autumn equinox', { kind: 'reference', reference: 'autumn-equinox' }],
    ['on the fall equinox', { kind: 'reference', reference: 'autumn-equinox' }]
  ])('"%s"', (text, expected) => {
    expect(parseSunPhrase(text).day).toEqual(expected);
  });

  it.each([
    ['at 10', { kind: 'clock', hour: 10, minute: 0 }],
    ['at 10:30', { kind: 'clock', hour: 10, minute: 30 }],
    ['at 3 pm', { kind: 'clock', hour: 15, minute: 0 }],
    ['at 12am', { kind: 'clock', hour: 0, minute: 0 }],
    ['at 3', { kind: 'clock', hour: 3, minute: 0 }],
    ['at noon', { kind: 'solar-noon' }]
  ])('"%s"', (text, expected) => {
    expect(parseSunPhrase(text).time).toEqual(expected);
  });

  it('reads "to" as a time, but not when a day follows it (Sprint 1.14)', () => {
    expect(parseSunPhrase('move the sun to 17:30').time).toEqual({
      kind: 'clock',
      hour: 17,
      minute: 30
    });
    const toADay = parseSunPhrase('set the sun to 21 December');
    expect(toADay.time).toBeUndefined();
    expect(toADay.day).toEqual({ kind: 'date', month: 12, day: 21 });
    expect(parseSunPhrase('set the sun to the 21st').time).toBeUndefined();
  });

  it('never guesses: an impossible day or time is unreadable', () => {
    expect(parseSunPhrase('on 30 February').unreadable).toBe('30 February');
    expect(parseSunPhrase('on 2027-02-30').unreadable).toBe('2027-02-30');
    expect(parseSunPhrase('at 25:00').unreadable).toBe('at 25:00');
    expect(parseSunPhrase('when does the sun rise')).toEqual({});
  });
});

// --- Answers ------------------------------------------------------------------

describe('answering (DEC-1, DEC-2, DEC-6)', () => {
  it('21 December in Grenoble: 08:13, from getSolarDay, with the facts (criterion 1)', () => {
    const { ask, asked } = grenoble({ enabled: true, localDate: '2027-06-21', localTime: '14:30' });
    const { answer } = ask('When does the sun rise on 21 December?');
    expect(asked.day).toContainEqual(expect.objectContaining({ localDate: '2027-12-21' }));
    expect(answer?.text).toContain('On **21 December 2027**');
    expect(answer?.text).toContain('rises at **08:13**');
    expect(answer?.text).toContain('sets at **16:57**');
    expect(answer?.facts).toMatchObject({
      localDate: '2027-12-21',
      sunrise: '08:13',
      solarNoon: '12:35',
      noonAltitudeDegrees: 21.4,
      sunset: '16:57',
      dayLengthMinutes: 524
    });
    // A day with no time: no position was asked for.
    expect(answer?.facts).not.toHaveProperty('position');
  });

  it('a named day without a year takes the project moment’s year', () => {
    const { ask, asked } = grenoble({ enabled: true, localDate: '2027-06-21', localTime: '14:30' });
    ask('When is sunset on 21 December?');
    expect(asked.day[0]?.localDate).toBe('2027-12-21');
  });

  it('a named day and time gives the position then (criterion 2’s named form)', () => {
    const { ask } = grenoble({ enabled: true, localDate: '2027-06-21', localTime: '14:30' });
    const { answer } = ask('Where is the sun at 10 on 21 December?');
    expect(answer?.text).toContain(
      'At 10:00 the sun is 13° high in the south-east (144° from true north).'
    );
  });

  it('"Where is the sun?" answers at the project’s moment, and says the view shows it (criterion 2)', () => {
    const { ask, asked } = grenoble({ enabled: true, localDate: '2027-06-21', localTime: '14:30' });
    const { answer } = ask('Where is the sun?');
    expect(asked.position).toContainEqual({ type: 'automation.getSunPosition' });
    expect(answer?.text).toContain('64° high in the south-west');
    expect(answer?.text).toContain('The 3D view shows the sun at 21 June 2027, 14:30.');
    expect(answer?.facts).toMatchObject({ shown: true });
  });

  it('with the sun off, it still answers, and says the view is not showing it (DEC-6)', () => {
    const { ask } = grenoble({ enabled: false, localDate: '2027-06-21', localTime: '14:30' });
    const { answer } = ask('Where is the sun?');
    expect(answer?.text).toContain('it is switched off');
    expect(answer?.facts).toMatchObject({ shown: false });
  });

  it('with no moment at all, it uses the present it was given (DEC-5)', () => {
    const { ask, asked } = grenoble(undefined);
    const { answer } = ask('Where is the sun?');
    expect(asked.day.some((query) => query.now === '2027-06-21T12:32:00.000Z')).toBe(true);
    expect(asked.position.some((query) => query.instant === '2027-06-21T12:32:00.000Z')).toBe(true);
    expect(answer?.text).toContain('turn it on from the Site’s Sun row');
  });

  it('the winter solstice is December’s in Grenoble and June’s in Sydney (criterion 3)', () => {
    const north = grenoble({ enabled: true, localDate: '2027-06-21', localTime: '14:30' });
    north.ask('How high is the sun at noon on the winter solstice?');
    expect(north.asked.day.map((query) => query.localDate)).toContain('2027-12-22');

    const asked: string[] = [];
    const sydney = createHarness({
      site: {
        anchor: { latitude: -33.87, longitude: 151.21 },
        sun: { enabled: true, localDate: '2027-06-21', localTime: '12:00' }
      },
      solarDay: (query) => {
        if (query.localDate !== undefined) asked.push(query.localDate);
        return GRENOBLE_DAYS[query.localDate ?? '2027-06-21'] ?? GRENOBLE_DAYS['2027-06-21']!;
      },
      sunPosition: () => position('2027-06-21', '12:00', 0, 32)
    });
    answerArchitecturalQuestion(
      recognizeIntent('When is sunrise on the winter solstice?'),
      sydney.knowledge
    );
    expect(asked).toContain('2027-06-21');
  });

  it('Tromsø: the sun does not set in June, and does not rise in December (criterion 4)', () => {
    const polar = (reason: 'polar-day' | 'polar-night'): SolarEventDto => ({
      kind: 'none',
      reason
    });
    const tromso = createHarness({
      site: {
        anchor: { latitude: 69.65, longitude: 18.96 },
        sun: { enabled: true, localDate: '2027-06-21', localTime: '12:00' }
      },
      solarDay: (query) =>
        query.localDate === '2027-12-21'
          ? day('2027-12-21', polar('polar-night'), ['11:40', -3], polar('polar-night'), 0, false)
          : day('2027-06-21', polar('polar-day'), ['12:44', 46.8], polar('polar-day'), 1440, true),
      sunPosition: () => position('2027-06-21', '12:00', 180, 46)
    });
    const june = answerArchitecturalQuestion(
      recognizeIntent('When does the sun set on 21 June?'),
      tromso.knowledge
    );
    expect(june?.text).toContain('The sun does not set');
    const december = answerArchitecturalQuestion(
      recognizeIntent('When does the sun rise on 21 December?'),
      tromso.knowledge
    );
    expect(december?.text).toContain('The sun does not rise that day.');
    expect(december?.facts).toMatchObject({ sunrise: 'polar-night' });
  });

  it('no place: the limitation, and no sun Query asked (criterion 6)', () => {
    const harness = createHarness();
    const answer = answerArchitecturalQuestion(
      recognizeIntent('When does the sun rise?'),
      harness.knowledge
    );
    expect(answer?.text).toContain('no place yet');
    expect(answer?.limitation).toBeDefined();
  });

  it('an unreadable day is named, not guessed (criterion 6)', () => {
    const { ask, asked } = grenoble({ enabled: true, localDate: '2027-06-21', localTime: '14:30' });
    const { answer } = ask('When does the sun rise on 30 February?');
    expect(answer?.text).toContain('“30 February”');
    expect(answer?.limitation).toBeDefined();
    expect(asked.day).toHaveLength(0);
  });

  it('how much sun a room gets is exposure, not yet computed (criterion 5)', () => {
    const { ask, asked } = grenoble({ enabled: true, localDate: '2027-06-21', localTime: '14:30' });
    const { answer } = ask('Does the kitchen get sunlight?');
    expect(answer?.text).toContain('exposure');
    expect(answer?.limitation?.message).toContain('phase D');
    expect(asked.day).toHaveLength(0);
  });
});
