import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveConfig } from '../src/config/load.js';
import { createEngine, type LiveTestEngine } from '../src/engine.js';
import type { LiveTestUserConfig } from '../src/types/config.js';
import type { LiveTestEvent } from '../src/types/events.js';
import { relativeToRoot, toNative } from '../src/util/paths.js';
import { createRecordingLogger } from './helpers/logger.js';
import { createTempProject, type TempProject } from './helpers/tmp.js';

/**
 * Projeto do caso de aceitacao: `login.ts` e importado por `header.ts` e
 * `footer.ts`; `layout.ts` importa `header.ts`.
 */
const FILES: Record<string, string> = {
  'src/login.ts': 'export const login = () => true;\n',
  'src/login.test.ts': 'import { login } from "./login";\n',
  'src/header.ts': 'import { login } from "./login";\nexport const header = login;\n',
  'src/header.test.ts': 'import { header } from "./header";\n',
  'src/footer.ts': 'import { login } from "./login";\nexport const footer = login;\n',
  'src/footer.test.ts': 'import { footer } from "./footer";\n',
  'src/layout.ts': 'import { header } from "./header";\nexport const layout = header;\n',
  'src/layout.test.ts': 'import { layout } from "./layout";\n',
};

/** Runner que apenas executa um script Node — rapido e sem dependencia externa. */
function commandRunner(script: string): LiveTestUserConfig['runners'] {
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

let project: TempProject;
let engine: LiveTestEngine | null = null;

afterEach(async () => {
  await engine?.stop('fim do teste');
  engine = null;
  project?.cleanup();
});

/** Cria e inicia um motor sobre um projeto temporario. */
async function startEngine(user: LiveTestUserConfig = {}, files = FILES) {
  project = createTempProject(files);
  const { config } = resolveConfig(
    {
      useGitignore: false,
      output: { stdout: false, logFile: '.livetest/run.log', statusFile: '.livetest/status.json' },
      server: { enabled: false },
      debounce: { idleMs: 30, maxBatchWindowMs: 200 },
      runners: commandRunner('process.exit(0)'),
      ...user,
    },
    { root: project.root },
  );

  const events: LiveTestEvent[] = [];
  engine = createEngine({ config, logger: createRecordingLogger('error').logger });
  engine.subscribe((event) => events.push(event));
  const started = await engine.start();
  return { engine, events, started, project };
}

/** Aguarda ate um evento do tipo pedido aparecer. */
async function waitForEvent<T extends LiveTestEvent['type']>(
  events: LiveTestEvent[],
  type: T,
  timeoutMs = 8000,
): Promise<Extract<LiveTestEvent, { type: T }>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = events.find((event) => event.type === type);
    if (found) return found as Extract<LiveTestEvent, { type: T }>;
    if (Date.now() > deadline) throw new Error(`evento "${type}" nao chegou a tempo`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

describe('createEngine — inicializacao', () => {
  it('indexa os arquivos observados no scan inicial', async () => {
    const { started, engine: e } = await startEngine();
    expect(started.indexedFiles).toBe(Object.keys(FILES).length);
    expect(e.graph.size()).toBe(Object.keys(FILES).length);
  });

  it('emite daemon.started com os metadados', async () => {
    const { events } = await startEngine();
    const event = await waitForEvent(events, 'daemon.started');
    expect(event.pid).toBe(process.pid);
    expect(event.protocolVersion).toBe(1);
    expect(event.indexedFiles).toBeGreaterThan(0);
  });

  it('recusa iniciar duas vezes', async () => {
    const { engine: e } = await startEngine();
    await expect(e.start()).rejects.toMatchObject({ code: 'DAEMON_ALREADY_RUNNING' });
  });

  it('monta o grafo reverso a partir dos imports reais', async () => {
    const { engine: e, project: proj } = await startEngine();
    // O proprio arquivo de teste tambem importa o fonte, entao aparece aqui.
    expect(e.graph.dependentsOf(proj.path('src/login.ts')).sort()).toEqual([
      proj.path('src/footer.ts'),
      proj.path('src/header.ts'),
      proj.path('src/login.test.ts'),
    ]);
  });
});

describe('createEngine — plano e propagacao', () => {
  it('propaga para os importadores diretos', async () => {
    const { engine: e, events, project: proj } = await startEngine({
      dependencyDepth: { default: 'direct' },
      dryRun: true,
    });
    await e.runFiles([proj.path('src/login.ts')]);

    const batch = await waitForEvent(events, 'batch.started');
    const testFiles = (batch.plan[0]?.testFiles ?? []).map((f) => relativeToRoot(proj.root, f));
    expect(testFiles.sort()).toEqual([
      'src/footer.test.ts',
      'src/header.test.ts',
      'src/login.test.ts',
    ]);
  });

  it('propaga pela cadeia completa com transitive', async () => {
    const { engine: e, events, project: proj } = await startEngine({
      dependencyDepth: { default: 'transitive' },
      dryRun: true,
    });
    await e.runFiles([proj.path('src/login.ts')]);

    const batch = await waitForEvent(events, 'batch.started');
    expect(batch.plan[0]?.testFiles).toHaveLength(4);
  });

  it('respeita override por arquivo', async () => {
    const { engine: e, events, project: proj } = await startEngine({
      dependencyDepth: { default: 'self', overrides: { 'src/login.ts': 'transitive' } },
      dryRun: true,
    });
    await e.runFiles([proj.path('src/header.ts')]);
    const first = await waitForEvent(events, 'batch.started');
    expect(first.plan[0]?.testFiles).toHaveLength(1);
  });

  it('registra o motivo de cada teste selecionado', async () => {
    const { engine: e, events, project: proj } = await startEngine({
      dependencyDepth: { default: 'direct' },
      dryRun: true,
    });
    await e.runFiles([proj.path('src/login.ts')]);

    const batch = await waitForEvent(events, 'batch.started');
    const reason = batch.plan[0]?.reasons[proj.path('src/header.test.ts')]?.[0];
    expect(reason).toMatchObject({
      kind: 'importer',
      depth: 1,
      changedFile: proj.path('src/login.ts'),
      sourceFile: proj.path('src/header.ts'),
    });
  });

  it('reporta arquivo sem teste em unmatched', async () => {
    const { engine: e, events, project: proj } = await startEngine(
      { dryRun: true },
      { ...FILES, 'src/orfao.ts': 'export const orfao = 1;\n' },
    );
    await e.runFiles([proj.path('src/orfao.ts')]);
    const batch = await waitForEvent(events, 'batch.started');
    expect(batch.unmatched).toHaveLength(1);
    expect(batch.unmatched[0]?.reason).toContain('nenhum arquivo de teste');
  });
});

describe('createEngine — execucao real', () => {
  it('executa os testes e reporta sucesso', async () => {
    const { engine: e, events, project: proj } = await startEngine({
      dependencyDepth: { default: 'self' },
    });
    const result = await e.runFiles([proj.path('src/login.ts')]);

    expect(result.status).toBe('passed');
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]?.exitCode).toBe(0);
    await waitForEvent(events, 'batch.finished');
  });

  it('reporta falha quando o runner sai com codigo diferente de zero', async () => {
    const { engine: e, project: proj } = await startEngine({
      dependencyDepth: { default: 'self' },
      runners: commandRunner('process.exit(1)'),
    });
    const result = await e.runFiles([proj.path('src/login.ts')]);
    expect(result.status).toBe('failed');
    expect(result.counts.failed).toBe(1);
  });

  it('reporta errored quando o adapter e desconhecido', async () => {
    const { engine: e, project: proj } = await startEngine({
      dependencyDepth: { default: 'self' },
      runners: {
        js: {
          adapter: 'inexistente',
          match: ['**/*.ts'],
          testMatch: ['**/*.test.ts'],
          testPatterns: ['{dir}/{name}.test.{ext}'],
          testExtensions: ['ts'],
        },
      },
    });
    const result = await e.runFiles([proj.path('src/login.ts')]);
    expect(result.status).toBe('errored');
    expect(result.runs[0]?.error).toContain('adapter de runner desconhecido');
  });

  it('nao executa nada em dryRun', async () => {
    const { engine: e, project: proj } = await startEngine({
      dependencyDepth: { default: 'self' },
      dryRun: true,
      runners: commandRunner('process.exit(1)'),
    });
    const result = await e.runFiles([proj.path('src/login.ts')]);
    expect(result.status).toBe('skipped');
    expect(result.runs[0]?.command).toContain('-e');
  });

  it('devolve lote vazio para arquivo sem teste', async () => {
    const { engine: e, project: proj } = await startEngine(
      {},
      { ...FILES, 'src/orfao.ts': 'export const orfao = 1;\n' },
    );
    const result = await e.runFiles([proj.path('src/orfao.ts')]);
    expect(result.runs).toHaveLength(0);
    expect(result.status).toBe('skipped');
    expect(result.unmatched).toHaveLength(1);
  });

  it('serializa lotes consecutivos', async () => {
    const { engine: e, events, project: proj } = await startEngine({
      dependencyDepth: { default: 'self' },
    });
    await Promise.all([
      e.runFiles([proj.path('src/login.ts')]),
      e.runFiles([proj.path('src/header.ts')]),
    ]);
    const finished = events.filter((event) => event.type === 'batch.finished');
    expect(finished).toHaveLength(2);
    // Ids sequenciais provam que o segundo lote esperou o primeiro.
    expect(finished.map((event) => (event as { result: { batchId: string } }).result.batchId))
      .toEqual(['batch-1', 'batch-2']);
  });
});

