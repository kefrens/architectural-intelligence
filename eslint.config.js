import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Standalone since Sprint 30.3. The ArchiSimple workspace supplied this config
 * through its root; the rules are the same, minus the two custom plugins
 * (`localization`, `theme`) which govern UI concerns this package has none of.
 *
 * Type-aware rules are scoped to `src/` because that is what `tsconfig.json`
 * includes. The config files are linted with the untyped rules — asking the
 * project service about a file the project does not contain is how you get
 * "not found by the project service".
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    }
  }
);
