/**
 * Architectural questions (Sprint 24.5, Stories 24.5.4 and 24.5.5).
 *
 * "I want to ask questions about my project." Every answer here is composed
 * from {@link BuildingKnowledge} — which is to say from the Building, Spatial
 * and Inspector services — and nothing is computed a second time.
 *
 * ## Answers, and honest non-answers
 *
 * Three of the sprint's own example questions are answerable today ("how many
 * rooms", "which walls are load-bearing", "what is the floor area") and two are
 * not ("which windows face south", "which rooms have no natural light"). The
 * unanswerable pair is not omitted or faked: an {@link ArchitecturalAnswer} can
 * carry a `limitation`, which says what the platform *does* record, what it
 * does not, and what the user could ask instead. That is Story 24.5.11 applied
 * to reading rather than writing, and it is the difference between a model that
 * is wrong about a building and one that is clear about itself.
 *
 * Concretely: `OpeningDto` publishes an opening's id, type, level and position
 * — and no hosting wall, so there is no normal to take an orientation from, and
 * no way to attribute a window to the room it lights. Both become answerable
 * the day the Building Model contributes the `hosts` relationship ADR-0024
 * Rule 11 anticipates; neither is guessable before then.
 */

import type { ArchitecturalIntent } from '../intent/architectural-intent.js';
import { ARCHITECTURAL_ACTIONS } from '../intent/architectural-intent.js';
import type { BuildingKnowledge } from './building-knowledge.js';

/** Decimal places measurements are reported to, matching the Spatial context provider. */
const MEASUREMENT_PRECISION = 2;

export interface ArchitecturalAnswer {
  /** Markdown, ready to be a conversation message. */
  readonly text: string;
  /**
   * The same answer as data, so a caller that is not rendering prose — a test,
   * a future structured tool result — does not have to parse the text back.
   */
  readonly facts: Readonly<Record<string, unknown>>;
  /**
   * Present when the platform cannot fully answer: what is missing, and what to
   * ask instead. The `text` already says this in prose; this is the structured
   * form, for the same reason `Proposal.assumptions` is a field.
   */
  readonly limitation?: {
    readonly message: string;
    readonly suggestions: readonly string[];
  };
}

