/**
 * Preferencia de tema: clara, escura ou a do sistema.
 *
 * A pagina nasce escura porque e a superficie que a ferramenta habita, terminal
 * e editor. Quem quiser claro escolhe, e a escolha sobrevive a navegacao entre
 * paginas; quem quiser acompanhar o sistema escolhe `system`.
 *
 * Nada aqui toca no DOM. O modulo so decide *qual* tema vale, a partir do que
 * foi guardado e do que o sistema operacional informa, para que a decisao possa
 * ser testada sem navegador e repetida no script inline do `<head>`.
 *
 * @packageDocumentation
 */

/** O que a pessoa escolheu. */
export type ThemeChoice = 'light' | 'dark' | 'system';

/** O tema que a pagina de fato aplica. */
export type ResolvedTheme = 'light' | 'dark';

/** Chave usada no `localStorage`. */
export const THEME_KEY = 'livetest:theme';

/** Escolha usada quando nunca houve escolha. */
export const THEME_PADRAO: ThemeChoice = 'dark';

/** As tres opcoes, na ordem em que aparecem no menu. */
export const THEME_CHOICES: readonly ThemeChoice[] = ['light', 'dark', 'system'];

/** Armazenamento minimo que este modulo usa. */
export interface StorageLike {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
}

/** Indica se o valor e uma escolha valida. */
export function isThemeChoice(valor: unknown): valor is ThemeChoice {
  return valor === 'light' || valor === 'dark' || valor === 'system';
}

/**
 * Traduz a escolha no tema aplicado.
 *
 * @param escolha - O que a pessoa pediu.
 * @param sistemaEscuro - `true` quando o sistema operacional prefere escuro.
 *
 * @example
 * ```ts
 * resolveTheme('system', true); // 'dark'
 * resolveTheme('light', true);  // 'light'
 * ```
 */
export function resolveTheme(escolha: ThemeChoice, sistemaEscuro: boolean): ResolvedTheme {
  if (escolha === 'system') return sistemaEscuro ? 'dark' : 'light';
  return escolha;
}

/**
 * Le a escolha guardada, caindo no padrao quando nao ha nada utilizavel.
 *
 * O `localStorage` lanca em navegacao privada de alguns navegadores, entao a
 * leitura e protegida: sem preferencia recuperavel, a pagina abre escura.
 *
 * @param storage - Normalmente `window.localStorage`.
 */
export function readStoredTheme(storage: StorageLike | undefined | null): ThemeChoice {
  try {
    const bruto = storage?.getItem(THEME_KEY);
    return isThemeChoice(bruto) ? bruto : THEME_PADRAO;
  } catch {
    return THEME_PADRAO;
  }
}

/**
 * Guarda a escolha, ignorando um armazenamento indisponivel.
 *
 * @returns `true` quando a escrita ocorreu.
 */
export function storeTheme(storage: StorageLike | undefined | null, escolha: ThemeChoice): boolean {
  try {
    storage?.setItem(THEME_KEY, escolha);
    return storage !== undefined && storage !== null;
  } catch {
    return false;
  }
}
