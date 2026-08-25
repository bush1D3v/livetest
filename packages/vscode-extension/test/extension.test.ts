/**
 * Testes da camada de integracao com o VSCode.
 *
 * O modulo `vscode` e substituido pelo mock em `test/mocks/vscode.ts` (ver
 * `vitest.config.ts`). Os testes exercitam o que a extensao realmente faz:
 * registrar comandos, montar itens de arvore, publicar diagnosticos e reagir
 * ao estado da conexao com o daemon.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DaemonSnapshot, LiveTestEvent } from '@livetest/core/client';

import { activate, deactivate } from '../src/extension.js';
import type { TreeNode } from '../src/model/tree.js';
import {
  Uri,
  estado,
  executarComando,
  resetVscodeMock,
  type TreeItem,
} from './mocks/vscode.js';

/** Assinaturas registradas em `context.subscriptions`. */
interface Subscription {
  dispose(): void;
}

/** Contexto de extensao minimo. */
function criarContexto(): { subscriptions: Subscription[] } {
  return { subscriptions: [] };
}

let raiz = '';
let contexto = criarContexto();

/** Provedor de arvore registrado pela extensao. */
interface Provider {
  getTreeItem(node: TreeNode): TreeItem;
  getChildren(node?: TreeNode): TreeNode[];
  onDidChangeTreeData: (listener: (node: TreeNode | undefined) => void) => unknown;
}

const provider = (): Provider => estado.arvores[0]?.provider as Provider;
const canal = () => estado.canais[0]!;
const barra = () => estado.barras[0]!;
const diagnosticos = () => estado.diagnosticos[0]!;

beforeEach(() => {
  resetVscodeMock();
  raiz = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'livetest-ext-'))).replace(/\\/g, '/');
  estado.pastas = [{ uri: Uri.file(raiz) }];
  contexto = criarContexto();
});

afterEach(() => {
  for (const item of contexto.subscriptions) item.dispose();
  deactivate();
  fs.rmSync(raiz, { recursive: true, force: true });
});

/** Aguarda ate a condicao valer. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > limite) throw new Error('condicao nao satisfeita a tempo');
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

/** Snapshot minimo para o daemon falso. */
function snapshot(files: DaemonSnapshot['files'] = []): DaemonSnapshot {
  return {
    pid: process.pid,
    root: raiz,
    version: '0.1.0',
    protocolVersion: 1,
    startedAt: 0,
    running: false,
    lastBatch: null,
    files,
    totals: { batches: 0, runs: 0, failedRuns: 0 },
  };
}

