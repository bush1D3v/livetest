/**
 * O conversor de Markdown.
 *
 * Ele nao precisa cobrir o Markdown inteiro, so o subconjunto que a
 * documentacao usa. O que estes testes seguram e a fronteira desse
 * subconjunto: o que e suportado tem de sair certo, e o que nao e tem de sair
 * escapado em vez de virar marcacao.
 */

import { describe, expect, it } from 'vitest';

import { MARCAS_PADRAO, renderMarkdown, slugify, textoPuro } from '../src/build/markdown.js';

describe('slugify', () => {
  it('tira acentos e junta com hifen', () => {
    expect(slugify('Profundidade de propagação')).toBe('profundidade-de-propagacao');
  });

  it('descarta pontuacao das pontas', () => {
    expect(slugify('`watch`: string[]')).toBe('watch-string');
  });
});

describe('textoPuro', () => {
  it('remove marcacao de enfase, codigo e link', () => {
    expect(textoPuro('o **grafo** de `imports` em [docs](/a)')).toBe('o grafo de imports em docs');
  });

  it('colapsa espaco e barra de tabela', () => {
    expect(textoPuro('| a  |  b |')).toBe('a b');
  });

  it('descarta as marcas de comparacao, que sao desenho e nao palavra', () => {
    expect(textoPuro('| recurso | :yes: | :no: | :partial: |')).toBe('recurso');
  });
});

describe('marcas de comparacao', () => {
  it('viram simbolo com nome no hover e no leitor de tela', () => {
    const { html } = renderMarkdown(':yes:');
    expect(html).toContain('class="marca marca--yes"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Yes"');
    expect(html).toContain('title="Yes"');
    expect(html).toContain('<svg');
  });

  it('tem um desenho diferente para cada resposta', () => {
    const desenho = (marca: string): string =>
      /<span[^>]*>([\s\S]*)<\/span>/.exec(renderMarkdown(`:${marca}:`).html)?.[1] ?? '';

    const tres = ['yes', 'no', 'partial'].map(desenho);
    expect(tres.every((svg) => svg.startsWith('<svg'))).toBe(true);
    expect(new Set(tres).size).toBe(3);
  });

  it('usa os rotulos do idioma quando lhe passam', () => {
    const { html } = renderMarkdown(':partial:', {
      marcas: { yes: 'Sim', no: 'Não', partial: 'Parcial' },
    });
    expect(html).toContain('aria-label="Parcial"');
    expect(html).toContain('title="Parcial"');
  });

  it('cai no ingles quando ninguem informa os rotulos', () => {
    expect(MARCAS_PADRAO).toEqual({ yes: 'Yes', no: 'No', partial: 'Partial' });
    expect(renderMarkdown(':no:').html).toContain('aria-label="No"');
  });

  it('dentro de uma celula, o simbolo e tudo que a celula tem', () => {
    const { html } = renderMarkdown('| a | b |\n|---|:-:|\n| grafo | :yes: |');
    expect(html).toContain('<td style="text-align:center"><span class="marca marca--yes"');
  });

  it('nao interpreta a marca dentro de um trecho de codigo', () => {
    expect(renderMarkdown('`:yes:`').html).toBe('<p><code>:yes:</code></p>');
  });
});

