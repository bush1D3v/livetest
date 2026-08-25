/**
 * Grafo de dependencias e propagacao reversa.
 *
 * O grafo guarda duas arestas por relacao de import:
 *
 * - **forward** (`A -> B`): "A importa B";
 * - **reverse** (`B -> A`): "B e importado por A".
 *
 * A pergunta que a ferramenta precisa responder ao salvar um arquivo e a
 * reversa — *quem depende deste arquivo?* — e por isso ela e mantida
 * materializada, respondida por uma busca em largura sobre as arestas reversas.
 *
 * @packageDocumentation
 */

import type { DependencyGraphAdapter, FileImports, ImpactedFile } from '../types/graph.js';
import type { Logger } from '../types/logging.js';
import { noopLogger } from '../util/logger.js';
import { extname } from '../util/paths.js';

/** Grafo de dependencias do projeto. */
export interface DependencyGraph {
  /** Analisa e indexa um conjunto de arquivos, substituindo o que ja existia. */
  index(files: string[]): Promise<void>;
  /** Reanalisa arquivos alterados, corrigindo as arestas nos dois sentidos. */
  update(files: string[]): Promise<void>;
  /** Remove um arquivo e todas as suas arestas de saida. */
  remove(file: string): void;
  /** Arquivos importados por `file`. */
  dependenciesOf(file: string): string[];
  /** Arquivos que importam `file` diretamente. */
  dependentsOf(file: string): string[];
  /**
   * Arquivos impactados por uma alteracao em `file`, ate `maxDepth` saltos no
   * grafo reverso. O proprio `file` sempre vem primeiro, com `depth: 0`.
   */
  impactedBy(file: string, maxDepth: number): ImpactedFile[];
  /** Especificadores que nenhum adapter conseguiu resolver, por arquivo. */
  unresolvedOf(file: string): string[];
  /** Todos os arquivos indexados. */
  files(): string[];
  /** Quantidade de arquivos indexados. */
  size(): number;
  /** Libera os adapters. */
  dispose(): Promise<void>;
}

/** Opcoes de {@link createDependencyGraph}. */
export interface DependencyGraphOptions {
  /** Adapters disponiveis, um por linguagem. */
  adapters: DependencyGraphAdapter[];
  logger?: Logger;
  /**
   * Chamado quando um adapter falha e o grafo degrada.
   *
   * Sem isto a falha ficaria apenas no log interno, invisivel para quem
   * consome o canal de eventos — justamente quem mais precisa saber que a
   * propagacao por dependencia parou de valer.
   */
  onDegradation?: (message: string, detail: string | null) => void;
}

/**
 * Cria um {@link DependencyGraph}.
 *
 * @example
 * ```ts
 * const graph = createDependencyGraph({ adapters: [jsTsAdapter] });
 * await graph.index(['/proj/src/login.ts', '/proj/src/header.ts']);
 * graph.impactedBy('/proj/src/login.ts', 1);
 * // [{ file: '.../login.ts', depth: 0 }, { file: '.../header.ts', depth: 1 }]
 * ```
 */
