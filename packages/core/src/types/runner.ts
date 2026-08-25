/**
 * Contratos do adapter de test runner.
 *
 * Um adapter sabe (a) montar o comando que executa um conjunto de arquivos de
 * teste e (b) transformar a saida do processo em {@link TestRunResult}.
 * A execucao do processo em si e responsabilidade do core, garantindo
 * cancelamento, timeout e captura de saida uniformes.
 *
 * @packageDocumentation
 */

import type { RunnerConfig } from './config.js';
import type { Logger } from './logging.js';
import type { TestCaseResult, TestCounts, TestRunStatus } from './results.js';

/** Contexto entregue ao adapter na criacao. */
export interface RunnerAdapterContext {
  /** Raiz absoluta do projeto. */
  root: string;
  /** Chave do runner na configuracao (ex.: `"js"`). */
  runnerKey: string;
  /** Configuracao normalizada do runner. */
  config: RunnerConfig;
  /** Logger prefixado. */
  logger: Logger;
  /** Interpretador Python configurado, usado pelo adapter do pytest. */
  pythonPath: string;
}

/** Descricao de um processo a ser executado pelo core. */
export interface RunnerInvocation {
  /** Executavel. */
  command: string;
  /** Argumentos, ja com os arquivos de teste incluidos. */
  args: string[];
  /** Diretorio de trabalho absoluto. */
  cwd: string;
  /** Variaveis de ambiente adicionais (mescladas com `process.env`). */
  env: Record<string, string>;
  /**
   * Arquivo temporario onde o runner escrevera o relatorio estruturado.
   * O core garante a limpeza depois da execucao.
   */
  reportFile: string | null;
  /** Timeout em ms para esta execucao. */
  timeoutMs: number;
}

/** Saida bruta de um processo de teste. */
export interface RunnerProcessOutput {
  exitCode: number | null;
  /** `true` quando o processo foi morto por timeout. */
  timedOut: boolean;
  /** `true` quando o processo foi cancelado por um novo lote. */
  cancelled: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Conteudo do `reportFile`, quando ele foi gerado. `null` caso contrario. */
  reportContent: string | null;
  /** Erro de spawn (ex.: executavel inexistente). */
  spawnError: string | null;
}

/** Interpretacao estruturada da saida de um runner. */
export interface RunnerParseResult {
  status: TestRunStatus;
  counts: TestCounts;
  cases: TestCaseResult[];
  /** Mensagem de erro quando o runner nao pode ser executado. */
  error: string | null;
}

/**
 * Adapter de test runner.
 *
 * @example
 * ```ts
 * const goTest: TestRunnerAdapter = {
 *   id: 'go-test',
 *   buildInvocation: (testFiles, ctx) => ({
 *     command: 'go',
 *     args: ['test', ...testFiles],
 *     cwd: ctx.root,
 *     env: {},
 *     reportFile: null,
 *     timeoutMs: 120_000,
 *   }),
 *   parseOutput: (out) => ({ ... }),
 * };
 * ```
 */
export interface TestRunnerAdapter {
  /** Identificador unico, referenciado por `runners[].adapter`. */
  readonly id: string;
  /** Extensao do arquivo de relatorio gerado, ex.: `.json`. `null` se nao usa. */
  readonly reportFileExtension?: string | null;
  /**
   * Monta o processo a ser executado.
   *
   * @param testFiles - Arquivos de teste absolutos selecionados para esta execucao.
   * @param context - Raiz, configuracao e logger do runner.
   * @param reportFile - Caminho temporario onde o adapter deve pedir ao runner
   * que escreva o relatorio estruturado. `null` quando
   * {@link TestRunnerAdapter.reportFileExtension} nao esta definido.
   */
  buildInvocation(
    testFiles: string[],
    context: RunnerAdapterContext,
    reportFile: string | null,
  ): RunnerInvocation;
  /** Converte a saida bruta em resultado estruturado. Nunca deve lancar. */
  parseOutput(output: RunnerProcessOutput, context: RunnerAdapterContext): RunnerParseResult;
}

/** Fabrica de adapters de runner. */
export type TestRunnerAdapterFactory = (context: RunnerAdapterContext) => TestRunnerAdapter;
