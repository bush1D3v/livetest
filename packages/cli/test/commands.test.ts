/**
 * Cobertura dos caminhos menos comuns de cada comando: listas vazias, avisos de
 * configuracao, resultados degradados e o ciclo de vida do `start`.
 */

import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';
import { EXIT, reportError } from '../src/context.js';
import { confirmarEncerramento, waitForExit } from '../src/commands/stop.js';
import { captureOutput, createDemoProject, createTempProject, type TempProject } from './helpers/harness.js';

let project: TempProject | null = null;

afterEach(() => {
  project?.cleanup();
  project = null;
});

async function cli(argv: string[], cwd: string) {
  const output = captureOutput();
  const code = await runCli({ argv, output, cwd });
  return { code, output };
}

/** Aguarda ate a condicao valer. */
async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > limite) throw new Error('condicao nao satisfeita a tempo');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('runCli — padroes', () => {
  it('usa o diretorio de trabalho do processo quando nenhum e informado', async () => {
    const output = captureOutput();
    expect(await runCli({ argv: ['--version'], output })).toBe(EXIT.ok);
  });
});

describe('loadConfigForCommand — avisos e arquivo explicito', () => {
  it('repassa avisos da configuracao para o stderr', async () => {
    project = createDemoProject();
    project.write(
      'livetest.config.json',
      JSON.stringify({
        useGitignore: false,
        campoDesconhecido: true,
        server: { enabled: false },
        output: { stdout: false, logFile: null, statusFile: null },
      }),
    );
    const { output } = await cli(['why', 'src/login.ts'], project.root);
    expect(output.errText()).toContain('aviso: Campo desconhecido ignorado: "campoDesconhecido"');
  });

  it('aceita --config apontando para outro arquivo', async () => {
    project = createDemoProject();
    project.write(
      'config/alternativa.json',
      JSON.stringify({
        useGitignore: false,
        dependencyDepth: { default: 'self' },
        runners: {
          js: {
            adapter: 'command',
            command: process.execPath,
            args: ['-e', 'process.exit(0)'],
            match: ['src/**/*.ts'],
            testMatch: ['**/*.test.ts'],
            testPatterns: ['{dir}/{name}.test.{ext}'],
            testExtensions: ['ts'],
          },
        },
        output: { stdout: false, logFile: null, statusFile: null },
        server: { enabled: false },
      }),
    );
    // A raiz passa a ser a pasta do arquivo informado, que nao tem fontes.
    const { code, output } = await cli(
      ['why', 'x.ts', '--config', 'config/alternativa.json'],
      project.root,
    );
    expect(code).toBe(EXIT.ok);
    expect(output.outText()).toContain('runner:');
  });
});

describe('reportError — erro sem pilha', () => {
  it('cai para a mensagem quando o Error nao tem stack', () => {
    const output = captureOutput();
    const semPilha = new Error('sem pilha');
    delete (semPilha as { stack?: string }).stack;
    expect(reportError(semPilha, output)).toBe(EXIT.internal);
    expect(output.errText()).toBe('sem pilha');
  });
});

describe('livetest run — casos de borda', () => {
  it('avisa quando nao ha nenhum arquivo observado', async () => {
    project = createTempProject({
      'livetest.config.json': JSON.stringify({
        watch: ['src/**/*.ts'],
        useGitignore: false,
        output: { stdout: false, logFile: null, statusFile: null },
        server: { enabled: false },
        logLevel: 'silent',
      }),
    });
    const { code, output } = await cli(['run'], project.root);
    expect(code).toBe(EXIT.ok);
    expect(output.errText()).toContain('Nenhum arquivo para testar');
  });

  it('devolve o codigo interno quando a execucao erra', async () => {
    project = createDemoProject();
    // Um adapter inexistente faz o lote terminar como `errored`, nao `failed`.
    const config = JSON.parse(
      fs.readFileSync(project.path('livetest.config.json'), 'utf8'),
    ) as { runners: Record<string, Record<string, unknown>> };
    config.runners['js']!['adapter'] = 'inexistente';
    project.write('livetest.config.json', JSON.stringify(config));

    const { code } = await cli(['run', 'src/login.ts'], project.root);
    expect(code).toBe(EXIT.internal);
  });
});

describe('livetest why — imports nao resolvidos', () => {
  it('avisa que o grafo pode estar incompleto', async () => {
    project = createDemoProject();
    project.write(
      'src/dinamico.ts',
      'export const carregar = (n: string) => import(`./mod/${n}`);\n',
    );
    const { code, output } = await cli(['why', 'src/dinamico.ts'], project.root);
    expect(code).toBe(EXIT.ok);
    expect(output.outText()).toContain('imports nao resolvidos');
    expect(output.outText()).toContain('import dinamico');
  });

  it('lista os testes de um arquivo com varios impactados', async () => {
    project = createDemoProject();
    const { output } = await cli(['why', 'src/header.ts'], project.root);
    expect(output.outText()).toContain('arquivos impactados');
    expect(output.outText()).toContain('testes que rodariam');
  });
});

