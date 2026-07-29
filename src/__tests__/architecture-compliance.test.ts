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
