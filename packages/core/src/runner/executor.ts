/**
 * Execucao de um runner sobre um conjunto de arquivos de teste.
 *
 * Concentra o ciclo completo de uma execucao: criar o arquivo temporario de
 * relatorio, montar o processo pelo adapter, executa-lo, ler e interpretar o
 * relatorio, limpar o temporario e montar o {@link TestRunResult}. Os adapters
 * ficam livres para serem funcoes puras de montagem e interpretacao.
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';

import type { SelectionReason, TestRunResult } from '../types/results.js';
import type { RunnerAdapterContext, TestRunnerAdapter } from '../types/runner.js';
import { joinPosix, normalizePath, toNative } from '../util/paths.js';
import { runProcess } from './process.js';

/** Opcoes de {@link executeRun}. */
export interface ExecuteRunOptions {
  runId: string;
  batchId: string;
  runnerKey: string;
  adapter: TestRunnerAdapter;
  context: RunnerAdapterContext;
  /** Arquivos de teste absolutos. */
  testFiles: string[];
  /** Por que cada arquivo de teste foi selecionado. */
  reasons: Record<string, SelectionReason[]>;
  /** Cancela a execucao quando um novo lote chega. */
  signal?: AbortSignal;
  /** Quantas linhas finais de stdout/stderr guardar no resultado. */
  logTailLines: number;
  /** Nao executa nada; devolve um resultado `skipped` com o comando montado. */
  dryRun?: boolean;
}

/** Devolve as ultimas `count` linhas nao vazias de um texto. */
export function tailLines(text: string, count: number): string[] {
  if (count <= 0 || text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  // O guarda de tamanho garante que o indice existe a cada iteracao.
  while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '') lines.pop();
  return lines.slice(-count);
}

/** Representacao copiavel do comando executado. */
export function formatCommand(command: string, args: readonly string[]): string {
  const parts = [command, ...args].map((part) => (/\s/.test(part) ? `"${part}"` : part));
  return parts.join(' ');
}

/** Cria o caminho do relatorio temporario, quando o adapter usa um. */
function createReportPath(adapter: TestRunnerAdapter, runId: string): string | null {
  const extension = adapter.reportFileExtension;
  if (!extension) return null;
  return joinPosix(normalizePath(os.tmpdir()), `livetest-${runId}-${randomUUID()}${extension}`);
}

/** Le o relatorio, devolvendo `null` quando o runner nao o escreveu. */
function readReport(reportFile: string | null): string | null {
  if (!reportFile) return null;
  try {
    return fs.readFileSync(toNative(reportFile), 'utf8');
  } catch {
    return null;
  }
}

/** Remove o relatorio temporario, ignorando falhas. */
function cleanupReport(reportFile: string | null): void {
  if (!reportFile) return;
  try {
    fs.rmSync(toNative(reportFile), { force: true });
  } catch {
    /* melhor esforco */
  }
}

/**
 * Executa um runner e devolve o resultado estruturado.
 *
 * Nunca lanca: qualquer falha vira `status: 'errored'` com a mensagem em
 * `error`, mantendo o daemon vivo (NFR de robustez, secao 8 do PRD).
 *
 * @example
 * ```ts
 * const result = await executeRun({
 *   runId: 'run-1', batchId: 'batch-1', runnerKey: 'js',
 *   adapter: createVitestAdapter(), context, testFiles, reasons: {}, logTailLines: 20,
 * });
 * result.status; // 'passed' | 'failed' | 'errored' | 'skipped' | 'cancelled'
 * ```
 */
export async function executeRun(options: ExecuteRunOptions): Promise<TestRunResult> {
  const { adapter, context, runId, batchId, runnerKey, testFiles, reasons } = options;
  const reportFile = createReportPath(adapter, runId);

  const base: Omit<TestRunResult, 'status' | 'counts' | 'cases' | 'durationMs' | 'exitCode' | 'error' | 'stdoutTail' | 'stderrTail' | 'command'> = {
    runId,
    batchId,
    runnerKey,
    adapterId: adapter.id,
    testFiles,
    reasons,
  };

  let invocation;
  try {
    invocation = adapter.buildInvocation(testFiles, context, reportFile);
  } catch (error) {
    cleanupReport(reportFile);
    return {
      ...base,
      command: '',
      status: 'errored',
      counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
      cases: [],
      durationMs: 0,
      exitCode: null,
      stdoutTail: [],
      stderrTail: [],
      error: `o adapter "${adapter.id}" falhou ao montar o comando: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const command = formatCommand(invocation.command, invocation.args);

  if (options.dryRun) {
    cleanupReport(reportFile);
    return {
      ...base,
      command,
      status: 'skipped',
      counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
      cases: [],
      durationMs: 0,
      exitCode: null,
      stdoutTail: [],
      stderrTail: [],
      error: null,
    };
  }

  const processOptions = {
    command: invocation.command,
    args: invocation.args,
    cwd: invocation.cwd,
    env: invocation.env,
    timeoutMs: invocation.timeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
  };
  const processResult = await runProcess(processOptions);
  const reportContent = readReport(invocation.reportFile);
  cleanupReport(invocation.reportFile);

  let parsed;
  try {
    parsed = adapter.parseOutput(
      {
        exitCode: processResult.exitCode,
        timedOut: processResult.timedOut,
        cancelled: processResult.cancelled,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        durationMs: processResult.durationMs,
        reportContent,
        spawnError: processResult.spawnError,
      },
      context,
    );
  } catch (error) {
    parsed = {
      status: 'errored' as const,
      counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
      cases: [],
      error: `o adapter "${adapter.id}" falhou ao interpretar a saida: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  return {
    ...base,
    command,
    status: parsed.status,
    counts: parsed.counts,
    cases: parsed.cases,
    durationMs: processResult.durationMs,
    exitCode: processResult.exitCode,
    stdoutTail: tailLines(processResult.stdout, options.logTailLines),
    stderrTail: tailLines(processResult.stderr, options.logTailLines),
    error: parsed.error,
  };
}
