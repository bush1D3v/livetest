/**
 * Barramento de eventos do daemon.
 *
 * Todos os canais de saida (stdout, log NDJSON, socket da extensao) sao apenas
 * assinantes deste barramento. Isso garante que os tres vejam exatamente a mesma
 * sequencia de eventos, na mesma ordem, com o mesmo numero de sequencia.
 *
 * @packageDocumentation
 */

import type { EventListener, LiveTestEvent } from '../types/events.js';

/** `Omit` que se distribui sobre os membros de uma uniao. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Evento como os produtores o escrevem: sem `seq` nem `timestamp`, que sao
 * preenchidos pelo barramento.
 */
export type LiveTestEventInput = DistributiveOmit<LiveTestEvent, 'seq' | 'timestamp'>;

/** Barramento de publicacao/assinatura. */
export interface EventBus {
  /**
   * Publica um evento, carimbando `seq` e `timestamp`.
   * @returns O evento completo, ja entregue aos assinantes.
   */
  emit(event: LiveTestEventInput): LiveTestEvent;
  /**
   * Registra um assinante.
   * @returns Funcao que cancela a assinatura.
   */
  subscribe(listener: EventListener): () => void;
  /** Numero de sequencia do ultimo evento publicado (`0` se nenhum). */
  lastSeq(): number;
  /** Remove todos os assinantes. */
  clear(): void;
}

/** Opcoes de {@link createEventBus}. */
export interface EventBusOptions {
  /** Relogio injetavel, para testes deterministicos. */
  now?: () => number;
  /** Chamado quando um assinante lanca. O barramento nunca propaga a excecao. */
  onListenerError?: (error: unknown) => void;
}

/**
 * Cria um {@link EventBus}.
 *
 * @example
 * ```ts
 * const bus = createEventBus();
 * const unsubscribe = bus.subscribe((event) => console.log(event.type));
 * bus.emit({ type: 'watch.change', path: '/a.ts', kind: 'change' });
 * unsubscribe();
 * ```
 */
export function createEventBus(options: EventBusOptions = {}): EventBus {
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<EventListener>();
  let seq = 0;

  return {
    emit(input: LiveTestEventInput): LiveTestEvent {
      const event = { ...input, seq: ++seq, timestamp: now() } as LiveTestEvent;
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (error) {
          // Um assinante quebrado (socket caindo, disco cheio) nao pode
          // interromper a entrega para os demais.
          options.onListenerError?.(error);
        }
      }
      return event;
    },

    subscribe(listener: EventListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    lastSeq: () => seq,
    clear: () => listeners.clear(),
  };
}
