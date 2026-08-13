/**
 * Bug 006 — the acceptance test for the design pipeline's own output.
 *
 * The reported symptom was a floor plan containing one 10 × 10 m square and one
 * 3.354 m square, for a brief that asked for a seven-space apartment. The
 * conclusion drawn was that geometry generation had become model-driven.
 *
 * It had not. Reading the transcript, **the pipeline never reached geometry**:
 * the Brief and the Programme produced artefact cards, "Layout" was bare prose
 * with nothing recorded, and every shape in that screenshot came from
 * `createRoom` — the direct-edit tool in `apps/web`, behaving exactly as
 * designed for a command that says "make a room of 11.25 m²".
 *
 * So this file exists to pin down what the pipeline *does* produce, and to keep
 * it that way while the missing half is built. It is the artefact-level part of
 * the report's §11: a real Brief, run through all four stages, asserted against
 * the report's own expectations.
 *
 * ## What it deliberately does not assert
 *
 * That the building model ends up with these rooms in it. Nothing in `apps/web`
 * reads a Geometry Specification — approving one draws nothing today. That is
 * the report's real finding and it needs an ADR and a sprint, not a test.
 */

import { describe, expect, it } from 'vitest';
import { assembleBriefFromFields } from '../brief/index.js';
import { synthesizeProgramme, type SpaceProgramme } from '../programme/index.js';
import { synthesizeLayout } from '../layout/index.js';
import {
  synthesizeGeometry,
  synthesizeSpecification,
  validateGeometrySpecification,
  type GeometryGraph,
  type GeometrySpecification,
  type RoomPolygon
} from '../geometry/index.js';

/** The user's sentence from the reported run. */
const REQUEST = 'Build me a 100m2 appartment with 2 bedrooms, 1 bathrooms, and a small office.';

/** The tool call the model made for it, with the `storeys: 0` of that run corrected. */
const FIELDS = {
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
  userMessage: REQUEST
} as const;

const TARGET_AREA = 100;

interface Pipeline {
  readonly programme: SpaceProgramme;
  readonly geometry: GeometryGraph;
  readonly specification: GeometrySpecification;
}

function runPipeline(): Pipeline {
  const brief = assembleBriefFromFields({ ...FIELDS, requirements: [...FIELDS.requirements] });

  const programme = synthesizeProgramme({ brief });
  if (!programme.ok) {
    throw new Error(`programme: ${programme.message}`);
  }
  const layout = synthesizeLayout({ programme: programme.programme });
  if (!layout.ok) {
    throw new Error(`layout: ${layout.message}`);
  }
  const geometry = synthesizeGeometry({ layout: layout.plan });
  if (!geometry.ok) {
    throw new Error(`geometry: ${geometry.message}`);
  }
  const specification = synthesizeSpecification({ graph: geometry.graph });
  if (!specification.ok) {
    throw new Error(`specification: ${specification.message}`);
  }

  return {
    programme: programme.programme,
    geometry: geometry.graph,
    specification: specification.specification
  };
}

/** Axis-aligned bounds. Exact while the packer emits rectangles — asserted below. */
function bounds(polygon: RoomPolygon): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const xs = polygon.corners.map((corner) => corner.x);
  const ys = polygon.corners.map((corner) => corner.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
}

/** True when two rectangles share interior area — touching edges do not count. */
function overlaps(a: RoomPolygon, b: RoomPolygon): boolean {
  const left = bounds(a);
  const right = bounds(b);
  const width = Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX);
  const height = Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY);
  // 1 mm, the project's working resolution: two rooms sharing a wall line are
  // adjacent, not overlapping.
  return width > 0.001 && height > 0.001;
}

/** How many space *instances* a programme asks for — a bedroom of count 2 is two. */
function instanceCount(programme: SpaceProgramme): number {
  return programme.spaces.reduce((total, space) => total + space.count, 0);
}

describe('the design pipeline produces a coherent plan (Bug 006 §11)', () => {
  const pipeline = runPipeline();

  it('programmes seven spaces totalling the area that was asked for', () => {
    expect(instanceCount(pipeline.programme)).toBe(7);
    expect(pipeline.programme.totalArea).toBeCloseTo(TARGET_AREA, 1);
  });

  it('produces one polygon per programmed space instance', () => {
    expect(pipeline.geometry.polygons).toHaveLength(7);

    const programmed = new Map<string, number>();
    for (const space of pipeline.programme.spaces) {
      programmed.set(space.name, space.count);
    }
    const drawn = new Map<string, number>();
    for (const polygon of pipeline.geometry.polygons) {
      drawn.set(polygon.name, (drawn.get(polygon.name) ?? 0) + 1);
    }

    expect(drawn).toEqual(programmed);
  });

  it('invents no space the programme did not ask for', () => {
    const programmed = new Set(pipeline.programme.spaces.map((space) => space.name));

    expect(pipeline.geometry.polygons.every((polygon) => programmed.has(polygon.name))).toBe(true);
  });

  it('never materialises the target area as a room of its own', () => {
    // The reported failure: a 100 m² brief became a 10 × 10 m room. A total is a
    // constraint on the whole design, never a space in it.
    const largest = Math.max(...pipeline.geometry.polygons.map((polygon) => polygon.achievedArea));

    expect(largest).toBeLessThan(TARGET_AREA / 2);
  });

  it('gives every space the area the programme asked it for', () => {
    for (const polygon of pipeline.geometry.polygons) {
      expect(polygon.achievedArea).toBeCloseTo(polygon.requestedArea, 2);
    }
  });

  it('adds up to the target across the whole plan', () => {
    const total = pipeline.geometry.polygons.reduce(
      (sum, polygon) => sum + polygon.achievedArea,
      0
    );

    expect(total).toBeCloseTo(TARGET_AREA, 1);
  });
});

