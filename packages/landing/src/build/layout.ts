/**
 * A moldura de toda pagina do site.
 *
 * Cabecalho, menu lateral, indice da direita, rodape e o dialogo de busca sao
 * montados aqui, em tempo de build, e gravados em HTML estatico. Nenhuma parte
 * da navegacao depende de JavaScript para existir: o script que roda depois
 * acrescenta busca, troca de tema e troca de idioma, mas uma pagina com o script
 * bloqueado continua completa e navegavel.
 *
 * Duas coisas correm antes de qualquer pintura, em script embutido no `<head>`:
 * a escolha de tema e a de idioma. Fossem carregadas com o bundle, a pagina
 * piscaria no tema errado antes de se corrigir.
 *
 * @packageDocumentation
 */

import { escapeHtml } from '../modules/highlight.js';
import { LOCALES, PREFIXO, TAG_BCP47, type Locale } from '../modules/i18n.js';
import type { Heading } from './markdown.js';
import * as icone from '../modules/icons.js';
import { caminhoRelativo, LINKS, TEXTOS, vizinhas, type Textos } from './routes.js';

/** Marcador que o plugin do Vite troca pelas tags de CSS e JavaScript. */
export const MARCADOR_DE_ATIVOS = '<!--@ativos-->';

/** Tudo que a moldura precisa saber sobre a pagina que esta embrulhando. */
export interface Pagina {
  /** Idioma da pagina. */
  locale: Locale;
  /** Rota sem idioma. `''` e a home. */
  rota: string;
  /** Titulo, usado no `<title>` e no compartilhamento. */
  titulo: string;
  /** Resumo de uma frase. */
  descricao: string;
  /** Corpo ja em HTML. */
  corpo: string;
  /** Titulos que alimentam o indice da direita. */
  headings: readonly Heading[];
  /** `true` quando e a home, que nao tem menu lateral nem indice. */
  home: boolean;
  /** Versao publicada no npm, mostrada ao lado da marca. */
  versao: string;
}

/** Caminho completo de uma rota, com idioma. */
export function rotaCompleta(locale: Locale, rota: string): string {
  return [PREFIXO[locale], rota].filter((parte) => parte !== '').join('/');
}

/** Um `<a>` para outra pagina do site, sempre com caminho relativo. */
function interno(
  daqui: string,
  locale: Locale,
  rota: string,
  conteudo: string,
  classe: string,
): string {
  const href = caminhoRelativo(daqui, rotaCompleta(locale, rota));
  return `<a class="${classe}" href="${href}">${conteudo}</a>`;
}

/** Traduz um link escrito no Markdown para o caminho relativo desta pagina. */
export function resolvedorDeLinks(daqui: string, locale: Locale): (href: string) => string {
  return (href) => {
    const [caminho = '', ancora] = href.split('#');
    const limpo = caminho.replace(/^\/+|\/+$/g, '');
    const sufixo = ancora === undefined ? '' : `#${ancora}`;
    if (limpo === '' && sufixo !== '') return sufixo;
    return `${caminhoRelativo(daqui, rotaCompleta(locale, limpo))}${sufixo}`;
  };
}

