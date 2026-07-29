/**
 * The Architectural Intelligence Service (Sprint 24.5, Architecture Delta).
 *
 * The one new platform capability this sprint introduces, and the coordinator
 * the sprint's own pipeline diagram names:
 *
 * ```text
 * User Request
 *      v
 * AI Workspace
 *      v
 * Architectural Intelligence   <- you are here
 *      v
 * Building Platform            (Building / Spatial / Inspector, via BuildingKnowledge)
 *      v
 * Automation Platform          (the Requests a plan carries)
 *      v
 * Proposal Workflow            (approve / reject, in ai-engine)
 *      v
 * Runtime
 * ```
 *
 * Four responsibilities, in order, and nothing else:
 *
 * 1. **Understand the intent** — `recognizeIntent`.
 * 2. **Inspect the Building Model** — `BuildingKnowledge`, on demand, read-only.
 * 3. **Build an execution plan** — `ArchitecturalPlanner` and its providers.
 * 4. **Generate a Proposal** — `toProposal`, handed to the existing workflow.
 *
 * ## What it owns
 *
 * No project state, no document access, no execution. It holds a knowledge
 * facade and a planner; neither holds a `CommandDispatcher`. Every write in
 * this sprint happens in exactly the place writes already happened before it:
 * `AiSessionController.approveProposal`, dispatching through the Automation
 * API. That is why "Automation remains the single execution mechanism" is a
 * structural property here rather than a rule someone has to remember.
 *
 * ## Why questions and modifications share one entry point
 *
 * Because a user does not label their messages. `interpret` reads one utterance
 * and answers with whichever of the two it turned out to be — or with an
 * explanation of why it can be neither (Story 24.5.11). A caller renders an
 * {@link ArchitecturalResponse} without having to decide first what kind of
 * thing it asked for.
 */

import type { Proposal } from '@archisimple/ai-engine';
import { ARCHITECTURAL_INTENT_KINDS, recognizeIntent, type ArchitecturalIntent } from './intent';
import {
  ArchitecturalPlanner,
  createBuiltInOperationProviders,
  type ArchitecturalCapability,
  type ArchitecturalOperationProvider,
  type PlanBlocker
} from './planning';
import { toProposal } from './proposal/proposal-builder';
import {
  answerArchitecturalQuestion,
  type ArchitecturalAnswer,
  type BuildingKnowledge
} from './understanding';

export interface ArchitecturalIntelligenceServiceOptions {
  readonly knowledge: BuildingKnowledge;
  /**
   * Defaults to a planner carrying the built-in operation providers. Pass one
   * to register additional providers, or a narrower set.
   */
  readonly planner?: ArchitecturalPlanner;
}

/**
 * One turn's outcome.
 *
 * `message` is always present and always sufficient on its own — a caller that
 * renders nothing else still says something true. `answer`, `proposal` and
 * `blocker` are the structured forms of the same turn, for a caller that can
 * render more.
 */
export interface ArchitecturalResponse {
  readonly intent: ArchitecturalIntent;
  /** Markdown, ready to become a conversation message. */
  readonly message: string;
  /** Present when the turn was a question the Building Platform could answer. */
  readonly answer?: ArchitecturalAnswer;
  /** Present when the turn produced a reviewable change. Never executed here. */
  readonly proposal?: Proposal;
  /** Present when the turn could not be completed, with what to try instead (Story 24.5.11). */
  readonly blocker?: PlanBlocker;
}

export class ArchitecturalIntelligenceService {
  private readonly knowledge: BuildingKnowledge;
  private readonly planner: ArchitecturalPlanner;

  constructor(options: ArchitecturalIntelligenceServiceOptions) {
    this.knowledge = options.knowledge;
    this.planner = options.planner ?? defaultPlanner();
  }

  /**
   * The knowledge facade this service reasons over.
   *
   * Exposed so a host composing the Architectural Context Provider does not
   * have to build a second facade over the same services — it is stateless, but
   * two of them would still be two things to keep wired to the same set.
   */
  buildingKnowledge(): BuildingKnowledge {
    return this.knowledge;
  }

  /** Every action currently plannable — what a prompt or a preferences screen can advertise. */
  capabilities(): readonly ArchitecturalCapability[] {
    return this.planner.capabilities();
  }

  /** Registers an additional operation provider after construction. */
  registerOperationProvider(provider: ArchitecturalOperationProvider): void {
    this.planner.registerProvider(provider);
  }

  /**
   * Reads one utterance and answers it.
   *
   * Never throws for an unusable request: a phrase this layer cannot act on
   * comes back as a `blocker` with suggestions, because "I cannot do that, try
   * this" is a turn in the conversation and an exception is not.
   */
  interpret(utterance: string): ArchitecturalResponse {
    return this.interpretIntent(recognizeIntent(utterance));
  }

  /**
   * The same turn, starting from an intent somebody else built.
   *
   * This is the entry point a *language model* reaches: the host's Tool Broker
   * turns a model's structured tool call — which already names the action and
   * its parameters — straight into an {@link ArchitecturalIntent}, skipping the
   * pattern matching it does not need. Both paths meet here, so both produce
   * the same plans with the same reasoning, assumptions and safety rules.
   * There is one architectural pipeline, not one per provider.
   */
  interpretIntent(intent: ArchitecturalIntent): ArchitecturalResponse {
    if (intent.kind === ARCHITECTURAL_INTENT_KINDS.Question) {
      const answer = answerArchitecturalQuestion(intent, this.knowledge);
      if (answer !== undefined) {
        return { intent, message: answer.text, answer };
      }
    }

    // Everything else — modifications, ambiguous phrasings and unknown ones —
    // goes to the planner. An `Ambiguous` intent still reaches its provider so
    // the provider can name what is missing in its own terms; an `Unknown` one
    // reaches no provider and the planner answers for it.
    const result = this.planner.plan(intent, this.knowledge);
    if (!result.ok) {
      return { intent, message: describeBlocker(result.blocker), blocker: result.blocker };
    }

    const proposal = toProposal(result.plan);
    return { intent, message: describePlan(result.plan.reasoning, proposal), proposal };
  }
}

function defaultPlanner(): ArchitecturalPlanner {
  const planner = new ArchitecturalPlanner();
  for (const provider of createBuiltInOperationProviders()) {
    planner.registerProvider(provider);
  }
  return planner;
}

/**
 * The prose for a turn that produced a proposal.
 *
 * Reasoning first, outcome second: the panel renders the proposal card with the
 * operations and the affected elements right underneath, so the message's job
 * is the part a card cannot show — why this, and what to expect.
 */
function describePlan(reasoning: string, proposal: Proposal): string {
  const lines = [reasoning, '', `**${proposal.title}** — ${proposal.expectedOutcome ?? ''}`.trim()];
  if (proposal.assumptions.length > 0) {
    lines.push('', 'I assumed:', ...proposal.assumptions.map((assumption) => `- ${assumption}`));
  }
  if (proposal.risk === 'destructive') {
    lines.push(
      '',
      'This one removes or replaces existing work, so approving it asks you to confirm.'
    );
  }
  return lines.join('\n');
}

/** The prose for a turn that could not be completed (Story 24.5.11). */
function describeBlocker(blocker: PlanBlocker): string {
  const lines = [blocker.message];
  if (blocker.suggestions.length > 0) {
    lines.push('', ...blocker.suggestions.map((suggestion) => `- ${suggestion}`));
  }
  return lines.join('\n');
}
