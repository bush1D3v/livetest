/**
 * Os icones da interface, em SVG embutido.
 *
 * Sao poucos e pequenos. Embutidos, herdam a cor do texto, respondem ao tema
 * sem uma segunda copia e nao custam nem uma requisicao nem uma fonte de
 * icones inteira baixada para desenhar sete simbolos.
 *
 * @packageDocumentation
 */

/**
 * Abre um SVG com os atributos que todos compartilham.
 *
 * O `width` e o `height` nao sao redundantes com o CSS: um SVG que declara so o
 * `viewBox` nao tem tamanho proprio, e no instante em que a folha de estilo
 * ainda nao chegou o navegador o estica ate a largura disponivel. Com um
 * cabecalho inteiro de icones, isso vira uma tela de simbolos gigantes antes de
 * a pagina se compor. O CSS continua mandando; isto e so o tamanho de partida.
 */
function svg(corpo: string, extras = ''): string {
  return `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" ${extras}>${corpo}</svg>`;
}

/** Traco padrao dos icones desenhados a linha. */
const TRACO =
  'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

/** A marca do projeto: um cursor de terminal ligado a um no de grafo. */
export const MARCA = svg(
  '<path d="M4 6h6M7 6v12" /><circle cx="17" cy="8" r="3" /><path d="M17 11v4M13 18h8" />',
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"',
);

/**
 * Octocat, no traco oficial de 16 por 16.
 *
 * O caminho fica em uma linha so, por mais longa que seja: quebrado em varias e
 * concatenado, os numeros de uma ponta colam nos da outra e o desenho sai
 * deformado, sem que nada acuse o erro.
 */
export const GITHUB =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">' +
  '<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></svg>';

/** Lupa da busca. */
export const BUSCA = svg('<circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />', TRACO);

/** Sol, para o tema claro. */
export const SOL = svg(
  '<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />',
  TRACO,
);

/** Lua, para o tema escuro. */
export const LUA = svg('<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />', TRACO);

/** Monitor, para acompanhar o sistema. */
export const SISTEMA = svg(
  '<rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" />',
  TRACO,
);

/** Globo do seletor de idioma. */
export const IDIOMA = svg(
  '<circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3Z" />',
  TRACO,
);

/** Seta para a direita, usada nos links de navegacao. */
export const SETA = svg('<path d="M5 12h13M13 6l6 6-6 6" />', TRACO);

/** Tres tracos do menu no celular. */
export const MENU = svg('<path d="M4 7h16M4 12h16M4 17h16" />', TRACO);

/** Xis de fechar. */
export const FECHAR = svg('<path d="M6 6l12 12M18 6 6 18" />', TRACO);

/** Setinha que gira quando um grupo do menu abre ou fecha. */
export const CHEVRON = svg('<path d="m9 6 6 6-6 6" />', TRACO);

/** Pagina, mostrada ao lado de cada resultado de busca. */
export const DOCUMENTO = svg(
  '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" />',
  TRACO,
);

/** Cerquilha, mostrada ao lado de um resultado que aponta para uma secao. */
export const SECAO = svg('<path d="M10 3 8 21M16 3l-2 18M4 8h16M3 16h16" />', TRACO);
