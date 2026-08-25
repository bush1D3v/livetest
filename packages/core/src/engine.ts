/**
 * Motor do Live Test Runner: o daemon propriamente dito.
 *
 * Orquestra os componentes na ordem descrita na secao 5 do PRD:
 *
 * ```text
 * watcher -> debouncer -> grafo -> planner -> runners -> agregador -> saidas
 * ```
 *
 * O motor e independente de CLI e de IDE: quem o usa passa uma
 * {@link ResolvedConfig} e assina o barramento de eventos. A CLI e a extensao
 * do VSCode sao apenas dois consumidores diferentes do mesmo fluxo.
 *
 * @packageDocumentation
 */

import { createDependencyGraph, type DependencyGraph } from './graph/graph.js';
import { createGraphAdapters } from './graph/registry.js';
import { planBatch, type RunPlan } from './planner/planner.js';
import { createNdjsonLogger, createStatusFileWriter } from './report/files.js';
import { createPrettyReporter } from './report/pretty.js';
import { createEventServer, type EventServer } from './server/event-server.js';
import { removeDiscoveryFile, writeDiscoveryFile } from './server/discovery.js';
import { aggregateBatch } from './state/aggregate.js';
import { createStateStore, type StateStore } from './state/store.js';
import { createTestFileResolver, type TestFileResolver } from './testmap/resolver.js';
import { createEventBus, type EventBus, type LiveTestEventInput } from './events/bus.js';
import { executeRun } from './runner/executor.js';
import { createRunnerAdapter } from './runner/registry.js';
import { createDebouncer, type Debouncer, type FlushTrigger } from './watch/debouncer.js';
import { createFileWatcher, type FileWatcher, type WatcherFactory } from './watch/watcher.js';
import type { ResolvedConfig, RunnerConfig } from './types/config.js';
import type { DaemonSnapshot, EventListener, LiveTestEvent } from './types/events.js';
import type { DependencyGraphAdapterFactory } from './types/graph.js';
import type { Logger } from './types/logging.js';
import type { BatchResult, TestRunResult } from './types/results.js';
import type { TestRunnerAdapter } from './types/runner.js';
import { mapWithConcurrency } from './util/async.js';
import { LiveTestError, errorDetail, errorMessage } from './util/errors.js';
import { createIdGenerator } from './util/ids.js';
import { createLogger } from './util/logger.js';
import { normalizePath } from './util/paths.js';

/** Eventos que justificam reescrever o `status.json`. */
const SNAPSHOT_TRIGGERS: ReadonlySet<LiveTestEvent['type']> = new Set([
  'daemon.started',
  'batch.started',
  'run.started',
  'run.finished',
  'batch.finished',
]);

/** Versao publicada do pacote, usada nos eventos e na descoberta. */
export const ENGINE_VERSION = '0.1.0';

/** Opcoes de {@link createEngine}. */
export interface EngineOptions {
  config: ResolvedConfig;
  logger?: Logger;
  /** Versao reportada nos eventos. */
  version?: string;
  /** Adapters de grafo adicionais, por id. */
  graphAdapters?: Readonly<Record<string, DependencyGraphAdapterFactory>>;
  /** Adapters de runner adicionais, por id. */
  runnerAdapters?: Readonly<Record<string, () => TestRunnerAdapter>>;
  /**
   * Fabrica do observador de arquivos. O padrao e o `chokidar`.
   *
   * Trocar permite plugar outro mecanismo de observacao (um servidor de
   * arquivos remoto, por exemplo) e exercitar em teste os caminhos de erro do
   * watcher, que dependem do sistema operacional.
   */
  createWatcher?: WatcherFactory;
  /** Relogio injetavel, para testes deterministicos. */
  now?: () => number;
}

/** Informacoes devolvidas por {@link LiveTestEngine.start}. */
export interface EngineStartResult {
  /** Arquivos indexados no scan inicial. */
  indexedFiles: number;
  /** Endereco do canal de eventos, ou `null` se desabilitado. */
  server: { host: string; port: number } | null;
  /** Caminho do arquivo de descoberta, ou `null`. */
  discoveryFile: string | null;
}

