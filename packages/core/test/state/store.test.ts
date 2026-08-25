import { describe, expect, it } from 'vitest';

import { createStateStore } from '../../src/state/store.js';
import type { LiveTestEvent } from '../../src/types/events.js';
import type { TestRunResult } from '../../src/types/results.js';
import { normalizePath } from '../../src/util/paths.js';

const root = normalizePath('/proj');
const p = (relative: string): string => normalizePath(relative, root);

let seq = 0;
const stamp = <T extends { type: string }>(event: T): LiveTestEvent =>
  ({ ...event, seq: ++seq, timestamp: 1000 }) as unknown as LiveTestEvent;

function store() {
  return createStateStore({ root, version: '0.1.0', pid: 42, now: () => 1000 });
}

function run(partial: Partial<TestRunResult> = {}): TestRunResult {
  return {
    runId: 'run-1',
    batchId: 'batch-1',
    runnerKey: 'js',
    adapterId: 'vitest',
    testFiles: [p('src/a.test.ts')],
    command: 'npx vitest run',
    status: 'passed',
    counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
    cases: [],
    durationMs: 100,
    exitCode: 0,
    stdoutTail: [],
    stderrTail: [],
    error: null,
    reasons: {},
    ...partial,
  };
}

describe('createStateStore', () => {
  it('registra arquivos observados como idle', () => {
    const s = store();
    s.registerFiles([p('src/a.ts')]);
    expect(s.fileStatus(p('src/a.ts'))).toMatchObject({
      status: 'idle',
      relativePath: 'src/a.ts',
    });
  });

  it('marca arquivos como running ao iniciar a execucao', () => {
    const s = store();
    s.apply(
      stamp({
        type: 'run.started',
        batchId: 'batch-1',
        runId: 'run-1',
        runnerKey: 'js',
        adapterId: 'vitest',
        testFiles: [p('src/a.test.ts')],
        command: '',
        reasons: {},
      }),
    );
    expect(s.fileStatus(p('src/a.test.ts'))?.status).toBe('running');
  });

  it('marca como passed quando a execucao passa', () => {
    const s = store();
    s.apply(stamp({ type: 'run.finished', result: run() }));
    expect(s.fileStatus(p('src/a.test.ts'))?.status).toBe('passed');
  });

  it('marca como failed apenas o arquivo com caso falho', () => {
    const s = store();
    s.apply(
      stamp({
        type: 'run.finished',
        result: run({
          status: 'failed',
          testFiles: [p('src/a.test.ts'), p('src/b.test.ts')],
          counts: { total: 2, passed: 1, failed: 1, skipped: 0 },
          cases: [
            {
              fullName: 'a',
              file: p('src/a.test.ts'),
              status: 'failed',
              durationMs: 1,
              failureMessages: ['x'],
            },
            {
              fullName: 'b',
              file: p('src/b.test.ts'),
              status: 'passed',
              durationMs: 1,
              failureMessages: [],
            },
          ],
        }),
      }),
    );
    expect(s.fileStatus(p('src/a.test.ts'))?.status).toBe('failed');
    expect(s.fileStatus(p('src/b.test.ts'))?.status).toBe('passed');
  });

  it('marca como errored quando o runner nao pode rodar', () => {
    const s = store();
    s.apply(stamp({ type: 'run.finished', result: run({ status: 'errored', error: 'sem binario' }) }));
    const status = s.fileStatus(p('src/a.test.ts'));
    expect(status?.status).toBe('errored');
    expect(status?.reason).toBe('sem binario');
  });
});

