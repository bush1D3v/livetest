/**
 * Escolha de idioma do site.
 *
 * O site existe em dois idiomas. O ingles mora na raiz e o portugues sob
 * `/pt/`, de modo que cada pagina tem exatamente uma contraparte, calculada no
 * build e embutida no HTML. Aqui fica so a decisao: qual idioma vale para quem
 * acabou de chegar.
 *
 * A regra tem tres degraus, do mais forte ao mais fraco:
 *
 * 1. uma escolha explicita, guardada no navegador;
 * 2. o idioma configurado no navegador, quando for portugues;
 * 3. ingles.
 *
 * O redirecionamento automatico so acontece na primeira visita. Depois que
 * alguem clica no seletor, a escolha vale mesmo que contrarie o navegador,
 * porque o contrario seria devolver a pessoa ao idioma que ela acabou de
 * recusar.
 *
 * @packageDocumentation
 */

/** Idiomas publicados. */
export type Locale = 'en' | 'pt';

/** Chave usada no `localStorage`. */
export const LOCALE_KEY = 'livetest:locale';

/** Idioma usado quando o navegador nao pede nenhum dos dois. */
export const LOCALE_PADRAO: Locale = 'en';

/** Os dois idiomas, na ordem em que aparecem no menu. */
export const LOCALES: readonly Locale[] = ['en', 'pt'];

/** Prefixo de caminho de cada idioma. O ingles mora na raiz. */
export const PREFIXO: Readonly<Record<Locale, string>> = { en: '', pt: 'pt' };

/** Codigo BCP 47 de cada idioma, para o atributo `lang` e o `hreflang`. */
export const TAG_BCP47: Readonly<Record<Locale, string>> = { en: 'en', pt: 'pt-BR' };

/** Armazenamento minimo que este modulo usa. */
export interface StorageLike {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
}

/** Indica se o valor e um idioma publicado. */
export function isLocale(valor: unknown): valor is Locale {
  return valor === 'en' || valor === 'pt';
}

/**
 * Escolhe o idioma a partir da lista do navegador.
 *
 * Compara so a subtag primaria, porque `pt`, `pt-BR` e `pt-PT` devem cair todos
 * no mesmo lugar. A primeira entrada reconhecida vence; nenhuma reconhecida
 * cai em {@link LOCALE_PADRAO}.
 *
 * @param idiomas - Normalmente `navigator.languages`.
 *
 * @example
 * ```ts
 * detectLocale(['pt-BR', 'en-US']); // 'pt'
 * detectLocale(['fr-FR']);          // 'en'
 * ```
 */
export function detectLocale(idiomas: readonly string[] | undefined | null): Locale {
  for (const bruto of idiomas ?? []) {
    const primaria = bruto.toLowerCase().split('-')[0];
    if (isLocale(primaria)) return primaria;
  }
  return LOCALE_PADRAO;
}

/**
 * Le a escolha guardada.
 *
 * @returns O idioma escolhido, ou `null` quando nunca houve escolha.
 */
export function readStoredLocale(storage: StorageLike | undefined | null): Locale | null {
  try {
    const bruto = storage?.getItem(LOCALE_KEY);
    return isLocale(bruto) ? bruto : null;
  } catch {
    return null;
  }
}

/**
 * Guarda a escolha, ignorando um armazenamento indisponivel.
 *
 * @returns `true` quando a escrita ocorreu.
 */
export function storeLocale(storage: StorageLike | undefined | null, idioma: Locale): boolean {
  try {
    storage?.setItem(LOCALE_KEY, idioma);
    return storage !== undefined && storage !== null;
  } catch {
    return false;
  }
}

/**
 * Decide se a primeira visita deve ser levada para o outro idioma.
 *
 * @param atual - Idioma da pagina que o navegador abriu.
 * @param guardado - Escolha anterior, ou `null` se nao houver.
 * @param detectado - Resultado de {@link detectLocale}.
 *
 * @example
 * ```ts
 * shouldRedirect('en', null, 'pt'); // true  — primeira visita de quem fala portugues
 * shouldRedirect('en', 'en', 'pt'); // false — a pessoa ja escolheu ingles
 * ```
 */
export function shouldRedirect(atual: Locale, guardado: Locale | null, detectado: Locale): boolean {
  if (guardado !== null) return guardado !== atual;
  return detectado !== atual;
}

/**
 * Monta o caminho absoluto de uma rota em um idioma.
 *
 * @param idioma - Idioma de destino.
 * @param rota - Rota sem idioma, com `''` para a home.
 *
 * @example
 * ```ts
 * caminhoDaRota('pt', 'guide/introduction'); // '/pt/guide/introduction'
 * caminhoDaRota('en', '');                   // '/'
 * ```
 */
export function caminhoDaRota(idioma: Locale, rota: string): string {
  const partes = [PREFIXO[idioma], rota].filter((parte) => parte !== '');
  return partes.length === 0 ? '/' : `/${partes.join('/')}`;
}