/** Motor do daemon. */
export interface LiveTestEngine {
  /** Sobe watcher, grafo, canal de eventos e arquivos de saida. */
  start(): Promise<EngineStartResult>;
  /** Encerra tudo e limpa o arquivo de descoberta. */
  stop(reason?: string): Promise<void>;
  /**
   * Dispara um lote manualmente, como se os arquivos tivessem sido salvos.
   * Usado por `livetest run` e pelo botao da extensao.
   */
  runFiles(files: readonly string[]): Promise<BatchResult>;
  /** Fecha imediatamente o lote que estiver aguardando no debounce. */
  flush(): void;
  /** Estado consolidado atual. */
  snapshot(): DaemonSnapshot;
  /** Assina o barramento de eventos. */
  subscribe(listener: EventListener): () => void;
  /** Configuracao efetiva. */
  readonly config: ResolvedConfig;
  /** Grafo de dependencias, exposto para diagnostico (`livetest why`). */
  readonly graph: DependencyGraph;
  /** Mapeador de testes, exposto para diagnostico. */
  readonly resolver: TestFileResolver;
}

/**
 * Cria o motor do Live Test Runner.
 *
 * @example
 * ```ts
 * const { config } = await loadConfig({ cwd: process.cwd() });
 * const engine = createEngine({ config });
 * engine.subscribe((event) => { if (event.type === 'batch.finished') console.log(event.result.status); });
 * await engine.start();
 * ```
 */