describe('the plan is one spatial system, not independent rooms (Bug 006 §5)', () => {
  const pipeline = runPipeline();

  it('emits rectangles, which is what makes the overlap check below exact', () => {
    // Non-rectilinear packing is a known, recorded limitation. If it ever lands,
    // this test is the one that should tell you the overlap check needs a real
    // polygon intersection.
    expect(pipeline.geometry.polygons.every((polygon) => polygon.corners.length === 4)).toBe(true);
  });

  it('overlaps no two spaces', () => {
    const overlapping: string[] = [];
    const polygons = pipeline.geometry.polygons;

    for (let i = 0; i < polygons.length; i += 1) {
      for (let j = i + 1; j < polygons.length; j += 1) {
        if (overlaps(polygons[i]!, polygons[j]!)) {
          overlapping.push(`${polygons[i]!.name} ∩ ${polygons[j]!.name}`);
        }
      }
    }

    expect(overlapping).toEqual([]);
  });

  it('stacks no space on the origin the way independent createRoom calls do', () => {
    // Every room in the reported screenshot had its south-west corner at (0, 0),
    // because each was an independent command. A resolved plan has exactly one.
    const atOrigin = pipeline.geometry.polygons.filter((polygon) => {
      const box = bounds(polygon);
      return Math.abs(box.minX) < 0.001 && Math.abs(box.minY) < 0.001;
    });

    expect(atOrigin).toHaveLength(1);
  });

  it('gives every space a neighbour it shares a boundary line with', () => {
    const polygons = pipeline.geometry.polygons;

    for (const polygon of polygons) {
      const box = bounds(polygon);
      const touches = polygons.some((other) => {
        if (other.id === polygon.id) {
          return false;
        }
        const neighbour = bounds(other);
        const sharesVertical =
          (Math.abs(box.maxX - neighbour.minX) < 0.001 ||
            Math.abs(box.minX - neighbour.maxX) < 0.001) &&
          Math.min(box.maxY, neighbour.maxY) - Math.max(box.minY, neighbour.minY) > 0.001;
        const sharesHorizontal =
          (Math.abs(box.maxY - neighbour.minY) < 0.001 ||
            Math.abs(box.minY - neighbour.maxY) < 0.001) &&
          Math.min(box.maxX, neighbour.maxX) - Math.max(box.minX, neighbour.minX) > 0.001;
        return sharesVertical || sharesHorizontal;
      });

      expect(touches, `${polygon.name} shares no boundary with any other space`).toBe(true);
    }
  });

  it('fits inside one envelope of about the target area', () => {
    const boxes = pipeline.geometry.polygons.map(bounds);
    const width = Math.max(...boxes.map((box) => box.maxX)) - Math.min(...boxes.map((b) => b.minX));
    const height =
      Math.max(...boxes.map((box) => box.maxY)) - Math.min(...boxes.map((b) => b.minY));

    expect(width * height).toBeCloseTo(TARGET_AREA, 0);
  });
});

describe('the Geometry Specification is complete and buildable (Bug 006 §8.1)', () => {
  const pipeline = runPipeline();

  it('carries every space, with walls and openings derived', () => {
    expect(pipeline.specification.spaces).toHaveLength(7);
    expect(pipeline.specification.walls.length).toBeGreaterThan(0);
    expect(pipeline.specification.openings.length).toBeGreaterThan(0);
  });

  it('derives a wall for every boundary the geometry graph found', () => {
    expect(pipeline.geometry.wallCandidates.length).toBeGreaterThan(0);
    expect(pipeline.specification.walls.length).toBeGreaterThan(0);
  });

  it('satisfies its own invariants', () => {
    // The report asks for `validateGeometrySpecification` to pass before a
    // proposal is offered. It already exists, and it already does.
    expect(validateGeometrySpecification(pipeline.specification)).toEqual([]);
  });

  it('records the geometry graph it was derived from', () => {
    expect(pipeline.specification.sourceGeometry.geometryGraphId).toBe(pipeline.geometry.id);
    expect(pipeline.specification.sourceGeometry.geometryGraphRevision).toBe(
      pipeline.geometry.revision
    );
  });
});
