import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  basenameWithoutExt,
  dirname,
  extname,
  isInside,
  joinPosix,
  normalizePath,
  relativeToRoot,
  toNative,
  toPosix,
} from '../../src/util/paths.js';

describe('toPosix', () => {
  it('converte separadores do Windows', () => {
    expect(toPosix(String.raw`src\components\Login.tsx`)).toBe('src/components/Login.tsx');
  });

  it('mantem caminhos que ja usam barra', () => {
    expect(toPosix('src/a.ts')).toBe('src/a.ts');
  });
});

describe('normalizePath', () => {
  it('resolve caminho relativo contra a base', () => {
    expect(normalizePath('src/a.ts', '/proj')).toBe(toPosix(path.resolve('/proj', 'src/a.ts')));
  });

  it('normaliza segmentos redundantes', () => {
    expect(normalizePath('/proj/src/../src/a.ts')).toBe(toPosix(path.resolve('/proj/src/a.ts')));
  });

  it('usa o cwd quando nenhuma base e informada', () => {
    expect(normalizePath('a.ts')).toBe(toPosix(path.resolve(process.cwd(), 'a.ts')));
  });
});

describe('relativeToRoot', () => {
  const root = toPosix(path.resolve('/proj'));

  it('devolve o caminho relativo em POSIX', () => {
    expect(relativeToRoot(root, `${root}/src/a.ts`)).toBe('src/a.ts');
  });

  it('devolve "." para a propria raiz', () => {
    expect(relativeToRoot(root, root)).toBe('.');
  });

  it('devolve o caminho absoluto quando o arquivo esta fora da raiz', () => {
    const outside = toPosix(path.resolve('/outro/a.ts'));
    expect(relativeToRoot(root, outside)).toBe(outside);
  });
});

describe('toNative', () => {
  it('respeita o separador da plataforma', () => {
    const result = toNative('a/b/c.ts');
    expect(result).toBe(path.sep !== '/' ? String.raw`a\b\c.ts` : 'a/b/c.ts');
  });
});

describe('extname / basenameWithoutExt / dirname / joinPosix', () => {
  it('extrai a extensao em minusculas', () => {
    expect(extname('/proj/src/Login.TSX')).toBe('.tsx');
  });

  it('devolve string vazia quando nao ha extensao', () => {
    expect(extname('/proj/Makefile')).toBe('');
  });

  it('extrai o nome sem diretorio nem extensao', () => {
    expect(basenameWithoutExt('/proj/src/login.test.ts')).toBe('login.test');
  });

  it('extrai o diretorio em POSIX', () => {
    expect(dirname(String.raw`C:\proj\src\a.ts`)).toBe('C:/proj/src');
  });

  it('junta segmentos normalizando separadores', () => {
    expect(joinPosix('/proj', String.raw`src\util`, 'a.ts')).toBe('/proj/src/util/a.ts');
  });
});

describe('isInside', () => {
  const root = toPosix(path.resolve('/proj'));

  it('reconhece arquivo dentro da raiz', () => {
    expect(isInside(root, `${root}/src/a.ts`)).toBe(true);
  });

  it('reconhece a propria raiz como dentro', () => {
    expect(isInside(root, root)).toBe(true);
  });

  it('rejeita arquivo fora da raiz', () => {
    expect(isInside(root, toPosix(path.resolve('/outro/a.ts')))).toBe(false);
  });
});

describe('toNative — separador explicito', () => {
  it('converte para barra invertida quando o separador e do Windows', () => {
    expect(toNative('a/b/c.ts', '\\')).toBe(String.raw`a\b\c.ts`);
  });

  it('mantem barras quando o separador e POSIX', () => {
    expect(toNative('a/b/c.ts', '/')).toBe('a/b/c.ts');
  });

  it('nao altera caminho sem separador', () => {
    expect(toNative('arquivo.ts', '\\')).toBe('arquivo.ts');
  });
});
