/**
 * "When does the sun rise on 21 December?" (Sprint 1.13; ArchiSimple 085.1).
 *
 * The project's sun, answered from the platform's Queries — `getSite`,
 * `getSolarDay`, `getSunPosition` — through {@link BuildingKnowledge}. Every
 * number is the platform's (ArchiSimple ADR-0091 Rule 9: one sun); this module
 * picks which to read and says it in English.
 *
 * ## One answer shape
 *
 * The day (sunrise, solar noon and its height, sunset, length), the position
 * when a moment is known or named, and whether the 3D view shows the sun. A
 * question gets what it needs from that; there is no sub-lane per phrasing.
 *
 * ## Honest absences
 *
 * No place, no sun. An unreadable day is named, never guessed. And how much sun
 * a room gets is exposure, which nothing computes yet (ArchiSimple V2 phase D) —
 * said as a limitation rather than answered from the sun's position.
 */

import type {
  SiteDto,
  SolarDayDto,
  SolarEventDto,
  SunPositionDto
} from '@archisimple/automation-api';
import type { ArchitecturalIntent } from '../intent/architectural-intent.js';
import type { SunPhrase, SunReferencePhrase } from '../intent/sun-phrases.js';
import type { ArchitecturalAnswer } from './architectural-question.js';
import type { BuildingKnowledge } from './building-knowledge.js';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
] as const;

const COMPASS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west'
] as const;

const pad = (value: number): string => String(value).padStart(2, '0');

/** `2027-12-21` → `21 December 2027`. */
function dateWords(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  return `${String(day)} ${MONTH_NAMES[(month ?? 1) - 1] ?? ''} ${String(year)}`;
}

/** Degrees from true north → the eight-point word. */
const compassWord = (azimuth: number): string =>
  COMPASS[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8] ?? 'north';

const degrees = (value: number): string => `${String(Math.round(value))}°`;

function durationWords(minutes: number): string {
  return `${String(Math.floor(minutes / 60))}h ${pad(Math.round(minutes % 60))}m`;
}

const eventText = (event: SolarEventDto): string =>
  event.kind === 'at' ? event.localTime : event.reason;

/**
 * A season named by the user, as the platform keys it (by month), for this
 * hemisphere: June is winter in Sydney.
 */
function referenceKey(reference: SunReferencePhrase, latitude: number): string {
  const north = latitude >= 0;
  switch (reference) {
    case 'summer-solstice':
      return north ? 'june-solstice' : 'december-solstice';
    case 'winter-solstice':
      return north ? 'december-solstice' : 'june-solstice';
    case 'spring-equinox':
      return north ? 'march-equinox' : 'september-equinox';
    case 'autumn-equinox':
      return north ? 'september-equinox' : 'march-equinox';
    default:
      return reference;
  }
}

function limitation(
  text: string,
  message: string,
  suggestions: readonly string[]
): ArchitecturalAnswer {
  return { text, facts: {}, limitation: { message, suggestions } };
}

const NOT_LOCATED = limitation(
  'This project has no place yet, so it has no sun. Set its address on the Site first.',
  'The sun needs the project’s location: the Site has no anchor.',
  ['Set the project’s address on the Site, then ask again.']
);

/**
 * The local date a phrase names, or `undefined` for the project's own day.
 * Shared with Sprint 1.14's `set-sun` provider, so asking about a day and
 * setting the sun to it read the day one way.
 */
export function namedDate(
  phrase: SunPhrase,
  site: SiteDto,
  knowledge: BuildingKnowledge
): { localDate?: string; error?: ArchitecturalAnswer } {
  const day = phrase.day;
  if (day === undefined) return {};
  const momentYear = site.sun === undefined ? undefined : Number(site.sun.localDate.slice(0, 4));
  if (day.kind === 'date') {
    const year = day.year ?? momentYear ?? new Date(knowledge.presentInstant()).getUTCFullYear();
    return { localDate: `${String(year)}-${pad(day.month)}-${pad(day.day)}` };
  }
  // A reference day: the platform computes them per year (the December
  // solstice of 2027 is on the 22nd), so read the year's list rather than
  // assume a date.
  const year = knowledge.solarDay();
  if (!year.available) return {};
  const key = referenceKey(day.reference, site.anchor?.latitude ?? 0);
  const found = year.referenceDays.find((candidate) => candidate.season === key);
  return found === undefined ? {} : { localDate: found.localDate };
}

/** The sun at the moment the question names, or the project's, or now. */
function positionFor(
  phrase: SunPhrase,
  named: boolean,
  day: SolarDayDto & { readonly available: true },
  site: SiteDto,
  knowledge: BuildingKnowledge
): SunPositionDto | undefined {
  const time = phrase.time;
  if (time?.kind === 'clock') {
    return knowledge.sunAt({
      localDate: day.localDate,
      localTime: `${pad(time.hour)}:${pad(time.minute)}`
    });
  }
  if (time?.kind === 'solar-noon') {
    return knowledge.sunAt({ instant: day.solarNoon.instant });
  }
  if (named) return undefined; // a day with no time: the day's events answer it
  return site.sun === undefined
    ? knowledge.sunAt({ instant: knowledge.presentInstant() })
    : knowledge.sunAt();
}

