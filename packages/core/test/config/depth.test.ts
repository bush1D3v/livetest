import { describe, expect, it } from 'vitest';

import { resolveDepthForFile } from '../../src/config/depth.js';
import { resolveConfig } from '../../src/config/load.js';
import type { DependencyDepth } from '../../src/types/config.js';
import { normalizePath } from '../../src/util/paths.js';

const root = normalizePath('/proj');

function configWith(
  fallback: DependencyDepth,
  overrides: Record<string, DependencyDepth> = {},
) {
  return resolveConfig(
    { useGitignore: false, dependencyDepth: { default: fallback, overrides } },
    { root },
  ).config;
}

describe('resolveDepthForFile', () => {
  it('usa o default quando nenhum override casa', () => {
    const result = resolveDepthForFile(configWith('direct'), normalizePath('src/a.ts', root));
    expect(result).toEqual({ depth: 'direct', hops: 1, matchedOverride: null });
  });

  it('aplica o override que casa', () => {
    const config = configWith('self', { 'src/components/Login.tsx': 'transitive' });
    const result = resolveDepthForFile(config, normalizePath('src/components/Login.tsx', root));
    expect(result.depth).toBe('transitive');
    expect(result.hops).toBe(Number.POSITIVE_INFINITY);
    expect(result.matchedOverride).toBe('src/components/Login.tsx');
  });

  it('faz o ultimo override que casa vencer', () => {
    const config = configWith('direct', {
      'src/**': 'self',
      'src/components/**': 'transitive',
    });
    expect(resolveDepthForFile(config, normalizePath('src/util/x.ts', root)).depth).toBe('self');
    expect(
      resolveDepthForFile(config, normalizePath('src/components/Login.tsx', root)).depth,
    ).toBe('transitive');
  });

  it('aceita profundidade numerica', () => {
    const config = configWith('direct', { 'src/**': 2 });
    expect(resolveDepthForFile(config, normalizePath('src/a.ts', root)).hops).toBe(2);
  });

  it('cobre o caso de teste do PRD: login importado por header e footer', () => {
    const config = configWith('self', {
      'src/login.ts': 'transitive',
      'src/legacy.ts': 'self',
    });
    expect(resolveDepthForFile(config, normalizePath('src/login.ts', root)).hops).toBe(Infinity);
    expect(resolveDepthForFile(config, normalizePath('src/legacy.ts', root)).hops).toBe(0);
  });
});
