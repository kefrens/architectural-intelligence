/**
 * "Show me the shadows on 21 December at 10" (Sprint 1.14; ArchiSimple 085.2).
 *
 * Plans one `automation.setSunSettings`: the project's sun on, off, or at a
 * moment (ArchiSimple ADR-0092 Rules 1–2). It moves nothing — the sun is the
 * project's study condition, not an element — so the proposal is `safe`, affects
 * no element, and highlights nothing. Being one allow-listed, safe Request, it is
 * what ArchiSimple ADR-0093 lets a user apply without asking; nothing here knows
 * that, and nothing needs to.
 *
 * ## A first moment
 *
 * The Request has no default moment and reads no clock, so turning the sun on
 * for the first time names both halves. ADR-0092 Rule 2 writes the convention
 * down once, and this follows it, as the host's `sun_show` does: the present by
 * `getSolarDay({ now })`'s suggested moment, or — when only a day was named —
 * that day's solar noon.
 */

import { PROPOSAL_RISKS } from '@archisimple/ai-engine';
import { setSunSettingsRequest, type SiteSunDto } from '@archisimple/automation-api';
import {
  ARCHITECTURAL_ACTIONS,
  type ArchitecturalIntent
} from '../../intent/architectural-intent.js';
import type { SunPhrase } from '../../intent/sun-phrases.js';
import type { BuildingKnowledge } from '../../understanding/building-knowledge.js';
import { namedDate } from '../../understanding/sun-question.js';
import type { ArchitecturalOperationProvider } from '../architectural-operation.js';
import { blocked, planned, PLAN_BLOCKER_REASONS, type PlanResult } from '../architectural-plan.js';

export const SET_SUN_OPERATION_ID = 'set-sun';

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

const pad = (value: number): string => String(value).padStart(2, '0');

/** `2027-12-21` → `21 December 2027`. */
function dateWords(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  return `${String(day)} ${MONTH_NAMES[(month ?? 1) - 1] ?? ''} ${String(year)}`;
}

interface Moment {
  readonly localDate?: string;
  readonly localTime?: string;
}

/** The moment the phrase names, halves only where named. */
function namedMoment(
  phrase: SunPhrase,
  knowledge: BuildingKnowledge,
  localDate: string | undefined
): Moment {
  const time = phrase.time;
  let localTime: string | undefined;
  if (time?.kind === 'clock') {
    localTime = `${pad(time.hour)}:${pad(time.minute)}`;
  } else if (time?.kind === 'solar-noon') {
    const day = knowledge.solarDay(localDate);
    localTime = day.available ? day.solarNoon.localTime : undefined;
  }
  return {
    ...(localDate === undefined ? {} : { localDate }),
    ...(localTime === undefined ? {} : { localTime })
  };
}

/** ADR-0092 Rule 2's first moment: fill the halves the user did not name. */
function firstMoment(named: Moment, knowledge: BuildingKnowledge): Moment {
  if (named.localDate !== undefined && named.localTime !== undefined) return named;
  if (named.localDate !== undefined) {
    const day = knowledge.solarDay(named.localDate);
    return day.available ? { ...named, localTime: day.solarNoon.localTime } : named;
  }
  const today = knowledge.solarDay();
  const suggested = today.available ? today.suggestedMoment : undefined;
  return {
    localDate: suggested?.localDate ?? (today.available ? today.localDate : undefined),
    localTime: named.localTime ?? suggested?.localTime
  } as Moment;
}

function momentWords(sun: { readonly localDate?: string; readonly localTime?: string }): string {
  const day = sun.localDate === undefined ? '' : ` on ${dateWords(sun.localDate)}`;
  const time = sun.localTime === undefined ? '' : ` at ${sun.localTime}`;
  return `${day}${time}`;
}

function currentWords(sun: SiteSunDto): string {
  return `${dateWords(sun.localDate)} at ${sun.localTime}`;
}

