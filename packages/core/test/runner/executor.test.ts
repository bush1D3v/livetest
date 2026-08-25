import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { resolveConfig } from '../../src/config/load.js';
import { executeRun, formatCommand, tailLines } from '../../src/runner/executor.js';
import type { RunnerAdapterContext, TestRunnerAdapter } from '../../src/types/runner.js';
import { normalizePath, toNative } from '../../src/util/paths.js';
import { createRecordingLogger } from '../helpers/logger.js';

const root = normalizePath(process.cwd());

function context(): RunnerAdapterContext {
  const { config } = resolveConfig({ useGitignore: false }, { root });
  const runner = config.runners['js'];
  if (!runner) throw new Error('runner js ausente');
  return {
    root,
    runnerKey: 'js',
    config: runner,
    logger: createRecordingLogger('debug').logger,
    pythonPath: 'python',
  };
}

/** Adapter que executa um script Node inline e escreve o relatorio pedido. */
function scriptAdapter(script: string, reportPayload?: string): TestRunnerAdapter {
  return {
    id: 'fake',
    reportFileExtension: reportPayload === undefined ? null : '.json',
    buildInvocation: (_files, ctx, reportFile) => ({
      command: process.execPath,
      args: [
        '-e',
        reportFile
          ? `require('fs').writeFileSync(${JSON.stringify(toNative(reportFile))}, ${JSON.stringify(reportPayload ?? '')}); ${script}`
          : script,
      ],
      cwd: ctx.root,
      env: {},
      reportFile,
      timeoutMs: 20_000,
    }),
    parseOutput: (out) => ({
      status: out.exitCode === 0 ? 'passed' : 'failed',
      counts: { total: 1, passed: out.exitCode === 0 ? 1 : 0, failed: out.exitCode === 0 ? 0 : 1, skipped: 0 },
      cases: [],
      error: out.reportContent === null ? 'sem relatorio' : null,
    }),
  };
}

describe('tailLines', () => {
  it('devolve as ultimas linhas', () => {
    expect(tailLines('a\nb\nc\nd', 2)).toEqual(['c', 'd']);
  });

  it('descarta linhas em branco no fim', () => {
    expect(tailLines('a\nb\n\n\n', 2)).toEqual(['a', 'b']);
  });

  it('devolve vazio para contagem zero ou texto vazio', () => {
    expect(tailLines('a\nb', 0)).toEqual([]);
    expect(tailLines('', 5)).toEqual([]);
  });
});

describe('formatCommand', () => {
  it('junta comando e argumentos', () => {
    expect(formatCommand('npx', ['vitest', 'run'])).toBe('npx vitest run');
  });

  it('cita argumentos com espaco', () => {
    expect(formatCommand('npx', ['--outputFile=/tmp/a b.json'])).toBe(
      'npx "--outputFile=/tmp/a b.json"',
    );
  });
});

describe('executeRun', () => {
  const baseOptions = {
    runId: 'run-1',
    batchId: 'batch-1',
    runnerKey: 'js',
    testFiles: [`${root}/src/a.test.ts`],
    reasons: {},
    logTailLines: 10,
  };

  it('executa o processo e monta o resultado', async () => {
    const result = await executeRun({
      ...baseOptions,
      adapter: scriptAdapter('process.stdout.write("ok")', '{}'),
      context: context(),
    });
    expect(result.status).toBe('passed');
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail).toEqual(['ok']);
    expect(result.runId).toBe('run-1');
    expect(result.adapterId).toBe('fake');
    expect(result.command).toContain(process.execPath);
  });

  it('entrega o conteudo do relatorio ao parser', async () => {
    const result = await executeRun({
      ...baseOptions,
      adapter: scriptAdapter('', '{"ok":true}'),
      context: context(),
    });
    expect(result.error).toBeNull();
  });

  it('remove o arquivo temporario de relatorio', async () => {
    let reportPath: string | null = null;
    const adapter = scriptAdapter('', '{}');
    const spy: typeof adapter = {
      ...adapter,
      buildInvocation: (files, ctx, reportFile) => {
        reportPath = reportFile;
        return adapter.buildInvocation(files, ctx, reportFile);
      },
    };
    await executeRun({ ...baseOptions, adapter: spy, context: context() });
    expect(reportPath).not.toBeNull();
    expect(fs.existsSync(toNative(reportPath as unknown as string))).toBe(false);
  });

  it('marca falha quando o processo sai com codigo diferente de zero', async () => {
    const result = await executeRun({
      ...baseOptions,
      adapter: scriptAdapter('process.exit(1)', '{}'),
      context: context(),
    });
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(1);
  });

  it('captura stderr no resultado', async () => {
    const result = await executeRun({
      ...baseOptions,
      adapter: scriptAdapter('process.stderr.write("ruim")', '{}'),
      context: context(),
    });
    expect(result.stderrTail).toEqual(['ruim']);
  });

  it('nao executa nada em dryRun mas devolve o comando montado', async () => {
    const result = await executeRun({
      ...baseOptions,
      adapter: scriptAdapter('process.exit(1)', '{}'),
      context: context(),
      dryRun: true,
    });
    expect(result.status).toBe('skipped');
    expect(result.exitCode).toBeNull();
    expect(result.command).toContain(process.execPath);
  });

  it('devolve errored quando o adapter falha ao montar o comando', async () => {
    const adapter: TestRunnerAdapter = {
      id: 'quebrado',
      buildInvocation: () => {
        throw new Error('config invalida');
      },
      parseOutput: () => ({
        status: 'passed',
        counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
        cases: [],
        error: null,
      }),
    };
    const result = await executeRun({ ...baseOptions, adapter, context: context() });
    expect(result.status).toBe('errored');
    expect(result.error).toContain('config invalida');
  });

  it('devolve errored quando o adapter falha ao interpretar a saida', async () => {
    const adapter: TestRunnerAdapter = {
      ...scriptAdapter('', undefined),
      parseOutput: () => {
        throw new Error('parser quebrado');
      },
    };
    const result = await executeRun({ ...baseOptions, adapter, context: context() });
    expect(result.status).toBe('errored');
    expect(result.error).toContain('parser quebrado');
  });

  it('cancela a execucao pelo AbortSignal', async () => {
    const controller = new AbortController();
    const adapter = scriptAdapter('setTimeout(() => {}, 30000)', undefined);
    const promise = executeRun({
      ...baseOptions,
      adapter,
      context: context(),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 150);
    const result = await promise;
    expect(result.exitCode).not.toBe(0);
  });

  it('preserva os motivos de selecao no resultado', async () => {
    const reasons = {
      [`${root}/src/a.test.ts`]: [
        {
          kind: 'importer' as const,
          changedFile: `${root}/src/login.ts`,
          sourceFile: `${root}/src/a.ts`,
          depth: 1,
          chain: [`${root}/src/login.ts`, `${root}/src/a.ts`],
        },
      ],
    };
    const result = await executeRun({
      ...baseOptions,
      reasons,
      adapter: scriptAdapter('', '{}'),
      context: context(),
    });
    expect(result.reasons).toEqual(reasons);
  });
});

