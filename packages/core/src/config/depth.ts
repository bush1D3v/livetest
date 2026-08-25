/**
 * Resolucao da profundidade de dependencia aplicavel a um arquivo.
 * @packageDocumentation
 */

import type { DependencyDepth, ResolvedConfig } from '../types/config.js';
import { matchLastEntry } from '../util/glob.js';
import { depthToNumber } from './validate.js';

/** Profundidade escolhida para um arquivo, com a regra que a originou. */
export interface ResolvedDepth {
  /** Valor declarado na configuracao. */
  depth: DependencyDepth;
  /** Numero de saltos correspondente (`Infinity` para `transitive`). */
  hops: number;
  /** Glob do override que venceu, ou `null` quando o default foi usado. */
  matchedOverride: string | null;
}

/**
 * Resolve a profundidade de propagacao para um arquivo especifico.
 *
 * Overrides sao avaliados na ordem de declaracao e **o ultimo que casar vence**,
 * permitindo escrever uma regra ampla seguida de excecoes.
 *
 * @example
 * ```ts
 * // overrides: { "src/**": "self", "src/components/Login.tsx": "transitive" }
 * resolveDepthForFile(config, '/proj/src/components/Login.tsx').depth; // 'transitive'
 * resolveDepthForFile(config, '/proj/src/utils/date.ts').depth;        // 'self'
 * ```
 */
export function resolveDepthForFile(config: ResolvedConfig, file: string): ResolvedDepth {
  const { overrides, default: fallback } = config.dependencyDepth;

  let matchedOverride: string | null = null;
  for (const pattern of Object.keys(overrides)) {
    if (matchLastEntry({ [pattern]: true }, file, config.root) === true) {
      matchedOverride = pattern;
    }
  }

  const depth = matchedOverride !== null ? (overrides[matchedOverride] as DependencyDepth) : fallback;
  return { depth, hops: depthToNumber(depth), matchedOverride };
}
