/**
 * Registro de adapters de test runner.
 * @packageDocumentation
 */

import type { TestRunnerAdapter } from '../types/runner.js';
import { createCommandAdapter } from './adapters/command.js';
import { createJestAdapter, createVitestAdapter } from './adapters/jest-like.js';
import { createPytestAdapter } from './adapters/pytest.js';

/** Fabricas embutidas, indexadas pelo id usado em `runners[].adapter`. */
export const BUILTIN_RUNNER_ADAPTERS: Readonly<Record<string, () => TestRunnerAdapter>> = {
  vitest: createVitestAdapter,
  jest: createJestAdapter,
  pytest: createPytestAdapter,
  command: createCommandAdapter,
};

/**
 * Instancia o adapter de um id.
 *
 * @param id - Valor de `runners[].adapter`.
 * @param custom - Fabricas extras, que sobrepoem as embutidas.
 * @returns O adapter, ou `null` quando o id e desconhecido.
 */
export function createRunnerAdapter(
  id: string,
  custom?: Readonly<Record<string, () => TestRunnerAdapter>>,
): TestRunnerAdapter | null {
  const factory = custom?.[id] ?? BUILTIN_RUNNER_ADAPTERS[id];
  return factory ? factory() : null;
}
