import { describe, expect, it } from 'vitest';

import { resolveConfig } from '../../src/config/load.js';
import { createTestFileResolver, expandTemplate } from '../../src/testmap/resolver.js';
import type { LiveTestUserConfig } from '../../src/types/config.js';
import { normalizePath } from '../../src/util/paths.js';
import { createTempProject } from '../helpers/tmp.js';

const root = normalizePath('/proj');
const p = (relative: string): string => normalizePath(relative, root);

function resolverFor(files: string[], user: LiveTestUserConfig = {}) {
  const { config } = resolveConfig({ useGitignore: false, ...user }, { root });
  const set = new Set(files.map((f) => p(f)));
  return createTestFileResolver({ config, exists: (c) => set.has(normalizePath(c)) });
}

describe('expandTemplate', () => {
  it('expande {dir}, {name} e {ext}', () => {
    expect(expandTemplate('{dir}/{name}.test.{ext}', p('src/login.ts'), root, 'ts')).toBe(
      p('src/login.test.ts'),
    );
  });

  it('expande {relDir} a partir da raiz', () => {
    expect(
      expandTemplate('tests/{relDir}/test_{name}.py', p('app/core/db.py'), root, 'py'),
    ).toBe(p('tests/app/core/test_db.py'));
  });

  it('expande {relDirTail} removendo o primeiro segmento', () => {
    expect(expandTemplate('test/{relDirTail}/{name}.test.{ext}', p('src/util/a.ts'), root, 'ts'))
      .toBe(p('test/util/a.test.ts'));
  });

  it('colapsa barras duplicadas quando um token fica vazio', () => {
    expect(expandTemplate('tests/{relDirTail}/test_{name}.py', p('app/db.py'), root, 'py')).toBe(
      p('tests/test_db.py'),
    );
  });

  it('trata {relDir} vazio para arquivo na raiz', () => {
    expect(expandTemplate('tests/{relDir}/test_{name}.py', p('db.py'), root, 'py')).toBe(
      p('tests/test_db.py'),
    );
  });
});

describe('TestFileResolver — JS/TS', () => {
  it('encontra teste ao lado do fonte', () => {
    const resolver = resolverFor(['src/login.ts', 'src/login.test.ts']);
    expect(resolver.resolve(p('src/login.ts')).testFiles).toEqual([p('src/login.test.ts')]);
  });

  it('encontra teste .spec', () => {
    const resolver = resolverFor(['src/login.spec.ts']);
    expect(resolver.resolve(p('src/login.ts')).testFiles).toEqual([p('src/login.spec.ts')]);
  });

  it('encontra teste em __tests__', () => {
    const resolver = resolverFor(['src/__tests__/login.test.ts']);
    expect(resolver.resolve(p('src/login.ts')).testFiles).toEqual([
      p('src/__tests__/login.test.ts'),
    ]);
  });

  it('encontra teste espelhado em test/ na raiz', () => {
    const resolver = resolverFor(['test/util/date.test.ts']);
    expect(resolver.resolve(p('src/util/date.ts')).testFiles).toEqual([
      p('test/util/date.test.ts'),
    ]);
  });

  it('encontra teste .ts para um componente .tsx', () => {
    const resolver = resolverFor(['src/Botao.test.ts']);
    expect(resolver.resolve(p('src/Botao.tsx')).testFiles).toEqual([p('src/Botao.test.ts')]);
  });

  it('devolve varios testes quando mais de um existe', () => {
    const resolver = resolverFor(['src/a.test.ts', 'src/__tests__/a.spec.ts']);
    expect(resolver.resolve(p('src/a.ts')).testFiles.sort()).toEqual([
      p('src/__tests__/a.spec.ts'),
      p('src/a.test.ts'),
    ]);
  });

  it('devolve lista vazia quando nao ha teste', () => {
    const resolver = resolverFor(['src/a.ts']);
    const mapping = resolver.resolve(p('src/a.ts'));
    expect(mapping.testFiles).toEqual([]);
    expect(mapping.runnerKey).toBe('js');
  });

  it('reconhece um arquivo de teste como seu proprio teste', () => {
    const resolver = resolverFor(['src/a.test.ts']);
    const mapping = resolver.resolve(p('src/a.test.ts'));
    expect(mapping.isTestFile).toBe(true);
    expect(mapping.testFiles).toEqual([p('src/a.test.ts')]);
  });
});

describe('TestFileResolver — Python', () => {
  it('encontra test_x.py ao lado do fonte', () => {
    const resolver = resolverFor(['app/test_login.py']);
    expect(resolver.resolve(p('app/login.py')).testFiles).toEqual([p('app/test_login.py')]);
  });

  it('encontra x_test.py', () => {
    const resolver = resolverFor(['app/login_test.py']);
    expect(resolver.resolve(p('app/login.py')).testFiles).toEqual([p('app/login_test.py')]);
  });

  it('encontra teste espelhado em tests/', () => {
    const resolver = resolverFor(['tests/app/core/test_db.py']);
    expect(resolver.resolve(p('app/core/db.py')).testFiles).toEqual([
      p('tests/app/core/test_db.py'),
    ]);
  });

  it('reconhece conftest.py como arquivo de teste', () => {
    const resolver = resolverFor(['app/conftest.py']);
    expect(resolver.resolve(p('app/conftest.py')).isTestFile).toBe(true);
  });
});

