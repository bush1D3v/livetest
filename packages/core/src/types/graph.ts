/**
 * Contratos do adapter de grafo de dependencias.
 *
 * Um adapter e responsavel por, dado um arquivo-fonte, listar os arquivos do
 * projeto que ele importa. O core inverte esse mapa para responder a pergunta
 * inversa — "quem depende deste arquivo?" — e propaga a execucao de testes.
 *
 * Implementar um novo adapter (Go, Rust, Java...) nao exige alteracao no core:
 * basta registrar uma implementacao de {@link DependencyGraphAdapter}.
 *
 * @packageDocumentation
 */

import type { Logger } from './logging.js';

/** Contexto entregue ao adapter na criacao. */
export interface GraphAdapterContext {
  /** Raiz absoluta do projeto. */
  root: string;
  /** Logger ja prefixado com o nome do adapter. */
  logger: Logger;
  /** Interpretador Python configurado (usado apenas por adapters Python). */
  pythonPath: string;
  /** Reporta uma degradacao segura sem derrubar o daemon. */
  reportDegradation(message: string, detail?: string): void;
}

/** Resultado da analise de imports de um unico arquivo. */
export interface FileImports {
  /** Arquivo analisado (absoluto). */
  file: string;
  /** Arquivos do projeto importados por ele (absolutos, deduplicados). */
  imports: string[];
  /**
   * Especificadores que o adapter nao conseguiu resolver para um arquivo local
   * (imports dinamicos, pacotes externos, DI). Expostos para transparencia.
   */
  unresolved: string[];
}

/**
 * Adapter de grafo de dependencias por linguagem.
 *
 * @example
 * ```ts
 * const goAdapter: DependencyGraphAdapter = {
 *   id: 'go',
 *   extensions: ['.go'],
 *   async analyze(files) {
 *     return files.map((file) => ({ file, imports: [], unresolved: [] }));
 *   },
 * };
 * ```
 */
export interface DependencyGraphAdapter {
  /** Identificador unico, referenciado por `runners[].graph` na configuracao. */
  readonly id: string;
  /** Extensoes de arquivo (com ponto) atendidas por este adapter. */
  readonly extensions: readonly string[];
  /**
   * Analisa um conjunto de arquivos e retorna os imports locais de cada um.
   * Deve ser resiliente: um arquivo com erro de sintaxe retorna
   * `{ imports: [], unresolved: [] }` em vez de lancar excecao.
   */
  analyze(files: string[]): Promise<FileImports[]>;
  /** Libera recursos (processos filhos, caches). */
  dispose?(): Promise<void> | void;
}

/** Fabrica de adapters, usada pelo registry para injetar o contexto. */
export type DependencyGraphAdapterFactory = (
  context: GraphAdapterContext,
) => DependencyGraphAdapter;

/** Um no do caminho de propagacao no grafo reverso. */
export interface ImpactedFile {
  /** Arquivo impactado (absoluto). */
  file: string;
  /** Distancia em arestas ate o arquivo alterado (`0` = o proprio arquivo). */
  depth: number;
  /** Caminho de `changedFile` ate `file`, inclusive nas duas pontas. */
  chain: string[];
}
