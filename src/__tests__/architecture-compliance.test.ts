/**
 * Architecture compliance (Sprint 24.5, Architecture § Definition of Done).
 *
 * A static scan of the production sources, mirroring the ones `ai-engine` and
 * `automation-mcp` already run. Behavioural tests cannot catch these: a
 * convenient `@archisimple/core` import compiles, passes everything, and is
 * only noticed when someone goes looking.
 *
 * Three claims are asserted here, and each is one of this sprint's own
 * architectural rules:
 *
 * 1. **No Runtime access.** Nothing may import `@archisimple/core`. This layer
 *    inherits ADR-0023 Rule 1 unchanged: it reaches the document only through
 *    the Automation API.
 * 2. **No execution.** No production file may hold or call a
 *    `CommandDispatcher`. "No Runtime modification occurs during reasoning"
 *    (Story 24.5.6) and "Automation remains the single execution mechanism"
 *    (Architecture Delta) are then structural facts rather than conventions —
 *    a plan carries Requests, and `AiSessionController` is what runs them.
 * 3. **No duplicated pipeline.** Nothing may import `@archisimple/automation-mcp`
 *    or stand up a dispatcher of its own.
 *
 * `__tests__/` is excluded: its harness legitimately builds a recording
 * dispatcher to prove which Requests a plan would run.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Exactly the packages the `architectural-intelligence-deps` rule permits. */
const ALLOWED_ARCHISIMPLE_PACKAGES = new Set([
  '@archisimple/ai-engine',
  '@archisimple/automation-api',
  '@archisimple/building-model',
  '@archisimple/inspector',
  '@archisimple/shared',
  // Sprint 27.9: the Space Programme derives target areas through the Skills
  // Platform rather than computing them here. ADR-0027 names this integration
  // path ("Option C — Skills called by the Planner (supported)"), and it holds
  // the layering: skills depend only on `geometry` and `shared`, mutate
  // nothing, and cannot reach the Automation API.
  '@archisimple/skills',
  '@archisimple/spatial'
]);

function productionSources(): { path: string; source: string }[] {
  const files: { path: string; source: string }[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === '__tests__') {
        continue;
      }
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, `${prefix}${entry}/`);
      } else if (entry.endsWith('.ts')) {
        files.push({ path: `${prefix}${entry}`, source: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(SRC_DIR, '');
  return files;
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]!);
}

