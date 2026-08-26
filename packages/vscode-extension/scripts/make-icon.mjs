/**
 * Gera o ícone PNG da extensão a partir das mesmas formas do SVG.
 *
 * O Marketplace do VSCode só aceita PNG, e a extensão precisa de um de pelo
 * menos 128×128 — sem ele o cartão aparece com o ícone cinza genérico. Em vez
 * de adicionar uma dependência de rasterização (`sharp`, `canvas`, um
 * navegador headless) para desenhar quatro formas geométricas, este script
 * pinta os pixels e codifica o PNG na mão, com o `zlib` que já vem no Node.
 *
 * Uso: `node scripts/make-icon.mjs` — grava `resources/icon.png`.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const TAMANHO = 128;

/** Paleta, a mesma da marca. */
const FUNDO = [10, 13, 22];
const CIANO = [34, 211, 238];
const VIOLETA = [167, 139, 250];

/** Mistura duas cores. `t` vai de 0 (a) a 1 (b). */
function misturar(a, b, t) {
  const k = Math.min(1, Math.max(0, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/** Distância de um ponto ao segmento de reta `ab`. */
function distanciaAoSegmento(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const comprimento = dx * dx + dy * dy;
  const t = comprimento === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / comprimento));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Distância de um ponto ao anel de um círculo. */
function distanciaAoAnel(px, py, cx, cy, raio) {
  return Math.abs(Math.hypot(px - cx, py - cy) - raio);
}

/** Distância de um ponto à borda de um retângulo arredondado. */
function dentroDoRetanguloArredondado(px, py, x, y, largura, altura, raio) {
  const dx = Math.max(x - px, 0, px - (x + largura));
  const dy = Math.max(y - py, 0, py - (y + altura));
  if (dx === 0 && dy === 0) {
    // Dentro do retângulo: falta descontar os cantos.
    const cantoX = Math.min(px - x, x + largura - px);
    const cantoY = Math.min(py - y, y + altura - py);
    if (cantoX < raio && cantoY < raio) {
      return Math.hypot(raio - cantoX, raio - cantoY) <= raio;
    }
    return true;
  }
  return false;
}

/**
 * As formas do traço, em coordenadas de 0 a 32 — as mesmas do `favicon.svg`.
 * Cada uma devolve a distância do pixel até ela, para antialiasing.
 */
const TRACOS = [
  (x, y) => distanciaAoSegmento(x, y, 7, 9, 15, 9), // topo do "T"
  (x, y) => distanciaAoSegmento(x, y, 11, 9, 11, 23), // haste do "T"
  (x, y) => distanciaAoAnel(x, y, 22, 11, 3.4), // cabeça do marcador
  (x, y) => distanciaAoSegmento(x, y, 22, 14.4, 22, 18.6), // corpo do marcador
  (x, y) => distanciaAoSegmento(x, y, 17.5, 23, 26.5, 23), // base
];

const ESPESSURA = 1.1; // metade da largura do traço, em unidades de 32

/** Compõe a imagem em RGBA. */
function desenhar() {
  const pixels = Buffer.alloc(TAMANHO * TAMANHO * 4);
  const escala = TAMANHO / 32;

  for (let py = 0; py < TAMANHO; py++) {
    for (let px = 0; px < TAMANHO; px++) {
      const u = (px + 0.5) / escala;
      const v = (py + 0.5) / escala;
      const offset = (py * TAMANHO + px) * 4;

      // Fora do fundo arredondado o pixel fica transparente.
      if (!dentroDoRetanguloArredondado(u, v, 0, 0, 32, 32, 8)) {
        pixels.writeUInt32BE(0, offset);
        continue;
      }

      let cor = FUNDO;
      let alfa = 255;

      // A menor distância a qualquer traço decide a cobertura do pixel.
      let menor = Infinity;
      for (const traco of TRACOS) menor = Math.min(menor, traco(u, v));

      const cobertura = Math.min(1, Math.max(0, (ESPESSURA - menor) * escala + 0.5));
      if (cobertura > 0) {
        // O gradiente da marca corre na diagonal, como no SVG.
        const gradiente = misturar(CIANO, VIOLETA, (u + v) / 64);
        cor = misturar(FUNDO, gradiente, cobertura);
      }

      pixels[offset] = cor[0];
      pixels[offset + 1] = cor[1];
      pixels[offset + 2] = cor[2];
      pixels[offset + 3] = alfa;
    }
  }

  return pixels;
}

/** Um chunk de PNG: tamanho, tipo, dados e CRC. */
function chunk(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([tamanho, corpo, crc]);
}

/** Tabela e cálculo de CRC-32, como o formato PNG exige. */
const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = TABELA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Monta o arquivo PNG completo. */
function codificarPng(pixels) {
  const assinatura = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(TAMANHO, 0);
  ihdr.writeUInt32BE(TAMANHO, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compressão deflate
  ihdr[11] = 0; // filtro padrão
  ihdr[12] = 0; // sem entrelaçamento

  // Cada linha é precedida pelo byte de filtro; usamos 0 (sem filtro).
  const linhas = Buffer.alloc(TAMANHO * (TAMANHO * 4 + 1));
  for (let y = 0; y < TAMANHO; y++) {
    const destino = y * (TAMANHO * 4 + 1);
    linhas[destino] = 0;
    pixels.copy(linhas, destino + 1, y * TAMANHO * 4, (y + 1) * TAMANHO * 4);
  }

  return Buffer.concat([
    assinatura,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(linhas, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const destino = path.join(AQUI, '..', 'resources', 'icon.png');
fs.writeFileSync(destino, codificarPng(desenhar()));

const kb = (fs.statSync(destino).size / 1024).toFixed(1);
console.log(`resources/icon.png  ${TAMANHO}x${TAMANHO}  ${kb} kB`);
