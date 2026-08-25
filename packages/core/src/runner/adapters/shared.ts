/**
 * Utilitarios comuns aos adapters de runner embutidos.
 * @packageDocumentation
 */

import type { RunnerAdapterContext, RunnerParseResult } from '../../types/runner.js';
import { normalizePath, relativeToRoot } from '../../util/paths.js';

/** Contagem zerada, usada em resultados sem casos de teste. */
export const EMPTY_COUNTS = { total: 0, passed: 0, failed: 0, skipped: 0 } as const;

/** Diretorio de trabalho efetivo do runner. */
export function runnerCwd(context: RunnerAdapterContext): string {
  const { cwd } = context.config;
  return cwd ? normalizePath(cwd, context.root) : context.root;
}

/**
 * Converte os arquivos de teste em caminhos relativos ao diretorio de trabalho.
 *
 * Caminhos relativos evitam dois problemas reais: o Vitest trata argumentos
 * posicionais como expressao regular sobre o caminho (e `C:` atrapalha), e
 * relatorios ficam mais legiveis para humanos e para agentes de IA.
 */
export function relativeTestPaths(testFiles: readonly string[], cwd: string): string[] {
  return testFiles.map((file) => relativeToRoot(cwd, file));
}

/** Resultado padrao para quando o processo nao pode ser executado. */
export function erroredResult(message: string): RunnerParseResult {
  return { status: 'errored', counts: { ...EMPTY_COUNTS }, cases: [], error: message };
}

/**
 * Traduz falhas genericas do processo (timeout, cancelamento, spawn) em um
 * {@link RunnerParseResult}. Devolve `null` quando o processo terminou normalmente
 * e o adapter deve interpretar o relatorio.
 */
export function interpretProcessFailure(output: {
  spawnError: string | null;
  timedOut: boolean;
  cancelled: boolean;
}): RunnerParseResult | null {
  if (output.cancelled) {
    return { status: 'cancelled', counts: { ...EMPTY_COUNTS }, cases: [], error: null };
  }
  if (output.timedOut) return erroredResult('a execucao excedeu o tempo limite');
  if (output.spawnError) return erroredResult(output.spawnError);
  return null;
}