describe('livetest status — detalhes do ultimo lote', () => {
  it('lista os testes que falharam do ultimo lote', async () => {
    project = createDemoProject();
    // O snapshot em disco e a fonte que o comando usa quando nao ha daemon;
    // escreve-lo diretamente isola a formatacao do relatorio da execucao.
    project.write(
      '.livetest/status.json',
      JSON.stringify({
        pid: 1,
        root: project.root,
        version: '0.1.0',
        protocolVersion: 1,
        startedAt: 0,
        running: false,
        totals: { batches: 1, runs: 1, failedRuns: 1 },
        files: [],
        lastBatch: {
          batchId: 'batch-1',
          changedFiles: [],
          status: 'failed',
          counts: { total: 2, passed: 1, failed: 1, skipped: 0 },
          durationMs: 1200,
          startedAt: 0,
          finishedAt: 1200,
          unmatched: [],
          runs: [
            {
              runId: 'run-1',
              batchId: 'batch-1',
              runnerKey: 'js',
              adapterId: 'vitest',
              testFiles: [],
              command: '',
              status: 'failed',
              counts: { total: 2, passed: 1, failed: 1, skipped: 0 },
              durationMs: 1200,
              exitCode: 1,
              stdoutTail: [],
              stderrTail: [],
              error: null,
              reasons: {},
              cases: [
                { fullName: 'login passou', file: null, status: 'passed', durationMs: 1, failureMessages: [] },
                { fullName: 'login quebrou', file: null, status: 'failed', durationMs: 1, failureMessages: ['esperado true'] },
              ],
            },
          ],
        },
      }),
    );

    const { code, output } = await cli(['status'], project.root);
    expect(code).toBe(EXIT.testsFailed);
    expect(output.outText()).toContain('x login quebrou');
    expect(output.outText()).not.toContain('x login passou');
  });

  it('mostra os arquivos com estado diferente de idle', async () => {
    project = createDemoProject();
    await cli(['run', 'src/login.ts'], project.root);
    const { output } = await cli(['status'], project.root);
    expect(output.outText()).toContain('arquivos com estado:');
    expect(output.outText()).toContain('passed');
  });
});

describe('livetest start', () => {
  it('--once roda um lote e encerra com sucesso', async () => {
    project = createDemoProject('process.exit(0)');
    const { code } = await cli(['start', '--once'], project.root);
    expect(code).toBe(EXIT.ok);
  }, 60_000);

  it('--once devolve 1 quando os testes falham', async () => {
    project = createDemoProject('process.exit(1)');
    const { code } = await cli(['start', '--once'], project.root);
    expect(code).toBe(EXIT.testsFailed);
  }, 60_000);

  it('--no-server nao publica o arquivo de descoberta', async () => {
    project = createDemoProject();
    await cli(['start', '--once', '--no-server'], project.root);
    expect(fs.existsSync(project.path('.livetest/daemon.json'))).toBe(false);
  }, 60_000);

  it('--port liga o canal de eventos mesmo com o servidor desligado na config', async () => {
    project = createDemoProject();
    const output = captureOutput();
    const executando = runCli({
      argv: ['start', '--port', '0'],
      output,
      cwd: project.root,
    });

    try {
      await waitFor(() => fs.existsSync(project!.path('.livetest/daemon.json')));
      const descoberta = JSON.parse(
        fs.readFileSync(project.path('.livetest/daemon.json'), 'utf8'),
      ) as { port: number };
      expect(descoberta.port).toBeGreaterThan(0);
    } finally {
      // O comando so retorna quando recebe um sinal de parada.
      process.emit('SIGTERM');
      expect(await executando).toBe(EXIT.ok);
    }
  }, 60_000);

  it('encerra de forma limpa ao receber SIGINT', async () => {
    project = createDemoProject();
    const output = captureOutput();
    const executando = runCli({ argv: ['start'], output, cwd: project.root });

    await waitFor(() => fs.existsSync(project!.path('.livetest/status.json')));
    process.emit('SIGINT');
    expect(await executando).toBe(EXIT.ok);

    // Um segundo sinal apos o encerramento nao pode causar efeito.
    expect(() => process.emit('SIGINT')).not.toThrow();
  }, 60_000);
});

