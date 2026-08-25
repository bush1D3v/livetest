/**
 * Normalizacao de caminhos.
 *
 * Regra do projeto: **todo caminho que circula pelo core e absoluto e usa `/`
 * como separador**, inclusive no Windows. A conversao para o formato nativo
 * acontece apenas na fronteira com o sistema operacional (spawn, fs).
 *
 * @packageDocumentation
 */

import path from 'node:path';

/** Converte separadores do Windows para POSIX. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Torna um caminho absoluto e normalizado no formato interno (POSIX).
 *
 * @param p - Caminho absoluto ou relativo.
 * @param base - Base usada quando `p` e relativo.
 *
 * @example
 * ```ts
 * normalizePath('src/a.ts', '/proj'); // '/proj/src/a.ts'
 * ```
 */
export function normalizePath(p: string, base?: string): string {
  // Sempre `resolve`, nunca `normalize`: no Windows um caminho "absoluto" sem
  // letra de drive (`/proj/a.ts`) so ganha o drive via `resolve`, e misturar as
  // duas funcoes produziria chaves diferentes para o mesmo arquivo no grafo.
  return toPosix(path.resolve(base ?? process.cwd(), p));
}

/**
 * Caminho relativo a raiz, no formato POSIX, sem `./` inicial.
 * Caminhos fora da raiz sao retornados como estao (absolutos).
 */
export function relativeToRoot(root: string, file: string): string {
  const rel = toPosix(path.relative(toNative(root), toNative(file)));
  if (rel === '' ) return '.';
  if (rel.startsWith('..')) return toPosix(file);
  return rel;
}

/**
 * Converte um caminho interno (POSIX) para o formato nativo do SO.
 *
 * @param p - Caminho no formato interno.
 * @param separator - Separador de destino. O padrao e o da plataforma atual;
 * informe explicitamente para exercitar o outro caminho em teste.
 */
export function toNative(p: string, separator: string = path.sep): string {
  return separator === '\\' ? p.replace(/\//g, '\\') : p;
}

/** Extensao do arquivo em minusculas, com ponto. Vazio quando nao ha extensao. */
export function extname(file: string): string {
  return path.posix.extname(toPosix(file)).toLowerCase();
}

/** Nome do arquivo sem diretorio nem extensao. */
export function basenameWithoutExt(file: string): string {
  const posix = toPosix(file);
  return path.posix.basename(posix, path.posix.extname(posix));
}

/** Diretorio do arquivo, no formato interno. */
export function dirname(file: string): string {
  return path.posix.dirname(toPosix(file));
}

/** Junta segmentos no formato interno. */
export function joinPosix(...segments: string[]): string {
  return path.posix.join(...segments.map(toPosix));
}

/** Indica se `file` esta dentro de `dir` (ou e o proprio `dir`). */
export function isInside(dir: string, file: string): boolean {
  const rel = path.relative(toNative(dir), toNative(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
