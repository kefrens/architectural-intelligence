/**
 * Which brief topics name a space, and which space (Bug 007).
 *
 * A user can say "a home office" two ways — as the `office` topic, or as a space
 * called "home office" — and before this table the two halves of the platform
 * answered differently. `brief-assembly.ts` read only requirements, so a Brief
 * that listed the space and omitted the flag defaulted the flag to **false** and
 * printed "No home office, since none was mentioned" underneath the office it had
 * just recorded. `programme-synthesis.ts` held its own literal map of the same
 * relationship, used for something else entirely (priority), so nothing forced
 * the two to agree.
 *
 * One table, read by both. A topic and a space are the same statement in two
 * vocabularies, and this is where that is written down once.
 *
 * ## Why a role pattern rather than a name
 *
 * Because a user names the room, not the topic. "study", "home office" and
 * "workspace" are one thing; `garage` and `carport` are one thing. Matching on
 * the canonical name alone would recognise exactly the spelling this platform
 * happens to prefer, which is the failure Bug 003 already fixed for implied
 * spaces and is fixed here for the same reason.
 *
 * The patterns are unanchored but demand whole words, so "bedroom" does not make
 * a "bedroom cupboard" a bedroom.
 */

import { BRIEF_TOPICS, type DesiredSpace } from './architectural-brief.js';

export interface TopicSpace {
  /** A {@link BRIEF_TOPICS} value. */
  readonly topic: string;
  /** The name this platform gives the space when it has to create one. */
  readonly space: string;
  /** Any name that fills the same role. */
  readonly role: RegExp;
  /**
   * Whether the topic is a yes/no.
   *
   * Only a boolean topic can be *stated by naming its space*: a "bedroom" in the
   * space list says a bedroom exists, it does not say how many, and the count is
   * the requirement's whole content. So the two counted entries are here for the
   * Programme's benefit — which topic a space belongs to — and never for
   * {@link spaceStatedTopics}.
   */
  readonly boolean: boolean;
}

export const TOPIC_SPACES: readonly TopicSpace[] = [
  {
    topic: BRIEF_TOPICS.Bedrooms,
    space: 'bedroom',
    role: /\bbed\s?rooms?\b/i,
    boolean: false
  },
  {
    topic: BRIEF_TOPICS.Bathrooms,
    space: 'bathroom',
    role: /\b(?:bath\s?rooms?|shower\s?rooms?|en.?suites?)\b/i,
    boolean: false
  },
  {
    topic: BRIEF_TOPICS.Garage,
    space: 'garage',
    role: /\b(?:garages?|carports?)\b/i,
    boolean: true
  },
  {
    // A bare "office" fills the role too. It is what a model calls the space
    // when the user said "a small office", and a pattern that demanded "home"
    // would have created a second, separate home office beside it.
    topic: BRIEF_TOPICS.Office,
    space: 'home office',
    role: /\b(?:(?:home\s?)?offices?|stud(?:y|ies)|workspaces?)\b/i,
    boolean: true
  }
];

/** The entry for a topic, or `undefined` when no space corresponds to it. */
export function topicSpaceFor(topic: string): TopicSpace | undefined {
  return TOPIC_SPACES.find((entry) => entry.topic === topic);
}

/** The topic a space name belongs to, by role. `undefined` for a space no topic covers. */
export function topicForSpaceName(name: string): string | undefined {
  return TOPIC_SPACES.find((entry) => entry.role.test(name))?.topic;
}

/** Whether any of these spaces fills `entry`'s role. */
export function namesTopicSpace(spaces: readonly DesiredSpace[], entry: TopicSpace): boolean {
  return spaces.some((space) => entry.role.test(space.name));
}
