/**
 * `livetest start` — sobe o daemon em primeiro plano.
 *
 * Este e o comando que o agente de IA deve iniciar em background: ele imprime o
 * relatorio no stdout, mantem `.livetest/run.log` e `.livetest/status.json`
 * atualizados e abre o canal de eventos para a extensao do VSCode.
 *
 * @packageDocumentation
 */

import { createEngine } from '@livetest/core';

import type { Command, CommandContext } from '../context.js';
import { CONFIG_OVERRIDE_FLAGS, EXIT, loadConfigForCommand } from '../context.js';

/** Sinais que encerram o daemon de forma limpa. */
const STOP_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

/** Implementacao de `livetest start`. */
export const startCommand: Command = {
  name: 'start',
  summary: 'Observa o projeto e roda os testes afetados a cada save',
  usage: 'livetest start [opcoes]',
  flags: {
    ...CONFIG_OVERRIDE_FLAGS,
    port: { type: 'number', description: 'Porta do canal de eventos (0 = automatica)', valueName: 'porta' },
    'no-server': { type: 'boolean', description: 'Nao abre o canal de eventos da extensao' },
    once: { type: 'boolean', description: 'Roda um lote com todos os arquivos e encerra' },
  },
  details: [
    'Encerre com Ctrl+C. O arquivo .livetest/daemon.json e removido ao sair.',
    '',
    'Para um agente de IA, a linha "LIVETEST batch=... status=..." ao fim de cada',
    'lote resume o resultado sem precisar de parser dedicado.',
  ],

  async run(context: CommandContext): Promise<number> {
    // Passar `--port` sem `enabled: true` seria um pedido sem efeito quando a
    // configuracao desliga o canal: a flag liga o servidor por implicacao.
    const serverOverride =
      context.flags['no-server'] === true
        ? { enabled: false }
        : typeof context.flags['port'] === 'number'
          ? { enabled: true, port: context.flags['port'] }
          : undefined;

    const { config } = await loadConfigForCommand(
      context,
      serverOverride ? { server: serverOverride } : {},
    );

    const engine = createEngine({ config });
    await engine.start();

    if (context.flags['once'] === true) {
      const result = await engine.runFiles(engine.graph.files());
      await engine.stop('execucao unica concluida');
      return result.status === 'passed' || result.status === 'skipped'
        ? EXIT.ok
        : EXIT.testsFailed;
    }

    await new Promise<void>((resolve) => {
      let stopping = false;
      const handler = (signal: NodeJS.Signals): void => {
        if (stopping) return;
        stopping = true;
        void engine.stop(`sinal ${signal}`).finally(() => resolve());
      };
      for (const signal of STOP_SIGNALS) process.on(signal, handler);
    });

    return EXIT.ok;
  },
};
