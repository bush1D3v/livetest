/**
 * Consolidacao dos resultados de um lote.
 * @packageDocumentation
 */

import type { BatchResult, TestCounts, TestRunResult, TestRunStatus } from '../types/results.js';
import type { UnmatchedFile } from '../planner/planner.js';

/** Soma as contagens de varias execucoes. */
export function sumCounts(runs: readonly TestRunResult[]): TestCounts {
  return runs.reduce<TestCounts>(
    (total, run) => ({
      total: total.total + run.counts.total,
      passed: total.passed + run.counts.passed,
      failed: total.failed + run.counts.failed,
      skipped: total.skipped + run.counts.skipped,
    }),
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );
}

/**
 * Deriva o status do lote a partir dos status das execucoes.
 *
 * A ordem de precedencia e deliberada: um erro de infraestrutura (runner nao
 * encontrado, timeout) e mais importante de mostrar do que uma falha de teste,
 * porque exige uma acao diferente de quem esta lendo.
 *
 * @example
 * ```ts
 * deriveBatchStatus(['passed', 'failed']);   // 'failed'
 * deriveBatchStatus(['failed', 'errored']);  // 'errored'
 * deriveBatchStatus(['skipped', 'skipped']); // 'skipped'
 * deriveBatchStatus([]);                     // 'skipped'
 * ```
 */
export function deriveBatchStatus(statuses: readonly TestRunStatus[]): TestRunStatus {
  if (statuses.length === 0) return 'skipped';
  if (statuses.includes('errored')) return 'errored';
  if (statuses.includes('cancelled')) return 'cancelled';
  if (statuses.includes('failed')) return 'failed';
  if (statuses.every((status) => status === 'skipped')) return 'skipped';
  return 'passed';
}

/** Opcoes de {@link aggregateBatch}. */
export interface AggregateBatchOptions {
  batchId: string;
  changedFiles: string[];
  runs: TestRunResult[];
  unmatched: UnmatchedFile[];
  startedAt: number;
  finishedAt: number;
}

/**
 * Monta o {@link BatchResult} final de um lote.
 *
 * @example
 * ```ts
 * const result = aggregateBatch({ batchId: 'batch-1', changedFiles, runs, unmatched, startedAt, finishedAt });
 * result.status; // 'failed'
 * ```
 */
export function aggregateBatch(options: AggregateBatchOptions): BatchResult {
  return {
    batchId: options.batchId,
    changedFiles: options.changedFiles,
    runs: options.runs,
    status: deriveBatchStatus(options.runs.map((run) => run.status)),
    counts: sumCounts(options.runs),
    durationMs: Math.max(0, options.finishedAt - options.startedAt),
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    unmatched: options.unmatched,
  };
}
