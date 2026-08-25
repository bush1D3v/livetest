/**
 * Modelo da arvore de arquivos exibida no painel.
 *
 * Puro e independente do VSCode: recebe eventos do daemon e produz uma arvore
 * de nos com status, descricao e o **motivo** de cada arquivo ter rodado —
 * exatamente o que a secao 4.3 do PRD pede ("rodou porque importa login.ts").
 *
 * @packageDocumentation
 */

import type { DaemonSnapshot, FileStatus, LiveTestEvent, SelectionReason } from '@livetest/core/client';
import { summarizeReason } from '@livetest/core/client';

/** Tipo de no da arvore. */
export type NodeKind = 'diretorio' | 'arquivo' | 'caso';

/** Status exibido, incluindo os estados que so a UI conhece. */
export type NodeStatus = FileStatus['status'];

/** Um no da arvore. */
export interface TreeNode {
  /** Identificador estavel, usado para preservar o estado de expansao. */
  id: string;
  kind: NodeKind;
  /** Rotulo principal. */
  label: string;
  /** Texto secundario, em cinza ao lado do rotulo. */
  description: string;
  /** Texto do tooltip, ja formatado em varias linhas. */
  tooltip: string;
  status: NodeStatus;
  /** Caminho absoluto do arquivo, quando o no representa um. */
  path: string | null;
  children: TreeNode[];
}

/** Estado agregado por arquivo, mantido pelo modelo. */
interface FileEntry {
  status: FileStatus;
  /** Motivos da ultima selecao, para o tooltip. */
  reasons: SelectionReason[];
  /** Casos de teste que falharam na ultima execucao. */
  failures: Array<{ name: string; message: string }>;
}

/** Ordem de severidade: um diretorio herda o pior status dos filhos. */
const SEVERITY: Record<NodeStatus, number> = {
  errored: 5,
  failed: 4,
  running: 3,
  skipped: 2,
  passed: 1,
  idle: 0,
};

/** Devolve o status mais severo de uma lista. */
export function worstStatus(statuses: readonly NodeStatus[]): NodeStatus {
  return statuses.reduce<NodeStatus>(
    (worst, status) => (SEVERITY[status] > SEVERITY[worst] ? status : worst),
    'idle',
  );
}

/** Modelo da arvore, alimentado pelos eventos do daemon. */
export interface TreeModel {
  /** Substitui todo o estado pelo snapshot recebido na conexao. */
  applySnapshot(snapshot: DaemonSnapshot): void;
  /** Atualiza o estado a partir de um evento. */
  apply(event: LiveTestEvent): void;
  /** Raizes da arvore, ja ordenadas. */
  roots(): TreeNode[];
  /** Estado de um arquivo especifico. */
  entry(path: string): FileEntry | undefined;
  /** Limpa tudo (usado ao desconectar). */
  clear(): void;
  /** Quantidade de arquivos conhecidos. */
  size(): number;
}

/** Opcoes de {@link createTreeModel}. */
export interface TreeModelOptions {
  /** Raiz do projeto, usada para montar os rotulos relativos. */
  root: string;
  /** Mostrar arquivos ainda sem execucao. @defaultValue true */
  includeIdle?: boolean;
}

/** Cria o modelo da arvore. */
export function createTreeModel(options: TreeModelOptions): TreeModel {
  const files = new Map<string, FileEntry>();
  let root = options.root;
  const includeIdle = options.includeIdle ?? true;

  function ensure(status: FileStatus): FileEntry {
    const existing = files.get(status.path);
    if (existing) {
      existing.status = status;
      return existing;
    }
    const created: FileEntry = { status, reasons: [], failures: [] };
    files.set(status.path, created);
    return created;
  }

  return {
    applySnapshot(snapshot: DaemonSnapshot): void {
      root = snapshot.root;
      files.clear();
      for (const status of snapshot.files) ensure({ ...status });

      // O ultimo lote traz os motivos e as falhas que o snapshot por arquivo
      // nao carrega; sem isso a arvore reconecta sem explicacao nenhuma.
      for (const run of snapshot.lastBatch?.runs ?? []) {
        applyRun(files, run.reasons, run.cases);
      }
    },

    apply(event: LiveTestEvent): void {
      switch (event.type) {
        case 'snapshot':
          this.applySnapshot(event.state);
          break;
        case 'batch.started':
          for (const entry of event.plan) {
            for (const testFile of entry.testFiles) {
              const target = ensure(makeStatus(testFile, root, 'running'));
              target.reasons = entry.reasons[testFile] ?? [];
              target.failures = [];
            }
          }
          break;
        case 'run.finished': {
          const { result } = event;
          for (const testFile of result.testFiles) {
            const failures = result.cases
              .filter((testCase) => testCase.status === 'failed' && testCase.file === testFile)
              .map((testCase) => ({
                name: testCase.fullName,
                message: testCase.failureMessages.join('\n'),
              }));
            const status: NodeStatus =
              result.status === 'errored'
                ? 'errored'
                : result.status === 'failed'
                  ? failures.length > 0
                    ? 'failed'
                    : 'passed'
                  : result.status === 'passed'
                    ? 'passed'
                    : 'skipped';
            const target = ensure(makeStatus(testFile, root, status));
            target.failures = failures;
            target.status.reason = result.error;
          }
          break;
        }
        case 'watch.change':
          if (event.kind === 'unlink') files.delete(event.path);
          break;
        default:
          break;
      }
    },

    roots: () => buildTree(files, root, includeIdle),
    entry: (path) => files.get(path),
    clear: () => files.clear(),
    size: () => files.size,
  };
}

