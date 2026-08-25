import fs from 'node:fs';
import net from 'node:net';
import { describe, expect, it, vi } from 'vitest';

import { connectToDaemon, createLineSplitter } from '../../src/server/client.js';
import {
  isProcessAlive,
  readDiscoveryFile,
  removeDiscoveryFile,
  writeDiscoveryFile,
} from '../../src/server/discovery.js';
import {
  createEventServer,
  encodeEvent,
  resolveServerAddress,
} from '../../src/server/event-server.js';
import type { DaemonSnapshot, LiveTestEvent } from '../../src/types/events.js';
import { createRecordingLogger } from '../helpers/logger.js';
import { createTempProject } from '../helpers/tmp.js';

const snapshot = (): DaemonSnapshot => ({
  pid: 1,
  root: '/proj',
  version: '0.1.0',
  protocolVersion: 1,
  startedAt: 0,
  running: false,
  lastBatch: null,
  files: [],
  totals: { batches: 0, runs: 0, failedRuns: 0 },
});

/** Aguarda ate `predicate` virar verdadeiro ou estourar o tempo. */
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condicao nao satisfeita a tempo');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('createLineSplitter', () => {
  it('separa linhas completas', () => {
    const lines: string[] = [];
    const push = createLineSplitter((line) => lines.push(line));
    push('a\nb\n');
    expect(lines).toEqual(['a', 'b']);
  });

  it('acumula linha parcial entre chunks', () => {
    const lines: string[] = [];
    const push = createLineSplitter((line) => lines.push(line));
    push('{"a":');
    push('1}\n');
    expect(lines).toEqual(['{"a":1}']);
  });

  it('ignora linhas vazias', () => {
    const lines: string[] = [];
    const push = createLineSplitter((line) => lines.push(line));
    push('\n\nx\n');
    expect(lines).toEqual(['x']);
  });
});

describe('encodeEvent', () => {
  it('serializa com quebra de linha final', () => {
    const line = encodeEvent({ type: 'daemon.stopped', seq: 1, timestamp: 0, reason: 'x' });
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toMatchObject({ type: 'daemon.stopped' });
  });
});

describe('isProcessAlive', () => {
  it('reconhece o proprio processo', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('rejeita pid invalido', () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
  });

  it('rejeita pid inexistente', () => {
    expect(isProcessAlive(2_147_483_600)).toBe(false);
  });
});

describe('arquivo de descoberta', () => {
  const info = {
    pid: process.pid,
    host: '127.0.0.1',
    port: 4321,
    root: '/proj',
    version: '0.1.0',
    protocolVersion: 1,
    startedAt: 0,
  };

  it('grava e le', () => {
    const project = createTempProject();
    try {
      writeDiscoveryFile('.livetest/daemon.json', project.root, info);
      const result = readDiscoveryFile('.livetest/daemon.json', project.root);
      expect(result.status).toBe('running');
      if (result.status === 'running') expect(result.info.port).toBe(4321);
    } finally {
      project.cleanup();
    }
  });

  it('classifica como absent quando nao existe', () => {
    const project = createTempProject();
    try {
      expect(readDiscoveryFile('.livetest/daemon.json', project.root).status).toBe('absent');
    } finally {
      project.cleanup();
    }
  });

  it('classifica como stale quando o pid morreu', () => {
    const project = createTempProject();
    try {
      writeDiscoveryFile('.livetest/daemon.json', project.root, { ...info, pid: 2_147_483_600 });
      expect(readDiscoveryFile('.livetest/daemon.json', project.root).status).toBe('stale');
    } finally {
      project.cleanup();
    }
  });

  it('classifica como invalid para JSON quebrado', () => {
    const project = createTempProject({ '.livetest/daemon.json': '{ quebrado' });
    try {
      expect(readDiscoveryFile('.livetest/daemon.json', project.root).status).toBe('invalid');
    } finally {
      project.cleanup();
    }
  });

  it('classifica como invalid quando faltam campos', () => {
    const project = createTempProject({ '.livetest/daemon.json': '{"pid":1}' });
    try {
      const result = readDiscoveryFile('.livetest/daemon.json', project.root);
      expect(result.status).toBe('invalid');
    } finally {
      project.cleanup();
    }
  });

  it('remove sem lancar quando o arquivo nao existe', () => {
    const project = createTempProject();
    try {
      expect(() => removeDiscoveryFile('.livetest/daemon.json', project.root)).not.toThrow();
    } finally {
      project.cleanup();
    }
  });
});

