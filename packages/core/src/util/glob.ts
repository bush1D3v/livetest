/**
 * Casamento de globs.
 *
 * Encapsula o `picomatch` para (a) garantir que sempre comparamos caminhos
 * relativos a raiz no formato POSIX e (b) oferecer a semantica de "ultimo glob
 * que casa vence", usada nos overrides de profundidade.
 *
 * @packageDocumentation
 */

import picomatch from 'picomatch';
import { relativeToRoot, toPosix } from './paths.js';

/** Predicado compilado a partir de uma lista de globs. */
export type GlobMatcher = (absolutePath: string) => boolean;

const PICOMATCH_OPTIONS: picomatch.PicomatchOptions = { dot: true, posixSlashes: true };

/**
 * Compila uma lista de globs em um predicado.
 *
 * O predicado testa tanto o caminho relativo a raiz quanto o absoluto,
 * permitindo que o usuario escreva `src/**\/*.ts` ou `**\/*.ts` indistintamente.
 *
 * @param patterns - Globs no estilo `picomatch`. Lista vazia nunca casa.
 * @param root - Raiz do projeto usada para relativizar o caminho testado.
 */
export function createMatcher(patterns: readonly string[], root: string): GlobMatcher {
  if (patterns.length === 0) return () => false;
  const isMatch = picomatch(patterns as string[], PICOMATCH_OPTIONS);
  return (absolutePath: string): boolean => {
    const rel = relativeToRoot(root, absolutePath);
    return isMatch(rel) || isMatch(toPosix(absolutePath));
  };
}

/**
 * Encontra a **ultima** entrada cujo glob casa com o caminho.
 *
 * A ordem de insercao das chaves do objeto e preservada, permitindo escrever
 * uma regra geral seguida de excecoes mais especificas.
 *
 * @returns O valor associado, ou `undefined` se nenhum glob casar.
 */
export function matchLastEntry<T>(
  entries: Readonly<Record<string, T>>,
  absolutePath: string,
  root: string,
): T | undefined {
  let found: T | undefined;
  for (const [pattern, value] of Object.entries(entries)) {
    if (createMatcher([pattern], root)(absolutePath)) found = value;
  }
  return found;
}
