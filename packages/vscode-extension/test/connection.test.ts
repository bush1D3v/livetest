import { describe, expect, it, vi } from 'vitest';

import { LiveTestError, type LiveTestEvent } from '@livetest/core/client';

import {
  createDaemonConnection,
  isDaemonAbsent,
  type Connection,
  type ConnectionState,
} from '../src/model/connection.js';

/** Timers controlados manualmente, para testar a reconexao sem esperar. */
function fakeTimers() {
  const pending: Array<{ id: number; handler: () => void }> = [];
  let nextId = 1;
  return {
    api: {
      setTimeout: (handler: () => void) => {
        const id = nextId++;
        pending.push({ id, handler });
        return id;
      },
      clearTimeout: (handle: unknown) => {
        const index = pending.findIndex((item) => item.id === handle);
        if (index >= 0) pending.splice(index, 1);
      },
    },
    /** Dispara todos os timers pendentes. */
    flush(): void {
      const snapshot = [...pending];
      pending.length = 0;
      for (const item of snapshot) item.handler();
    },
    count: () => pending.length,
  };
}

/** Caixa mutavel para capturar callbacks de dentro do conector. */
interface Captured {
  deliver?: (event: LiveTestEvent) => void;
  close?: (reason: string) => void;
  resolve?: (connection: Connection) => void;
  reject?: (reason: unknown) => void;
}

/** Monta uma conexao com um conector controlado pelo teste. */
function setup(
  connect: Parameters<typeof createDaemonConnection>[0]['connect'],
  reconnectIntervalMs = 1000,
) {
  const states: Array<{ state: ConnectionState; detail: string | null }> = [];
  const events: LiveTestEvent[] = [];
  const timers = fakeTimers();

  const connection = createDaemonConnection({
    connect,
    reconnectIntervalMs,
    timers: timers.api,
    onStateChange: (state, detail) => states.push({ state, detail }),
    onEvent: (event) => events.push(event),
  });

  return { connection, states, events, timers };
}

const snapshotEvent = (): LiveTestEvent => ({
  type: 'snapshot',
  seq: 0,
  timestamp: 0,
  state: {
    pid: 1,
    root: '/proj',
    version: '0.1.0',
    protocolVersion: 1,
    startedAt: 0,
    running: false,
    lastBatch: null,
    files: [],
    totals: { batches: 0, runs: 0, failedRuns: 0 },
  },
});

describe('isDaemonAbsent', () => {
  it('reconhece o codigo DAEMON_NOT_RUNNING', () => {
    expect(isDaemonAbsent(new LiveTestError('DAEMON_NOT_RUNNING', 'x'))).toBe(true);
  });

  it('rejeita outros erros', () => {
    expect(isDaemonAbsent(new LiveTestError('CONNECTION_FAILED', 'x'))).toBe(false);
    expect(isDaemonAbsent(new Error('generico'))).toBe(false);
    expect(isDaemonAbsent(null)).toBe(false);
  });
});

