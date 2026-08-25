/**
 * Tipos de resultado de execucao de testes.
 * @packageDocumentation
 */

/** Estado final de um caso de teste individual. */
export type TestCaseStatus = 'passed' | 'failed' | 'skipped';

/** Estado final de uma execucao de runner. */
export type TestRunStatus =
  /** Todos os testes passaram. */
  | 'passed'
  /** Pelo menos um teste falhou. */
  | 'failed'
  /** O runner nao pode ser executado (binario ausente, config invalida, timeout). */
  | 'errored'
  /** Nada foi executado (nenhum arquivo de teste encontrado, ou `dryRun`). */
  | 'skipped'
  /** A execucao foi cancelada por um novo lote de alteracoes. */
  | 'cancelled';

/** Um caso de teste individual reportado pelo runner. */
export interface TestCaseResult {
  /** Nome completo do teste, incluindo blocos `describe`/classe. */
  fullName: string;
  /** Arquivo de teste que contem o caso, caminho absoluto quando conhecido. */
  file: string | null;
  status: TestCaseStatus;
  durationMs: number | null;
  /** Mensagens de falha (uma por assercao quebrada), ja normalizadas. */
  failureMessages: string[];
}

/** Contagens agregadas de uma execucao. */
export interface TestCounts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

/** Motivo pelo qual um arquivo de teste entrou no plano de execucao. */
export interface SelectionReason {
  /**
   * - `changed`: o arquivo alterado e (ou possui) este teste.
   * - `importer`: o arquivo alterado e importado, direta ou transitivamente,
   *   por um arquivo coberto por este teste.
   * - `manual`: incluido por comando explicito do usuario.
   */
  kind: 'changed' | 'importer' | 'manual';
  /** Arquivo salvo que originou a selecao (caminho absoluto). */
  changedFile: string;
  /** Arquivo-fonte coberto pelo teste (caminho absoluto). */
  sourceFile: string;
  /** Distancia no grafo reverso entre `changedFile` e `sourceFile`. */
  depth: number;
  /**
   * Cadeia de importacao de `changedFile` ate `sourceFile`, inclusive.
   * Usada para explicar ao usuario/IA por que o teste rodou.
   */
  chain: string[];
}

/** Uma execucao de um runner sobre um conjunto de arquivos de teste. */
export interface TestRunResult {
  /** Identificador unico da execucao. */
  runId: string;
  /** Lote de alteracoes que originou a execucao. */
  batchId: string;
  /** Chave do runner na configuracao (ex.: `"js"`, `"python"`). */
  runnerKey: string;
  /** Id do adapter utilizado (ex.: `"vitest"`). */
  adapterId: string;
  /** Arquivos de teste passados ao runner (absolutos). */
  testFiles: string[];
  /** Comando efetivamente executado, pronto para copiar e colar. */
  command: string;
  status: TestRunStatus;
  counts: TestCounts;
  cases: TestCaseResult[];
  durationMs: number;
  exitCode: number | null;
  /** Ultimas linhas de stdout do processo de teste. */
  stdoutTail: string[];
  /** Ultimas linhas de stderr do processo de teste. */
  stderrTail: string[];
  /** Mensagem de erro quando `status === 'errored'`. */
  error: string | null;
  /** Por que cada arquivo de teste foi selecionado. Chave: arquivo de teste. */
  reasons: Record<string, SelectionReason[]>;
}

/** Resultado consolidado de um lote (todos os runners de um flush de debounce). */
export interface BatchResult {
  batchId: string;
  /** Arquivos salvos que compoem o lote (absolutos). */
  changedFiles: string[];
  /** Execucoes disparadas pelo lote. */
  runs: TestRunResult[];
  status: TestRunStatus;
  counts: TestCounts;
  durationMs: number;
  startedAt: number;
  finishedAt: number;
  /**
   * Arquivos alterados para os quais nenhum teste foi encontrado,
   * com a explicacao correspondente.
   */
  unmatched: Array<{ file: string; reason: string }>;
}
