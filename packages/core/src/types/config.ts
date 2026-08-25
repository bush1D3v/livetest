/**
 * Tipos de configuracao do Live Test Runner.
 *
 * A configuracao e lida de `livetest.config.json` (ou `.js`/`.mjs`/`.cjs`) na raiz
 * do projeto. Todos os campos sao opcionais no arquivo do usuario
 * ({@link LiveTestUserConfig}); apos o carregamento e normalizacao o objeto passa
 * a ser totalmente preenchido ({@link ResolvedConfig}).
 *
 * @packageDocumentation
 */

/**
 * Quao "fundo" no grafo reverso de dependencias a execucao de testes deve se propagar.
 *
 * - `'self'`    — apenas o arquivo alterado (profundidade 0).
 * - `'direct'`  — o arquivo alterado + quem o importa diretamente (profundidade 1).
 * - `'transitive'` — o arquivo alterado + toda a cadeia de importadores (profundidade infinita).
 * - `number`    — profundidade numerica explicita (`0` equivale a `'self'`, `2` a "avos").
 *
 * @remarks
 * O PRD (secao 6.2) descreve apenas `direct` e `transitive`, mas usa `direct` com o
 * sentido de "somente o arquivo alterado", o que conflita com a secao 4.1 (onde o
 * adapter de grafo retorna "importadores diretos ou transitivos"). Para remover a
 * ambiguidade, expomos os tres niveis: quem quer o comportamento "so o arquivo"
 * usa `'self'`.
 */
export type DependencyDepth = 'self' | 'direct' | 'transitive' | number;

/** Modo de agrupamento de saves consecutivos antes de disparar os testes. */
export type DebounceMode =
  /** Dispara apenas apos `idleMs` sem novos eventos. */
  | 'idle'
  /** Dispara a cada `maxBatchWindowMs` a partir do primeiro evento do lote. */
  | 'batch'
  /** Combina os dois: o que ocorrer primeiro dispara o lote. Recomendado. */
  | 'both';

/** Identificadores dos adapters de test runner embutidos. */
export type BuiltinRunnerAdapterId = 'vitest' | 'jest' | 'pytest' | 'command';

/** Identificadores dos adapters de grafo de dependencia embutidos. */
export type BuiltinGraphAdapterId = 'js-ts' | 'python';

/** Configuracao de um runner (par linguagem/framework de teste). */
export interface RunnerConfig {
  /**
   * Adapter responsavel por montar o comando e interpretar a saida.
   * Use `'command'` para um comando arbitrario avaliado apenas pelo exit code.
   */
  adapter: BuiltinRunnerAdapterId | (string & {});
  /**
   * Globs de arquivos-fonte atendidos por este runner.
   * @example `["**\/*.ts", "**\/*.tsx"]`
   */
  match: string[];
  /**
   * Comando executavel. Quando omitido, cada adapter aplica seu default
   * (`npx vitest`, `npx jest`, `python -m pytest`).
   */
  command?: string;
  /** Argumentos fixos inseridos antes dos arquivos de teste. */
  args?: string[];
  /** Variaveis de ambiente adicionais para o processo de teste. */
  env?: Record<string, string>;
  /** Timeout em milissegundos para uma unica execucao. Default: 120000. */
  timeoutMs?: number;
  /**
   * Templates usados para localizar o arquivo de teste de um arquivo-fonte.
   * Tokens suportados: `{dir}`, `{name}`, `{ext}`.
   * @see {@link TestFileResolver}
   */
  testPatterns?: string[];
  /** Globs que identificam um arquivo como sendo, ele proprio, um teste. */
  testMatch?: string[];
  /**
   * Extensoes (sem ponto) testadas ao expandir o token `{ext}` de
   * {@link RunnerConfig.testPatterns}. A extensao do proprio arquivo-fonte e
   * sempre tentada primeiro.
   * @example `["ts", "tsx", "js"]`
   */
  testExtensions?: string[];
  /** Adapter de grafo de dependencia usado para arquivos deste runner. */
  graph?: BuiltinGraphAdapterId | (string & {});
  /** Diretorio de trabalho da execucao (relativo a raiz). Default: a raiz. */
  cwd?: string;
}