describe('titulos', () => {
  it('nao poe o h1 no indice lateral', () => {
    const { headings, html } = renderMarkdown('# Titulo\n\ncorpo');
    expect(headings).toEqual([]);
    expect(html).toContain('<h1>Titulo</h1>');
  });

  it('indexa nivel 2 e 3 com ancora', () => {
    const { headings, html } = renderMarkdown('## Watch\n\n### Padrão');
    expect(headings).toEqual([
      { nivel: 2, texto: 'Watch', slug: 'watch' },
      { nivel: 3, texto: 'Padrão', slug: 'padrao' },
    ]);
    expect(html).toContain('<h2 id="watch">');
    expect(html).toContain('class="header-anchor" href="#watch"');
  });

  it('desempata ancoras repetidas', () => {
    const { headings } = renderMarkdown('## Exemplo\n\n## Exemplo\n\n## Exemplo');
    expect(headings.map((h) => h.slug)).toEqual(['exemplo', 'exemplo-2', 'exemplo-3']);
  });

  it('usa uma ancora generica quando o titulo nao tem letra nenhuma', () => {
    const { headings } = renderMarkdown('## ***');
    expect(headings[0]?.slug).toBe('secao');
  });

  it('nivel 4 ou mais entra no texto da secao, mas nao no indice', () => {
    const { headings, secoes } = renderMarkdown('## A\n\n#### Detalhe\n\ncorpo');
    expect(headings).toHaveLength(1);
    expect(secoes[0]?.texto).toContain('Detalhe');
  });
});

describe('marcacao de linha', () => {
  it('converte negrito, enfase, codigo e link', () => {
    const { html } = renderMarkdown('**forte** *leve* _leve_ `cod` [rot](/guide/depth)');
    expect(html).toContain('<strong>forte</strong>');
    expect(html).toContain('<em>leve</em> <em>leve</em>');
    expect(html).toContain('<code>cod</code>');
    expect(html).toContain('<a href="/guide/depth">rot</a>');
  });

  it('nao trata sublinhado no meio de uma palavra como enfase', () => {
    const { html } = renderMarkdown('teste_de_nome');
    expect(html).toBe('<p>teste_de_nome</p>');
  });

  it('abre link externo em outra aba', () => {
    const { html } = renderMarkdown('[npm](https://npmjs.com/a)');
    expect(html).toContain('target="_blank" rel="noopener"');
  });

  it('passa o link interno pelo resolvedor', () => {
    const { html } = renderMarkdown('[a](/guide/depth)', {
      resolverLink: (href) => `..${href}/`,
    });
    expect(html).toContain('href="../guide/depth/"');
  });

  it('escapa o que nao e marcacao', () => {
    const { html } = renderMarkdown('1 < 2 & 3 > 0');
    expect(html).toContain('1 &lt; 2 &amp; 3 &gt; 0');
  });

  it('converte marcacao dentro do negrito', () => {
    const { html } = renderMarkdown('**use `npm`**');
    expect(html).toContain('<strong>use <code>npm</code></strong>');
  });
});

