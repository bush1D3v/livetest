/**
 * Verificacoes do `livetest doctor`.
 *
 * As sondagens de binario usam o proprio Node como executavel: assim cada
 * resultado possivel (disponivel, codigo de erro, executavel ausente) e
 * reproduzido sem depender do que esta instalado na maquina.
 */

import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';
import { EXIT } from '../src/context.js';
import { probeCommand, probeRunner } from '../src/commands/doctor.js';
import { captureOutput, createTempProject, type TempProject } from './helpers/harness.js';

let project: TempProject | null = null;

afterEach(() => {
  project?.cleanup();
  project = null;
});

const cwd = process.cwd();

async function cli(argv: string[], raiz: string) {
  const output = captureOutput();
  const code = await runCli({ argv, output, cwd: raiz });
  return { code, output };
}

describe('probeCommand', () => {
  it('reporta disponivel e a primeira linha do stdout', async () => {
    const probe = await probeCommand(process.execPath, ['-e', 'console.log("v1"); console.log("v2")'], cwd);
    expect(probe).toEqual({ available: true, detail: 'v1' });
  });

  it('cai para o stderr quando o stdout esta vazio', async () => {
    const probe = await probeCommand(process.execPath, ['-e', 'console.error("aviso")'], cwd);
    expect(probe).toEqual({ available: true, detail: 'aviso' });
  });

  it('reporta indisponivel quando o codigo de saida nao e zero', async () => {
    const probe = await probeCommand(
      process.execPath,
      ['-e', 'console.error("faltou modulo"); process.exit(3)'],
      cwd,
    );
    expect(probe.available).toBe(false);
    expect(probe.detail).toBe('saiu com codigo 3: faltou modulo');
  });

  it('usa o stdout no detalhe quando o stderr esta vazio', async () => {
    const probe = await probeCommand(
      process.execPath,
      ['-e', 'console.log("mensagem"); process.exit(1)'],
      cwd,
    );
    expect(probe.detail).toBe('saiu com codigo 1: mensagem');
  });

  it('reporta indisponivel quando o executavel nao existe', async () => {
    const probe = await probeCommand('nao-existe-livetest-xyz.exe', [], cwd);
    expect(probe.available).toBe(false);
    expect(probe.detail.length).toBeGreaterThan(0);
  });
});

/**
 * Cria um executavel que aceita qualquer argumento, imprime uma versao e sai
 * com zero — o suficiente para a sondagem considerar o runner disponivel.
 */
function criarStub(): { projeto: TempProject; caminho: string } {
  const ehWindows = process.platform === 'win32';
  const nome = ehWindows ? 'stub.cmd' : 'stub.sh';
  const conteudo = ehWindows
    ? ['@echo off', 'echo v9.9.9', 'exit /b 0', ''].join('\r\n')
    : ['#!/bin/sh', 'echo v9.9.9', 'exit 0', ''].join('\n');

  const projeto = createTempProject({ [nome]: conteudo });
  const caminho = projeto.path(nome);
  if (!ehWindows) fs.chmodSync(caminho, 0o755);
  return { projeto, caminho };
}

describe('probeRunner', () => {
  const config = { root: cwd, pythonPath: process.execPath };

  it('reprova o pytest quando o interpretador nao tem o modulo', async () => {
    const check = await probeRunner('python', 'pytest', process.execPath, config, cwd);
    expect(check.name).toBe('runner "python"');
    expect(check.status).toBe('erro');
    expect(check.detail).toContain('pytest indisponivel');
  });

  it('usa o interpretador da configuracao quando nenhum comando e dado', async () => {
    const check = await probeRunner('python', 'pytest', undefined, config, cwd);
    expect(check.name).toBe('runner "python"');
    expect(check.status).toBe('erro');
  });

  it('aprova o pytest quando o comando responde com sucesso', async () => {
    const { projeto, caminho } = criarStub();
    try {
      const check = await probeRunner('python', 'pytest', caminho, config, cwd);
      expect(check.status).toBe('ok');
      expect(check.detail).toBe('v9.9.9');
    } finally {
      projeto.cleanup();
    }
  });

  it('reprova vitest quando o binario nao responde', async () => {
    const check = await probeRunner('js', 'vitest', 'nao-existe-livetest-xyz.exe', config, cwd);
    expect(check.status).toBe('erro');
    expect(check.detail).toContain('vitest indisponivel');
  });

  it('reprova jest com o nome correto no detalhe', async () => {
    const check = await probeRunner('js', 'jest', 'nao-existe-livetest-xyz.exe', config, cwd);
    expect(check.detail).toContain('jest indisponivel');
  });

  it('aprova vitest quando o binario responde com sucesso', async () => {
    const { projeto, caminho } = criarStub();
    try {
      const check = await probeRunner('js', 'vitest', caminho, config, cwd);
      expect(check.status).toBe('ok');
      expect(check.detail).toBe('v9.9.9');
    } finally {
      projeto.cleanup();
    }
  });

  it('usa npx quando nenhum comando e dado para o vitest', async () => {
    const check = await probeRunner('js', 'vitest', undefined, config, cwd);
    expect(check.name).toBe('runner "js"');
    expect(['ok', 'erro']).toContain(check.status);
  }, 60_000);

  it('aprova o adapter command quando ha comando declarado', async () => {
    const check = await probeRunner('go', 'command', 'go', config, cwd);
    expect(check).toEqual({ name: 'runner "go"', status: 'ok', detail: 'comando "go"' });
  });

  it('reprova o adapter command sem comando', async () => {
    const check = await probeRunner('go', 'command', undefined, config, cwd);
    expect(check.status).toBe('erro');
    expect(check.detail).toContain('exige a chave "command"');
  });

  it('nao verifica adapters customizados', async () => {
    const check = await probeRunner('rust', 'cargo-nextest', undefined, config, cwd);
    expect(check).toEqual({
      name: 'runner "rust"',
      status: 'aviso',
      detail: 'adapter customizado "cargo-nextest" nao verificado',
    });
  });
});

