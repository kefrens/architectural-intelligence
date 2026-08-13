/**
 * Sprint 1.6 — the realisation lane (BUG-008 Phase 3).
 *
 * The bug: a user approved a Geometry Specification, said "build it", and was
 * told the walls had been created. Phase 1 stopped the false claim host-side and
 * Phase 2 built the path an approval can take; this is the sentence finding it.
 *
 * Two things are pinned here, and the second is the one that would have made
 * this sprint fail as first written:
 *
 * 1. realisation intent produces a realisation proposal carrying an identity and
 *    nothing else;
 * 2. it wins against the lanes that would otherwise **regenerate** part of the
 *    design — because every stage stays eligible once approved, so in exactly the
 *    project where a user says "build it" the geometry and specification lanes
 *    are still open.
 *
 * The fixture is the real chain, for the reason `specification.test.ts` gives:
 * the claim worth checking is about the pipeline, not about a hand-made graph.
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
  reviseGeometryGraph,
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

/**
 * A project holding a coherent chain, with the last one or two stages optional.
 *
 * `staleSpecification` stores a *later* Geometry Graph revision than the one the
 * Specification was derived from, which is exactly what makes the projection
 * call the Specification stale — no flag is set anywhere.
 */
function projectWith(
  options: {
    readonly withSpecification?: boolean;
    readonly staleSpecification?: boolean;
  } = {}
) {
  const brief = briefFor();
  const programme = programmeFor();
  const layout = layoutFor();
  const graph = graphFor();
  const specification = specificationFrom(graph);
  const storedGraph = options.staleSpecification
    ? reviseGeometryGraph(graph, { polygons: graph.polygons })
    : graph;

  const service = new ArchitecturalIntelligenceService({
    knowledge: createHarness().knowledge,
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
      {
        kind: GEOMETRY_GRAPH_KIND,
        id: storedGraph.id,
        revision: storedGraph.revision,
        value: storedGraph
      },
      ...(options.withSpecification === false
        ? []
        : [
            {
              kind: GEOMETRY_SPECIFICATION_KIND,
              id: specification.id,
              revision: specification.revision,
              value: specification
            }
          ])
    ])
  });

  return { service, specification, graph };
}

/** A project that has approved everything, including its Specification. */
function completeProject() {
  return projectWith();
}

// --- Classification -------------------------------------------------------------

describe('the realisation lane recognises what the user meant', () => {
  const REALISATION_UTTERANCES = [
    'Build it.',
    "Let's build it.",
    'Go ahead and build it.',
    'Build the approved design.',
    'Build the apartment.',
    'Realise the design.',
    'Realize it.',
    'Construct the building.',
    'Create the building from this specification.',
    'Turn the approved design into the building.',
    'Make it real.'
  ];

  it.each(REALISATION_UTTERANCES)('%s is a realisation request', (utterance) => {
    const { service } = completeProject();

    expect(service.interpret(utterance).classification?.lane).toBe(REQUEST_LANES.Realisation);
  });

  /**
   * §5.2 — "build" alone is not enough, and naming an element is how a user says
   * they mean one. Story 27.8.3's promise, kept for the ninth lane.
   */
  const AUTHORING_UTTERANCES = [
    'Build a wall here.',
    'Create a wall from 0,0 to 4,0.',
    'Move this wall 20 cm.',
    'Delete this wall.',
    'Add a window to the kitchen wall.'
  ];

  it.each(AUTHORING_UTTERANCES)('%s stays a modelling request', (utterance) => {
    const { service } = completeProject();

    expect(service.interpret(utterance).classification?.lane).not.toBe(REQUEST_LANES.Realisation);
  });

  it('leaves a question a question', () => {
    const { service } = completeProject();

    expect(service.interpret('How many rooms does my house have?').classification?.lane).toBe(
      REQUEST_LANES.DirectExecution
    );
  });
});

/**
 * The three collisions the review measured before the lane existed.
 *
 * Each of these classified into a lane that would have **regenerated** part of
 * the design the user was asking to build, or — worse — restarted the briefing
 * interview for a design they had already approved.
 */
