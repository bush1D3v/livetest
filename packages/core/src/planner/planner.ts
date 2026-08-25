/**
 * Montagem do plano de execucao de um lote.
 *
 * Este e o modulo que materializa o diferencial descrito na secao 3 do PRD:
 * dado o conjunto de arquivos salvos, ele decide **quais testes rodar** e,
 * igualmente importante, registra **por que** cada teste entrou no plano.
 *
 * O caminho de decisao para cada arquivo salvo e:
 *
 * ```text
 * arquivo salvo
 *   -> profundidade configurada para ele  (config/depth.ts)
 *   -> arquivos impactados no grafo reverso  (graph/graph.ts)
 *   -> arquivos de teste de cada impactado  (testmap/resolver.ts)
 *   -> agrupamento por runner
 * ```
 *
 * @packageDocumentation
 */

import { resolveDepthForFile } from '../config/depth.js';
import { describeDepth } from '../config/validate.js';
import type { ResolvedConfig } from '../types/config.js';
import type { DependencyGraph } from '../graph/graph.js';
import type { SelectionReason } from '../types/results.js';
import type { TestFileResolver } from '../testmap/resolver.js';
import { relativeToRoot } from '../util/paths.js';

/** Um grupo de arquivos de teste a executar por um mesmo runner. */
export interface RunPlanEntry {
  /** Chave do runner na configuracao. */
  runnerKey: string;
  /** Arquivos de teste absolutos, ordenados. */
  testFiles: string[];
  /** Motivos de selecao, por arquivo de teste. */
  reasons: Record<string, SelectionReason[]>;
}

/** Arquivo salvo que nao gerou nenhuma execucao, com a explicacao. */
export interface UnmatchedFile {
  file: string;
  reason: string;
}

/** Plano completo de um lote. */
export interface RunPlan {
  /** Grupos por runner, na ordem de declaracao da configuracao. */
  entries: RunPlanEntry[];
  /** Arquivos salvos sem teste correspondente. */
  unmatched: UnmatchedFile[];
  /** Total de arquivos de teste no plano, sem repeticao entre runners. */
  totalTestFiles: number;
}

/** Opcoes de {@link planBatch}. */
export interface PlanBatchOptions {
  config: ResolvedConfig;
  graph: DependencyGraph;
  resolver: TestFileResolver;
  /** Arquivos salvos no lote (absolutos). */
  changedFiles: readonly string[];
}

/**
 * Monta o plano de execucao de um lote de arquivos alterados.
 *
 * @example
 * ```ts
 * // login.ts e importado por header.ts e footer.ts, com profundidade 'direct'
 * const plan = planBatch({ config, graph, resolver, changedFiles: ['/proj/src/login.ts'] });
 * plan.entries[0].testFiles;
 * // ['/proj/src/footer.test.ts', '/proj/src/header.test.ts', '/proj/src/login.test.ts']
 * plan.entries[0].reasons['/proj/src/header.test.ts'][0];
 * // { kind: 'importer', depth: 1, chain: ['.../login.ts', '.../header.ts'], ... }
 * ```
 */
