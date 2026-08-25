/**
 * Caminhos de degradacao e de saida do motor.
 *
 * Ficam separados de `engine.test.ts`, que cobre o fluxo feliz: aqui o alvo sao
 * as situacoes em que algo da errado e o daemon precisa **continuar vivo**
 * (NFR de robustez, secao 8 do PRD).
 */

import fs from 'node:fs';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveConfig } from '../src/config/load.js';
import { connectToDaemon } from '../src/server/client.js';
import { createEngine, type LiveTestEngine } from '../src/engine.js';
import type { LiveTestUserConfig } from '../src/types/config.js';
import type { ErrorEvent, LiveTestEvent } from '../src/types/events.js';
import type { DependencyGraphAdapter, GraphAdapterContext } from '../src/types/graph.js';
import type { WatcherFactory } from '../src/watch/watcher.js';
import { toNative } from '../src/util/paths.js';
import { createRecordingLogger } from './helpers/logger.js';
import { createTempProject, type TempProject } from './helpers/tmp.js';

const FILES: Record<string, string> = {
  'src/login.ts': 'export const login = () => true;\n',
  'src/login.test.ts': 'import { login } from "./login";\n',
};

/** Runner que apenas roda um script Node — rapido e sem dependencia externa. */
function commandRunner(script = 'process.exit(0)'): LiveTestUserConfig['runners'] {
  return {
    js: {
      adapter: 'command',
      command: process.execPath,
      args: ['-e', script],
      match: ['**/*.ts'],
      testMatch: ['**/*.test.ts'],
      testPatterns: ['{dir}/{name}.test.{ext}'],
      testExtensions: ['ts'],
      graph: 'js-ts',
    },
  };
}

let project: TempProject | null = null;
let engine: LiveTestEngine | null = null;

afterEach(async () => {
  await engine?.stop('fim do teste');
  engine = null;
  project?.cleanup();
  project = null;
});

/** Cria o motor sobre um projeto temporario novo, sem inicia-lo. */
function build(
  user: LiveTestUserConfig = {},
  extras: Partial<Parameters<typeof createEngine>[0]> = {},
  files = FILES,
) {
  project = createTempProject(files);
  return buildEm(project.root, user, extras);
}

/** Cria o motor sobre uma raiz ja existente. */
function buildEm(
  root: string,
  user: LiveTestUserConfig = {},
  extras: Partial<Parameters<typeof createEngine>[0]> = {},
) {
  const { config } = resolveConfig(
    {
      useGitignore: false,
      output: { stdout: false, logFile: null, statusFile: null },
      server: { enabled: false },
      debounce: { idleMs: 20, maxBatchWindowMs: 200 },
      runners: commandRunner(),
      logLevel: 'silent',
      ...user,
    },
    { root },
  );

  const events: LiveTestEvent[] = [];
  engine = createEngine({ config, ...extras });
  engine.subscribe((event) => events.push(event));
  return { engine, events, root };
}

/** Erros publicados pelo motor. */
const erros = (events: LiveTestEvent[]): ErrorEvent[] =>
  events.filter((e): e is ErrorEvent => e.type === 'error');

/** Aguarda ate a condicao valer. */
async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > limite) throw new Error('condicao nao satisfeita a tempo');
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

