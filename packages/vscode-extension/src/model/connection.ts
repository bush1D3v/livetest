/**
 * Maquina de estados da conexao com o daemon.
 *
 * A extensao **nunca sobe o daemon sozinha** (secao 4.3 do PRD): ela tenta se
 * conectar a um que ja esteja rodando e, quando nao acha, expoe o estado
 * `sem-daemon` para que a UI ofereca o botao de inicio manual.
 *
 * O modulo nao importa nada de `vscode`, o que o torna testavel sem instancia
 * de editor: quem chama injeta o conector.
 *
 * @packageDocumentation
 */

import type { DaemonSnapshot, LiveTestEvent } from '@livetest/core/client';

/** Estados possiveis da conexao. */
export type ConnectionState =
  /** Nunca conectou ou foi desconectado deliberadamente. */
  | 'desconectado'
  /** Tentativa de conexao em andamento. */
  | 'conectando'
  /** Recebendo eventos. */
  | 'conectado'
  /** Nao ha daemon em execucao; a UI deve oferecer o botao de iniciar. */
  | 'sem-daemon';

/** Conexao aberta, na forma minima de que este modulo precisa. */
export interface Connection {
  close(): void;
}

/** Funcao que abre a conexao. Injetada para permitir teste sem socket real. */
export type Connector = (handlers: {
  onEvent: (event: LiveTestEvent) => void;
  onClose: (reason: string) => void;
}) => Promise<Connection>;

/** Temporizadores injetaveis. */
export interface ConnectionTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Opcoes de {@link createDaemonConnection}. */
export interface DaemonConnectionOptions {
  connect: Connector;
  /** Intervalo entre tentativas de reconexao, em ms. */
  reconnectIntervalMs: number;
  /** Notificado a cada mudanca de estado. */
  onStateChange: (state: ConnectionState, detail: string | null) => void;
  /** Notificado a cada evento recebido. */
  onEvent: (event: LiveTestEvent) => void;
  timers?: ConnectionTimers;
}

/** Conexao gerenciada com o daemon. */
export interface DaemonConnection {
  /** Estado atual. */
  state(): ConnectionState;
  /** Ultimo snapshot recebido, ou `null`. */
  snapshot(): DaemonSnapshot | null;
  /** Tenta conectar agora. Reagenda sozinha em caso de falha. */
  connect(): Promise<void>;
  /** Desconecta e cancela a reconexao automatica. */
  disconnect(): void;
  /** Libera todos os recursos. */
  dispose(): void;
}

/** Timers padrao, apoiados no Node. */
const defaultTimers: ConnectionTimers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** Reconhece a falha "nao ha daemon" entre as demais falhas de conexao. */
export function isDaemonAbsent(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'DAEMON_NOT_RUNNING';
}

/**
 * Cria a conexao gerenciada.
 *
 * @example
 * ```ts
 * const connection = createDaemonConnection({
 *   connect: (handlers) => connectToDaemon({ root, ...handlers }),
 *   reconnectIntervalMs: 3000,
 *   onStateChange: (state) => statusBar.update(state),
 *   onEvent: (event) => tree.apply(event),
 * });
 * await connection.connect();
 * ```
 */
export function createDaemonConnection(options: DaemonConnectionOptions): DaemonConnection {
  const timers = options.timers ?? defaultTimers;
  let state: ConnectionState = 'desconectado';
  let current: Connection | null = null;
  let retryHandle: unknown = null;
  let snapshot: DaemonSnapshot | null = null;
  let disposed = false;
  /** Evita que uma conexao antiga, ao cair, reagende sobre uma nova. */
  let generation = 0;

  function setState(next: ConnectionState, detail: string | null = null): void {
    if (state === next) return;
    state = next;
    options.onStateChange(next, detail);
  }

  function cancelRetry(): void {
    if (retryHandle === null) return;
    timers.clearTimeout(retryHandle);
    retryHandle = null;
  }

  function scheduleRetry(): void {
    if (disposed || retryHandle !== null) return;
    retryHandle = timers.setTimeout(() => {
      retryHandle = null;
      void attempt();
    }, options.reconnectIntervalMs);
  }

  async function attempt(): Promise<void> {
    if (disposed || state === 'conectando' || state === 'conectado') return;
    const myGeneration = ++generation;
    setState('conectando');

    try {
      const connection = await options.connect({
        onEvent: (event) => {
          if (event.type === 'snapshot') snapshot = event.state;
          if (event.type === 'daemon.stopped') snapshot = null;
          options.onEvent(event);
        },
        onClose: (reason) => {
          if (myGeneration !== generation || disposed) return;
          current = null;
          snapshot = null;
          setState('desconectado', reason);
          scheduleRetry();
        },
      });

      if (disposed || myGeneration !== generation) {
        connection.close();
        return;
      }
      current = connection;
      setState('conectado');
    } catch (error) {
      if (myGeneration !== generation || disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      setState(isDaemonAbsent(error) ? 'sem-daemon' : 'desconectado', message);
      scheduleRetry();
    }
  }

  return {
    state: () => state,
    snapshot: () => snapshot,
    connect: attempt,

    disconnect(): void {
      generation++;
      cancelRetry();
      current?.close();
      current = null;
      snapshot = null;
      setState('desconectado', 'desconectado pelo usuario');
    },

    dispose(): void {
      disposed = true;
      generation++;
      cancelRetry();
      current?.close();
      current = null;
    },
  };
}
