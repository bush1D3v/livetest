import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { EXIT } from '../src/context.js';
import { commandHelp, COMMANDS, findCommand, generalHelp, runCli } from '../src/cli.js';
import { captureOutput, createDemoProject, createTempProject, type TempProject } from './helpers/harness.js';

let project: TempProject | null = null;

afterEach(() => {
  project?.cleanup();
  project = null;
});

/** Executa a CLI dentro do projeto temporario. */
async function cli(argv: string[], cwd: string) {
  const output = captureOutput();
  const code = await runCli({ argv, output, cwd });
  return { code, output };
}

describe('ajuda e metadados', () => {
  it('sem argumentos mostra a ajuda geral', async () => {
    const output = captureOutput();
    expect(await runCli({ argv: [], output })).toBe(EXIT.ok);
    expect(output.outText()).toContain('Uso: livetest <comando>');
  });

  it('--help mostra a ajuda geral', async () => {
    const output = captureOutput();
    await runCli({ argv: ['--help'], output });
    expect(output.outText()).toContain('Comandos:');
  });

  it('--help <comando> mostra a ajuda do comando', async () => {
    const output = captureOutput();
    await runCli({ argv: ['--help', 'run'], output });
    expect(output.outText()).toContain('Uso: livetest run');
  });

  it('<comando> --help mostra a ajuda do comando', async () => {
    const output = captureOutput();
    await runCli({ argv: ['why', '--help'], output });
    expect(output.outText()).toContain('Uso: livetest why');
  });

  it('--version imprime a versao', async () => {
    const output = captureOutput();
    await runCli({ argv: ['--version'], output });
    expect(output.outText()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('rejeita comando desconhecido', async () => {
    const output = captureOutput();
    expect(await runCli({ argv: ['inventado'], output })).toBe(EXIT.usage);
    expect(output.errText()).toContain('Comando desconhecido');
  });

  it('rejeita flag desconhecida com o uso do comando', async () => {
    const output = captureOutput();
    expect(await runCli({ argv: ['run', '--inventada'], output })).toBe(EXIT.usage);
    expect(output.errText()).toContain('Uso: livetest run');
  });

  it('todo comando tem nome, resumo e uso', () => {
    for (const command of COMMANDS) {
      expect(command.name).toMatch(/^[a-z]+$/);
      expect(command.summary.length).toBeGreaterThan(5);
      expect(command.usage).toContain(`livetest ${command.name}`);
      expect(commandHelp(command).length).toBeGreaterThan(2);
    }
  });

  it('a ajuda geral lista todos os comandos', () => {
    const text = generalHelp().join('\n');
    for (const command of COMMANDS) expect(text).toContain(command.name);
  });

  it('findCommand localiza pelo nome', () => {
    expect(findCommand('start')?.name).toBe('start');
    expect(findCommand('inexistente')).toBeUndefined();
  });
});

describe('livetest init', () => {
  it('cria o arquivo de configuracao', async () => {
    project = createTempProject();
    const { code, output } = await cli(['init'], project.root);
    expect(code).toBe(EXIT.ok);
    expect(output.outText()).toContain('Criado');

    const content = fs.readFileSync(project.path('livetest.config.json'), 'utf8');
    expect(content).toContain('dependencyDepth');
    expect(content).toContain('// Globs observados');
  });

  it('o template gerado e uma configuracao valida', async () => {
    project = createTempProject();
    await cli(['init'], project.root);
    // `doctor` carrega e valida o arquivo; nao pode falhar por configuracao.
    const { code } = await cli(['doctor'], project.root);
    expect(code).not.toBe(EXIT.usage);
  });

  it('recusa sobrescrever sem --force', async () => {
    project = createTempProject({ 'livetest.config.json': '{}' });
    const { code, output } = await cli(['init'], project.root);
    expect(code).toBe(EXIT.usage);
    expect(output.errText()).toContain('--force');
  });

  it('sobrescreve com --force', async () => {
    project = createTempProject({ 'livetest.config.json': '{}' });
    const { code } = await cli(['init', '--force'], project.root);
    expect(code).toBe(EXIT.ok);
    expect(fs.readFileSync(project.path('livetest.config.json'), 'utf8')).toContain('debounce');
  });

  it('--print nao grava nada', async () => {
    project = createTempProject();
    const { code, output } = await cli(['init', '--print'], project.root);
    expect(code).toBe(EXIT.ok);
    expect(output.outText()).toContain('dependencyDepth');
    expect(fs.existsSync(project.path('livetest.config.json'))).toBe(false);
  });
});

describe('livetest why', () => {
  it('explica a propagacao transitiva', async () => {
    project = createDemoProject();
    const { code, output } = await cli(['why', 'src/login.ts'], project.root);
    expect(code).toBe(EXIT.ok);

    const text = output.outText();
    expect(text).toContain('profundidade:  transitive');
    expect(text).toContain('[override: src/login.ts]');
    expect(text).toContain('src/header.test.ts');
    expect(text).toContain('rodou porque src/header.ts importa src/login.ts (1 nivel)');
    expect(text).toContain('via src/header.ts (2 niveis)');
  }, 30_000);

  it('respeita --depth self', async () => {
    project = createDemoProject();
    const { output } = await cli(['why', 'src/header.ts', '--depth', 'self'], project.root);
    expect(output.outText()).toContain('profundidade:  self');
    expect(output.outText()).not.toContain('src/layout.test.ts');
  }, 30_000);

  it('explica quando nao ha teste', async () => {
    project = createDemoProject();
    const { output } = await cli(['why', 'src/orfao.ts'], project.root);
    expect(output.outText()).toContain('testes que rodariam: nenhum');
    expect(output.outText()).toContain('sem teste:');
  }, 30_000);

  it('exige o argumento de arquivo', async () => {
    project = createDemoProject();
    const { code, output } = await cli(['why'], project.root);
    expect(code).toBe(EXIT.usage);
    expect(output.errText()).toContain('Informe o arquivo');
  }, 30_000);

  it('rejeita --depth invalido', async () => {
    project = createDemoProject();
    const { code, output } = await cli(['why', 'src/login.ts', '--depth', 'fundo'], project.root);
    expect(code).toBe(EXIT.config);
    expect(output.errText()).toContain('--depth invalido');
  }, 30_000);
});

describe('livetest run', () => {
  it('executa os testes afetados e devolve 0', async () => {
    project = createDemoProject('process.exit(0)');
    const { code } = await cli(['run', 'src/login.ts'], project.root);
    expect(code).toBe(EXIT.ok);
  }, 30_000);

  it('devolve 1 quando os testes falham', async () => {
    project = createDemoProject('process.exit(1)');
    const { code } = await cli(['run', 'src/login.ts'], project.root);
    expect(code).toBe(EXIT.testsFailed);
  }, 30_000);

  it('devolve 0 quando o arquivo nao tem teste', async () => {
    project = createDemoProject();
    const { code } = await cli(['run', 'src/orfao.ts'], project.root);
    expect(code).toBe(EXIT.ok);
  }, 30_000);

  it('sem arquivos roda tudo que esta observado', async () => {
    project = createDemoProject();
    const { code } = await cli(['run'], project.root);
    expect(code).toBe(EXIT.ok);
  }, 30_000);

  it('--dry-run nao executa nada', async () => {
    project = createDemoProject('process.exit(1)');
    const { code } = await cli(['run', 'src/login.ts', '--dry-run'], project.root);
    expect(code).toBe(EXIT.ok);
  }, 30_000);

  it('nao publica arquivo de descoberta', async () => {
    project = createDemoProject();
    await cli(['run', 'src/login.ts'], project.root);
    expect(fs.existsSync(project.path('.livetest/daemon.json'))).toBe(false);
  }, 30_000);
});

describe('livetest status', () => {
  it('falha quando nao ha daemon nem status.json', async () => {
    project = createDemoProject();
    const { code, output } = await cli(['status'], project.root);
    expect(code).toBe(EXIT.daemon);
    expect(output.errText()).toContain('livetest start');
  }, 30_000);

  it('le o status.json deixado por uma execucao anterior', async () => {
    project = createDemoProject();
    await cli(['run', 'src/login.ts'], project.root);

    const { code, output } = await cli(['status'], project.root);
    expect(code).toBe(EXIT.ok);
    expect(output.outText()).toContain('arquivo status.json');
    expect(output.outText()).toContain('ultimo lote');
  }, 30_000);

  it('--json imprime o snapshot completo', async () => {
    project = createDemoProject();
    await cli(['run', 'src/login.ts'], project.root);

    const { output } = await cli(['status', '--json'], project.root);
    const snapshot = JSON.parse(output.outText()) as { lastBatch: { status: string } | null };
    expect(snapshot.lastBatch?.status).toBe('passed');
  }, 30_000);

  it('devolve 1 quando o ultimo lote falhou', async () => {
    project = createDemoProject('process.exit(1)');
    await cli(['run', 'src/login.ts'], project.root);
    const { code } = await cli(['status'], project.root);
    expect(code).toBe(EXIT.testsFailed);
  }, 30_000);
});

describe('livetest stop', () => {
  it('reporta quando nao ha daemon', async () => {
    project = createDemoProject();
    const { code, output } = await cli(['stop'], project.root);
    expect(code).toBe(EXIT.daemon);
    expect(output.errText()).toContain('Nenhum daemon');
  }, 30_000);

  it('limpa registro obsoleto', async () => {
    project = createDemoProject();
    project.write(
      '.livetest/daemon.json',
      JSON.stringify({
        pid: 2_147_483_600,
        host: '127.0.0.1',
        port: 1,
        root: project.root,
        version: '0.1.0',
        protocolVersion: 1,
        startedAt: 0,
      }),
    );

    const { code, output } = await cli(['stop'], project.root);
    expect(code).toBe(EXIT.ok);
    expect(output.outText()).toContain('obsoleto');
    expect(fs.existsSync(project.path('.livetest/daemon.json'))).toBe(false);
  }, 30_000);
});

describe('livetest stop — encerramento real', () => {
  /** Cria um processo filho ocioso para servir de "daemon" no teste. */
  function spawnIdleProcess(): { pid: number; kill: () => void } {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return { pid: child.pid as number, kill: () => child.kill('SIGKILL') };
  }

  it('encerra o processo e remove o arquivo de descoberta', async () => {
    project = createDemoProject();
    const child = spawnIdleProcess();

    project.write(
      '.livetest/daemon.json',
      JSON.stringify({
        pid: child.pid,
        host: '127.0.0.1',
        port: 1,
        root: project.root,
        version: '0.1.0',
        protocolVersion: 1,
        startedAt: 0,
      }),
    );

    try {
      const { code, output } = await cli(['stop'], project.root);
      expect(code).toBe(EXIT.ok);
      expect(output.outText()).toContain('Daemon encerrado.');
      // No Windows o SIGTERM nao roda os handlers do daemon: a limpeza do
      // registro precisa acontecer aqui, senao fica um arquivo orfao.
      expect(fs.existsSync(project.path('.livetest/daemon.json'))).toBe(false);
    } finally {
      child.kill();
    }
  }, 30_000);

  it('--force usa SIGKILL', async () => {
    project = createDemoProject();
    const child = spawnIdleProcess();

    project.write(
      '.livetest/daemon.json',
      JSON.stringify({
        pid: child.pid,
        host: '127.0.0.1',
        port: 1,
        root: project.root,
        version: '0.1.0',
        protocolVersion: 1,
        startedAt: 0,
      }),
    );

    try {
      const { code, output } = await cli(['stop', '--force'], project.root);
      expect(code).toBe(EXIT.ok);
      expect(output.outText()).toContain('SIGKILL');
    } finally {
      child.kill();
    }
  }, 30_000);
});
