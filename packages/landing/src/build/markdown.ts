/**
 * Markdown para HTML, em tempo de build.
 *
 * A documentacao do projeto ja existe em Markdown e e a fonte da verdade. Em vez
 * de reescreve-la em HTML, o build a converte. O subconjunto suportado e o que a
 * documentacao realmente usa, e nada alem: titulos, paragrafos, listas, tabelas,
 * citacoes, blocos de codigo, caixas de aviso e os quatro marcadores de linha.
 *
 * Trazer uma biblioteca de Markdown para isto seria contraditorio com o resto do
 * pacote, que nao carrega nem realce de sintaxe de terceiros. O conversor tem
 * tamanho de arquivo unico, e testado linha a linha, e roda so no build.
 *
 * Duas coisas saem junto com o HTML, porque so o parser sabe delas:
 *
 * - **os titulos**, que viram o indice lateral da pagina;
 * - **as secoes em texto puro**, que viram o indice de busca.
 *
 * @packageDocumentation
 */

import { escapeHtml, highlight, resolverLinguagem } from '../modules/highlight.js';

/** Um titulo da pagina, para o indice lateral. */
export interface Heading {
  /** Nivel do titulo: 2 ou 3. */
  nivel: number;
  /** Texto ja sem marcacao. */
  texto: string;
  /** Ancora estavel, usada no `id` e no link. */
  slug: string;
}

/** Um pedaco da pagina em texto puro, para a busca. */
export interface Secao {
  /** Ancora da secao; vazia na abertura da pagina. */
  slug: string;
  /** Titulo da secao; vazio na abertura da pagina. */
  titulo: string;
  /** Todo o texto da secao, sem marcacao. */
  texto: string;
}

/** O que {@link renderMarkdown} devolve. */
export interface Renderizado {
  /** HTML do corpo da pagina. */
  html: string;
  /** Titulos de nivel 2 e 3, na ordem em que aparecem. */
  headings: Heading[];
  /** Secoes em texto puro. */
  secoes: Secao[];
}

/** Opcoes de {@link renderMarkdown}. */
export interface RenderOptions {
  /**
   * Converte um link interno do Markdown no endereco que a pagina deve usar.
   *
   * O site inteiro usa caminho relativo, para continuar funcionando aberto do
   * disco ou servido de um subdiretorio. O Markdown, porem, e escrito com
   * caminho absoluto (`/guide/adapters`), que e o que da para ler. A traducao de
   * um para o outro depende de onde a pagina esta, e so quem monta a pagina
   * sabe disso.
   */
  resolverLink?: (href: string) => string;
}

/** Caixas de destaque reconhecidas em `::: tipo`. */
const AVISOS = new Set(['tip', 'info', 'warning', 'danger']);

/**
 * Transforma um texto em ancora.
 *
 * Acentos saem, o resto vira minusculo e tudo que nao e letra ou numero vira
 * hifen. Titulos diferentes que produzissem a mesma ancora sao desempatados por
 * quem chama, nao aqui.
 *
 * @example
 * ```ts
 * slugify('Profundidade de propagação'); // 'profundidade-de-propagacao'
 * ```
 */
