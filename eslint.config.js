import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

/**
 * ESLint flat config.
 *
 * Beyond the usual strictness, this config enforces one boundary: the
 * conversion libraries (mammoth, turndown) may only be imported inside
 * `src/convert/mammoth-adapter.ts`. Everything else goes through the
 * `src/convert` facade, so the converter can be replaced without touching
 * the CLI, the file layout or git handling.
 */
export default tseslint.config(
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `await` on non-promises is usually a bug, and floating promises hide failures.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    },
  },
  // Facade: mammoth and turndown are implementation details of src/convert.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/convert/mammoth-adapter.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['mammoth', 'turndown'].map((name) => ({
            name,
            message:
              'Import from ./convert instead. The conversion libraries are an implementation detail behind the convert facade.',
          })),
        },
      ],
    },
  },
  // bun:test's `expect(...).rejects` matchers must be awaited at runtime but
  // are typed as non-thenable — keep the awaits, silence the false positive.
  {
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/await-thenable': 'off',
    },
  },
  // Config files at the repo root are not part of the typed project service.
  {
    files: ['eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettierConfig,
);
