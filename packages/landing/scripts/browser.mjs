/**
 * Captura de imagens usando o Chrome ou o Edge ja instalado.
 *
 * Os ativos gerados por aqui — icones e o cartao social — sao versionados
 * junto com o codigo. Nada disto roda no deploy: roda quando a marca muda.
 * Por isso vale usar o navegador da maquina em vez de trazer `puppeteer` ou
 * `sharp` para o projeto.
 *
 * @packageDocumentation
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Onde procurar um navegador, na ordem de preferencia. */
const CANDIDATOS = [
  process.env['CHROME_PATH'],
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/**
 * Acha um navegador utilizavel, ou encerra o processo explicando.
 *
 * @returns Caminho do executavel.
 */
export function acharNavegador() {
  for (const caminho of CANDIDATOS) {
    if (caminho !== undefined && fs.existsSync(caminho)) return caminho;
  }
  console.error('Nenhum Chrome ou Edge encontrado.');
  console.error('Aponte um com a variavel CHROME_PATH.');
  process.exit(1);
}

/**
 * Fotografa uma pagina HTML e grava o PNG.
 *
 * @param opcoes.html - Conteudo da pagina.
 * @param opcoes.largura - Largura da janela, em pixels.
 * @param opcoes.altura - Altura da janela, em pixels.
 * @param opcoes.destino - Caminho do PNG a gravar.
 * @param opcoes.transparente - Preserva a transparencia em vez de pintar
 *   branco onde a pagina nao pinta nada. @defaultValue `false`
 * @param opcoes.esperaMs - Tempo virtual concedido antes do clique, para que
 *   fontes remotas terminem de carregar. @defaultValue `0`
 */
export function capturar({ html, largura, altura, destino, transparente = false, esperaMs = 0 }) {
  const navegador = acharNavegador();
  const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'livetest-captura-'));
  const pagina = path.join(temporario, 'pagina.html');
  fs.writeFileSync(pagina, html, 'utf8');

  const argumentos = [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    `--screenshot=${destino}`,
    `--window-size=${largura},${altura}`,
    `--user-data-dir=${path.join(temporario, 'perfil')}`,
  ];

  // Sem isto o fundo sai branco onde a pagina e transparente.
  if (transparente) argumentos.push('--default-background-color=00000000');

  // O tempo virtual adianta os temporizadores em vez de esperar de verdade:
  // as fontes do Google terminam de carregar sem custar cinco segundos.
  if (esperaMs > 0) argumentos.push(`--virtual-time-budget=${esperaMs}`);

  argumentos.push(pagina);

  try {
    execFileSync(navegador, argumentos, { stdio: 'ignore' });
  } finally {
    fs.rmSync(temporario, { recursive: true, force: true });
  }

  if (!fs.existsSync(destino)) {
    throw new Error(`O navegador nao gerou ${destino}.`);
  }
}

/** Tamanho de um arquivo, em kB, com uma casa decimal. */
export function kb(caminho) {
  return `${(fs.statSync(caminho).size / 1024).toFixed(1)} kB`;
}
