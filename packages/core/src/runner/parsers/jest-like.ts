/**
 * Parser do relatorio JSON no formato do Jest.
 *
 * O Vitest adota o mesmo esquema do Jest no reporter `json`, entao um unico
 * parser atende os dois runners. O formato relevante e:
 *
 * ```json
 * {
 *   "numTotalTests": 2, "numPassedTests": 1, "numFailedTests": 1,
 *   "testResults": [{
 *     "name": "/abs/login.test.ts",
 *     "assertionResults": [
 *       { "fullName": "login > funciona", "status": "passed", "duration": 3 },
 *       { "fullName": "login > falha", "status": "failed", "failureMessages": ["..."] }
 *     ]
 *   }]
 * }
 * ```
 *
 * O parser nunca lanca: entradas malformadas viram um resultado `errored` com
 * a mensagem correspondente, para que o daemon siga rodando.
 *
 * @packageDocumentation
 */

import type { TestCaseResult, TestCaseStatus, TestCounts } from '../../types/results.js';
import type { RunnerParseResult } from '../../types/runner.js';
import { normalizePath } from '../../util/paths.js';

/** Mapeia os status do Jest/Vitest para os do Live Test Runner. */
function mapStatus(raw: unknown): TestCaseStatus {
  switch (raw) {
    case 'passed':
      return 'passed';
    case 'failed':

      return 'failed';
    default:
      // `pending`, `skipped`, `todo`, `disabled`.
      return 'skipped';
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Conta os casos por status. */
export function countCases(cases: readonly TestCaseResult[]): TestCounts {
  return {
    total: cases.length,
    passed: cases.filter((c) => c.status === 'passed').length,
    failed: cases.filter((c) => c.status === 'failed').length,
    skipped: cases.filter((c) => c.status === 'skipped').length,
  };
}

/**
 * Interpreta o conteudo de um relatorio JSON do Jest/Vitest.
 *
 * @param content - Conteudo bruto do arquivo de relatorio.
 * @returns Resultado estruturado; `status: 'errored'` quando o JSON e invalido.
 */
export function parseJestLikeJson(content: string): RunnerParseResult {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    return {
      status: 'errored',
      counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
      cases: [],
      error: `relatorio JSON invalido: ${(error as Error).message}`,
    };
  }

  const cases: TestCaseResult[] = [];
  for (const suite of asArray(payload['testResults'])) {
    const suiteRecord = suite as Record<string, unknown>;
    const file = asString(suiteRecord['name']);
    const normalizedFile = file ? normalizePath(file) : null;

    for (const assertion of asArray(suiteRecord['assertionResults'])) {
      const record = assertion as Record<string, unknown>;
      const title = asString(record['fullName']) ?? asString(record['title']) ?? '(sem nome)';
      cases.push({
        fullName: title,
        file: normalizedFile,
        status: mapStatus(record['status']),
        durationMs: typeof record['duration'] === 'number' ? record['duration'] : null,
        failureMessages: asArray(record['failureMessages']).filter(
          (m): m is string => typeof m === 'string',
        ),
      });
    }
  }

  const counts = countCases(cases);
  return {
    status: counts.failed > 0 ? 'failed' : 'passed',
    counts,
    cases,
    error: null,
  };
}
