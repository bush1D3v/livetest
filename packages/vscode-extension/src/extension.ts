/**
 * Camada de integracao com o VSCode.
 *
 * Este e o unico arquivo que importa a API do editor. Toda a logica de estado
 * vive em `src/model`, que e testada sem instancia de VSCode. O papel daqui e
 * traduzir: eventos do daemon viram itens de arvore, diagnosticos e linhas de
 * log; cliques viram comandos.
 *
 * Conforme a secao 4.3 do PRD, a extensao **nao sobe o daemon sozinha**: quando
 * nao encontra um em execucao, expoe o botao "Iniciar daemon", que abre um
 * terminal com o comando configurado.
 *
 * @packageDocumentation
 */

import * as vscode from 'vscode';

import {
  connectToDaemon,
  readDiscoveryFile,
  relativeToRoot,
  type LiveTestEvent,
} from '@livetest/core/client';

import {
  createDaemonConnection,
  type ConnectionState,
  type DaemonConnection,
} from './model/connection.js';
import { createTreeModel, type NodeStatus, type TreeModel, type TreeNode } from './model/tree.js';

/** Icone de cada status na arvore. */
const STATUS_ICON: Record<NodeStatus, { id: string; color?: string }> = {
  idle: { id: 'circle-outline' },
  running: { id: 'sync~spin', color: 'charts.blue' },
  passed: { id: 'pass-filled', color: 'testing.iconPassed' },
  failed: { id: 'error', color: 'testing.iconFailed' },
  errored: { id: 'warning', color: 'testing.iconErrored' },
  skipped: { id: 'circle-slash', color: 'testing.iconSkipped' },
};

/** Texto da barra de status por estado de conexao. */
const STATE_LABEL: Record<ConnectionState, string> = {
  desconectado: '$(debug-disconnect) livetest desconectado',
  conectando: '$(sync~spin) livetest conectando',
  conectado: '$(beaker) livetest',
  'sem-daemon': '$(circle-slash) livetest parado',
};

/** Provedor de dados da arvore de arquivos. */
class FilesTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly model: TreeModel) {}

  /** Solicita novo render da arvore inteira. */
  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const collapsible =
      node.children.length > 0
        ? node.kind === 'diretorio'
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

    const item = new vscode.TreeItem(node.label, collapsible);
    item.id = node.id;
    item.description = node.description;
    item.tooltip = new vscode.MarkdownString(['```text', node.tooltip, '```'].join('\n'));
    item.contextValue = node.kind === 'arquivo' ? 'livetest.file' : `livetest.${node.kind}`;

    const icon = STATUS_ICON[node.status];
    item.iconPath = new vscode.ThemeIcon(
      icon.id,
      icon.color ? new vscode.ThemeColor(icon.color) : undefined,
    );

    // Apenas diretorios ficam sem caminho: a presenca dele ja distingue os nos
    // que abrem um arquivo no editor.
    if (node.path) {
      item.resourceUri = vscode.Uri.file(node.path);
      item.command = {
        command: 'vscode.open',
        title: 'Abrir arquivo',
        arguments: [vscode.Uri.file(node.path)],
      };
    }
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    return node ? node.children : this.model.roots();
  }
}

/** Estado vivo da extensao, montado em `activate`. */
interface ExtensionRuntime {
  root: string;
  model: TreeModel;
  provider: FilesTreeProvider;
  connection: DaemonConnection;
  statusBar: vscode.StatusBarItem;
  output: vscode.OutputChannel;
  diagnostics: vscode.DiagnosticCollection;
}

/** Le as configuracoes da extensao. */
function readSettings() {
  const config = vscode.workspace.getConfiguration('livetest');
  return {
    discoveryFile: config.get<string>('discoveryFile', '.livetest/daemon.json'),
    startCommand: config.get<string>('startCommand', 'npx livetest start'),
    reconnectIntervalMs: config.get<number>('reconnectIntervalMs', 3000),
    revealFailures: config.get<boolean>('revealFailures', true),
  };
}

/** Escreve uma linha carimbada no canal de log. */
function log(output: vscode.OutputChannel, message: string): void {
  output.appendLine(`${new Date().toISOString().slice(11, 19)}  ${message}`);
}

/** Registra no log o que o daemon reportou, em formato legivel. */
function logEvent(runtime: ExtensionRuntime, event: LiveTestEvent): void {
  const rel = (file: string): string => relativeToRoot(runtime.root, file);

  switch (event.type) {
    case 'batch.started':
      log(
        runtime.output,
        `lote ${event.batchId} (${event.trigger}): ${event.changedFiles.map(rel).join(', ')}`,
      );
      for (const entry of event.plan) {
        log(runtime.output, `  ${entry.runnerKey}: ${entry.testFiles.map(rel).join(', ')}`);
      }
      for (const item of event.unmatched) log(runtime.output, `  sem teste: ${item.reason}`);
      break;
    case 'run.finished': {
      const { result } = event;
      log(
        runtime.output,
        `  ${result.status.toUpperCase()} ${result.runnerKey}: ` +
          `${result.counts.passed} passou, ${result.counts.failed} falhou ` +
          `(${Math.round(result.durationMs)}ms)`,
      );
      for (const testCase of result.cases) {
        if (testCase.status !== 'failed') continue;
        log(runtime.output, `    x ${testCase.fullName}`);
        for (const message of testCase.failureMessages) {
          for (const line of message.split('\n').slice(0, 6)) log(runtime.output, `      ${line}`);
        }
      }
      if (result.error) log(runtime.output, `    erro: ${result.error}`);
      break;
    }
    case 'batch.finished':
      log(
        runtime.output,
        `lote ${event.result.batchId} ${event.result.status} em ` +
          `${Math.round(event.result.durationMs)}ms`,
      );
      break;
    case 'error':
      log(runtime.output, `aviso [${event.scope}] ${event.message}`);
      break;
    default:
      break;
  }
}

