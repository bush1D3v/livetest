import { describe, expect, it } from 'vitest';

import type {
  BatchResult,
  DaemonSnapshot,
  FileStatus,
  LiveTestEvent,
  TestRunResult,
} from '@livetest/core/client';

import { createTreeModel, worstStatus, type TreeNode } from '../src/model/tree.js';

const ROOT = '/proj';
const p = (relative: string): string => `${ROOT}/${relative}`;

function fileStatus(relative: string, status: FileStatus['status'] = 'idle'): FileStatus {
  return {
    path: p(relative),
    relativePath: relative,
    status,
    updatedAt: 0,
    reason: null,
    lastRunId: null,
    counts: null,
  };
}

function snapshot(files: FileStatus[], lastBatch: BatchResult | null = null): DaemonSnapshot {
  return {
    pid: 1,
    root: ROOT,
    version: '0.1.0',
    protocolVersion: 1,
    startedAt: 0,
    running: false,
    lastBatch,
    files,
    totals: { batches: 0, runs: 0, failedRuns: 0 },
  };
}

function run(partial: Partial<TestRunResult> = {}): TestRunResult {
  return {
    runId: 'run-1',
    batchId: 'batch-1',
    runnerKey: 'js',
    adapterId: 'vitest',
    testFiles: [p('src/login.test.ts')],
    command: 'npx vitest run',
    status: 'passed',
    counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
    cases: [],
    durationMs: 10,
    exitCode: 0,
    stdoutTail: [],
    stderrTail: [],
    error: null,
    reasons: {},
    ...partial,
  };
}

const stamp = <T extends { type: string }>(event: T): LiveTestEvent =>
  ({ ...event, seq: 1, timestamp: 0 }) as unknown as LiveTestEvent;

/** Acha um no pelo rotulo, em profundidade. */
function find(nodes: TreeNode[], label: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.label === label) return node;
    const inner = find(node.children, label);
    if (inner) return inner;
  }
  return undefined;
}

describe('worstStatus', () => {
  it('escolhe o status mais severo', () => {
    expect(worstStatus(['passed', 'failed', 'idle'])).toBe('failed');
    expect(worstStatus(['failed', 'errored'])).toBe('errored');
    expect(worstStatus(['passed', 'running'])).toBe('running');
    expect(worstStatus(['passed', 'skipped'])).toBe('skipped');
    expect(worstStatus(['passed', 'passed'])).toBe('passed');
  });

  it('devolve idle para lista vazia', () => {
    expect(worstStatus([])).toBe('idle');
  });
});

describe('createTreeModel — estrutura', () => {
  it('agrupa arquivos por diretorio', () => {
    const model = createTreeModel({ root: ROOT });
    model.applySnapshot(snapshot([fileStatus('src/a.ts'), fileStatus('src/util/b.ts')]));

    const roots = model.roots();
    expect(roots).toHaveLength(1);
    expect(roots[0]?.label).toBe('src');
    expect(roots[0]?.children.map((c) => c.label).sort()).toEqual(['a.ts', 'util']);
  });

  it('ordena por caminho relativo', () => {
    const model = createTreeModel({ root: ROOT });
    model.applySnapshot(snapshot([fileStatus('src/z.ts'), fileStatus('src/a.ts')]));
    expect(model.roots()[0]?.children.map((c) => c.label)).toEqual(['a.ts', 'z.ts']);
  });

  it('mantem arquivos da raiz sem diretorio', () => {
    const model = createTreeModel({ root: ROOT });
    model.applySnapshot(snapshot([fileStatus('index.ts')]));
    expect(model.roots()[0]?.label).toBe('index.ts');
  });

  it('gera ids estaveis', () => {
    const model = createTreeModel({ root: ROOT });
    model.applySnapshot(snapshot([fileStatus('src/a.ts')]));
    expect(model.roots()[0]?.id).toBe('dir:src');
    expect(model.roots()[0]?.children[0]?.id).toBe(`file:${p('src/a.ts')}`);
  });

  it('pode esconder arquivos idle', () => {
    const model = createTreeModel({ root: ROOT, includeIdle: false });
    model.applySnapshot(snapshot([fileStatus('src/a.ts'), fileStatus('src/b.ts', 'passed')]));
    expect(model.roots()[0]?.children.map((c) => c.label)).toEqual(['b.ts']);
  });

  it('substitui o estado a cada snapshot', () => {
    const model = createTreeModel({ root: ROOT });
    model.applySnapshot(snapshot([fileStatus('src/a.ts')]));
    model.applySnapshot(snapshot([fileStatus('src/b.ts')]));
    expect(model.size()).toBe(1);
  });

  it('clear esvazia a arvore', () => {
    const model = createTreeModel({ root: ROOT });
    model.applySnapshot(snapshot([fileStatus('src/a.ts')]));
    model.clear();
    expect(model.roots()).toEqual([]);
  });
});

