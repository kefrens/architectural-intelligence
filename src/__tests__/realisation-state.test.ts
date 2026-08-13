/**
 * Sprint 1.7 — authoritative realisation state (BUG-008 Phase 3, part two).
 *
 * Sprint 1.6 could ask for a build and could not tell an unbuilt design from a
 * built one, so "build it" twice proposed twice and the host's guard refused the
 * second. This is the port that closes it, and every test below is one row of
 * the sprint's behaviour table.
 *
 * The distinction the whole thing rests on: **a realisation is an event, not the
 * current contents of the model.** Undo empties the drawing and does not
 * un-happen the build — which is why nothing here looks at geometry.
 */

import { isRealisationProposal } from '@archisimple/ai-engine';
import { describe, expect, it } from 'vitest';
import { ArchitecturalIntelligenceService } from '../architectural-intelligence-service.js';
import { createInMemoryPlanningArtefactReader } from '../artefacts/planning-artefact-reader.js';
import {
  ARCHITECTURAL_BRIEF_KIND,
  assembleBrief,
  classifyRequest,
  REQUEST_LANES,
  type ArchitecturalBrief
} from '../brief/index.js';
import {
  GEOMETRY_GRAPH_KIND,
  GEOMETRY_SPECIFICATION_KIND,
  synthesizeGeometry,
  synthesizeSpecification,
  type GeometryGraph,
  type GeometrySpecification
} from '../geometry/index.js';
import { LAYOUT_PLAN_KIND, synthesizeLayout, type LayoutPlan } from '../layout/index.js';
import {
  SPACE_PROGRAMME_KIND,
  synthesizeProgramme,
  type SpaceProgramme
} from '../programme/index.js';
import {
  REALISATION_STATUSES,
  type RealisationState,
  type RealisationStateReader
} from '../realisation/index.js';
import { createHarness } from './harness.js';

const UTTERANCE = 'Design a single storey family home with 3 bedrooms and 2 bathrooms';

function briefFor(): ArchitecturalBrief {
  return assembleBrief({ utterance: UTTERANCE, classification: classifyRequest(UTTERANCE) });
}

function programmeFor(): SpaceProgramme {
  const result = synthesizeProgramme({ brief: briefFor() });
  if (!result.ok) throw new Error(result.message);
  return result.programme;
}