describe('createEngine — reacao ao salvamento (fluxo completo)', () => {
  it('dispara os testes ao salvar um arquivo', async () => {
    const { events, project: proj } = await startEngine({
      dependencyDepth: { default: 'direct' },
    });

    // Simula o save: altera o conteudo de login.ts.
    fs.writeFileSync(
      toNative(proj.path('src/login.ts')),
      'export const login = () => false;\n',
      'utf8',
    );

    const finished = await waitForEvent(events, 'batch.finished', 15_000);
    expect(finished.result.changedFiles).toContain(proj.path('src/login.ts'));
    expect(finished.result.status).toBe('passed');

    const started = await waitForEvent(events, 'batch.started');
    const testFiles = (started.plan[0]?.testFiles ?? []).map((f) => relativeToRoot(proj.root, f));
    expect(testFiles).toContain('src/header.test.ts');
    expect(testFiles).toContain('src/footer.test.ts');
  }, 30_000);

  it('agrupa varios saves em um unico lote', async () => {
    const { events, project: proj } = await startEngine({
      dependencyDepth: { default: 'self' },
      debounce: { mode: 'both', idleMs: 250, maxBatchWindowMs: 2000 },
    });

    fs.writeFileSync(toNative(proj.path('src/login.ts')), 'export const login = 1;\n', 'utf8');
    fs.writeFileSync(toNative(proj.path('src/header.ts')), 'export const header = 2;\n', 'utf8');

    const finished = await waitForEvent(events, 'batch.finished', 15_000);
    expect(finished.result.changedFiles.length).toBeGreaterThanOrEqual(2);
    expect(events.filter((e) => e.type === 'batch.finished')).toHaveLength(1);
  }, 30_000);

  it('reindexa o grafo quando os imports mudam', async () => {
    const { engine: e, events, project: proj } = await startEngine({
      dependencyDepth: { default: 'self' },
    });

    // header.ts deixa de importar login.ts.
    fs.writeFileSync(toNative(proj.path('src/header.ts')), 'export const header = 1;\n', 'utf8');
    await waitForEvent(events, 'batch.finished', 15_000);

    expect(e.graph.dependentsOf(proj.path('src/login.ts'))).not.toContain(
      proj.path('src/header.ts'),
    );
  }, 30_000);
});