export function createDependencyGraph(options: DependencyGraphOptions): DependencyGraph {
  const logger = (options.logger ?? noopLogger).child('graph');

  /** `A -> arquivos que A importa`. */
  const forward = new Map<string, Set<string>>();
  /** `B -> arquivos que importam B`. */
  const reverse = new Map<string, Set<string>>();
  /** Especificadores nao resolvidos, por arquivo. */
  const unresolved = new Map<string, string[]>();

  /** Extensao -> adapter. Um adapter pode atender varias extensoes. */
  const byExtension = new Map<string, DependencyGraphAdapter>();
  for (const adapter of options.adapters) {
    for (const ext of adapter.extensions) byExtension.set(ext.toLowerCase(), adapter);
  }

  function adapterFor(file: string): DependencyGraphAdapter | undefined {
    return byExtension.get(extname(file));
  }

  /** Remove as arestas de saida de `file`, mantendo-o indexado. */
  function detachOutgoing(file: string): void {
    const current = forward.get(file);
    if (!current) return;
    for (const target of current) reverse.get(target)?.delete(file);
    current.clear();
  }

  function applyImports(entry: FileImports): void {
    const { file } = entry;
    detachOutgoing(file);
    const targets = forward.get(file) ?? new Set<string>();
    forward.set(file, targets);

    for (const target of entry.imports) {
      if (target === file) continue; // auto-import nao gera aresta
      targets.add(target);
      let importers = reverse.get(target);
      if (!importers) {
        importers = new Set<string>();
        reverse.set(target, importers);
      }
      importers.add(file);
    }

    if (entry.unresolved.length > 0) unresolved.set(file, entry.unresolved);
    else unresolved.delete(file);
  }

  /** Agrupa por adapter e analisa, tolerando falha de um adapter isolado. */
  async function analyze(files: string[]): Promise<FileImports[]> {
    const groups = new Map<DependencyGraphAdapter, string[]>();
    for (const file of files) {
      const adapter = adapterFor(file);
      if (!adapter) continue;
      const list = groups.get(adapter);
      if (list) list.push(file);
      else groups.set(adapter, [file]);
    }

    const results: FileImports[] = [];
    for (const [adapter, group] of groups) {
      try {
        results.push(...(await adapter.analyze(group)));
      } catch (error) {
        // Degradacao segura (NFR de robustez): sem grafo, cada arquivo do grupo
        // fica isolado e apenas os seus proprios testes rodam.
        const motivo = error instanceof Error ? error.message : String(error);
        logger.warn(
          'adapter "%s" falhou ao analisar %d arquivo(s): %s',
          adapter.id,
          group.length,
          motivo,
        );
        options.onDegradation?.(
          `o adapter de grafo "${adapter.id}" falhou ao analisar ${group.length} arquivo(s): ${motivo}`,
          error instanceof Error ? (error.stack ?? null) : null,
        );
        results.push(...group.map((file) => ({ file, imports: [], unresolved: [] })));
      }
    }
    return results;
  }

  return {
    async index(files: string[]): Promise<void> {
      forward.clear();
      reverse.clear();
      unresolved.clear();
      for (const file of files) forward.set(file, new Set());
      for (const entry of await analyze(files)) applyImports(entry);
      logger.debug('indexados %d arquivo(s)', forward.size);
    },

    async update(files: string[]): Promise<void> {
      for (const file of files) {
        if (!forward.has(file)) forward.set(file, new Set());
      }
      for (const entry of await analyze(files)) applyImports(entry);
    },

    remove(file: string): void {
      detachOutgoing(file);
      forward.delete(file);
      unresolved.delete(file);
      const importers = reverse.get(file);
      if (importers && importers.size === 0) reverse.delete(file);
    },

    dependenciesOf: (file) => [...(forward.get(file) ?? [])],
    dependentsOf: (file) => [...(reverse.get(file) ?? [])],
    unresolvedOf: (file) => [...(unresolved.get(file) ?? [])],
    files: () => [...forward.keys()],
    size: () => forward.size,

    impactedBy(file: string, maxDepth: number): ImpactedFile[] {
      const result: ImpactedFile[] = [{ file, depth: 0, chain: [file] }];
      if (maxDepth <= 0) return result;

      const seen = new Set<string>([file]);
      let frontier: ImpactedFile[] = result;

      // `maxDepth` pode ser Infinity; a parada real e a fronteira ficar vazia,
      // garantida porque `seen` impede revisitar um no.
      for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
        const next: ImpactedFile[] = [];
        for (const node of frontier) {
          for (const importer of reverse.get(node.file) ?? []) {
            if (seen.has(importer)) continue;
            seen.add(importer);
            next.push({ file: importer, depth, chain: [...node.chain, importer] });
          }
        }
        result.push(...next);
        frontier = next;
      }
      return result;
    },

    async dispose(): Promise<void> {
      for (const adapter of new Set(byExtension.values())) await adapter.dispose?.();
      forward.clear();
      reverse.clear();
      unresolved.clear();
    },
  };
}
