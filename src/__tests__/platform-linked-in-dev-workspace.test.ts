/**
 * In the development workspace, the platform must be the one on disk
 * (the other direction of finding I-97).
 *
 * This package declares the seven platform packages at a semver range in both
 * `devDependencies` and `peerDependencies`, and the local workspace splices the
 * platform repository in so that day-to-day work needs no publish. pnpm honours
 * those links **only while the local versions satisfy the ranges**. The
 * workspace README says what happens when they stop, and says it about this
 * direction explicitly:
 *
 * > "The same trap applies in the other direction… if the local platform ever
 * > moves to `0.3.0`, those ranges need widening too or the reasoning layer
 * > silently builds against npm."
 *
 * The host side of this already bit once, for four sprints: `apps/web` sat on
 * `^0.1.0` while this package moved to `0.2.0`, and sixteen failing tests were
 * treated as an untouchable baseline. This side has not bitten yet. That is the
 * only difference between the two, and it is not a reason to wait.
 *
 * ## Why it skips outside the workspace
 *
 * Because npm resolution is **correct** there — CI installs from this repo's
 * own root and builds against the published platform, which is the arrangement
 * ADR-0030 exists to keep honest. The check is conditional on its own premise:
 * *if the platform repository is on disk beside this one, we are in the
 * development workspace, and the links are the whole point of being here.*
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = fileURLToPath(new URL('.', import.meta.url));
/** `.../architectural-intelligence` — this repository's root. */
const repoRoot = resolve(here, '../..');
/** The platform repository, present only in the local development workspace. */
const platformRepo = resolve(repoRoot, '../archisimple');

/** The packages this layer builds against, and where each lives in the platform. */
const PLATFORM_PACKAGES = [
  'ai-engine',
  'automation-api',
  'building-model',
  'inspector',
  'shared',
  'skills',
  'spatial'
] as const;

const declaredRange = (name: string): string => {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
    devDependencies?: Record<string, string>;
  };
  return manifest.devDependencies?.[`@archisimple/${name}`] ?? '(not declared)';
};

const localVersion = (name: string): string =>
  (
    JSON.parse(
      readFileSync(resolve(platformRepo, 'packages', name, 'package.json'), 'utf8')
    ) as { version: string }
  ).version;

describe('the platform, in the development workspace', () => {
  const inDevWorkspace = existsSync(platformRepo);

  it.runIf(inDevWorkspace).each([...PLATFORM_PACKAGES])(
    '@archisimple/%s resolves to the platform repository, not a published copy',
    (name) => {
      const installed = resolve(repoRoot, 'node_modules/@archisimple', name);
      expect(existsSync(installed), `${installed} is not installed at all`).toBe(true);

      const resolved = realpathSync(installed);
      const expected = realpathSync(resolve(platformRepo, 'packages', name));

      expect(
        resolved,
        [
          '',
          `This layer is not building against the local @archisimple/${name}.`,
          '',
          `  declared range   ${declaredRange(name)}`,
          `  local version    ${localVersion(name)}`,
          `  resolved to      ${resolved}`,
          `  expected         ${expected}`,
          '',
          'pnpm links a local package only while its version satisfies the',
          'declared range. When it stops, the published copy is installed in',
          'silence — the build succeeds and this layer is written against a',
          'platform that no longer exists (finding I-97, other direction).',
          '',
          'Fix: widen the range in package.json — devDependencies *and*',
          'peerDependencies — then reinstall from the workspace root.',
          ''
        ].join('\n')
      ).toBe(expected);
    }
  );

  it.runIf(!inDevWorkspace)('says nothing outside the workspace, where npm is correct', () => {
    expect(inDevWorkspace).toBe(false);
  });
});