/** Cabecalho fixo: marca, navegacao, busca e as acoes da direita. */
function cabecalho(pagina: Pagina, textos: Textos, daqui: string): string {
  const links = textos.cabecalho
    .map((item) => {
      const acende =
        pagina.rota === item.rota ||
        (item.prefixo !== undefined && pagina.rota.startsWith(item.prefixo));
      const href = caminhoRelativo(daqui, rotaCompleta(pagina.locale, item.rota));
      return `<a href="${href}"${acende ? ' data-ativo' : ''}>${escapeHtml(item.rotulo)}</a>`;
    })
    .join('');

  const opcoesDeIdioma = LOCALES.map((l) => {
    const href = caminhoRelativo(daqui, rotaCompleta(l, pagina.rota));
    const marca = l === pagina.locale ? ' data-ativo' : '';
    return `<a role="menuitem" href="${href}" data-escolher-idioma="${l}"${marca}>${escapeHtml(TEXTOS[l].idioma)}</a>`;
  }).join('');

  const opcoesDeTema = (['light', 'dark', 'system'] as const)
    .map((tema, n) => {
      const simbolo = [icone.SOL, icone.LUA, icone.SISTEMA][n] as string;
      return `<button role="menuitem" type="button" data-tema="${tema}">${simbolo}<span>${escapeHtml(
        textos.temas[n] as string,
      )}</span></button>`;
    })
    .join('');

  return `<header class="topo" data-header>
      <div class="topo__faixa">
        ${interno(daqui, pagina.locale, '', `<span class="topo__marca-icone">${icone.MARCA}</span><span class="topo__marca-nome">livetest</span>`, 'topo__marca')}
        <a class="topo__versao" href="${LINKS.npmCli}" target="_blank" rel="noopener">v${escapeHtml(pagina.versao)}</a>

        <nav class="topo__links" aria-label="${escapeHtml(textos.navegacao)}">${links}</nav>

        <div class="topo__acoes">
          <button class="busca-botao" type="button" data-busca-abrir aria-label="${escapeHtml(textos.buscarDescricao)}">
            ${icone.BUSCA}<span class="busca-botao__texto">${escapeHtml(textos.buscar)}</span>
            <kbd class="busca-botao__tecla"><span data-tecla-modificador>Ctrl</span> K</kbd>
          </button>

          <div class="menu-suspenso" data-menu="idioma">
            <button class="icone-botao" type="button" aria-haspopup="true" aria-expanded="false" aria-label="${escapeHtml(textos.trocarIdioma)}">${icone.IDIOMA}</button>
            <div class="menu-suspenso__lista" role="menu">${opcoesDeIdioma}</div>
          </div>

          <div class="menu-suspenso" data-menu="tema">
            <button class="icone-botao" type="button" aria-haspopup="true" aria-expanded="false" aria-label="${escapeHtml(textos.trocarTema)}">
              <span data-tema-icone="light" hidden>${icone.SOL}</span><span data-tema-icone="dark">${icone.LUA}</span>
            </button>
            <div class="menu-suspenso__lista" role="menu" data-tema-lista>${opcoesDeTema}</div>
          </div>

          <a class="icone-botao" href="${LINKS.github}" target="_blank" rel="noopener" aria-label="${escapeHtml(textos.repositorio)}" title="${escapeHtml(textos.repositorio)}">${icone.GITHUB}</a>

          ${interno(daqui, pagina.locale, 'guide/getting-started', escapeHtml(textos.instalar), 'botao botao--primario topo__instalar')}

          <button class="icone-botao topo__menu" type="button" data-menu-lateral aria-expanded="false" aria-label="${escapeHtml(textos.menu)}">${icone.MENU}</button>
        </div>
      </div>
    </header>`;
}

/**
 * Menu lateral esquerdo.
 *
 * Em tela larga ele e a coluna de navegacao das paginas de documentacao, e na
 * home nao existe. Abaixo de 900px ele vira a gaveta que o botao do cabecalho
 * abre, e ai existe em toda pagina: os links do topo somem nessa largura, e sem
 * a gaveta a home ficaria sem navegacao nenhuma.
 *
 * Por isso o primeiro grupo repete os links do cabecalho e so aparece no
 * celular. Repetir no HTML e mais barato que uma segunda copia do menu inteiro,
 * que o leitor de tela anunciaria duas vezes.
 */