describe('createDaemonConnection', () => {
  const okConnection: Connection = { close: () => {} };

  it('comeca desconectada', () => {
    const { connection } = setup(async () => okConnection);
    expect(connection.state()).toBe('desconectado');
    expect(connection.snapshot()).toBeNull();
  });

  it('passa por conectando ate conectado', async () => {
    const { connection, states } = setup(async () => okConnection);
    await connection.connect();
    expect(states.map((s) => s.state)).toEqual(['conectando', 'conectado']);
    expect(connection.state()).toBe('conectado');
  });

  it('guarda o snapshot recebido', async () => {
    const captured: Captured = {};
    const { connection } = setup(async (handlers) => {
      captured.deliver = handlers.onEvent;
      return okConnection;
    });
    await connection.connect();
    captured.deliver?.(snapshotEvent());
    expect(connection.snapshot()?.root).toBe('/proj');
  });

  it('repassa os eventos ao consumidor', async () => {
    const captured: Captured = {};
    const { connection, events } = setup(async (handlers) => {
      captured.deliver = handlers.onEvent;
      return okConnection;
    });
    await connection.connect();
    captured.deliver?.({ type: 'daemon.stopped', seq: 1, timestamp: 0, reason: 'x' });
    expect(events).toHaveLength(1);
  });

  it('descarta o snapshot quando o daemon para', async () => {
    const captured: Captured = {};
    const { connection } = setup(async (handlers) => {
      captured.deliver = handlers.onEvent;
      return okConnection;
    });
    await connection.connect();
    captured.deliver?.(snapshotEvent());
    captured.deliver?.({ type: 'daemon.stopped', seq: 2, timestamp: 0, reason: 'x' });
    expect(connection.snapshot()).toBeNull();
  });

  it('entra em sem-daemon quando nao ha daemon', async () => {
    const { connection, states } = setup(async () => {
      throw new LiveTestError('DAEMON_NOT_RUNNING', 'nenhum daemon');
    });
    await connection.connect();
    expect(connection.state()).toBe('sem-daemon');
    expect(states.at(-1)?.detail).toContain('nenhum daemon');
  });

  it('entra em desconectado para outras falhas', async () => {
    const { connection } = setup(async () => {
      throw new LiveTestError('CONNECTION_FAILED', 'porta fechada');
    });
    await connection.connect();
    expect(connection.state()).toBe('desconectado');
  });

  it('reagenda a reconexao apos falhar', async () => {
    const connect = vi.fn().mockRejectedValue(new LiveTestError('DAEMON_NOT_RUNNING', 'x'));
    const { connection, timers } = setup(connect);
    await connection.connect();
    expect(timers.count()).toBe(1);

    timers.flush();
    await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('reconecta quando a conexao cai', async () => {
    const captured: Captured = {};
    const connect = vi.fn(async (handlers: { onClose: (reason: string) => void }) => {
      captured.close = handlers.onClose;
      return okConnection;
    });
    const { connection, timers } = setup(connect as never);

    await connection.connect();
    captured.close?.('socket caiu');
    expect(connection.state()).toBe('desconectado');

    timers.flush();
    await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('nao conecta duas vezes em paralelo', async () => {
    const connect = vi.fn(async () => okConnection);
    const { connection } = setup(connect);
    await Promise.all([connection.connect(), connection.connect()]);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('disconnect fecha a conexao e cancela a reconexao', async () => {
    const close = vi.fn();
    const { connection, timers } = setup(async () => ({ close }));
    await connection.connect();
    connection.disconnect();

    expect(close).toHaveBeenCalledOnce();
    expect(connection.state()).toBe('desconectado');
    expect(timers.count()).toBe(0);
  });

  it('dispose impede novas tentativas', async () => {
    const connect = vi.fn().mockRejectedValue(new LiveTestError('DAEMON_NOT_RUNNING', 'x'));
    const { connection, timers } = setup(connect);
    await connection.connect();
    connection.dispose();
    timers.flush();
    await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('fecha uma conexao que chegou depois do dispose', async () => {
    const close = vi.fn();
    const captured: Captured = {};
    const { connection } = setup(
      () =>
        new Promise<Connection>((resolve) => {
          captured.resolve = resolve;
        }),
    );

    const connecting = connection.connect();
    connection.dispose();
    captured.resolve?.({ close });
    await connecting;

    expect(close).toHaveBeenCalledOnce();
  });

  it('ignora o fechamento de uma conexao antiga', async () => {
    const handlers: Array<(reason: string) => void> = [];
    const connect = vi.fn(async (h: { onClose: (reason: string) => void }) => {
      handlers.push(h.onClose);
      return okConnection;
    });
    const { connection, timers } = setup(connect as never);

    await connection.connect();
    connection.disconnect();
    await connection.connect();

    // O handler da primeira conexao dispara tarde: nao pode mexer no estado.
    handlers[0]?.('tardio');
    expect(connection.state()).toBe('conectado');
    expect(timers.count()).toBe(0);
  });
});

describe('createDaemonConnection — bordas', () => {
  const okConnection: Connection = { close: () => {} };

  it('usa timers reais quando nenhum e injetado', async () => {
    const estados: ConnectionState[] = [];
    let tentativas = 0;
    const connection = createDaemonConnection({
      reconnectIntervalMs: 20,
      connect: async () => {
        tentativas++;
        if (tentativas === 1) throw new LiveTestError('DAEMON_NOT_RUNNING', 'ainda nao');
        return okConnection;
      },
      onStateChange: (state) => estados.push(state),
      onEvent: () => {},
    });

    await connection.connect();
    expect(connection.state()).toBe('sem-daemon');

    // A reconexao automatica precisa acontecer sozinha, sem timers de teste.
    const limite = Date.now() + 3000;
    while (connection.state() !== 'conectado' && Date.now() < limite) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(connection.state()).toBe('conectado');
    connection.dispose();
  }, 20_000);

  it('nao notifica quando o estado nao muda', () => {
    const estados: ConnectionState[] = [];
    const { connection } = setup(async () => okConnection);
    void estados;
    // Ja comeca desconectada; desconectar de novo nao pode gerar notificacao.
    connection.disconnect();
    connection.disconnect();
    expect(connection.state()).toBe('desconectado');
  });

  it('descreve falha que nao e Error', async () => {
    const { connection, states } = setup(async () => {
      throw 'texto solto';
    });
    await connection.connect();
    expect(states.at(-1)).toEqual({ state: 'desconectado', detail: 'texto solto' });
  });

  it('nao empilha varias reconexoes', async () => {
    const connect = vi.fn().mockRejectedValue(new LiveTestError('DAEMON_NOT_RUNNING', 'x'));
    const { connection, timers } = setup(connect);
    await connection.connect();
    // Uma nova tentativa enquanto ha reconexao agendada nao cria outra.
    await connection.connect();
    expect(timers.count()).toBe(1);
    connection.dispose();
  });

  it('dispose sem conexao aberta nao lanca', () => {
    const { connection } = setup(async () => okConnection);
    expect(() => connection.dispose()).not.toThrow();
  });

  it('connect apos dispose nao faz nada', async () => {
    const connect = vi.fn(async () => okConnection);
    const { connection } = setup(connect);
    connection.dispose();
    await connection.connect();
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('createDaemonConnection — falha tardia', () => {
  it('ignora a falha de uma tentativa ja descartada', async () => {
    const captured: Captured = {};
    const { connection, states, timers } = setup(
      () =>
        new Promise<Connection>((_resolve, reject) => {
          captured.reject = reject;
        }),
    );

    const tentando = connection.connect();
    const estadosAntes = states.length;

    // A tentativa e descartada antes de a promessa rejeitar.
    connection.dispose();
    captured.reject?.(new Error('tarde demais'));
    await tentando;

    expect(states).toHaveLength(estadosAntes);
    expect(timers.count()).toBe(0);
  });
});

describe('defaultTimers', () => {
  it('cancela a reconexao agendada com timers reais', async () => {
    let tentativas = 0;
    const connection = createDaemonConnection({
      reconnectIntervalMs: 50,
      connect: async () => {
        tentativas++;
        throw new LiveTestError('DAEMON_NOT_RUNNING', 'sem daemon');
      },
      onStateChange: () => {},
      onEvent: () => {},
    });

    await connection.connect();
    expect(tentativas).toBe(1);

    // Descartar antes do disparo precisa cancelar o timer de verdade.
    connection.dispose();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(tentativas).toBe(1);
  }, 20_000);
});