function round(value: number): number {
  const factor = 10 ** MEASUREMENT_PRECISION;
  return Math.round(value * factor) / factor;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Answers one question, or `undefined` when the intent is not one this module
 * recognises — the caller falls through to its own handling rather than being
 * handed a fabricated answer.
 */
export function answerArchitecturalQuestion(
  intent: ArchitecturalIntent,
  knowledge: BuildingKnowledge
): ArchitecturalAnswer | undefined {
  switch (intent.action) {
    case ARCHITECTURAL_ACTIONS.roomCount:
      return roomCount(knowledge);
    case ARCHITECTURAL_ACTIONS.loadBearingWalls:
      return loadBearingWalls(knowledge);
    case ARCHITECTURAL_ACTIONS.floorArea:
      return floorArea(intent, knowledge);
    case ARCHITECTURAL_ACTIONS.roomAdjacency:
      return roomAdjacency(intent, knowledge);
    case ARCHITECTURAL_ACTIONS.describeSelection:
      return describeSelection(knowledge);
    case ARCHITECTURAL_ACTIONS.projectOverview:
      return projectOverview(knowledge);
    case ARCHITECTURAL_ACTIONS.openingOrientation:
      return openingOrientation(intent, knowledge);
    case ARCHITECTURAL_ACTIONS.naturalLight:
      return naturalLight(knowledge);
    default:
      return undefined;
  }
}

function roomCount(knowledge: BuildingKnowledge): ArchitecturalAnswer {
  const rooms = knowledge.rooms();
  if (rooms.length === 0) {
    return {
      text: 'There are no enclosed rooms yet — no closed loop of walls has been drawn.',
      facts: { roomCount: 0 }
    };
  }
  const lines = rooms.map(
    (room) => `- **${room.name}** — ${round(knowledge.roomAreaSquareMetres(room))} m²`
  );
  return {
    text: [
      `There ${rooms.length === 1 ? 'is' : 'are'} ${plural(rooms.length, 'room')}:`,
      ...lines
    ].join('\n'),
    facts: {
      roomCount: rooms.length,
      rooms: rooms.map((room) => ({
        id: room.id,
        name: room.name,
        area: round(knowledge.roomAreaSquareMetres(room))
      }))
    }
  };
}

function loadBearingWalls(knowledge: BuildingKnowledge): ArchitecturalAnswer {
  const walls = knowledge.walls();
  const loadBearing = walls.filter((wall) => wall.loadBearing);
  if (loadBearing.length === 0) {
    return {
      text: `None of the ${plural(walls.length, 'wall')} in this project are load-bearing.`,
      facts: { wallCount: walls.length, loadBearingCount: 0 }
    };
  }
  const lines = loadBearing.map(
    (wall) => `- \`${wall.id}\` — ${round(wall.length)} m long, ${round(wall.thickness)} m thick`
  );
  return {
    text: [
      `${plural(loadBearing.length, 'wall')} of ${walls.length} ${loadBearing.length === 1 ? 'is' : 'are'} load-bearing:`,
      ...lines
    ].join('\n'),
    facts: {
      wallCount: walls.length,
      loadBearingCount: loadBearing.length,
      loadBearingWallIds: loadBearing.map((wall) => wall.id)
    }
  };
}

function floorArea(intent: ArchitecturalIntent, knowledge: BuildingKnowledge): ArchitecturalAnswer {
  const subject = intent.parameters['subject'];
  if (typeof subject === 'string' && subject.trim().length > 0) {
    const room = knowledge.findRoomByName(subject);
    if (room === undefined) {
      return {
        text: `I could not find a room called "${subject}".`,
        facts: { subject },
        limitation: {
          message: `No room named "${subject}" exists in the Building Model.`,
          suggestions: knowledge
            .rooms()
            .map((candidate) => `Ask about **${candidate.name}** instead.`)
            .slice(0, 5)
        }
      };
    }
    return {
      text: `**${room.name}** is ${round(knowledge.roomAreaSquareMetres(room))} m², with a perimeter of ${round(knowledge.roomPerimeterMetres(room))} m.`,
      facts: {
        roomId: room.id,
        name: room.name,
        area: round(knowledge.roomAreaSquareMetres(room)),
        perimeter: round(knowledge.roomPerimeterMetres(room))
      }
    };
  }

  const rooms = knowledge.rooms();
  const total = knowledge.totalFloorAreaSquareMetres();
  return {
    text:
      rooms.length === 0
        ? 'The floor area is 0 m² — no enclosed rooms have been detected yet.'
        : `The total floor area is **${round(total)} m²** across ${plural(rooms.length, 'room')}.`,
    facts: { totalArea: round(total), roomCount: rooms.length }
  };
}

function roomAdjacency(
  intent: ArchitecturalIntent,
  knowledge: BuildingKnowledge
): ArchitecturalAnswer {
  const subject = intent.parameters['subject'];
  const rooms = knowledge.rooms();

  if (typeof subject === 'string' && subject.trim().length > 0) {
    const room = knowledge.findRoomByName(subject);
    if (room === undefined) {
      return {
        text: `I could not find a room called "${subject}".`,
        facts: { subject },
        limitation: {
          message: `No room named "${subject}" exists in the Building Model.`,
          suggestions: rooms
            .map((candidate) => `Ask about **${candidate.name}** instead.`)
            .slice(0, 5)
        }
      };
    }
    const neighbours = knowledge.adjacentRooms(room.id);
    return {
      text:
        neighbours.length === 0
          ? `**${room.name}** shares no boundary wall with another room.`
          : `**${room.name}** adjoins ${neighbours.map((neighbour) => `**${neighbour.name}**`).join(', ')}.`,
      facts: { roomId: room.id, adjacentRoomNames: neighbours.map((neighbour) => neighbour.name) }
    };
  }

  const lines = rooms.map((room) => {
    const neighbours = knowledge.adjacentRooms(room.id);
    return `- **${room.name}** → ${neighbours.length === 0 ? '(none)' : neighbours.map((n) => n.name).join(', ')}`;
  });
  return {
    text:
      rooms.length === 0
        ? 'There are no rooms yet, so nothing is adjacent to anything.'
        : ['Room adjacency:', ...lines].join('\n'),
    facts: {
      adjacency: rooms.map((room) => ({
        name: room.name,
        adjacentTo: knowledge.adjacentRooms(room.id).map((neighbour) => neighbour.name)
      }))
    }
  };
}

function describeSelection(knowledge: BuildingKnowledge): ArchitecturalAnswer {
  const selection = knowledge.selection();
  if (selection.isEmpty) {
    return { text: 'Nothing is currently selected.', facts: { count: 0 } };
  }

  // Reported in the Building Model's vocabulary, not the Runtime Model's: the
  // user selected "Room 2", not entity `a3f1…` (Story 24.5.2).
  const described = selection.entities.map((entity) => {
    const object = knowledge.buildingObjectForEntity(entity.id);
    return {
      entityId: entity.id,
      kind: object?.kind ?? entity.type,
      name: object?.name ?? null
    };
  });
  const lines = described.map(
    (item) =>
      `- ${item.kind}${item.name === null ? '' : ` **${item.name}**`} (\`${item.entityId}\`)`
  );
  return {
    text: [`${plural(selection.count, 'element')} selected:`, ...lines].join('\n'),
    facts: { count: selection.count, selected: described }
  };
}

function projectOverview(knowledge: BuildingKnowledge): ArchitecturalAnswer {
  const structure = knowledge.structure();
  const rooms = knowledge.rooms();
  const facts = {
    projectName: structure.project?.name ?? null,
    floorCount: knowledge.floors().length,
    wallCount: structure.walls.length,
    loadBearingWallCount: structure.walls.filter((wall) => wall.loadBearing).length,
    roomCount: rooms.length,
    openingCount: structure.openings.length,
    totalArea: round(knowledge.totalFloorAreaSquareMetres())
  };
  return {
    text: [
      `**${facts.projectName ?? 'This project'}** currently has:`,
      `- ${plural(facts.floorCount, 'floor')}`,
      `- ${plural(facts.wallCount, 'wall')} (${facts.loadBearingWallCount} load-bearing)`,
      `- ${plural(facts.roomCount, 'room')} totalling ${facts.totalArea} m²`,
      `- ${plural(facts.openingCount, 'opening')}`
    ].join('\n'),
    facts
  };
}

/**
 * "Which windows face south?" — recognised, and honestly unanswerable.
 *
 * The Building Model names openings but does not yet relate them to the wall
 * that hosts them, and orientation is the hosting wall's normal. Counting the
 * windows is still worth doing: it tells the user the question was understood
 * and what the platform can see.
 */
function openingOrientation(
  intent: ArchitecturalIntent,
  knowledge: BuildingKnowledge
): ArchitecturalAnswer {
  const openings = knowledge.openings();
  const compass = intent.parameters['compass'];
  return {
    text: [
      `I can see ${plural(openings.length, 'opening')} in this project, but I cannot tell you which way ${compass === undefined ? 'they face' : `face ${String(compass)}`}.`,
      '',
      'An opening’s orientation comes from the wall hosting it, and the Building Model does not yet record which wall hosts which opening.'
    ].join('\n'),
    facts: {
      openingCount: openings.length,
      ...(compass === undefined ? {} : { compass })
    },
    limitation: {
      message:
        'Opening orientation requires the wall-hosts-opening relationship, which the Building Model does not yet derive.',
      suggestions: [
        'Ask which walls are load-bearing, or how the rooms adjoin each other — both are derived today.',
        'Select a wall and ask about it: wall geometry, including its direction, is available.'
      ]
    }
  };
}

/**
 * "Which rooms have no natural light?" — same gap, one step further along.
 *
 * Answering it needs openings attributed to boundary walls, and then those
 * walls attributed to rooms. The second half exists (the Spatial Model records
 * a room's boundary walls); the first does not.
 */
function naturalLight(knowledge: BuildingKnowledge): ArchitecturalAnswer {
  const rooms = knowledge.rooms();
  const openings = knowledge.openings();
  return {
    text: [
      `This project has ${plural(rooms.length, 'room')} and ${plural(openings.length, 'opening')}, but I cannot say which rooms have natural light.`,
      '',
      'That needs each window attributed to the wall it sits in, and the Building Model does not yet derive that relationship.'
    ].join('\n'),
    facts: { roomCount: rooms.length, openingCount: openings.length },
    limitation: {
      message:
        'Natural light per room requires openings to be related to their hosting walls, which the Building Model does not yet derive.',
      suggestions: [
        'Ask for the room areas or the adjacency between rooms — both are derived from the Spatial Model today.',
        'Ask which walls bound a particular room, and inspect those walls for openings manually.'
      ]
    }
  };
}
