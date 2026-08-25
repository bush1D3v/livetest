/**
 * Motor de debounce (secao 6.3 do PRD).
 *
 * Agrupa saves consecutivos em um unico lote, combinando duas estrategias:
 *
 * - **idle**: dispara apos `idleMs` sem novos eventos;
 * - **batch**: dispara `maxBatchWindowMs` apos o *primeiro* evento do lote,
 *   garantindo que uma sequencia longa de edicoes nunca adie os testes para sempre;
 * - **both** (default): o que ocorrer primeiro dispara.
 *
 * O modulo e puro em relacao ao tempo: os timers sao injetaveis, o que torna os
 * testes deterministicos sem depender de `setTimeout` real.
 *
 * @packageDocumentation
 */

import type { DebounceMode } from '../types/config.js';

/** Motivo pelo qual um lote foi fechado. */
export type FlushTrigger = 'idle' | 'maxWindow' | 'manual';

/** Abstracao minima de timers, injetavel em testes. */
export interface TimerApi {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Implementacao padrao apoiada nos timers globais do Node. */
export const defaultTimerApi: TimerApi = {
  setTimeout: (handler, ms) => {
    const handle = setTimeout(handler, ms);
    // Nao segurar o event loop apenas por causa do debounce.
    handle.unref?.();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** Opcoes de {@link createDebouncer}. */
export interface DebouncerOptions {
  mode: DebounceMode;
  idleMs: number;
  maxBatchWindowMs: number;
  /**
   * Chamado quando o lote fecha. Recebe os caminhos na ordem em que foram
   * vistos pela primeira vez, sem repeticoes.
   */
  onFlush: (paths: string[], trigger: FlushTrigger) => void;
  timers?: TimerApi;
}

/** Agrupador de eventos de arquivo. */
export interface Debouncer {
  /** Registra um caminho alterado no lote corrente. */
  push(path: string): void;
  /** Fecha o lote imediatamente (`trigger: 'manual'`). No-op se vazio. */
  flushNow(): void;
  /** Caminhos acumulados no lote corrente. */
  pending(): string[];
  /** Descarta o lote corrente sem disparar `onFlush`. */
  clear(): void;
  /** Libera timers. O debouncer nao deve ser usado depois disto. */
  dispose(): void;
}

/**
 * Cria um {@link Debouncer}.
 *
 * @example
 * ```ts
 * const debouncer = createDebouncer({
 *   mode: 'both',
 *   idleMs: 400,
 *   maxBatchWindowMs: 3000,
 *   onFlush: (paths, trigger) => console.log(trigger, paths),
 * });
 * debouncer.push('/proj/src/a.ts');
 * ```
 */
export function createDebouncer(options: DebouncerOptions): Debouncer {
  const timers = options.timers ?? defaultTimerApi;
  const { mode, onFlush } = options;
  const idleMs = Math.max(0, options.idleMs);
  const maxBatchWindowMs = Math.max(0, options.maxBatchWindowMs);

  const useIdle = mode === 'idle' || mode === 'both';
  const useBatch = mode === 'batch' || mode === 'both';

  /** Set preserva a ordem de insercao, que e a ordem dos saves. */
  let batch = new Set<string>();
  let idleHandle: unknown = null;
  let batchHandle: unknown = null;
  let disposed = false;

  function clearTimers(): void {
    if (idleHandle !== null) {
      timers.clearTimeout(idleHandle);
      idleHandle = null;
    }
    if (batchHandle !== null) {
      timers.clearTimeout(batchHandle);
      batchHandle = null;
    }
  }

  function flush(trigger: FlushTrigger): void {
    clearTimers();
    if (batch.size === 0) return;
    const paths = [...batch];
    batch = new Set();
    onFlush(paths, trigger);
  }

  return {
    push(path: string): void {
      if (disposed) return;
      batch.add(path);

      if (useIdle) {
        if (idleHandle !== null) timers.clearTimeout(idleHandle);
        idleHandle = timers.setTimeout(() => {
          idleHandle = null;
          flush('idle');
        }, idleMs);
      }

      // A janela maxima conta a partir do primeiro evento do lote: por isso o
      // timer so e criado quando ainda nao existe.
      if (useBatch && batchHandle === null) {
        batchHandle = timers.setTimeout(() => {
          batchHandle = null;
          flush('maxWindow');
        }, maxBatchWindowMs);
      }

      // Modo sem nenhum timer ativo nao existe: `mode` cobre os tres casos.
    },

    flushNow(): void {
      if (disposed) return;
      flush('manual');
    },

    pending(): string[] {
      return [...batch];
    },

    clear(): void {
      clearTimers();
      batch = new Set();
    },

    dispose(): void {
      disposed = true;
      clearTimers();
      batch = new Set();
    },
  };
}