describe('createEngine — canais de saida', () => {
  it('escreve o log NDJSON e o status.json', async () => {
    const { engine: e, project: proj } = await startEngine({
      dependencyDepth: { default: 'self' },
    });
    await e.runFiles([proj.path('src/login.ts')]);

    const log = fs.readFileSync(toNative(proj.path('.livetest/run.log')), 'utf8');
    const types = log
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as LiveTestEvent).type);
    expect(types).toContain('daemon.started');
    expect(types).toContain('batch.finished');

    const status = JSON.parse(
      fs.readFileSync(toNative(proj.path('.livetest/status.json')), 'utf8'),
    ) as { lastBatch: { status: string } | null; totals: { batches: number } };
    expect(status.lastBatch?.status).toBe('passed');
    expect(status.totals.batches).toBe(1);
  });

  it('publica e remove o arquivo de descoberta quando o servidor esta ligado', async () => {
    const { engine: e, started, project: proj } = await startEngine({
      server: { enabled: true, host: '127.0.0.1', port: 0 },
    });
    expect(started.server?.port).toBeGreaterThan(0);
    expect(fs.existsSync(toNative(proj.path('.livetest/daemon.json')))).toBe(true);

    await e.stop('teste');
    engine = null;
    expect(fs.existsSync(toNative(proj.path('.livetest/daemon.json')))).toBe(false);
  });

  it('snapshot reflete o resultado do ultimo lote', async () => {
    const { engine: e, project: proj } = await startEngine({
      dependencyDepth: { default: 'self' },
    });
    await e.runFiles([proj.path('src/login.ts')]);

    const snapshot = e.snapshot();
    expect(snapshot.lastBatch?.status).toBe('passed');
    expect(snapshot.files.find((f) => f.relativePath === 'src/login.test.ts')?.status).toBe(
      'passed',
    );
  });

  it('stop e idempotente', async () => {
    const { engine: e } = await startEngine();
    await e.stop('primeira');
    await expect(e.stop('segunda')).resolves.toBeUndefined();
    engine = null;
  });
});
