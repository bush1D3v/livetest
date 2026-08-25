/**
 * Testes do caminho "daemon em execucao": o mesmo que a extensao do VSCode usa.
 *
 * Em vez de criar um processo, subimos o motor no proprio processo de teste com
 * o canal de eventos ligado — o que exercita servidor, arquivo de descoberta e
 * cliente exatamente como em producao.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createEngine, loadConfig, type LiveTestEngine } from '@livetest/core';

import { runCli } from '../src/cli.js';
import { EXIT } from '../src/context.js';
import { captureOutput, createDemoProject, type TempProject } from './helpers/harness.js';

let project: TempProject | null = null;
let engine: LiveTestEngine | null = null;

afterEach(async () => {
  await engine?.stop('fim do teste');
  engine = null;
  project?.cleanup();
  project = null;
});

/** Sobe um daemon com canal de eventos no projeto temporario. */
async function startDaemon(script = 'process.exit(0)') {
  project = createDemoProject(script);
  const { config } = await loadConfig({
    cwd: project.root,
    overrides: { server: { enabled: true, host: '127.0.0.1', port: 0 } },
  });
  engine = createEngine({ config });
  const started = await engine.start();
  return { engine, started, project };
}

async function cli(argv: string[], cwd: string) {
  const output = captureOutput();
  const code = await runCli({ argv, output, cwd });
  return { code, output };
}

describe('status com daemon em execucao', () => {
  it('le o snapshot pelo canal de eventos', async () => {
    const { project: proj } = await startDaemon();
    const { code, output } = await cli(['status'], proj.root);

    expect(code).toBe(EXIT.ok);
    expect(output.outText()).toContain('fonte:     daemon em execucao');
    expect(output.outText()).toContain('rodando:   nao');
  }, 30_000);

  it('reflete o resultado de um lote executado pelo daemon', async () => {
    const { engine: e, project: proj } = await startDaemon();
    await e.runFiles([proj.path('src/login.ts')]);

    const { output } = await cli(['status'], proj.root);
    expect(output.outText()).toContain('ultimo lote');
    expect(output.outText()).toContain('passed');
  }, 30_000);

  it('--json devolve o snapshot vindo do daemon', async () => {
    const { engine: e, project: proj } = await startDaemon();
    await e.runFiles([proj.path('src/login.ts')]);

    const { output } = await cli(['status', '--json'], proj.root);
    const snapshot = JSON.parse(output.outText()) as {
      pid: number;
      totals: { batches: number };
    };
    expect(snapshot.pid).toBe(process.pid);
    expect(snapshot.totals.batches).toBe(1);
  }, 30_000);
});

describe('stop com daemon em execucao', () => {
  it('encontra o daemon pelo arquivo de descoberta', async () => {
    const { project: proj } = await startDaemon();
    // Nao enviamos o sinal de verdade (mataria o processo de teste): apenas
    // conferimos que o daemon foi localizado e que o registro esta correto.
    const { output } = await cli(['status'], proj.root);
    expect(output.outText()).toContain(`pid:       ${process.pid}`);
  }, 30_000);
});

describe('watch com daemon em execucao', () => {
  it('conecta, recebe o snapshot e encerra quando o daemon cai', async () => {
    const { engine: e, project: proj } = await startDaemon();
    const output = captureOutput();

    const watching = runCli({ argv: ['watch'], output, cwd: proj.root });
    // Da tempo de a conexao completar antes de derrubar o daemon.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await e.stop('encerrando para o teste');
    engine = null;

    expect(await watching).toBe(EXIT.ok);
    expect(output.outText()).toContain('livetest conectado a');
    expect(output.errText()).toContain('conectado em 127.0.0.1:');
  }, 30_000);

  it('falha com codigo de daemon quando nao ha daemon', async () => {
    project = createDemoProject();
    const { code, output } = await cli(['watch'], project.root);
    expect(code).toBe(EXIT.daemon);
    expect(output.errText()).toContain('nenhum daemon em execucao');
  }, 30_000);
});
