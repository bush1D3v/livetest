/**
 * Cliente do canal de eventos.
 *
 * Usado pela CLI (`livetest watch`, `livetest status`) e pela extensao do
 * VSCode. Encapsula a leitura do arquivo de descoberta, a conexao TCP, o
 * enquadramento NDJSON e a reconexao.
 *
 * @packageDocumentation
 */

import net from 'node:net';

import type { LiveTestEvent } from '../types/events.js';
import { LiveTestError } from '../util/errors.js';
import { readDiscoveryFile } from './discovery.js';

/** Opcoes de {@link connectToDaemon}. */
export interface ConnectOptions {
  /** Raiz do projeto, usada para localizar o arquivo de descoberta. */
  root: string;
  /** Caminho do arquivo de descoberta. @defaultValue `.livetest/daemon.json` */
  discoveryFile?: string;
  /** Host e porta explicitos, ignorando a descoberta. */
  address?: { host: string; port: number };
  onEvent: (event: LiveTestEvent) => void;
  /** Chamado quando a conexao cai. */
  onClose?: (reason: string) => void;
  /** Chamado para linhas que nao sao JSON valido. */
  onParseError?: (line: string, error: unknown) => void;
  /** Tempo maximo, em ms, para estabelecer a conexao. @defaultValue 5000 */
  timeoutMs?: number;
}

/** Conexao ativa com o daemon. */
export interface DaemonConnection {
  /** Encerra a conexao. */
  close(): void;
  /** Endereco ao qual esta conectado. */
  readonly address: { host: string; port: number };
}

/**
 * Divide um fluxo de bytes em linhas NDJSON.
 *
 * Exportado para teste: o enquadramento e a parte do protocolo mais facil de
 * quebrar quando um evento grande chega dividido em varios pacotes TCP.
 */
export function createLineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk: string): void => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length > 0) onLine(line);
      index = buffer.indexOf('\n');
    }
  };
}

/**
 * Conecta-se a um daemon em execucao.
 *
 * @throws {@link LiveTestError} `DAEMON_NOT_RUNNING` quando nao ha daemon ativo
 * (arquivo de descoberta ausente ou apontando para um processo morto).
 * @throws {@link LiveTestError} `CONNECTION_FAILED` quando o socket nao abre.
 *
 * @example
 * ```ts
 * const connection = await connectToDaemon({
 *   root: '/proj',
 *   onEvent: (event) => console.log(event.type),
 * });
 * connection.close();
 * ```
 */
export async function connectToDaemon(options: ConnectOptions): Promise<DaemonConnection> {
  const address = options.address ?? resolveAddress(options);
  const timeoutMs = options.timeoutMs ?? 5000;

  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const candidate = net.createConnection({ host: address.host, port: address.port });
    const timer = setTimeout(() => {
      candidate.destroy();
      reject(
        new LiveTestError(
          'CONNECTION_FAILED',
          `tempo esgotado ao conectar em ${address.host}:${address.port}`,
        ),
      );
    }, timeoutMs);
    timer.unref?.();

    candidate.once('connect', () => {
      clearTimeout(timer);
      candidate.off('error', onError);
      resolve(candidate);
    });
    function onError(error: Error): void {
      clearTimeout(timer);
      reject(
        new LiveTestError(
          'CONNECTION_FAILED',
          `nao foi possivel conectar em ${address.host}:${address.port}: ${error.message}`,
        ),
      );
    }
    candidate.once('error', onError);
  });

  socket.setEncoding('utf8');
  const push = createLineSplitter((line) => {
    try {
      options.onEvent(JSON.parse(line) as LiveTestEvent);
    } catch (error) {
      options.onParseError?.(line, error);
    }
  });

  socket.on('data', (chunk: string) => push(chunk));
  socket.on('close', () => options.onClose?.('conexao encerrada'));
  socket.on('error', (error) => options.onClose?.(error.message));

  return {
    address,
    close: () => socket.destroy(),
  };
}

/** Resolve o endereco do daemon a partir do arquivo de descoberta. */
function resolveAddress(options: ConnectOptions): { host: string; port: number } {
  const file = options.discoveryFile ?? '.livetest/daemon.json';
  const result = readDiscoveryFile(file, options.root);

  switch (result.status) {
    case 'running':
      return { host: result.info.host, port: result.info.port };
    case 'stale':
      throw new LiveTestError(
        'DAEMON_NOT_RUNNING',
        `o daemon registrado em ${result.file} (pid ${result.info.pid}) nao esta mais rodando`,
        ['Rode `livetest start` para inicia-lo novamente.'],
      );
    case 'invalid':
      throw new LiveTestError(
        'DAEMON_NOT_RUNNING',
        `arquivo de descoberta invalido em ${result.file}: ${result.error}`,
      );
    default:
      throw new LiveTestError('DAEMON_NOT_RUNNING', `nenhum daemon em execucao (${result.file})`, [
        'Rode `livetest start` na raiz do projeto.',
      ]);
  }
}