function menuLateral(pagina: Pagina, textos: Textos, daqui: string): string {
  const item = (rota: string, rotulo: string, prefixo?: string): string => {
    const href = caminhoRelativo(daqui, rotaCompleta(pagina.locale, rota));
    const acende =
      pagina.rota === rota || (prefixo !== undefined && pagina.rota.startsWith(prefixo));
    return `<li><a href="${href}"${acende ? ' aria-current="page"' : ''}>${escapeHtml(rotulo)}</a></li>`;
  };

  const doTopo = textos.cabecalho
    .map((link) => item(link.rota, link.rotulo, link.prefixo))
    .join('');

  const grupos = textos.menuLateral
    .map((grupo) => {
      const itens = grupo.itens.map((alvo) => item(alvo.rota, alvo.rotulo)).join('');
      return `<div class="lateral__grupo"><p class="lateral__titulo">${escapeHtml(grupo.titulo)}</p><ul>${itens}</ul></div>`;
    })
    .join('');

  return `<aside class="lateral" id="menu-lateral"><nav class="lateral__interno" aria-label="${escapeHtml(
    textos.menu,
  )}"><div class="lateral__grupo lateral__grupo--movel"><p class="lateral__titulo">${escapeHtml(
    textos.navegacao,
  )}</p><ul>${doTopo}</ul></div>${grupos}</nav></aside>`;
}

/** Indice da direita, montado a partir dos titulos da propria pagina. */
function indiceDaPagina(pagina: Pagina, textos: Textos): string {
  if (pagina.headings.length === 0) return '<aside class="indice" aria-hidden="true"></aside>';

  const itens = pagina.headings
    .map(
      (h) =>
        `<li class="indice__n${h.nivel}"><a href="#${h.slug}">${escapeHtml(h.texto)}</a></li>`,
    )
    .join('');

  return `<aside class="indice"><nav class="indice__interno" aria-label="${escapeHtml(
    textos.nestaPagina,
  )}"><p class="indice__titulo">${escapeHtml(
    textos.nestaPagina,
  )}</p><ul data-indice>${itens}</ul></nav></aside>`;
}

/** Links de pagina anterior e seguinte, no fim do texto. */
function passoAPasso(pagina: Pagina, textos: Textos, daqui: string): string {
  const { anterior, proxima } = vizinhas(textos, pagina.rota);
  if (anterior === null && proxima === null) return '';

  const lado = (item: typeof anterior, rotulo: string, classe: string): string => {
    if (item === null) return '<span></span>';
    const href = caminhoRelativo(daqui, rotaCompleta(pagina.locale, item.rota));
    return `<a class="passo ${classe}" href="${href}"><span class="passo__rotulo">${escapeHtml(
      rotulo,
    )}</span><span class="passo__nome">${escapeHtml(item.rotulo)}</span></a>`;
  };

  return `<nav class="passos">${lado(anterior, textos.anterior, 'passo--anterior')}${lado(
    proxima,
    textos.proxima,
    'passo--proxima',
  )}</nav>`;
}

/** Rodape, igual em toda pagina. */
function rodape(pagina: Pagina, textos: Textos, daqui: string): string {
  const colunas = textos.rodape
    .map((coluna) => {
      const links = coluna.links
        .map((item) => {
          const externo = /^https?:/.test(item.href);
          const href = externo
            ? item.href
            : caminhoRelativo(daqui, rotaCompleta(pagina.locale, item.href.replace(/^\/+/, '')));
          const extras = externo ? ' target="_blank" rel="noopener"' : '';
          return `<a href="${escapeHtml(href)}"${extras}>${escapeHtml(item.rotulo)}</a>`;
        })
        .join('');
      return `<div><h2>${escapeHtml(coluna.titulo)}</h2>${links}</div>`;
    })
    .join('');

  return `<footer class="rodape">
      <div class="rodape__interno">
        <div class="rodape__marca">
          <span class="topo__marca-icone">${icone.MARCA}</span>
          <div><p class="rodape__nome">Live Test Runner</p><p class="rodape__versao">v${escapeHtml(
            pagina.versao,
          )}</p></div>
        </div>
        <nav class="rodape__links">${colunas}</nav>
      </div>
      <p class="rodape__legal">${escapeHtml(textos.licenca)}</p>
    </footer>`;
}