export function planBatch(options: PlanBatchOptions): RunPlan {
  const { config, graph, resolver, changedFiles } = options;

  /** runnerKey -> (arquivo de teste -> motivos) */
  const byRunner = new Map<string, Map<string, SelectionReason[]>>();
  const unmatched: UnmatchedFile[] = [];

  for (const changedFile of changedFiles) {
    const depth = resolveDepthForFile(config, changedFile);
    const impacted = graph.impactedBy(changedFile, depth.hops);
    let producedAnyTest = false;

    for (const node of impacted) {
      const mapping = resolver.resolve(node.file);
      if (mapping.runnerKey === null || mapping.testFiles.length === 0) continue;

      for (const testFile of mapping.testFiles) {
        const runnerKey = resolver.runnerKeyFor(testFile) ?? mapping.runnerKey;
        let entry = byRunner.get(runnerKey);
        if (!entry) {
          entry = new Map<string, SelectionReason[]>();
          byRunner.set(runnerKey, entry);
        }
        const reasons = entry.get(testFile) ?? [];
        const candidate: SelectionReason = {
          kind: node.depth === 0 ? 'changed' : 'importer',
          changedFile,
          sourceFile: node.file,
          depth: node.depth,
          chain: node.chain,
        };
        // Um mesmo arquivo salvo pode alcancar o mesmo teste por mais de um
        // caminho (o proprio teste importa o fonte, por exemplo). Guardamos so
        // o caminho mais curto: e o que explica melhor a selecao.
        const existingIndex = reasons.findIndex((r) => r.changedFile === changedFile);
        if (existingIndex === -1) {
          reasons.push(candidate);
        } else if (candidate.depth < (reasons[existingIndex] as SelectionReason).depth) {
          reasons[existingIndex] = candidate;
        }
        entry.set(testFile, reasons);
        producedAnyTest = true;
      }
    }

    if (!producedAnyTest) {
      unmatched.push({ file: changedFile, reason: explainNoTests(options, changedFile, depth.depth) });
    }
  }

  // A ordem dos runners segue a declaracao na configuracao, para que a saida
  // seja estavel entre execucoes.
  const entries: RunPlanEntry[] = [];
  for (const runnerKey of Object.keys(config.runners)) {
    const group = byRunner.get(runnerKey);
    if (!group || group.size === 0) continue;
    const ordenados = [...group.entries()].sort(([a], [b]) => a.localeCompare(b));
    const testFiles = ordenados.map(([testFile]) => testFile);
    const reasons: Record<string, SelectionReason[]> = {};
    for (const [testFile, lista] of ordenados) reasons[testFile] = lista;
    entries.push({ runnerKey, testFiles, reasons });
  }

  const distinct = new Set(entries.flatMap((entry) => entry.testFiles));
  return { entries, unmatched, totalTestFiles: distinct.size };
}

/** Explica, em uma linha, por que um arquivo salvo nao gerou execucao. */
function explainNoTests(
  options: PlanBatchOptions,
  changedFile: string,
  depth: ReturnType<typeof resolveDepthForFile>['depth'],
): string {
  const { config, resolver } = options;
  const relative = relativeToRoot(config.root, changedFile);

  if (resolver.runnerKeyFor(changedFile) === null) {
    return `${relative}: nenhum runner configurado atende esta extensao`;
  }

  const candidates = resolver.candidatesFor(changedFile).slice(0, 3);
  const sample = candidates.map((c) => relativeToRoot(config.root, c)).join(', ');
  return (
    `${relative}: nenhum arquivo de teste encontrado ` +
    `(profundidade "${String(depth)}" = ${describeDepth(depth)}; ` +
    `procurados, entre outros: ${sample})`
  );
}

/**
 * Resume um {@link SelectionReason} em uma frase, para log e para a extensao.
 *
 * @example
 * ```ts
 * summarizeReason(reason, '/proj');
 * // 'rodou porque src/header.ts importa src/login.ts (1 nivel)'
 * ```
 */
export function summarizeReason(reason: SelectionReason, root: string): string {
  const changed = relativeToRoot(root, reason.changedFile);
  if (reason.kind === 'changed') return `rodou porque ${changed} foi alterado`;
  if (reason.kind === 'manual') return `rodou por pedido explicito (${changed})`;

  const source = relativeToRoot(root, reason.sourceFile);
  const via =
    reason.chain.length > 2
      ? ` via ${reason.chain.slice(1, -1).map((f) => relativeToRoot(root, f)).join(' -> ')}`
      : '';
  const unidade = reason.depth === 1 ? 'nivel' : 'niveis';
  return `rodou porque ${source} importa ${changed}${via} (${reason.depth} ${unidade})`;
}
