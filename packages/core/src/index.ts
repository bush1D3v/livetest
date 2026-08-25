/**
 * Live Test Runner — core.
 *
 * Motor agnostico de linguagem que observa arquivos, resolve o impacto de cada
 * alteracao no grafo de dependencias e executa apenas os testes relevantes,
 * publicando o resultado em tres canais: stdout, log NDJSON e um socket local
 * consumido pela extensao do VSCode.
 *
 * @example Uso minimo
 * ```ts
 * import { createEngine, loadConfig } from '@livetest/core';
 *
 * const { config } = await loadConfig({ cwd: process.cwd() });
 * const engine = createEngine({ config });
 *
 * engine.subscribe((event) => {
 *   if (event.type === 'batch.finished') console.log(event.result.status);
 * });
 *
 * await engine.start();
 * ```
 *
 * @packageDocumentation
 */

/* ── Motor ────────────────────────────────────────────────────────────── */
export { ENGINE_VERSION, createEngine } from './engine.js';
export type { EngineOptions, EngineStartResult, LiveTestEngine } from './engine.js';

/* ── Configuracao ─────────────────────────────────────────────────────── */
export {
  findConfigFile,
  loadConfig,
  defaultPythonPath,
  mergeRunnerConfig,
  mergeUserConfig,
  readConfigFile,
  resolveConfig,
  stripJsonComments,
} from './config/load.js';
export type { LoadConfigOptions, LoadConfigResult } from './config/load.js';
export {
  assertValidUserConfig,
  depthToNumber,
  describeDepth,
  isDependencyDepth,
  validateUserConfig,
} from './config/validate.js';
export type { ValidationResult } from './config/validate.js';
export { resolveDepthForFile } from './config/depth.js';
export type { ResolvedDepth } from './config/depth.js';
export { parseGitignore, readGitignore } from './config/gitignore.js';
export type { GitignoreResult } from './config/gitignore.js';
export * from './config/defaults.js';

/* ── Tipos publicos ───────────────────────────────────────────────────── */
export type {
  BuiltinGraphAdapterId,
  BuiltinRunnerAdapterId,
  DebounceConfig,
  DebounceMode,
  DependencyDepth,
  DependencyDepthConfig,
  LiveTestUserConfig,
  LogLevel,
  OutputConfig,
  ResolvedConfig,
  RunnerConfig,
  ServerConfig,
} from './types/config.js';
export type {
  BatchFinishedEvent,
  BatchStartedEvent,
  DaemonDiscoveryInfo,
  DaemonSnapshot,
  DaemonStartedEvent,
  DaemonStoppedEvent,
  ErrorEvent,
  EventListener,
  EventOfType,
  FileChangeKind,
  FileStatus,
  LiveTestEvent,
  LiveTestEventType,
  RunFinishedEvent,
  RunStartedEvent,
  SnapshotEvent,
  WatchChangeEvent,
} from './types/events.js';
export { EVENT_PROTOCOL_VERSION } from './types/events.js';
export type {
  BatchResult,
  SelectionReason,
  TestCaseResult,
  TestCaseStatus,
  TestCounts,
  TestRunResult,
  TestRunStatus,
} from './types/results.js';
export type {
  DependencyGraphAdapter,
  DependencyGraphAdapterFactory,
  FileImports,
  GraphAdapterContext,
  ImpactedFile,
} from './types/graph.js';
export type {
  RunnerAdapterContext,
  RunnerInvocation,
  RunnerParseResult,
  RunnerProcessOutput,
  TestRunnerAdapter,
  TestRunnerAdapterFactory,
} from './types/runner.js';
export type { Logger } from './types/logging.js';