export function slugify(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Tira a marcacao de um trecho, deixando so o texto.
 *
 * @example
 * ```ts
 * textoPuro('o **grafo** de `imports`'); // 'o grafo de imports'
 * ```
 */
export function textoPuro(markdown: string): string {
  return markdown
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Converte a marcacao que vale dentro de uma linha. */
function inline(texto: string, opcoes: RenderOptions): string {
  const padrao =
    /`([^`]+)`|\*\*([^*]+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(?<![A-Za-z0-9])_([^_]+?)_(?![A-Za-z0-9])|\*([^*]+?)\*/g;

  let saida = '';
  let cursor = 0;

  for (const achado of texto.matchAll(padrao)) {
    const de = achado.index;
    saida += escapeHtml(texto.slice(cursor, de));
    cursor = de + achado[0].length;

    const [, codigo, forte, rotulo, href, sublinhado, enfase] = achado;

    if (codigo !== undefined) saida += `<code>${escapeHtml(codigo)}</code>`;
    else if (forte !== undefined) saida += `<strong>${inline(forte, opcoes)}</strong>`;
    else if (rotulo !== undefined && href !== undefined) saida += link(rotulo, href, opcoes);
    else saida += `<em>${inline((sublinhado ?? enfase) as string, opcoes)}</em>`;
  }

  return saida + escapeHtml(texto.slice(cursor));
}

/** Monta um link, abrindo em outra aba so quando ele sai do site. */
function link(rotulo: string, href: string, opcoes: RenderOptions): string {
  const externo = /^[a-z]+:/i.test(href);
  const destino = externo ? href : (opcoes.resolverLink?.(href) ?? href);
  const extras = externo ? ' target="_blank" rel="noopener"' : '';
  return `<a href="${escapeHtml(destino)}"${extras}>${inline(rotulo, opcoes)}</a>`;
}

/** Estado acumulado enquanto o documento e percorrido. */
interface Acumulador {
  html: string[];
  headings: Heading[];
  secoes: Secao[];
  /** Texto puro da secao corrente, ainda sendo montado. */
  buffer: string[];
  /** Cabecalho da secao corrente. */
  atual: { slug: string; titulo: string };
  /** Ancoras ja usadas, para desempatar titulos repetidos. */
  usados: Set<string>;
}

/** Fecha a secao corrente e comeca outra. */
function virarSecao(estado: Acumulador, slug: string, titulo: string): void {
  const texto = estado.buffer.join(' ').replace(/\s+/g, ' ').trim();
  if (texto !== '' || estado.atual.titulo !== '') {
    estado.secoes.push({ ...estado.atual, texto });
  }
  estado.buffer = [];
  estado.atual = { slug, titulo };
}

/** Garante que a ancora e unica no documento. */
function ancoraUnica(estado: Acumulador, base: string): string {
  let slug = base === '' ? 'secao' : base;
  let n = 2;
  while (estado.usados.has(slug)) slug = `${base}-${n++}`;
  estado.usados.add(slug);
  return slug;
}

/**
 * Converte um documento Markdown inteiro.
 *
 * @param markdown - Conteudo do arquivo, sem o frontmatter.
 * @param opcoes - Como resolver links internos.
 *
 * @example
 * ```ts
 * const { html, headings } = renderMarkdown('## Watch\n\nGlobs observados.');
 * headings[0]?.slug; // 'watch'
 * ```
 */
export function renderMarkdown(markdown: string, opcoes: RenderOptions = {}): Renderizado {
  const linhas = markdown.replace(/\r\n/g, '\n').split('\n');
  const estado: Acumulador = {
    html: [],
    headings: [],
    secoes: [],
    buffer: [],
    atual: { slug: '', titulo: '' },
    usados: new Set(),
  };

  let i = 0;
  while (i < linhas.length) {
    const linha = linhas[i] as string;

    if (linha.trim() === '') {
      i++;
      continue;
    }

    const titulo = /^(#{1,6})\s+(.*)$/.exec(linha);
    if (titulo) {
      blocoTitulo(estado, titulo, opcoes);
      i++;
      continue;
    }

    const cerca = /^```\s*([\w-]*)/.exec(linha);
    if (cerca) {
      i = blocoCodigo(estado, linhas, i, cerca[1] as string);
      continue;
    }

    if (/^<[A-Za-z/!]/.test(linha)) {
      i = blocoHtml(estado, linhas, i);
      continue;
    }

    if (/^:::/.test(linha)) {
      i = blocoAviso(estado, linhas, i, opcoes);
      continue;
    }

    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(linha)) {
      estado.html.push('<hr />');
      i++;
      continue;
    }

    if (linha.startsWith('|')) {
      const fim = blocoTabela(estado, linhas, i, opcoes);
      if (fim !== i) {
        i = fim;
        continue;
      }
    }

    if (linha.startsWith('>')) {
      i = blocoCitacao(estado, linhas, i, opcoes);
      continue;
    }

    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(linha)) {
      i = blocoLista(estado, linhas, i, opcoes);
      continue;
    }

    i = blocoParagrafo(estado, linhas, i, opcoes);
  }

  virarSecao(estado, '', '');

  return { html: estado.html.join('\n'), headings: estado.headings, secoes: estado.secoes };
}

/** `## Titulo` e seus vizinhos. */
function blocoTitulo(estado: Acumulador, achado: RegExpExecArray, opcoes: RenderOptions): void {
  const nivel = (achado[1] as string).length;
  const bruto = achado[2] as string;
  const puro = textoPuro(bruto);
  const slug = ancoraUnica(estado, slugify(puro));

  // O `<h1>` e o titulo da pagina, ja mostrado pelo cabecalho; ele abre a secao
  // de introducao em vez de virar um item do indice lateral.
  if (nivel === 1) {
    virarSecao(estado, '', '');
    estado.html.push(`<h1>${inline(bruto, opcoes)}</h1>`);
    return;
  }

  if (nivel <= 3) {
    virarSecao(estado, slug, puro);
    estado.headings.push({ nivel, texto: puro, slug });
  } else {
    estado.buffer.push(puro);
  }

  const ancora = `<a class="header-anchor" href="#${slug}" aria-hidden="true">#</a>`;
  estado.html.push(`<h${nivel} id="${slug}">${inline(bruto, opcoes)}${ancora}</h${nivel}>`);
}

