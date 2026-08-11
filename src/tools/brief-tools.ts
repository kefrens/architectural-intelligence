/**
 * The Brief tool (Sprint 27.8 — ADR-0027.1 Rule 6).
 *
 * How a *language model* contributes to an Architectural Brief: it calls
 * `planning_captureBrief` with the objectives, spaces and requirements it read
 * out of the conversation, and the host builds the artefact. The model supplies
 * fields; `assembleBriefFromFields` decides what a Brief is, applies the same
 * defaults the offline path applies, and records the same assumptions.
 *
 * ## Why not simply ask for the Brief as JSON
 *
 * Because then there would be two definitions of a Brief — one in
 * `architectural-brief.ts` and one in every provider's prompt — and the second
 * would drift with each model. It would also exclude the two in-browser
 * providers, which are not language models and cannot emit schemas at all, and
 * it would put a document concept into `apps/ai-service`, which ADR-0026
 * deliberately keeps free of them.
 *
 * This is the same shape `roomTools.ts` established in Sprint 27.7: the model
 * states the *requirement* (`{ area: 16 }`, or here `{ bedrooms: 3 }`), and the
 * host derives everything that follows from it. A request no longer depends on
 * which model answered it.
 *
 * ## What it deliberately cannot do
 *
 * Invent. A tool call that omits a mandatory topic produces a Brief with that
 * question still open, which the host asks — it does not guess a bedroom count
 * because the model forgot to include one. And it proposes: a captured Brief is
 * a pending artefact proposal the user approves, never a stored one
 * (ADR-0027.1 Rule 7).
 */

import {
  assembleBriefFromFields,
  BRIEF_TOPICS,
  clarificationFor,
  describeClarification,
  reviseBriefFromFields,
  toBriefProposal,
  type ArchitecturalBrief,
  type DesiredSpace
} from '../brief/index.js';
import type { ResolvedToolCall, ToolDefinition } from '@archisimple/ai-engine';
import type { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import { PLANNING_STAGES } from '../planning/planning-stage.js';
import { PLANNING_TOOL_NAMES } from './planning-tool-names.js';

/** The numeric topics the schema exposes as first-class arguments. */
const COUNT_ARGUMENTS: readonly (readonly [string, string, string])[] = [
  [BRIEF_TOPICS.Storeys, 'storeys', 'How many storeys the building should have.'],
  [BRIEF_TOPICS.Bedrooms, 'bedrooms', 'How many bedrooms are required.'],
  [BRIEF_TOPICS.Bathrooms, 'bathrooms', 'How many bathrooms are required.']
];

/** The boolean topics. Absent means "not stated", which is not the same as `false`. */
const FLAG_ARGUMENTS: readonly (readonly [string, string, string])[] = [
  [BRIEF_TOPICS.Garage, 'garage', 'Whether the user asked for a garage.'],
  [BRIEF_TOPICS.Office, 'office', 'Whether the user asked for a home office.'],
  [
    BRIEF_TOPICS.Accessibility,
    'accessible',
    'Whether the home must be step-free or wheelchair accessible.'
  ]
];

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asSpaces(value: unknown): readonly DesiredSpace[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const spaces: DesiredSpace[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const candidate = entry as { name?: unknown; count?: unknown };
    if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
      continue;
    }
    // A space with no count is one space; a nonsensical count is not a reason
    // to drop a space the user asked for.
    const count = asFiniteNumber(candidate.count);
    spaces.push({
      name: candidate.name.trim(),
      count: count !== undefined && count > 0 ? Math.floor(count) : 1
    });
  }
  return spaces;
}

function asStrings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

/**
 * What a re-capture answers when it would change nothing (Sprint 1.5, Story
 * 1.5.3). Addressed to the model, because the model is what called this.
 */
const BRIEF_ALREADY_SAYS_THAT =
  'This project already has an approved brief saying exactly that, so there is nothing to record. Move on to the space programme, or tell me what should change.';

/**
 * Captures an Architectural Brief, or revises the one this project already has
 * (Sprint 27.8; service-bound by Sprint 1.5).
 *
 * ## Why this became a factory
 *
 * It was a standalone `const` — the only planning tool that was — so it held no
 * service, could not read `approvedBrief()`, and could not know a Brief existed.
 * Every call therefore minted a **new lineage**, and two calls left the project
 * with two Briefs, no way to say which one counted, and — through Sprint 1.3's
 * integrity check — no eligible stage at all (Bug 002).
 *
 * Binding it to the service is what lets Story 1.3.7's rule finally reach the
 * fifth stage: *producing an artefact for a project that already has one is a
 * revision of it*. The four stages below this one have worked that way since
 * Sprint 1.3; this is the one that could not, and now can.
 *
 * The tool's **name, schema and arguments are unchanged**. A model sees exactly
 * what it saw before; only the host's composition differs.
 */
