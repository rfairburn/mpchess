const js = require('@eslint/js');
const prettierPlugin = require('eslint-plugin-prettier');
const prettierConfig = require('eslint-config-prettier');

// ── Shared globals (composed per-block to avoid duplication) ──

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearTimeout: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
};

const nodeCjsGlobals = {
  ...nodeGlobals,
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  require: 'readonly',
  module: 'readonly',
  exports: 'readonly',
  __require: 'readonly',
  URL: 'readonly',
  WebSocket: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  location: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearTimeout: 'readonly',
  clearInterval: 'readonly',
  fetch: 'readonly',
  Blob: 'readonly',
  URL: 'readonly',
  HTMLElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  HTMLDivElement: 'readonly',
  HTMLSelectElement: 'readonly',
  HTMLImageElement: 'readonly',
  MouseEvent: 'readonly',
  KeyboardEvent: 'readonly',
  Event: 'readonly',
  ErrorEvent: 'readonly',
  CustomEvent: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  performance: 'readonly',
  WebSocket: 'readonly',
  FileReader: 'readonly',
  Headers: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  AbortController: 'readonly',
  THREE: 'readonly',
  queueMicrotask: 'readonly',
};

const testGlobals = {
  describe: 'readonly',
  test: 'readonly',
  assert: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  expect: 'readonly',
  vi: 'readonly',
  it: 'readonly',
};

module.exports = [
  js.configs.recommended,
  prettierConfig,
  {
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeCjsGlobals,
    },
  },
  // ESM scripts
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  // Client files — browser environment
  {
    files: ['client/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
    },
  },
  // Test files — looser rules (unused vars common in test setup)
  {
    files: ['test/**/*.js'],
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'off',
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...nodeCjsGlobals, ...testGlobals },
    },
  },
  // Client test files — ESM + jsdom globals
  {
    files: ['test/client/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...browserGlobals, ...testGlobals },
    },
  },
  // Ignore auto-generated files and config files
  {
    ignores: [
      'shared/chess.mjs',
      'client/chess.mjs',
      'client/vendor/',
      'node_modules/',
      'coverage/',
      'dist/',
      'vitest.config.js',
    ],
  },
];
