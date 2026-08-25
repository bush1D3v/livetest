import { describe, expect, it, vi } from 'vitest';

import { selectPalette } from '../../src/report/colors.js';
import {
  SUMMARY_PREFIX,
  cleanFailureMessage,
  createPrettyReporter,
  formatDuration,
  formatSummaryLine,
} from '../../src/report/pretty.js';
import type { LiveTestEvent } from '../../src/types/events.js';
import type { BatchResult, TestRunResult } from '../../src/types/results.js';
import { normalizePath } from '../../src/util/paths.js';

const root = normalizePath('/proj');
const p = (relative: string): string => normalizePath(relative, root);

function capture() {
  const lines: string[] = [];
  const reporter = createPrettyReporter({ root, color: false, write: (line) => lines.push(line) });
  return { lines, reporter, text: () => lines.join('\n') };
}

const stamp = <T extends { type: string }>(event: T): LiveTestEvent =>
  ({ ...event, seq: 1, timestamp: 0 }) as unknown as LiveTestEvent;

function run(partial: Partial<TestRunResult> = {}): TestRunResult {
  return {
    runId: 'run-1',
    batchId: 'batch-1',
    runnerKey: 'js',
    adapterId: 'vitest',
    testFiles: [p('src/a.test.ts')],
    command: 'npx vitest run src/a.test.ts',
    status: 'passed',
    counts: { total: 3, passed: 3, failed: 0, skipped: 0 },
    cases: [],
    durationMs: 1200,
    exitCode: 0,
    stdoutTail: [],
    stderrTail: [],
    error: null,
    reasons: {},
    ...partial,
  };
}

function batch(partial: Partial<BatchResult> = {}): BatchResult {
  return {
    batchId: 'batch-1',
    changedFiles: [p('src/login.ts')],
    runs: [run()],
    status: 'passed',
    counts: { total: 3, passed: 3, failed: 0, skipped: 0 },
    durationMs: 1350,
    startedAt: 0,
    finishedAt: 1350,
    unmatched: [],
    ...partial,
  };
}

describe('formatDuration', () => {
  it('usa ms abaixo de um segundo', () => {
    expect(formatDuration(450)).toBe('450ms');
  });

  it('usa segundos com uma casa acima de um segundo', () => {
    expect(formatDuration(1350)).toBe('1.4s');
  });
});

describe('formatSummaryLine', () => {
  it('produz uma linha de chave=valor legivel por maquina', () => {
    const line = formatSummaryLine(
      batch({ status: 'failed', counts: { total: 12, passed: 10, failed: 2, skipped: 0 } }),
    );
    expect(line).toBe(
      `${SUMMARY_PREFIX} batch=batch-1 status=failed files=1 tests=12 passed=10 failed=2 skipped=0 duration=1.4s`,
    );
  });
});

describe('selectPalette', () => {
  it('forca cor quando color e true', () => {
    expect(selectPalette(true).red('x')).toContain('\u001B[31m');
  });

  it('desliga cor quando color e false', () => {
    expect(selectPalette(false).red('x')).toBe('x');
  });

  it('respeita NO_COLOR em auto', () => {
    expect(selectPalette('auto', { NO_COLOR: '1' }, true).red('x')).toBe('x');
  });

  it('respeita FORCE_COLOR em auto sem TTY', () => {
    expect(selectPalette('auto', { FORCE_COLOR: '1' }, false).red('x')).toContain('\u001B[31m');
  });

  it('usa cor apenas em TTY quando nada e forcado', () => {
    expect(selectPalette('auto', {}, false).red('x')).toBe('x');
    expect(selectPalette('auto', {}, true).red('x')).toContain('\u001B[31m');
  });
});

