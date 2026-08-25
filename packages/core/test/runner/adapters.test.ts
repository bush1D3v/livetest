import { describe, expect, it } from 'vitest';

import { resolveConfig } from '../../src/config/load.js';
import { createCommandAdapter } from '../../src/runner/adapters/command.js';
import { createJestAdapter, createVitestAdapter } from '../../src/runner/adapters/jest-like.js';
import { createPytestAdapter } from '../../src/runner/adapters/pytest.js';
import { BUILTIN_RUNNER_ADAPTERS, createRunnerAdapter } from '../../src/runner/registry.js';
import type { RunnerAdapterContext, RunnerProcessOutput } from '../../src/types/runner.js';
import { normalizePath } from '../../src/util/paths.js';
import { createRecordingLogger } from '../helpers/logger.js';

const root = normalizePath('/proj');

function contextFor(runnerKey: string, user: Record<string, unknown> = {}): RunnerAdapterContext {
  const { config } = resolveConfig(
    { useGitignore: false, runners: { [runnerKey]: user } },
    { root },
  );
  const runner = config.runners[runnerKey];
  if (!runner) throw new Error(`runner ${runnerKey} nao configurado`);
  return {
    root,
    runnerKey,
    config: runner,
    logger: createRecordingLogger('debug').logger,
    pythonPath: 'python3',
  };
}

const output = (partial: Partial<RunnerProcessOutput> = {}): RunnerProcessOutput => ({
  exitCode: 0,
  timedOut: false,
  cancelled: false,
  stdout: '',
  stderr: '',
  durationMs: 10,
  reportContent: null,
  spawnError: null,
  ...partial,
});

describe('createVitestAdapter', () => {
  it('monta a linha de comando padrao', () => {
    const invocation = createVitestAdapter().buildInvocation(
      [`${root}/src/a.test.ts`],
      contextFor('js'),
      '/tmp/r.json',
    );
    expect(invocation.command).toBe('npx');
    expect(invocation.args).toEqual([
      'vitest',
      'run',
      '--reporter=json',
      '--outputFile=/tmp/r.json',
      '--passWithNoTests',
      'src/a.test.ts',
    ]);
    expect(invocation.cwd).toBe(root);
  });

  it('usa o comando e os argumentos configurados pelo usuario', () => {
    const invocation = createVitestAdapter().buildInvocation(
      [`${root}/src/a.test.ts`],
      contextFor('js', { command: 'pnpm', args: ['--silent'] }),
      null,
    );
    expect(invocation.command).toBe('pnpm');
    expect(invocation.args).toEqual([
      'run',
      '--reporter=json',
      '--passWithNoTests',
      '--silent',
      'src/a.test.ts',
    ]);
  });

  it('respeita cwd relativo a raiz', () => {
    const invocation = createVitestAdapter().buildInvocation(
      [`${root}/pacote/src/a.test.ts`],
      contextFor('js', { cwd: 'pacote' }),
      null,
    );
    expect(invocation.cwd).toBe(`${root}/pacote`);
    expect(invocation.args.at(-1)).toBe('src/a.test.ts');
  });
});

