/**
 * Implementacao minima da API do VSCode usada pela extensao.
 *
 * O `vitest.config.ts` aponta o especificador `vscode` para este arquivo. Isso
 * permite testar `src/extension.ts` — a camada que traduz eventos do daemon em
 * itens de arvore, diagnosticos e comandos — sem baixar e subir um editor.
 *
 * O mock e deliberadamente burro: guarda o que foi criado e registrado para que
 * o teste inspecione, e nada mais.
 */

/** Estados de expansao de um item de arvore. */
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;

/** Alinhamentos da barra de status. */
export const StatusBarAlignment = { Left: 1, Right: 2 } as const;

/** Severidades de diagnostico. */
export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;

/** Item de arvore. */
export class TreeItem {
  id?: string;
  description?: string;
  tooltip?: unknown;
  contextValue?: string;
  iconPath?: unknown;
  resourceUri?: unknown;
  command?: { command: string; title: string; arguments?: unknown[] };

  constructor(
    public label: string,
    public collapsibleState: number,
  ) {}
}

/** Texto em markdown. */
export class MarkdownString {
  constructor(public value: string) {}
}

/** Icone tematico. */
export class ThemeIcon {
  constructor(
    public id: string,
    public color?: ThemeColor,
  ) {}
}

/** Cor tematica. */
export class ThemeColor {
  constructor(public id: string) {}
}

/** Intervalo em um documento. */
export class Range {
  constructor(
    public startLine: number,
    public startCharacter: number,
    public endLine: number,
    public endCharacter: number,
  ) {}
}

/** Diagnostico exibido no editor. */
export class Diagnostic {
  source?: string;
  constructor(
    public range: Range,
    public message: string,
    public severity: number,
  ) {}
}

/** Identificador de recurso. */
export class Uri {
  private constructor(public fsPath: string) {}
  static file(caminho: string): Uri {
    return new Uri(caminho);
  }
}

/** Emissor de eventos no formato do VSCode. */
export class EventEmitter<T> {
  private readonly listeners: Array<(value: T) => void> = [];

  readonly event = (listener: (value: T) => void): { dispose(): void } => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };

  fire(value: T): void {
    for (const listener of this.listeners) listener(value);
  }

  dispose(): void {
    this.listeners.length = 0;
  }
}

