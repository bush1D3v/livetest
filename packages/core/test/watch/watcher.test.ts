import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { createFileWatcher, type FileWatcher } from '../../src/watch/watcher.js';
import type { FileChangeKind } from '../../src/types/events.js';
import { normalizePath, toNative } from '../../src/util/paths.js';
import { createRecordingLogger } from '../helpers/logger.js';
import { createTempProject, type TempProject } from '../helpers/tmp.js';

interface Change {
  path: string;
  kind: FileChangeKind;
}

let project: TempProject;
let watcher: FileWatcher | null = null;

afterEach(async () => {
  await watcher?.close();
  watcher = null;
  project?.cleanup();
});

async function start(files: Record<string, string>, watchGlobs = ['**/*.ts']) {
  project = createTempProject(files);
  const changes: Change[] = [];
  watcher = createFileWatcher({
    root: project.root,
    watch: watchGlobs,
    ignore: ['**/node_modules/**', '**/.livetest/**'],
    logger: createRecordingLogger('error').logger,
    onChange: (path, kind) => changes.push({ path, kind }),
    awaitWriteFinishMs: 20,
  });
  const initial = await watcher.start();
  return { changes, initial, project };
}

/** Aguarda ate a condicao ser satisfeita ou estourar o tempo. */
async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condicao nao satisfeita a tempo');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('createFileWatcher', () => {
  it('indexa apenas os arquivos incluidos no scan inicial', async () => {
    const { initial, project: proj } = await start({
      'src/a.ts': '',
      'src/b.py': '',
      'README.md': '',
    });
    expect(initial).toEqual([proj.path('src/a.ts')]);
  });

  it('nao emite eventos durante o scan inicial', async () => {
    const { changes } = await start({ 'src/a.ts': '' });
    expect(changes).toEqual([]);
  });

  it('poda diretorios ignorados', async () => {
    const { initial } = await start({
      'src/a.ts': '',
      'node_modules/lib/index.ts': '',
      '.livetest/cache.ts': '',
    });
    expect(initial).toHaveLength(1);
  });

  it('detecta alteracao de arquivo', async () => {
    const { changes, project: proj } = await start({ 'src/a.ts': 'const a = 1;' });
    fs.writeFileSync(toNative(proj.path('src/a.ts')), 'const a = 2;', 'utf8');
    await waitFor(() => changes.some((c) => c.kind === 'change'));
    expect(changes[0]?.path).toBe(proj.path('src/a.ts'));
  }, 20_000);

  it('detecta criacao de arquivo', async () => {
    const { changes, project: proj } = await start({ 'src/a.ts': '' });
    fs.writeFileSync(toNative(proj.path('src/novo.ts')), 'const n = 1;', 'utf8');
    await waitFor(() => changes.some((c) => c.kind === 'add'));
    expect(changes.find((c) => c.kind === 'add')?.path).toBe(proj.path('src/novo.ts'));
  }, 20_000);

  it('detecta remocao de arquivo', async () => {
    const { changes, project: proj } = await start({ 'src/a.ts': '', 'src/b.ts': '' });
    fs.rmSync(toNative(proj.path('src/b.ts')));
    await waitFor(() => changes.some((c) => c.kind === 'unlink'));
    expect(changes.find((c) => c.kind === 'unlink')?.path).toBe(proj.path('src/b.ts'));
  }, 20_000);

  it('ignora arquivos fora dos globs observados', async () => {
    const { changes, project: proj } = await start({ 'src/a.ts': '' });
    fs.writeFileSync(toNative(proj.path('src/notas.md')), 'texto', 'utf8');
    // Da tempo de um evento indevido aparecer antes de concluir que nao veio.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(changes).toHaveLength(0);
  }, 20_000);

  it('mantem a lista de arquivos observados atualizada', async () => {
    const { project: proj } = await start({ 'src/a.ts': '' });
    fs.writeFileSync(toNative(proj.path('src/novo.ts')), '', 'utf8');
    await waitFor(() => (watcher?.watchedFiles().length ?? 0) === 2);
    expect(watcher?.watchedFiles()).toContain(proj.path('src/novo.ts'));
  }, 20_000);

  it('start e idempotente', async () => {
    const { initial } = await start({ 'src/a.ts': '' });
    await expect(watcher?.start()).resolves.toEqual(initial);
  });

  it('close pode ser chamado sem start', async () => {
    project = createTempProject({});
    const idle = createFileWatcher({
      root: project.root,
      watch: ['**/*.ts'],
      ignore: [],
      onChange: () => {},
    });
    await expect(idle.close()).resolves.toBeUndefined();
  });
});

/** Observador falso: permite disparar cada evento na hora exata do teste. */
function fakeUnderlying() {
  const handlers = new Map<string, Array<(arg: unknown) => void>>();
  let readyHandler: (() => void) | null = null;
  let closed = false;

  return {
    opcoes: {} as Record<string, unknown>,
    caminho: '',
    fechado: () => closed,
    emitir: (evento: string, arg?: unknown) => {
      for (const h of handlers.get(evento) ?? []) h(arg);
    },
    pronto: () => readyHandler?.(),
    factory: (caminho: string, opcoes: Record<string, unknown>) => {
      const alvo = {
        on(evento: string, handler: (arg: never) => void) {
          const lista = handlers.get(evento) ?? [];
          lista.push(handler as (arg: unknown) => void);
          handlers.set(evento, lista);
          return alvo;
        },
        once(_evento: 'ready', handler: () => void) {
          readyHandler = handler;
          // O scan inicial termina no proximo tick, como no chokidar real.
          setTimeout(handler, 0);
          return alvo;
        },
        async close() {
          closed = true;
        },
      };
      return alvo;
    },
  };
}

