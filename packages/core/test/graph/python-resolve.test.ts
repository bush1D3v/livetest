import { describe, expect, it } from 'vitest';

import {
  findPackageRoot,
  resolveAllImports,
  resolveImportRecord,
} from '../../src/graph/python/resolve.js';
import { normalizePath } from '../../src/util/paths.js';
import { createTempProject } from '../helpers/tmp.js';

const root = normalizePath('/proj');
const p = (relative: string): string => normalizePath(relative, root);

/** Predicado de existencia apoiado em uma lista fixa de arquivos. */
function existsIn(files: string[]) {
  const set = new Set(files.map((f) => p(f)));
  return (candidate: string): boolean => set.has(normalizePath(candidate));
}

describe('findPackageRoot', () => {
  it('sobe enquanto houver __init__.py', () => {
    const exists = existsIn(['app/__init__.py', 'app/core/__init__.py', 'app/core/db.py']);
    expect(findPackageRoot(p('app/core/db.py'), root, exists)).toBe(root);
  });

  it('para no primeiro diretorio sem __init__.py', () => {
    const exists = existsIn(['src/app/__init__.py', 'src/app/db.py']);
    expect(findPackageRoot(p('src/app/db.py'), root, exists)).toBe(p('src'));
  });

  it('devolve o proprio diretorio para modulo solto', () => {
    expect(findPackageRoot(p('scripts/run.py'), root, existsIn([]))).toBe(p('scripts'));
  });

  it('nunca ultrapassa a raiz', () => {
    const exists = existsIn(['__init__.py', 'a.py']);
    expect(findPackageRoot(p('a.py'), root, exists)).toBe(root);
  });
});

describe('resolveImportRecord — imports relativos', () => {
  it('resolve from . import modulo', () => {
    const exists = existsIn(['app/login.py', 'app/header.py']);
    const result = resolveImportRecord(
      { module: null, level: 1, names: ['login'] },
      p('app/header.py'),
      { root, exists },
    );
    expect(result.resolved).toEqual([p('app/login.py')]);
  });

  it('resolve from .modulo import simbolo', () => {
    const exists = existsIn(['app/login.py', 'app/header.py']);
    const result = resolveImportRecord(
      { module: 'login', level: 1, names: ['autenticar'] },
      p('app/header.py'),
      { root, exists },
    );
    expect(result.resolved).toEqual([p('app/login.py')]);
  });

  it('sobe um nivel por ponto adicional', () => {
    const exists = existsIn(['app/core/db.py', 'app/web/views.py']);
    const result = resolveImportRecord(
      { module: 'core.db', level: 2, names: [] },
      p('app/web/views.py'),
      { root, exists },
    );
    expect(result.resolved).toEqual([p('app/core/db.py')]);
  });

  it('resolve pacote via __init__.py', () => {
    const exists = existsIn(['app/core/__init__.py', 'app/header.py']);
    const result = resolveImportRecord(
      { module: 'core', level: 1, names: [] },
      p('app/header.py'),
      { root, exists },
    );
    expect(result.resolved).toEqual([p('app/core/__init__.py')]);
  });

  it('reporta import relativo que nao resolve', () => {
    const result = resolveImportRecord(
      { module: 'sumiu', level: 1, names: [] },
      p('app/header.py'),
      { root, exists: existsIn([]) },
    );
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual(['.sumiu']);
  });
});

describe('resolveImportRecord — imports absolutos', () => {
  it('resolve a partir da raiz do projeto', () => {
    const exists = existsIn(['auth/login.py', 'app/header.py']);
    const result = resolveImportRecord(
      { module: 'auth.login', level: 0, names: [] },
      p('app/header.py'),
      { root, exists },
    );
    expect(result.resolved).toEqual([p('auth/login.py')]);
  });

  it('resolve a partir de src/', () => {
    const exists = existsIn(['src/auth/login.py', 'src/app/header.py']);
    const result = resolveImportRecord(
      { module: 'auth.login', level: 0, names: [] },
      p('src/app/header.py'),
      { root, exists },
    );
    expect(result.resolved).toEqual([p('src/auth/login.py')]);
  });

  it('resolve nome importado que na verdade e submodulo', () => {
    const exists = existsIn(['auth/__init__.py', 'auth/login.py', 'app/h.py']);
    const result = resolveImportRecord(
      { module: 'auth', level: 0, names: ['login'] },
      p('app/h.py'),
      { root, exists },
    );
    expect(result.resolved.sort()).toEqual([p('auth/__init__.py'), p('auth/login.py')]);
  });

  it('ignora silenciosamente stdlib e pacotes instalados', () => {
    const result = resolveImportRecord({ module: 'os.path', level: 0, names: [] }, p('a.py'), {
      root,
      exists: existsIn([]),
    });
    expect(result).toEqual({ resolved: [], unresolved: [] });
  });

  it('nao resolve para fora da raiz do projeto', () => {
    const exists = (candidate: string): boolean => candidate === '/fora/x.py';
    const result = resolveImportRecord({ module: 'x', level: 0, names: [] }, p('a.py'), {
      root,
      exists,
    });
    expect(result.resolved).toEqual([]);
  });
});

