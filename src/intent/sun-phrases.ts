/**
 * The day and time a sun question names (Sprint 1.13, DEC-4).
 *
 * English only, like every answer this layer gives, and deliberately small:
 * the forms people type when they ask about the sun. It reads phrases; it does
 * not know where the project is, so "the winter solstice" stays a phrase here
 * and is resolved against the Site's hemisphere when the question is answered
 * (`understanding/sun-question.ts`).
 *
 * **It never guesses.** A day it recognises as a day but cannot make a date of
 * ("30 February") is reported as `unreadable`, and the answer says so. A time is
 * read as written, on a 24-hour clock, and the answer names the time it used.
 */

/** A reference day, named by month (as the platform keys them) or by season. */
export type SunReferencePhrase =
  | 'march-equinox'
  | 'june-solstice'
  | 'september-equinox'
  | 'december-solstice'
  | 'summer-solstice'
  | 'winter-solstice'
  | 'spring-equinox'
  | 'autumn-equinox';

export type SunDayPhrase =
  | { readonly kind: 'date'; readonly month: number; readonly day: number; readonly year?: number }
  | { readonly kind: 'reference'; readonly reference: SunReferencePhrase };

export type SunTimePhrase =
  | { readonly kind: 'clock'; readonly hour: number; readonly minute: number }
  | { readonly kind: 'solar-noon' };

export interface SunPhrase {
  readonly day?: SunDayPhrase;
  readonly time?: SunTimePhrase;
  /** Words that looked like a day or a time and could not be read as one. */
  readonly unreadable?: string;
}

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec'
] as const;
const MONTH =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORDINAL = '(\\d{1,2})(?:st|nd|rd|th)?';

const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const DAY_MONTH = new RegExp(`\\b${ORDINAL}\\s+(?:of\\s+)?${MONTH}\\.?(?:,?\\s+(\\d{4}))?\\b`, 'i');
const MONTH_DAY = new RegExp(`\\b${MONTH}\\.?\\s+${ORDINAL}(?:,?\\s+(\\d{4}))?\\b`, 'i');
const SLASH_DATE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/;
const SOLSTICE = /\b(june|december|summer|winter)\s+solstice\b/i;
const EQUINOX = /\b(march|september|spring|autumn|fall)\s+equinox\b/i;
/**
 * A clock time after "at" or "to" (Sprint 1.14: "move the sun to 17:30"). The
 * lookahead refuses a number that is a day — "set the sun to 21 December",
 * "to the 21st" — so "to" can be read without taking a date for a time.
 */
const CLOCK = new RegExp(
  `\\b(?:at|to)\\s+(\\d{1,2})(?:[:h.](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?(?![\\d/-]|(?:st|nd|rd|th)\\b|\\s*(?:of\\s+)?${MONTH})`,
  'i'
);
const SOLAR_NOON = /\b(?:solar\s+)?noon\b|\bmidday\b/i;

const monthNumber = (word: string): number =>
  MONTHS.indexOf(word.slice(0, 3).toLowerCase() as (typeof MONTHS)[number]) + 1;

/** Days in a month; February allows 29, the year is checked by the platform. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function dateOf(
  day: number,
  month: number,
  year: number | undefined,
  text: string
): { day?: SunDayPhrase; unreadable?: string } {
  if (month < 1 || month > 12 || day < 1 || day > (DAYS_IN_MONTH[month - 1] ?? 0)) {
    return { unreadable: text };
  }
  return { day: { kind: 'date', month, day, ...(year === undefined ? {} : { year }) } };
}

function readDay(utterance: string): { day?: SunDayPhrase; unreadable?: string } {
  const solstice = SOLSTICE.exec(utterance);
  if (solstice) {
    const word = (solstice[1] ?? '').toLowerCase();
    return { day: { kind: 'reference', reference: `${word}-solstice` as SunReferencePhrase } };
  }
  const equinox = EQUINOX.exec(utterance);
  if (equinox) {
    const word = (equinox[1] ?? '').toLowerCase();
    const season = word === 'fall' ? 'autumn' : word;
    return { day: { kind: 'reference', reference: `${season}-equinox` as SunReferencePhrase } };
  }
  const iso = ISO_DATE.exec(utterance);
  if (iso) {
    return dateOf(Number(iso[3]), Number(iso[2]), Number(iso[1]), iso[0]);
  }
  const dayMonth = DAY_MONTH.exec(utterance);
  if (dayMonth) {
    const year = dayMonth[3] === undefined ? undefined : Number(dayMonth[3]);
    return dateOf(Number(dayMonth[1]), monthNumber(dayMonth[2] ?? ''), year, dayMonth[0]);
  }
  const monthDay = MONTH_DAY.exec(utterance);
  if (monthDay) {
    const year = monthDay[3] === undefined ? undefined : Number(monthDay[3]);
    return dateOf(Number(monthDay[2]), monthNumber(monthDay[1] ?? ''), year, monthDay[0]);
  }
  const slash = SLASH_DATE.exec(utterance);
  if (slash) {
    // Day first, as the platform's first market writes it.
    const year = slash[3] === undefined ? undefined : Number(slash[3]);
    return dateOf(Number(slash[1]), Number(slash[2]), year, slash[0]);
  }
  return {};
}

function readTime(utterance: string): { time?: SunTimePhrase; unreadable?: string } {
  const clock = CLOCK.exec(utterance);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = clock[2] === undefined ? 0 : Number(clock[2]);
    const meridiem = clock[3]?.toLowerCase().replace(/\./g, '');
    if (meridiem !== undefined) {
      if (hour < 1 || hour > 12) return { unreadable: clock[0] };
      hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
    }
    if (hour > 23 || minute > 59) return { unreadable: clock[0] };
    return { time: { kind: 'clock', hour, minute } };
  }
  if (SOLAR_NOON.test(utterance)) {
    return { time: { kind: 'solar-noon' } };
  }
  return {};
}

/** The day and time a phrase names, as it names them. */
export function parseSunPhrase(utterance: string): SunPhrase {
  const day = readDay(utterance);
  const time = readTime(utterance);
  const unreadable = day.unreadable ?? time.unreadable;
  return {
    ...(day.day === undefined ? {} : { day: day.day }),
    ...(time.time === undefined ? {} : { time: time.time }),
    ...(unreadable === undefined ? {} : { unreadable })
  };
}