describe('StateStore — snapshot', () => {
  it('expoe metadados do daemon', () => {
    const snapshot = store().snapshot();
    expect(snapshot).toMatchObject({
      pid: 42,
      root,
      version: '0.1.0',
      protocolVersion: 1,
      running: false,
      lastBatch: null,
      totals: { batches: 0, runs: 0, failedRuns: 0 },
    });
  });

  it('ordena os arquivos pelo caminho relativo', () => {
    const s = store();
    s.registerFiles([p('src/z.ts'), p('src/a.ts')]);
    expect(s.snapshot().files.map((f) => f.relativePath)).toEqual(['src/a.ts', 'src/z.ts']);
  });

  it('marca running durante o lote e volta ao fim', () => {
    const s = store();
    s.apply(
      stamp({
        type: 'batch.started',
        batchId: 'batch-1',
        changedFiles: [p('src/a.ts')],
        trigger: 'idle',
        plan: [{ runnerKey: 'js', adapterId: 'vitest', testFiles: [p('src/a.test.ts')], reasons: {} }],
        unmatched: [],
      }),
    );
    expect(s.snapshot().running).toBe(true);

    s.apply(
      stamp({
        type: 'batch.finished',
        result: {
          batchId: 'batch-1',
          changedFiles: [p('src/a.ts')],
          runs: [],
          status: 'passed',
          counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
          durationMs: 10,
          startedAt: 0,
          finishedAt: 10,
          unmatched: [],
        },
      }),
    );
    const snapshot = s.snapshot();
    expect(snapshot.running).toBe(false);
    expect(snapshot.lastBatch?.batchId).toBe('batch-1');
    expect(snapshot.totals.batches).toBe(1);
  });

  it('conta execucoes e execucoes com falha', () => {
    const s = store();
    s.apply(stamp({ type: 'run.finished', result: run() }));
    s.apply(stamp({ type: 'run.finished', result: run({ status: 'failed' }) }));
    s.apply(stamp({ type: 'run.finished', result: run({ status: 'errored' }) }));
    expect(s.snapshot().totals).toMatchObject({ runs: 3, failedRuns: 2 });
  });

  it('adiciona arquivo novo e remove apagado', () => {
    const s = store();
    s.apply(stamp({ type: 'watch.change', path: p('src/novo.ts'), kind: 'add' }));
    expect(s.fileStatus(p('src/novo.ts'))).toBeDefined();

    s.apply(stamp({ type: 'watch.change', path: p('src/novo.ts'), kind: 'unlink' }));
    expect(s.fileStatus(p('src/novo.ts'))).toBeUndefined();
  });

  it('devolve copias, nao referencias internas', () => {
    const s = store();
    s.registerFiles([p('src/a.ts')]);
    const snapshot = s.snapshot();
    const first = snapshot.files[0];
    if (first) first.status = 'failed';
    expect(s.fileStatus(p('src/a.ts'))?.status).toBe('idle');
  });

  it('ignora eventos que nao afetam o estado', () => {
    const s = store();
    expect(() =>
      s.apply(stamp({ type: 'error', scope: 'x', message: 'y', detail: null, degradedTo: null })),
    ).not.toThrow();
  });
});

describe('StateStore — casos de borda', () => {
  it('usa o relogio real quando nenhum e injetado', () => {
    const antes = Date.now();
    const s = createStateStore({ root, version: '0.1.0' });
    s.registerFiles([p('src/a.ts')]);
    const status = s.fileStatus(p('src/a.ts'));
    expect(status?.updatedAt).toBeGreaterThanOrEqual(antes);
    expect(s.snapshot().pid).toBe(process.pid);
  });

  it('ignora casos de teste sem arquivo associado', () => {
    const s = store();
    s.apply(
      stamp({
        type: 'run.finished',
        result: run({
          status: 'failed',
          cases: [
            {
              fullName: 'sem arquivo',
              file: null,
              status: 'failed',
              durationMs: 1,
              failureMessages: ['boom'],
            },
          ],
        }),
      }),
    );
    // Sem arquivo nao ha como atribuir a falha; o arquivo do lote fica passed.
    expect(s.fileStatus(p('src/a.test.ts'))?.counts).toBeNull();
    expect(s.fileStatus(p('src/a.test.ts'))?.status).toBe('passed');
  });

  it('marca como skipped quando a execucao foi cancelada', () => {
    const s = store();
    s.apply(stamp({ type: 'run.finished', result: run({ status: 'cancelled' }) }));
    expect(s.fileStatus(p('src/a.test.ts'))?.status).toBe('skipped');
  });

  it('reaproveita o registro existente ao atualizar um arquivo', () => {
    const s = store();
    s.registerFiles([p('src/a.test.ts')]);
    s.apply(stamp({ type: 'run.finished', result: run() }));
    expect(s.snapshot().files).toHaveLength(1);
  });

  it('adiciona arquivo em evento de change, nao so de add', () => {
    const s = store();
    s.apply(stamp({ type: 'watch.change', path: p('src/novo.ts'), kind: 'change' }));
    expect(s.fileStatus(p('src/novo.ts'))).toBeDefined();
  });
});
