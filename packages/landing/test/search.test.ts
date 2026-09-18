/**
 * O motor de busca.
 *
 * A parte que importa nao e "acha alguma coisa", e a **ordem**. Por isso quase
 * todo teste aqui compara posicoes: o resultado certo tem de vir na frente do
 * resultado parecido, que e onde uma busca ruim se denuncia.
 */

import { describe, expect, it } from 'vitest';

import {
  buildIndex,
  expandirPrefixo,
  limiteInferior,
  marcar,
  search,
  semAcento,
  tokenize,
  umaEdicao,
  type SearchDoc,
} from '../src/modules/search.js';

const DOCS: SearchDoc[] = [
  {
    u: 'reference/config/#dependencydepth',
    p: 'Configuration',
    s: 'dependencyDepth',
    t: 'How deep into the reverse dependency graph a run propagates. The overrides are evaluated in declaration order and the last match wins.',
  },
  {
    u: 'guide/depth/',
    p: 'Propagation depth',
    s: '',
    t: 'This is the central setting. For each file you decide how far the run propagates through the reverse graph.',
  },
  {
    u: 'reference/config/#debounce',
    p: 'Configuration',
    s: 'debounce',
    t: 'Grouping of consecutive saves. The idle mode fires after a period of silence.',
  },
  {
    u: 'guide/adapters/',
    p: 'Writing an adapter',
    s: '',
    t: 'Adding a new language does not require touching the core. There are two independent extension points.',
  },
];

const indice = buildIndex(DOCS);

/** Posicao de uma URL no resultado, ou -1. */
const posicao = (consulta: string, u: string): number =>
  search(indice, consulta).findIndex((hit) => hit.doc.u === u);

describe('normalizacao', () => {
  it('tira acentos', () => {
    expect(semAcento('configuração pública')).toBe('configuracao publica');
  });

  it('quebra camelCase e descarta pontuacao', () => {
    expect(tokenize('dependencyDepth: "transitive"')).toEqual([
      'dependency',
      'depth',
      'transitive',
    ]);
  });

  it('devolve lista vazia para texto sem palavra', () => {
    expect(tokenize('  ...  ')).toEqual([]);
  });
});

describe('umaEdicao', () => {
  it('aceita igual, substituicao, insercao e remocao', () => {
    expect(umaEdicao('adapter', 'adapter')).toBe(true);
    expect(umaEdicao('adapter', 'adaptar')).toBe(true);
    expect(umaEdicao('adapter', 'adapters')).toBe(true);
    expect(umaEdicao('adapters', 'adapter')).toBe(true);
  });

  it('recusa duas edicoes ou mais', () => {
    expect(umaEdicao('adapter', 'adaptors')).toBe(false);
    expect(umaEdicao('adapter', 'runner')).toBe(false);
    expect(umaEdicao('a', 'abcd')).toBe(false);
  });
});

describe('vocabulario', () => {
  it('acha o ponto de insercao de um termo ausente', () => {
    expect(limiteInferior(['a', 'c', 'e'], 'b')).toBe(1);
    expect(limiteInferior(['a', 'c', 'e'], 'z')).toBe(3);
  });

  it('expande um prefixo', () => {
    expect(expandirPrefixo(['adapter', 'adapters', 'batch'], 'adap')).toEqual([0, 1]);
    expect(expandirPrefixo(['adapter', 'batch'], 'zzz')).toEqual([]);
  });
});

