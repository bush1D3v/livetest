/**
 * A home.
 *
 * E a unica pagina escrita em HTML e nao em Markdown, porque e a unica cujo
 * conteudo *e* o layout: o terminal que digita sozinho, a chamada, os cartoes.
 * Tudo que tem texto corrido de verdade vive em `content/` e passa pelo
 * conversor de Markdown.
 *
 * A pagina e curta de proposito. Ela apresenta a ferramenta, mostra a saida real
 * de um lote, resume o que vem na caixa e entrega a pessoa a documentacao, que e
 * onde o assunto continua. Rolar por dez secoes so adia a mesma decisao.
 *
 * @packageDocumentation
 */

import { escapeHtml } from '../modules/highlight.js';
import type { Locale } from '../modules/i18n.js';
import * as icone from '../modules/icons.js';
import { caminhoRelativo, LINKS } from './routes.js';
import { rotaCompleta } from './layout.js';

/** Um cartao de recurso. */
interface Cartao {
  /** Simbolo mostrado acima do titulo. */
  marca: string;
  /** Titulo do cartao. */
  titulo: string;
  /** Duas ou tres linhas de explicacao, em HTML. */
  texto: string;
}

/** Textos da home, por idioma. */
interface TextosDaHome {
  /** Linha pequena acima do titulo. */
  chamada: string;
  /** Titulo, com a segunda linha destacada. */
  titulo: readonly [string, string];
  /** Paragrafo de abertura, em HTML. */
  resumo: string;
  /** Rotulo do botao principal. */
  comecar: string;
  /** Rotulo do botao secundario. */
  porQue: string;
  /** Titulo da faixa de recursos. */
  recursos: string;
  /** Subtitulo da faixa de recursos. */
  recursosResumo: string;
  /** Os seis cartoes. */
  cartoes: readonly Cartao[];
  /** Titulo da chamada final. */
  fecho: string;
  /** Texto da chamada final. */
  fechoTexto: string;
  /** Rotulo do botao de copiar. */
  copiar: string;
  /** Nome dos numeros mostrados sob o terminal. */
  numeros: readonly { valor: string; rotulo: string }[];
}

const EN: TextosDaHome = {
  chamada: 'devDependency · JS/TS and Python · no config required',
  titulo: ['The right tests,', 'the moment you save'],
  resumo:
    'Live Test Runner watches your project, works out from the <strong>dependency graph</strong> which tests your change affects, including the tests of the files that <em>import</em> it, and runs only that subset. In seconds. Then it tells you <strong>why</strong> each test ran.',
  comecar: 'Get started',
  porQue: 'Why it exists',
  recursos: 'What comes in the box',
  recursosResumo:
    'Small where it should stay out of your way, complete where it matters.',
  cartoes: [
    {
      marca: '◈',
      titulo: 'A real dependency graph',
      texto:
        'JS/TS through the TypeScript compiler API, resolving <code>paths</code>, <code>baseUrl</code>, <code>index.*</code> and the <code>./x.js → ./x.ts</code> mapping. Python through the native <code>ast</code> module.',
    },
    {
      marca: '⌁',
      titulo: 'Every selection is explained',
      texto:
        'No test runs without a reason attached. Not sure what a change will trigger? <code>livetest why src/login.ts</code> prints the full import chain before you touch anything.',
    },
    {
      marca: '◱',
      titulo: 'Two readers, one daemon',
      texto:
        'A grepable summary line, an always-current <code>status.json</code> and an append-only NDJSON log for the agent. A file tree with status and reasons for you, inside VSCode.',
    },
    {
      marca: '⏱',
      titulo: 'Debounce that never stalls',
      texto:
        'Consecutive saves are grouped by idle time <em>and</em> by a maximum window, so a long editing streak never postpones the tests forever, and no keystroke fires a run of its own.',
    },
    {
      marca: '⚑',
      titulo: 'It degrades, it does not fall over',
      texto:
        'Python gone? It falls back to regex analysis and says so. Adapter broken? The file runs on its own and the event explains what changed. The daemon stays up.',
    },
    {
      marca: '⬡',
      titulo: 'Pluggable adapters',
      texto:
        'Go, Rust, Java: implement two interfaces, or use the <code>command</code> adapter and get watching, debounce and source-to-test mapping without writing a line.',
    },
  ],
  fecho: 'Stop finding out at the end',
  fechoTexto:
    'Node.js 18.18 or newer. For Python projects, a 3.8+ interpreter on your <code>PATH</code>. Nothing else.',
  copiar: 'Copy',
  numeros: [
    { valor: '1167', rotulo: 'tests across four packages' },
    { valor: '100%', rotulo: 'enforced coverage' },
    { valor: '0', rotulo: 'runtime dependencies on this page' },
  ],
};

