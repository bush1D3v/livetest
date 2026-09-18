/**
 * O indice de busca, montado no build.
 *
 * Uma pagina nao e uma unidade util de resultado: quem procura "profundidade
 * transitive" quer cair no paragrafo que fala disso, nao no topo de um
 * documento de duzentas linhas. Por isso a unidade indexada e a **secao**, e
 * cada resultado ja leva a ancora.
 *
 * O arquivo gerado e um JSON por idioma, servido estaticamente e baixado uma vez
 * so, na primeira vez que alguem abre a busca. A partir dai nao ha ida ao
 * servidor, o que mantem a promessa do resto do pacote: o site inteiro e
 * arquivo estatico.
 *
 * @packageDocumentation
 */

import type { SearchDoc } from '../modules/search.js';
import type { Secao } from './markdown.js';

/** Uma pagina pronta para entrar no indice. */
export interface PaginaIndexada {
  /** Rota completa, com idioma. `''` e a home. */
  rota: string;
  /** Titulo da pagina. */
  titulo: string;
  /** Secoes em texto puro, como o conversor de Markdown as devolve. */
  secoes: readonly Secao[];
}

/** Corta um texto sem quebrar palavra no meio. */
function encurtar(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto;
  const corte = texto.lastIndexOf(' ', maximo);
  return texto.slice(0, corte === -1 ? maximo : corte);
}

/**
 * Maior trecho guardado por secao.
 *
 * O indice inteiro viaja pela rede antes da primeira busca. Secoes muito longas
 * sao cortadas porque o que passa desse tamanho quase nunca e o que decide o
 * resultado, e um indice leve abre mais rapido.
 */
export const LIMITE_POR_SECAO = 1200;

/**
 * Monta a lista de documentos de um idioma.
 *
 * @param paginas - Paginas ja convertidas.
 *
 * @example
 * ```ts
 * montarIndice([{ rota: 'guide/depth', titulo: 'Depth', secoes: [...] }])[0]?.u;
 * // 'guide/depth/'
 * ```
 */
export function montarIndice(paginas: readonly PaginaIndexada[]): SearchDoc[] {
  const docs: SearchDoc[] = [];

  for (const pagina of paginas) {
    const base = pagina.rota === '' ? '' : `${pagina.rota}/`;

    for (const secao of pagina.secoes) {
      const texto = encurtar(secao.texto, LIMITE_POR_SECAO);
      // Uma secao so com titulo nao ajuda ninguem a decidir se e o resultado
      // certo; a abertura da pagina fica mesmo assim, porque e o alvo natural
      // de quem busca pelo nome da pagina.
      if (texto === '' && secao.slug !== '') continue;

      docs.push({
        u: secao.slug === '' ? base : `${base}#${secao.slug}`,
        p: pagina.titulo,
        s: secao.titulo,
        t: texto,
      });
    }
  }

  return docs;
}

/**
 * Serializa o indice para o arquivo que o navegador baixa.
 *
 * @param docs - Devolvido por {@link montarIndice}.
 */
export function serializarIndice(docs: readonly SearchDoc[]): string {
  return JSON.stringify(docs);
}
