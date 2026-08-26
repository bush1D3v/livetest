import { defineConfig, type Plugin } from 'vite';

import { buildRobots, buildSitemap, dataDoSitemap } from './src/build/seo-assets.js';
import { resolveSiteUrl } from './src/build/site-url.js';

/**
 * Injeta a URL publica onde caminho relativo nao serve.
 *
 * O `index.html` marca esses pontos com `__SITE_URL__`; aqui o marcador vira o
 * endereco real. O mesmo endereco gera `robots.txt` e `sitemap.xml`, que sao
 * emitidos como ativos do build em vez de ficarem parados em `public/`.
 */
function seo(): Plugin {
  const site = resolveSiteUrl(process.env);

  return {
    name: 'livetest-seo',

    transformIndexHtml(html) {
      return html.replaceAll('__SITE_URL__', site);
    },

    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: buildRobots(site) });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: buildSitemap(site, dataDoSitemap(new Date())),
      });
    },
  };
}

export default defineConfig({
  // Caminhos relativos: a pagina funciona aberta direto do disco ou em
  // qualquer subdiretorio de um servidor estatico, sem reconfiguracao.
  base: './',
  plugins: [seo()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    cssMinify: true,
    reportCompressedSize: true,
  },
});