describe('waitForExit', () => {
  it('devolve true assim que o processo some', async () => {
    let vivo = true;
    setTimeout(() => {
      vivo = false;
    }, 120);
    await expect(waitForExit(1234, 5000, () => vivo)).resolves.toBe(true);
  });

  it('devolve true quando o processo ja estava morto', async () => {
    await expect(waitForExit(1234, 5000, () => false)).resolves.toBe(true);
  });

  it('devolve false quando o prazo acaba com o processo vivo', async () => {
    await expect(waitForExit(1234, 250, () => true)).resolves.toBe(false);
  });

  it('com prazo zero decide na hora, sem esperar', async () => {
    await expect(waitForExit(1234, 0, () => true)).resolves.toBe(false);
    await expect(waitForExit(1234, 0, () => false)).resolves.toBe(true);
  });

  it('usa o predicado real por padrao', async () => {
    await expect(waitForExit(process.pid, 0)).resolves.toBe(false);
  });
});

describe('livetest stop — sinal recusado', () => {
  it('reporta falha ao enviar o sinal', async () => {
    project = createDemoProject();
    // O pid 4 e do processo "System" no Windows e do kthreadd no Linux:
    // existe, mas nao pertence ao usuario do teste.
    project.write(
      '.livetest/daemon.json',
      JSON.stringify({
        pid: 4,
        host: '127.0.0.1',
        port: 1,
        root: project.root,
        version: '0.1.0',
        protocolVersion: 1,
        startedAt: 0,
      }),
    );

    const { code, output } = await cli(['stop', '--timeout', '100'], project.root);
    expect(code).toBe(EXIT.daemon);
    // Ou o sinal e recusado, ou o processo sobrevive: os dois sao falha de stop.
    expect(output.errText()).toMatch(/Nao foi possivel encerrar|ainda esta rodando/);
  }, 60_000);
});

describe('livetest watch — modos de saida', () => {
  it('--json imprime os eventos crus', async () => {
    project = createDemoProject();
    const output = captureOutput();

    // Servidor minimo que fala o protocolo do daemon.
    const net = await import('node:net');
    const servidor = net.createServer((socket) => {
      socket.write(
        `${JSON.stringify({
          type: 'snapshot',
          seq: 0,
          timestamp: 0,
          state: {
            pid: 1,
            root: project!.root,
            version: '0.1.0',
            protocolVersion: 1,
            startedAt: 0,
            running: false,
            lastBatch: null,
            files: [],
            totals: { batches: 0, runs: 0, failedRuns: 0 },
          },
        })}\n`,
      );
      socket.write(`${JSON.stringify({ type: 'daemon.stopped', seq: 1, timestamp: 0, reason: 'x' })}\n`);
      setTimeout(() => socket.end(), 100);
    });
    await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', () => resolve()));
    const { port } = servidor.address() as import('node:net').AddressInfo;

    project.write(
      '.livetest/daemon.json',
      JSON.stringify({
        pid: process.pid,
        host: '127.0.0.1',
        port,
        root: project.root,
        version: '0.1.0',
        protocolVersion: 1,
        startedAt: 0,
      }),
    );

    try {
      const code = await runCli({ argv: ['watch', '--json'], output, cwd: project.root });
      expect(code).toBe(EXIT.ok);
      const linhas = output.stdout.filter(Boolean);
      expect(JSON.parse(linhas[0] as string)).toMatchObject({ type: 'snapshot' });
      expect(JSON.parse(linhas[1] as string)).toMatchObject({ type: 'daemon.stopped' });
    } finally {
      await new Promise<void>((resolve) => servidor.close(() => resolve()));
    }
  }, 60_000);

  it('encerra ao receber SIGINT', async () => {
    project = createDemoProject();
    const net = await import('node:net');
    const servidor = net.createServer(() => {
      /* conexao aceita e mantida aberta */
    });
    await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', () => resolve()));
    const { port } = servidor.address() as import('node:net').AddressInfo;

    project.write(
      '.livetest/daemon.json',
      JSON.stringify({
        pid: process.pid,
        host: '127.0.0.1',
        port,
        root: project.root,
        version: '0.1.0',
        protocolVersion: 1,
        startedAt: 0,
      }),
    );

    const output = captureOutput();
    const observando = runCli({ argv: ['watch', '--no-color'], output, cwd: project.root });
    try {
      await waitFor(() => output.errText().includes('conectado em'));
      process.emit('SIGINT');
      expect(await observando).toBe(EXIT.ok);
    } finally {
      await new Promise<void>((resolve) => servidor.close(() => resolve()));
    }
  }, 60_000);
});