describe('canal de eventos ponta a ponta', () => {
  it('entrega snapshot na conexao e depois o fluxo ao vivo', async () => {
    const server = createEventServer({ host: '127.0.0.1', port: 0, snapshot });
    const address = await server.start();
    expect(address.port).toBeGreaterThan(0);

    const received: LiveTestEvent[] = [];
    const connection = await connectToDaemon({
      root: '/proj',
      address,
      onEvent: (event) => received.push(event),
    });

    try {
      await waitFor(() => received.length >= 1);
      expect(received[0]?.type).toBe('snapshot');

      server.broadcast({ type: 'daemon.stopped', seq: 2, timestamp: 0, reason: 'teste' });
      await waitFor(() => received.length >= 2);
      expect(received[1]).toMatchObject({ type: 'daemon.stopped', reason: 'teste' });
    } finally {
      connection.close();
      await server.close();
    }
  });

  it('conta e limpa os clientes conectados', async () => {
    const server = createEventServer({ host: '127.0.0.1', port: 0, snapshot });
    const address = await server.start();
    const connection = await connectToDaemon({ root: '/proj', address, onEvent: () => {} });
    try {
      await waitFor(() => server.clientCount() === 1);
      expect(server.clientCount()).toBe(1);
    } finally {
      connection.close();
      await waitFor(() => server.clientCount() === 0);
      await server.close();
    }
  });

  it('broadcast sem clientes nao lanca', async () => {
    const server = createEventServer({ host: '127.0.0.1', port: 0, snapshot });
    await server.start();
    try {
      expect(() =>
        server.broadcast({ type: 'daemon.stopped', seq: 1, timestamp: 0, reason: 'x' }),
      ).not.toThrow();
    } finally {
      await server.close();
    }
  });

  it('start e idempotente e address reflete a porta efetiva', async () => {
    const server = createEventServer({ host: '127.0.0.1', port: 0, snapshot });
    const first = await server.start();
    const second = await server.start();
    try {
      expect(second).toEqual(first);
      expect(server.address()).toEqual(first);
    } finally {
      await server.close();
    }
  });

  it('conecta usando o arquivo de descoberta', async () => {
    const project = createTempProject();
    const server = createEventServer({ host: '127.0.0.1', port: 0, snapshot });
    const address = await server.start();
    writeDiscoveryFile('.livetest/daemon.json', project.root, {
      pid: process.pid,
      host: address.host,
      port: address.port,
      root: project.root,
      version: '0.1.0',
      protocolVersion: 1,
      startedAt: 0,
    });

    const received: LiveTestEvent[] = [];
    const connection = await connectToDaemon({
      root: project.root,
      onEvent: (event) => received.push(event),
    });
    try {
      await waitFor(() => received.length >= 1);
      expect(received[0]?.type).toBe('snapshot');
    } finally {
      connection.close();
      await server.close();
      project.cleanup();
    }
  });

  it('falha com DAEMON_NOT_RUNNING quando nao ha daemon', async () => {
    const project = createTempProject();
    try {
      await expect(
        connectToDaemon({ root: project.root, onEvent: () => {} }),
      ).rejects.toMatchObject({ code: 'DAEMON_NOT_RUNNING' });
    } finally {
      project.cleanup();
    }
  });

  it('falha com DAEMON_NOT_RUNNING quando o pid esta morto', async () => {
    const project = createTempProject();
    writeDiscoveryFile('.livetest/daemon.json', project.root, {
      pid: 2_147_483_600,
      host: '127.0.0.1',
      port: 1,
      root: project.root,
      version: '0.1.0',
      protocolVersion: 1,
      startedAt: 0,
    });
    try {
      await expect(
        connectToDaemon({ root: project.root, onEvent: () => {} }),
      ).rejects.toThrow(/nao esta mais rodando/);
    } finally {
      project.cleanup();
    }
  });

  it('falha com CONNECTION_FAILED quando a porta esta fechada', async () => {
    await expect(
      connectToDaemon({
        root: '/proj',
        address: { host: '127.0.0.1', port: 1 },
        onEvent: () => {},
        timeoutMs: 1500,
      }),
    ).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
  });

  it('reporta linhas invalidas em vez de derrubar a conexao', async () => {
    const server = createEventServer({ host: '127.0.0.1', port: 0, snapshot });
    const address = await server.start();
    const errors: string[] = [];
    const received: LiveTestEvent[] = [];
    const connection = await connectToDaemon({
      root: '/proj',
      address,
      onEvent: (event) => received.push(event),
      onParseError: (line) => errors.push(line),
    });
    try {
      await waitFor(() => received.length >= 1);
      // Injeta uma linha invalida diretamente nos clientes do servidor.
      server.broadcast('nao-e-json' as unknown as LiveTestEvent);
      await waitFor(() => errors.length >= 1 || received.length >= 2);
      expect(errors.length + received.length).toBeGreaterThanOrEqual(2);
    } finally {
      connection.close();
      await server.close();
    }
  });
});

