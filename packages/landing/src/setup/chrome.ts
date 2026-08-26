/**
 * Cromo da pagina: header fixo, barra de progresso, brilho do cursor e
 * destaque da secao atual na navegacao.
 *
 * Todos os efeitos escrevem apenas em variaveis CSS e classes — nenhum deles
 * mede layout durante a rolagem.
 *
 * @packageDocumentation
 */

/** Opcoes de {@link setupChrome}. */
export interface ChromeOptions {
  /** Documento usado. @defaultValue `document` */
  doc?: Document;
  /** Janela usada. @defaultValue `window` */
  win?: Window;
  /** Desliga o brilho que segue o cursor. */
  disableCursorGlow?: boolean;
}

/** Cromo montado. */
export interface Chrome {
  /** Recalcula header, progresso e secao atual. */
  update(): void;
  /** Remove os ouvintes registrados. */
  destroy(): void;
}

/**
 * Calcula o progresso de leitura no intervalo `[0, 1]`.
 *
 * @param scrollTop - Deslocamento vertical atual.
 * @param scrollHeight - Altura total do documento.
 * @param viewportHeight - Altura visivel.
 *
 * @example
 * ```ts
 * scrollProgress(0, 2000, 1000);    // 0
 * scrollProgress(500, 2000, 1000);  // 0.5
 * scrollProgress(1000, 2000, 1000); // 1
 * ```
 */
export function scrollProgress(
  scrollTop: number,
  scrollHeight: number,
  viewportHeight: number,
): number {
  const rolavel = scrollHeight - viewportHeight;
  if (rolavel <= 0) return 0;
  return Math.min(1, Math.max(0, scrollTop / rolavel));
}

/**
 * Escolhe qual link da navegacao deve aparecer como atual.
 *
 * @param secoes - Secoes com o topo relativo ao documento.
 * @param scrollTop - Deslocamento atual, ja somado a margem do header.
 * @returns Id da secao ativa, ou `null` antes da primeira.
 */
export function currentSection(
  secoes: ReadonlyArray<{ id: string; top: number }>,
  scrollTop: number,
): string | null {
  let atual: string | null = null;
  for (const secao of secoes) {
    if (secao.top <= scrollTop) atual = secao.id;
  }
  return atual;
}

/**
 * Liga o cromo da pagina.
 *
 * @example
 * ```ts
 * const chrome = setupChrome({ disableCursorGlow: prefersReducedMotion() });
 * ```
 */
export function setupChrome(options: ChromeOptions = {}): Chrome {
  const doc = options.doc ?? document;
  const win = options.win ?? window;

  const header = doc.querySelector<HTMLElement>('[data-header]');
  const barra = doc.querySelector<HTMLElement>('[data-scroll-progress]');
  const brilho = doc.querySelector<HTMLElement>('[data-cursor-glow]');
  const links = [...doc.querySelectorAll<HTMLAnchorElement>('.site-nav a')];

  const secoes = links
    .map((link) => {
      const id = link.getAttribute('href')?.replace('#', '') ?? '';
      const alvo = id ? doc.getElementById(id) : null;
      return alvo ? { id, elemento: alvo } : null;
    })
    .filter((item): item is { id: string; elemento: HTMLElement } => item !== null);

  function atualizar(): void {
    const scrollTop = win.scrollY;

    header?.classList.toggle('is-stuck', scrollTop > 8);

    if (barra) {
      const progresso = scrollProgress(
        scrollTop,
        doc.documentElement.scrollHeight,
        win.innerHeight,
      );
      barra.style.setProperty('--progress', progresso.toFixed(4));
    }

    if (links.length > 0) {
      const posicoes = secoes.map((secao) => ({
        id: secao.id,
        top: secao.elemento.offsetTop,
      }));
      const ativa = currentSection(posicoes, scrollTop + win.innerHeight * 0.32);
      for (const link of links) {
        const id = link.getAttribute('href')?.replace('#', '') ?? '';
        link.classList.toggle('is-current', id === ativa && ativa !== null);
      }
    }
  }

  function aoMoverCursor(evento: MouseEvent): void {
    if (!brilho) return;
    brilho.style.setProperty('--cursor-x', `${evento.clientX}px`);
    brilho.style.setProperty('--cursor-y', `${evento.clientY}px`);
    brilho.style.setProperty('--cursor-on', '1');
  }

  const aoRolar = (): void => atualizar();

  win.addEventListener('scroll', aoRolar, { passive: true });
  win.addEventListener('resize', aoRolar, { passive: true });
  if (!options.disableCursorGlow) {
    win.addEventListener('mousemove', aoMoverCursor, { passive: true });
  }

  // Halo que acompanha o cursor dentro de cada cartao de recurso.
  const cartoes = [...doc.querySelectorAll<HTMLElement>('.feature')];
  const aoMoverNoCartao = (evento: MouseEvent): void => {
    const cartao = evento.currentTarget as HTMLElement;
    const caixa = cartao.getBoundingClientRect();
    cartao.style.setProperty('--mx', `${evento.clientX - caixa.left}px`);
    cartao.style.setProperty('--my', `${evento.clientY - caixa.top}px`);
  };
  for (const cartao of cartoes) {
    cartao.addEventListener('mousemove', aoMoverNoCartao);
  }

  atualizar();

  return {
    update: atualizar,
    destroy(): void {
      win.removeEventListener('scroll', aoRolar);
      win.removeEventListener('resize', aoRolar);
      win.removeEventListener('mousemove', aoMoverCursor);
      for (const cartao of cartoes) {
        cartao.removeEventListener('mousemove', aoMoverNoCartao);
      }
    },
  };
}