describe('tailLines — bordas', () => {
  it('devolve vazio quando todas as linhas sao em branco', () => {
    expect(tailLines('\n\n  \n', 5)).toEqual([]);
  });

  it('devolve todas as linhas quando ha menos que o pedido', () => {
    expect(tailLines('a\nb', 10)).toEqual(['a', 'b']);
  });
});

describe('executeRun — relatorio ausente e limpeza', () => {
  /** Adapter que declara relatorio mas nao o escreve. */
  const semRelatorio: TestRunnerAdapter = {
    id: 'sem-relatorio',
    reportFileExtension: '.json',
    buildInvocation: (_files, ctx, reportFile) => ({
      command: process.execPath,
      args: ['-e', ''],
      cwd: ctx.root,
      env: {},
      reportFile,
      timeoutMs: 20_000,
    }),
    parseOutput: (out) => ({
      status: out.reportContent === null ? 'errored' : 'passed',
      counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
      cases: [],
      error: out.reportContent === null ? 'sem relatorio' : null,
    }),
  };

  const base = {
    runId: 'run-9',
    batchId: 'batch-9',
    runnerKey: 'js',
    testFiles: [`${root}/src/a.test.ts`],
    reasons: {},
    logTailLines: 5,
  };

  it('entrega null ao parser quando o runner nao escreve o relatorio', async () => {
    const result = await executeRun({ ...base, adapter: semRelatorio, context: context() });
    expect(result.status).toBe('errored');
    expect(result.error).toBe('sem relatorio');
  });

  it('ignora falha ao apagar o relatorio temporario', async () => {
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw new Error('EPERM');
    });
    try {
      const result = await executeRun({ ...base, adapter: semRelatorio, context: context() });
      expect(result.status).toBe('errored');
    } finally {
      spy.mockRestore();
    }
  });

  it('ignora falha ao apagar o relatorio quando o adapter nem monta o comando', async () => {
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw new Error('EPERM');
    });
    const adapter: TestRunnerAdapter = {
      id: 'quebrado',
      reportFileExtension: '.json',
      buildInvocation: () => {
        throw new Error('config invalida');
      },
      parseOutput: () => ({
        status: 'passed',
        counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
        cases: [],
        error: null,
      }),
    };
    try {
      const result = await executeRun({ ...base, adapter, context: context() });
      expect(result.status).toBe('errored');
    } finally {
      spy.mockRestore();
    }
  });

  it('descreve erro nao-Error vindo do buildInvocation', async () => {
    const adapter: TestRunnerAdapter = {
      id: 'estranho',
      buildInvocation: () => {
        throw 'texto solto';
      },
      parseOutput: () => ({
        status: 'passed',
        counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
        cases: [],
        error: null,
      }),
    };
    const result = await executeRun({ ...base, adapter, context: context() });
    expect(result.error).toContain('texto solto');
  });

  it('descreve erro nao-Error vindo do parseOutput', async () => {
    const adapter: TestRunnerAdapter = {
      ...semRelatorio,
      reportFileExtension: null,
      parseOutput: () => {
        throw 'parser estranho';
      },
    };
    const result = await executeRun({ ...base, adapter, context: context() });
    expect(result.error).toContain('parser estranho');
  });

  it('dryRun tambem limpa o relatorio temporario', async () => {
    const result = await executeRun({
      ...base,
      adapter: semRelatorio,
      context: context(),
      dryRun: true,
    });
    expect(result.status).toBe('skipped');
  });
});
