/**
 * A geracao do site: rotas, moldura, home e indice de busca.
 *
 * O que estes testes protegem nao e a aparencia, e as invariantes que um erro
 * de HTML nao denuncia: que todo link interno aponta para uma pagina que
 * existe, que cada pagina tem contraparte no outro idioma, e que os caminhos
 * relativos sobem exatamente o numero de niveis que a pagina esta abaixo da
 * raiz. Um `../` a mais quebra o site inteiro em producao e nao muda nada em
 * desenvolvimento.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DESCRICAO_DA_HOME, renderHome } from '../src/build/home.js';
import {
  MARCADOR_DE_ATIVOS,
  renderDocumento,
  resolvedorDeLinks,
  rotaCompleta,
  SCRIPT_DE_TEMA,
  scriptDeIdioma,
} from '../src/build/layout.js';
import { renderMarkdown } from '../src/build/markdown.js';
import {
  caminhoRelativo,
  ordemDeLeitura,
  PAGINAS_DOC,
  TEXTOS,
  vizinhas,
} from '../src/build/routes.js';
import { LIMITE_POR_SECAO, montarIndice, serializarIndice } from '../src/build/search-index.js';
import { LOCALES, type Locale } from '../src/modules/i18n.js';
import * as icones from '../src/modules/icons.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CONTEUDO = path.join(AQUI, '..', 'content');

/** Corpo de um arquivo de conteudo, ja sem o frontmatter. */
function conteudo(locale: Locale, arquivo: string): string {
  const bruto = fs.readFileSync(path.join(CONTEUDO, locale, arquivo), 'utf8');
  return bruto.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

/** Todas as rotas publicadas, com idioma. */
const TODAS = LOCALES.flatMap((locale) => [
  rotaCompleta(locale, ''),
  ...PAGINAS_DOC.map((pagina) => rotaCompleta(locale, pagina.rota)),
]);

describe('caminhoRelativo', () => {
  it('desce da raiz', () => {
    expect(caminhoRelativo('', 'guide/depth')).toBe('guide/depth/');
  });

  it('sobe ate a raiz', () => {
    expect(caminhoRelativo('guide/depth', '')).toBe('../../');
    expect(caminhoRelativo('pt/guide/depth', '')).toBe('../../../');
  });

  it('atravessa mantendo o prefixo comum', () => {
    expect(caminhoRelativo('pt/guide/depth', 'pt/reference/config')).toBe('../../reference/config/');
    expect(caminhoRelativo('guide/depth', 'pt/guide/depth')).toBe('../../pt/guide/depth/');
  });

  it('aponta para si mesmo', () => {
    expect(caminhoRelativo('guide/depth', 'guide/depth')).toBe('./');
    expect(caminhoRelativo('', '')).toBe('./');
  });
});

describe('rotas', () => {
  it('poe o ingles na raiz e o portugues sob /pt', () => {
    expect(rotaCompleta('en', 'guide/depth')).toBe('guide/depth');
    expect(rotaCompleta('pt', 'guide/depth')).toBe('pt/guide/depth');
    expect(rotaCompleta('en', '')).toBe('');
  });

  it('tem todo arquivo de conteudo nos dois idiomas', () => {
    for (const locale of LOCALES) {
      for (const pagina of PAGINAS_DOC) {
        expect(fs.existsSync(path.join(CONTEUDO, locale, pagina.arquivo))).toBe(true);
      }
    }
  });

  it('lista no menu lateral exatamente as paginas que existem', () => {
    for (const locale of LOCALES) {
      const noMenu = ordemDeLeitura(TEXTOS[locale]).map((item) => item.rota);
      expect([...noMenu].sort()).toEqual([...PAGINAS_DOC.map((p) => p.rota)].sort());
    }
  });

  it('aponta os links do cabecalho e do rodape para paginas reais', () => {
    const rotas = new Set(PAGINAS_DOC.map((pagina) => pagina.rota));
    for (const locale of LOCALES) {
      for (const item of TEXTOS[locale].cabecalho) expect(rotas.has(item.rota)).toBe(true);
      for (const coluna of TEXTOS[locale].rodape) {
        for (const link of coluna.links) {
          if (link.href.startsWith('/')) expect(rotas.has(link.href.slice(1))).toBe(true);
        }
      }
    }
  });

  it('encadeia anterior e proxima na ordem do menu', () => {
    const ordem = ordemDeLeitura(TEXTOS.en);
    const primeira = ordem[0] as { rota: string };
    const ultima = ordem[ordem.length - 1] as { rota: string };

    expect(vizinhas(TEXTOS.en, primeira.rota).anterior).toBeNull();
    expect(vizinhas(TEXTOS.en, ultima.rota).proxima).toBeNull();
    expect(vizinhas(TEXTOS.en, 'guide/getting-started')).toEqual({
      anterior: ordem[0],
      proxima: ordem[2],
    });
  });

  it('nao acha vizinhas de uma rota que nao esta no menu', () => {
    expect(vizinhas(TEXTOS.en, 'inexistente')).toEqual({ anterior: null, proxima: null });
  });
});

describe('resolvedorDeLinks', () => {
  const resolver = resolvedorDeLinks('pt/guide/depth', 'pt');

  it('traduz caminho absoluto em relativo, no idioma da pagina', () => {
    expect(resolver('/reference/config')).toBe('../../reference/config/');
  });

  it('preserva a ancora', () => {
    expect(resolver('/reference/config#debounce')).toBe('../../reference/config/#debounce');
  });

  it('deixa passar ancora da propria pagina', () => {
    expect(resolver('#tentar')).toBe('#tentar');
  });

  it('aponta a home do idioma', () => {
    expect(resolver('/')).toBe('../../');
  });
});

describe('scripts embutidos', () => {
  it('o de tema repete a regra do modulo, com o mesmo padrao', () => {
    expect(SCRIPT_DE_TEMA).toContain("localStorage.getItem('livetest:theme')");
    expect(SCRIPT_DE_TEMA).toContain("t='dark'");
    expect(SCRIPT_DE_TEMA).toContain('prefers-color-scheme: dark');
  });

  it('o de idioma leva a contraparte e so age uma vez por aba', () => {
    const script = scriptDeIdioma('en', '../../pt/guide/depth/');
    expect(script).toContain('"en"');
    expect(script).toContain("location.replace(\"../../pt/guide/depth/\")");
    expect(script).toContain("sessionStorage.getItem('livetest:auto')");
  });
});

describe('renderDocumento', () => {
  const pagina = (locale: Locale, rota: string, corpo = '<p>corpo</p>') =>
    renderDocumento({
      locale,
      rota,
      titulo: 'Titulo',
      descricao: 'Resumo',
      corpo,
      headings: [{ nivel: 2, texto: 'Um', slug: 'um' }],
      home: false,
      versao: '0.1.0',
    });

  it('declara o idioma e abre no tema escuro', () => {
    expect(pagina('en', 'guide/depth')).toContain('<html lang="en" data-theme="dark">');
    expect(pagina('pt', 'guide/depth')).toContain('<html lang="pt-BR"');
  });

  it('deixa o marcador de ativos para o plugin preencher', () => {
    expect(pagina('en', 'guide/depth')).toContain(MARCADOR_DE_ATIVOS);
  });

  it('entrega ao script a raiz e o idioma da pagina', () => {
    expect(pagina('pt', 'guide/depth')).toContain(
      '<body data-pagina="doc" data-locale="pt" data-raiz="../../../">',
    );
  });

  it('marca a pagina atual no menu lateral', () => {
    expect(pagina('en', 'guide/depth')).toContain('aria-current="page"');
  });

  it('acende o link do cabecalho pelo prefixo do grupo', () => {
    const html = pagina('en', 'guide/adapters');
    expect(html).toContain('<a href="../introduction/" data-ativo>Guide</a>');
    expect(html).not.toContain('data-ativo>Changelog');
  });

  it('monta o indice da direita a partir dos titulos', () => {
    expect(pagina('en', 'guide/depth')).toContain('<li class="indice__n2"><a href="#um">Um</a>');
  });

  it('esvazia o indice quando a pagina nao tem titulo', () => {
    const html = renderDocumento({
      locale: 'en',
      rota: 'changelog',
      titulo: 'T',
      descricao: 'D',
      corpo: '',
      headings: [],
      home: false,
      versao: '0.1.0',
    });
    expect(html).toContain('<aside class="indice" aria-hidden="true"></aside>');
  });

  it('nao oferece anterior nem proxima fora do menu', () => {
    expect(pagina('en', 'fora-do-menu')).not.toContain('class="passos"');
  });

  it('a home nao tem a grade de tres colunas, mas tem o fundo animado', () => {
    const html = renderDocumento({
      locale: 'en',
      rota: '',
      titulo: 'Live Test Runner',
      descricao: DESCRICAO_DA_HOME.en,
      corpo: renderHome('en'),
      headings: [],
      home: true,
      versao: '0.1.0',
    });
    expect(html).toContain('<main class="home" id="conteudo">');
    expect(html).not.toContain('<div class="layout">');
    expect(html).toContain('class="fundo"');
    expect(html).toContain('data-pagina="home"');
  });

  // Abaixo de 900px os links do cabecalho somem. Sem a gaveta, a home ficaria
  // sem nenhuma navegacao no celular.
  it('a home tem a gaveta, com os links do cabecalho dentro', () => {
    const html = renderDocumento({
      locale: 'en',
      rota: '',
      titulo: 'Live Test Runner',
      descricao: DESCRICAO_DA_HOME.en,
      corpo: renderHome('en'),
      headings: [],
      home: true,
      versao: '0.1.0',
    });

    expect(html).toContain('class="lateral"');
    expect(html).toContain('lateral__grupo--movel');
    for (const item of TEXTOS.en.cabecalho) {
      expect(html).toContain(`>${item.rotulo}</a>`);
    }
  });

  it('a gaveta da documentacao tambem repete os links do cabecalho', () => {
    expect(pagina('en', 'guide/depth')).toContain('lateral__grupo--movel');
  });

  it('a pagina de documentacao tem barra de progresso no lugar do fundo', () => {
    const html = pagina('en', 'guide/depth');
    expect(html).toContain('data-scroll-progress');
    expect(html).not.toContain('class="fundo"');
  });

  it('publica canonical e alternativas de idioma', () => {
    const html = pagina('pt', 'guide/depth');
    expect(html).toContain('<link rel="canonical" href="__SITE_URL__/pt/guide/depth/" />');
    expect(html).toContain('hreflang="en" href="__SITE_URL__/guide/depth/"');
    expect(html).toContain('hreflang="pt-BR" href="__SITE_URL__/pt/guide/depth/"');
    expect(html).toContain('hreflang="x-default" href="__SITE_URL__/"');
  });

  it('a home nao ganha barra no fim do canonical', () => {
    const html = renderDocumento({
      locale: 'en',
      rota: '',
      titulo: 'Live Test Runner',
      descricao: 'D',
      corpo: '',
      headings: [],
      home: true,
      versao: '0.1.0',
    });
    expect(html).toContain('<link rel="canonical" href="__SITE_URL__/" />');
  });

  it('mostra a versao publicada, ligada ao npm', () => {
    const html = pagina('en', 'guide/depth');
    expect(html).toContain('href="https://www.npmjs.com/package/@livetest/cli" target="_blank" rel="noopener">v0.1.0<');
  });

  it('oferece busca, GitHub, idioma, tema e instalar no cabecalho', () => {
    const html = pagina('en', 'guide/depth');
    expect(html).toContain('data-busca-abrir');
    expect(html).toContain('https://github.com/bush1D3v/livetest');
    expect(html).toContain('data-menu="idioma"');
    expect(html).toContain('data-menu="tema"');
    expect(html).toContain('class="botao botao--primario topo__instalar"');
  });

  it('oferece as tres opcoes de tema e as duas de idioma', () => {
    const html = pagina('en', 'guide/depth');
    for (const tema of ['light', 'dark', 'system']) {
      expect(html).toContain(`data-tema="${tema}"`);
    }
    expect(html).toContain('data-escolher-idioma="en"');
    expect(html).toContain('data-escolher-idioma="pt"');
  });

  it('escapa aspas do resumo em vez de encerrar o atributo', () => {
    const html = renderDocumento({
      locale: 'en',
      rota: 'changelog',
      titulo: 'T',
      descricao: 'o campo "watch"',
      corpo: '',
      headings: [],
      home: false,
      versao: '0.1.0',
    });
    expect(html).toContain('content="o campo &quot;watch&quot;"');
  });
});

describe('links internos do conteudo', () => {
  it('apontam sempre para uma pagina publicada', () => {
    const publicadas = new Set(TODAS.map((rota) => `${rota}`));

    for (const locale of LOCALES) {
      for (const pagina of PAGINAS_DOC) {
        const markdown = conteudo(locale, pagina.arquivo);
        for (const achado of markdown.matchAll(/\]\((\/[^)#\s]*)(#[^)\s]*)?\)/g)) {
          const alvo = rotaCompleta(locale, (achado[1] as string).replace(/^\/+|\/+$/g, ''));
          expect(publicadas, `${locale}/${pagina.arquivo} -> ${achado[1]}`).toContain(alvo);
        }
      }
    }
  });

  it('apontam para uma ancora que o destino realmente tem', () => {
    const ancoras = new Map<string, Set<string>>();
    for (const locale of LOCALES) {
      for (const pagina of PAGINAS_DOC) {
        const { headings } = renderMarkdown(conteudo(locale, pagina.arquivo));
        ancoras.set(
          rotaCompleta(locale, pagina.rota),
          new Set(headings.map((titulo) => titulo.slug)),
        );
      }
    }

    for (const locale of LOCALES) {
      for (const pagina of PAGINAS_DOC) {
        const markdown = conteudo(locale, pagina.arquivo);
        for (const achado of markdown.matchAll(/\]\((\/[^)#\s]*)#([^)\s]+)\)/g)) {
          const alvo = rotaCompleta(locale, (achado[1] as string).replace(/^\/+|\/+$/g, ''));
          expect(ancoras.get(alvo), `${locale}/${pagina.arquivo}`).toContain(achado[2]);
        }
      }
    }
  });
});

describe('texto visivel', () => {
  it('nao usa travessao, que denuncia texto de maquina', () => {
    for (const locale of LOCALES) {
      for (const pagina of PAGINAS_DOC) {
        expect(conteudo(locale, pagina.arquivo), `${locale}/${pagina.arquivo}`).not.toContain('—');
      }
      expect(renderHome(locale)).not.toContain('—');
      expect(DESCRICAO_DA_HOME[locale]).not.toContain('—');
    }
  });

  it('todo arquivo de conteudo declara titulo e resumo', () => {
    for (const locale of LOCALES) {
      for (const pagina of PAGINAS_DOC) {
        const bruto = fs.readFileSync(path.join(CONTEUDO, locale, pagina.arquivo), 'utf8');
        expect(bruto, `${locale}/${pagina.arquivo}`).toMatch(/^---\ntitle: .+\ndescription: .+\n---/);
      }
    }
  });
});

describe('renderHome', () => {
  it('traz o terminal, a demonstracao de instalacao e os cartoes', () => {
    const html = renderHome('pt');
    expect(html).toContain('data-terminal-output');
    expect(html).toContain('npm install --save-dev @livetest/cli');
    expect(html.match(/class="cartao"/g)).toHaveLength(6);
  });

  // A home de cada idioma esta em um nivel diferente, mas as duas apontam para
  // `guide/...` sem subir: a resolucao relativa e que leva cada uma ao seu
  // idioma. Comparar o texto do href nao provaria isso; resolver contra a URL
  // da pagina, sim.
  it('leva para a documentacao do proprio idioma', () => {
    const destino = (locale: Locale): string => {
      // A barra no fim nao e enfeite: e ela que faz a resolucao relativa
      // partir de dentro do diretorio da pagina. E por isso que o `vercel.json`
      // declara `trailingSlash: true`.
      const raiz = rotaCompleta(locale, '');
      const base = `https://livetest.dev/${raiz === '' ? '' : `${raiz}/`}`;
      const href = /href="([^"]*guide\/getting-started[^"]*)"/.exec(renderHome(locale))?.[1];
      return new URL(href as string, base).pathname;
    };

    expect(destino('en')).toBe('/guide/getting-started/');
    expect(destino('pt')).toBe('/pt/guide/getting-started/');
  });

  it('liga os tres pacotes publicados', () => {
    const html = renderHome('en');
    expect(html).toContain('npmjs.com/package/@livetest/cli');
    expect(html).toContain('npmjs.com/package/@livetest/core');
    expect(html).toContain('marketplace.visualstudio.com');
  });
});

describe('indice de busca', () => {
  it('guarda uma entrada por secao, com a ancora', () => {
    const docs = montarIndice([
      {
        rota: 'guide/depth',
        titulo: 'Depth',
        secoes: [
          { slug: '', titulo: '', texto: 'abertura' },
          { slug: 'tentar', titulo: 'Tentar', texto: 'corpo' },
        ],
      },
    ]);

    expect(docs).toEqual([
      { u: 'guide/depth/', p: 'Depth', s: '', t: 'abertura' },
      { u: 'guide/depth/#tentar', p: 'Depth', s: 'Tentar', t: 'corpo' },
    ]);
  });

  it('descarta secao sem texto, mas mantem a abertura da pagina', () => {
    const docs = montarIndice([
      {
        rota: 'a',
        titulo: 'A',
        secoes: [
          { slug: '', titulo: '', texto: '' },
          { slug: 'vazia', titulo: 'Vazia', texto: '' },
        ],
      },
    ]);
    expect(docs.map((doc) => doc.u)).toEqual(['a/']);
  });

  it('corta secao longa sem quebrar palavra', () => {
    const texto = 'palavra '.repeat(400);
    const [doc] = montarIndice([
      { rota: 'a', titulo: 'A', secoes: [{ slug: '', titulo: '', texto }] },
    ]);
    expect(doc?.t.length).toBeLessThanOrEqual(LIMITE_POR_SECAO);
    expect(doc?.t.endsWith('palavra')).toBe(true);
  });

  it('indexa a home sem inventar uma barra a mais', () => {
    const docs = montarIndice([
      { rota: '', titulo: 'Home', secoes: [{ slug: '', titulo: '', texto: 'abertura' }] },
    ]);
    expect(docs[0]?.u).toBe('');
  });

  it('corta no limite exato quando o texto nao tem espaco nenhum', () => {
    const [doc] = montarIndice([
      {
        rota: 'a',
        titulo: 'A',
        secoes: [{ slug: '', titulo: '', texto: 'x'.repeat(LIMITE_POR_SECAO + 50) }],
      },
    ]);
    expect(doc?.t).toHaveLength(LIMITE_POR_SECAO);
  });

  it('serializa como JSON', () => {
    expect(serializarIndice([{ u: 'a/', p: 'A', s: '', t: 'x' }])).toBe(
      '[{"u":"a/","p":"A","s":"","t":"x"}]',
    );
  });
});

describe('folha de estilo', () => {
  const FOLHAS = path.join(AQUI, '..', 'src', 'styles');
  const layout = fs.readFileSync(path.join(FOLHAS, 'layout.css'), 'utf8');
  const componentes = fs.readFileSync(path.join(FOLHAS, 'components.css'), 'utf8');

  /** Uma regra: os seletores de um lado, as declaracoes do outro. */
  interface Regra {
    /** Seletores, ja separados pela virgula. */
    seletores: string[];
    /** Corpo cru da regra. */
    corpo: string;
  }

  /** Tira os comentarios, que contem seletores citados em prosa. */
  const semComentarios = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

  /**
   * Especificidade de um seletor, como a cascata a calcula.
   *
   * Tres numeros comparados em ordem: identificadores, depois classes (com
   * atributos e pseudo-classes), depois elementos. E o que decide quem vence
   * quando duas regras declaram a mesma propriedade para o mesmo elemento.
   */
  function especificidade(seletor: string): [number, number, number] {
    const limpo = seletor.replace(/\s*[>+~]\s*/g, ' ').trim();
    return [
      (limpo.match(/#[\w-]+/g) ?? []).length,
      (limpo.match(/\.[\w-]+/g) ?? []).length +
        (limpo.match(/\[[^\]]*\]/g) ?? []).length +
        (limpo.match(/(?<!:):(?!:)[\w-]+/g) ?? []).length,
      (limpo.match(/(?:^|\s)[a-z][\w-]*/g) ?? []).length,
    ];
  }

  /** Negativo, zero ou positivo, como um comparador. */
  function comparar(a: [number, number, number], b: [number, number, number]): number {
    for (let i = 0; i < 3; i++) {
      const diferenca = (a[i] as number) - (b[i] as number);
      if (diferenca !== 0) return diferenca;
    }
    return 0;
  }

  /** A maior especificidade entre os seletores de uma regra. */
  const pesoDaRegra = (regra: Regra): [number, number, number] =>
    regra.seletores
      .map(especificidade)
      .reduce((maior, atual) => (comparar(atual, maior) > 0 ? atual : maior));

  /** O conteudo de um bloco `@media`, com as chaves equilibradas. */
  function blocoDeMedia(css: string, condicao: string): string {
    const abertura = css.indexOf(`@media (${condicao})`);
    if (abertura === -1) return '';

    let i = css.indexOf('{', abertura);
    let profundidade = 0;
    const comeco = i + 1;

    for (; i < css.length; i++) {
      if (css[i] === '{') profundidade++;
      else if (css[i] === '}' && --profundidade === 0) return css.slice(comeco, i);
    }

    return '';
  }

  /** As regras de um trecho de CSS que declaram uma propriedade. */
  function regrasQueDeclaram(css: string, propriedade: string): Regra[] {
    const achadas: Regra[] = [];

    for (const bruto of semComentarios(css).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const corpo = bruto[2] as string;
      if (!new RegExp(`(?:^|;|\\s)${propriedade}\\s*:`).test(corpo)) continue;
      achadas.push({
        seletores: (bruto[1] as string).split(',').map((parte) => parte.trim()),
        corpo,
      });
    }

    return achadas;
  }

  it('calcula especificidade como a cascata', () => {
    expect(especificidade('.lateral')).toEqual([0, 1, 0]);
    expect(especificidade('.lateral.is-open')).toEqual([0, 2, 0]);
    expect(especificidade("body[data-pagina='home'] .lateral")).toEqual([0, 2, 1]);
    expect(comparar([0, 2, 1], [0, 2, 0])).toBeGreaterThan(0);
    expect(comparar([0, 1, 0], [0, 1, 0])).toBe(0);
  });

  /*
   * O botao da gaveta e tambem um `.icone-botao`, e as duas folhas declaram
   * `display` para ele. Com a mesma especificidade vence quem vem depois, e
   * `components.css` vem depois: o botao aparecia no desktop.
   *
   * O jsdom nao serve para provar isto, porque ignora especificidade e responde
   * sempre a ultima regra. Entao o que se verifica e a causa.
   */
  it('a regra que esconde o botao da gaveta vence a regra generica de icone', () => {
    const esconde = regrasQueDeclaram(semComentarios(layout).split('@media')[0] as string, 'display')
      .filter((regra) => regra.seletores.some((alvo) => alvo.endsWith('.topo__menu')));
    const generica = regrasQueDeclaram(
      semComentarios(componentes).split('@media')[0] as string,
      'display',
    ).filter((regra) => regra.seletores.some((alvo) => alvo.endsWith('.icone-botao')));

    expect(esconde).toHaveLength(1);
    expect(generica).toHaveLength(1);
    expect(comparar(pesoDaRegra(esconde[0] as Regra), pesoDaRegra(generica[0] as Regra))).toBeGreaterThan(0);
  });

  /*
   * A gaveta fica fora da tela por um `transform` e entra quando `.is-open`
   * devolve `transform: none`. Qualquer regra que a mantenha fora precisa pesar
   * menos que essa, ou a gaveta abre no HTML e nao se move na tela: foi o que
   * aconteceu quando a regra da home entrou junto com o `transform`.
   */
  it('a regra que abre a gaveta vence todas as que a mantem fechada', () => {
    const movel = blocoDeMedia(layout, 'max-width: 900px');
    expect(movel).not.toBe('');

    const daGaveta = regrasQueDeclaram(movel, 'transform').filter((regra) =>
      regra.seletores.some((alvo) => alvo.includes('.lateral')),
    );

    const abre = daGaveta.filter((regra) => /transform:\s*none/.test(regra.corpo));
    const fecham = daGaveta.filter((regra) => /transform:\s*translate/.test(regra.corpo));

    expect(abre).toHaveLength(1);
    expect(fecham.length).toBeGreaterThan(0);

    for (const regra of fecham) {
      expect(
        comparar(pesoDaRegra(abre[0] as Regra), pesoDaRegra(regra)),
        regra.seletores.join(', '),
      ).toBeGreaterThan(0);
    }
  });
});

describe('icones', () => {
  it('sao SVG fechado, sem quebra dentro de atributo', () => {
    for (const [nome, svg] of Object.entries(icones)) {
      expect(svg.startsWith('<svg'), nome).toBe(true);
      expect(svg.endsWith('</svg>'), nome).toBe(true);
      expect(svg.includes('\n'), nome).toBe(false);
    }
  });

  // Sem `width` e `height` um SVG nao tem tamanho proprio, e no instante antes
  // de a folha de estilo chegar o navegador o estica ate a largura da tela.
  it('declaram tamanho proprio, para nao explodirem sem CSS', () => {
    for (const [nome, svg] of Object.entries(icones)) {
      expect(svg, nome).toMatch(/\swidth="\d+"/);
      expect(svg, nome).toMatch(/\sheight="\d+"/);
    }
  });
});
