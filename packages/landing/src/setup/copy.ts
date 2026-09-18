/**
 * Botoes de copiar.
 *
 * Dois formatos convivem: a caixa de instalacao da home, onde o texto esta em um
 * `[data-copy-source]` ao lado do botao, e os blocos de codigo da documentacao,
 * onde o proprio botao carrega o texto em `data-copy-text`. O segundo existe
 * porque o bloco ja passou pelo realce de sintaxe, e ler o `textContent` dele
 * traria o codigo certo mas dependeria de o realce nunca inserir um caractere.
 *
 * O retorno visual e obrigatorio: uma copia silenciosa deixa a pessoa sem saber
 * se funcionou.
 *
 * @packageDocumentation
 */

import { copyText, type CopyOptions } from '../modules/clipboard.js';

/** O que o botao diz depois de tentar copiar. */
interface Retorno {
  /** Rotulo quando a copia funcionou. */
  ok: string;
  /** Rotulo quando nao funcionou. */
  erro: string;
}

/** Textos do retorno visual, por idioma. */
const RETORNO: Readonly<Record<string, Retorno>> = {
  en: { ok: 'Copied', erro: 'Copy manually' },
  pt: { ok: 'Copiado', erro: 'Copie manualmente' },
};

/** Opcoes de {@link setupCopyButtons}. */
export interface CopySetupOptions {
  root?: ParentNode;
  /** Quanto tempo o retorno visual fica na tela, em ms. @defaultValue 1800 */
  feedbackMs?: number;
  /** Repassado a {@link copyText}; util em teste. */
  copy?: CopyOptions;
  /** Agendador do retorno ao estado normal. @defaultValue `setTimeout` */
  schedule?: (callback: () => void, ms: number) => void;
  /** Idioma do retorno visual. @defaultValue `'en'` */
  locale?: string;
}

/** Botoes montados. */
export interface CopyButtons {
  /** Quantos botoes foram ligados. */
  readonly count: number;
}

/**
 * Liga os botoes de copiar.
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

  // O idioma chega de quem monta a pagina, e nao e lido do DOM aqui: quem monta
  // ja o tem, e um segundo lugar consultando o `<body>` seria um segundo lugar
  // para errar.
  const textos = RETORNO[options.locale ?? 'en'] ?? (RETORNO['en'] as Retorno);

  const botoes = [...root.querySelectorAll<HTMLButtonElement>('[data-copy-button]')];
  let ligados = 0;

  for (const botao of botoes) {
    const direto = botao.dataset['copyText'];
    const fonte = botao
      .closest<HTMLElement>('[data-copy-root]')
      ?.querySelector<HTMLElement>('[data-copy-source]');

    if (direto === undefined && !fonte) continue;

    const rotulo = botao.querySelector<HTMLElement>('[data-copy-label]') ?? botao;
    // `textContent` de um elemento nunca e nulo, so de um no de documento.
    const textoOriginal = rotulo.textContent as string;
    ligados++;

    botao.addEventListener('click', () => {
      void (async () => {
        // Sem `data-copy-text` a fonte existe: o botao sem nenhum dos dois foi
        // descartado antes de chegar aqui.
        const conteudo = direto ?? ((fonte as HTMLElement).textContent as string);
        const copiou = await copyText(conteudo, options.copy ?? {});

        botao.classList.toggle('is-done', copiou);
        botao.classList.toggle('is-error', !copiou);
        rotulo.textContent = copiou ? textos.ok : textos.erro;

        schedule(() => {
          botao.classList.remove('is-done', 'is-error');
          rotulo.textContent = textoOriginal;
        }, feedbackMs);
      })();
    });
  }

  return { count: ligados };
}