describe('createEngine — construcao', () => {
  it('cria o proprio logger quando nenhum e informado', async () => {
    const { engine: e } = build();
    await expect(e.start()).resolves.toMatchObject({ server: null });
  });

  it('aceita adapters de grafo customizados', async () => {
    const analisados: string[][] = [];
    const custom: Record<string, (c: GraphAdapterContext) => DependencyGraphAdapter> = {
      'js-ts': () => ({
        id: 'js-ts',
        extensions: ['.ts'],
        analyze: async (files) => {
          analisados.push(files);
          return files.map((file) => ({ file, imports: [], unresolved: [] }));
        },
      }),
    };
    const { engine: e } = build({}, { graphAdapters: custom });
    await e.start();
    expect(analisados[0]?.length).toBe(2);
  });

  it('avisa sobre adapter de grafo desconhecido sem abortar', async () => {
    const { engine: e, events } = build({
      runners: { js: { ...commandRunner()!['js'], graph: 'cobol' } },
    });
    await e.start();

    const aviso = erros(events).find((evento) => evento.message.includes('cobol'));
    expect(aviso?.scope).toBe('graph');
    expect(aviso?.degradedTo).toContain('sem propagacao de dependencia');
    expect(aviso?.detail).toBeNull();
  });

  it('publica a degradacao reportada por um adapter de grafo', async () => {
    const custom = {
      'js-ts': (context: GraphAdapterContext): DependencyGraphAdapter => ({
        id: 'js-ts',
        extensions: ['.ts'],
        analyze: async (files) => {
          context.reportDegradation('parser incompleto', 'detalhe tecnico');
          return files.map((file) => ({ file, imports: [], unresolved: [] }));
        },
      }),
    };
    const { engine: e, events } = build({}, { graphAdapters: custom });
    await e.start();

    const aviso = erros(events).find((evento) => evento.message === 'parser incompleto');
    expect(aviso).toMatchObject({
      scope: 'graph',
      detail: 'detalhe tecnico',
      degradedTo: 'analise sem grafo de dependencias',
    });
  });
});

describe('createEngine — canais de saida', () => {
  it('escreve o relatorio no stdout no formato pretty', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const { engine: e } = build({ output: { stdout: true, format: 'pretty', color: false } });
      await e.start();
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls.map((c) => String(c[0])).join('')).toContain('livetest observando');
    } finally {
      spy.mockRestore();
    }
  });

  it('escreve eventos NDJSON no stdout no formato ndjson', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const { engine: e } = build({ output: { stdout: true, format: 'ndjson' } });
      await e.start();
      const linhas = spy.mock.calls.map((c) => String(c[0]).trim()).filter(Boolean);
      expect(JSON.parse(linhas[0] as string)).toMatchObject({ type: 'daemon.started' });
    } finally {
      spy.mockRestore();
    }
  });

  it('avisa quando nao consegue escrever o status.json', async () => {
    const { logger, lines } = createRecordingLogger('warn');
    const { engine: e } = build(
      { output: { stdout: false, logFile: null, statusFile: '.livetest/status.json' } },
      { logger },
      { ...FILES, '.livetest/status.json/marcador': '' },
    );
    await e.start();
    expect(lines.join(' ')).toContain('falha ao escrever status.json');
  });

  it('avisa quando nao consegue escrever o log', async () => {
    const { logger, lines } = createRecordingLogger('warn');
    const { engine: e } = build(
      { output: { stdout: false, logFile: '.livetest/run.log', statusFile: null } },
      { logger },
      { ...FILES, '.livetest/run.log/marcador': '' },
    );
    await e.start();
    expect(lines.join(' ')).toContain('falha ao escrever o log');
  });
});

describe('createEngine — canal de eventos indisponivel', () => {
  it('degrada para stdout e log quando a porta ja esta em uso', async () => {
    const ocupado = net.createServer();
    await new Promise<void>((resolve) => ocupado.listen(0, '127.0.0.1', () => resolve()));
    const { port } = ocupado.address() as net.AddressInfo;

    try {
      const { engine: e, events } = build({
        server: { enabled: true, host: '127.0.0.1', port },
      });
      const started = await e.start();

      expect(started.server).toBeNull();
      expect(started.discoveryFile).toBeNull();
      const aviso = erros(events).find((evento) => evento.scope === 'server');
      expect(aviso?.message).toContain('nao foi possivel abrir o canal de eventos');
      expect(aviso?.degradedTo).toContain('stdout');
      // O daemon continua util: o lote roda normalmente.
      const resultado = await e.runFiles([project!.path('src/login.ts')]);
      expect(resultado.status).toBe('passed');
    } finally {
      await new Promise<void>((resolve) => ocupado.close(() => resolve()));
    }
  }, 30_000);
});