describe('parseOutput dos adapters JS', () => {
  it('interpreta o relatorio JSON', () => {
    const report = JSON.stringify({
      testResults: [{ name: '/a.test.ts', assertionResults: [{ fullName: 'x', status: 'failed' }] }],
    });
    const result = createVitestAdapter().parseOutput(
      output({ exitCode: 1, reportContent: report }),
      contextFor('js'),
    );
    expect(result.status).toBe('failed');
  });

  it('trata ausencia de relatorio com exit 0 como passed', () => {
    const result = createVitestAdapter().parseOutput(output(), contextFor('js'));
    expect(result.status).toBe('passed');
    expect(result.counts.total).toBe(0);
  });

  it('trata ausencia de relatorio com exit != 0 como errored', () => {
    const result = createVitestAdapter().parseOutput(
      output({ exitCode: 1, stderr: 'vitest: comando nao encontrado' }),
      contextFor('js'),
    );
    expect(result.status).toBe('errored');
    expect(result.error).toContain('nao produziu relatorio');
  });

  it('propaga timeout como errored', () => {
    const result = createVitestAdapter().parseOutput(output({ timedOut: true }), contextFor('js'));
    expect(result.status).toBe('errored');
    expect(result.error).toContain('tempo limite');
  });

  it('propaga cancelamento', () => {
    const result = createVitestAdapter().parseOutput(output({ cancelled: true }), contextFor('js'));
    expect(result.status).toBe('cancelled');
  });

  it('propaga falha de spawn', () => {
    const result = createVitestAdapter().parseOutput(
      output({ spawnError: 'ENOENT' }),
      contextFor('js'),
    );
    expect(result.status).toBe('errored');
    expect(result.error).toBe('ENOENT');
  });
});

describe('createJestAdapter', () => {
  it('usa --runTestsByPath antes dos arquivos', () => {
    const invocation = createJestAdapter().buildInvocation(
      [`${root}/src/a.test.ts`],
      contextFor('js', { adapter: 'jest' }),
      '/tmp/r.json',
    );
    expect(invocation.args).toEqual([
      'jest',
      '--json',
      '--outputFile=/tmp/r.json',
      '--passWithNoTests',
      '--runTestsByPath',
      'src/a.test.ts',
    ]);
  });
});

describe('createPytestAdapter', () => {
  it('monta a linha de comando com junitxml xunit1', () => {
    const invocation = createPytestAdapter().buildInvocation(
      [`${root}/tests/test_a.py`],
      contextFor('python'),
      '/tmp/r.xml',
    );
    expect(invocation.command).toBe('python3');
    expect(invocation.args).toEqual([
      '-m',
      'pytest',
      '--junitxml=/tmp/r.xml',
      '-o',
      'junit_family=xunit1',
      '-q',
      'tests/test_a.py',
    ]);
  });

  it('trata exit 5 (nenhum teste coletado) como skipped', () => {
    const result = createPytestAdapter().parseOutput(output({ exitCode: 5 }), contextFor('python'));
    expect(result.status).toBe('skipped');
  });

  it('interpreta o relatorio JUnit', () => {
    const xml = '<testcase classname="t" name="test_x" file="tests/test_a.py"/>';
    const result = createPytestAdapter().parseOutput(
      output({ reportContent: xml }),
      contextFor('python'),
    );
    expect(result.counts.passed).toBe(1);
    expect(result.cases[0]?.file).toBe(`${root}/tests/test_a.py`);
  });

  it('reporta ausencia de relatorio como errored', () => {
    const result = createPytestAdapter().parseOutput(
      output({ exitCode: 2, stderr: 'ModuleNotFoundError' }),
      contextFor('python'),
    );
    expect(result.status).toBe('errored');
    expect(result.error).toContain('ModuleNotFoundError');
  });
});

describe('createCommandAdapter', () => {
  const goContext = () =>
    contextFor('go', { adapter: 'command', command: 'go', args: ['test'], match: ['**/*.go'] });

  it('classifica pelo codigo de saida', () => {
    expect(createCommandAdapter().parseOutput(output(), goContext()).status).toBe('passed');
    expect(createCommandAdapter().parseOutput(output({ exitCode: 1 }), goContext()).status).toBe(
      'failed',
    );
  });

  it('monta comando com argumentos do usuario', () => {
    const invocation = createCommandAdapter().buildInvocation(
      [`${root}/pkg/a_test.go`],
      goContext(),
      null,
    );
    expect(invocation.command).toBe('go');
    expect(invocation.args).toEqual(['test', 'pkg/a_test.go']);
  });
});