/** Canal de log. */
export interface OutputChannelMock {
  name: string;
  lines: string[];
  shown: number;
  appendLine(line: string): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

/** Item da barra de status. */
export interface StatusBarItemMock {
  text: string;
  tooltip: string | undefined;
  command: string | undefined;
  visible: boolean;
  show(): void;
  dispose(): void;
}

/** Terminal integrado. */
export interface TerminalMock {
  name: string;
  sent: string[];
  shown: number;
  show(preserveFocus?: boolean): void;
  sendText(text: string): void;
}

/** Colecao de diagnosticos. */
export interface DiagnosticCollectionMock {
  entries: Map<string, Diagnostic[]>;
  set(uri: Uri, diagnostics: Diagnostic[]): void;
  delete(uri: Uri): void;
  clear(): void;
  dispose(): void;
}

/** Tudo o que o teste precisa observar e controlar. */
export interface VscodeState {
  configuracao: Record<string, unknown>;
  pastas: Array<{ uri: Uri }> | undefined;
  canais: OutputChannelMock[];
  barras: StatusBarItemMock[];
  terminais: TerminalMock[];
  diagnosticos: DiagnosticCollectionMock[];
  arvores: Array<{ id: string; provider: unknown; disposed: boolean }>;
  comandos: Map<string, (...args: never[]) => unknown>;
  contextos: Array<[string, unknown]>;
  informacoes: string[];
  erros: string[];
  editorAtivo: { document: { uri: Uri } } | undefined;
}

/** Estado global do mock, reiniciado por {@link resetVscodeMock}. */
export const estado: VscodeState = criarEstado();

function criarEstado(): VscodeState {
  return {
    configuracao: {},
    pastas: undefined,
    canais: [],
    barras: [],
    terminais: [],
    diagnosticos: [],
    arvores: [],
    comandos: new Map(),
    contextos: [],
    informacoes: [],
    erros: [],
    editorAtivo: undefined,
  };
}

/** Zera o estado entre testes. */
export function resetVscodeMock(): void {
  Object.assign(estado, criarEstado());
}

/** Invoca um comando registrado pela extensao. */
export async function executarComando(nome: string, ...args: unknown[]): Promise<unknown> {
  const handler = estado.comandos.get(nome);
  if (!handler) throw new Error(`comando nao registrado: ${nome}`);
  return (handler as (...a: unknown[]) => unknown)(...args);
}

/** Namespace `vscode.window`. */
export const window = {
  createOutputChannel(name: string): OutputChannelMock {
    const canal: OutputChannelMock = {
      name,
      lines: [],
      shown: 0,
      appendLine: (line) => canal.lines.push(line),
      show: () => {
        canal.shown++;
      },
      dispose: () => {},
    };
    estado.canais.push(canal);
    return canal;
  },

  createStatusBarItem(_alignment: number, _priority?: number): StatusBarItemMock {
    const item: StatusBarItemMock = {
      text: '',
      tooltip: undefined,
      command: undefined,
      visible: false,
      show: () => {
        item.visible = true;
      },
      dispose: () => {},
    };
    estado.barras.push(item);
    return item;
  },

  createTreeView(id: string, options: { treeDataProvider: unknown }) {
    const view = { id, provider: options.treeDataProvider, disposed: false };
    estado.arvores.push(view);
    return {
      dispose: () => {
        view.disposed = true;
      },
    };
  },

  get terminals(): TerminalMock[] {
    return estado.terminais;
  },

  createTerminal(options: { name: string; cwd?: unknown }): TerminalMock {
    const terminal: TerminalMock = {
      name: options.name,
      sent: [],
      shown: 0,
      show: () => {
        terminal.shown++;
      },
      sendText: (text) => terminal.sent.push(text),
    };
    estado.terminais.push(terminal);
    return terminal;
  },

  showInformationMessage(mensagem: string): Promise<undefined> {
    estado.informacoes.push(mensagem);
    return Promise.resolve(undefined);
  },

  showErrorMessage(mensagem: string): Promise<undefined> {
    estado.erros.push(mensagem);
    return Promise.resolve(undefined);
  },

  get activeTextEditor() {
    return estado.editorAtivo;
  },
};

/** Namespace `vscode.workspace`. */
export const workspace = {
  get workspaceFolders() {
    return estado.pastas;
  },

  getConfiguration(_secao: string) {
    return {
      get<T>(chave: string, padrao: T): T {
        const valor = estado.configuracao[chave];
        return valor === undefined ? padrao : (valor as T);
      },
    };
  },
};

/** Namespace `vscode.commands`. */
export const commands = {
  registerCommand(nome: string, handler: (...args: never[]) => unknown) {
    estado.comandos.set(nome, handler);
    return { dispose: () => estado.comandos.delete(nome) };
  },

  executeCommand(nome: string, ...args: unknown[]): Promise<undefined> {
    if (nome === 'setContext') estado.contextos.push([String(args[0]), args[1]]);
    return Promise.resolve(undefined);
  },
};

/** Namespace `vscode.languages`. */
export const languages = {
  createDiagnosticCollection(_nome: string): DiagnosticCollectionMock {
    const colecao: DiagnosticCollectionMock = {
      entries: new Map(),
      set: (uri, diagnostics) => {
        colecao.entries.set(uri.fsPath, diagnostics);
      },
      delete: (uri) => {
        colecao.entries.delete(uri.fsPath);
      },
      clear: () => colecao.entries.clear(),
      dispose: () => {},
    };
    estado.diagnosticos.push(colecao);
    return colecao;
  },
};
