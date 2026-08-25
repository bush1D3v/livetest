/**
 * `livetest watch` — acompanha, em um segundo terminal, um daemon ja em execucao.
 *
 * O daemon so escreve o relatorio no stdout do proprio processo. Quando ele foi
 * iniciado em background por um agente de IA, este comando e a forma de um
 * humano (ou de outro agente) ver o mesmo fluxo em tempo real.
 *
 * @packageDocumentation
 */

import { connectToDaemon, createPrettyReporter } from '@livetest/core';

import type { Command, CommandContext } from '../context.js';
import { EXIT, loadConfigForCommand } from '../context.js';

/** Implementacao de `livetest watch`. */
export const watchCommand: Command = {
  name: 'watch',
  summary: 'Acompanha os eventos de um daemon ja em execucao',
  usage: 'livetest watch [opcoes]',
  flags: {
    json: { type: 'boolean', description: 'Imprime os eventos crus em NDJSON' },
    'no-color': { type: 'boolean', description: 'Desliga as cores' },
  },
  details: ['Encerre com Ctrl+C. Nao inicia o daemon; use `livetest start` para isso.'],

  async run(context: CommandContext): Promise<number> {
    const { config } = await loadConfigForCommand(context);
    const asJson = context.flags['json'] === true;

    const reporter = createPrettyReporter({
      root: config.root,
      color: context.flags['no-color'] === true ? false : 'auto',
      write: (line) => context.output.out(line),
    });

    const closed = { reason: '' };
    const connection = await connectToDaemon({
      root: config.root,
      discoveryFile: config.server.discoveryFile,
      onEvent: (event) => {
        if (asJson) {
          context.output.out(JSON.stringify(event));
          return;
        }
        if (event.type === 'snapshot') {
          const { state } = event;
          context.output.out(
            `livetest conectado a ${state.root} (pid ${state.pid}, ` +
              `${state.files.length} arquivos, ${state.totals.batches} lote(s) ate agora)`,
          );
          return;
        }
        reporter.handle(event);
      },
      onClose: (reason) => {
        closed.reason = reason;
      },
    });

    context.output.err(`conectado em ${connection.address.host}:${connection.address.port}`);

    await new Promise<void>((resolve) => {
      const stop = (): void => {
        connection.close();
        resolve();
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      const poll = setInterval(() => {
        if (closed.reason !== '') {
          clearInterval(poll);
          resolve();
        }
      }, 200);
      poll.unref?.();
    });

    if (closed.reason !== '') context.output.err(`desconectado: ${closed.reason}`);
    return EXIT.ok;
  },
};