const PT: TextosDaHome = {
  chamada: 'devDependency · JS/TS e Python · sem configuração obrigatória',
  titulo: ['Os testes certos,', 'no instante do save'],
  resumo:
    'O Live Test Runner observa o projeto, descobre pelo <strong>grafo de dependências</strong> quais testes a sua alteração afeta, inclusive os de quem <em>importa</em> o arquivo, e roda só esse subconjunto. Em segundos. E te diz <strong>por que</strong> cada teste rodou.',
  comecar: 'Começar agora',
  porQue: 'Por que existe',
  recursos: 'O que vem na caixa',
  recursosResumo: 'Pequeno onde precisa sair do caminho, completo onde importa.',
  cartoes: [
    {
      marca: '◈',
      titulo: 'Grafo de dependências de verdade',
      texto:
        'JS/TS pela API do compilador TypeScript, resolvendo <code>paths</code>, <code>baseUrl</code>, <code>index.*</code> e o mapeamento <code>./x.js → ./x.ts</code>. Python pelo módulo <code>ast</code> nativo.',
    },
    {
      marca: '⌁',
      titulo: 'Toda seleção vem explicada',
      texto:
        'Nenhum teste roda sem um motivo anexado. Não sabe o que uma mudança vai disparar? <code>livetest why src/login.ts</code> mostra a cadeia inteira antes de você tocar em nada.',
    },
    {
      marca: '◱',
      titulo: 'Dois leitores, um só daemon',
      texto:
        'Uma linha resumo grepável, um <code>status.json</code> sempre atual e um log NDJSON append-only para o agente. Uma árvore de arquivos com status e motivo para você, dentro do VSCode.',
    },
    {
      marca: '⏱',
      titulo: 'Debounce que não trava',
      texto:
        'Saves consecutivos são agrupados por inatividade <em>e</em> por janela máxima, então uma sequência longa de edições nunca adia os testes para sempre, nem cada tecla dispara uma execução.',
    },
    {
      marca: '⚑',
      titulo: 'Degrada, não cai',
      texto:
        'Python sumiu? Cai para análise por expressão regular e avisa. Adapter quebrou? O arquivo roda isolado e o evento diz o que mudou. O daemon segue de pé.',
    },
    {
      marca: '⬡',
      titulo: 'Adapters plugáveis',
      texto:
        'Go, Rust, Java: implemente duas interfaces, ou use o adapter <code>command</code> e tenha watch, debounce e mapeamento fonte para teste sem escrever uma linha.',
    },
  ],
  fecho: 'Pare de descobrir a quebra no final',
  fechoTexto:
    'Node.js 18.18 ou mais novo. Para projetos Python, um interpretador 3.8+ no <code>PATH</code>. Nada além disso.',
  copiar: 'Copiar',
  numeros: [
    { valor: '1167', rotulo: 'testes nos quatro pacotes' },
    { valor: '100%', rotulo: 'de cobertura obrigatória' },
    { valor: '0', rotulo: 'dependências em runtime nesta página' },
  ],
};

/** Textos da home, por idioma. */
export const TEXTOS_DA_HOME: Readonly<Record<Locale, TextosDaHome>> = { en: EN, pt: PT };

/** Resumo de uma frase, usado na `<meta name="description">` e no Open Graph. */
export const DESCRICAO_DA_HOME: Readonly<Record<Locale, string>> = {
  en: 'Live Test Runner watches your project, resolves which tests a change affects through the dependency graph and runs only those, explaining why each one ran. Built for humans and for AI agents.',
  pt: 'O Live Test Runner observa o projeto, resolve quais testes uma alteração afeta pelo grafo de dependências e roda só esse subconjunto, explicando por que cada teste rodou. Para humanos e para agentes de IA.',
};

