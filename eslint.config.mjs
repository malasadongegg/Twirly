import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', 'native/**/bin/**', 'native/**/obj/**', 'tests/.tmp/**', 'apps/desktop/src/renderer/public/**', 'brag-output/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { Buffer: 'readonly', console: 'readonly', process: 'readonly', fetch: 'readonly' } },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'packages/core/**/*.ts', 'packages/shared/**/*.ts'],
    ignores: ['packages/core/node/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['node:*', 'electron', 'fs', 'path', 'child_process', 'sharp', '@processing/*'] }],
    },
  },
)
