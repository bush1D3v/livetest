/**
 * Relatorio de terminal.
 *
 * O stdout do daemon tem **dois leitores**: a pessoa desenvolvedora e o agente
 * de IA que iniciou o processo em background (secao 4.2 do PRD). O formato foi
 * desenhado para servir os dois:
 *
 * - a parte visual e curta, indentada e colorida, com o *motivo* de cada teste
 *   ter rodado logo ao lado do arquivo;
 * - toda conclusao de lote termina com uma linha `LIVETEST` de campos
 *   `chave=valor`, que qualquer agente consegue extrair com um `grep`, sem
 *   precisar de parser dedicado.
 *
 * @packageDocumentation
 */

import { summarizeReason } from '../planner/planner.js';
import type { BatchResult, TestRunResult } from '../types/results.js';
import type { BatchStartedEvent, ErrorEvent, LiveTestEvent } from '../types/events.js';
import { relativeToRoot } from '../util/paths.js';
import { selectPalette, type Palette } from './colors.js';

/** Prefixo da linha resumo legivel por maquina. */
export const SUMMARY_PREFIX = 'LIVETEST';

/** Opcoes de {@link createPrettyReporter}. */
export interface PrettyReporterOptions {
  root: string;
  /** Destino das linhas. Default: `process.stdout.write`. */
  write?: (line: string) => void;
  color?: boolean | 'auto';
  /** Quantas linhas de saida crua mostrar quando uma execucao erra. */
  errorTailLines?: number;
}

/** Reporter de terminal. */
export interface PrettyReporter {
  /** Processa um evento do barramento. */
  handle(event: LiveTestEvent): void;
}

/** Formata uma duracao em ms de forma compacta. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Alinha um texto a direita com espacos, para colunas legiveis. */
function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** Linha de pilha apontando para dentro de dependencias instaladas. */
const VENDOR_FRAME = /^\s*at\b.*(?:[\\/]node_modules[\\/]|node:internal[\\/])/;

/**
 * Limpa uma mensagem de falha para leitura.
 *
 * Runners costumam anexar dez ou mais quadros de pilha internos do proprio
 * framework, que empurram a assercao real para fora da tela — e, no caso de um
 * agente de IA, ocupam contexto sem informar nada. Descartamos os quadros que
 * apontam para `node_modules` ou para modulos internos do Node, e cortamos o
 * restante em `maxLines`.
 *
 * @param message - Mensagem crua vinda do runner.
 * @param maxLines - Maximo de linhas mantidas (minimo 1).
 * @returns Linhas prontas para exibicao, com aviso de omissao quando houve corte.
 */
export function cleanFailureMessage(message: string, maxLines: number): string[] {
  const all = message.split(/\r?\n/);
  const useful = all.filter((line) => !VENDOR_FRAME.test(line));
  const kept = useful.slice(0, Math.max(1, maxLines));
  const hidden = all.length - kept.length;
  return hidden > 0 ? [...kept, `... (+${hidden} linha(s) omitida(s))`] : kept;
}

/**
 * Monta a linha resumo legivel por maquina.
 *
 * @example
 * ```text
 * LIVETEST batch=batch-3 status=failed files=3 tests=12 passed=10 failed=2 skipped=0 duration=1.4s
 * ```
 */
export function formatSummaryLine(result: BatchResult): string {
  const fields = [
    `batch=${result.batchId}`,
    `status=${result.status}`,
    `files=${result.runs.reduce((total, run) => total + run.testFiles.length, 0)}`,
    `tests=${result.counts.total}`,
    `passed=${result.counts.passed}`,
    `failed=${result.counts.failed}`,
    `skipped=${result.counts.skipped}`,
    `duration=${formatDuration(result.durationMs)}`,
  ];
  return `${SUMMARY_PREFIX} ${fields.join(' ')}`;
}

/** Simbolo e cor de um status de execucao. */
function statusBadge(status: TestRunResult['status'], palette: Palette): string {
  switch (status) {
    case 'passed':
      return palette.green('PASSOU');
    case 'failed':
      return palette.red('FALHOU');
    case 'errored':
      return palette.red('ERRO  ');
    case 'cancelled':
      return palette.yellow('CANCEL');
    default:
      return palette.gray('PULOU ');
  }
}

/**
 * Cria o reporter de terminal.
 *
 * @example
 * ```ts
 * const reporter = createPrettyReporter({ root, color: false });
 * bus.subscribe((event) => reporter.handle(event));
 * ```
 */
