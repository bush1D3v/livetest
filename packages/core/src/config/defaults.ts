/**
 * Valores padrao da configuracao.
 *
 * Os defaults foram escolhidos para que `livetest start` funcione sem nenhum
 * arquivo de configuracao em um projeto JS/TS ou Python com layout convencional.
 *
 * @packageDocumentation
 */

import type {
  DebounceConfig,
  DependencyDepthConfig,
  OutputConfig,
  RunnerConfig,
  ServerConfig,
} from '../types/config.js';

/** Extensoes JS/TS reconhecidas pelo runner `js`. */
export const JS_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
] as const;

/** Extensoes Python reconhecidas pelo runner `python`. */
export const PY_EXTENSIONS = ['.py', '.pyi'] as const;

/** Diretorios que nunca devem ser observados nem indexados. */
export const DEFAULT_IGNORE: readonly string[] = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.hg/**',
  '**/.svn/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/.livetest/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/__pycache__/**',
  '**/.pytest_cache/**',
  '**/.mypy_cache/**',
  '**/.ruff_cache/**',
  '**/.venv/**',
  '**/venv/**',
  '**/.tox/**',
  '**/target/**',
  '**/vendor/**',
  '**/*.min.js',
  '**/*.map',
];

/** Globs observados quando o usuario nao especifica `watch`. */
export const DEFAULT_WATCH: readonly string[] = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.mts',
  '**/*.cts',
  '**/*.js',
  '**/*.jsx',
  '**/*.mjs',
  '**/*.cjs',
  '**/*.py',
];

/** Templates padrao de arquivo de teste para JS/TS. */
export const DEFAULT_JS_TEST_PATTERNS: readonly string[] = [
  '{dir}/{name}.test.{ext}',
  '{dir}/{name}.spec.{ext}',
  '{dir}/__tests__/{name}.test.{ext}',
  '{dir}/__tests__/{name}.spec.{ext}',
  '{dir}/__tests__/{name}.{ext}',
  'test/{relDir}/{name}.test.{ext}',
  'test/{relDirTail}/{name}.test.{ext}',
  'tests/{relDir}/{name}.test.{ext}',
  'tests/{relDirTail}/{name}.test.{ext}',
];

/** Templates padrao de arquivo de teste para Python. */
export const DEFAULT_PY_TEST_PATTERNS: readonly string[] = [
  '{dir}/test_{name}.py',
  '{dir}/{name}_test.py',
  '{dir}/tests/test_{name}.py',
  'tests/{relDir}/test_{name}.py',
  'tests/{relDirTail}/test_{name}.py',
  'tests/test_{name}.py',
  'test/{relDirTail}/test_{name}.py',
];

/** Globs que identificam um arquivo JS/TS como sendo, ele proprio, um teste. */
export const DEFAULT_JS_TEST_MATCH: readonly string[] = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.test.mts',
  '**/*.test.cts',
  '**/*.test.js',
  '**/*.test.jsx',
  '**/*.test.mjs',
  '**/*.test.cjs',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.spec.mts',
  '**/*.spec.cts',
  '**/*.spec.js',
  '**/*.spec.jsx',
  '**/*.spec.mjs',
  '**/*.spec.cjs',
  '**/__tests__/**/*.ts',
  '**/__tests__/**/*.tsx',
  '**/__tests__/**/*.js',
  '**/__tests__/**/*.jsx',
];

/** Globs que identificam um arquivo Python como sendo, ele proprio, um teste. */
export const DEFAULT_PY_TEST_MATCH: readonly string[] = [
  '**/test_*.py',
  '**/*_test.py',
  '**/tests/**/*.py',
  '**/conftest.py',
];

/** Configuracao padrao do runner JS/TS. */
export const DEFAULT_JS_RUNNER: RunnerConfig = {
  adapter: 'vitest',
  match: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
  graph: 'js-ts',
  args: [],
  env: {},
  timeoutMs: 120_000,
  testPatterns: [...DEFAULT_JS_TEST_PATTERNS],
  testMatch: [...DEFAULT_JS_TEST_MATCH],
  testExtensions: ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'],
};

/** Configuracao padrao do runner Python. */
export const DEFAULT_PY_RUNNER: RunnerConfig = {
  adapter: 'pytest',
  match: ['**/*.py'],
  graph: 'python',
  args: [],
  env: {},
  timeoutMs: 120_000,
  testPatterns: [...DEFAULT_PY_TEST_PATTERNS],
  testMatch: [...DEFAULT_PY_TEST_MATCH],
  testExtensions: ['py'],
};

/** Politica padrao de profundidade: arquivo alterado + importadores diretos. */
export const DEFAULT_DEPENDENCY_DEPTH: DependencyDepthConfig = {
  default: 'direct',
  overrides: {},
};

/** Debounce padrao conforme secao 6.3 do PRD. */
export const DEFAULT_DEBOUNCE: DebounceConfig = {
  mode: 'both',
  idleMs: 400,
  maxBatchWindowMs: 3000,
};

/** Saidas padrao. */
export const DEFAULT_OUTPUT: OutputConfig = {
  logFile: '.livetest/run.log',
  statusFile: '.livetest/status.json',
  stdout: true,
  format: 'pretty',
  color: 'auto',
  logTailLines: 40,
};

/** Canal de eventos padrao: loopback, porta escolhida pelo SO. */
export const DEFAULT_SERVER: ServerConfig = {
  enabled: true,
  host: '127.0.0.1',
  port: 0,
  discoveryFile: '.livetest/daemon.json',
};

/** Nomes de arquivo de configuracao procurados na raiz, em ordem de prioridade. */
export const CONFIG_FILE_NAMES: readonly string[] = [
  'livetest.config.json',
  'livetest.config.mjs',
  'livetest.config.js',
  'livetest.config.cjs',
  '.livetestrc.json',
];

/** Numero padrao de execucoes de teste simultaneas. */
export const DEFAULT_CONCURRENCY = 2;
