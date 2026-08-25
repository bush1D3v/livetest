/**
 * Observador de arquivos.
 *
 * O chokidar v4 removeu o suporte a globs: ele observa diretorios e nos
 * aplicamos os filtros. A estrategia adotada e:
 *
 * 1. `ignored` recebe apenas os globs de **exclusao** — assim diretorios como
 *    `node_modules/` sao podados antes da descida recursiva, que e de longe o
 *    maior ganho de performance (NFR de performance, secao 8 do PRD);
 * 2. os globs de **inclusao** sao aplicados no handler de cada evento, ja que
 *    um diretorio nunca casa com `**\/*.ts` mas precisa ser percorrido.
 *
 * @packageDocumentation
 */

import { watch as chokidarWatch } from 'chokidar';

import type { FileChangeKind } from '../types/events.js';
import type { Logger } from '../types/logging.js';
import { createMatcher } from '../util/glob.js';
import { normalizePath, toNative } from '../util/paths.js';
import { noopLogger } from '../util/logger.js';

/** Opcoes de {@link createFileWatcher}. */
export interface FileWatcherOptions {
  /** Raiz absoluta observada. */
  root: string;
  /** Globs de inclusao. Vazio significa "nenhum arquivo". */
  watch: string[];
  /** Globs de exclusao, aplicados tambem a diretorios. */
  ignore: string[];
  /** Chamado a cada alteracao de arquivo incluido. */
  onChange: (path: string, kind: FileChangeKind) => void;
  /** Chamado em erros do watcher; o daemon nao deve cair por causa deles. */
  onError?: (error: Error) => void;
  logger?: Logger;
  /**
   * Espera de estabilizacao de escrita, em ms. Evita ler um arquivo pela metade
   * quando o editor grava em varias etapas. `0` desativa.
   * @defaultValue 40
   */
  awaitWriteFinishMs?: number;
  /** Usar polling em vez de eventos nativos (necessario em alguns FS de rede). */
  usePolling?: boolean;
  /**
   * Fabrica do observador subjacente.
   *
   * O padrao e o `chokidar`. Substituir permite exercitar os caminhos de erro e
   * a sequencia de eventos sem depender do sistema de arquivos real, que e
   * lento e nao reproduz falhas sob demanda.
   */
  createWatcher?: WatcherFactory;
}

/** Subconjunto do observador do chokidar de que este modulo depende. */
export interface UnderlyingWatcher {
  on(event: 'add' | 'change' | 'unlink', handler: (path: string) => void): unknown;
  on(event: 'error', handler: (error: unknown) => void): unknown;
  once(event: 'ready', handler: () => void): unknown;
  close(): Promise<void>;
}

/** Fabrica de {@link UnderlyingWatcher}. */
export type WatcherFactory = (
  path: string,
  options: Record<string, unknown>,
) => UnderlyingWatcher;

/** Fabrica padrao, apoiada no chokidar. */
export const chokidarWatcherFactory: WatcherFactory = (path, options) =>
  chokidarWatch(path, options) as unknown as UnderlyingWatcher;

/** Observador ativo. */
export interface FileWatcher {
  /**
   * Inicia a observacao e resolve quando o scan inicial termina.
   * @returns Arquivos incluidos encontrados no scan inicial (absolutos, POSIX).
   */
  start(): Promise<string[]>;
  /** Arquivos incluidos atualmente conhecidos. */
  watchedFiles(): string[];
  /** Encerra a observacao e libera os handles do SO. */
  close(): Promise<void>;
}

/**
 * Cria um {@link FileWatcher}.
 *
 * @example
 * ```ts
 * const watcher = createFileWatcher({
 *   root: '/proj',
 *   watch: ['src/**\/*.ts'],
 *   ignore: ['**\/node_modules/**'],
 *   onChange: (file, kind) => console.log(kind, file),
 * });
 * const initial = await watcher.start();
 * ```
 */
export function createFileWatcher(options: FileWatcherOptions): FileWatcher {
  const logger = (options.logger ?? noopLogger).child('watcher');
  const root = normalizePath(options.root);
  const isIncluded = createMatcher(options.watch, root);
  const isIgnored = createMatcher(options.ignore, root);
  const awaitWriteFinishMs = options.awaitWriteFinishMs ?? 40;

  const createWatcher = options.createWatcher ?? chokidarWatcherFactory;
  const known = new Set<string>();
  let watcher: UnderlyingWatcher | null = null;
  let ready = false;

  function handle(kind: FileChangeKind, rawPath: string): void {
    const file = normalizePath(rawPath);
    if (!isIncluded(file) || isIgnored(file)) return;

    if (kind === 'unlink') known.delete(file);
    else known.add(file);

    // Durante o scan inicial o chokidar emite `add` para tudo; esses eventos
    // servem apenas para montar o indice, nao para disparar testes.
    if (!ready) return;
    logger.debug('%s %s', kind, file);
    options.onChange(file, kind);
  }

  return {
    async start(): Promise<string[]> {
      if (watcher) return [...known];

      watcher = createWatcher(toNative(root), {
        ignoreInitial: false,
        persistent: true,
        followSymlinks: false,
        // Poda diretorios inteiros antes de descer neles.
        ignored: (checkedPath: string) => isIgnored(normalizePath(checkedPath)),
        ...(awaitWriteFinishMs > 0
          ? {
              awaitWriteFinish: {
                stabilityThreshold: awaitWriteFinishMs,
                pollInterval: Math.max(10, Math.floor(awaitWriteFinishMs / 4)),
              },
            }
          : {}),
        ...(options.usePolling ? { usePolling: true, interval: 300 } : {}),
      });

      watcher.on('add', (p) => handle('add', p));
      watcher.on('change', (p) => handle('change', p));
      watcher.on('unlink', (p) => handle('unlink', p));
      watcher.on('error', (error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn('erro do watcher: %s', err.message);
        options.onError?.(err);
      });

      await new Promise<void>((resolve) => {
        // `ready` dispara depois do scan inicial completo.
        watcher?.once('ready', () => resolve());
      });
      ready = true;
      logger.info('observando %d arquivo(s) em %s', known.size, root);
      return [...known];
    },

    watchedFiles(): string[] {
      return [...known];
    },

    async close(): Promise<void> {
      ready = false;
      if (!watcher) return;
      await watcher.close();
      watcher = null;
    },
  };
}