describe('blocos', () => {
  it('realca o bloco de codigo e oferece o botao de copiar', () => {
    const { html } = renderMarkdown('```bash\n$ npm i\n```');
    expect(html).toContain('class="code-block__lang">bash<');
    expect(html).toContain('data-copy-text="$ npm i"');
    expect(html).toContain('tok-command');
  });

  it('bloco sem linguagem nao ganha rotulo nem realce', () => {
    const { html } = renderMarkdown('```\nlivre\n```');
    expect(html).not.toContain('code-block__lang');
    expect(html).toContain('<code>livre</code>');
  });

  it('monta tabela com alinhamento', () => {
    const { html } = renderMarkdown('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<th style="text-align:center">b</th>');
    expect(html).toContain('<th style="text-align:right">c</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('celula sem alinhamento declarado sai sem alinhamento, no cabecalho e no corpo', () => {
    const { html } = renderMarkdown('| a | sobra |\n|:-:|\n| 1 | 2 |');
    expect(html).toContain('<th style="text-align:center">a</th>');
    expect(html).toContain('<th>sobra</th>');
    expect(html).toContain('<td style="text-align:center">1</td>');
    expect(html).toContain('<td>2</td>');
  });

  it('linha comecando com barra vertical sem separador vira paragrafo', () => {
    const { html } = renderMarkdown('| isto nao e tabela');
    expect(html).toContain('<p>| isto nao e tabela</p>');
  });

  it('monta lista sem numeracao e com numeracao', () => {
    expect(renderMarkdown('- um\n- dois').html).toBe('<ul><li>um</li><li>dois</li></ul>');
    expect(renderMarkdown('1. um\n2. dois').html).toBe('<ol><li>um</li><li>dois</li></ol>');
  });

  it('junta a continuacao recuada de um item', () => {
    const { html } = renderMarkdown('- primeira\n  continuacao\n- segunda');
    expect(html).toContain('<li>primeira continuacao</li>');
  });

  it('aninha uma lista dentro do item', () => {
    const { html } = renderMarkdown('- pai\n  - filho\n  - outro');
    expect(html).toContain('<li>pai<ul><li>filho</li><li>outro</li></ul></li>');
  });

  it('monta citacao', () => {
    const { html } = renderMarkdown('> nota importante');
    expect(html).toBe('<blockquote><p>nota importante</p></blockquote>');
  });

  it('monta caixa de destaque com titulo', () => {
    const { html } = renderMarkdown(':::  warning Cuidado\ncorpo\n:::');
    expect(html).toContain('class="callout callout--warning"');
    expect(html).toContain('<p class="callout__title">Cuidado</p>');
    expect(html).toContain('<p>corpo</p>');
  });

  it('caixa sem tipo nenhum cai em informativa', () => {
    const { html } = renderMarkdown(':::\ncorpo\n:::');
    expect(html).toContain('callout--info');
    expect(html).toContain('<p>corpo</p>');
  });

  it('caixa de tipo desconhecido cai em informativa e dispensa titulo', () => {
    const { html } = renderMarkdown(':::segredo\ncorpo\n:::');
    expect(html).toContain('callout--info');
    expect(html).not.toContain('callout__title');
  });

  it('monta regra horizontal', () => {
    expect(renderMarkdown('---').html).toBe('<hr />');
    expect(renderMarkdown('***').html).toBe('<hr />');
  });

  it('deixa o HTML embutido passar inteiro', () => {
    const { html, secoes } = renderMarkdown('<div class="grafo">\n<span>oi</span>\n</div>');
    expect(html).toBe('<div class="grafo">\n<span>oi</span>\n</div>');
    expect(secoes[0]?.texto).toBe('oi');
  });

  it('ignora linha em branco entre blocos', () => {
    const { html } = renderMarkdown('um\n\n\n\ndois');
    expect(html).toBe('<p>um</p>\n<p>dois</p>');
  });
});

describe('secoes para a busca', () => {
  it('quebra por titulo e guarda o texto sem marcacao', () => {
    const { secoes } = renderMarkdown(
      '# Pagina\n\nabertura\n\n## Um\n\ntexto **um**\n\n## Dois\n\ntexto dois',
    );
    expect(secoes.map((secao) => secao.slug)).toEqual(['', 'um', 'dois']);
    expect(secoes[0]?.texto).toBe('abertura');
    expect(secoes[1]).toEqual({ slug: 'um', titulo: 'Um', texto: 'texto um' });
  });

  it('inclui o conteudo de codigo, tabela, lista e caixa', () => {
    const { secoes } = renderMarkdown(
      '## A\n\n```json\n{"chave": 1}\n```\n\n| col |\n|---|\n| val |\n\n- item\n\n::: tip Dica\nconselho\n:::',
    );
    const texto = secoes[0]?.texto ?? '';
    for (const trecho of ['chave', 'col', 'val', 'item', 'Dica', 'conselho']) {
      expect(texto).toContain(trecho);
    }
  });

  it('documento sem titulo nenhum devolve uma secao so', () => {
    const { secoes } = renderMarkdown('so um paragrafo');
    expect(secoes).toEqual([{ slug: '', titulo: '', texto: 'so um paragrafo' }]);
  });

  it('documento vazio nao devolve secao', () => {
    expect(renderMarkdown('').secoes).toEqual([]);
  });
});
