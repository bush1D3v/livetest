/**
 * Saidas em arquivo: log NDJSON append-only e snapshot de estado.
 *
 * Os dois existem para o mesmo consumidor — um agente de IA que nao ficou com o
 * stdout do daemon — mas respondem a perguntas diferentes:
 *
 * - `run.log` (NDJSON) responde *"o que aconteceu?"*, um evento por linha;
 * - `status.json` responde *"como esta agora?"*, sobrescrito a cada mudanca.
 *
 * @packageDocumentation
 */

import fs from 'node:fs';
import path from 'node:path';

import type { DaemonSnapshot, LiveTestEvent } from '../types/events.js';
import { normalizePath, toNative } from '../util/paths.js';

/** Opcoes de {@link createNdjsonLogger}. */
export interface NdjsonLoggerOptions {
  /** Caminho do arquivo, absoluto ou relativo a `root`. */
  file: string;
  root: string;
  /**
   * Tamanho maximo antes de rotacionar para `<arquivo>.1`.
   * @defaultValue 5_000_000
   */
  maxBytes?: number;
  /** Chamado quando a escrita falha; nunca lanca para o chamador. */
  onError?: (error: unknown) => void;
}

/** Escritor de log NDJSON. */
export interface NdjsonLogger {
  /** Acrescenta um evento como uma linha JSON. */
  write(event: LiveTestEvent): void;
  /** Caminho absoluto do arquivo. */
  readonly file: string;
  /** Fecha o arquivo. */
  close(): void;
}

/** Garante que o diretorio do arquivo existe. */
function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(toNative(file)), { recursive: true });
}

/**
 * Cria o escritor de log NDJSON.
 *
 * @example
 * ```ts
 * const logger = createNdjsonLogger({ file: '.livetest/run.log', root: '/proj' });
 * bus.subscribe((event) => logger.write(event));
 * ```
 */
export function createNdjsonLogger(options: NdjsonLoggerOptions): NdjsonLogger {
  const file = normalizePath(options.file, options.root);
  const maxBytes = options.maxBytes ?? 5_000_000;
  let handle: number | null = null;
  let written = 0;

  function open(): void {
    ensureDir(file);
    handle = fs.openSync(toNative(file), 'a');
    try {
      written = fs.statSync(toNative(file)).size;
    } catch {
      written = 0;
    }
  }

  function rotate(): void {
    if (handle !== null) fs.closeSync(handle);
    handle = null;
    try {
      fs.rmSync(toNative(`${file}.1`), { force: true });
      fs.renameSync(toNative(file), toNative(`${file}.1`));
    } catch {
      /* melhor esforco: se a rotacao falhar, seguimos anexando */
    }
    open();
    written = 0;
  }

  return {
    file,
    write(event: LiveTestEvent): void {
      try {
        if (handle === null) open();
        if (written >= maxBytes) rotate();
        const line = `${JSON.stringify(event)}\n`;
        fs.writeSync(handle as number, line);
        written += Buffer.byteLength(line);
      } catch (error) {
        options.onError?.(error);
      }
    },
    close(): void {
      if (handle === null) return;
      try {
        fs.closeSync(handle);
      } catch {
        /* ja fechado */
      }
      handle = null;
    },
  };
}

/** Opcoes de {@link createStatusFileWriter}. */
export interface StatusFileWriterOptions {
  file: string;
  root: string;
  onError?: (error: unknown) => void;
}

/** Escritor do snapshot de estado. */
export interface StatusFileWriter {
  /** Sobrescreve o arquivo com o snapshot atual. */
  write(snapshot: DaemonSnapshot): void;
  readonly file: string;
  /** Remove o arquivo (usado no encerramento). */
  remove(): void;
}

/**
 * Cria o escritor de `status.json`.
 *
 * A escrita e atomica (arquivo temporario + `rename`) para que um leitor nunca
 * encontre um JSON pela metade — cenario real quando um agente le o arquivo em
 * loop enquanto o daemon escreve.
 */
export function createStatusFileWriter(options: StatusFileWriterOptions): StatusFileWriter {
  const file = normalizePath(options.file, options.root);
  const temp = `${file}.tmp`;

  return {
    file,
    write(snapshot: DaemonSnapshot): void {
      try {
        ensureDir(file);
        fs.writeFileSync(toNative(temp), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
        fs.renameSync(toNative(temp), toNative(file));
      } catch (error) {
        options.onError?.(error);
      }
    },
    remove(): void {
      try {
        fs.rmSync(toNative(file), { force: true });
        fs.rmSync(toNative(temp), { force: true });
      } catch {
        /* melhor esforco */
      }
    },
  };
}