describe('createTreeModel — status', () => {
  it('propaga o pior status para o diretorio', () => {
    const model = createTreeModel({ root: ROOT });
    model.applySnapshot(
      snapshot([fileStatus('src/a.ts', 'passed'), fileStatus('src/b.ts', 'failed')]),
    );
    const dir = model.roots()[0];
    expect(dir?.status).toBe('failed');
    expect(dir?.description).toBe('1 com falha');
  });

  it('diretorio sem falhas nao exibe contador', () => {
    const model = createTreeModel({ root: ROOT });
    model.applySnapshot(snapshot([fileStatus('src/a.ts', 'passed')]));
    expect(model.roots()[0]?.description).toBe('');
  });

  it('marca como running quando o lote comeca', () => {
    const model = createTreeModel({ root: ROOT });
    model.applySnapshot(snapshot([fileStatus('src/login.test.ts')]));
    model.apply(
      stamp({
        type: 'batch.started',
        batchId: 'batch-1',
        changedFiles: [p('src/login.ts')],
        trigger: 'idle',
        plan: [
          { runnerKey: 'js', adapterId: 'vitest', testFiles: [p('src/login.test.ts')], reasons: {} },
        ],
        unmatched: [],
      }),
    );
    expect(find(model.roots(), 'login.test.ts')?.status).toBe('running');
  });

  it('marca como passed ao fim de uma execucao bem-sucedida', () => {
    const model = createTreeModel({ root: ROOT });
    model.apply(stamp({ type: 'run.finished', result: run() }));
    expect(find(model.roots(), 'login.test.ts')?.status).toBe('passed');
  });

  it('marca como failed apenas o arquivo com caso falho', () => {
    const model = createTreeModel({ root: ROOT });
    model.apply(
      stamp({
        type: 'run.finished',
        result: run({
          status: 'failed',
          testFiles: [p('src/a.test.ts'), p('src/b.test.ts')],
          cases: [
            {
              fullName: 'a falha',
              file: p('src/a.test.ts'),
              status: 'failed',
              durationMs: 1,
              failureMessages: ['esperado 1'],
            },
          ],
        }),
      }),
    );
    expect(find(model.roots(), 'a.test.ts')?.status).toBe('failed');
    expect(find(model.roots(), 'b.test.ts')?.status).toBe('passed');
  });

  it('marca como errored quando o runner nao roda', () => {
    const model = createTreeModel({ root: ROOT });
    model.apply(stamp({ type: 'run.finished', result: run({ status: 'errored', error: 'sem binario' }) }));
    expect(find(model.roots(), 'login.test.ts')?.status).toBe('errored');
  });

  it('remove o arquivo apagado', () => {
    const model = createTreeModel({ root: ROOT });
    model.applySnapshot(snapshot([fileStatus('src/a.ts')]));
    model.apply(stamp({ type: 'watch.change', path: p('src/a.ts'), kind: 'unlink' }));
    expect(model.size()).toBe(0);
  });
});

