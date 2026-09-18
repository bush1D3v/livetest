// @vitest-environment jsdom

/**
 * Conferência legível das três profundidades, nos dois idiomas.
 *
 * Os outros testes verificam contagens e classes; este imprime o texto que o
 * visitante realmente lê, para que uma revisão humana pegue o que um `expect`
 * de número não pega. Foi exatamente assim que apareceu o `self` dizendo
 * "0 arquivos de teste".
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import { renderMarkdown } from '../src/build/markdown.js';
import { setupGraph } from '../src/setup/graph.js';
import type { Depth } from '../src/modules/depth-graph.js';
import type { Locale } from '../src/modules/i18n.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/** Monta a demonstração a partir da página de documentação que a publica. */
function montar(locale: Locale): void {
  const bruto = fs.readFileSync(
    path.join(AQUI, '..', 'content', locale, 'guide', 'depth.md'),
    'utf8',
  );
  document.body.innerHTML = renderMarkdown(bruto.replace(/^---\n[\s\S]*?\n---\n?/, '')).html;
}

/** Texto visível do painel, para uma profundidade. */
function painel(locale: Locale, depth: Depth): { legenda: string; testes: string[] } {
  montar(locale);
  setupGraph({ locale }).select(depth);

  return {
    legenda: document.querySelector('[data-graph-caption]')?.textContent?.trim() ?? '',
    testes: [...document.querySelectorAll('[data-graph-tests] li')].map((li) =>
      [
        li.querySelector('.graph-demo__test-name')?.textContent,
        li.querySelector('.graph-demo__test-why')?.textContent,
      ].join(' — '),
    ),
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('painel do grafo em português', () => {
  it('self', () => {
    const { legenda, testes } = painel('pt', 'self');
    expect(legenda).toBe(
      'Roda apenas os testes do arquivo que você salvou. Salvar login.ts roda 1 arquivo de teste.',
    );
    expect(testes).toEqual(['login.test.ts — cobre login.ts, o arquivo que você salvou']);
  });

  it('direct', () => {
    const { legenda, testes } = painel('pt', 'direct');
    expect(legenda).toBe(
      'Inclui os testes de quem importa esse arquivo diretamente. ' +
        'Salvar login.ts roda 3 arquivos de teste.',
    );
    expect(testes).toEqual([
      'footer.test.ts — cobre footer.ts, que importa login.ts (1 nível)',
      'header.test.ts — cobre header.ts, que importa login.ts (1 nível)',
      'login.test.ts — cobre login.ts, o arquivo que você salvou',
    ]);
  });

  it('transitive', () => {
    const { legenda, testes } = painel('pt', 'transitive');
    expect(legenda).toBe(
      'Sobe toda a cadeia de importadores, até o topo. Salvar login.ts roda 4 arquivos de teste.',
    );
    expect(testes).toEqual([
      'footer.test.ts — cobre footer.ts, que importa login.ts (1 nível)',
      'header.test.ts — cobre header.ts, que importa login.ts (1 nível)',
      'layout.test.ts — cobre layout.ts, que importa login.ts via header.ts (2 níveis)',
      'login.test.ts — cobre login.ts, o arquivo que você salvou',
    ]);
  });
});

describe('painel do grafo em inglês', () => {
  it('self', () => {
    const { legenda, testes } = painel('en', 'self');
    expect(legenda).toBe(
      'Runs only the tests of the file you saved. Saving login.ts runs 1 test file.',
    );
    expect(testes).toEqual(['login.test.ts — covers login.ts, the file you saved']);
  });

  it('direct', () => {
    const { legenda, testes } = painel('en', 'direct');
    expect(legenda).toBe(
      'Adds the tests of whoever imports that file directly. Saving login.ts runs 3 test files.',
    );
    expect(testes).toEqual([
      'footer.test.ts — covers footer.ts, which imports login.ts (1 level)',
      'header.test.ts — covers header.ts, which imports login.ts (1 level)',
      'login.test.ts — covers login.ts, the file you saved',
    ]);
  });

  it('transitive', () => {
    const { legenda, testes } = painel('en', 'transitive');
    expect(legenda).toBe(
      'Walks the whole chain of importers, all the way up. Saving login.ts runs 4 test files.',
    );
    expect(testes).toEqual([
      'footer.test.ts — covers footer.ts, which imports login.ts (1 level)',
      'header.test.ts — covers header.ts, which imports login.ts (1 level)',
      'layout.test.ts — covers layout.ts, which imports login.ts through header.ts (2 levels)',
      'login.test.ts — covers login.ts, the file you saved',
    ]);
  });
});
