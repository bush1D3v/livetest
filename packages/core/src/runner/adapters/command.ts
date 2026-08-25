/**
 * Adapter generico de comando.
 *
 * Executa um comando arbitrario e classifica o resultado apenas pelo codigo de
 * saida. E a porta de entrada para qualquer linguagem que ainda nao tenha um
 * adapter dedicado: basta apontar `runners.<chave>.command` para o comando de
 * teste do projeto.
 *
 * Como nao ha relatorio estruturado, `cases` fica vazio e as contagens refletem
 * apenas "uma execucao passou ou falhou".
 *
 * @packageDocumentation
 */

import type { TestRunnerAdapter } from '../../types/runner.js';
import { interpretProcessFailure, relativeTestPaths, runnerCwd } from './shared.js';

/**
 * Cria o adapter generico.
 *
 * @example
 * ```jsonc
 * // livetest.config.json
 * { "runners": { "go": { "adapter": "command", "command": "go",
 *                        "args": ["test"], "match": ["**\/*.go"] } } }
 * ```
 */
export function createCommandAdapter(): TestRunnerAdapter {
  return {
    id: 'command',
    reportFileExtension: null,

    buildInvocation(testFiles, context) {
      const cwd = runnerCwd(context);
      const { config } = context;
      return {
        command: config.command ?? 'echo',
        args: [...(config.args ?? []), ...relativeTestPaths(testFiles, cwd)],
        cwd,
        env: config.env ?? {},
        reportFile: null,
        timeoutMs: config.timeoutMs ?? 120_000,
      };
    },

    parseOutput(output) {
      const failure = interpretProcessFailure(output);
      if (failure) return failure;

      const passed = output.exitCode === 0;
      return {
        status: passed ? 'passed' : 'failed',
        counts: { total: 1, passed: passed ? 1 : 0, failed: passed ? 0 : 1, skipped: 0 },
        cases: [],
        error: null,
      };
    },
  };
}
