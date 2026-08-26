/**
 * Ponto de entrada da landing.
 *
 * Só fiação: cada comportamento vive em `src/setup/`, e a lógica que dá para
 * testar sem DOM vive em `src/modules/`. Aqui se decide apenas *se* animar —
 * a resposta depende do que o visitante pediu no sistema operacional.
 *
 * @packageDocumentation
 */

import './styles/index.css';

import { prefersReducedMotion } from './modules/motion.js';
import { setupReveal } from './modules/reveal.js';
import { setupChrome } from './setup/chrome.js';
import { setupCodeBlocks } from './setup/code.js';
import { setupCopyButtons } from './setup/copy.js';
import { setupGraph } from './setup/graph.js';
import { setupTerminal } from './setup/terminal.js';

/** Tudo o que a página montou, devolvido para inspeção em teste. */
export interface LandingApp {
  reveal: ReturnType<typeof setupReveal>;
  chrome: ReturnType<typeof setupChrome>;
  terminal: ReturnType<typeof setupTerminal>;
  graph: ReturnType<typeof setupGraph>;
  code: ReturnType<typeof setupCodeBlocks>;
  copy: ReturnType<typeof setupCopyButtons>;
  /** `true` quando a página foi montada em modo estático. */
  readonly reducedMotion: boolean;
  /** Desliga tudo o que consome quadros ou escuta eventos. */
  destroy(): void;
}

/** Opções de {@link mountLanding}. */
export interface MountOptions {
  /** Documento usado. @defaultValue `document` */
  doc?: Document;
  /**
   * Força o modo estático. Quando omitido, consulta
   * `prefers-reduced-motion` no sistema do visitante.
   */
  reducedMotion?: boolean;
}

/**
 * Monta a página inteira.
 *
 * @example
 * ```ts
 * const app = mountLanding();
 * app.graph.select('transitive');
 * app.destroy();
 * ```
 */
export function mountLanding(options: MountOptions = {}): LandingApp {
  const doc = options.doc ?? document;
  const estatico = options.reducedMotion ?? prefersReducedMotion();

  const reveal = setupReveal({ root: doc, immediate: estatico });
  const chrome = setupChrome({ doc, disableCursorGlow: estatico });
  const terminal = setupTerminal({ root: doc, immediate: estatico });
  const graph = setupGraph({ root: doc });
  const code = setupCodeBlocks({ root: doc });
  const copy = setupCopyButtons({ root: doc });

  return {
    reveal,
    chrome,
    terminal,
    graph,
    code,
    copy,
    reducedMotion: estatico,
    destroy(): void {
      reveal.disconnect();
      chrome.destroy();
      terminal.stop();
    },
  };
}

// O `index.html` carrega este módulo com `type="module"`, que já é adiado até
// o documento estar montado — não é preciso esperar `DOMContentLoaded`.
/* c8 ignore start -- só executa no navegador, nunca sob o runner de teste */
if (typeof document !== 'undefined' && document.querySelector('[data-terminal-output]')) {
  mountLanding();
}
/* c8 ignore stop */