describe('createRunnerAdapter', () => {
  it('instancia os adapters embutidos', () => {
    for (const id of Object.keys(BUILTIN_RUNNER_ADAPTERS)) {
      expect(createRunnerAdapter(id)?.id).toBe(id);
    }
  });

  it('devolve null para id desconhecido', () => {
    expect(createRunnerAdapter('cobol')).toBeNull();
  });

  it('aceita fabricas customizadas que sobrepoem as embutidas', () => {
    const custom = { vitest: () => ({ ...createCommandAdapter(), id: 'meu-vitest' }) };
    expect(createRunnerAdapter('vitest', custom)?.id).toBe('meu-vitest');
  });
});

/**
 * Contexto com um {@link RunnerConfig} minimo — apenas os campos obrigatorios.
 *
 * A configuracao resolvida sempre preenche `args`, `env`, `timeoutMs` e afins,
 * mas o tipo permite omiti-los, e adapters de terceiros podem construir um
 * contexto na mao. Estes testes garantem que os defaults dos adapters valem.
 */
function contextoMinimo(runnerKey: string, config: Partial<RunnerAdapterContext['config']> = {}) {
  return {
    root,
    runnerKey,
    config: { adapter: 'command', match: ['**/*.ts'], ...config },
    logger: createRecordingLogger('debug').logger,
    pythonPath: 'python3',
  } satisfies RunnerAdapterContext;
}

describe('adapters — defaults com configuracao minima', () => {
  const arquivo = `${root}/src/a.test.ts`;

  it('vitest usa npx, sem argumentos extras e com timeout padrao', () => {
    const invocation = createVitestAdapter().buildInvocation([arquivo], contextoMinimo('js'), null);
    expect(invocation.command).toBe('npx');
    expect(invocation.args).toEqual([
      'vitest',
      'run',
      '--reporter=json',
      '--passWithNoTests',
      'src/a.test.ts',
    ]);
    expect(invocation.env).toEqual({});
    expect(invocation.timeoutMs).toBe(120_000);
  });

  it('jest usa npx com os mesmos defaults', () => {
    const invocation = createJestAdapter().buildInvocation([arquivo], contextoMinimo('js'), null);
    expect(invocation.command).toBe('npx');
    expect(invocation.env).toEqual({});
    expect(invocation.timeoutMs).toBe(120_000);
  });

  it('pytest usa o interpretador do contexto e o modulo pytest', () => {
    const invocation = createPytestAdapter().buildInvocation(
      [`${root}/tests/test_a.py`],
      contextoMinimo('python'),
      null,
    );
    expect(invocation.command).toBe('python3');
    expect(invocation.args).toEqual(['-m', 'pytest', '-q', 'tests/test_a.py']);
    expect(invocation.env).toEqual({});
    expect(invocation.timeoutMs).toBe(120_000);
  });

  it('pytest respeita command, args, env, cwd e timeout do usuario', () => {
    const invocation = createPytestAdapter().buildInvocation(
      [`${root}/pacote/tests/test_a.py`],
      contextoMinimo('python', {
        command: 'poetry',
        args: ['-x'],
        env: { PYTHONPATH: '.' },
        cwd: 'pacote',
        timeoutMs: 9000,
      }),
      '/tmp/r.xml',
    );
    expect(invocation.command).toBe('poetry');
    expect(invocation.args).toEqual([
      '--junitxml=/tmp/r.xml',
      '-o',
      'junit_family=xunit1',
      '-q',
      '-x',
      'tests/test_a.py',
    ]);
    expect(invocation.env).toEqual({ PYTHONPATH: '.' });
    expect(invocation.cwd).toBe(`${root}/pacote`);
    expect(invocation.timeoutMs).toBe(9000);
  });

  it('command usa echo quando nenhum comando e configurado', () => {
    const invocation = createCommandAdapter().buildInvocation(
      [arquivo],
      contextoMinimo('outro'),
      null,
    );
    expect(invocation.command).toBe('echo');
    expect(invocation.args).toEqual(['src/a.test.ts']);
    expect(invocation.env).toEqual({});
    expect(invocation.timeoutMs).toBe(120_000);
  });

  it('command respeita env e timeout do usuario', () => {
    const invocation = createCommandAdapter().buildInvocation(
      [arquivo],
      contextoMinimo('outro', { command: 'go', env: { CGO_ENABLED: '0' }, timeoutMs: 30_000 }),
      null,
    );
    expect(invocation.env).toEqual({ CGO_ENABLED: '0' });
    expect(invocation.timeoutMs).toBe(30_000);
  });
});

