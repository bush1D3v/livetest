/**
 * Estado consolidado do daemon.
 *
 * A extensao do VSCode precisa renderizar uma arvore de arquivos com o status
 * de cada um assim que se conecta, sem esperar o proximo lote. Este modulo
 * mantem esse estado atualizado a partir do fluxo de eventos, o que garante que
 * o snapshot enviado a um cliente novo seja exatamente o que os clientes
 * antigos ja tinham.
 *
 * @packageDocumentation
 */

import type { BatchResult, TestRunResult } from '../types/results.js';
import type { DaemonSnapshot, FileStatus, LiveTestEvent } from '../types/events.js';
import { EVENT_PROTOCOL_VERSION } from '../types/events.js';
import { relativeToRoot } from '../util/paths.js';

/** Opcoes de {@link createStateStore}. */
export interface StateStoreOptions {
  root: string;
  version: string;
  pid?: number;
  now?: () => number;
}

/** Estado consolidado, alimentado por eventos. */
export interface StateStore {
  /** Atualiza o estado a partir de um evento do barramento. */
  apply(event: LiveTestEvent): void;
  /** Snapshot completo, pronto para enviar a um cliente recem-conectado. */
  snapshot(): DaemonSnapshot;
  /** Estado de um arquivo especifico. */
  fileStatus(path: string): FileStatus | undefined;
  /** Registra arquivos observados no estado `idle`. */
  registerFiles(files: readonly string[]): void;
}

/** Cria um {@link StateStore}. */
export function createStateStore(options: StateStoreOptions): StateStore {
  const now = options.now ?? (() => Date.now());
  const root = options.root;
  const startedAt = now();
  const files = new Map<string, FileStatus>();
  let lastBatch: BatchResult | null = null;
  let running = false;
  const totals = { batches: 0, runs: 0, failedRuns: 0 };

  function ensure(path: string): FileStatus {
    const existing = files.get(path);
    if (existing) return existing;
    const created: FileStatus = {
      path,
      relativePath: relativeToRoot(root, path),
      status: 'idle',
      updatedAt: now(),
      reason: null,
      lastRunId: null,
      counts: null,
    };
    files.set(path, created);
    return created;
  }

  function markRunning(paths: readonly string[], runId: string): void {
    for (const path of paths) {
      const status = ensure(path);
      status.status = 'running';
      status.updatedAt = now();
      status.lastRunId = runId;
    }
  }

  /** Distribui o resultado de uma execucao pelos arquivos de teste envolvidos. */
  function applyRunResult(result: TestRunResult): void {
    totals.runs += 1;
    if (result.status === 'failed' || result.status === 'errored') totals.failedRuns += 1;

    // Contagens por arquivo, quando o runner reporta casos individuais.
    const perFile = new Map<string, { passed: number; failed: number; skipped: number }>();
    for (const testCase of result.cases) {
      if (!testCase.file) continue;
      const counts = perFile.get(testCase.file) ?? { passed: 0, failed: 0, skipped: 0 };
      counts[testCase.status] += 1;
      perFile.set(testCase.file, counts);
    }

    for (const testFile of result.testFiles) {
      const status = ensure(testFile);
      const counts = perFile.get(testFile) ?? null;
      status.updatedAt = now();
      status.lastRunId = result.runId;
      status.counts = counts;
      status.status =
        result.status === 'passed'
          ? 'passed'
          : result.status === 'failed'
            ? // Um arquivo sem falha propria dentro de uma execucao que falhou
              // continua verde: a falha esta em outro arquivo do mesmo lote.
              (counts?.failed ?? 0) > 0
              ? 'failed'
              : 'passed'
            : result.status === 'errored'
              ? 'errored'
              : 'skipped';
      status.reason = result.error;
    }
  }

  return {
    registerFiles(paths: readonly string[]): void {
      for (const path of paths) ensure(path);
    },

    apply(event: LiveTestEvent): void {
      switch (event.type) {
        case 'batch.started':
          running = true;
          for (const entry of event.plan) markRunning(entry.testFiles, '');
          break;
        case 'run.started':
          markRunning(event.testFiles, event.runId);
          break;
        case 'run.finished':
          applyRunResult(event.result);
          break;
        case 'batch.finished':
          running = false;
          lastBatch = event.result;
          totals.batches += 1;
          break;
        case 'watch.change':
          if (event.kind === 'unlink') files.delete(event.path);
          else ensure(event.path);
          break;
        default:
          break;
      }
    },

    fileStatus: (path) => files.get(path),

    snapshot(): DaemonSnapshot {
      return {
        pid: options.pid ?? process.pid,
        root,
        version: options.version,
        protocolVersion: EVENT_PROTOCOL_VERSION,
        startedAt,
        running,
        lastBatch,
        files: [...files.values()]
          .map((status) => ({ ...status }))
          .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
        totals: { ...totals },
      };
    },
  };
}