describe('confirmarEncerramento', () => {
  it('remove o registro e reporta sucesso quando o daemon sai', async () => {
    project = createDemoProject();
    project.write('.livetest/daemon.json', '{"pid":1}');
    const output = captureOutput();

    const code = await confirmarEncerramento({
      pid: 4321,
      timeoutMs: 100,
      output,
      discoveryFile: '.livetest/daemon.json',
      root: project.root,
      alive: () => false,
    });

    expect(code).toBe(EXIT.ok);
    expect(output.outText()).toBe('Daemon encerrado.');
    expect(fs.existsSync(project.path('.livetest/daemon.json'))).toBe(false);
  });

  it('nao tenta remover um registro que ja nao existe', async () => {
    project = createDemoProject();
    const output = captureOutput();

    const code = await confirmarEncerramento({
      pid: 4321,
      timeoutMs: 100,
      output,
      discoveryFile: '.livetest/daemon.json',
      root: project.root,
      alive: () => false,
    });

    expect(code).toBe(EXIT.ok);
  });

  it('reporta que o daemon continua vivo e preserva o registro', async () => {
    project = createDemoProject();
    project.write('.livetest/daemon.json', '{"pid":1}');
    const output = captureOutput();

    const code = await confirmarEncerramento({
      pid: 4321,
      timeoutMs: 150,
      output,
      discoveryFile: '.livetest/daemon.json',
      root: project.root,
      alive: () => true,
    });

    expect(code).toBe(EXIT.daemon);
    expect(output.errText()).toContain('ainda esta rodando');
    expect(output.errText()).toContain('--force');
    // O daemon continua de pe: apagar o registro deixaria a extensao cega.
    expect(fs.existsSync(project.path('.livetest/daemon.json'))).toBe(true);
  });
});

describe('livetest stop — prazo informado', () => {
  it('respeita o --timeout ao esperar o encerramento', async () => {
    project = createDemoProject();
    const { spawn } = await import('node:child_process');
    const filho = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });

    project.write(
      '.livetest/daemon.json',
      JSON.stringify({
        pid: filho.pid,
        host: '127.0.0.1',
        port: 1,
        root: project.root,
        version: '0.1.0',
        protocolVersion: 1,
        startedAt: 0,
      }),
    );

    try {
      const { code, output } = await cli(['stop', '--timeout', '5000'], project.root);
      expect(code).toBe(EXIT.ok);
      expect(output.outText()).toContain('Daemon encerrado.');
    } finally {
      filho.kill('SIGKILL');
    }
  }, 60_000);
});

describe('livetest status — daemon silencioso', () => {
  it('cai para o arquivo quando o daemon nao envia o snapshot', async () => {
    project = createDemoProject();
    await cli(['run', 'src/login.ts'], project.root);

    const net = await import('node:net');
    // Servidor que aceita a conexao e nunca fala: e o caso de um daemon travado.
    const mudo = net.createServer(() => {});
    await new Promise<void>((resolve) => mudo.listen(0, '127.0.0.1', () => resolve()));
    const { port } = mudo.address() as import('node:net').AddressInfo;

    project.write(
      '.livetest/daemon.json',
      JSON.stringify({
        pid: process.pid,
        host: '127.0.0.1',
        port,
        root: project.root,
        version: '0.1.0',
        protocolVersion: 1,
        startedAt: 0,
      }),
    );

    try {
      const { code, output } = await cli(['status'], project.root);
      expect(code).toBe(EXIT.ok);
      // Sem resposta do daemon, o comando usa o snapshot persistido.
      expect(output.outText()).toContain('fonte:     arquivo status.json');
    } finally {
      await new Promise<void>((resolve) => mudo.close(() => resolve()));
    }
  }, 60_000);

  it('mostra "rodando: sim" quando ha lote em andamento', async () => {
    project = createDemoProject();
    project.write(
      '.livetest/status.json',
      JSON.stringify({
        pid: 1,
        root: project.root,
        version: '0.1.0',
        protocolVersion: 1,
        startedAt: 0,
        running: true,
        lastBatch: null,
        files: [],
        totals: { batches: 0, runs: 0, failedRuns: 0 },
      }),
    );
    const { output } = await cli(['status'], project.root);
    expect(output.outText()).toContain('rodando:   sim');
  }, 60_000);

  it('falha quando o statusFile esta desabilitado e nao ha daemon', async () => {
    project = createDemoProject();
    const config = JSON.parse(
      fs.readFileSync(project.path('livetest.config.json'), 'utf8'),
    ) as { output: Record<string, unknown> };
    config.output['statusFile'] = null;
    project.write('livetest.config.json', JSON.stringify(config));

    const { code } = await cli(['status'], project.root);
    expect(code).toBe(EXIT.daemon);
  }, 60_000);
});
