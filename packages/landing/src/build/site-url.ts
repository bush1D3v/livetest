/**
 * Descoberta da URL publica do site, em tempo de build.
 *
 * Quase tudo na pagina usa caminho relativo, de proposito: assim ela funciona
 * aberta do disco, em subdiretorio ou em qualquer host estatico. Tres coisas,
 * porem, exigem URL absoluta e nao aceitam relativa:
 *
 * - `og:image` — Facebook, WhatsApp, Slack e LinkedIn ignoram caminho relativo
 * - `<link rel="canonical">` — precisa apontar para o endereco final
 * - `sitemap.xml` — o protocolo exige URLs completas
 *
 * Como o endereco so existe depois do deploy, ele entra por variavel de
 * ambiente. Na Vercel, `VERCEL_PROJECT_PRODUCTION_URL` ja vem preenchida com o
 * dominio de producao (inclusive um dominio proprio, se houver).
 *
 * @packageDocumentation
 */

/** Usada quando nada no ambiente diz qual e o endereco. */
export const SITE_URL_PADRAO = 'https://livetest.vercel.app';

/** Variaveis lidas, em ordem de precedencia. */
export const VARIAVEIS_DE_URL = ['SITE_URL', 'VERCEL_PROJECT_PRODUCTION_URL'] as const;

/**
 * Resolve a URL publica a partir do ambiente.
 *
 * Aceita as duas formas que aparecem na pratica: com protocolo (`SITE_URL`
 * costuma ser escrita a mao, completa) e sem (a Vercel entrega so o host).
 * A barra final e removida para que a concatenacao com `/algo` nunca duplique.
 *
 * @param env - Ambiente, normalmente `process.env`.
 * @returns URL absoluta, sem barra no fim.
 *
 * @example
 * ```ts
 * resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'livetest.dev' });
 * // 'https://livetest.dev'
 * ```
 */
export function resolveSiteUrl(env: Record<string, string | undefined>): string {
  for (const nome of VARIAVEIS_DE_URL) {
    const bruto = env[nome]?.trim();
    if (bruto === undefined || bruto === '') continue;

    const comProtocolo = /^https?:\/\//.test(bruto) ? bruto : `https://${bruto}`;
    return comProtocolo.replace(/\/+$/, '');
  }

  return SITE_URL_PADRAO;
}

/**
 * Junta a URL do site com um caminho.
 *
 * @param site - URL absoluta, como devolvida por {@link resolveSiteUrl}.
 * @param caminho - Caminho relativo, com ou sem barra inicial.
 *
 * @example
 * ```ts
 * absoluto('https://livetest.dev', 'og-image.png');
 * // 'https://livetest.dev/og-image.png'
 * ```
 */
export function absoluto(site: string, caminho: string): string {
  return `${site.replace(/\/+$/, '')}/${caminho.replace(/^\/+/, '')}`;
}
