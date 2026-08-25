/**
 * Adapters do Vitest e do Jest.
 *
 * Os dois compartilham o esquema de relatorio JSON, entao dividem tambem o
 * parser; muda apenas a montagem da linha de comando.
 *
 * @packageDocumentation
 */

import type {
  RunnerAdapterContext,
  RunnerInvocation,
  RunnerParseResult,
  RunnerProcessOutput,
  TestRunnerAdapter,
} from '../../types/runner.js';
import { parseJestLikeJson } from '../parsers/jest-like.js';
import { erroredResult, interpretProcessFailure, relativeTestPaths, runnerCwd } from './shared.js';

/** Monta uma invocacao a partir dos argumentos base do runner. */
function buildJsInvocation(
  baseArgs: string[],
  testFiles: string[],
  context: RunnerAdapterContext,
): RunnerInvocation {
  const cwd = runnerCwd(context);
  const { config } = context;
  // Sem `command` explicito usamos `npx`, que encontra o binario local do
  // projeto sem exigir instalacao global.
  const command = config.command ?? 'npx';
  const prefix = config.command ? [] : [baseArgs[0] as string];

  return {
    command,
    args: [...prefix, ...baseArgs.slice(1), ...(config.args ?? []), ...relativeTestPaths(testFiles, cwd)],
    cwd,
    env: config.env ?? {},
    reportFile: null,
    timeoutMs: config.timeoutMs ?? 120_000,
  };
}

/** Le o relatorio JSON produzido pelo runner, com mensagens de erro uteis. */
function parseJsReport(output: RunnerProcessOutput, runnerName: string): RunnerParseResult {
  const failure = interpretProcessFailure(output);
  if (failure) return failure;

  if (output.reportContent === null || output.reportContent.trim() === '') {
    // Sem relatorio o exit code ainda diz se passou; e o caminho de degradacao
    // quando o runner morre antes de escrever o arquivo.
    if (output.exitCode === 0) {
      return { status: 'passed', counts: { total: 0, passed: 0, failed: 0, skipped: 0 }, cases: [], error: null };
    }
    const detail = output.stderr.trim() || output.stdout.trim();
    return erroredResult(
      `${runnerName} nao produziu relatorio (exit ${output.exitCode})${detail ? `: ${detail.slice(0, 500)}` : ''}`,
    );
  }

  return parseJestLikeJson(output.reportContent);
}

/**
 * Adapter do Vitest.
 *
 * Linha de comando gerada: `npx vitest run --reporter=json --outputFile=<tmp>
 * --passWithNoTests <arquivos>`.
 */
export function createVitestAdapter(): TestRunnerAdapter {
  return {
    id: 'vitest',
    reportFileExtension: '.json',
    buildInvocation(testFiles, context, reportFile) {
      const invocation = buildJsInvocation(
        [
          'vitest',
          'run',
          '--reporter=json',
          ...(reportFile ? [`--outputFile=${reportFile}`] : []),
          '--passWithNoTests',
        ],
        testFiles,
        context,
      );
      return { ...invocation, reportFile };
    },
    parseOutput: (output) => parseJsReport(output, 'vitest'),
  };
}

/**
 * Adapter do Jest.
 *
 * Linha de comando gerada: `npx jest --json --outputFile=<tmp>
 * --passWithNoTests --runTestsByPath <arquivos>`.
 */
export function createJestAdapter(): TestRunnerAdapter {
  return {
    id: 'jest',
    reportFileExtension: '.json',
    buildInvocation(testFiles, context, reportFile) {
      const invocation = buildJsInvocation(
        [
          'jest',
          '--json',
          ...(reportFile ? [`--outputFile=${reportFile}`] : []),
          '--passWithNoTests',
          '--runTestsByPath',
        ],
        testFiles,
        context,
      );
      return { ...invocation, reportFile };
    },
    parseOutput: (output) => parseJsReport(output, 'jest'),
  };
}
