/**
 * `livetest why` — explica o que rodaria ao salvar um arquivo, e por que.
 *
 * Atende diretamente ao requisito de transparencia da secao 8 do PRD: quando a
 * selecao de testes surpreende, este comando mostra a profundidade aplicada, a
 * regra de configuracao que a definiu, a cadeia de importacao e os caminhos que
 * foram procurados quando nenhum teste foi encontrado.
 *
 * @packageDocumentation
 */

import {
  createEngine,
  describeDepth,
  normalizePath,
  planBatch,
  relativeToRoot,
  resolveDepthForFile,
  summarizeReason,
} from '@livetest/core';

import type { Command, CommandContext } from '../context.js';
import { CONFIG_OVERRIDE_FLAGS, EXIT, loadConfigForCommand } from '../context.js';

/** Implementacao de `livetest why`. */
export const whyCommand: Command = {
  name: 'why',
  summary: 'Explica quais testes rodariam para um arquivo, e por que',
  usage: 'livetest why <arquivo> [opcoes]',
  flags: { ...CONFIG_OVERRIDE_FLAGS },
  details: ['Nao executa nenhum teste: apenas monta e imprime o plano.'],

  async run(context: CommandContext): Promise<number> {
    const target = context.positionals[0];
    if (!target) {
      context.output.err('Informe o arquivo: livetest why src/login.ts');
      return EXIT.usage;
    }

    // Um comando de diagnostico so deve imprimir o diagnostico: silenciamos o
    // relatorio do motor e os arquivos de saida do daemon.
    const { config } = await loadConfigForCommand(context, {
      server: { enabled: false },
      output: { stdout: false, logFile: null, statusFile: null },
      logLevel: 'warn',
    });
    const engine = createEngine({ config });
    await engine.start();

    try {
      const file = normalizePath(target, context.cwd);
      const rel = (path: string): string => relativeToRoot(config.root, path);
      const depth = resolveDepthForFile(config, file);
      const { out } = context.output;

      out(`arquivo:       ${rel(file)}`);
      out(`runner:        ${engine.resolver.runnerKeyFor(file) ?? '(nenhum)'}`);
      out(
        `profundidade:  ${String(depth.depth)} — ${describeDepth(depth.depth)}` +
          (depth.matchedOverride ? `  [override: ${depth.matchedOverride}]` : '  [default]'),
      );

      const impacted = engine.graph.impactedBy(file, depth.hops);
      out('');
      out(`arquivos impactados (${impacted.length}):`);
      for (const node of impacted) {
        const via = node.chain.length > 2 ? ` via ${node.chain.slice(1, -1).map(rel).join(' -> ')}` : '';
        out(`  [${node.depth}] ${rel(node.file)}${via}`);
      }

      const plan = planBatch({ config, graph: engine.graph, resolver: engine.resolver, changedFiles: [file] });
      out('');
      if (plan.entries.length === 0) {
        out('testes que rodariam: nenhum');
      } else {
        out(`testes que rodariam (${plan.totalTestFiles}):`);
        for (const entry of plan.entries) {
          out(`  runner ${entry.runnerKey}:`);
          for (const [testFile, motivos] of Object.entries(entry.reasons)) {
            out(`    ${rel(testFile)}`);
            for (const reason of motivos) {
              out(`      ${summarizeReason(reason, config.root)}`);
            }
          }
        }
      }

      for (const item of plan.unmatched) {
        out('');
        out(`sem teste: ${item.reason}`);
      }

      const unresolved = engine.graph.unresolvedOf(file);
      if (unresolved.length > 0) {
        out('');
        out('imports nao resolvidos (o grafo pode estar incompleto aqui):');
        for (const item of unresolved) out(`  ${item}`);
      }

      return EXIT.ok;
    } finally {
      await engine.stop('diagnostico concluido');
    }
  },
};
