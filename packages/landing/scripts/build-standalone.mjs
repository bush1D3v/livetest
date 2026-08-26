/**
 * Gera uma versao da landing em arquivo unico.
 *
 * O build normal do Vite separa CSS e JS em `dist/assets/`. Para compartilhar a
 * pagina por e-mail, abrir direto do disco ou colar em um host que so aceita um
 * arquivo, tudo precisa caber em um HTML so. Este script pega o `dist/` recem
 * construido e costura as pecas.
 *
 * Uso: `node scripts/build-standalone.mjs` (depois de `npm run build`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(AQUI, '..', 'dist');

/** Le um arquivo do `dist/` a partir do caminho usado no HTML. */
function lerAtivo(href) {
  const relativo = href.replace(/^\.?\//, '');
  return fs.readFileSync(path.join(DIST, relativo), 'utf8');
}

/**
 * Substitui os `<link>` e `<script>` de ativos locais pelo conteudo deles.
 *
 * @param html - HTML gerado pelo Vite.
 * @returns HTML sem nenhuma referencia a arquivo local.
 */
export function inlineAssets(html) {
  let saida = html;

  // Folhas de estilo locais viram <style>.
  saida = saida.replace(
    /<link[^>]*rel="stylesheet"[^>]*href="(\.\/assets\/[^"]+)"[^>]*>/g,
    (_todo, href) => `<style>\n${lerAtivo(href)}\n</style>`,
  );

  // Modulos locais viram <script type="module"> com o codigo dentro.
  saida = saida.replace(
    /<script[^>]*src="(\.\/assets\/[^"]+)"[^>]*><\/script>/g,
    (_todo, src) => `<script type="module">\n${lerAtivo(src)}\n</script>`,
  );

  // O favicon SVG vira data URI para nao sobrar nenhum arquivo solto.
  saida = saida.replace(/<link[^>]*rel="icon"[^>]*href="([^"]+)"[^>]*>/g, (todo, href) => {
    try {
      const svg = lerAtivo(href);
      const base64 = Buffer.from(svg, 'utf8').toString('base64');
      return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${base64}" />`;
    } catch {
      return todo;
    }
  });

  // Os demais ativos de icone e o manifesto sao removidos em vez de embutidos:
  // um `.ico` ou um `.png` viraria um data URI enorme, e nenhum deles faz falta
  // em um arquivo que existe para ser aberto solto.
  saida = saida.replace(
    /\s*<link[^>]*rel="(?:alternate icon|apple-touch-icon|manifest)"[^>]*>/g,
    '',
  );

  return saida;
}

/**
 * Torna absolutas as URLs que so funcionam absolutas.
 *
 * `og:image` e `canonical` ja saem do Vite com a URL completa; nada a fazer.
 * Este passo existe para o dia em que alguem trocar uma delas por relativa —
 * a funcao documenta a exigencia, e o teste a segura.
 *
 * @param html - HTML ja com os ativos embutidos.
 * @returns `true` se todas as URLs sociais estao absolutas.
 */
export function urlsSociaisSaoAbsolutas(html) {
  const encontradas = [...html.matchAll(/(?:property|rel)="(?:og:image|canonical)"[^>]*/g)];
  return encontradas.every((achado) => /(?:href|content)="https?:\/\//.test(achado[0]));
}

const entrada = path.join(DIST, 'index.html');
if (!fs.existsSync(entrada)) {
  console.error('dist/index.html nao encontrado — rode `npm run build` antes.');
  process.exit(1);
}

const resultado = inlineAssets(fs.readFileSync(entrada, 'utf8'));

if (!urlsSociaisSaoAbsolutas(resultado)) {
  console.error('og:image ou canonical ficaram relativos — as redes sociais os ignorariam.');
  process.exit(1);
}

const destino = path.join(DIST, 'standalone.html');
fs.writeFileSync(destino, resultado, 'utf8');

const kb = (Buffer.byteLength(resultado) / 1024).toFixed(1);
console.log(`dist/standalone.html  ${kb} kB  (arquivo unico, sem ativos externos)`);