function positionLine(position: SunPositionDto & { readonly available: true }): string {
  if (!position.aboveHorizon) {
    return `At ${position.localTime} the sun is below the horizon (${degrees(position.altitudeDegrees)}).`;
  }
  return `At ${position.localTime} the sun is ${degrees(position.altitudeDegrees)} high in the ${compassWord(position.azimuthDegrees)} (${degrees(position.azimuthDegrees)} from true north).`;
}

function dayLines(day: SolarDayDto & { readonly available: true }): string[] {
  const noon = `solar noon at **${day.solarNoon.localTime}**, ${degrees(day.solarNoon.altitudeDegrees)} high`;
  if (day.sunrise.kind === 'none' && day.sunrise.reason === 'polar-day') {
    return [`The sun does not set: it is up all day, with ${noon}.`];
  }
  if (day.sunrise.kind === 'none' && day.sunrise.reason === 'polar-night') {
    return ['The sun does not rise that day.'];
  }
  return [
    `The sun rises at **${eventText(day.sunrise)}** and sets at **${eventText(day.sunset)}**, with ${noon}.`,
    `The day is ${durationWords(day.dayLengthMinutes)} long.`
  ];
}

function shownLine(site: SiteDto): string {
  if (site.sun === undefined) {
    return 'The 3D view is not showing the sun: turn it on from the Site’s Sun row.';
  }
  if (!site.sun.enabled) {
    return 'The 3D view is not showing the sun: it is switched off.';
  }
  return `The 3D view shows the sun at ${dateWords(site.sun.localDate)}, ${site.sun.localTime}.`;
}

export function answerSunQuestion(
  intent: ArchitecturalIntent,
  knowledge: BuildingKnowledge
): ArchitecturalAnswer {
  const site = knowledge.site();
  if (site.anchor === undefined) return NOT_LOCATED;

  if (intent.parameters['exposure'] === true) {
    return limitation(
      'I cannot say yet how much sun a room gets. That is exposure — direct sun at each window, blocked by the building and the terrain — and it is not computed yet. I can tell you where the sun is and when it rises and sets.',
      'Exposure per room or window is not computed yet (ArchiSimple V2, phase D).',
      ['Ask when the sun rises or sets on a day.', 'Ask where the sun is at a time.']
    );
  }

  const phrase = (intent.parameters['sun'] ?? {}) as SunPhrase;
  if (phrase.unreadable !== undefined) {
    return limitation(
      `I could not read “${phrase.unreadable}” as a day or a time.`,
      `Unreadable day or time: ${phrase.unreadable}.`,
      ['Name a day like “21 December” or “2027-12-21”, and a time like “at 10:30”.']
    );
  }

  const { localDate } = namedDate(phrase, site, knowledge);
  const day = knowledge.solarDay(localDate);
  if (!day.available) {
    return day.reason === 'not-located'
      ? NOT_LOCATED
      : limitation(
          'The project’s sun has no day to answer for yet.',
          `The sun Query answered ${day.reason}.`,
          ['Name a day, like “21 December”.']
        );
  }

  const position = positionFor(phrase, localDate !== undefined, day, site, knowledge);
  const shownPosition = position?.available === true ? position : undefined;
  const zone = day.timeZoneApproximate
    ? 'approximate local time: no time zone is known for this country'
    : `local time, ${day.timeZone}`;

  const lines = [
    `On **${dateWords(day.localDate)}** (${zone}):`,
    '',
    ...dayLines(day),
    ...(shownPosition === undefined ? [] : [positionLine(shownPosition)]),
    '',
    shownLine(site)
  ];

  return {
    text: lines.join('\n'),
    facts: {
      localDate: day.localDate,
      timeZone: day.timeZone,
      timeZoneApproximate: day.timeZoneApproximate,
      sunrise: eventText(day.sunrise),
      solarNoon: day.solarNoon.localTime,
      noonAltitudeDegrees: day.solarNoon.altitudeDegrees,
      sunset: eventText(day.sunset),
      dayLengthMinutes: day.dayLengthMinutes,
      shown: site.sun?.enabled === true,
      ...(shownPosition === undefined
        ? {}
        : {
            position: {
              localTime: shownPosition.localTime,
              azimuthDegrees: shownPosition.azimuthDegrees,
              altitudeDegrees: shownPosition.altitudeDegrees,
              aboveHorizon: shownPosition.aboveHorizon
            }
          })
    }
  };
}
