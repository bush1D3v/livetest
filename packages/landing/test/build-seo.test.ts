import { describe, expect, it } from 'vitest';

import {
  PAGINAS,
  buildRobots,
  buildSitemap,
  dataDoSitemap,
} from '../src/build/seo-assets.js';
import { SITE_URL_PADRAO, absoluto, resolveSiteUrl } from '../src/build/site-url.js';

describe('resolveSiteUrl', () => {
  it('usa SITE_URL quando ela vem completa', () => {
    expect(resolveSiteUrl({ SITE_URL: 'https://livetest.dev' })).toBe('https://livetest.dev');
  });

  it('aceita http, que e o que se usa em ambiente local', () => {
    expect(resolveSiteUrl({ SITE_URL: 'http://localhost:4173' })).toBe('http://localhost:4173');
  });

  it('completa o protocolo quando so vem o host', () => {
    // E o formato que a Vercel entrega: dominio puro, sem esquema.
    expect(resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'livetest.vercel.app' })).toBe(
      'https://livetest.vercel.app',
    );
  });

  it('remove a barra final para a concatenacao nunca duplicar', () => {
    expect(resolveSiteUrl({ SITE_URL: 'https://livetest.dev///' })).toBe('https://livetest.dev');
  });

  it('ignora espacos em volta', () => {
    expect(resolveSiteUrl({ SITE_URL: '  https://livetest.dev  ' })).toBe('https://livetest.dev');
  });

  it('prefere SITE_URL a variavel da Vercel', () => {
    const url = resolveSiteUrl({
      SITE_URL: 'https://escolhido.dev',
      VERCEL_PROJECT_PRODUCTION_URL: 'ignorado.vercel.app',
    });
    expect(url).toBe('https://escolhido.dev');
  });

  it('pula uma variavel vazia e segue para a proxima', () => {
    const url = resolveSiteUrl({
      SITE_URL: '   ',
      VERCEL_PROJECT_PRODUCTION_URL: 'livetest.vercel.app',
    });
    expect(url).toBe('https://livetest.vercel.app');
  });

  it('cai no padrao quando o ambiente nao diz nada', () => {
    expect(resolveSiteUrl({})).toBe(SITE_URL_PADRAO);
  });
});

describe('absoluto', () => {
  it('junta sem duplicar a barra', () => {
    expect(absoluto('https://livetest.dev', 'og-image.png')).toBe(
      'https://livetest.dev/og-image.png',
    );
    expect(absoluto('https://livetest.dev/', '/og-image.png')).toBe(
      'https://livetest.dev/og-image.png',
    );
  });

  it('mantem a barra sozinha da raiz', () => {
    expect(absoluto('https://livetest.dev', '/')).toBe('https://livetest.dev/');
  });
});

describe('buildRobots', () => {
  it('libera tudo e aponta o sitemap', () => {
    expect(buildRobots('https://livetest.dev')).toBe(
      ['User-agent: *', 'Allow: /', '', 'Sitemap: https://livetest.dev/sitemap.xml', ''].join('\n'),
    );
  });
});

describe('buildSitemap', () => {
  it('lista a home por padrao', () => {
    const xml = buildSitemap('https://livetest.dev', '2026-08-25');

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<loc>https://livetest.dev/</loc>');
    expect(xml).toContain('<lastmod>2026-08-25</lastmod>');
    expect(xml).toContain('<changefreq>weekly</changefreq>');
    expect(xml).toContain('<priority>1.0</priority>');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('emite uma entrada por pagina informada', () => {
    const xml = buildSitemap('https://livetest.dev', '2026-08-25', [
      { caminho: '/', prioridade: 1, frequencia: 'daily' },
      { caminho: '/docs', prioridade: 0.5, frequencia: 'monthly' },
    ]);

    expect(xml.match(/<url>/g)).toHaveLength(2);
    expect(xml).toContain('<loc>https://livetest.dev/docs</loc>');
    expect(xml).toContain('<priority>0.5</priority>');
  });

  it('a lista padrao cobre a landing inteira', () => {
    expect(PAGINAS).toHaveLength(1);
    expect(PAGINAS[0]?.caminho).toBe('/');
  });
});

describe('dataDoSitemap', () => {
  it('devolve so a parte da data', () => {
    expect(dataDoSitemap(new Date('2026-08-25T23:41:02.000Z'))).toBe('2026-08-25');
  });
});