describe('search', () => {
  it('nao busca texto vazio', () => {
    expect(search(indice, '   ')).toEqual([]);
  });

  it('devolve vazio quando nada casa', () => {
    expect(search(indice, 'kubernetes')).toEqual([]);
  });

  it('poe o titulo exato na frente', () => {
    expect(search(indice, 'debounce')[0]?.doc.u).toBe('reference/config/#debounce');
  });

  it('acha um nome em camelCase pela segunda palavra', () => {
    expect(posicao('depth', 'reference/config/#dependencydepth')).toBeGreaterThanOrEqual(0);
  });

  it('prefere quem casa com as duas palavras', () => {
    const resultados = search(indice, 'dependency graph');
    expect(resultados[0]?.doc.u).toBe('reference/config/#dependencydepth');
  });

  it('trata a ultima palavra como prefixo', () => {
    expect(search(indice, 'debou')[0]?.doc.u).toBe('reference/config/#debounce');
  });

  it('perdoa um erro de digitacao', () => {
    expect(search(indice, 'debonce')[0]?.doc.u).toBe('reference/config/#debounce');
  });

  it('nao tenta corrigir palavra curta demais', () => {
    expect(search(indice, 'xyz')).toEqual([]);
  });

  it('respeita o limite pedido', () => {
    expect(search(indice, 'the', 2)).toHaveLength(2);
  });

  it('acha pelo titulo da pagina', () => {
    expect(search(indice, 'adapter')[0]?.doc.u).toBe('guide/adapters/');
  });

  it('usa o titulo da pagina quando a secao e a abertura', () => {
    const hit = search(indice, 'propagation depth')[0];
    expect(hit?.titulo.map((parte) => parte.texto).join('')).toBe('Propagation depth');
  });

  it('o titulo da pagina sustenta secoes que nao trazem o termo no proprio titulo', () => {
    // Nenhuma das duas secoes de 'Configuration' tem a palavra no titulo
    // proprio; e o titulo da pagina que as coloca na frente das outras paginas.
    const resultados = search(indice, 'configuration').map((hit) => hit.doc.u);
    expect(resultados.slice(0, 2).sort()).toEqual([
      'reference/config/#debounce',
      'reference/config/#dependencydepth',
    ]);
  });

  it('a abertura da pagina vem antes das suas proprias subsecoes', () => {
    const comAbertura = buildIndex([
      { u: 'guide/adapters/', p: 'Writing an adapter', s: '', t: 'Two extension points.' },
      {
        u: 'guide/adapters/#registering',
        p: 'Writing an adapter',
        s: 'Registering',
        t: 'How to register an adapter.',
      },
    ]);
    expect(search(comAbertura, 'writing an adapter')[0]?.doc.u).toBe('guide/adapters/');
  });

  it('marca no titulo o que casou com o titulo', () => {
    const hit = search(indice, 'debounce')[0];
    expect(hit?.titulo.filter((parte) => parte.marcado)).toHaveLength(1);
  });

  it('marca no trecho o que casou com o corpo', () => {
    const hit = search(indice, 'silence')[0];
    expect(hit?.doc.u).toBe('reference/config/#debounce');
    expect(hit?.trecho.filter((parte) => parte.marcado)).toHaveLength(1);
  });

  it('desempata pela URL quando a pontuacao empata', () => {
    const iguais = buildIndex([
      { u: 'b/', p: 'X', s: '', t: 'igual' },
      { u: 'a/', p: 'X', s: '', t: 'igual' },
    ]);
    expect(search(iguais, 'igual').map((hit) => hit.doc.u)).toEqual(['a/', 'b/']);
  });

  it('aguenta um indice vazio', () => {
    expect(search(buildIndex([]), 'qualquer')).toEqual([]);
  });

  it('aguenta um documento sem uma palavra sequer', () => {
    const magro = buildIndex([{ u: 'a/', p: '', s: '', t: '' }]);
    expect(magro.tamanhoMedio).toBe(1);
    expect(search(magro, 'qualquer')).toEqual([]);
  });
});

describe('marcar', () => {
  it('marca as ocorrencias sem recortar', () => {
    expect(marcar('o grafo reverso', ['grafo'], Infinity)).toEqual([
      { texto: 'o ', marcado: false },
      { texto: 'grafo', marcado: true },
      { texto: ' reverso', marcado: false },
    ]);
  });

  it('acha varias ocorrencias da mesma palavra', () => {
    const partes = marcar('grafo e grafo', ['grafo'], Infinity);
    expect(partes.filter((parte) => parte.marcado)).toHaveLength(2);
  });

  it('funde pedacos vizinhos de mesmo tipo', () => {
    expect(marcar('ab', ['a', 'b'], Infinity)).toEqual([{ texto: 'ab', marcado: true }]);
  });

  it('recorta em volta do primeiro casamento e sinaliza os dois cortes', () => {
    const texto = `${'x'.repeat(200)} alvo ${'y'.repeat(200)}`;
    const partes = marcar(texto, ['alvo'], 60);
    const junto = partes.map((parte) => parte.texto).join('');
    expect(junto.startsWith('…')).toBe(true);
    expect(junto.endsWith('…')).toBe(true);
    expect(junto).toContain('alvo');
  });

  // Com a janela real (150) sempre sobra contexto antes do casamento, e as
  // reticencias grudam nele. A janela minima e o unico jeito de o recorte
  // comecar exatamente no casamento, que e quando elas viram pedaco proprio.
  it('poe as reticencias como pedaco proprio quando o corte cai em cima do casamento', () => {
    const partes = marcar(`${'a'.repeat(60)}alvo`, ['alvo'], 2);
    expect(partes[0]).toEqual({ texto: '…', marcado: false });
    expect(partes[1]).toEqual({ texto: 'al', marcado: true });
  });

  it('ignora casamento que cai fora da janela', () => {
    const partes = marcar(`alvo ${'z'.repeat(400)} alvo`, ['alvo'], 40);
    expect(partes.filter((parte) => parte.marcado)).toHaveLength(1);
  });

  it('descarta um casamento contido em outro ja marcado', () => {
    expect(marcar('ab', ['ab', 'b'], Infinity)).toEqual([{ texto: 'ab', marcado: true }]);
  });

  it('devolve o texto inteiro quando nada casa', () => {
    expect(marcar('sem nada', ['zzz'], Infinity)).toEqual([{ texto: 'sem nada', marcado: false }]);
  });

  it('ignora texto vazio', () => {
    expect(marcar('', ['a'], Infinity)).toEqual([]);
  });
});