/** Dialogo de busca, escondido ate alguem pedir. */
function dialogoDeBusca(textos: Textos): string {
  const [selecionar, navegar, fechar] = textos.dicasDeBusca;

  return `<div class="busca" data-busca hidden>
      <div class="busca__fundo" data-busca-fechar></div>
      <div class="busca__caixa" role="dialog" aria-modal="true" aria-label="${escapeHtml(
        textos.buscarDescricao,
      )}">
        <div class="busca__campo">
          ${icone.BUSCA}
          <input type="search" data-busca-entrada autocomplete="off" spellcheck="false"
                 placeholder="${escapeHtml(textos.buscarDescricao)}" aria-label="${escapeHtml(
                   textos.buscarDescricao,
                 )}" />
          <button class="icone-botao" type="button" data-busca-fechar aria-label="${escapeHtml(
            fechar as string,
          )}">${icone.FECHAR}</button>
        </div>
        <div class="busca__resultados" data-busca-resultados role="listbox"></div>
        <p class="busca__vazio" data-busca-vazio hidden>${escapeHtml(textos.semResultados)} <strong data-busca-termo></strong></p>
        <div class="busca__rodape">
          <span><kbd>↵</kbd> ${escapeHtml(selecionar as string)}</span>
          <span><kbd>↑</kbd><kbd>↓</kbd> ${escapeHtml(navegar as string)}</span>
          <span><kbd>esc</kbd> ${escapeHtml(fechar as string)}</span>
        </div>
      </div>
    </div>`;
}

/**
 * Script que decide o tema antes da primeira pintura.
 *
 * Roda no `<head>`, sincrono e sem dependencia. Precisa repetir a regra de
 * `modules/theme.ts` porque o bundle so chega depois; os testes comparam as
 * duas para que nunca se separem.
 */
export const SCRIPT_DE_TEMA =
  `(function(){try{var r=document.documentElement,t=localStorage.getItem('livetest:theme');` +
  `if(t!=='light'&&t!=='dark'&&t!=='system')t='dark';` +
  `var e=t==='system'?matchMedia('(prefers-color-scheme: dark)').matches:t==='dark';` +
  `r.dataset.theme=e?'dark':'light';r.dataset.temaEscolhido=t;}catch(x){}})();`;

/**
 * Script que leva a primeira visita ao idioma do navegador.
 *
 * So age uma vez por aba: a marca em `sessionStorage` existe para que uma
 * preferencia que nao pode ser gravada, em navegacao privada, nao vire um pingue
 * pongue entre os dois idiomas.
 */
export function scriptDeIdioma(atual: Locale, contraparte: string): string {
  return (
    `(function(){try{var a=${JSON.stringify(atual)},g=localStorage.getItem('livetest:locale');` +
    `var l=navigator.languages||[navigator.language||''],d='en';` +
    `for(var i=0;i<l.length;i++){var p=(l[i]||'').toLowerCase().split('-')[0];if(p==='pt'||p==='en'){d=p;break;}}` +
    `var alvo=(g==='pt'||g==='en')?g:d;` +
    `if(alvo!==a&&sessionStorage.getItem('livetest:auto')!=='1'){` +
    `sessionStorage.setItem('livetest:auto','1');location.replace(${JSON.stringify(contraparte)});}}catch(x){}})();`
  );
}

/**
 * Monta a pagina inteira.
 *
 * @param pagina - Conteudo e metadados.
 * @returns HTML completo, com {@link MARCADOR_DE_ATIVOS} no lugar das tags de
 * CSS e JavaScript, que so o plugin do Vite sabe preencher.
 *
 * @example
 * ```ts
 * const html = renderDocumento({ locale: 'en', rota: 'changelog', home: false, ... });
 * html.includes('<html lang="en"'); // true
 * ```
 */
