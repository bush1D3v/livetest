/**
 * Servidor do canal de eventos.
 *
 * Protocolo: **NDJSON sobre TCP em loopback**. Cada evento e um objeto JSON
 * seguido de `\n`. A escolha resolve a questao em aberto da secao 9 do PRD:
 *
 * - TCP em `127.0.0.1` funciona igual em Windows, Linux e macOS (named pipes e
 *   sockets Unix exigiriam dois caminhos de codigo);
 * - NDJSON e trivial de consumir tanto pela extensao quanto por um `nc`/`curl`
 *   durante depuracao;
 * - a porta `0` faz o SO escolher uma livre, e o numero real vai para o arquivo
 *   de descoberta — sem colisao entre projetos abertos ao mesmo tempo.
 *
 * Ao se conectar, o cliente recebe imediatamente um evento `snapshot` com o
 * estado completo, e so depois o fluxo ao vivo.
 *
 * @packageDocumentation
 */

import net from 'node:net';

import type { DaemonSnapshot, LiveTestEvent } from '../types/events.js';
import type { Logger } from '../types/logging.js';
import { noopLogger } from '../util/logger.js';

/** Endereco onde o servidor esta escutando. */
export interface ServerAddress {
  host: string;
  port: number;
}

/** Opcoes de {@link createEventServer}. */
export interface EventServerOptions {
  host: string;
  /** `0` deixa o SO escolher uma porta livre. */
  port: number;
  /** Chamado a cada conexao para montar o `snapshot` inicial. */
  snapshot: () => DaemonSnapshot;
  logger?: Logger;
}

/** Servidor do canal de eventos. */
export interface EventServer {
  /** Sobe o servidor e resolve com o endereco efetivo. */
  start(): Promise<ServerAddress>;
  /** Envia um evento a todos os clientes conectados. */
  broadcast(event: LiveTestEvent): void;
  /** Quantidade de clientes conectados. */
  clientCount(): number;
  /** Endereco atual, ou `null` se ainda nao iniciou. */
  address(): ServerAddress | null;
  /** Encerra o servidor e desconecta os clientes. */
  close(): Promise<void>;
}

/**
 * Valida o endereco devolvido por `net.Server#address()`.
 *
 * O Node tipa o retorno como `AddressInfo | string | null`: `string` para
 * sockets de dominio Unix e `null` quando o servidor nao esta escutando.
 * Nenhum dos dois pode acontecer aqui, mas a checagem existe para transformar
 * um estado impossivel em erro legivel em vez de `undefined.port`.
 *
 * @throws Error quando o endereco nao e um `AddressInfo`.
 */
export function resolveServerAddress(
  address: ReturnType<net.Server['address']>,
  host: string,
): ServerAddress {
  if (address === null || typeof address === 'string') {
    throw new Error('nao foi possivel determinar a porta do canal de eventos');
  }
  return { host, port: address.port };
}

/** Serializa um evento como uma linha NDJSON. */
export function encodeEvent(event: LiveTestEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Cria o servidor do canal de eventos.
 *
 * @example
 * ```ts
 * const server = createEventServer({ host: '127.0.0.1', port: 0, snapshot: () => store.snapshot() });
 * const { port } = await server.start();
 * bus.subscribe((event) => server.broadcast(event));
 * ```
 */
export function createEventServer(options: EventServerOptions): EventServer {
  const logger = (options.logger ?? noopLogger).child('server');
  const clients = new Set<net.Socket>();
  let server: net.Server | null = null;
  let listening: ServerAddress | null = null;

  function handleConnection(socket: net.Socket): void {
    clients.add(socket);
    socket.setNoDelay(true);
    logger.debug('cliente conectado (%d no total)', clients.size);

    const drop = (): void => {
      clients.delete(socket);
      logger.debug('cliente desconectado (%d restantes)', clients.size);
    };
    socket.on('close', drop);
    socket.on('error', drop);
    // O canal e unidirecional: nada que o cliente envie e interpretado.
    socket.on('data', () => {});

    try {
      const snapshotEvent: LiveTestEvent = {
        type: 'snapshot',
        seq: 0,
        timestamp: Date.now(),
        state: options.snapshot(),
      };
      socket.write(encodeEvent(snapshotEvent));
    } catch (error) {
      logger.warn('falha ao enviar snapshot inicial: %s', (error as Error).message);
    }
  }

  return {
    async start(): Promise<ServerAddress> {
      if (listening) return listening;

      server = net.createServer(handleConnection);
      server.on('error', (error) => logger.warn('erro no servidor: %s', error.message));

      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error);
        server?.once('error', onError);
        server?.listen(options.port, options.host, () => {
          server?.off('error', onError);
          resolve();
        });
      });

      listening = resolveServerAddress(server.address(), options.host);
      logger.info('canal de eventos em %s:%d', listening.host, listening.port);
      return listening;
    },

    broadcast(event: LiveTestEvent): void {
      if (clients.size === 0) return;
      const line = encodeEvent(event);
      for (const socket of clients) {
        try {
          socket.write(line);
        } catch {
          // Cliente que caiu no meio da escrita: sera removido pelo 'error'.
        }
      }
    },

    clientCount: () => clients.size,
    address: () => listening,

    async close(): Promise<void> {
      for (const socket of clients) socket.destroy();
      clients.clear();
      const current = server;
      server = null;
      listening = null;
      if (!current) return;
      await new Promise<void>((resolve) => current.close(() => resolve()));
    },
  };
}
