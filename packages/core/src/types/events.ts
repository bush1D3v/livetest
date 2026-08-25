/**
 * Protocolo de eventos do daemon.
 *
 * Os eventos sao emitidos em tres canais:
 * 1. stdout (formatado para humano/IA);
 * 2. arquivo NDJSON append-only (`output.logFile`);
 * 3. socket TCP local em NDJSON (consumido pela extensao do VSCode).
 *
 * Todo evento possui `type`, `seq` (monotonico por daemon) e `timestamp`.
 * Consumidores devem ignorar `type` desconhecido — o protocolo e aditivo.
 *
 * @packageDocumentation
 */

import type { BatchResult, SelectionReason, TestRunResult } from './results.js';

/** Versao do protocolo de eventos. Incrementada em mudancas incompativeis. */
export const EVENT_PROTOCOL_VERSION = 1;

/** Tipo de alteracao detectada no sistema de arquivos. */
export type FileChangeKind = 'add' | 'change' | 'unlink';

/** Campos presentes em todo evento. */
export interface EventBase {
  /** Numero de sequencia monotonico, comecando em 1. */
  seq: number;
  /** Epoch em milissegundos. */
  timestamp: number;
}

/** O daemon subiu e esta observando arquivos. */
export interface DaemonStartedEvent extends EventBase {
  type: 'daemon.started';
  pid: number;
  root: string;
  version: string;
  protocolVersion: number;
  /** Endereco do canal de eventos, se habilitado. */
  server: { host: string; port: number } | null;
  configPath: string | null;
  /** Quantidade de arquivos indexados no grafo inicial. */
  indexedFiles: number;
}

/** O daemon esta encerrando. */
export interface DaemonStoppedEvent extends EventBase {
  type: 'daemon.stopped';
  reason: string;
}

/** Um arquivo observado mudou. */
export interface WatchChangeEvent extends EventBase {
  type: 'watch.change';
  path: string;
  kind: FileChangeKind;
}

/** Um lote foi fechado pelo debounce e o plano de execucao foi calculado. */
export interface BatchStartedEvent extends EventBase {
  type: 'batch.started';
  batchId: string;
  changedFiles: string[];
  /** Motivo do fechamento do lote pelo debounce. */
  trigger: 'idle' | 'maxWindow' | 'manual';
  /** Plano: por runner, os arquivos de teste que serao executados. */
  plan: Array<{
    runnerKey: string;
    adapterId: string;
    testFiles: string[];
    reasons: Record<string, SelectionReason[]>;
  }>;
  unmatched: Array<{ file: string; reason: string }>;
}

/** Uma execucao de runner comecou. */
export interface RunStartedEvent extends EventBase {
  type: 'run.started';
  batchId: string;
  runId: string;
  runnerKey: string;
  adapterId: string;
  testFiles: string[];
  command: string;
  reasons: Record<string, SelectionReason[]>;
}

/** Uma execucao de runner terminou. */
export interface RunFinishedEvent extends EventBase {
  type: 'run.finished';
  result: TestRunResult;
}

/** Todas as execucoes do lote terminaram. */
export interface BatchFinishedEvent extends EventBase {
  type: 'batch.finished';
  result: BatchResult;
}

/** Erro nao fatal — o daemon continua rodando (degradacao segura, NFR secao 8). */
export interface ErrorEvent extends EventBase {
  type: 'error';
  /** Componente que falhou, ex.: `graph:python`, `runner:vitest`, `watcher`. */
  scope: string;
  message: string;
  /** Detalhe tecnico (stack, stderr) quando disponivel. */
  detail: string | null;
  /** Como o daemon degradou, quando aplicavel. */
  degradedTo: string | null;
}

/**
 * Estado completo enviado a um cliente assim que ele se conecta,
 * para que a UI possa renderizar sem esperar o proximo lote.
 */
export interface SnapshotEvent extends EventBase {
  type: 'snapshot';
  state: DaemonSnapshot;
}

/** Estado consolidado do daemon em um instante. */
export interface DaemonSnapshot {
  pid: number;
  root: string;
  version: string;
  protocolVersion: number;
  startedAt: number;
  /** `true` enquanto ha execucoes em andamento. */
  running: boolean;
  /** Ultimo lote concluido, se houver. */
  lastBatch: BatchResult | null;
  /** Estado por arquivo-fonte observado, para a arvore da extensao. */
  files: FileStatus[];
  /** Contadores agregados desde o inicio do daemon. */
  totals: { batches: number; runs: number; failedRuns: number };
}

/** Estado corrente de um arquivo na visao da extensao/CLI. */
export interface FileStatus {
  /** Caminho absoluto do arquivo-fonte (ou de teste). */
  path: string;
  /** Caminho relativo a raiz, com separadores POSIX. */
  relativePath: string;
  status: 'idle' | 'running' | 'passed' | 'failed' | 'errored' | 'skipped';
  /** Ultima atualizacao (epoch ms). */
  updatedAt: number;
  /** Explicacao curta de por que o arquivo esta neste estado. */
  reason: string | null;
  /** Id da ultima execucao que tocou este arquivo. */
  lastRunId: string | null;
  counts: { passed: number; failed: number; skipped: number } | null;
}

/** Uniao discriminada de todos os eventos do protocolo. */
export type LiveTestEvent =
  | DaemonStartedEvent
  | DaemonStoppedEvent
  | WatchChangeEvent
  | BatchStartedEvent
  | RunStartedEvent
  | RunFinishedEvent
  | BatchFinishedEvent
  | ErrorEvent
  | SnapshotEvent;

/** Nome (discriminante) de qualquer evento do protocolo. */
export type LiveTestEventType = LiveTestEvent['type'];

/** Extrai o tipo concreto de evento a partir do seu discriminante. */
export type EventOfType<T extends LiveTestEventType> = Extract<LiveTestEvent, { type: T }>;

/** Assinatura de um ouvinte de eventos. */
export type EventListener = (event: LiveTestEvent) => void;

/** Conteudo do arquivo de descoberta `.livetest/daemon.json`. */
export interface DaemonDiscoveryInfo {
  pid: number;
  host: string;
  port: number;
  root: string;
  version: string;
  protocolVersion: number;
  startedAt: number;
}
