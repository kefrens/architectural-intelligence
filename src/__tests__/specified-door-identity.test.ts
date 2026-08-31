/**
 * A specified door is a real door (Sprint 1.11).
 *
 * Two claims, and the second is the one that would have shipped as a defect.
 *
 * **Identity.** A Specification names the Library entry its doors were designed
 * as, so a building this layer designed is built with the same door a person
 * would have placed by hand (ArchiSimple ADR-0038 Rule 6). The host reads the
 * field but resolves nothing, so an unknown identity costs a drawing and never a
 * build.
 *
 * **Dimension.** This stage specified a **0.90 m** door opening, which is in no
 * French standard: the NF P20-101 leaf series is 63/73/83/93, needing openings of
 * 0.73/0.83/0.93/1.03 with a standard bloc-porte huisserie. A 0.90 m opening
 * corresponds to no leaf anybody can order — so the pipeline was specifying a
 * door that does not exist.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONSTRUCTION,
  describeDefaults,
  OPENING_KINDS
} from '../geometry/construction-defaults.js';
import { assembleBriefFromFields } from '../brief/index.js';
import { synthesizeProgramme } from '../programme/index.js';
import { synthesizeLayout } from '../layout/index.js';
import { synthesizeGeometry, synthesizeSpecification } from '../geometry/index.js';
import { validateGeometrySpecification } from '../geometry/index.js';
import type { GeometrySpecification } from '../geometry/geometry-specification.js';

const PORTE_83 = 'archisimple:door-single-leaf-83';

describe('the construction defaults specify a door that exists', () => {
  it('specifies the baie an 83 leaf needs, not a number in no series', () => {
    expect(DEFAULT_CONSTRUCTION.opening.door.width).toBeCloseTo(0.93, 6);
  });

  it('names the product, so the host can draw the door that was designed', () => {
    expect(DEFAULT_CONSTRUCTION.opening.door.assetDefinitionId).toBe(PORTE_83);
  });

  it('names nothing for a cased opening', () => {
    // A passage has no leaf, and ArchiSimple ships no canonical one. Naming an
    // asset that does not exist would be worse than naming none.
    expect(DEFAULT_CONSTRUCTION.opening.passage.assetDefinitionId).toBeUndefined();
  });

  it('keeps a door walked through and a passage wider than it', () => {
    expect(DEFAULT_CONSTRUCTION.opening.door.sill).toBe(0);
    expect(DEFAULT_CONSTRUCTION.opening.passage.width).toBeGreaterThan(
      DEFAULT_CONSTRUCTION.opening.door.width
    );
  });

  it('leaves every door under the clear wall height', () => {
    // The host refuses an opening taller than its wall since ArchiSimple Sprint
    // 053.0, so a default that failed here would block every generated design.
    const clear = DEFAULT_CONSTRUCTION.storeyHeight - DEFAULT_CONSTRUCTION.floorAssembly;

    for (const kind of Object.values(OPENING_KINDS)) {
      const opening = DEFAULT_CONSTRUCTION.opening[kind];
      expect(opening.sill + opening.height).toBeLessThanOrEqual(clear);
    }
  });

  it('tells a reviewer which door they are approving', () => {
    // "930 × 2.1" does not say *porte 83*, and the product is what a reviewer is
    // actually agreeing to.
    const said = describeDefaults(DEFAULT_CONSTRUCTION).join('\n');

    expect(said).toContain('83 leaf');
    expect(said).toContain('930 mm');
  });

  it('still declines to claim a load-bearing wall or a window', () => {
    // Unchanged by this sprint, and asserted so the sentence set does not drift
    // while somebody is editing the one above it.
    const said = describeDefaults(DEFAULT_CONSTRUCTION).join('\n');

    expect(said).toContain('No wall is marked load-bearing');
    expect(said).toContain('There are no windows');
  });
});


/**
 * The whole pipeline, because the claim worth testing is that a Specification
 * this layer actually emits carries the identity — not that a hand-built one
 * could.
 */
function specificationFor(): GeometrySpecification {
  // The same shape `geometry-acceptance` uses — a real tool call from a real
  // run — rather than a brief invented to fit this test.
  const brief = assembleBriefFromFields({
    utterance: 'design a 100m2 apartment',
    objectives: ['design a 100m2 apartment'],
    spaces: [
      { name: 'bedroom', count: 2 },
      { name: 'bathroom', count: 1 },
      { name: 'office', count: 1 }
    ],
    requirements: [
      { topic: 'storeys', value: 1 },
      { topic: 'bedrooms', value: 2 },
      { topic: 'bathrooms', value: 1 },
      { topic: 'office', value: true }
    ],
    userMessage: 'Build me a 100m2 appartment with 2 bedrooms, 1 bathrooms, and a small office.'
  });
  const programme = synthesizeProgramme({ brief });
  if (!programme.ok) throw new Error(`programme: ${programme.message}`);
  const layout = synthesizeLayout({ programme: programme.programme });
  if (!layout.ok) throw new Error(`layout: ${layout.message}`);
  const geometry = synthesizeGeometry({ layout: layout.plan });
  if (!geometry.ok) throw new Error(`geometry: ${geometry.message}`);
  const specification = synthesizeSpecification({ graph: geometry.graph });
  if (!specification.ok) throw new Error(`specification: ${specification.message}`);
  return specification.specification;
}

describe('a synthesised Specification names the door it specified', () => {
  it('puts the identity on every door it emits', () => {
    const specification = specificationFor();
    const doors = specification.openings.filter((opening) => opening.kind === 'door');

    expect(doors.length).toBeGreaterThan(0);
    for (const door of doors) {
      expect(door.assetDefinitionId).toBe(PORTE_83);
    }
  });

  it('names nothing on a cased opening', () => {
    const passages = specificationFor().openings.filter(
      (opening) => opening.kind === 'passage'
    );

    for (const passage of passages) {
      expect(passage.assetDefinitionId).toBeUndefined();
    }
  });

  it('keeps the identity on a door narrowed to fit its wall', () => {
    // A narrowed door still records what was *intended*. The host scales the
    // symbol to the width actually built, and the warning already tells a
    // reviewer the door was narrowed — dropping the identity as well would hide
    // the intent without adding information.
    const specification = specificationFor();
    const narrowed = specification.openings.filter(
      (opening) =>
        opening.kind === 'door' && opening.width < DEFAULT_CONSTRUCTION.opening.door.width
    );

    for (const door of narrowed) {
      expect(door.assetDefinitionId).toBe(PORTE_83);
    }
  });

  it('still validates, identity and all', () => {
    // A `PlanBlocker[]`, empty when the artefact is sound (ADR-0027.1 Rule 8's
    // one vocabulary for missing information).
    expect(validateGeometrySpecification(specificationFor())).toEqual([]);
  });

  it('refuses an identity that is not a usable string', () => {
    // Shape only. The grammar is the host's business and this layer holds no
    // catalogue to resolve against.
    const specification = specificationFor();
    const doors = specification.openings.filter((opening) => opening.kind === 'door');
    expect(doors.length).toBeGreaterThan(0);

    const mangled = {
      ...specification,
      openings: specification.openings.map((opening) =>
        opening.kind === 'door' ? { ...opening, assetDefinitionId: '' } : opening
      )
    };

    expect(validateGeometrySpecification(mangled).length).toBeGreaterThan(0);
  });
});