export function createSetSunOperationProvider(): ArchitecturalOperationProvider {
  return {
    id: SET_SUN_OPERATION_ID,
    actions: [ARCHITECTURAL_ACTIONS.setSun],

    plan(intent: ArchitecturalIntent, knowledge: BuildingKnowledge): PlanResult {
      const site = knowledge.site();
      if (site.anchor === undefined) {
        return blocked(
          PLAN_BLOCKER_REASONS.Unsupported,
          'This project has no place yet, so it has no sun to show.',
          ['Set the project’s address on the Site, then ask again.']
        );
      }

      const phrase = (intent.parameters['sun'] ?? {}) as SunPhrase;
      if (phrase.unreadable !== undefined) {
        return blocked(
          PLAN_BLOCKER_REASONS.MissingInformation,
          `I could not read “${phrase.unreadable}” as a day or a time.`,
          ['Name a day like “21 December” or “2027-12-21”, and a time like “at 10:30”.']
        );
      }

      const current = site.sun;
      if (intent.parameters['enabled'] === false) {
        if (current === undefined || !current.enabled) {
          return blocked(PLAN_BLOCKER_REASONS.NothingToDo, 'The sun is already off.');
        }
        return planned({
          intent,
          title: 'Turn the sun off',
          reasoning:
            'The sun is the project’s study condition, not part of the design: turning it off returns the 3D view to its usual light and moves nothing.',
          assumptions: [],
          expectedOutcome: `The 3D view returns to its usual light. The moment (${currentWords(current)}) is kept for when the sun is turned on again.`,
          steps: [
            {
              description: 'Turn the sun off.',
              request: setSunSettingsRequest({ enabled: false }),
              affects: []
            }
          ],
          risk: PROPOSAL_RISKS.Safe,
          warnings: []
        });
      }

      const named = namedMoment(phrase, knowledge, namedDate(phrase, site, knowledge).localDate);
      const nothingNamed = named.localDate === undefined && named.localTime === undefined;
      if (nothingNamed && current?.enabled === true) {
        return blocked(
          PLAN_BLOCKER_REASONS.NothingToDo,
          `The sun is already shown, at ${currentWords(current)}.`,
          ['Name a day or a time, like “at 10 on 21 December”.']
        );
      }

      // A sun that exists keeps what was not named; a first one needs both halves.
      const moment = current === undefined ? firstMoment(named, knowledge) : named;
      const assumptions: string[] = [];
      if (
        current === undefined &&
        moment.localDate !== undefined &&
        named.localDate === undefined
      ) {
        assumptions.push(`No day was named, so the sun starts on ${dateWords(moment.localDate)}.`);
      }
      if (
        current === undefined &&
        moment.localTime !== undefined &&
        named.localTime === undefined
      ) {
        assumptions.push(
          named.localDate === undefined
            ? `No time was named, so the sun starts at ${moment.localTime}, the present to the quarter hour (or solar noon at night).`
            : `No time was named, so the sun starts at that day’s solar noon, ${moment.localTime}.`
        );
      }
      if (phrase.time?.kind === 'clock') {
        assumptions.push(`The time is read as ${moment.localTime ?? ''}, on a 24-hour clock.`);
      }
      if (
        current === undefined &&
        (moment.localDate === undefined || moment.localTime === undefined)
      ) {
        return blocked(
          PLAN_BLOCKER_REASONS.MissingInformation,
          'I could not work out a moment for the sun.',
          ['Name a day and a time, like “at 10 on 21 December”.']
        );
      }

      const shown = { ...(current ?? {}), ...moment };
      const title = `Show the sun${momentWords(shown)}`;
      return planned({
        intent,
        title,
        reasoning:
          'The sun is the project’s study condition, not part of the design: it lights and shadows the 3D view for a moment in the site’s local time, and moves nothing.',
        assumptions,
        expectedOutcome: `The 3D view is lit${momentWords(shown)}. Shadows follow if **Shadows** is ticked in the Sun row — a view switch I can neither see nor set.`,
        steps: [
          {
            description: `${title}.`,
            request: setSunSettingsRequest({ enabled: true, ...moment }),
            affects: []
          }
        ],
        risk: PROPOSAL_RISKS.Safe,
        warnings: []
      });
    }
  };
}