/**
 * Bloco entre cercas de crase.
 *
 * O nome da linguagem chega pronto: quem o extraiu foi o laco principal, ao
 * decidir que a linha abria um bloco. Reextrair aqui seria repetir um
 * casamento que ja se sabe ter dado certo.
 */
function blocoCodigo(
  estado: Acumulador,
  linhas: readonly string[],
  inicio: number,
  idioma: string,
): number {
  let i = inicio + 1;
  const corpo: string[] = [];
  while (i < linhas.length && !/^```/.test(linhas[i] as string)) {
    corpo.push(linhas[i] as string);
    i++;
  }

  const codigo = corpo.join('\n');
  estado.buffer.push(codigo);

  const rotulo = idioma === '' ? '' : `<span class="code-block__lang">${escapeHtml(idioma)}</span>`;
  estado.html.push(
    `<div class="code-block-wrap" data-copy-root>${rotulo}` +
      `<button class="code-block__copy" type="button" data-copy-button data-copy-text="${escapeHtml(codigo)}">` +
      `<span data-copy-label>copy</span></button>` +
      `<pre class="code-block"><code>${highlight(codigo, resolverLinguagem(idioma))}</code></pre></div>`,
  );

  return i + 1;
}

/**
 * HTML escrito direto no Markdown.
 *
 * Vale para o que o Markdown nao sabe descrever: a demonstracao interativa do
 * grafo, por exemplo, e marcacao com ganchos que o script procura. Comeca em uma
 * linha que abre uma tag na coluna zero e vai ate a proxima linha em branco,
 * que e a regra do proprio Markdown para bloco de HTML.
 */
function blocoHtml(estado: Acumulador, linhas: readonly string[], inicio: number): number {
  let i = inicio;
  const corpo: string[] = [];

  while (i < linhas.length && (linhas[i] as string).trim() !== '') {
    corpo.push(linhas[i] as string);
    i++;
  }

  const html = corpo.join('\n');
  // Para a busca, so o texto: os nomes das tags e dos atributos poluiriam o
  // indice com palavras que ninguem procura.
  estado.buffer.push(textoPuro(html.replace(/<[^>]*>/g, ' ')));
  estado.html.push(html);

  return i;
}

/** Caixa de destaque `::: tipo Titulo`. */
function blocoAviso(
  estado: Acumulador,
  linhas: readonly string[],
  inicio: number,
  opcoes: RenderOptions,
): number {
  const abertura = /^:::\s*(\w+)\s*(.*)$/.exec(linhas[inicio] as string);
  const tipo = abertura?.[1] ?? 'info';
  const rotulo = (abertura?.[2] ?? '').trim();
  const classe = AVISOS.has(tipo) ? tipo : 'info';

  let i = inicio + 1;
  const corpo: string[] = [];
  while (i < linhas.length && !/^:::\s*$/.test(linhas[i] as string)) {
    corpo.push(linhas[i] as string);
    i++;
  }

  const dentro = renderMarkdown(corpo.join('\n'), opcoes);
  estado.buffer.push(rotulo, ...dentro.secoes.map((secao) => secao.texto));

  const titulo = rotulo === '' ? '' : `<p class="callout__title">${inline(rotulo, opcoes)}</p>`;
  estado.html.push(`<div class="callout callout--${classe}">${titulo}${dentro.html}</div>`);

  return i + 1;
}

/** Tabela com cabecalho e linha de alinhamento. */
function blocoTabela(
  estado: Acumulador,
  linhas: readonly string[],
  inicio: number,
  opcoes: RenderOptions,
): number {
  const separador = linhas[inicio + 1];
  if (separador === undefined || !/^\|[\s:|-]+\|?\s*$/.test(separador)) return inicio;

  const celulas = (linha: string): string[] =>
    linha
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((celula) => celula.trim());

  const cabecalho = celulas(linhas[inicio] as string);
  const alinhamentos = celulas(separador).map((marca) =>
    marca.startsWith(':') && marca.endsWith(':')
      ? ' style="text-align:center"'
      : marca.endsWith(':')
        ? ' style="text-align:right"'
        : '',
  );

  let i = inicio + 2;
  const corpo: string[][] = [];
  while (i < linhas.length && (linhas[i] as string).startsWith('|')) {
    corpo.push(celulas(linhas[i] as string));
    i++;
  }

  estado.buffer.push(...cabecalho.map(textoPuro), ...corpo.flat().map(textoPuro));

  // Uma celula sem alinhamento declarado e o caso de uma linha com mais colunas
  // que a de alinhamento. Vale para o cabecalho e para o corpo, entao a decisao
  // fica em um lugar so.
  const alinhamento = (n: number): string => alinhamentos[n] ?? '';

  const th = cabecalho
    .map((celula, n) => `<th${alinhamento(n)}>${inline(celula, opcoes)}</th>`)
    .join('');
  const tr = corpo
    .map(
      (linha) =>
        `<tr>${linha
          .map((celula, n) => `<td${alinhamento(n)}>${inline(celula, opcoes)}</td>`)
          .join('')}</tr>`,
    )
    .join('');

  estado.html.push(
    `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`,
  );

  return i;
}

/** Citacao iniciada por `>`. */
function blocoCitacao(
  estado: Acumulador,
  linhas: readonly string[],
  inicio: number,
  opcoes: RenderOptions,
): number {
  let i = inicio;
  const corpo: string[] = [];
  while (i < linhas.length && (linhas[i] as string).startsWith('>')) {
    corpo.push((linhas[i] as string).replace(/^>\s?/, ''));
    i++;
  }

  const dentro = renderMarkdown(corpo.join('\n'), opcoes);
  estado.buffer.push(...dentro.secoes.map((secao) => secao.texto));
  estado.html.push(`<blockquote>${dentro.html}</blockquote>`);

  return i;
}

/** Lista com ou sem numeracao, aceitando um nivel de aninhamento. */
function blocoLista(
  estado: Acumulador,
  linhas: readonly string[],
  inicio: number,
  opcoes: RenderOptions,
): number {
  const primeiro = /^(\s*)([-*+]|\d+\.)\s+/.exec(linhas[inicio] as string) as RegExpExecArray;
  const recuo = (primeiro[1] as string).length;
  const ordenada = /\d/.test(primeiro[2] as string);

  const itens: string[][] = [];
  let i = inicio;

  while (i < linhas.length) {
    const linha = linhas[i] as string;
    const marcador = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(linha);

    if (marcador && (marcador[1] as string).length === recuo) {
      itens.push([marcador[3] as string]);
      i++;
      continue;
    }

    // Continuacao do item anterior: linha recuada ou linha solta logo abaixo.
    const dono = itens[itens.length - 1];
    if (dono !== undefined && linha.trim() !== '' && (marcador || /^\s/.test(linha))) {
      dono.push(linha.slice(recuo));
      i++;
      continue;
    }

    break;
  }

  const html = itens
    .map((partes) => {
      const conteudo = partes.join('\n');
      const aninhada = /\n\s*(?:[-*+]|\d+\.)\s+/.test(`\n${conteudo}`.slice(1));
      estado.buffer.push(textoPuro(conteudo.replace(/\n/g, ' ')));
      if (!aninhada) return `<li>${inline(conteudo.replace(/\s*\n\s*/g, ' '), opcoes)}</li>`;

      const quebra = conteudo.search(/\n\s*(?:[-*+]|\d+\.)\s+/);
      const cabeca = conteudo.slice(0, quebra).replace(/\s*\n\s*/g, ' ');
      const resto = renderMarkdown(
        conteudo
          .slice(quebra + 1)
          .split('\n')
          .map((l) => l.replace(/^\s{0,2}/, ''))
          .join('\n'),
        opcoes,
      );
      return `<li>${inline(cabeca, opcoes)}${resto.html}</li>`;
    })
    .join('');

  const tag = ordenada ? 'ol' : 'ul';
  estado.html.push(`<${tag}>${html}</${tag}>`);

  return i;
}

/**
 * Paragrafo comum: tudo ate a proxima linha em branco.
 *
 * E o ultimo recurso do laco principal, e por isso a primeira linha e sempre
 * consumida, mesmo que ela pareca abrir outro bloco. Uma linha que comeca com
 * barra vertical mas nao e seguida da linha de alinhamento chega ate aqui
 * justamente porque nao e tabela; se o paragrafo tambem a recusasse, o
 * documento nunca avancaria.
 */
function blocoParagrafo(
  estado: Acumulador,
  linhas: readonly string[],
  inicio: number,
  opcoes: RenderOptions,
): number {
  let i = inicio;
  const corpo: string[] = [];

  while (i < linhas.length) {
    const linha = linhas[i] as string;
    const outroBloco =
      linha.trim() === '' ||
      /^(?:#{1,6}\s|```|:::|>|\||<[A-Za-z/!])/.test(linha) ||
      /^\s*(?:[-*+]|\d+\.)\s+/.test(linha);

    if (outroBloco && i > inicio) break;

    corpo.push(linha.trim());
    i++;
  }

  const texto = corpo.join(' ');
  estado.buffer.push(textoPuro(texto));
  estado.html.push(`<p>${inline(texto, opcoes)}</p>`);

  return i;
}