/**
 * Monta o corpo da home.
 *
 * @param locale - Idioma da pagina.
 * @returns HTML do `<main>`, sem a moldura.
 *
 * @example
 * ```ts
 * renderHome('pt').includes('data-terminal-output'); // true
 * ```
 */
export function renderHome(locale: Locale): string {
  const t = TEXTOS_DA_HOME[locale];
  const daqui = rotaCompleta(locale, '');
  const para = (rota: string): string => caminhoRelativo(daqui, rotaCompleta(locale, rota));

  const cartoes = t.cartoes
    .map(
      (cartao) =>
        `<article class="cartao" data-reveal><span class="cartao__marca" aria-hidden="true">${cartao.marca}</span><h3>${escapeHtml(
          cartao.titulo,
        )}</h3><p>${cartao.texto}</p></article>`,
    )
    .join('');

  const numeros = t.numeros
    .map(
      (numero) =>
        `<div><strong>${escapeHtml(numero.valor)}</strong><span>${escapeHtml(numero.rotulo)}</span></div>`,
    )
    .join('');

  return `<section class="heroi">
      <div class="heroi__texto" data-reveal>
        <p class="chamada"><span class="pulso" aria-hidden="true"></span>${escapeHtml(t.chamada)}</p>
        <h1 class="heroi__titulo">${escapeHtml(t.titulo[0])}<br /><span class="degrade">${escapeHtml(
          t.titulo[1],
        )}</span></h1>
        <p class="heroi__resumo">${t.resumo}</p>

        <div class="heroi__acoes">
          <a class="botao botao--primario botao--grande" href="${para('guide/getting-started')}">${escapeHtml(
            t.comecar,
          )}${icone.SETA}</a>
          <a class="botao botao--fantasma botao--grande" href="${para('guide/introduction')}">${escapeHtml(
            t.porQue,
          )}</a>
        </div>

        <div class="instalar" data-copy-root>
          <code class="instalar__cmd" data-copy-source>npm install --save-dev @livetest/cli</code>
          <button class="instalar__botao" type="button" data-copy-button aria-label="${escapeHtml(
            t.copiar,
          )}"><span data-copy-label>${escapeHtml(t.copiar)}</span></button>
        </div>
      </div>

      <div class="heroi__terminal" data-reveal>
        <div class="terminal" data-terminal-shell>
          <div class="terminal__barra">
            <span class="terminal__ponto terminal__ponto--vermelho"></span>
            <span class="terminal__ponto terminal__ponto--amarelo"></span>
            <span class="terminal__ponto terminal__ponto--verde"></span>
            <span class="terminal__titulo">livetest start</span>
            <span class="terminal__selo" data-terminal-badge>idle</span>
          </div>
          <pre class="terminal__corpo"><code data-terminal-output></code></pre>
        </div>
        <div class="numeros">${numeros}</div>
      </div>
    </section>

    <section class="faixa">
      <div class="faixa__cabeca" data-reveal>
        <h2>${escapeHtml(t.recursos)}</h2>
        <p>${escapeHtml(t.recursosResumo)}</p>
      </div>
      <div class="cartoes">${cartoes}</div>
    </section>

    <section class="fecho" data-reveal>
      <h2>${escapeHtml(t.fecho)}</h2>
      <p>${t.fechoTexto}</p>
      <div class="instalar instalar--grande" data-copy-root>
        <code class="instalar__cmd" data-copy-source>npx livetest init &amp;&amp; npx livetest start</code>
        <button class="instalar__botao" type="button" data-copy-button aria-label="${escapeHtml(
          t.copiar,
        )}"><span data-copy-label>${escapeHtml(t.copiar)}</span></button>
      </div>
      <p class="fecho__pacotes">
        <a href="${LINKS.npmCli}" target="_blank" rel="noopener">@livetest/cli</a>
        <a href="${LINKS.npmCore}" target="_blank" rel="noopener">@livetest/core</a>
        <a href="${LINKS.marketplace}" target="_blank" rel="noopener">VSCode</a>
      </p>
    </section>`;
}
