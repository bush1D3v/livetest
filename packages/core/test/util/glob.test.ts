import { describe, expect, it } from 'vitest';

import { createMatcher, matchLastEntry } from '../../src/util/glob.js';
import { normalizePath } from '../../src/util/paths.js';

const root = normalizePath('/proj');
const file = (relative: string): string => normalizePath(relative, root);

describe('createMatcher', () => {
  it('casa pelo caminho relativo a raiz', () => {
    const match = createMatcher(['src/**/*.ts'], root);
    expect(match(file('src/a/b.ts'))).toBe(true);
    expect(match(file('lib/a.ts'))).toBe(false);
  });

  it('aceita glob global sem prefixo de diretorio', () => {
    const match = createMatcher(['**/*.py'], root);
    expect(match(file('app/core/db.py'))).toBe(true);
    expect(match(file('app/core/db.ts'))).toBe(false);
  });

  it('casa arquivos ocultos (dot: true)', () => {
    expect(createMatcher(['**/.livetest/**'], root)(file('.livetest/run.log'))).toBe(true);
  });

  it('nunca casa quando a lista de padroes e vazia', () => {
    expect(createMatcher([], root)(file('a.ts'))).toBe(false);
  });

  it('aceita varios padroes em OR', () => {
    const match = createMatcher(['**/*.ts', '**/*.py'], root);
    expect(match(file('a.ts'))).toBe(true);
    expect(match(file('a.py'))).toBe(true);
    expect(match(file('a.go'))).toBe(false);
  });
});

describe('matchLastEntry', () => {
  it('devolve o valor do ultimo glob que casa', () => {
    const entries = { 'src/**': 'self', 'src/components/Login.tsx': 'transitive' };
    expect(matchLastEntry(entries, file('src/components/Login.tsx'), root)).toBe('transitive');
    expect(matchLastEntry(entries, file('src/util/date.ts'), root)).toBe('self');
  });

  it('devolve undefined quando nenhum glob casa', () => {
    expect(matchLastEntry({ 'src/**': 1 }, file('lib/a.ts'), root)).toBeUndefined();
  });
});
