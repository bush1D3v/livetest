/**
 * `livetest run` — execucao unica dos testes afetados por um ou mais arquivos.
 *
 * Util em duas situacoes: um agente de IA que prefere pedir a execucao
 * explicitamente em vez de manter um daemon, e um hook de pre-commit que quer
 * rodar so o que a mudanca afeta.
 *
 * @packageDocumentation
 */

import { createEngine, normalizePath } from '@livetest/core';

import type { Command, CommandContext } from '../context.js';
import { CONFIG_OVERRIDE_FLAGS, EXIT, loadConfigForCommand } from '../context.js';

/** Implementacao de `livetest run`. */
export const runCommand: Command = {
  name: 'run',
  summary: 'Roda uma vez os testes afetados pelos arquivos informados',
  usage: 'livetest run <arquivo...> [opcoes]',
  flags: { ...CONFIG_OVERRIDE_FLAGS },
  details: [
    'Sem arquivos, roda os testes de todos os arquivos observados.',
    '',
    'Codigos de saida: 0 sucesso, 1 testes falharam, 3 configuracao invalida.',
  ],

  async run(context: CommandContext): Promise<number> {
    const { config } = await loadConfigForCommand(context, {
      // Uma execucao unica nao publica canal de eventos nem arquivo de descoberta:
      // ela nao e um daemon e nao deve ser encontrada como um.
      server: { enabled: false },
    });

    const engine = createEngine({ config });
    await engine.start();

    try {
      const files =
        context.positionals.length > 0
          ? context.positionals.map((file) => normalizePath(file, context.cwd))
          : engine.graph.files();

      if (files.length === 0) {
        context.output.err('Nenhum arquivo para testar.');
        return EXIT.ok;
      }

      const result = await engine.runFiles(files);
      switch (result.status) {
        case 'passed':
        case 'skipped':
          return EXIT.ok;
        case 'failed':
          return EXIT.testsFailed;
        default:
          return EXIT.internal;
      }
    } finally {
      await engine.stop('execucao unica concluida');
    }
  },
};
