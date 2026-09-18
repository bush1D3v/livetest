/**
 * Ponto de entrada do site.
 *
 * So fiacao. Cada comportamento vive em `src/setup/`, e a logica que da para
 * testar sem DOM vive em `src/modules/`. Aqui se decide o que montar e se
 * animar: a home tem terminal e cartoes, as paginas de documentacao tem gaveta
 * e indice, e o grafo interativo aparece so onde alguem o escreveu no Markdown.
 * Montar o que nao existe seria barato, mas procurar por ele em toda pagina nao
 * e de graca, e o resultado seria um bundle que finge ter mais trabalho do que
 * tem.
 *
 * O idioma e o tema ja foram resolvidos antes desta linha, por dois scripts
 * embutidos no `<head>`. O que roda aqui apenas continua a partir do que eles
 * decidiram.
 *
 * @packageDocumentation
 */

import './styles/index.css';

import { isLocale, type Locale } from './modules/i18n.js';
import { prefersReducedMotion } from './modules/motion.js';
import { setupReveal } from './modules/reveal.js';
import { setupChrome } from './setup/chrome.js';
import { setupCopyButtons } from './setup/copy.js';
import { setupGraph } from './setup/graph.js';
import { setupNav } from './setup/nav.js';
import { setupPrefs } from './setup/prefs.js';
import { setupSearch } from './setup/search.js';
import { setupTerminal } from './setup/terminal.js';

/** Tudo o que a pagina montou, devolvido para inspecao em teste. */
export interface LandingApp {
  reveal: ReturnType<typeof setupReveal>;
  chrome: ReturnType<typeof setupChrome>;
  prefs: ReturnType<typeof setupPrefs>;
  nav: ReturnType<typeof setupNav>;
  search: ReturnType<typeof setupSearch>;
  copy: ReturnType<typeof setupCopyButtons>;
  /** Montado so na home. */
  terminal: ReturnType<typeof setupTerminal> | null;
  /** Montado so onde existe a demonstracao do grafo. */
  graph: ReturnType<typeof setupGraph> | null;
  /** Idioma da pagina. */
  readonly locale: Locale;
  /** `true` quando a pagina foi montada em modo estatico. */
  readonly reducedMotion: boolean;
  /** Desliga tudo o que consome quadros ou escuta eventos. */
  destroy(): void;
}

/** Opcoes de {@link mountSite}. */
export interface MountOptions {
  /** Documento usado. @defaultValue `document` */
  doc?: Document;
  /**
   * Forca o modo estatico. Quando omitido, consulta `prefers-reduced-motion` no
   * sistema do visitante.
   */
  reducedMotion?: boolean;
}

/**
 * Monta a pagina inteira.
 *
 * @example
 * ```ts
 * const app = mountSite();
 * app.graph?.select('transitive');
 * app.destroy();
 * ```
 */
export function mountSite(options: MountOptions = {}): LandingApp {
  const doc = options.doc ?? document;
  const estatico = options.reducedMotion ?? prefersReducedMotion();

  const bruto = doc.body.dataset['locale'];
  const locale: Locale = isLocale(bruto) ? bruto : 'en';
  const home = doc.body.dataset['pagina'] === 'home';

  const reveal = setupReveal({ root: doc, immediate: estatico });
  const chrome = setupChrome({ doc, disableCursorGlow: estatico });
  const prefs = setupPrefs({ doc });
  const nav = setupNav({ doc });
  const search = setupSearch({ doc });
  const copy = setupCopyButtons({ root: doc, locale });

  const terminal = home ? setupTerminal({ root: doc, immediate: estatico, locale }) : null;
  const graph = doc.querySelector('[data-graph-nodes]') ? setupGraph({ root: doc, locale }) : null;

  return {
    reveal,
    chrome,
    prefs,
    nav,
    search,
    copy,
    terminal,
    graph,
    locale,
    reducedMotion: estatico,
    destroy(): void {
      reveal.disconnect();
      chrome.destroy();
      prefs.destroy();
      nav.destroy();
      search.destroy();
      terminal?.stop();
    },
  };
}

// O HTML carrega este modulo com `type="module"`, que ja e adiado ate o
// documento estar montado: nao e preciso esperar `DOMContentLoaded`.
/* c8 ignore start -- so executa no navegador, nunca sob o runner de teste */
if (typeof document !== 'undefined' && document.body?.dataset['pagina'] !== undefined) {
  mountSite();
}
/* c8 ignore stop */