/** Publica as falhas como diagnosticos no editor. */
function publishDiagnostics(runtime: ExtensionRuntime, event: LiveTestEvent): void {
  if (event.type !== 'run.finished') return;

  for (const testFile of event.result.testFiles) {
    const entry = runtime.model.entry(testFile);
    const uri = vscode.Uri.file(testFile);

    if (!entry || entry.failures.length === 0) {
      runtime.diagnostics.delete(uri);
      continue;
    }
    runtime.diagnostics.set(
      uri,
      entry.failures.map((failure) => {
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0),
          `${failure.name}\n${failure.message}`.trim(),
          vscode.DiagnosticSeverity.Error,
        );
        diagnostic.source = 'livetest';
        return diagnostic;
      }),
    );
  }
}

/** Atualiza barra de status e contexto de menus. */
function applyState(runtime: ExtensionRuntime, state: ConnectionState, detail: string | null): void {
  runtime.statusBar.text = STATE_LABEL[state];
  runtime.statusBar.tooltip =
    state === 'sem-daemon'
      ? 'Nenhum daemon do Live Test Runner em execucao. Clique para iniciar.'
      : (detail ?? 'Live Test Runner');
  runtime.statusBar.command =
    state === 'conectado' ? 'livetest.showLog' : 'livetest.startDaemon';

  void vscode.commands.executeCommand('setContext', 'livetest.connected', state === 'conectado');

  if (state !== 'conectado') {
    runtime.model.clear();
    runtime.diagnostics.clear();
  }
  runtime.provider.refresh();
  log(runtime.output, `conexao: ${state}${detail ? ` (${detail})` : ''}`);
}

/** Ponto de entrada da extensao. */
export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const root = folder.uri.fsPath.replace(/\\/g, '/');
  const settings = readSettings();

  const output = vscode.window.createOutputChannel('Live Test Runner');
  const diagnostics = vscode.languages.createDiagnosticCollection('livetest');
  const model = createTreeModel({ root });
  const provider = new FilesTreeProvider(model);
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  const runtime: ExtensionRuntime = {
    root,
    model,
    provider,
    statusBar,
    output,
    diagnostics,
    connection: undefined as unknown as DaemonConnection,
  };

  runtime.connection = createDaemonConnection({
    reconnectIntervalMs: settings.reconnectIntervalMs,
    connect: (handlers) =>
      connectToDaemon({
        root,
        discoveryFile: settings.discoveryFile,
        onEvent: handlers.onEvent,
        onClose: handlers.onClose,
      }),
    onStateChange: (state, detail) => applyState(runtime, state, detail),
    onEvent: (event) => {
      model.apply(event);
      logEvent(runtime, event);
      if (settings.revealFailures) publishDiagnostics(runtime, event);
      provider.refresh();
    },
  });

  const tree = vscode.window.createTreeView('livetest.files', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  statusBar.show();
  applyState(runtime, 'desconectado', null);
  void runtime.connection.connect();

  context.subscriptions.push(
    tree,
    statusBar,
    output,
    diagnostics,
    { dispose: () => runtime.connection.dispose() },

    vscode.commands.registerCommand('livetest.connect', () => runtime.connection.connect()),
    vscode.commands.registerCommand('livetest.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('livetest.showLog', () => output.show(true)),

    vscode.commands.registerCommand('livetest.startDaemon', () => {
      // O PRD e explicito: a extensao nao inicia o daemon automaticamente.
      // Abrimos um terminal com o comando para que a acao seja do usuario.
      const terminal =
        vscode.window.terminals.find((t) => t.name === 'Live Test Runner') ??
        vscode.window.createTerminal({ name: 'Live Test Runner', cwd: folder.uri });
      terminal.show(true);
      terminal.sendText(settings.startCommand);
      // Da tempo do daemon subir e publicar o arquivo de descoberta.
      setTimeout(() => void runtime.connection.connect(), 2000);
    }),

    vscode.commands.registerCommand('livetest.stopDaemon', async () => {
      const discovery = readDiscoveryFile(settings.discoveryFile, root);
      if (discovery.status !== 'running') {
        void vscode.window.showInformationMessage('Nenhum daemon do Live Test Runner em execucao.');
        return;
      }
      try {
        process.kill(discovery.info.pid, 'SIGTERM');
        runtime.connection.disconnect();
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Nao foi possivel encerrar o daemon: ${(error as Error).message}`,
        );
      }
    }),

    vscode.commands.registerCommand('livetest.runFile', (node?: TreeNode) => {
      const target = node?.path ?? vscode.window.activeTextEditor?.document.uri.fsPath;
      if (!target) return;
      const terminal =
        vscode.window.terminals.find((t) => t.name === 'Live Test Runner') ??
        vscode.window.createTerminal({ name: 'Live Test Runner', cwd: folder.uri });
      terminal.show(true);
      terminal.sendText(`npx livetest run ${JSON.stringify(relativeToRoot(root, target))}`);
    }),
  );
}

/** Chamado pelo VSCode ao desativar a extensao. */
export function deactivate(): void {
  // Tudo que precisa de limpeza foi registrado em `context.subscriptions`.
}