describe('resolveServerAddress', () => {
  it('devolve host e porta de um AddressInfo', () => {
    expect(resolveServerAddress({ address: '127.0.0.1', family: 'IPv4', port: 5000 }, 'localhost'))
      .toEqual({ host: 'localhost', port: 5000 });
  });

  it('rejeita endereco nulo (servidor nao esta escutando)', () => {
    expect(() => resolveServerAddress(null, '127.0.0.1')).toThrow(/nao foi possivel determinar/);
  });

  it('rejeita endereco de socket de dominio Unix', () => {
    expect(() => resolveServerAddress('/tmp/socket', '127.0.0.1')).toThrow(
      /nao foi possivel determinar/,
    );
  });
});

describe('createEventServer — falhas isoladas', () => {
  it('nao derruba a conexao quando o snapshot lanca', async () => {
    const { logger, lines } = createRecordingLogger('warn');
    const server = createEventServer({
      host: '127.0.0.1',
      port: 0,
      logger,
      snapshot: () => {
        throw new Error('estado corrompido');
      },
    });
    const address = await server.start();
    const connection = await connectToDaemon({ root: '/proj', address, onEvent: () => {} });
    try {
      await waitFor(() => lines.join(' ').includes('estado corrompido'));
      expect(server.clientCount()).toBe(1);
    } finally {
      connection.close();
      await server.close();
    }
  });

  it('ignora falha de escrita em um cliente', async () => {
    const server = createEventServer({ host: '127.0.0.1', port: 0, snapshot });
    const address = await server.start();
    const connection = await connectToDaemon({ root: '/proj', address, onEvent: () => {} });

    const spy = vi.spyOn(net.Socket.prototype, 'write').mockImplementation(() => {
      throw new Error('EPIPE');
    });
    try {
      await waitFor(() => server.clientCount() === 1);
      expect(() =>
        server.broadcast({ type: 'daemon.stopped', seq: 1, timestamp: 0, reason: 'x' }),
      ).not.toThrow();
    } finally {
      spy.mockRestore();
      connection.close();
      await server.close();
    }
  });

  it('close antes de start nao lanca', async () => {
    const server = createEventServer({ host: '127.0.0.1', port: 0, snapshot });
    await expect(server.close()).resolves.toBeUndefined();
    expect(server.address()).toBeNull();
  });

  it('rejeita quando a porta ja esta em uso', async () => {
    const primeiro = createEventServer({ host: '127.0.0.1', port: 0, snapshot });
    const { port } = await primeiro.start();
    const segundo = createEventServer({ host: '127.0.0.1', port, snapshot });
    try {
      await expect(segundo.start()).rejects.toThrow();
    } finally {
      await segundo.close();
      await primeiro.close();
    }
  });

  it('funciona sem logger informado', async () => {
    const server = createEventServer({ host: '127.0.0.1', port: 0, snapshot });
    const address = await server.start();
    try {
      expect(address.port).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });
});

describe('connectToDaemon — falhas de conexao e de protocolo', () => {
  it('reporta linha que nao e JSON valido', async () => {
    // Servidor cru: permite injetar exatamente o que trafega no socket.
    const cru = net.createServer((socket) => {
      socket.write('isto-nao-e-json\n');
      socket.write('{"type":"daemon.stopped","seq":1,"timestamp":0,"reason":"ok"}\n');
    });
    await new Promise<void>((resolve) => cru.listen(0, '127.0.0.1', () => resolve()));
    const endereco = cru.address() as net.AddressInfo;

    const eventos: LiveTestEvent[] = [];
    const erros: string[] = [];
    const connection = await connectToDaemon({
      root: '/proj',
      address: { host: '127.0.0.1', port: endereco.port },
      onEvent: (event) => eventos.push(event),
      onParseError: (line) => erros.push(line),
    });

    try {
      await waitFor(() => erros.length >= 1 && eventos.length >= 1);
      expect(erros[0]).toBe('isto-nao-e-json');
      expect(eventos[0]?.type).toBe('daemon.stopped');
    } finally {
      connection.close();
      await new Promise<void>((resolve) => cru.close(() => resolve()));
    }
  });

  it('avisa o fechamento quando o servidor encerra', async () => {
    const cru = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => cru.listen(0, '127.0.0.1', () => resolve()));
    const endereco = cru.address() as net.AddressInfo;

    const motivos: string[] = [];
    const connection = await connectToDaemon({
      root: '/proj',
      address: { host: '127.0.0.1', port: endereco.port },
      onEvent: () => {},
      onClose: (motivo) => motivos.push(motivo),
    });

    try {
      await waitFor(() => motivos.length >= 1);
      expect(motivos[0]).toBe('conexao encerrada');
    } finally {
      connection.close();
      await new Promise<void>((resolve) => cru.close(() => resolve()));
    }
  });

  it('nao exige callbacks opcionais', async () => {
    const cru = net.createServer((socket) => {
      socket.write('quebrado\n');
      socket.end();
    });
    await new Promise<void>((resolve) => cru.listen(0, '127.0.0.1', () => resolve()));
    const endereco = cru.address() as net.AddressInfo;

    const connection = await connectToDaemon({
      root: '/proj',
      address: { host: '127.0.0.1', port: endereco.port },
      onEvent: () => {},
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(connection.address.port).toBe(endereco.port);
    } finally {
      connection.close();
      await new Promise<void>((resolve) => cru.close(() => resolve()));
    }
  });

  it('falha por tempo esgotado em endereco que nao responde', async () => {
    // 203.0.113.0/24 e reservado para documentacao: nao ha rota para ele.
    await expect(
      connectToDaemon({
        root: '/proj',
        address: { host: '203.0.113.1', port: 9 },
        onEvent: () => {},
        timeoutMs: 200,
      }),
    ).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
  }, 20_000);

  it('falha com DAEMON_NOT_RUNNING para arquivo de descoberta invalido', async () => {
    const project = createTempProject({ '.livetest/daemon.json': '{ quebrado' });
    try {
      await expect(
        connectToDaemon({ root: project.root, onEvent: () => {} }),
      ).rejects.toThrow(/invalido/);
    } finally {
      project.cleanup();
    }
  });

  it('usa o arquivo de descoberta padrao quando nenhum e informado', async () => {
    const project = createTempProject();
    try {
      await expect(
        connectToDaemon({ root: project.root, onEvent: () => {} }),
      ).rejects.toThrow(/daemon.json/);
    } finally {
      project.cleanup();
    }
  });
});

describe('removeDiscoveryFile — falha de melhor esforco', () => {
  it('ignora erro do sistema de arquivos', () => {
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw new Error('EPERM');
    });
    try {
      expect(() => removeDiscoveryFile('.livetest/daemon.json', '/proj')).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