describe('createTreeModel — transparencia', () => {
  const reason = {
    kind: 'importer' as const,
    changedFile: p('src/login.ts'),
    sourceFile: p('src/header.ts'),
    depth: 1,
    chain: [p('src/login.ts'), p('src/header.ts')],
  };

  it('mostra o motivo no tooltip', () => {
    const model = createTreeModel({ root: ROOT });
    model.apply(
      stamp({
        type: 'batch.started',
        batchId: 'batch-1',
        changedFiles: [p('src/login.ts')],
        trigger: 'idle',
        plan: [
          {
            runnerKey: 'js',
            adapterId: 'vitest',
            testFiles: [p('src/header.test.ts')],
            reasons: { [p('src/header.test.ts')]: [reason] },
          },
        ],
        unmatched: [],
      }),
    );

    const node = find(model.roots(), 'header.test.ts');
    expect(node?.tooltip).toContain('por que rodou:');
    expect(node?.tooltip).toContain('rodou porque src/header.ts importa src/login.ts (1 nivel)');
  });

  it('marca "via dependencia" na descricao', () => {
    const model = createTreeModel({ root: ROOT });
    model.apply(
      stamp({
        type: 'batch.started',
        batchId: 'batch-1',
        changedFiles: [p('src/login.ts')],
        trigger: 'idle',
        plan: [
          {
            runnerKey: 'js',
            adapterId: 'vitest',
            testFiles: [p('src/header.test.ts')],
            reasons: { [p('src/header.test.ts')]: [reason] },
          },
        ],
        unmatched: [],
      }),
    );
    expect(find(model.roots(), 'header.test.ts')?.description).toBe('via dependencia');
  });

  it('expoe cada falha como filho do arquivo', () => {
    const model = createTreeModel({ root: ROOT });
    model.apply(
      stamp({
        type: 'run.finished',
        result: run({
          status: 'failed',
          cases: [
            {
              fullName: 'login funciona',
              file: p('src/login.test.ts'),
              status: 'failed',
              durationMs: 2,
              failureMessages: ['esperado true, recebido false'],
            },
          ],
        }),
      }),
    );

    const node = find(model.roots(), 'login.test.ts');
    expect(node?.children).toHaveLength(1);
    expect(node?.children[0]?.label).toBe('login funciona');
    expect(node?.children[0]?.tooltip).toContain('esperado true');
    expect(node?.children[0]?.status).toBe('failed');
  });

  it('limpa as falhas anteriores quando um novo lote comeca', () => {
    const model = createTreeModel({ root: ROOT });
    model.apply(
      stamp({
        type: 'run.finished',
        result: run({
          status: 'failed',
          cases: [
            {
              fullName: 'x',
              file: p('src/login.test.ts'),
              status: 'failed',
              durationMs: 1,
              failureMessages: ['boom'],
            },
          ],
        }),
      }),
    );
    model.apply(
      stamp({
        type: 'batch.started',
        batchId: 'batch-2',
        changedFiles: [],
        trigger: 'idle',
        plan: [
          { runnerKey: 'js', adapterId: 'vitest', testFiles: [p('src/login.test.ts')], reasons: {} },
        ],
        unmatched: [],
      }),
    );
    expect(find(model.roots(), 'login.test.ts')?.children).toHaveLength(0);
  });

  it('recupera motivos e falhas do ultimo lote ao reconectar', () => {
    const model = createTreeModel({ root: ROOT });
    const lastBatch: BatchResult = {
      batchId: 'batch-1',
      changedFiles: [p('src/login.ts')],
      runs: [
        run({
          status: 'failed',
          testFiles: [p('src/header.test.ts')],
          reasons: { [p('src/header.test.ts')]: [reason] },
          cases: [
            {
              fullName: 'header quebrou',
              file: p('src/header.test.ts'),
              status: 'failed',
              durationMs: 1,
              failureMessages: ['boom'],
            },
          ],
        }),
      ],
      status: 'failed',
      counts: { total: 1, passed: 0, failed: 1, skipped: 0 },
      durationMs: 10,
      startedAt: 0,
      finishedAt: 10,
      unmatched: [],
    };

    model.applySnapshot(snapshot([fileStatus('src/header.test.ts', 'failed')], lastBatch));

    const node = find(model.roots(), 'header.test.ts');
    expect(node?.tooltip).toContain('rodou porque src/header.ts importa src/login.ts');
    expect(node?.children[0]?.label).toBe('header quebrou');
  });

  it('mostra contagens na descricao quando disponiveis', () => {
    const model = createTreeModel({ root: ROOT });
    const status = fileStatus('src/a.test.ts', 'passed');
    status.counts = { passed: 3, failed: 0, skipped: 1 };
    model.applySnapshot(snapshot([status]));
    expect(find(model.roots(), 'a.test.ts')?.description).toBe('3/4');
  });

  it('inclui o erro do runner no tooltip', () => {
    const model = createTreeModel({ root: ROOT });
    model.apply(
      stamp({ type: 'run.finished', result: run({ status: 'errored', error: 'vitest ausente' }) }),
    );
    expect(find(model.roots(), 'login.test.ts')?.tooltip).toContain('erro: vitest ausente');
  });
});