export function createCaptureBriefToolDefinition(
  intelligence: ArchitecturalIntelligenceService
): ToolDefinition {
  return {
    // No Automation Request is involved: a Brief executes nothing, so there is
    // nothing for the MCP server to have to serve before this may be offered.
    requires: [],
    schema: {
      type: 'function',
      function: {
        name: PLANNING_TOOL_NAMES[PLANNING_STAGES.Brief],
        description:
          'Records what the user wants from a whole building, before any geometry exists. Call this for high-level design requests ("design a family home", "create a T4 apartment") — never for modelling commands like creating a wall or a room. Supply only what the user actually said: anything you leave out will be asked about rather than assumed.',
        parameters: {
          type: 'object',
          properties: {
            objectives: {
              type: 'array',
              items: { type: 'string' },
              description: 'What the user is trying to achieve, in their own terms.'
            },
            spaces: {
              type: 'array',
              description: 'Named spaces the user asked for. Never include areas or dimensions.',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'e.g. "kitchen", "bedroom".' },
                  count: { type: 'number', description: 'Defaults to 1.' }
                },
                required: ['name']
              }
            },
            ...Object.fromEntries(
              COUNT_ARGUMENTS.map(([, name, description]) => [
                name,
                { type: 'number', description }
              ])
            ),
            ...Object.fromEntries(
              FLAG_ARGUMENTS.map(([, name, description]) => [
                name,
                { type: 'boolean', description }
              ])
            ),
            style: {
              type: 'string',
              description: 'An architectural style, only if the user named one.'
            },
            budget: { type: 'string', description: 'A stated budget, only if the user gave one.' },
            totalArea: {
              type: 'number',
              description:
                'A stated total floor area in square metres, only if the user gave one. This is a requirement, not an allocation.'
            }
          },
          required: []
        }
      }
    },
    resolve: (args, context): ResolvedToolCall | undefined => {
      const requirements: { topic: string; value: string | number | boolean; statement: string }[] =
        [];

      for (const [topic, name] of COUNT_ARGUMENTS) {
        const count = asFiniteNumber(args[name]);
        if (count === undefined || count < 0) {
          continue;
        }
        const noun = topic === BRIEF_TOPICS.Storeys ? 'storey' : topic.replace(/s$/, '');
        requirements.push({
          topic,
          value: count,
          statement: count === 1 ? `1 ${noun}` : `${count} ${noun}s`
        });
      }

      for (const [topic, name] of FLAG_ARGUMENTS) {
        const flag = args[name];
        if (typeof flag !== 'boolean') {
          continue;
        }
        requirements.push({
          topic,
          value: flag,
          statement: flag ? `a ${topic}` : `no ${topic}`
        });
      }

      if (typeof args['style'] === 'string' && args['style'].trim().length > 0) {
        const style = args['style'].trim();
        requirements.push({ topic: BRIEF_TOPICS.Style, value: style, statement: `${style} style` });
      }
      if (typeof args['budget'] === 'string' && args['budget'].trim().length > 0) {
        const budget = args['budget'].trim();
        requirements.push({
          topic: BRIEF_TOPICS.Budget,
          value: budget,
          statement: `a budget of ${budget}`
        });
      }
      const totalArea = asFiniteNumber(args['totalArea']);
      if (totalArea !== undefined && totalArea > 0) {
        requirements.push({
          topic: BRIEF_TOPICS.TotalArea,
          value: totalArea,
          statement: `a total area of about ${totalArea} m²`
        });
      }

      const objectives = asStrings(args['objectives']);
      const spaces = asSpaces(args['spaces']);

      // The utterance the brief quotes back. The conversation fragment is the
      // closest thing this tool has to the user's own words — the model's
      // arguments are a reading of them, not the words themselves.
      const utterance =
        objectives[0] ??
        (context['conversation'] as { readonly lastUserMessage?: string } | undefined)
          ?.lastUserMessage ??
        'A design request';

      // Story 1.5.2. A project that already holds a Brief gets a *revision* of
      // it, never a second one. Reading it back is the whole reason this tool
      // became service-bound.
      const approved = intelligence.approvedBrief();
      if (approved !== undefined) {
        return reviseApproved(approved, { objectives, spaces, requirements });
      }

      const brief = assembleBriefFromFields({
        utterance,
        objectives,
        spaces,
        requirements
      });

      // An incomplete Brief is not an error and not a proposal: it is a question.
      // The model left something out, so the host asks rather than inventing it.
      if (brief.openQuestions.length > 0) {
        return {
          kind: 'blocked',
          message: describeClarification(clarificationFor(brief, brief.openQuestions))
        };
      }

      return { kind: 'proposal', proposal: toBriefProposal(brief) };
    }
  };
}

/**
 * A re-capture, folded into the Brief the project holds (Stories 1.5.3, 1.5.4).
 *
 * The `utterance` is deliberately not passed through: a tool call carries
 * structured fields and no sentence of its own, so the Brief keeps the words it
 * was first described with.
 */
function reviseApproved(
  approved: ArchitecturalBrief,
  fields: {
    readonly objectives: readonly string[];
    readonly spaces: readonly DesiredSpace[];
    readonly requirements: readonly {
      readonly topic: string;
      readonly value: string | number | boolean;
      readonly statement: string;
    }[];
  }
): ResolvedToolCall {
  const revised = reviseBriefFromFields(approved, {
    requirements: fields.requirements,
    spaces: fields.spaces
  });

  if (revised === undefined) {
    // Bug 002's loop ends here. Superseding revision n with an identical
    // revision n+1 would be supersession theatre, and the vocabulary already has
    // the word for it.
    return { kind: 'blocked', message: BRIEF_ALREADY_SAYS_THAT };
  }

  return { kind: 'proposal', proposal: toBriefProposal(revised) };
}
