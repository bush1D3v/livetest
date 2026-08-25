/**
 * Superficie **cliente** do Live Test Runner.
 *
 * Contem apenas o necessario para *consumir* um daemon em execucao: conectar ao
 * canal de eventos, ler o arquivo de descoberta, formatar motivos e tipos.
 *
 * Existe separada de `@livetest/core` por uma razao pratica: o indice principal
 * arrasta o motor inteiro, incluindo o compilador TypeScript usado pelo grafo
 * JS/TS. Um consumidor que so le eventos — a extensao do VSCode, um dashboard,
 * um script de CI — nao deve pagar por isso. Importar daqui reduz o bundle da
 * extensao de ~9 MB para poucas dezenas de KB.
 *
 * @example
 * ```ts
 * import { connectToDaemon, readDiscoveryFile } from '@livetest/core/client';
 *
 * if (readDiscoveryFile('.livetest/daemon.json', root).status === 'running') {
 *   await connectToDaemon({ root, onEvent: (event) => console.log(event.type) });
 * }
 * ```
 *
 * @packageDocumentation
 */

export { connectToDaemon, createLineSplitter } from './server/client.js';
export type { ConnectOptions, DaemonConnection } from './server/client.js';
export {
  isProcessAlive,
  readDiscoveryFile,
  removeDiscoveryFile,
  writeDiscoveryFile,
} from './server/discovery.js';
export type { DiscoveryResult } from './server/discovery.js';

export { summarizeReason } from './planner/planner.js';
export { normalizePath, relativeToRoot, toPosix } from './util/paths.js';
export { LiveTestError } from './util/errors.js';
export type { LiveTestErrorCode } from './util/errors.js';

export { EVENT_PROTOCOL_VERSION } from './types/events.js';
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
export type {
  BatchResult,
  SelectionReason,
  TestCaseResult,
  TestCaseStatus,
  TestCounts,
  TestRunResult,
  TestRunStatus,
} from './types/results.js';
export type { DependencyDepth } from './types/config.js';