describe('TestFileResolver — roteamento de runner', () => {
  it('escolhe o runner pela extensao', () => {
    const resolver = resolverFor([]);
    expect(resolver.runnerKeyFor(p('src/a.ts'))).toBe('js');
    expect(resolver.runnerKeyFor(p('app/a.py'))).toBe('python');
  });

  it('devolve null para arquivo sem runner', () => {
    const resolver = resolverFor([]);
    expect(resolver.runnerKeyFor(p('README.md'))).toBeNull();
    expect(resolver.resolve(p('README.md'))).toMatchObject({ runnerKey: null, testFiles: [] });
  });

  it('respeita templates customizados', () => {
    const resolver = resolverFor(['spec/login.spec.ts'], {
      runners: { js: { testPatterns: ['spec/{relDirTail}/{name}.spec.{ext}'] } },
    });
    expect(resolver.resolve(p('src/login.ts')).testFiles).toEqual([p('spec/login.spec.ts')]);
  });

  it('candidatesFor lista os caminhos testados sem filtrar', () => {
    const resolver = resolverFor([]);
    const candidates = resolver.candidatesFor(p('src/login.ts'));
    expect(candidates).toContain(p('src/login.test.ts'));
    expect(candidates).toContain(p('src/__tests__/login.spec.tsx'));
  });
});

describe('TestFileResolver — sistema de arquivos real', () => {
  it('encontra o teste em disco', () => {
    const project = createTempProject({
      'src/login.ts': 'export const login = 1;',
      'src/login.test.ts': 'test("x", () => {});',
    });
    try {
      const { config } = resolveConfig({ useGitignore: false }, { root: project.root });
      const resolver = createTestFileResolver({ config });
      expect(resolver.resolve(project.path('src/login.ts')).testFiles).toEqual([
        project.path('src/login.test.ts'),
      ]);
    } finally {
      project.cleanup();
    }
  });
});

describe('TestFileResolver — casos de borda', () => {
  it('isTestFile devolve false para arquivo sem runner', () => {
    const resolver = resolverFor(['README.md']);
    expect(resolver.isTestFile(p('README.md'))).toBe(false);
  });

  it('isTestFile devolve false para fonte comum', () => {
    const resolver = resolverFor(['src/a.ts']);
    expect(resolver.isTestFile(p('src/a.ts'))).toBe(false);
  });

  it('candidatesFor devolve vazio para arquivo sem runner', () => {
    expect(resolverFor([]).candidatesFor(p('README.md'))).toEqual([]);
  });

  it('expande template sem {ext} uma unica vez', () => {
    const resolver = resolverFor(['src/login.fixture'], {
      runners: { js: { testPatterns: ['{dir}/{name}.fixture'] } },
    });
    expect(resolver.candidatesFor(p('src/login.ts'))).toEqual([p('src/login.fixture')]);
  });

  it('aceita template com caminho absoluto', () => {
    const absoluto = `${root}/spec/{name}.test.ts`;
    const resolver = resolverFor(['spec/login.test.ts'], {
      runners: { js: { testPatterns: [absoluto] } },
    });
    expect(resolver.resolve(p('src/login.ts')).testFiles).toEqual([p('spec/login.test.ts')]);
  });

  it('usa o sistema de arquivos real quando nenhum predicado e injetado', () => {
    const project = createTempProject({ 'src/a.ts': '', 'src/a.test.ts': '' });
    try {
      const { config } = resolveConfig({ useGitignore: false }, { root: project.root });
      const resolver = createTestFileResolver({ config });
      expect(resolver.resolve(project.path('src/a.ts')).testFiles).toEqual([
        project.path('src/a.test.ts'),
      ]);
      // Diretorio nao e arquivo: nao pode ser considerado um teste existente.
      expect(resolver.resolve(project.path('src/inexistente.ts')).testFiles).toEqual([]);
    } finally {
      project.cleanup();
    }
  });
});

describe('TestFileResolver — runner com campos opcionais ausentes', () => {
  it('trata testMatch, testPatterns e testExtensions ausentes como listas vazias', () => {
    const { config } = resolveConfig({ useGitignore: false }, { root });
    const minimo = {
      ...config,
      // Um RunnerConfig valido pelo tipo, mas sem nenhum campo opcional.
      runners: { js: { adapter: 'command', match: ['**/*.ts'] } },
    };
    const resolver = createTestFileResolver({ config: minimo, exists: () => true });

    expect(resolver.runnerKeyFor(p('src/a.ts'))).toBe('js');
    expect(resolver.isTestFile(p('src/a.test.ts'))).toBe(false);
    expect(resolver.candidatesFor(p('src/a.ts'))).toEqual([]);
    expect(resolver.resolve(p('src/a.ts')).testFiles).toEqual([]);
  });
});
