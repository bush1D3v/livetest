/**
 * A gaveta do menu lateral no celular.
 *
 * Em telas largas o menu e uma coluna fixa e nada disto roda. Abaixo de 900px a
 * mesma marcacao vira gaveta, e o que muda e so uma classe: nao ha uma segunda
 * copia do menu no HTML, nem um menu montado por JavaScript que sumiria se o
 * script falhasse.
 *
 * @packageDocumentation
 */

/** Opcoes de {@link setupNav}. */
export interface NavOptions {
  /** Documento usado. @defaultValue `document` */
  doc?: Document;
}

/** Gaveta montada. */
export interface Nav {
  /** Abre ou fecha a gaveta. */
  toggle(): void;
  /** Fecha a gaveta. */
  close(): void;
  /** `true` enquanto a gaveta esta aberta. */
  isOpen(): boolean;
  /** `true` quando ha um menu lateral nesta pagina. */
  readonly mounted: boolean;
  /** Remove os ouvintes registrados. */
  destroy(): void;
}

/**
 * Liga a gaveta.
 *
 * @example
 * ```ts
 * const nav = setupNav();
 * nav.toggle();
 * nav.isOpen(); // true
 * ```
 */
export function setupNav(options: NavOptions = {}): Nav {
  const doc = options.doc ?? document;

  const botao = doc.querySelector<HTMLElement>('[data-menu-lateral]');
  const lateral = doc.querySelector<HTMLElement>('.lateral');
  const cortina = doc.querySelector<HTMLElement>('[data-cortina]');

  if (!botao || !lateral) {
    return {
      toggle: () => {},
      close: () => {},
      isOpen: () => false,
      mounted: false,
      destroy: () => {},
    };
  }

  const alvoLateral = lateral;
  let aberta = false;

  function pintar(): void {
    alvoLateral.classList.toggle('is-open', aberta);
    botao?.setAttribute('aria-expanded', String(aberta));
    if (cortina) {
      cortina.hidden = !aberta;
      cortina.classList.toggle('is-open', aberta);
    }
    doc.documentElement.style.overflow = aberta ? 'hidden' : '';
  }

  function alternar(): void {
    aberta = !aberta;
    pintar();
  }

  function fechar(): void {
    if (!aberta) return;
    aberta = false;
    pintar();
  }

  const aoClicar = (evento: Event): void => {
    const alvo = evento.target as HTMLElement | null;
    if (alvo?.closest('[data-menu-lateral]')) {
      evento.preventDefault();
      alternar();
      return;
    }
    // Um link do menu leva para outra pagina; deixar a gaveta aberta faria a
    // pagina seguinte comecar coberta.
    if (alvo?.closest('[data-cortina]') || alvo?.closest('.lateral a')) fechar();
  };

  const aoTeclar = (evento: KeyboardEvent): void => {
    if (evento.key === 'Escape') fechar();
  };

  doc.addEventListener('click', aoClicar);
  doc.addEventListener('keydown', aoTeclar);

  return {
    toggle: alternar,
    close: fechar,
    isOpen: () => aberta,
    mounted: true,
    destroy(): void {
      doc.removeEventListener('click', aoClicar);
      doc.removeEventListener('keydown', aoTeclar);
    },
  };
}