/* ── Grafo de dependencias ────────────────────────────────────────────── */
export { createDependencyGraph } from './graph/graph.js';
export type { DependencyGraph, DependencyGraphOptions } from './graph/graph.js';
export { BUILTIN_GRAPH_ADAPTERS, createGraphAdapters } from './graph/registry.js';
export { createJsTsGraphAdapter, loadCompilerOptions } from './graph/jsts/adapter.js';
export { createPythonGraphAdapter } from './graph/python/adapter.js';
export {
  createAstPythonExtractor,
  createRegexPythonExtractor,
  parsePythonImports,
} from './graph/python/extractor.js';
export type { PythonImportExtractor, PythonImportRecord } from './graph/python/extractor.js';
export { findPackageRoot, resolveAllImports, resolveImportRecord } from './graph/python/resolve.js';

/* ── Mapeamento de testes e planejamento ──────────────────────────────── */
export { createTestFileResolver, expandTemplate } from './testmap/resolver.js';
export type { TestFileResolver, TestMapping } from './testmap/resolver.js';
export { planBatch, summarizeReason } from './planner/planner.js';
export type { RunPlan, RunPlanEntry, UnmatchedFile } from './planner/planner.js';

/* ── Execucao ─────────────────────────────────────────────────────────── */
export { executeRun, formatCommand, tailLines } from './runner/executor.js';
export type { ExecuteRunOptions } from './runner/executor.js';
export { BUILTIN_RUNNER_ADAPTERS, createRunnerAdapter } from './runner/registry.js';
export { createCommandAdapter } from './runner/adapters/command.js';
export { createJestAdapter, createVitestAdapter } from './runner/adapters/jest-like.js';
export { createPytestAdapter } from './runner/adapters/pytest.js';
export { parseJestLikeJson } from './runner/parsers/jest-like.js';
export { parseJUnitXml } from './runner/parsers/junit-xml.js';
export { needsShell, quoteForShell, runProcess } from './runner/process.js';
export type { ProcessResult, RunProcessOptions } from './runner/process.js';

/* ── Observacao e debounce ────────────────────────────────────────────── */
export { chokidarWatcherFactory, createFileWatcher } from './watch/watcher.js';
export type {
  FileWatcher,
  FileWatcherOptions,
  UnderlyingWatcher,
  WatcherFactory,
} from './watch/watcher.js';
export { createDebouncer } from './watch/debouncer.js';
export type { Debouncer, DebouncerOptions, FlushTrigger, TimerApi } from './watch/debouncer.js';

/* ── Eventos, estado e saidas ─────────────────────────────────────────── */
export { createEventBus } from './events/bus.js';
export type { EventBus, LiveTestEventInput } from './events/bus.js';
export { createStateStore } from './state/store.js';
export type { StateStore } from './state/store.js';
export { aggregateBatch, deriveBatchStatus, sumCounts } from './state/aggregate.js';
export {
  SUMMARY_PREFIX,
  cleanFailureMessage,
  createPrettyReporter,
  formatSummaryLine,
} from './report/pretty.js';
export type { PrettyReporter, PrettyReporterOptions } from './report/pretty.js';
export { createNdjsonLogger, createStatusFileWriter } from './report/files.js';
export type { NdjsonLogger, StatusFileWriter } from './report/files.js';

/* ── Canal de eventos ─────────────────────────────────────────────────── */
export { createEventServer, encodeEvent, resolveServerAddress } from './server/event-server.js';
export type { EventServer, ServerAddress } from './server/event-server.js';
export { connectToDaemon, createLineSplitter } from './server/client.js';
export type { ConnectOptions, DaemonConnection } from './server/client.js';
export {
  isProcessAlive,
  readDiscoveryFile,
  removeDiscoveryFile,
  writeDiscoveryFile,
} from './server/discovery.js';
export type { DiscoveryResult } from './server/discovery.js';

/* ── Utilitarios ──────────────────────────────────────────────────────── */
export { LiveTestError } from './util/errors.js';
export type { LiveTestErrorCode } from './util/errors.js';
export { createLogger, noopLogger } from './util/logger.js';
export type { CreateLoggerOptions, LogSink } from './util/logger.js';
export { normalizePath, relativeToRoot, toPosix } from './util/paths.js';