/** Strips block comments, so a doc comment naming a forbidden symbol is not a violation. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('architectural-intelligence reasons but never executes', () => {
  const sources = productionSources();

  it('finds the production sources', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(sources.map((file) => file.path))(
    '%s imports only the packages its layer may depend on',
    (path) => {
      const file = sources.find((candidate) => candidate.path === path)!;

      for (const specifier of importsOf(file.source)) {
        if (specifier.startsWith('@archisimple/')) {
          expect(ALLOWED_ARCHISIMPLE_PACKAGES.has(specifier)).toBe(true);
        }
      }
    }
  );

  it.each(sources.map((file) => file.path))('%s holds no command dispatcher', (path) => {
    const file = sources.find((candidate) => candidate.path === path)!;

    expect(code(file.source)).not.toMatch(/\bCommandDispatcher\b/);
    expect(code(file.source)).not.toMatch(/\bcommands\.execute\b/);
  });

  it.each(sources.map((file) => file.path))('%s touches no platform storage API', (path) => {
    const file = sources.find((candidate) => candidate.path === path)!;

    expect(file.source).not.toMatch(/\blocalStorage[.[]/);
    expect(file.source).not.toMatch(/\bsessionStorage[.[]/);
  });

  /**
   * ADR-0027.1 Rule 3 — one responsibility per artefact.
   *
   * The Brief owns intent, the Programme owns the logical building, the Layout
   * owns the arrangement, and the Geometry Plan owns geometry. What keeps them
   * apart is not anyone's discipline: an upstream artefact *cannot* carry a
   * `CommandRequest` or reach `@archisimple/geometry`, because of what these
   * modules are allowed to import.
   *
   * The `*-proposal.ts` files are the deliberate exceptions — each is the bridge
   * to the AI Workspace's `Proposal`, not part of the artefact it wraps.
   *
   * `@archisimple/skills` is permitted and load-bearing: the Programme's areas
   * and the Layout's arrangement are computed there (Rule 9), and skills reach
   * neither the Automation API nor the document, so the seam holds.
   *
   * `geometry/` is **not** in this list, and has its own inverted rule below —
   * that stage is where coordinates legitimately begin. Leaving it merely
   * unlisted would have meant the one module whose boundary matters most was
   * asserted by nothing.
   */
  describe('planning artefacts own no geometry (ADR-0027.1 Rule 3)', () => {
    const ARTEFACT_DIRECTORIES = ['brief/', 'programme/', 'layout/'];
    const artefactSources = sources.filter(
      (file) =>
        ARTEFACT_DIRECTORIES.some((directory) => file.path.startsWith(directory)) &&
        !file.path.endsWith('-proposal.ts')
    );

    it('covers every artefact module', () => {
      for (const directory of ARTEFACT_DIRECTORIES) {
        expect(artefactSources.some((file) => file.path.startsWith(directory))).toBe(true);
      }
    });

    it.each(artefactSources.map((file) => file.path))(
      '%s imports no execution vocabulary',
      (path) => {
        const file = artefactSources.find((candidate) => candidate.path === path)!;

        for (const specifier of importsOf(file.source)) {
          expect(specifier).not.toBe('@archisimple/automation-api');
          expect(specifier).not.toBe('@archisimple/geometry');
        }
        expect(code(file.source)).not.toMatch(/\bCommandRequest\b/);
      }
    );

    it.each(artefactSources.map((file) => file.path))(
      '%s names no coordinate vocabulary',
      (path) => {
        const file = artefactSources.find((candidate) => candidate.path === path)!;

        // An artefact that grew an x/y pair would have become geometry without
        // anyone deciding to let it.
        expect(code(file.source)).not.toMatch(/\bPoint2D\b|\bPoint3D\b/);
        expect(code(file.source)).not.toMatch(/\breadonly\s+(x|y)\s*:/);
      }
    );
  });

  /**
   * ADR-0027.1 Rule 3, from the other side (Sprint 28.1a).
   *
   * The Geometry Graph is the stage where coordinates legitimately begin, so the
   * rule its neighbours live under is exactly inverted here: `Point2D` and
   * `@archisimple/geometry` are **permitted**, because that is the whole point
   * of the stage.
   *
   * What stays forbidden is the stage *below* it. A `CommandRequest` or an
   * `automation-api` import would mean the Geometry Graph had quietly become the
   * Geometry Plan — walls with thickness and the Requests that build them — one
   * sprint early and without anyone deciding to.
   *
   * A test that asserts the opposite of its neighbours is right here: the rule
   * was never "no geometry anywhere", it is "geometry starts precisely here".
   */
  describe('the Geometry Graph owns coordinates but not execution (Rule 3)', () => {
    /**
     * Every source in `geometry/`. Since Sprint 1.1 the directory holds two
     * artefacts, so the assertions below split: what is true of *both* stages is
     * asserted over all of them, and thickness — true only of the Graph — is
     * asserted over the Graph's own files.
     */
    const geometrySources = sources.filter(
      (file) => file.path.startsWith('geometry/') && !file.path.endsWith('-proposal.ts')
    );

    /**
     * The Geometry Graph's own files.
     *
     * Named rather than pattern-matched: the list is short, and a new file
     * silently joining the set it must not join is exactly what this test exists
     * to prevent.
     */
    const graphSources = geometrySources.filter((file) =>
      [
        'geometry/geometry-graph.ts',
        'geometry/geometry-synthesis.ts',
        'geometry/geometry-evaluation.ts'
      ].includes(file.path)
    );

    it('finds the geometry sources', () => {
      expect(geometrySources.length).toBeGreaterThan(0);
      expect(graphSources).toHaveLength(3);
    });

    it.each(geometrySources.map((file) => file.path))(
      '%s reaches no execution boundary',
      (path) => {
        const file = geometrySources.find((candidate) => candidate.path === path)!;

        for (const specifier of importsOf(file.source)) {
          expect(specifier).not.toBe('@archisimple/automation-api');
          expect(specifier).not.toBe('@archisimple/core');
        }
        expect(code(file.source)).not.toMatch(/\bCommandRequest\b/);
      }
    );

    /**
     * Thickness is one stage down, and since Sprint 1.1 that stage exists.
     *
     * The rule is unchanged — a Geometry Graph that knew a wall's thickness
     * would have collapsed two artefacts into one, and constraint optimisation
     * could then re-thicken a wall a user approved (ADR-0027.1 Rule 13). What
     * changed is only that the Geometry *Specification* now legitimately owns
     * the word, in the same directory.
     */
    it('the Geometry Graph carries no wall thickness — that belongs to the Specification', () => {
      for (const file of graphSources) {
        expect(code(file.source)).not.toMatch(/\bthickness\b/);
      }
    });

    it('reaches geometry through skills rather than importing it directly', () => {
      // `@archisimple/geometry` is permitted by the layering, but every
      // computation this stage needs already has a home in skills (Rule 9), and
      // a direct import would be the first step towards a second one.
      for (const file of geometrySources) {
        expect(importsOf(file.source)).not.toContain('@archisimple/geometry');
      }
    });

    /**
     * ADR-AI-0001 Rule 1, asserted (Sprint 1.1, Story 1.1.14).
     *
     * The design pipeline **terminates in an artefact**. A `CommandRequest`
     * anywhere in `geometry/` would mean the Geometry Specification had started
     * emitting instructions instead of describing a building — which is the one
     * thing that would put this repository back inside somebody's CAD system.
     *
     * The Direct Execution lane is untouched by this and still emits Requests:
     * that is what `planning/operations/` is for, and the distinction is that a
     * command sequence carries no revision, assumption or approval, so none of
     * ADR-0027.1's rules can apply to one.
     */
    it('the design pipeline emits no Requests, at either geometry stage', () => {
      const proposals = sources.filter(
        (file) => file.path.startsWith('geometry/') && file.path.endsWith('-proposal.ts')
      );
      for (const file of [...geometrySources, ...proposals]) {
        expect(code(file.source)).not.toMatch(/\bCommandRequest\b/);
        expect(importsOf(file.source)).not.toContain('@archisimple/automation-api');
      }
    });
  });

  /**
   * ADR-AI-0002 Rule 1, asserted (Sprint 1.2, Story 1.2.19).
   *
   * The workflow state is a **projection**, and the single most attractive
   * change to it is to keep one around — a field on the service, a module-level
   * memo, a copy handed to the host at composition time. Each would be a stored
   * verdict about which revision is current, which goes stale the instant a
   * revision lands, and which a UI would trust anyway.
   *
   * Behavioural tests cannot catch this: a cached projection returns the right
   * answer for every test that builds its project up front, and the wrong one
   * for the user who revised a brief an hour into a session.
   */
  describe('the workflow state is derived, never stored', () => {
    it('is held in no field, module-level or otherwise', () => {
      for (const file of sources) {
        expect(code(file.source)).not.toMatch(
          /(?:private|protected|public|readonly|let|var)\s+\w+\s*:\s*ArchitecturalWorkflowState/
        );
      }
    });

    it('is never assigned to an instance or module binding', () => {
      for (const file of sources) {
        expect(code(file.source)).not.toMatch(
          /(?:this\.\w+|^\s*\w+)\s*=\s*(?:this\.)?(?:workflowState|deriveWorkflowState)\s*\(/m
        );
      }
    });

    /**
     * Sprint 1.4. The context fragment is the projection's second consumer and
     * the more tempting one to cache: it is collected on every turn, and a
     * fragment held between turns would report a design state the user has since
     * changed — to a *model*, which has no way to tell.
     */
    it('is not cached on its way into the context fragment', () => {
      for (const file of sources) {
        expect(code(file.source)).not.toMatch(/(?:this\.\w+|^\s*\w+)\s*=\s*describeDesign\s*\(/m);
        // Class fields and module bindings only — no bare `readonly`, because
        // `ArchitecturalContextFragment` legitimately declares one as an
        // interface member. The fragment *is* the per-turn value; holding one
        // between turns is the thing being forbidden, and that needs a class
        // field or a module binding to do.
        expect(code(file.source)).not.toMatch(
          /(?:private|protected|public|let|var)\s+(?:readonly\s+)?\w+\s*:\s*ArchitecturalDesignState/
        );
      }
    });
  });

  it('declares no runtime dependency outside its permitted layer', () => {
    const manifest = JSON.parse(readFileSync(join(SRC_DIR, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (dependency.startsWith('@archisimple/')) {
        expect(ALLOWED_ARCHISIMPLE_PACKAGES.has(dependency)).toBe(true);
      }
    }
  });
});