describe('createEngine — observador de arquivos', () => {
  /**
   * Observador falso, controlado pelo teste.
   *
   * @param iniciais - Arquivos "encontrados" no scan inicial, emitidos como
   * `add` antes do `ready`, exatamente como o chokidar faz.
   */
  function fakeWatcher(iniciais: string[] = []) {
    const handlers = new Map<string, Array<(arg: unknown) => void>>();
    const emitir = (evento: string, arg?: unknown): void => {
      for (const h of handlers.get(evento) ?? []) h(arg);
    };

    const factory: WatcherFactory = () => {
      const alvo = {
        on(evento: string, handler: (arg: never) => void) {
          const lista = handlers.get(evento) ?? [];
          lista.push(handler as (arg: unknown) => void);
          handlers.set(evento, lista);
          return alvo;
        },
        once(_evento: 'ready', handler: () => void) {
          setTimeout(() => {
            for (const arquivo of iniciais) emitir('add', arquivo);
            handler();
          }, 0);
          return alvo;
        },
        async close() {},
      };
      return alvo as never;
    };

    return { factory, emitir };
  }

  it('publica erro do watcher como degradacao', async () => {
    const fake = fakeWatcher();
    const { engine: e, events } = build({}, { createWatcher: fake.factory });
    await e.start();

    fake.emitir('error', new Error('EMFILE: limite de descritores'));
    const aviso = erros(events).find((evento) => evento.scope === 'watcher');
    expect(aviso?.message).toContain('EMFILE');
    expect(aviso?.detail).toContain('Error');
  });

  it('remove do grafo o arquivo apagado, sem reindexa-lo', async () => {
    project = createTempProject(FILES);
    const fake = fakeWatcher([
      toNative(project.path('src/login.ts')),
      toNative(project.path('src/login.test.ts')),
    ]);
    const temp = project;
    const raiz = temp.root;
    project = null;
    const { engine: e, events } = buildEm(
      raiz,
      { dependencyDepth: { default: 'self' } },
      { createWatcher: fake.factory },
    );
    await e.start();
    const login = `${raiz}/src/login.ts`;
    expect(e.graph.files()).toContain(login);

    fake.emitir('unlink', toNative(login));
    await waitFor(() => events.some((evento) => evento.type === 'batch.finished'), 10_000);

    expect(e.graph.files()).not.toContain(login);
    temp.cleanup();
  }, 30_000);

  it('registra a criacao de um arquivo novo', async () => {
    const fake = fakeWatcher();
    const { engine: e, events } = build({}, { createWatcher: fake.factory });
    await e.start();

    project!.write('src/novo.ts', 'export const novo = 1;\n');
    fake.emitir('add', toNative(project!.path('src/novo.ts')));

    await waitFor(() => events.some((evento) => evento.type === 'watch.change'));
    const mudanca = events.find((evento) => evento.type === 'watch.change');
    expect(mudanca).toMatchObject({ kind: 'add' });
  }, 30_000);
});

describe('createEngine — cancelamento e fila', () => {
  it('cancela o lote anterior quando um novo chega', async () => {
    const { engine: e, events } = build({
      dependencyDepth: { default: 'self' },
      // O runner demora, dando tempo de o segundo lote chegar.
      runners: commandRunner('setTimeout(() => {}, 5000)'),
    });
    await e.start();
    const login = project!.path('src/login.ts');

    const primeiro = e.runFiles([login]);
    await waitFor(() => events.some((evento) => evento.type === 'run.started'));
    const segundo = e.runFiles([login]);

    const [a, b] = await Promise.all([primeiro, segundo]);
    // O primeiro lote e abortado; o segundo roda ate o fim.
    expect([a.status, b.status]).toContain('cancelled');
  }, 40_000);

  it('mantem a fila viva quando um lote falha', async () => {
    const { engine: e } = build(
      { dependencyDepth: { default: 'self' } },
      {
        runnerAdapters: {
          command: () => {
            throw new Error('adapter quebrado no carregamento');
          },
        },
      },
    );
    await e.start();
    const login = project!.path('src/login.ts');

    await expect(e.runFiles([login])).rejects.toThrow('adapter quebrado');
    // A fila nao pode ter ficado envenenada: o lote seguinte precisa rodar.
    await expect(e.runFiles([login])).rejects.toThrow('adapter quebrado');
  }, 40_000);

  it('reporta erro do adapter de runner desconhecido', async () => {
    const { engine: e } = build({
      dependencyDepth: { default: 'self' },
      runners: { js: { ...commandRunner()!['js'], adapter: 'inexistente' } },
    });
    await e.start();

    const resultado = await e.runFiles([project!.path('src/login.ts')]);
    expect(resultado.runs[0]?.error).toContain('adapter de runner desconhecido');
    expect(resultado.runs[0]?.adapterId).toBe('desconhecido');
  }, 40_000);

  it('degrada quando a atualizacao do grafo falha', async () => {
    let falhar = false;
    const custom = {
      'js-ts': (): DependencyGraphAdapter => ({
        id: 'js-ts',
        extensions: ['.ts'],
        analyze: async (files) => {
          if (falhar) throw new Error('parser morreu');
          return files.map((file) => ({ file, imports: [], unresolved: [] }));
        },
      }),
    };
    const { engine: e, events } = build(
      { dependencyDepth: { default: 'self' } },
      { graphAdapters: custom },
    );
    await e.start();

    falhar = true;
    await e.runFiles([project!.path('src/login.ts')]);

    // O grafo degrada com aviso publicado no canal de eventos, e o lote roda.
    expect(events.some((evento) => evento.type === 'batch.finished')).toBe(true);
    const aviso = erros(events).find((evento) => evento.message.includes('parser morreu'));
    expect(aviso).toMatchObject({
      scope: 'graph',
      degradedTo: 'os arquivos afetados rodam sem propagacao',
    });
  }, 40_000);
});