describe('livetest doctor — verificacoes do comando', () => {
  /** Projeto com um runner de comando, que a sondagem aprova sem executar. */
  function projetoComRunner(extra: Record<string, string> = {}, config: object = {}) {
    return createTempProject({
      'livetest.config.json': JSON.stringify({
        watch: ['src/**/*.ts'],
        useGitignore: false,
        runners: {
          js: {
            adapter: 'command',
            command: 'echo',
            match: ['src/**/*.ts'],
            testMatch: ['**/*.test.ts'],
            testPatterns: ['{dir}/{name}.test.{ext}'],
            testExtensions: ['ts'],
            graph: 'js-ts',
          },
        },
        output: { stdout: false, logFile: null, statusFile: null },
        server: { enabled: false },
        logLevel: 'silent',
        ...config,
      }),
      ...extra,
    });
  }

  it('aprova um projeto com fontes e testes completos', async () => {
    project = projetoComRunner({
      'src/a.ts': 'export const a = 1;\n',
      'src/a.test.ts': 'import { a } from "./a";\n',
    });
    const { code, output } = await cli(['doctor'], project.root);

    expect(code).toBe(EXIT.ok);
    expect(output.outText()).toContain('[ok  ] configuracao');
    expect(output.outText()).toContain('[ok  ] node');
    expect(output.outText()).toContain('todo arquivo-fonte tem teste correspondente');
    expect(output.outText()).toContain('[ok  ] runner "js"');
  }, 60_000);

  it('reprova quando nenhum arquivo casa com os globs observados', async () => {
    project = projetoComRunner({ 'outros/a.md': 'texto\n' });
    const { code, output } = await cli(['doctor'], project.root);

    expect(code).toBe(EXIT.config);
    expect(output.outText()).toContain('nenhum arquivo casa com');
  }, 60_000);

  it('reprova quando nenhum fonte tem teste', async () => {
    project = projetoComRunner({ 'src/a.ts': 'export const a = 1;\n' });
    const { output } = await cli(['doctor'], project.root);
    expect(output.outText()).toContain('[ERRO] cobertura de testes');
    expect(output.outText()).toContain('1 arquivo(s) sem teste');
  }, 60_000);

  it('avisa quando parte dos fontes nao tem teste', async () => {
    project = projetoComRunner({
      'src/a.ts': 'export const a = 1;\n',
      'src/a.test.ts': 'import { a } from "./a";\n',
      'src/orfao.ts': 'export const orfao = 1;\n',
    });
    const { code, output } = await cli(['doctor'], project.root);

    expect(code).toBe(EXIT.ok);
    expect(output.outText()).toContain('[aviso] cobertura de testes');
    expect(output.outText()).toContain('src/orfao.ts');
  }, 60_000);

  it('avisa sobre campo desconhecido na configuracao', async () => {
    project = projetoComRunner(
      { 'src/a.ts': '', 'src/a.test.ts': '' },
      { campoInventado: true },
    );
    const { output } = await cli(['doctor'], project.root);
    expect(output.outText()).toContain('[aviso] configuracao');
  }, 60_000);

  it('reporta o uso dos valores padrao quando nao ha arquivo', async () => {
    project = createTempProject({ 'src/a.ts': 'export const a = 1;\n' });
    const { output } = await cli(['doctor'], project.root);
    expect(output.outText()).toContain('usando os valores padrao');
  }, 60_000);

  it('--json devolve as verificacoes estruturadas', async () => {
    project = projetoComRunner({
      'src/a.ts': 'export const a = 1;\n',
      'src/a.test.ts': 'import { a } from "./a";\n',
    });
    const { output } = await cli(['doctor', '--json'], project.root);

    const relatorio = JSON.parse(output.outText()) as {
      checks: Array<{ name: string; status: string; detail: string }>;
    };
    expect(relatorio.checks.map((c) => c.name)).toEqual([
      'configuracao',
      'node',
      'arquivos observados',
      'cobertura de testes',
      'runner "js"',
    ]);
    expect(relatorio.checks.every((c) => typeof c.detail === 'string')).toBe(true);
  }, 60_000);
});