describe('createFileWatcher — observador injetado', () => {
  it('repassa erros do observador sem derrubar o daemon', async () => {
    const fake = fakeUnderlying();
    const erros: Error[] = [];
    const { logger, lines } = createRecordingLogger('warn');
    const w = createFileWatcher({
      root: '/proj',
      watch: ['**/*.ts'],
      ignore: [],
      logger,
      onChange: () => {},
      onError: (error) => erros.push(error),
      createWatcher: fake.factory,
    });
    await w.start();

    fake.emitir('error', new Error('EMFILE'));
    expect(erros[0]?.message).toBe('EMFILE');
    expect(lines.join(' ')).toContain('EMFILE');
  });

  it('normaliza erro que nao e Error', async () => {
    const fake = fakeUnderlying();
    const erros: Error[] = [];
    const w = createFileWatcher({
      root: '/proj',
      watch: ['**/*.ts'],
      ignore: [],
      onChange: () => {},
      onError: (error) => erros.push(error),
      createWatcher: fake.factory,
    });
    await w.start();

    fake.emitir('error', 'texto solto');
    expect(erros[0]).toBeInstanceOf(Error);
    expect(erros[0]?.message).toBe('texto solto');
  });

  it('nao exige callback de erro', async () => {
    const fake = fakeUnderlying();
    const w = createFileWatcher({
      root: '/proj',
      watch: ['**/*.ts'],
      ignore: [],
      onChange: () => {},
      createWatcher: fake.factory,
    });
    await w.start();
    expect(() => fake.emitir('error', new Error('x'))).not.toThrow();
  });

  it('liga o polling quando pedido', async () => {
    let opcoes: Record<string, unknown> = {};
    const fake = fakeUnderlying();
    const w = createFileWatcher({
      root: '/proj',
      watch: ['**/*.ts'],
      ignore: [],
      onChange: () => {},
      usePolling: true,
      createWatcher: (caminho, opts) => {
        opcoes = opts;
        return fake.factory(caminho, opts);
      },
    });
    await w.start();
    expect(opcoes['usePolling']).toBe(true);
    expect(opcoes['interval']).toBe(300);
  });

  it('desliga a espera de estabilizacao quando zero', async () => {
    let opcoes: Record<string, unknown> = {};
    const fake = fakeUnderlying();
    const w = createFileWatcher({
      root: '/proj',
      watch: ['**/*.ts'],
      ignore: [],
      onChange: () => {},
      awaitWriteFinishMs: 0,
      createWatcher: (caminho, opts) => {
        opcoes = opts;
        return fake.factory(caminho, opts);
      },
    });
    await w.start();
    expect(opcoes['awaitWriteFinish']).toBeUndefined();
  });

  it('aplica a espera de estabilizacao por padrao', async () => {
    let opcoes: Record<string, unknown> = {};
    const fake = fakeUnderlying();
    const w = createFileWatcher({
      root: '/proj',
      watch: ['**/*.ts'],
      ignore: [],
      onChange: () => {},
      createWatcher: (caminho, opts) => {
        opcoes = opts;
        return fake.factory(caminho, opts);
      },
    });
    await w.start();
    expect(opcoes['awaitWriteFinish']).toEqual({ stabilityThreshold: 40, pollInterval: 10 });
  });

  it('poda diretorios ignorados pelo predicado passado ao observador', async () => {
    let opcoes: Record<string, unknown> = {};
    const fake = fakeUnderlying();
    const w = createFileWatcher({
      root: '/proj',
      watch: ['**/*.ts'],
      ignore: ['**/node_modules/**'],
      onChange: () => {},
      createWatcher: (caminho, opts) => {
        opcoes = opts;
        return fake.factory(caminho, opts);
      },
    });
    await w.start();
    const ignored = opcoes['ignored'] as (p: string) => boolean;
    expect(ignored('/proj/node_modules/lib/index.ts')).toBe(true);
    expect(ignored('/proj/src/a.ts')).toBe(false);
  });

  it('ignora eventos de arquivos excluidos', async () => {
    const fake = fakeUnderlying();
    const mudancas: string[] = [];
    const w = createFileWatcher({
      root: '/proj',
      watch: ['**/*.ts'],
      ignore: ['**/gerado/**'],
      onChange: (path) => mudancas.push(path),
      createWatcher: fake.factory,
    });
    await w.start();

    fake.emitir('change', '/proj/gerado/a.ts');
    fake.emitir('change', '/proj/src/a.ts');
    expect(mudancas).toEqual([normalizePath('/proj/src/a.ts')]);
  });

  it('fecha o observador subjacente', async () => {
    const fake = fakeUnderlying();
    const w = createFileWatcher({
      root: '/proj',
      watch: ['**/*.ts'],
      ignore: [],
      onChange: () => {},
      createWatcher: fake.factory,
    });
    await w.start();
    await w.close();
    expect(fake.fechado()).toBe(true);
  });
});
