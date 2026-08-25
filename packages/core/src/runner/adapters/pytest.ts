/**
 * Adapter do pytest.
 *
 * Usa `--junitxml`, que e nativo do pytest e nao exige plugin, e forca
 * `junit_family=xunit1` porque so essa familia inclui o atributo `file` em cada
 * `<testcase>` — sem ele nao daria para associar um caso ao seu arquivo na
 * arvore da extensao do VSCode.
 *
 * @packageDocumentation
 */

import type { TestRunnerAdapter } from '../../types/runner.js';
import { parseJUnitXml } from '../parsers/junit-xml.js';
import { erroredResult, interpretProcessFailure, relativeTestPaths, runnerCwd } from './shared.js';

/** Codigo de saida do pytest quando nenhum teste foi coletado. */
const EXIT_NO_TESTS_COLLECTED = 5;

/**
 * Cria o adapter do pytest.
 *
 * Linha de comando gerada: `python -m pytest --junitxml=<tmp>
 * -o junit_family=xunit1 -q <arquivos>`.
 */
export function createPytestAdapter(): TestRunnerAdapter {
  return {
    id: 'pytest',
    reportFileExtension: '.xml',

    buildInvocation(testFiles, context, reportFile) {
      const cwd = runnerCwd(context);
      const { config } = context;
      const command = config.command ?? context.pythonPath;
      const prefix = config.command ? [] : ['-m', 'pytest'];

      return {
        command,
        args: [
          ...prefix,
          ...(reportFile ? [`--junitxml=${reportFile}`, '-o', 'junit_family=xunit1'] : []),
          '-q',
          ...(config.args ?? []),
          ...relativeTestPaths(testFiles, cwd),
        ],
        cwd,
        env: config.env ?? {},
        reportFile,
        timeoutMs: config.timeoutMs ?? 120_000,
      };
    },

    parseOutput(output, context) {
      const failure = interpretProcessFailure(output);
      if (failure) return failure;

      if (output.exitCode === EXIT_NO_TESTS_COLLECTED) {
        return {
          status: 'skipped',
          counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
          cases: [],
          error: null,
        };
      }

      if (output.reportContent === null || output.reportContent.trim() === '') {
        const detail = output.stderr.trim() || output.stdout.trim();
        return erroredResult(
          `pytest nao produziu relatorio (exit ${output.exitCode})${detail ? `: ${detail.slice(0, 500)}` : ''}`,
        );
      }

      return parseJUnitXml(output.reportContent, { root: runnerCwd(context) });
    },
  };
}