/** Cria um {@link FileStatus} minimo para um arquivo. */
function makeStatus(path: string, root: string, status: NodeStatus): FileStatus {
  return {
    path,
    relativePath: path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
    status,
    updatedAt: 0,
    reason: null,
    lastRunId: null,
    counts: null,
  };
}

/** Aplica motivos e falhas de uma execucao ao mapa de arquivos. */
function applyRun(
  files: Map<string, FileEntry>,
  reasons: Record<string, SelectionReason[]>,
  cases: ReadonlyArray<{ file: string | null; fullName: string; status: string; failureMessages: string[] }>,
): void {
  for (const [testFile, list] of Object.entries(reasons)) {
    const entry = files.get(testFile);
    if (entry) entry.reasons = list;
  }
  for (const testCase of cases) {
    if (testCase.status !== 'failed' || !testCase.file) continue;
    const entry = files.get(testCase.file);
    if (!entry) continue;
    entry.failures.push({
      name: testCase.fullName,
      message: testCase.failureMessages.join('\n'),
    });
  }
}

/** Monta o tooltip de um arquivo: status, motivos e falhas. */
export function buildFileTooltip(entry: FileEntry, root: string): string {
  const lines = [entry.status.relativePath, `status: ${entry.status.status}`];

  if (entry.status.counts) {
    const { passed, failed, skipped } = entry.status.counts;
    lines.push(`testes: ${passed} passou, ${failed} falhou, ${skipped} pulou`);
  }
  if (entry.status.reason) lines.push(`erro: ${entry.status.reason}`);

  if (entry.reasons.length > 0) {
    lines.push('', 'por que rodou:');
    for (const reason of entry.reasons) lines.push(`  - ${summarizeReason(reason, root)}`);
  }
  if (entry.failures.length > 0) {
    lines.push('', 'falhas:');
    for (const failure of entry.failures) lines.push(`  x ${failure.name}`);
  }
  return lines.join('\n');
}

/** Monta a arvore de diretorios e arquivos a partir do mapa plano. */
function buildTree(
  files: ReadonlyMap<string, FileEntry>,
  root: string,
  includeIdle: boolean,
): TreeNode[] {
  /** Diretorio em construcao, indexado pelo caminho relativo. */
  interface Dir {
    node: TreeNode;
    dirs: Map<string, Dir>;
  }

  const rootDir: Dir = {
    node: { id: '', kind: 'diretorio', label: '', description: '', tooltip: '', status: 'idle', path: null, children: [] },
    dirs: new Map(),
  };

  const entries = [...files.values()]
    .filter((entry) => includeIdle || entry.status.status !== 'idle')
    .sort((a, b) => a.status.relativePath.localeCompare(b.status.relativePath));

  for (const entry of entries) {
    const segments = entry.status.relativePath.split('/');
    // `split` sempre devolve ao menos um elemento, entao ha o que remover.
    const fileName = segments.pop() as string;

    let cursor = rootDir;
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix === '' ? segment : `${prefix}/${segment}`;
      let child = cursor.dirs.get(segment);
      if (!child) {
        child = {
          node: {
            id: `dir:${prefix}`,
            kind: 'diretorio',
            label: segment,
            description: '',
            tooltip: prefix,
            status: 'idle',
            path: null,
            children: [],
          },
          dirs: new Map(),
        };
        cursor.dirs.set(segment, child);
        cursor.node.children.push(child.node);
      }
      cursor = child;
    }

    cursor.node.children.push(buildFileNode(entry, fileName, root));
  }

  collapseStatuses(rootDir.node);
  return rootDir.node.children;
}

/** Monta o no de um arquivo, com os casos que falharam como filhos. */
function buildFileNode(entry: FileEntry, fileName: string, root: string): TreeNode {
  const counts = entry.status.counts;
  const description =
    counts !== null
      ? `${counts.passed}/${counts.passed + counts.failed + counts.skipped}`
      : entry.reasons.length > 0 && entry.reasons[0]?.kind === 'importer'
        ? 'via dependencia'
        : '';

  return {
    id: `file:${entry.status.path}`,
    kind: 'arquivo',
    label: fileName,
    description,
    tooltip: buildFileTooltip(entry, root),
    status: entry.status.status,
    path: entry.status.path,
    children: entry.failures.map((failure, index) => ({
      id: `case:${entry.status.path}:${index}`,
      kind: 'caso' as const,
      label: failure.name,
      description: '',
      tooltip: failure.message || failure.name,
      status: 'failed' as const,
      path: entry.status.path,
      children: [],
    })),
  };
}

/** Propaga o pior status dos filhos para cada diretorio, de baixo para cima. */
function collapseStatuses(node: TreeNode): NodeStatus {
  if (node.kind !== 'diretorio' || node.children.length === 0) return node.status;
  const statuses = node.children.map((child) => collapseStatuses(child));
  node.status = worstStatus(statuses);

  const failing = node.children.filter(
    (child) => child.status === 'failed' || child.status === 'errored',
  ).length;
  node.description = failing > 0 ? `${failing} com falha` : '';
  return node.status;
}