describe('createPrettyReporter', () => {
  it('anuncia o inicio do daemon', () => {
    const { reporter, text } = capture();
    reporter.handle(
      stamp({
        type: 'daemon.started',
        pid: 99,
        root,
        version: '0.1.0',
        protocolVersion: 1,
        server: { host: '127.0.0.1', port: 5123 },
        configPath: null,
        indexedFiles: 12,
      }),
    );
    expect(text()).toContain('12 arquivos indexados');
    expect(text()).toContain('127.0.0.1:5123');
  });

  it('mostra o plano com o motivo ao lado de cada teste', () => {
    const { reporter, text } = capture();
    reporter.handle(
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
            reasons: {
              [p('src/header.test.ts')]: [
                {
                  kind: 'importer',
                  changedFile: p('src/login.ts'),
                  sourceFile: p('src/header.ts'),
                  depth: 1,
                  chain: [p('src/login.ts'), p('src/header.ts')],
                },
              ],
            },
          },
        ],
        unmatched: [],
      }),
    );
    expect(text()).toContain('src/header.test.ts');
    expect(text()).toContain('rodou porque src/header.ts importa src/login.ts (1 nivel)');
  });

  it('lista arquivos sem teste', () => {
    const { reporter, text } = capture();
    reporter.handle(
      stamp({
        type: 'batch.started',
        batchId: 'batch-1',
        changedFiles: [p('src/orfao.ts')],
        trigger: 'manual',
        plan: [],
        unmatched: [{ file: p('src/orfao.ts'), reason: 'src/orfao.ts: nenhum teste' }],
      }),
    );
    expect(text()).toContain('sem teste');
    expect(text()).toContain('src/orfao.ts: nenhum teste');
  });

  it('resume uma execucao bem-sucedida', () => {
    const { reporter, text } = capture();
    reporter.handle(stamp({ type: 'run.finished', result: run() }));
    expect(text()).toContain('PASSOU');
    expect(text()).toContain('3 passou');
    expect(text()).toContain('1.2s');
  });

  it('detalha cada caso que falhou', () => {
    const { reporter, text } = capture();
    reporter.handle(
      stamp({
        type: 'run.finished',
        result: run({
          status: 'failed',
          counts: { total: 2, passed: 1, failed: 1, skipped: 0 },
          cases: [
            {
              fullName: 'header > renderiza',
              file: p('src/header.test.ts'),
              status: 'failed',
              durationMs: 4,
              failureMessages: ['esperado "a", recebido "b"'],
            },
          ],
        }),
      }),
    );
    expect(text()).toContain('FALHOU');
    expect(text()).toContain('src/header.test.ts > header > renderiza');
    expect(text()).toContain('esperado "a", recebido "b"');
  });

  it('mostra o comando quando a execucao erra', () => {
    const { reporter, text } = capture();
    reporter.handle(
      stamp({
        type: 'run.finished',
        result: run({
          status: 'errored',
          error: 'vitest nao encontrado',
          stderrTail: ['command not found'],
        }),
      }),
    );
    expect(text()).toContain('vitest nao encontrado');
    expect(text()).toContain('command not found');
    expect(text()).toContain('comando: npx vitest run src/a.test.ts');
  });

  it('encerra o lote com a linha resumo', () => {
    const { reporter, text } = capture();
    reporter.handle(stamp({ type: 'batch.finished', result: batch() }));
    expect(text()).toContain('batch-1 PASSOU');
    expect(text()).toContain(`${SUMMARY_PREFIX} batch=batch-1 status=passed`);
  });

  it('mostra avisos de degradacao', () => {
    const { reporter, text } = capture();
    reporter.handle(
      stamp({
        type: 'error',
        scope: 'graph:python',
        message: 'interpretador indisponivel',
        detail: null,
        degradedTo: 'analise por regex',
      }),
    );
    expect(text()).toContain('aviso');
    expect(text()).toContain('[graph:python]');
    expect(text()).toContain('analise por regex');
  });

  it('nao polui o terminal com eventos de baixo nivel', () => {
    const { reporter, lines } = capture();
    reporter.handle(stamp({ type: 'watch.change', path: p('src/a.ts'), kind: 'change' }));
    expect(lines).toHaveLength(0);
  });

  it('anuncia o encerramento', () => {
    const { reporter, text } = capture();
    reporter.handle(stamp({ type: 'daemon.stopped', reason: 'SIGINT' }));
    expect(text()).toContain('encerrado: SIGINT');
  });
});

describe('cleanFailureMessage', () => {
  it('remove quadros de pilha de node_modules', () => {
    const message = [
      'AssertionError: esperado true',
      '    at /proj/src/a.test.ts:5:10',
      '    at /proj/node_modules/@vitest/runner/dist/index.js:146:14',
      '    at processTicksAndRejections (node:internal/process/task_queues:105:5)',
    ].join('\n');
    expect(cleanFailureMessage(message, 10)).toEqual([
      'AssertionError: esperado true',
      '    at /proj/src/a.test.ts:5:10',
      '... (+2 linha(s) omitida(s))',
    ]);
  });

  it('remove quadros com separador do Windows', () => {
    const message = [
      'erro',
      String.raw`    at C:\proj\node_modules\vitest\dist\x.js:1:1`,
    ].join('\n');
    expect(cleanFailureMessage(message, 10)[0]).toBe('erro');
    expect(cleanFailureMessage(message, 10)).toHaveLength(2);
  });

  it('corta em maxLines', () => {
    const message = ['a', 'b', 'c', 'd'].join('\n');
    expect(cleanFailureMessage(message, 2)).toEqual(['a', 'b', '... (+2 linha(s) omitida(s))']);
  });

  it('mantem ao menos uma linha', () => {
    expect(cleanFailureMessage('so uma', 0)).toEqual(['so uma']);
  });

  it('nao anuncia omissao quando nada foi cortado', () => {
    expect(cleanFailureMessage('a\nb', 10)).toEqual(['a', 'b']);
  });
});