export function createEngine(options: EngineOptions): LiveTestEngine {
  const config = options.config;
  const version = options.version ?? ENGINE_VERSION;
  const now = options.now ?? (() => Date.now());
  const logger = (options.logger ?? createLogger({ level: config.logLevel })).child('engine');

  const bus: EventBus = createEventBus({
    now,
    onListenerError: (error) => logger.warn('assinante falhou: %s', errorMessage(error)),
  });
  const store: StateStore = createStateStore({ root: config.root, version, now });
  const batchIds = createIdGenerator('batch');
  const runIds = createIdGenerator('run');

  /** Publica um evento e mantem estado e arquivos de saida em dia. */
  function emit(input: LiveTestEventInput): LiveTestEvent {
    const event = bus.emit(input);
    store.apply(event);
    if (statusWriter && SNAPSHOT_TRIGGERS.has(event.type)) statusWriter.write(store.snapshot());
    return event;
  }

  /** Reporta uma degradacao sem derrubar o daemon (NFR de robustez). */
  function reportDegradation(
    scope: string,
    message: string,
    detail?: string | null,
    degradedTo?: string,
  ): void {
    emit({
      type: 'error',
      scope,
      message,
      detail: detail ?? null,
      degradedTo: degradedTo ?? null,
    });
  }

  const graphIds = Object.values(config.runners)
    .map((runner) => runner.graph)
    .filter((id): id is string => typeof id === 'string');

  const { adapters, missing } = createGraphAdapters({
    ids: graphIds,
    context: {
      root: config.root,
      logger,
      pythonPath: config.pythonPath,
      reportDegradation: (message, detail) =>
        reportDegradation('graph', message, detail, 'analise sem grafo de dependencias'),
    },
    ...(options.graphAdapters ? { custom: options.graphAdapters } : {}),
  });

  const graph = createDependencyGraph({
    adapters,
    logger,
    onDegradation: (message, detail) =>
      reportDegradation('graph', message, detail, 'os arquivos afetados rodam sem propagacao'),
  });
  const resolver = createTestFileResolver({ config });

  const statusWriter = config.output.statusFile
    ? createStatusFileWriter({
        file: config.output.statusFile,
        root: config.root,
        onError: (error) => logger.warn('falha ao escrever status.json: %s', errorMessage(error)),
      })
    : null;


  const ndjson = config.output.logFile
    ? createNdjsonLogger({
        file: config.output.logFile,
        root: config.root,
        onError: (error) => logger.warn('falha ao escrever o log: %s', errorMessage(error)),
      })
    : null;
  if (ndjson) bus.subscribe((event) => ndjson.write(event));

  if (config.output.stdout) {
    if (config.output.format === 'ndjson') {
      bus.subscribe((event) => process.stdout.write(`${JSON.stringify(event)}\n`));
    } else {
      const pretty = createPrettyReporter({ root: config.root, color: config.output.color });
      bus.subscribe((event) => pretty.handle(event));
    }
  }

  let server: EventServer | null = null;
  let watcher: FileWatcher | null = null;
  let debouncer: Debouncer | null = null;
  let discoveryPath: string | null = null;
  let started = false;

  /** Aborta as execucoes do lote anterior quando um novo chega. */
  let inFlight: AbortController | null = null;
  /** Serializa os lotes: um novo so comeca depois que o anterior encerra. */
  let queue: Promise<unknown> = Promise.resolve();

  /** Arquivos removidos desde o ultimo lote, para tirar do grafo. */
  const removed = new Set<string>();

  function onFileChange(file: string, kind: 'add' | 'change' | 'unlink'): void {
    emit({ type: 'watch.change', path: file, kind });
    if (kind === 'unlink') removed.add(file);
    else removed.delete(file);
    debouncer?.push(file);
  }

  /** Reindexa no grafo os arquivos tocados pelo lote. */
  async function refreshGraph(files: readonly string[]): Promise<void> {
    // A lista de apagados precisa ser capturada antes de ser limpa: filtrar
    // depois do `clear()` deixaria passar os arquivos que acabaram de ser
    // removidos, e o `update` os traria de volta ao indice.
    const apagados = new Set(removed);
    removed.clear();

    for (const file of apagados) graph.remove(file);
    const existentes = files.filter((file) => !apagados.has(file));
    if (existentes.length > 0) await graph.update(existentes);
  }

  /** Executa um grupo do plano e devolve o resultado. */
  async function runEntry(
    batchId: string,
    entry: RunPlan['entries'][number],
    signal: AbortSignal,
  ): Promise<TestRunResult> {
    // O plano so contem chaves vindas de `config.runners`, entao a busca
    // sempre encontra o runner correspondente.
    const runnerConfig = config.runners[entry.runnerKey] as RunnerConfig;
    const runId = runIds.next();

    const adapter = createRunnerAdapter(
      runnerConfig.adapter,
      options.runnerAdapters as Record<string, () => TestRunnerAdapter> | undefined,
    );
    if (!adapter) {
      return errorResult(
        batchId,
        runId,
        entry,
        `adapter de runner desconhecido: "${runnerConfig.adapter}"`,
      );
    }

    const context = {
      root: config.root,
      runnerKey: entry.runnerKey,
      config: runnerConfig,
      logger: logger.child(`runner:${entry.runnerKey}`),
      pythonPath: config.pythonPath,
    };

    emit({
      type: 'run.started',
      batchId,
      runId,
      runnerKey: entry.runnerKey,
      adapterId: adapter.id,
      testFiles: entry.testFiles,
      command: '',
      reasons: entry.reasons,
    });

    const result = await executeRun({
      runId,
      batchId,
      runnerKey: entry.runnerKey,
      adapter,
      context,
      testFiles: entry.testFiles,
      reasons: entry.reasons,
      signal,
      logTailLines: config.output.logTailLines,
      dryRun: config.dryRun,
    });

    emit({ type: 'run.finished', result });
    return result;
  }

  /** Resultado sintetico para falhas de configuracao detectadas no motor. */
  function errorResult(
    batchId: string,
    runId: string,
    entry: RunPlan['entries'][number],
    message: string,
  ): TestRunResult {
    const result: TestRunResult = {
      runId,
      batchId,
      runnerKey: entry.runnerKey,
      adapterId: 'desconhecido',
      testFiles: entry.testFiles,
      command: '',
      status: 'errored',
      counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
      cases: [],
      durationMs: 0,
      exitCode: null,
      stdoutTail: [],
      stderrTail: [],
      error: message,
      reasons: entry.reasons,
    };
    emit({ type: 'run.finished', result });
    return result;
  }

  /** Ciclo completo de um lote: grafo -> plano -> execucao -> agregacao. */
  async function processBatch(
    files: readonly string[],
    trigger: FlushTrigger,
  ): Promise<BatchResult> {
    const batchId = batchIds.next();
    const startedAt = now();
    const changedFiles = [...new Set(files.map((file) => normalizePath(file, config.root)))];

    const controller = new AbortController();
    inFlight = controller;

    // `refreshGraph` nao lanca: o grafo absorve a falha de cada adapter e a
    // publica pelo `onDegradation` configurado acima. Se ainda assim algo
    // escapar, a fila de lotes reporta o erro (ver `enqueueBatch`).
    await refreshGraph(changedFiles);

    const plan = planBatch({ config, graph, resolver, changedFiles });

    emit({
      type: 'batch.started',
      batchId,
      changedFiles,
      trigger,
      plan: plan.entries.map((entry) => ({
        runnerKey: entry.runnerKey,
        adapterId: (config.runners[entry.runnerKey] as RunnerConfig).adapter,
        testFiles: entry.testFiles,
        reasons: entry.reasons,
      })),
      unmatched: plan.unmatched,
    });

    const runs = await mapWithConcurrency(
      plan.entries.map((entry) => () => runEntry(batchId, entry, controller.signal)),
      config.concurrency,
    );

    const result = aggregateBatch({
      batchId,
      changedFiles,
      runs,
      unmatched: plan.unmatched,
      startedAt,
      finishedAt: now(),
    });

    emit({ type: 'batch.finished', result });
    if (inFlight === controller) inFlight = null;
    return result;
  }

  /** Enfileira um lote, garantindo que apenas um rode por vez. */
  function enqueueBatch(files: readonly string[], trigger: FlushTrigger): Promise<BatchResult> {
    // Um lote novo torna o anterior obsoleto. O cancelamento precisa acontecer
    // aqui, no momento em que o lote entra na fila: se ficasse dentro de
    // `processBatch`, so rodaria depois que o anterior terminasse — que e
    // exatamente o que se quer evitar.
    inFlight?.abort();

    const next = queue.then(() => processBatch(files, trigger));
    // A fila nunca deve quebrar por causa de um lote com erro.
    queue = next.catch((error) => {
      reportDegradation('engine', 'falha ao processar o lote', errorMessage(error));
    });
    return next;
  }

  return {
    config,
    graph,
    resolver,

    subscribe: (listener) => bus.subscribe(listener),
    snapshot: () => store.snapshot(),
    flush: () => debouncer?.flushNow(),

    async start(): Promise<EngineStartResult> {
      if (started) throw new LiveTestError('DAEMON_ALREADY_RUNNING', 'o motor ja foi iniciado');
      started = true;

      for (const id of missing) {
        reportDegradation(
          'graph',
          `adapter de grafo desconhecido: "${id}"`,
          undefined,
          'os arquivos dessa linguagem ficam sem propagacao de dependencia',
        );
      }

      debouncer = createDebouncer({
        mode: config.debounce.mode,
        idleMs: config.debounce.idleMs,
        maxBatchWindowMs: config.debounce.maxBatchWindowMs,
        onFlush: (paths, trigger) => {
          void enqueueBatch(paths, trigger);
        },
      });

      watcher = createFileWatcher({
        root: config.root,
        watch: config.watch,
        ignore: config.ignore,
        logger,
        onChange: onFileChange,
        onError: (error) => reportDegradation('watcher', error.message, errorDetail(error)),
        ...(options.createWatcher ? { createWatcher: options.createWatcher } : {}),
      });

      const initialFiles = await watcher.start();
      store.registerFiles(initialFiles);
      await graph.index(initialFiles);

      let address: { host: string; port: number } | null = null;
      if (config.server.enabled) {
        server = createEventServer({
          host: config.server.host,
          port: config.server.port,
          snapshot: () => store.snapshot(),
          logger,
        });
        try {
          address = await server.start();
          bus.subscribe((event) => server?.broadcast(event));
          discoveryPath = writeDiscoveryFile(config.server.discoveryFile, config.root, {
            pid: process.pid,
            host: address.host,
            port: address.port,
            root: config.root,
            version,
            protocolVersion: 1,
            startedAt: now(),
          });
        } catch (error) {
          // Sem canal de eventos a extensao nao conecta, mas o fluxo com IA
          // (stdout + log) continua intacto: nao e motivo para abortar.
          reportDegradation(
            'server',
            `nao foi possivel abrir o canal de eventos: ${errorMessage(error)}`,
            errorDetail(error),
            'apenas stdout e arquivo de log ficam disponiveis',
          );
          server = null;
          address = null;
        }
      }

      emit({
        type: 'daemon.started',
        pid: process.pid,
        root: config.root,
        version,
        protocolVersion: 1,
        server: address,
        configPath: config.configPath,
        indexedFiles: initialFiles.length,
      });

      return { indexedFiles: initialFiles.length, server: address, discoveryFile: discoveryPath };
    },

    async runFiles(files: readonly string[]): Promise<BatchResult> {
      return enqueueBatch(
        files.map((file) => normalizePath(file, config.root)),
        'manual',
      );
    },

    async stop(reason = 'encerrado pelo usuario'): Promise<void> {
      if (!started) return;
      started = false;

      inFlight?.abort();
      debouncer?.dispose();
      debouncer = null;

      await watcher?.close();
      watcher = null;

      emit({ type: 'daemon.stopped', reason });

      await server?.close();
      server = null;

      if (discoveryPath) {
        removeDiscoveryFile(config.server.discoveryFile, config.root);
        discoveryPath = null;
      }

      await graph.dispose();
      ndjson?.close();
      bus.clear();
    },
  };
}