describe('resolveAllImports', () => {
  it('deduplica e remove o proprio arquivo', () => {
    const exists = existsIn(['app/login.py', 'app/header.py']);
    const result = resolveAllImports(
      [
        { module: 'login', level: 1, names: [] },
        { module: 'login', level: 1, names: [] },
        { module: 'header', level: 1, names: [] },
      ],
      p('app/header.py'),
      { root, exists },
    );
    expect(result.resolved).toEqual([p('app/login.py')]);
  });

  it('acumula os nao resolvidos sem repetir', () => {
    const result = resolveAllImports(
      [
        { module: 'a', level: 1, names: [] },
        { module: 'a', level: 1, names: [] },
      ],
      p('app/h.py'),
      { root, exists: existsIn([]) },
    );
    expect(result.unresolved).toEqual(['.a']);
  });
});

describe('resolveImportRecord — bordas da resolucao relativa', () => {
  it('reporta from . import x que nao resolve, sem nome de modulo', () => {
    const result = resolveImportRecord({ module: null, level: 1, names: ['sumiu'] }, p('app/h.py'), {
      root,
      exists: existsIn([]),
    });
    expect(result.unresolved).toEqual(['.']);
  });

  it('para de subir ao alcancar a raiz do projeto', () => {
    const exists = existsIn(['alvo.py', 'app/web/views.py']);
    // Cinco niveis a partir de app/web/ ultrapassariam a raiz: a subida para nela.
    const result = resolveImportRecord(
      { module: 'alvo', level: 5, names: [] },
      p('app/web/views.py'),
      { root, exists },
    );
    expect(result.resolved).toEqual([p('alvo.py')]);
  });

  it('para quando o diretorio pai e igual ao proprio diretorio', () => {
    const result = resolveImportRecord({ module: 'x', level: 9, names: [] }, '/a.py', {
      root: '/',
      exists: existsIn([]),
    });
    expect(result.unresolved).toHaveLength(1);
  });

  it('resolve arquivo .pyi', () => {
    const exists = existsIn(['app/tipos.pyi', 'app/h.py']);
    const result = resolveImportRecord({ module: 'tipos', level: 1, names: [] }, p('app/h.py'), {
      root,
      exists,
    });
    expect(result.resolved).toEqual([p('app/tipos.pyi')]);
  });

  it('usa o sistema de arquivos real quando nenhum predicado e injetado', () => {
    const project = createTempProject({ 'app/base.py': '', 'app/uso.py': '' });
    try {
      const result = resolveImportRecord(
        { module: 'base', level: 1, names: [] },
        project.path('app/uso.py'),
        { root: project.root },
      );
      expect(result.resolved).toEqual([project.path('app/base.py')]);
    } finally {
      project.cleanup();
    }
  });
});

describe('findPackageRoot — sistema de arquivos real', () => {
  it('sobe enquanto houver __init__.py em disco', () => {
    const project = createTempProject({
      'app/__init__.py': '',
      'app/core/__init__.py': '',
      'app/core/db.py': '',
    });
    try {
      expect(findPackageRoot(project.path('app/core/db.py'), project.root)).toBe(project.root);
    } finally {
      project.cleanup();
    }
  });
});

describe('resolveAllImports — sem imports', () => {
  it('devolve listas vazias', () => {
    expect(resolveAllImports([], p('app/h.py'), { root, exists: existsIn([]) })).toEqual({
      resolved: [],
      unresolved: [],
    });
  });
});