export function createPrettyReporter(options: PrettyReporterOptions): PrettyReporter {
  const palette = selectPalette(options.color ?? 'auto');
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const errorTailLines = options.errorTailLines ?? 8;
  const root = options.root;
  const rel = (file: string): string => relativeToRoot(root, file);

  function reportPlan(event: BatchStartedEvent): void {
    const changed = event.changedFiles.map(rel).join(', ');
    write('');
    write(
      `${palette.cyan('livetest')} ${palette.bold(event.batchId)} ${palette.dim(
        `(${event.trigger})`,
      )} ${changed}`,
    );

    for (const entry of event.plan) {
      write(
        `  ${palette.bold(entry.runnerKey)} ${palette.dim(
          `-> ${entry.testFiles.length} arquivo(s) de teste`,
        )}`,
      );
      const width = Math.max(...entry.testFiles.map((f) => rel(f).length), 0);
      for (const testFile of entry.testFiles) {
        const reasons = entry.reasons[testFile] ?? [];
        const why = reasons.map((reason) => summarizeReason(reason, root)).join('; ');
        write(`    ${pad(rel(testFile), width)}  ${palette.gray(why)}`);
      }
    }

    for (const item of event.unmatched) {
      write(`  ${palette.yellow('sem teste')} ${palette.gray(item.reason)}`);
    }
  }

  function reportRun(result: TestRunResult): void {
    const { counts } = result;
    const parts = [
      `${result.testFiles.length} arquivo(s)`,
      palette.green(`${counts.passed} passou`),
      counts.failed > 0 ? palette.red(`${counts.failed} falhou`) : `${counts.failed} falhou`,
      palette.gray(`${counts.skipped} pulou`),
      palette.dim(formatDuration(result.durationMs)),
    ];
    write(`  ${statusBadge(result.status, palette)} ${palette.bold(result.runnerKey)}  ${parts.join('  ')}`);

    for (const testCase of result.cases) {
      if (testCase.status !== 'failed') continue;
      const where = testCase.file ? `${rel(testCase.file)} > ` : '';
      write(`    ${palette.red('x')} ${where}${testCase.fullName}`);
      for (const message of testCase.failureMessages) {
        for (const line of cleanFailureMessage(message, errorTailLines)) {
          write(`      ${palette.dim(line)}`);
        }
      }
    }

    if (result.error) {
      write(`    ${palette.red('erro:')} ${result.error}`);
      for (const line of result.stderrTail.slice(-errorTailLines)) {
        write(`      ${palette.dim(line)}`);
      }
      write(`    ${palette.dim(`comando: ${result.command}`)}`);
    }
  }

  function reportBatch(result: BatchResult): void {
    const badge = statusBadge(result.status, palette).trim();
    write(
      `  ${palette.bold(result.batchId)} ${badge} ${palette.dim(
        `em ${formatDuration(result.durationMs)}`,
      )}`,
    );
    write(palette.dim(formatSummaryLine(result)));
  }

  function reportError(event: ErrorEvent): void {
    const degraded = event.degradedTo ? ` ${palette.dim(`(${event.degradedTo})`)}` : '';
    write(`  ${palette.yellow('aviso')} [${event.scope}] ${event.message}${degraded}`);
  }

  return {
    handle(event: LiveTestEvent): void {
      switch (event.type) {
        case 'daemon.started':
          write(
            `${palette.cyan('livetest')} observando ${palette.bold(event.root)} ` +
              `${palette.dim(`(${event.indexedFiles} arquivos indexados, pid ${event.pid}`)}` +
              `${event.server ? palette.dim(`, eventos em ${event.server.host}:${event.server.port}`) : ''}` +
              `${palette.dim(')')}`,
          );
          break;
        case 'daemon.stopped':
          write(`${palette.cyan('livetest')} encerrado: ${event.reason}`);
          break;
        case 'batch.started':
          reportPlan(event);
          break;
        case 'run.finished':
          reportRun(event.result);
          break;
        case 'batch.finished':
          reportBatch(event.result);
          break;
        case 'error':
          reportError(event);
          break;
        default:
          // `watch.change`, `run.started` e `snapshot` sao ruido no terminal:
          // ficam disponiveis no log NDJSON e no canal da extensao.
          break;
      }
    },
  };
}