export function renderDocumento(pagina: Pagina): string {
  const textos = TEXTOS[pagina.locale];
  const daqui = rotaCompleta(pagina.locale, pagina.rota);
  const raiz = caminhoRelativo(daqui, '');
  const outro = LOCALES.filter((l) => l !== pagina.locale)[0] as Locale;
  const contraparte = caminhoRelativo(daqui, rotaCompleta(outro, pagina.rota));

  const titulo = pagina.home
    ? `Live Test Runner · ${
        pagina.locale === 'pt'
          ? 'os testes certos, no instante do save'
          : 'the right tests, the moment you save'
      }`
    : `${pagina.titulo} | Live Test Runner`;

  const alternativas = LOCALES.map(
    (l) =>
      `<link rel="alternate" hreflang="${TAG_BCP47[l]}" href="__SITE_URL__/${rotaCompleta(l, pagina.rota)}${
        rotaCompleta(l, pagina.rota) === '' ? '' : '/'
      }" />`,
  ).join('\n    ');

  const corpo = pagina.home
    ? `${menuLateral(pagina, textos, daqui)}<main class="home" id="conteudo">${pagina.corpo}</main>`
    : `<div class="layout">
        ${menuLateral(pagina, textos, daqui)}
        <main class="doc" id="conteudo">
          <article class="doc__texto">${pagina.corpo}</article>
          ${passoAPasso(pagina, textos, daqui)}
        </main>
        ${indiceDaPagina(pagina, textos)}
      </div>`;

  return `<!doctype html>
<html lang="${TAG_BCP47[pagina.locale]}" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(titulo)}</title>
    <meta name="description" content="${escapeHtml(pagina.descricao)}" />
    <meta name="author" content="Victor José Lopes Navarro" />
    <meta name="color-scheme" content="dark light" />
    <link rel="canonical" href="__SITE_URL__/${daqui}${daqui === '' ? '' : '/'}" />
    ${alternativas}
    <link rel="alternate" hreflang="x-default" href="__SITE_URL__/" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Live Test Runner" />
    <meta property="og:locale" content="${pagina.locale === 'pt' ? 'pt_BR' : 'en_US'}" />
    <meta property="og:url" content="__SITE_URL__/${daqui}${daqui === '' ? '' : '/'}" />
    <meta property="og:title" content="${escapeHtml(titulo)}" />
    <meta property="og:description" content="${escapeHtml(pagina.descricao)}" />
    <meta property="og:image" content="__SITE_URL__/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(titulo)}" />
    <meta name="twitter:description" content="${escapeHtml(pagina.descricao)}" />
    <meta name="twitter:image" content="__SITE_URL__/og-image.png" />

    <link rel="icon" type="image/svg+xml" href="${raiz}favicon.svg" />
    <link rel="alternate icon" href="${raiz}favicon.ico" sizes="32x32" />
    <link rel="apple-touch-icon" href="${raiz}apple-touch-icon.png" />
    <link rel="manifest" href="${raiz}site.webmanifest" />

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
    />

    <script>${SCRIPT_DE_TEMA}</script>
    <script>${scriptDeIdioma(pagina.locale, contraparte)}</script>
    ${MARCADOR_DE_ATIVOS}
  </head>

  <body data-pagina="${pagina.home ? 'home' : 'doc'}" data-locale="${pagina.locale}" data-raiz="${raiz}">
    <a class="pular" href="#conteudo">${pagina.locale === 'pt' ? 'Pular para o conteúdo' : 'Skip to content'}</a>
    ${
      pagina.home
        ? `<div class="fundo" aria-hidden="true"><div class="fundo__grade"></div><div class="fundo__aurora fundo__aurora--um"></div><div class="fundo__aurora fundo__aurora--dois"></div><div class="fundo__brilho" data-cursor-glow></div></div>`
        : '<div class="progresso" data-scroll-progress aria-hidden="true"><i></i></div>'
    }
    ${cabecalho(pagina, textos, daqui)}
    ${corpo}
    ${rodape(pagina, textos, daqui)}
    ${dialogoDeBusca(textos)}
    <div class="cortina" data-cortina hidden></div>
  </body>
</html>
`;
}