/** Politica de profundidade de dependencia por projeto, com overrides por arquivo. */
export interface DependencyDepthConfig {
  /** Profundidade aplicada quando nenhum override casa com o arquivo. */
  default: DependencyDepth;
  /**
   * Overrides por glob de arquivo. O ultimo glob que casar vence, permitindo
   * regras gerais seguidas de excecoes especificas.
   */
  overrides: Record<string, DependencyDepth>;
}

/** Parametros do motor de debounce. */
export interface DebounceConfig {
  mode: DebounceMode;
  /** Tempo de silencio, em ms, antes de disparar. Usado por `idle` e `both`. */
  idleMs: number;
  /** Janela maxima, em ms, desde o primeiro evento. Usado por `batch` e `both`. */
  maxBatchWindowMs: number;
}

/** Canais de saida do daemon. */
export interface OutputConfig {
  /** Caminho do log NDJSON (append-only). `null` desativa o arquivo. */
  logFile: string | null;
  /** Snapshot legivel do estado atual. `null` desativa. */
  statusFile: string | null;
  /** Emitir relatorio no stdout. */
  stdout: boolean;
  /** Formato do stdout: `pretty` (humano+IA) ou `ndjson` (so eventos). */
  format: 'pretty' | 'ndjson';
  /** Usar cores ANSI no stdout. `'auto'` detecta TTY. */
  color: boolean | 'auto';
  /** Numero de linhas de stdout/stderr do teste mantidas nos eventos. */
  logTailLines: number;
}

/** Canal de eventos consumido pela extensao do VSCode. */
export interface ServerConfig {
  /** Liga/desliga o servidor de eventos. */
  enabled: boolean;
  /** Host de bind. Mantenha em loopback. */
  host: string;
  /** Porta TCP. `0` faz o SO escolher uma porta livre (recomendado). */
  port: number;
  /** Arquivo de descoberta com pid/host/porta do daemon em execucao. */
  discoveryFile: string;
}

/** Configuracao aceita no arquivo `livetest.config.json`. Tudo opcional. */
export interface LiveTestUserConfig {
  /** Raiz do projeto. Default: diretorio do arquivo de configuracao. */
  root?: string;
  /** Globs observados. Default: `["**\/*"]` filtrado por `ignore`. */
  watch?: string[];
  /** Globs ignorados, somados aos defaults e ao `.gitignore` (se habilitado). */
  ignore?: string[];
  /** Ler `.gitignore` da raiz e somar aos ignores. Default: `true`. */
  useGitignore?: boolean;
  dependencyDepth?: Partial<DependencyDepthConfig>;
  debounce?: Partial<DebounceConfig>;
  runners?: Record<string, Partial<RunnerConfig> & { match?: string[] }>;
  output?: Partial<OutputConfig>;
  server?: Partial<ServerConfig>;
  /** Execucoes de teste simultaneas. Default: 2. */
  concurrency?: number;
  /** Nao rodar nada; apenas logar o plano. Util para depurar configuracao. */
  dryRun?: boolean;
  /** Interpretador Python usado pelo adapter de grafo Python. Default: `python`. */
  pythonPath?: string;
  /** Nivel de verbosidade do logger interno. */
  logLevel?: LogLevel;
}

/** Niveis do logger interno, do mais para o menos verboso. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Configuracao apos carregamento, normalizacao e validacao.
 * Todos os caminhos sao absolutos e todos os campos estao preenchidos.
 */
export interface ResolvedConfig {
  /** Caminho absoluto da raiz do projeto. */
  root: string;
  /** Caminho absoluto do arquivo de configuracao, ou `null` se usando defaults. */
  configPath: string | null;
  watch: string[];
  ignore: string[];
  useGitignore: boolean;
  dependencyDepth: DependencyDepthConfig;
  debounce: DebounceConfig;
  runners: Record<string, RunnerConfig>;
  output: OutputConfig;
  server: ServerConfig;
  concurrency: number;
  dryRun: boolean;
  pythonPath: string;
  logLevel: LogLevel;
}