describe('realisation beats the lanes that would regenerate the design', () => {
  it('"Realise the design" builds rather than redrawing the geometry', () => {
    const { service } = completeProject();

    expect(service.interpret('Realise the design.').classification?.lane).toBe(
      REQUEST_LANES.Realisation
    );
  });

  it('"Create the building from this specification" builds rather than respecifying', () => {
    const { service } = completeProject();

    expect(
      service.interpret('Create the building from this specification.').classification?.lane
    ).toBe(REQUEST_LANES.Realisation);
  });

  it('"Build the apartment" builds rather than starting a briefing interview', () => {
    const { service } = completeProject();

    const response = service.interpret('Build the apartment.');

    expect(response.classification?.lane).toBe(REQUEST_LANES.Realisation);
    expect(response.clarification).toBeUndefined();
  });

  /**
   * The other half, and the one that proves the lane took nothing it should not
   * have: with no Specification approved, the stage lanes answer exactly as they
   * did before this sprint.
   */
  it('leaves the geometry lane alone when no Specification has been approved', () => {
    const { service } = projectWith({ withSpecification: false });

    expect(service.interpret('Realise the design.').classification?.lane).toBe(
      REQUEST_LANES.GeometryGeneration
    );
  });

  it('leaves the specification lane alone when no Specification has been approved', () => {
    const { service } = projectWith({ withSpecification: false });

    expect(service.interpret('Give it walls.').classification?.lane).toBe(
      REQUEST_LANES.SpecificationGeneration
    );
  });

  it('leaves the layout lane alone', () => {
    const { service } = completeProject();

    expect(service.interpret('Generate the layout.').classification?.lane).toBe(
      REQUEST_LANES.LayoutGeneration
    );
  });

  it('leaves brief revision alone', () => {
    const { service } = completeProject();

    expect(service.interpret('Actually make it 4 bedrooms.').classification?.lane).toBe(
      REQUEST_LANES.BriefRevision
    );
  });

  /**
   * There is no approval lane, and there should not be: approval is the host's
   * (ADR-AI-0002 ownership). Asserted so a future reader does not add one.
   */
  it('does not turn "approve the design" into a lane of its own', () => {
    const { service } = completeProject();

    expect(service.interpret('Approve the design.').classification?.lane).toBe(
      REQUEST_LANES.DirectExecution
    );
  });
});

// --- The proposal ---------------------------------------------------------------

describe('the realisation proposal', () => {
  it('carries the approved design’s identity, and nothing executable', () => {
    const { service, specification } = completeProject();

    const response = service.interpret('Build it.');

    expect(response.proposal).toBeDefined();
    const proposal = response.proposal!;
    expect(isRealisationProposal(proposal)).toBe(true);
    if (!isRealisationProposal(proposal)) return;

    expect(proposal.subject.realisation).toEqual({
      specificationId: specification.id,
      revision: specification.revision
    });
    // ADR-0032 revision 2.2: an identity, never a plan.
    expect(proposal.operations).toEqual([]);
    expect(proposal.previewGeometry).toEqual([]);
    expect(Object.keys(proposal.subject.realisation).sort()).toEqual([
      'revision',
      'specificationId'
    ]);
  });

  it('describes what approving will ask for, never what has happened', () => {
    const { service } = completeProject();

    const response = service.interpret('Build it.');

    expect(response.message).toMatch(/has not been built yet/i);
    // The BUG-008 sentence, in every tense it could be written in.
    expect(response.message).not.toMatch(/\b(built it|have built|I built|created the walls)\b/i);
    expect(response.proposal?.expectedOutcome).toMatch(/appears in the drawing/i);
  });

  it('resolves the design from the project, not from what was said', () => {
    const { service, specification } = completeProject();

    // The utterance names an identity of its own. ADR-0027.1 Rule 6: nothing is
    // parsed out of what a user or a model said, so the proposal carries the
    // project's identity and ignores this one entirely.
    const proposal = service.interpret('Build the design spec-9999 revision 42.').proposal;

    expect(proposal).toBeDefined();
    if (!isRealisationProposal(proposal!)) throw new Error('expected a realisation proposal');
    expect(proposal.subject.realisation).toEqual({
      specificationId: specification.id,
      revision: specification.revision
    });
    expect(proposal.subject.realisation.specificationId).not.toBe('spec-9999');
  });
});

// --- What it refuses -------------------------------------------------------------

describe('what the lane refuses', () => {
  /**
   * The layer's own knowledge, not a second realisation guard: staleness is what
   * the workflow projection exists to compute, and building a superseded design
   * would build something the project has moved past.
   */
  it('refuses a design whose geometry has been revised since', () => {
    const { service } = projectWith({ staleSpecification: true });

    const response = service.interpret('Build it.');

    expect(response.classification?.lane).toBe(REQUEST_LANES.Realisation);
    expect(response.proposal).toBeUndefined();
    expect(response.blocker?.reason).toBe('superseded');
    expect(response.message).toMatch(/out of date/i);
  });

  it('proposes nothing when the project has approved no design', () => {
    const { service } = projectWith({ withSpecification: false });

    const response = service.interpret('Build it.');

    expect(response.classification?.lane).not.toBe(REQUEST_LANES.Realisation);
    expect(response.proposal).toBeUndefined();
  });

  /**
   * BUG-008 AC-4, from this side. A user asserting a build happened changes
   * nothing: this layer has no realisation state to manufacture, and the only
   * thing that could make the claim true is a host result it never sees.
   */
  it('does not treat a conversational claim as an executed build', () => {
    const { service, specification } = completeProject();

    service.interpret('You already built it.');
    const response = service.interpret('Build it.');

    if (!isRealisationProposal(response.proposal!)) throw new Error('expected a realisation');
    expect(response.message).toMatch(/has not been built yet/i);
    expect(response.proposal).toBeDefined();
    expect(specification.revision).toBe(1);
  });
});
