/**
 * Botoes de copiar o comando de instalacao.
 * @packageDocumentation
 */

import { copyText, type CopyOptions } from '../modules/clipboard.js';

/** Opcoes de {@link setupCopyButtons}. */
export interface CopySetupOptions {
  root?: ParentNode;
  /** Quanto tempo o retorno visual fica na tela, em ms. @defaultValue 1800 */
  feedbackMs?: number;
  /** Repassado a {@link copyText}; util em teste. */
  copy?: CopyOptions;
  /** Agendador do retorno ao estado normal. @defaultValue `setTimeout` */
  schedule?: (callback: () => void, ms: number) => void;
}

/** Botoes montados. */
export interface CopyButtons {
  /** Quantos botoes foram ligados. */
  readonly count: number;
}

/**
 * Liga os botoes de copiar.
 *
 * Cada botao vive dentro de um `[data-copy-root]` que contem o texto em
 * `[data-copy-source]`. O retorno visual e obrigatorio: uma copia silenciosa
 * deixa o visitante sem saber se funcionou.
 *
 * @example
 * ```ts
 * setupCopyButtons().count; // 2
 * ```
 */
export function setupCopyButtons(options: CopySetupOptions = {}): CopyButtons {
  const root = options.root ?? document;
  const feedbackMs = options.feedbackMs ?? 1800;
  const schedule = options.schedule ?? ((callback, ms) => void setTimeout(callback, ms));

  const grupos = [...root.querySelectorAll<HTMLElement>('[data-copy-root]')];
  let ligados = 0;

  for (const grupo of grupos) {
    const botao = grupo.querySelector<HTMLButtonElement>('[data-copy-button]');
    const fonte = grupo.querySelector<HTMLElement>('[data-copy-source]');
    if (!botao || !fonte) continue;

    const rotulo = botao.querySelector<HTMLElement>('[data-copy-label]') ?? botao;
    // `textContent` de um elemento nunca e nulo — so de um no de documento.
    const textoOriginal = rotulo.textContent as string;
    ligados++;

    botao.addEventListener('click', () => {
      void (async () => {
        const copiou = await copyText(fonte.textContent as string, options.copy ?? {});

        botao.classList.toggle('is-done', copiou);
        botao.classList.toggle('is-error', !copiou);
        rotulo.textContent = copiou ? 'Copiado' : 'Copie manualmente';

        schedule(() => {
          botao.classList.remove('is-done', 'is-error');
          rotulo.textContent = textoOriginal;
        }, feedbackMs);
      })();
    });
  }

  return { count: ligados };
}