describe('createPrettyReporter — variacoes de saida', () => {
  it('mostra o crachá de execucao cancelada', () => {
    const { reporter, text } = capture();
    reporter.handle(stamp({ type: 'run.finished', result: run({ status: 'cancelled' }) }));
    expect(text()).toContain('CANCEL');
  });

  it('mostra o crachá de execucao pulada', () => {
    const { reporter, text } = capture();
    reporter.handle(stamp({ type: 'run.finished', result: run({ status: 'skipped' }) }));
    expect(text()).toContain('PULOU');
  });

  it('omite o endereco quando o canal de eventos esta desligado', () => {
    const { reporter, text } = capture();
    reporter.handle(
      stamp({
        type: 'daemon.started',
        pid: 1,
        root,
        version: '0.1.0',
        protocolVersion: 1,
        server: null,
        configPath: null,
        indexedFiles: 3,
      }),
    );
    expect(text()).toContain('3 arquivos indexados');
    expect(text()).not.toContain('eventos em');
  });

  it('omite a degradacao quando o aviso nao tem alternativa', () => {
    const { reporter, text } = capture();
    reporter.handle(
      stamp({ type: 'error', scope: 'watcher', message: 'EMFILE', detail: null, degradedTo: null }),
    );
    expect(text()).toContain('[watcher] EMFILE');
    expect(text()).not.toContain('(');
  });

  it('omite o arquivo quando o caso falho nao tem um', () => {
    const { reporter, text } = capture();
    reporter.handle(
      stamp({
        type: 'run.finished',
        result: run({
          status: 'failed',
          cases: [
            {
              fullName: 'falha sem arquivo',
              file: null,
              status: 'failed',
              durationMs: 1,
              failureMessages: [],
            },
          ],
        }),
      }),
    );
    expect(text()).toContain('x falha sem arquivo');
  });

  it('mostra motivo vazio quando o plano nao registra nenhum', () => {
    const { reporter, text } = capture();
    reporter.handle(
      stamp({
        type: 'batch.started',
        batchId: 'batch-1',
        changedFiles: [p('src/login.ts')],
        trigger: 'maxWindow',
        plan: [
          { runnerKey: 'js', adapterId: 'vitest', testFiles: [p('src/a.test.ts')], reasons: {} },
        ],
        unmatched: [],
      }),
    );
    expect(text()).toContain('src/a.test.ts');
  });

  it('alinha os nomes pela coluna do mais longo', () => {
    const { reporter, lines } = capture();
    reporter.handle(
      stamp({
        type: 'batch.started',
        batchId: 'batch-1',
        changedFiles: [],
        trigger: 'idle',
        plan: [
          {
            runnerKey: 'js',
            adapterId: 'vitest',
            testFiles: [p('src/a.test.ts'), p('src/muito-mais-longo.test.ts')],
            reasons: {},
          },
        ],
        unmatched: [],
      }),
    );
    const curta = lines.find((l) => l.includes('src/a.test.ts'));
    const longa = lines.find((l) => l.includes('muito-mais-longo'));
    // O nome curto recebe preenchimento ate a largura do mais longo.
    expect(curta?.length).toBe(longa?.length);
  });

  it('escreve no stdout quando nenhum destino e informado', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const reporter = createPrettyReporter({ root, color: false });
      reporter.handle(stamp({ type: 'daemon.stopped', reason: 'teste' }));
      expect(spy).toHaveBeenCalledOnce();
      expect(String(spy.mock.calls[0]?.[0])).toContain('encerrado: teste');
    } finally {
      spy.mockRestore();
    }
  });

  it('detecta a cor automaticamente quando nao configurada', () => {
    const lines: string[] = [];
    const reporter = createPrettyReporter({ root, write: (line) => lines.push(line) });
    reporter.handle(stamp({ type: 'daemon.stopped', reason: 'x' }));
    expect(lines).toHaveLength(1);
  });

  it('respeita errorTailLines customizado', () => {
    const { lines } = capture();
    const reporter = createPrettyReporter({
      root,
      color: false,
      errorTailLines: 1,
      write: (line) => lines.push(line),
    });
    reporter.handle(
      stamp({
        type: 'run.finished',
        result: run({
          status: 'failed',
          cases: [
            {
              fullName: 'x',
              file: p('src/a.test.ts'),
              status: 'failed',
              durationMs: 1,
              failureMessages: ['linha 1\nlinha 2\nlinha 3'],
            },
          ],
        }),
      }),
    );
    expect(lines.join('\n')).toContain('linha 1');
    expect(lines.join('\n')).not.toContain('linha 2');
  });
});

describe('createPrettyReporter — mistura de casos', () => {
  it('lista apenas os casos que falharam', () => {
    const { reporter, text } = capture();
    reporter.handle(
      stamp({
        type: 'run.finished',
        result: run({
          status: 'failed',
          counts: { total: 2, passed: 1, failed: 1, skipped: 0 },
          cases: [
            {
              fullName: 'este passou',
              file: p('src/a.test.ts'),
              status: 'passed',
              durationMs: 1,
              failureMessages: [],
            },
            {
              fullName: 'este falhou',
              file: p('src/a.test.ts'),
              status: 'failed',
              durationMs: 1,
              failureMessages: ['boom'],
            },
          ],
        }),
      }),
    );
    expect(text()).toContain('este falhou');
    expect(text()).not.toContain('este passou');
  });
});
