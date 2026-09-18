/**
 * Arquivos de SEO gerados no build.
 *
 * `robots.txt` e `sitemap.xml` precisam da URL absoluta do site, que so se
 * conhece na hora do deploy — por isso nao ficam parados em `public/`, sao
 * montados aqui a partir do endereco resolvido.
 *
 * @packageDocumentation
 */

import { LOCALES } from '../modules/i18n.js';
import { rotaCompleta } from './layout.js';
import { PAGINAS_DOC } from './routes.js';
import { absoluto } from './site-url.js';

/** Uma pagina no sitemap. */
export interface PaginaDoSitemap {
  /** Caminho relativo a raiz do site. `'/'` para a home. */
  caminho: string;
  /** Importancia relativa, de 0 a 1. */
  prioridade: number;
  /** Frequencia esperada de mudanca. */
  frequencia: 'daily' | 'weekly' | 'monthly' | 'yearly';
}

/**
 * Todas as paginas publicadas, nos dois idiomas.
 *
 * Deriva de `PAGINAS_DOC`, e nao de uma lista propria, para que acrescentar uma
 * pagina de documentacao nao exija lembrar de inscreve-la tambem aqui. Uma
 * pagina que existe mas nao aparece no sitemap demora semanas para ser indexada,
 * e nada no build acusaria a falta.
 */
export const PAGINAS: readonly PaginaDoSitemap[] = LOCALES.flatMap((locale) => [
  { caminho: `/${rotaCompleta(locale, '')}`, prioridade: locale === 'en' ? 1 : 0.9, frequencia: 'weekly' as const },
  ...PAGINAS_DOC.map((pagina) => ({
    caminho: `/${rotaCompleta(locale, pagina.rota)}/`,
    prioridade: locale === 'en' ? pagina.prioridade : Math.round((pagina.prioridade - 0.1) * 10) / 10,
    frequencia: 'monthly' as const,
  })),
]);

/**
 * Monta o `robots.txt`.
 *
 * Libera tudo — nao ha area privada — e aponta o sitemap, que e a unica parte
 * que realmente importa para os buscadores acharem a pagina rapido.
 *
 * @param site - URL absoluta do site, sem barra no fim.
 *
 * @example
 * ```ts
 * buildRobots('https://livetest.dev');
 * // 'User-agent: *\nAllow: /\n\nSitemap: https://livetest.dev/sitemap.xml\n'
 * ```
 */
export function buildRobots(site: string): string {
  return ['User-agent: *', 'Allow: /', '', `Sitemap: ${absoluto(site, 'sitemap.xml')}`, ''].join(
    '\n',
  );
}

/**
 * Monta o `sitemap.xml`.
 *
 * @param site - URL absoluta do site, sem barra no fim.
 * @param data - Data da ultima alteracao, no formato `AAAA-MM-DD`.
 * @param paginas - Paginas a listar. @defaultValue {@link PAGINAS}
 */
export function buildSitemap(
  site: string,
  data: string,
  paginas: readonly PaginaDoSitemap[] = PAGINAS,
): string {
  const entradas = paginas.map((pagina) =>
    [
      '  <url>',
      `    <loc>${absoluto(site, pagina.caminho)}</loc>`,
      `    <lastmod>${data}</lastmod>`,
      `    <changefreq>${pagina.frequencia}</changefreq>`,
      `    <priority>${pagina.prioridade.toFixed(1)}</priority>`,
      '  </url>',
    ].join('\n'),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entradas,
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * Formata uma data no formato que o sitemap exige (`AAAA-MM-DD`).
 *
 * @param quando - Momento a formatar.
 */
export function dataDoSitemap(quando: Date): string {
  return quando.toISOString().slice(0, 10);
}