/** Sobe um daemon falso e publica o arquivo de descoberta. */
async function daemonFalso(eventos: LiveTestEvent[] = []) {
  const conexoes: net.Socket[] = [];
  const servidor = net.createServer((socket) => {
    conexoes.push(socket);
    for (const evento of eventos) socket.write(`${JSON.stringify(evento)}\n`);
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', () => resolve()));
  const { port } = servidor.address() as net.AddressInfo;

  fs.mkdirSync(path.join(raiz, '.livetest'), { recursive: true });
  fs.writeFileSync(
    path.join(raiz, '.livetest', 'daemon.json'),
    JSON.stringify({
      pid: process.pid,
      host: '127.0.0.1',
      port,
      root: raiz,
      version: '0.1.0',
      protocolVersion: 1,
      startedAt: 0,
    }),
  );

  return {
    servidor,
    /** Envia um evento a todos os clientes conectados. */
    emitir: (evento: LiveTestEvent) => {
      for (const socket of conexoes) socket.write(`${JSON.stringify(evento)}\n`);
    },
    fechar: async () => {
      for (const socket of conexoes) socket.destroy();
      await new Promise<void>((resolve) => servidor.close(() => resolve()));
    },
  };
}

describe('activate — sem workspace', () => {
  it('nao registra nada quando nenhuma pasta esta aberta', () => {
    estado.pastas = undefined;
    activate(contexto as never);
    expect(estado.arvores).toHaveLength(0);
    expect(estado.comandos.size).toBe(0);
  });
});

describe('activate — montagem', () => {
  it('registra a arvore, a barra de status e os comandos', () => {
    activate(contexto as never);

    expect(estado.arvores[0]?.id).toBe('livetest.files');
    expect(barra().visible).toBe(true);
    expect([...estado.comandos.keys()].sort()).toEqual([
      'livetest.connect',
      'livetest.refresh',
      'livetest.runFile',
      'livetest.showLog',
      'livetest.startDaemon',
      'livetest.stopDaemon',
    ]);
    expect(canal().name).toBe('Live Test Runner');
  });

  it('sem daemon, oferece o botao de iniciar', async () => {
    activate(contexto as never);
    await waitFor(() => barra().text.includes('parado'));

    expect(barra().command).toBe('livetest.startDaemon');
    expect(barra().tooltip).toContain('Clique para iniciar');
    expect(estado.contextos).toContainEqual(['livetest.connected', false]);
  });

  it('registra a mudanca de estado no log', async () => {
    activate(contexto as never);
    await waitFor(() => canal().lines.some((l) => l.includes('conexao: sem-daemon')));
    expect(canal().lines[0]).toContain('conexao: desconectado');
  });
});

describe('conexao com um daemon em execucao', () => {
  it('conecta, renderiza a arvore e marca o contexto', async () => {
    const daemon = await daemonFalso([
      {
        type: 'snapshot',
        seq: 0,
        timestamp: 0,
        state: snapshot([
          {
            path: `${raiz}/src/login.test.ts`,
            relativePath: 'src/login.test.ts',
            status: 'passed',
            updatedAt: 0,
            reason: null,
            lastRunId: null,
            counts: { passed: 2, failed: 0, skipped: 0 },
          },
        ]),
      },
    ]);

    try {
      activate(contexto as never);
      await waitFor(() => barra().text === '$(beaker) livetest');

      expect(estado.contextos).toContainEqual(['livetest.connected', true]);
      expect(barra().command).toBe('livetest.showLog');

      const raizes = provider().getChildren();
      expect(raizes[0]?.label).toBe('src');
      // Expandir um no pede os filhos daquele no, nao as raizes.
      const filhos = provider().getChildren(raizes[0]);
      expect(filhos[0]?.label).toBe('login.test.ts');
      expect(provider().getChildren(filhos[0])).toEqual([]);
    } finally {
      await daemon.fechar();
    }
  }, 30_000);

  it('limpa a arvore quando a conexao cai', async () => {
    const daemon = await daemonFalso([
      { type: 'snapshot', seq: 0, timestamp: 0, state: snapshot() },
    ]);

    try {
      activate(contexto as never);
      await waitFor(() => barra().text === '$(beaker) livetest');
      await daemon.fechar();
      await waitFor(() => barra().text.includes('desconectado'));
      expect(provider().getChildren()).toEqual([]);
    } finally {
      await daemon.fechar();
    }
  }, 30_000);
});

describe('itens da arvore', () => {
  /** Um lote que termina com uma falha, para popular a arvore. */
  const eventosDeFalha = (): LiveTestEvent[] => [
    { type: 'snapshot', seq: 0, timestamp: 0, state: snapshot() },
    {
      type: 'batch.started',
      seq: 1,
      timestamp: 0,
      batchId: 'batch-1',
      changedFiles: [`${raiz}/src/login.ts`],
      trigger: 'idle',
      plan: [
        {
          runnerKey: 'js',
          adapterId: 'vitest',
          testFiles: [`${raiz}/src/header.test.ts`],
          reasons: {
            [`${raiz}/src/header.test.ts`]: [
              {
                kind: 'importer',
                changedFile: `${raiz}/src/login.ts`,
                sourceFile: `${raiz}/src/header.ts`,
                depth: 1,
                chain: [`${raiz}/src/login.ts`, `${raiz}/src/header.ts`],
              },
            ],
          },
        },
      ],
      unmatched: [{ file: `${raiz}/src/orfao.ts`, reason: 'sem teste' }],
    },
    {
      type: 'run.finished',
      seq: 2,
      timestamp: 0,
      result: {
        runId: 'run-1',
        batchId: 'batch-1',
        runnerKey: 'js',
        adapterId: 'vitest',
        testFiles: [`${raiz}/src/header.test.ts`],
        command: 'npx vitest run',
        status: 'failed',
        counts: { total: 1, passed: 0, failed: 1, skipped: 0 },
        durationMs: 900,
        exitCode: 1,
        stdoutTail: [],
        stderrTail: [],
        error: null,
        reasons: {},
        cases: [
          {
            fullName: 'header renderiza',
            file: `${raiz}/src/header.test.ts`,
            status: 'failed',
            durationMs: 4,
            failureMessages: ['esperado "a", recebido "b"'],
          },
        ],
      },
    },
    {
      type: 'batch.finished',
      seq: 3,
      timestamp: 0,
      result: {
        batchId: 'batch-1',
        changedFiles: [`${raiz}/src/login.ts`],
        runs: [],
        status: 'failed',
        counts: { total: 1, passed: 0, failed: 1, skipped: 0 },
        durationMs: 950,
        startedAt: 0,
        finishedAt: 950,
        unmatched: [],
      },
    },
  ];

  it('monta diretorio, arquivo e caso falho com icone e tooltip', async () => {
    const daemon = await daemonFalso(eventosDeFalha());
    try {
      activate(contexto as never);
      await waitFor(() => provider().getChildren().length > 0);
      await waitFor(() => (provider().getChildren()[0]?.children.length ?? 0) > 0);

      const diretorio = provider().getChildren()[0]!;
      const itemDiretorio = provider().getTreeItem(diretorio);
      expect(itemDiretorio.label).toBe('src');
      expect(itemDiretorio.collapsibleState).toBe(2);
      expect(itemDiretorio.contextValue).toBe('livetest.diretorio');
      expect(itemDiretorio.description).toBe('1 com falha');
      expect(itemDiretorio.resourceUri).toBeUndefined();
      expect(itemDiretorio.command).toBeUndefined();

      const arquivo = diretorio.children[0]!;
      const itemArquivo = provider().getTreeItem(arquivo);
      expect(itemArquivo.contextValue).toBe('livetest.file');
      expect(itemArquivo.collapsibleState).toBe(1);
      expect(itemArquivo.command?.command).toBe('vscode.open');
      expect(String((itemArquivo.tooltip as { value: string }).value)).toContain(
        'rodou porque src/header.ts importa src/login.ts',
      );

      const caso = arquivo.children[0]!;
      const itemCaso = provider().getTreeItem(caso);
      expect(itemCaso.label).toBe('header renderiza');
      expect(itemCaso.collapsibleState).toBe(0);
      expect(itemCaso.contextValue).toBe('livetest.caso');
    } finally {
      await daemon.fechar();
    }
  }, 30_000);

  it('publica as falhas como diagnosticos', async () => {
    const daemon = await daemonFalso(eventosDeFalha());
    try {
      activate(contexto as never);
      await waitFor(() => diagnosticos().entries.size > 0);

      const lista = diagnosticos().entries.get(`${raiz}/src/header.test.ts`);
      expect(lista).toHaveLength(1);
      expect(lista?.[0]?.source).toBe('livetest');
      expect(lista?.[0]?.message).toContain('header renderiza');
    } finally {
      await daemon.fechar();
    }
  }, 30_000);

  it('registra o lote e as falhas no log', async () => {
    const daemon = await daemonFalso(eventosDeFalha());
    try {
      activate(contexto as never);
      await waitFor(() => canal().lines.some((l) => l.includes('lote batch-1 failed')));

      const texto = canal().lines.join('\n');
      expect(texto).toContain('lote batch-1 (idle): src/login.ts');
      expect(texto).toContain('js: src/header.test.ts');
      expect(texto).toContain('sem teste: sem teste');
      expect(texto).toContain('FAILED js: 0 passou, 1 falhou');
      expect(texto).toContain('x header renderiza');
      expect(texto).toContain('esperado "a", recebido "b"');
    } finally {
      await daemon.fechar();
    }
  }, 30_000);
});

describe('comandos', () => {
  it('startDaemon abre um terminal com o comando configurado', async () => {
    activate(contexto as never);
    await executarComando('livetest.startDaemon');

    expect(estado.terminais).toHaveLength(1);
    expect(estado.terminais[0]?.name).toBe('Live Test Runner');
    expect(estado.terminais[0]?.sent).toEqual(['npx livetest start']);
    expect(estado.terminais[0]?.shown).toBe(1);
  });

  it('startDaemon respeita o comando customizado e reaproveita o terminal', async () => {
    estado.configuracao['startCommand'] = 'pnpm livetest start';
    activate(contexto as never);

    await executarComando('livetest.startDaemon');
    await executarComando('livetest.startDaemon');

    expect(estado.terminais).toHaveLength(1);
    expect(estado.terminais[0]?.sent).toEqual([
      'pnpm livetest start',
      'pnpm livetest start',
    ]);
  });

  it('showLog abre o canal de log', async () => {
    activate(contexto as never);
    await executarComando('livetest.showLog');
    expect(canal().shown).toBe(1);
  });

  it('refresh redesenha a arvore', async () => {
    activate(contexto as never);
    let redesenhos = 0;
    provider().onDidChangeTreeData(() => {
      redesenhos++;
    });
    const antes = redesenhos;
    await executarComando('livetest.refresh');
    // A tentativa de conexao tambem redesenha; o que importa e o incremento.
    expect(redesenhos).toBeGreaterThan(antes);
  });

  it('connect forca uma nova tentativa', async () => {
    activate(contexto as never);
    await waitFor(() => barra().text.includes('parado'));
    await expect(executarComando('livetest.connect')).resolves.toBeUndefined();
  });

  it('stopDaemon avisa quando nao ha daemon', async () => {
    activate(contexto as never);
    await executarComando('livetest.stopDaemon');
    expect(estado.informacoes[0]).toContain('Nenhum daemon');
  });

  it('stopDaemon encerra o daemon encontrado', async () => {
    const filho = (await import('node:child_process')).spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { stdio: 'ignore', windowsHide: true },
    );
    fs.mkdirSync(path.join(raiz, '.livetest'), { recursive: true });
    fs.writeFileSync(
      path.join(raiz, '.livetest', 'daemon.json'),
      JSON.stringify({
        pid: filho.pid,
        host: '127.0.0.1',
        port: 1,
        root: raiz,
        version: '0.1.0',
        protocolVersion: 1,
        startedAt: 0,
      }),
    );

    try {
      activate(contexto as never);
      await executarComando('livetest.stopDaemon');
      expect(estado.erros).toEqual([]);
      expect(barra().text).toContain('desconectado');
    } finally {
      filho.kill('SIGKILL');
    }
  }, 30_000);

  it('stopDaemon reporta falha ao encerrar', async () => {
    fs.mkdirSync(path.join(raiz, '.livetest'), { recursive: true });
    fs.writeFileSync(
      path.join(raiz, '.livetest', 'daemon.json'),
      JSON.stringify({
        // Pid do processo "System": existe, mas nao pode ser encerrado por nos.
        pid: 4,
        host: '127.0.0.1',
        port: 1,
        root: raiz,
        version: '0.1.0',
        protocolVersion: 1,
        startedAt: 0,
      }),
    );

    activate(contexto as never);
    await executarComando('livetest.stopDaemon');
    expect(estado.erros[0]).toContain('Nao foi possivel encerrar o daemon');
  }, 30_000);

  it('runFile usa o arquivo do no clicado', async () => {
    activate(contexto as never);
    await executarComando('livetest.runFile', {
      id: 'file:x',
      kind: 'arquivo',
      label: 'login.ts',
      description: '',
      tooltip: '',
      status: 'idle',
      path: `${raiz}/src/login.ts`,
      children: [],
    });
    expect(estado.terminais[0]?.sent[0]).toBe('npx livetest run "src/login.ts"');
  });

  it('runFile cai para o editor ativo quando nao ha no', async () => {
    estado.editorAtivo = { document: { uri: Uri.file(`${raiz}/src/outro.ts`) } };
    activate(contexto as never);
    await executarComando('livetest.runFile');
    expect(estado.terminais[0]?.sent[0]).toBe('npx livetest run "src/outro.ts"');
  });

  it('runFile nao faz nada sem no nem editor ativo', async () => {
    activate(contexto as never);
    await executarComando('livetest.runFile');
    expect(estado.terminais).toHaveLength(0);
  });
});

describe('detalhes do relatorio e dos icones', () => {
  it('usa icone sem cor para arquivo ainda nao executado', async () => {
    const daemon = await daemonFalso([
      {
        type: 'snapshot',
        seq: 0,
        timestamp: 0,
        state: snapshot([
          {
            path: `${raiz}/src/parado.ts`,
            relativePath: 'src/parado.ts',
            status: 'idle',
            updatedAt: 0,
            reason: null,
            lastRunId: null,
            counts: null,
          },
        ]),
      },
    ]);

    try {
      activate(contexto as never);
      await waitFor(() => provider().getChildren().length > 0);

      const arquivo = provider().getChildren()[0]!.children[0]!;
      const item = provider().getTreeItem(arquivo);
      expect((item.iconPath as { id: string }).id).toBe('circle-outline');
      expect((item.iconPath as { color?: unknown }).color).toBeUndefined();
    } finally {
      await daemon.fechar();
    }
  }, 30_000);

  it('registra apenas os casos falhos e o erro do runner', async () => {
    const daemon = await daemonFalso([
      { type: 'snapshot', seq: 0, timestamp: 0, state: snapshot() },
      {
        type: 'run.finished',
        seq: 1,
        timestamp: 0,
        result: {
          runId: 'run-1',
          batchId: 'batch-1',
          runnerKey: 'js',
          adapterId: 'vitest',
          testFiles: [`${raiz}/src/a.test.ts`],
          command: 'npx vitest run',
          status: 'errored',
          counts: { total: 2, passed: 1, failed: 1, skipped: 0 },
          durationMs: 10,
          exitCode: 1,
          stdoutTail: [],
          stderrTail: [],
          error: 'vitest nao encontrado',
          reasons: {},
          cases: [
            {
              fullName: 'passou',
              file: `${raiz}/src/a.test.ts`,
              status: 'passed',
              durationMs: 1,
              failureMessages: [],
            },
            {
              fullName: 'falhou',
              file: `${raiz}/src/a.test.ts`,
              status: 'failed',
              durationMs: 1,
              failureMessages: ['boom'],
            },
          ],
        },
      },
    ]);

    try {
      activate(contexto as never);
      await waitFor(() => canal().lines.some((l) => l.includes('erro: vitest nao encontrado')));

      const texto = canal().lines.join('\n');
      expect(texto).toContain('x falhou');
      expect(texto).not.toContain('x passou');
    } finally {
      await daemon.fechar();
    }
  }, 30_000);

  it('registra avisos de degradacao do daemon', async () => {
    const daemon = await daemonFalso([
      { type: 'snapshot', seq: 0, timestamp: 0, state: snapshot() },
      {
        type: 'error',
        seq: 1,
        timestamp: 0,
        scope: 'graph:python',
        message: 'interpretador indisponivel',
        detail: null,
        degradedTo: 'analise por regex',
      },
    ]);

    try {
      activate(contexto as never);
      await waitFor(() => canal().lines.some((l) => l.includes('[graph:python]')));
      expect(canal().lines.join('\n')).toContain('aviso [graph:python] interpretador indisponivel');
    } finally {
      await daemon.fechar();
    }
  }, 30_000);

  it('limpa os diagnosticos de um arquivo que voltou a passar', async () => {
    const daemon = await daemonFalso([{ type: 'snapshot', seq: 0, timestamp: 0, state: snapshot() }]);

    try {
      activate(contexto as never);
      await waitFor(() => barra().text === '$(beaker) livetest');

      const runPassou: LiveTestEvent = {
        type: 'run.finished',
        seq: 1,
        timestamp: 0,
        result: {
          runId: 'run-1',
          batchId: 'batch-1',
          runnerKey: 'js',
          adapterId: 'vitest',
          testFiles: [`${raiz}/src/a.test.ts`],
          command: '',
          status: 'passed',
          counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
          durationMs: 5,
          exitCode: 0,
          stdoutTail: [],
          stderrTail: [],
          error: null,
          reasons: {},
          cases: [],
        },
      };
      daemon.emitir(runPassou);

      await waitFor(() => canal().lines.some((l) => l.includes('PASSED js')));
      expect(diagnosticos().entries.has(`${raiz}/src/a.test.ts`)).toBe(false);
    } finally {
      await daemon.fechar();
    }
  }, 30_000);

  it('nao publica diagnosticos quando revealFailures esta desligado', async () => {
    estado.configuracao['revealFailures'] = false;
    const daemon = await daemonFalso([
      { type: 'snapshot', seq: 0, timestamp: 0, state: snapshot() },
      {
        type: 'run.finished',
        seq: 1,
        timestamp: 0,
        result: {
          runId: 'run-1',
          batchId: 'batch-1',
          runnerKey: 'js',
          adapterId: 'vitest',
          testFiles: [`${raiz}/src/a.test.ts`],
          command: '',
          status: 'failed',
          counts: { total: 1, passed: 0, failed: 1, skipped: 0 },
          durationMs: 5,
          exitCode: 1,
          stdoutTail: [],
          stderrTail: [],
          error: null,
          reasons: {},
          cases: [
            {
              fullName: 'falhou',
              file: `${raiz}/src/a.test.ts`,
              status: 'failed',
              durationMs: 1,
              failureMessages: ['boom'],
            },
          ],
        },
      },
    ]);

    try {
      activate(contexto as never);
      await waitFor(() => canal().lines.some((l) => l.includes('FAILED js')));
      expect(diagnosticos().entries.size).toBe(0);
    } finally {
      await daemon.fechar();
    }
  }, 30_000);
});
