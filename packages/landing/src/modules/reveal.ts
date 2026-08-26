/**
 * Revelacao por rolagem.
 *
 * Elementos marcados com `data-reveal` entram com um leve deslocamento quando
 * aparecem na tela. A implementacao usa `IntersectionObserver` — e nao eventos
 * de scroll — para nao disputar a thread principal com o editor e o daemon do
 * usuario, que e exatamente o que a ferramenta promete nao fazer.
 *
 * @packageDocumentation
 */

/** Observador na forma minima usada aqui. */
export interface RevealObserver {
  observe(element: Element): void;
  disconnect(): void;
}

/** Fabrica de observadores, injetavel em teste. */
export type RevealObserverFactory = (
  callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void,
) => RevealObserver;

/** Opcoes de {@link setupReveal}. */
export interface RevealOptions {
  /** Raiz da busca pelos elementos. @defaultValue `document` */
  root?: ParentNode;
  /** Seletor dos elementos revelados. @defaultValue `'[data-reveal]'` */
  selector?: string;
  /** Classe aplicada quando o elemento aparece. @defaultValue `'is-revealed'` */
  revealedClass?: string;
  /**
   * Revela tudo de imediato, sem observar. Usado quando o visitante pediu
   * movimento reduzido ou quando o navegador nao tem `IntersectionObserver`.
   */
  immediate?: boolean;
  factory?: RevealObserverFactory;
}

/** Controle da revelacao. */
export interface Reveal {
  /** Quantidade de elementos observados. */
  readonly count: number;
  /** Para de observar. */
  disconnect(): void;
}

/** Fabrica padrao, apoiada no `IntersectionObserver` do navegador. */
export const intersectionFactory: RevealObserverFactory | undefined =
  typeof globalThis.IntersectionObserver === 'function'
    ? (callback) =>
        new globalThis.IntersectionObserver(
          (entries) =>
            callback(entries.map((entry) => ({ target: entry.target, isIntersecting: entry.isIntersecting }))),
          { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
        )
    : undefined;

/**
 * Liga a revelacao por rolagem.
 *
 * @example
 * ```ts
 * setupReveal({ immediate: prefersReducedMotion() });
 * ```
 */
export function setupReveal(options: RevealOptions = {}): Reveal {
  const root = options.root ?? document;
  const selector = options.selector ?? '[data-reveal]';
  const revealedClass = options.revealedClass ?? 'is-revealed';
  const factory = options.factory ?? intersectionFactory;

  const elementos = [...root.querySelectorAll(selector)];

  if (options.immediate === true || !factory) {
    for (const elemento of elementos) elemento.classList.add(revealedClass);
    return { count: elementos.length, disconnect: () => {} };
  }

  const observador = factory((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add(revealedClass);
    }
  });

  for (const elemento of elementos) observador.observe(elemento);

  return {
    count: elementos.length,
    disconnect: () => observador.disconnect(),
  };
}