describe('adapters — falhas de processo e detalhes de erro', () => {
  it('command propaga timeout, cancelamento e falha de spawn', () => {
    const ctx = contextoMinimo('outro');
    const adapter = createCommandAdapter();
    expect(adapter.parseOutput(output({ timedOut: true }), ctx).status).toBe('errored');
    expect(adapter.parseOutput(output({ cancelled: true }), ctx).status).toBe('cancelled');
    expect(adapter.parseOutput(output({ spawnError: 'ENOENT' }), ctx).error).toBe('ENOENT');
  });

  it('pytest propaga timeout e cancelamento', () => {
    const ctx = contextoMinimo('python');
    const adapter = createPytestAdapter();
    expect(adapter.parseOutput(output({ timedOut: true }), ctx).status).toBe('errored');
    expect(adapter.parseOutput(output({ cancelled: true }), ctx).status).toBe('cancelled');
  });

  it('pytest usa o stdout quando o stderr esta vazio', () => {
    const result = createPytestAdapter().parseOutput(
      output({ exitCode: 4, stdout: 'erro de coleta' }),
      contextoMinimo('python'),
    );
    expect(result.error).toContain('erro de coleta');
  });

  it('pytest omite o detalhe quando nao ha saida alguma', () => {
    const result = createPytestAdapter().parseOutput(
      output({ exitCode: 4 }),
      contextoMinimo('python'),
    );
    expect(result.error).toBe('pytest nao produziu relatorio (exit 4)');
  });

  it('pytest trata relatorio em branco como ausente', () => {
    const result = createPytestAdapter().parseOutput(
      output({ exitCode: 1, reportContent: '   ' }),
      contextoMinimo('python'),
    );
    expect(result.status).toBe('errored');
  });

  it('vitest usa o stdout quando o stderr esta vazio', () => {
    const result = createVitestAdapter().parseOutput(
      output({ exitCode: 1, stdout: 'modulo nao encontrado' }),
      contextoMinimo('js'),
    );
    expect(result.error).toContain('modulo nao encontrado');
  });

  it('vitest omite o detalhe quando nao ha saida alguma', () => {
    const result = createVitestAdapter().parseOutput(output({ exitCode: 1 }), contextoMinimo('js'));
    expect(result.error).toBe('vitest nao produziu relatorio (exit 1)');
  });

  it('vitest trata relatorio em branco como ausente', () => {
    const result = createVitestAdapter().parseOutput(
      output({ exitCode: 0, reportContent: '  ' }),
      contextoMinimo('js'),
    );
    expect(result.status).toBe('passed');
  });
});

describe('createJestAdapter — interpretacao da saida', () => {
  it('le o relatorio JSON do jest', () => {
    const report = JSON.stringify({
      testResults: [
        { name: '/a.test.ts', assertionResults: [{ fullName: 'x', status: 'passed' }] },
      ],
    });
    const result = createJestAdapter().parseOutput(
      output({ reportContent: report }),
      contextoMinimo('js'),
    );
    expect(result.status).toBe('passed');
    expect(result.counts.passed).toBe(1);
  });

  it('reporta ausencia de relatorio com o nome do runner', () => {
    const result = createJestAdapter().parseOutput(
      output({ exitCode: 1, stderr: 'jest: not found' }),
      contextoMinimo('js'),
    );
    expect(result.error).toContain('jest nao produziu relatorio');
  });
});