function layoutFor(): LayoutPlan {
  const result = synthesizeLayout({ programme: programmeFor() });
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

function graphFor(): GeometryGraph {
  const result = synthesizeGeometry({ layout: layoutFor() });
  if (!result.ok) throw new Error(result.message);
  return result.graph;
}

function specificationFrom(graph: GeometryGraph): GeometrySpecification {
  const result = synthesizeSpecification({ graph });
  if (!result.ok) throw new Error(result.message);
  return result.specification;
}

/** A reader that counts, so "read per turn, never stored" is checkable. */
function countingReader(state: RealisationState): RealisationStateReader & { calls: number } {
  const reader = {
    calls: 0,
    realisation: () => {
      reader.calls += 1;
      return state;
    }
  };
  return reader;
}

/**
 * A project that has approved the whole chain, with whatever realisation state
 * the host is pretending to report.
 *
 * `state` omitted means **no reader at all** — the Sprint 1.6 configuration,
 * which must keep working (ADR-AI-0004 Rule 6).
 */
function projectWith(state?: Partial<RealisationState> | 'no-reader') {
  const brief = briefFor();
  const programme = programmeFor();
  const layout = layoutFor();
  const graph = graphFor();
  const specification = specificationFrom(graph);

  const reader =
    state === 'no-reader' || state === undefined
      ? undefined
      : countingReader({
          status: REALISATION_STATUSES.NotRealised,
          specificationId: specification.id,
          specificationRevision: specification.revision,
          guardAllowsBuild: true,
          guardBlockerCode: null,
          ...state
        });

  const service = new ArchitecturalIntelligenceService({
    knowledge: createHarness().knowledge,
    ...(reader === undefined ? {} : { realisation: reader }),
    artefacts: createInMemoryPlanningArtefactReader([
      {
        kind: ARCHITECTURAL_BRIEF_KIND,
        id: programme.sourceBrief.briefId,
        revision: programme.sourceBrief.briefRevision,
        value: brief
      },
      {
        kind: SPACE_PROGRAMME_KIND,
        id: layout.sourceProgramme.programmeId,
        revision: layout.sourceProgramme.programmeRevision,
        value: programme
      },
      {
        kind: LAYOUT_PLAN_KIND,
        id: graph.sourceLayout.layoutId,
        revision: graph.sourceLayout.layoutRevision,
        value: layout
      },
      { kind: GEOMETRY_GRAPH_KIND, id: graph.id, revision: graph.revision, value: graph },
      {
        kind: GEOMETRY_SPECIFICATION_KIND,
        id: specification.id,
        revision: specification.revision,
        value: specification
      }
    ])
  });

  return { service, specification, reader, build: () => service.interpret('Build it.') };
}

// --- The behaviour table -------------------------------------------------------

describe('what the assistant answers, by realisation state', () => {
  /** Row 5 — the normal case, unchanged from Sprint 1.6. */
  it('proposes when the design is approved and not realised', () => {
    const response = projectWith().build();

    expect(response.classification?.lane).toBe(REQUEST_LANES.Realisation);
    expect(response.proposal).toBeDefined();
    expect(isRealisationProposal(response.proposal!)).toBe(true);
    expect(response.blocker).toBeUndefined();
  });

  /** Row 2 — the row this sprint exists for. */
  it('explains rather than proposing when the design is already built', () => {
    const response = projectWith({ status: REALISATION_STATUSES.Realised }).build();

    expect(response.proposal).toBeUndefined();
    expect(response.blocker?.reason).toBe('nothing-to-do');
    expect(response.message).toMatch(/already been built/i);
    // Conversational, not a dead end: it says what would change the answer.
    expect(response.blocker?.suggestions.join(' ')).toMatch(/change the design/i);
  });

  /**
   * Row 2, and the reason realisation is an *event*. The user undid the
   * geometry; the drawing is empty and the design is still built. Nothing here
   * looks at the model, which is exactly why this holds.
   */
  it('still reports built after the geometry was undone', () => {
    const response = projectWith({
      status: REALISATION_STATUSES.Realised,
      guardAllowsBuild: false,
      guardBlockerCode: 'realisation.already-realised'
    }).build();

    expect(response.proposal).toBeUndefined();
    expect(response.message).toMatch(/already been built/i);
    expect(response.message).toMatch(/not the current contents of the model/i);
  });

  /** Row 4 — retry, with the earlier attempt named. */
  it('proposes a retry after a refusal, and says there was one', () => {
    const response = projectWith({ status: REALISATION_STATUSES.Refused }).build();

    expect(response.proposal).toBeDefined();
    expect(response.message).toMatch(/refused before anything was changed/i);
    expect(response.message).not.toMatch(/already been built/i);
  });

  it('proposes a retry after a failure, and says the drawing is unchanged', () => {
    const response = projectWith({ status: REALISATION_STATUSES.Failed }).build();

    expect(response.proposal).toBeDefined();
    expect(response.message).toMatch(/rolled back/i);
    expect(response.message).toMatch(/drawing is unchanged/i);
  });

  /** Row 3 — the guard refuses for its own reason, which is reported, not interpreted. */
  it('reports the host guard’s refusal by its code, without proposing', () => {
    const response = projectWith({
      guardAllowsBuild: false,
      guardBlockerCode: 'realisation.incremental-realisation'
    }).build();

    expect(response.proposal).toBeUndefined();
    expect(response.message).toContain('realisation.incremental-realisation');
    expect(response.blocker?.reason).toBe('unsupported');
  });

  /** Row 6 — Sprint 1.6's configuration, still supported (Rule 6). */
  it('proposes as it did before, when the host supplies no reader', () => {
    const response = projectWith('no-reader').build();

    expect(response.proposal).toBeDefined();
    expect(response.blocker).toBeUndefined();
  });

  /**
   * Row 7 — a state about a different design is not evidence about this one.
   * The plausible cause is two record registries in the host, which is the
   * failure ArchiSimple's Sprint 037.1 exists to prevent; asserting "already
   * built" from it would be worse than not asking.
   */
  it('ignores a state that describes another design', () => {
    const response = projectWith({
      status: REALISATION_STATUSES.Realised,
      specificationId: 'some-other-specification'
    }).build();

    expect(response.proposal).toBeDefined();
    expect(response.message).not.toMatch(/already been built/i);
  });

  /**
   * The host answers for the revision in force. A realised *older* revision
   * therefore arrives as "this revision, not realised, and the guard says no" —
   * and must never be reported as this revision having been built.
   */
  it('does not let an older realised revision count as this one', () => {
    const response = projectWith({
      status: REALISATION_STATUSES.NotRealised,
      guardAllowsBuild: false,
      guardBlockerCode: 'realisation.incremental-realisation'
    }).build();

    expect(response.message).not.toMatch(/already been built/i);
    expect(response.proposal).toBeUndefined();
  });
});

// --- Truthfulness ---------------------------------------------------------------

describe('the conversation cannot override the authority', () => {
  it('still says built when the user insists it was not', () => {
    const project = projectWith({ status: REALISATION_STATUSES.Realised });

    project.service.interpret('You never built it.');
    const response = project.build();

    expect(response.message).toMatch(/already been built/i);
    expect(response.proposal).toBeUndefined();
  });

  it('still proposes when the user claims it was built', () => {
    const project = projectWith({ status: REALISATION_STATUSES.NotRealised });

    project.service.interpret('You already built it.');
    const response = project.build();

    expect(response.proposal).toBeDefined();
    expect(response.message).toMatch(/has not been built yet/i);
  });

  it('never claims this layer built anything, in any state', () => {
    const claims = /\b(I built|I have built|I created the walls|I've built)\b/i;

    for (const status of Object.values(REALISATION_STATUSES)) {
      const response = projectWith({ status }).build();
      expect(response.message, status).not.toMatch(claims);
    }
  });
});

// --- The port's own rules -------------------------------------------------------

describe('how the port is used', () => {
  /** Rule 5 — read per turn, never stored. */
  it('reads the state again on every turn', () => {
    const project = projectWith({ status: REALISATION_STATUSES.NotRealised });

    project.build();
    project.build();

    expect(project.reader?.calls).toBe(2);
  });

  it('reads it at most once in a turn', () => {
    const project = projectWith({ status: REALISATION_STATUSES.NotRealised });

    project.build();

    expect(project.reader?.calls).toBe(1);
  });

  /** Rule 8, and §7 of the sprint: the reader is not a projection input. */
  it('is not consulted by a turn that is not about realisation', () => {
    const project = projectWith({ status: REALISATION_STATUSES.NotRealised });

    project.service.interpret('How many rooms does my house have?');
    project.service.interpret('Move this wall 20 cm.');
    project.service.workflowState();

    expect(project.reader?.calls).toBe(0);
  });
});