describe('createEngine — encerramento', () => {
  it('usa o motivo padrao quando nenhum e informado', async () => {
    const { engine: e, events } = build();
    await e.start();
    await e.stop();
    engine = null;

    const parada = events.find((evento) => evento.type === 'daemon.stopped');
    expect(parada).toMatchObject({ reason: 'encerrado pelo usuario' });
  });

  it('flush antes de iniciar nao lanca', () => {
    const { engine: e } = build();
    expect(() => e.flush()).not.toThrow();
  });

  it('flush fecha o lote pendente do debounce', async () => {
    const fake = (() => {
      const handlers = new Map<string, Array<(arg: unknown) => void>>();
      const factory: WatcherFactory = () => {
        const alvo = {
          on(evento: string, handler: (arg: never) => void) {
            const lista = handlers.get(evento) ?? [];
            lista.push(handler as (arg: unknown) => void);
            handlers.set(evento, lista);
            return alvo;
          },
          once(_e: 'ready', handler: () => void) {
            setTimeout(handler, 0);
            return alvo;
          },
          async close() {},
        };
        return alvo as never;
      };
      return {
        factory,
        emitir: (evento: string, arg?: unknown) => {
          for (const h of handlers.get(evento) ?? []) h(arg);
        },
      };
    })();

    const { engine: e, events } = build(
      { debounce: { mode: 'idle', idleMs: 60_000, maxBatchWindowMs: 60_000 } },
      { createWatcher: fake.factory },
    );
    await e.start();

    fake.emitir('change', toNative(project!.path('src/login.ts')));
    e.flush();

    await waitFor(() => events.some((evento) => evento.type === 'batch.finished'), 10_000);
  }, 40_000);
});

describe('createEngine — assinantes e snapshot do canal', () => {
  it('isola um assinante que lanca', async () => {
    const { logger, lines } = createRecordingLogger('warn');
    const { engine: e } = build({}, { logger });
    e.subscribe(() => {
      throw new Error('assinante quebrado');
    });
    await e.start();

    // O daemon subiu apesar do assinante ruim, e o problema foi registrado.
    expect(lines.join(' ')).toContain('assinante falhou');
    expect(lines.join(' ')).toContain('assinante quebrado');
  });

  it('entrega o snapshot atual a quem se conecta ao canal de eventos', async () => {
    const { engine: e } = build({ server: { enabled: true, host: '127.0.0.1', port: 0 } });
    const started = await e.start();
    expect(started.server).not.toBeNull();

    const recebidos: LiveTestEvent[] = [];
    const conexao = await connectToDaemon({
      root: project!.root,
      address: started.server!,
      onEvent: (evento) => recebidos.push(evento),
    });

    try {
      await waitFor(() => recebidos.length >= 1);
      const snapshot = recebidos[0];
      expect(snapshot?.type).toBe('snapshot');
      if (snapshot?.type === 'snapshot') {
        expect(snapshot.state.root).toBe(project!.root);
        expect(snapshot.state.files.length).toBeGreaterThan(0);
      }
    } finally {
      conexao.close();
    }
  }, 30_000);
});
