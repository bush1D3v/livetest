/**
 * Cores ANSI minimas, sem dependencia externa.
 * @packageDocumentation
 */

/** Paleta usada pelo relatorio de terminal. */
export interface Palette {
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
  gray(text: string): string;
}

const identity = (text: string): string => text;

/** Paleta sem cor, usada quando a saida nao e um terminal. */
export const plainPalette: Palette = {
  bold: identity,
  dim: identity,
  red: identity,
  green: identity,
  yellow: identity,
  cyan: identity,
  gray: identity,
};

const wrap =
  (open: number, close: number) =>
  (text: string): string =>
    `\u001B[${open}m${text}\u001B[${close}m`;

/** Paleta com cores ANSI. */
export const ansiPalette: Palette = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

/**
 * Escolhe a paleta conforme a configuracao.
 *
 * @param color - `true`/`false` forcam; `'auto'` detecta TTY e respeita
 * as convencoes `NO_COLOR` e `FORCE_COLOR`.
 */
export function selectPalette(
  color: boolean | 'auto',
  env: NodeJS.ProcessEnv = process.env,
  isTty: boolean = Boolean(process.stdout.isTTY),
): Palette {
  if (color === true) return ansiPalette;
  if (color === false) return plainPalette;
  if (env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '') return plainPalette;
  if (env['FORCE_COLOR'] !== undefined && env['FORCE_COLOR'] !== '0') return ansiPalette;
  return isTty ? ansiPalette : plainPalette;
}
