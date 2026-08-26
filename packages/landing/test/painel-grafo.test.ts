// @vitest-environment jsdom

/**
 * Conferência legível das três profundidades.
 *
 * Os outros testes verificam contagens e classes; este imprime o texto que o
 * visitante realmente lê, para que uma revisão humana pegue o que um `expect`
 * de número não pega — foi exatamente assim que apareceu o `self` dizendo
 * "0 arquivos de teste".
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import { setupGraph } from '../src/setup/graph.js';
import type { Depth } from '../src/modules/depth-graph.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(AQUI, '..', 'index.html'), 'utf8');

beforeEach(() => {
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(HTML)?.[1] ?? '';
});

/** Texto visível do painel, para uma profundidade. */
function painel(depth: Depth): { legenda: string; testes: string[] } {
  setupGraph().select(depth);
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

describe('painel do grafo — texto exibido', () => {
  it('self', () => {
    const { legenda, testes } = painel('self');
    expect(legenda).toBe(
      'Roda apenas os testes do arquivo que você salvou. Salvar login.ts roda 1 arquivo de teste.',
    );
    expect(testes).toEqual(['login.test.ts — cobre login.ts, o arquivo que você salvou']);
  });

  it('direct', () => {
    const { legenda, testes } = painel('direct');
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
    const { legenda, testes } = painel('transitive');
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
