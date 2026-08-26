/**
 * Gera os icones PNG e o `favicon.ico` a partir do `favicon.svg`.
 *
 * Um SVG resolve a aba do navegador, mas nao resolve o resto: o manifesto do
 * PWA exige PNG em tamanhos declarados, o iOS ignora SVG no atalho da tela de
 * inicio, e navegadores antigos ainda pedem `/favicon.ico` na raiz.
 *
 * Uso: `node scripts/make-icons.mjs`
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { capturar, kb } from './browser.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(AQUI, '..', 'public');

/**
 * As variantes geradas.
 *
 * `cheio` desliga os cantos arredondados e faz o fundo ocupar o quadrado
 * inteiro: e o que o iOS e o icone "maskable" do Android esperam, porque os
 * dois recortam a forma por conta propria. Um SVG ja arredondado recortado de
 * novo perde canto.
 */
const VARIANTES = [
  { arquivo: 'favicon-32.png', tamanho: 32, cheio: false, marca: 1 },
  { arquivo: 'icon-192.png', tamanho: 192, cheio: false, marca: 1 },
  { arquivo: 'icon-512.png', tamanho: 512, cheio: false, marca: 1 },
  { arquivo: 'icon-maskable-512.png', tamanho: 512, cheio: true, marca: 0.6 },
  { arquivo: 'apple-touch-icon.png', tamanho: 180, cheio: true, marca: 0.72 },
];

/**
 * Enquadramento justo do traco dentro do `viewBox` de 32x32.
 *
 * O desenho nao ocupa o quadrado inteiro: ele vai de x 5.9 a 27.6 e de y 7.9 a
 * 24.1, contando a espessura do traco. Na variante arredondada isso nao
 * importa, porque o fundo e a moldura. Sem o fundo, escalar o `viewBox` cheio
 * deixaria a marca visivelmente fora de centro — dai este recorte quadrado
 * centrado no traco.
 */
const RECORTE = { x: 5.9, y: 5.15, lado: 21.7 };

const svg = fs.readFileSync(path.join(PUBLIC, 'favicon.svg'), 'utf8');

/** Monta a pagina que o navegador vai fotografar. */
function paginaPara({ tamanho, cheio, marca }) {
  const desenho = cheio
    ? svg
        .replace(/<rect[^>]*\/>/, '')
        .replace(
          'viewBox="0 0 32 32"',
          `viewBox="${RECORTE.x} ${RECORTE.y} ${RECORTE.lado} ${RECORTE.lado}"`,
        )
    : svg;

  const lado = Math.round(tamanho * marca);
  const margem = Math.round((tamanho - lado) / 2);

  return [
    '<!doctype html><meta charset="utf-8">',
    '<style>',
    '  html,body{margin:0;padding:0}',
    `  body{width:${tamanho}px;height:${tamanho}px;background:${cheio ? '#0a0d16' : 'transparent'}}`,
    `  svg{position:absolute;left:${margem}px;top:${margem}px;width:${lado}px;height:${lado}px}`,
    '</style>',
    desenho,
  ].join('\n');
}

for (const variante of VARIANTES) {
  const destino = path.join(PUBLIC, variante.arquivo);
  capturar({
    html: paginaPara(variante),
    largura: variante.tamanho,
    altura: variante.tamanho,
    destino,
    transparente: !variante.cheio,
  });
  console.log(
    `public/${variante.arquivo.padEnd(24)} ${variante.tamanho}x${variante.tamanho}  ${kb(destino)}`,
  );
}

/**
 * Empacota um PNG dentro de um `.ico`.
 *
 * O formato ICO aceita PNG cru desde o Vista: basta o cabecalho de diretorio
 * apontando para os bytes. E por isso que nao ha nenhuma conversao aqui.
 */
function empacotarIco(png, tamanho) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0); // reservado
  cabecalho.writeUInt16LE(1, 2); // tipo 1 = icone
  cabecalho.writeUInt16LE(1, 4); // uma imagem

  const entrada = Buffer.alloc(16);
  entrada[0] = tamanho >= 256 ? 0 : tamanho; // largura (0 significa 256)
  entrada[1] = tamanho >= 256 ? 0 : tamanho; // altura
  entrada[2] = 0; // cores da paleta
  entrada[3] = 0; // reservado
  entrada.writeUInt16LE(1, 4); // planos
  entrada.writeUInt16LE(32, 6); // bits por pixel
  entrada.writeUInt32LE(png.length, 8);
  entrada.writeUInt32LE(cabecalho.length + entrada.length, 12);

  return Buffer.concat([cabecalho, entrada, png]);
}

const ico = path.join(PUBLIC, 'favicon.ico');
fs.writeFileSync(ico, empacotarIco(fs.readFileSync(path.join(PUBLIC, 'favicon-32.png')), 32));
console.log(`public/${'favicon.ico'.padEnd(24)} 32x32  ${kb(ico)}`);