describe('createTreeModel — bordas', () => {
  it('aceita o snapshot vindo como evento', () => {
    const model = createTreeModel({ root: ROOT });
    model.apply(
      stamp({ type: 'snapshot', state: snapshot([fileStatus('src/a.ts', 'passed')]) }),
    );
    expect(model.size()).toBe(1);
    expect(find(model.roots(), 'a.ts')?.status).toBe('passed');
  });

  it('marca como skipped uma execucao pulada ou cancelada', () => {
    const model = createTreeModel({ root: ROOT });
    model.apply(stamp({ type: 'run.finished', result: run({ status: 'skipped' }) }));
    expect(find(model.roots(), 'login.test.ts')?.status).toBe('skipped');

    model.apply(stamp({ type: 'run.finished', result: run({ status: 'cancelled' }) }));
    expect(find(model.roots(), 'login.test.ts')?.status).toBe('skipped');
  });

  it('ignora eventos que nao afetam a arvore', () => {
    const model = createTreeModel({ root: ROOT });
    model.applySnapshot(snapshot([fileStatus('src/a.ts')]));
    model.apply(
      stamp({ type: 'error', scope: 'graph', message: 'x', detail: null, degradedTo: null }),
    );
    model.apply(stamp({ type: 'watch.change', path: p('src/a.ts'), kind: 'change' }));
    expect(model.size()).toBe(1);
  });

  it('trata caminho fora da raiz sem quebrar o rotulo', () => {
    const model = createTreeModel({ root: ROOT });
    model.apply(
      stamp({
        type: 'run.finished',
        result: run({ testFiles: ['/fora/do/projeto/a.test.ts'] }),
      }),
    );
    expect(find(model.roots(), 'a.test.ts')).toBeDefined();
  });

  it('entry devolve undefined para arquivo desconhecido', () => {
    const model = createTreeModel({ root: ROOT });
    expect(model.entry(p('src/inexistente.ts'))).toBeUndefined();
  });

  it('ignora casos falhos sem arquivo ao remontar do snapshot', () => {
    const model = createTreeModel({ root: ROOT });
    const lastBatch: BatchResult = {
      batchId: 'batch-1',
      changedFiles: [],
      status: 'failed',
      counts: { total: 1, passed: 0, failed: 1, skipped: 0 },
      durationMs: 1,
      startedAt: 0,
      finishedAt: 1,
      unmatched: [],
      runs: [
        run({
          status: 'failed',
          reasons: { '/desconhecido.test.ts': [] },
          cases: [
            { fullName: 'sem arquivo', file: null, status: 'failed', durationMs: 1, failureMessages: [] },
            {
              fullName: 'arquivo fora da arvore',
              file: '/nao/indexado.test.ts',
              status: 'failed',
              durationMs: 1,
              failureMessages: [],
            },
            {
              fullName: 'caso que passou',
              file: p('src/a.test.ts'),
              status: 'passed',
              durationMs: 1,
              failureMessages: [],
            },
          ],
        }),
      ],
    };

    model.applySnapshot(snapshot([fileStatus('src/a.test.ts', 'failed')], lastBatch));
    expect(find(model.roots(), 'a.test.ts')?.children).toHaveLength(0);
  });

  it('nao mostra descricao quando nao ha contagem nem motivo', () => {
    const model = createTreeModel({ root: ROOT });
    model.applySnapshot(snapshot([fileStatus('src/a.ts', 'passed')]));
    expect(find(model.roots(), 'a.ts')?.description).toBe('');
  });

  it('mostra descricao vazia para motivo do tipo changed', () => {
    const model = createTreeModel({ root: ROOT });
    model.apply(
      stamp({
        type: 'batch.started',
        batchId: 'batch-1',
        changedFiles: [p('src/a.test.ts')],
        trigger: 'idle',
        plan: [
          {
            runnerKey: 'js',
            adapterId: 'vitest',
            testFiles: [p('src/a.test.ts')],
            reasons: {
              [p('src/a.test.ts')]: [
                {
                  kind: 'changed',
                  changedFile: p('src/a.test.ts'),
                  sourceFile: p('src/a.test.ts'),
                  depth: 0,
                  chain: [p('src/a.test.ts')],
                },
              ],
            },
          },
        ],
        unmatched: [],
      }),
    );
    expect(find(model.roots(), 'a.test.ts')?.description).toBe('');
  });

  it('inclui as contagens no tooltip quando existem', () => {
    const model = createTreeModel({ root: ROOT });
    const status = fileStatus('src/a.test.ts', 'failed');
    status.counts = { passed: 1, failed: 2, skipped: 3 };
    model.applySnapshot(snapshot([status]));
    expect(find(model.roots(), 'a.test.ts')?.tooltip).toContain(
      'testes: 1 passou, 2 falhou, 3 pulou',
    );
  });

  it('usa o nome do caso como tooltip quando nao ha mensagem', () => {
    const model = createTreeModel({ root: ROOT });
    model.apply(
      stamp({
        type: 'run.finished',
        result: run({
          status: 'failed',
          cases: [
            {
              fullName: 'falhou sem mensagem',
              file: p('src/login.test.ts'),
              status: 'failed',
              durationMs: 1,
              failureMessages: [],
            },
          ],
        }),
      }),
    );
    const no = find(model.roots(), 'login.test.ts');
    expect(no?.children[0]?.tooltip).toBe('falhou sem mensagem');
  });
});
