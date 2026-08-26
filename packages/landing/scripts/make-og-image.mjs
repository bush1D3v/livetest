/**
 * Gera `public/og-image.png` a partir de `scripts/social-card.html`.
 *
 * E a imagem do cartao que WhatsApp, Slack, LinkedIn, Discord e Twitter montam
 * quando alguem cola o link. Sem ela o link aparece como texto cru — que e a
 * diferenca entre parecer um produto e parecer um rascunho.
 *
 * 1200x630 e a proporcao que todas essas plataformas recortam sem cortar nada.
 *
 * Uso: `node scripts/make-og-image.mjs`
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { capturar, kb } from './browser.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const destino = path.join(AQUI, '..', 'public', 'og-image.png');

capturar({
  html: fs.readFileSync(path.join(AQUI, 'social-card.html'), 'utf8'),
  largura: 1200,
  altura: 630,
  destino,
  // As fontes vem do Google; sem esta folga o PNG sai com a fonte de fallback.
  esperaMs: 6000,
});

console.log(`public/og-image.png  1200x630  ${kb(destino)}`);
