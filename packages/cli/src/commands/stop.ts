/**
 * `livetest stop` — encerra o daemon em execucao.
 * @packageDocumentation
 */

import { isProcessAlive, readDiscoveryFile, removeDiscoveryFile } from '@livetest/core';

import type { Command, CommandContext, OutputChannel } from '../context.js';
import { EXIT, loadConfigForCommand } from '../context.js';

/** Tempo maximo padrao, em ms, aguardando o daemon encerrar apos o sinal. */
const SHUTDOWN_TIMEOUT_MS = 4000;

/** Intervalo entre verificacoes de encerramento. */
const POLL_INTERVAL_MS = 100;

/**
 * Aguarda o processo sair.
 *
 * @param pid - Processo observado.
 * @param timeoutMs - Prazo maximo de espera.
 * @param alive - Predicado de liveness. Injetavel para teste: encenar um
 * processo que se recusa a morrer nao e possivel de forma portavel.
 * @returns `true` se o processo encerrou dentro do prazo.
 */
export async function waitForExit(
  pid: number,
  timeoutMs: number,
  alive: (pid: number) => boolean = isProcessAlive,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return !alive(pid);
}

/** Implementacao de `livetest stop`. */
export const stopCommand: Command = {
  name: 'stop',
  summary: 'Encerra o daemon em execucao',
  usage: 'livetest stop [opcoes]',
  flags: {
    force: { type: 'boolean', description: 'Usa SIGKILL em vez de SIGTERM' },
    timeout: {
      type: 'number',
      description: 'Tempo maximo de espera pelo encerramento, em ms',
      valueName: 'ms',
    },
  },

  async run(context: CommandContext): Promise<number> {
    const { config } = await loadConfigForCommand(context);
    const discovery = readDiscoveryFile(config.server.discoveryFile, config.root);

    if (discovery.status === 'stale') {
      removeDiscoveryFile(config.server.discoveryFile, config.root);
      context.output.out('Nenhum daemon rodando; registro obsoleto removido.');
      return EXIT.ok;
    }
    if (discovery.status !== 'running') {
      context.output.err('Nenhum daemon em execucao.');
      return EXIT.daemon;
    }

    const signal: NodeJS.Signals = context.flags['force'] === true ? 'SIGKILL' : 'SIGTERM';
    try {
      process.kill(discovery.info.pid, signal);
    } catch (error) {
      context.output.err(
        `Nao foi possivel encerrar o processo ${discovery.info.pid}: ${(error as Error).message}`,
      );
      return EXIT.daemon;
    }

    context.output.out(`Sinal ${signal} enviado ao daemon (pid ${discovery.info.pid}).`);

    const flagTimeout = context.flags['timeout'];
    const timeoutMs = typeof flagTimeout === 'number' ? flagTimeout : SHUTDOWN_TIMEOUT_MS;

    return confirmarEncerramento({
      pid: discovery.info.pid,
      timeoutMs,
      output: context.output,
      discoveryFile: config.server.discoveryFile,
      root: config.root,
    });
  },
};

/** Opcoes de {@link confirmarEncerramento}. */
export interface ConfirmarEncerramentoOptions {
  /** Processo que recebeu o sinal. */
  pid: number;
  /** Prazo de espera pelo encerramento, em ms. */
  timeoutMs: number;
  output: OutputChannel;
  /** Arquivo de descoberta a limpar. */
  discoveryFile: string;
  root: string;
  /**
   * Predicado de liveness. Injetavel para teste: nao ha forma portavel de
   * encenar um processo que sobrevive ao sinal — no Windows o `SIGTERM` sempre
   * termina, e no Linux depende de o processo instalar um handler.
   */
  alive?: (pid: number) => boolean;
}

/**
 * Aguarda o daemon sair e limpa o registro de descoberta.
 *
 * @returns Codigo de saida do comando.
 */
export async function confirmarEncerramento(
  options: ConfirmarEncerramentoOptions,
): Promise<number> {
  const { pid, output, discoveryFile, root } = options;

  const exited = await waitForExit(pid, options.timeoutMs, options.alive);
  if (!exited) {
    output.err(`O daemon (pid ${pid}) ainda esta rodando. Tente novamente com --force.`);
    return EXIT.daemon;
  }

  // No Windows o SIGTERM encerra o processo sem executar os handlers, entao a
  // limpeza que o daemon faria ao sair nao acontece. Como aqui ja sabemos que
  // ele morreu, removemos o registro para nao deixar um arquivo orfao.
  if (readDiscoveryFile(discoveryFile, root).status !== 'absent') {
    removeDiscoveryFile(discoveryFile, root);
  }

  output.out('Daemon encerrado.');
  return EXIT.ok;
}
