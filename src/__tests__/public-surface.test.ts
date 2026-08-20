/**
 * The package root is the public surface (Sprint 1.10c).
 *
 * ## The bug this exists to prevent
 *
 * `src/index.ts` re-exports each subsystem's barrel by hand. Sprints 1.10 and
 * 1.10b added `SuppliedTextRun` and `isAutomaticallyEligible` to
 * `reading/index.ts` and did not add them here, so both were **unreachable to
 * every consumer of this package** — one of them the element type a host needs
 * to build `ReadPlanRequest.documentText` at all, the other the only published
 * statement of what the confidence threshold means.
 *
 * Nothing caught it. Every test in this repository imports from a relative path,
 * so the root barrel is the one file the suite never exercises, and a missing
 * line there is invisible from the inside. ArchiSimple Sprint 046.7x found it by
 * trying to consume the package the way a host does.
 *
 * ## Why it is checked twice
 *
 * A **runtime** comparison of module namespaces catches missing values. It
 * cannot see types at all — types are erased — and `SuppliedTextRun` is a type,
 * so a runtime check alone would still have missed half the defect. The
 * **source** comparison catches both, and is the assertion that matters.
 *
 * Scoped to `reading/` deliberately. This is the surface a separate repository
 * consumes across a released version boundary, and the one where an omission is
 * discovered by a stranger rather than by us.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as root from '../index.js';
import * as reading from '../reading/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(resolve(here, '..', relative), 'utf8');

/** Every identifier an `export { ... } from '...'` block names. */
function exportedNames(source: string, fromSpecifier?: string): Set<string> {
  const names = new Set<string>();
  const blocks = source.matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g);
  for (const [, body, specifier] of blocks) {
    if (body === undefined) continue;
    if (fromSpecifier !== undefined && specifier !== fromSpecifier) continue;
    for (const entry of body.split(',')) {
      const name = entry
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name !== undefined && name !== '') names.add(name);
    }
  }
  return names;
}

describe('the root barrel mirrors the reading barrel', () => {
  it('re-exports every name, values and types alike', () => {
    const inReading = exportedNames(read('reading/index.ts'));
    const atRoot = exportedNames(read('index.ts'), './reading/index.js');

    expect(inReading.size).toBeGreaterThan(0);
    const missing = [...inReading].filter((name) => !atRoot.has(name)).sort();
    expect(missing).toEqual([]);
  });

  it('re-exports every runtime value, as a second net under the first', () => {
    // Narrower than the source check — it cannot see types — but it fails even
    // if someone rewrites the barrel in a form the regex above stops matching.
    const values = Object.keys(reading).filter((name) => name !== 'default');
    const missing = values.filter((name) => !(name in root)).sort();

    expect(values.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it('publishes the two the host actually needs, by name', () => {
    // Named rather than merely covered by the sweep above: these are the two
    // that were missing, and a regression on either is a host that cannot
    // supply document text or cannot ask what the threshold means.
    expect(typeof root.isAutomaticallyEligible).toBe('function');
    expect(typeof root.readPlan).toBe('function');
    expect(exportedNames(read('index.ts'), './reading/index.js')).toContain('SuppliedTextRun');
  });
});
