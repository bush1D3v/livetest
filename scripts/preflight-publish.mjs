/**
 * Verificação anterior à publicação.
 *
 * Publicar no npm é irreversível: uma versão publicada não pode ser
 * republicada com outro conteúdo, e `npm unpublish` só é permitido nas
 * primeiras 72 horas — e ainda queima o número da versão para sempre. O
 * Marketplace do VSCode é igualmente definitivo.
 *
 * Este script roda todas as conferências que só se descobre tarde: URL de
 * repositório ainda com o placeholder, arquivo faltando no pacote, versão já
 * ocupada no registro, build ausente, ícone fora do tamanho.
 *
 * Uso: `npm run preflight`
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Marcador que precisa ser trocado pela URL real antes de publicar. */
const PLACEHOLDER = 'SEU-USUARIO';

const problemas = [];
const avisos = [];
const ok = [];

/**
 * Registra o resultado de uma conferência.
 *
 * @param condicao - `true` quando está tudo certo.
 * @param descricao - O que foi conferido, em afirmativa neutra.
 * @param falha - O que dizer quando falha, incluindo como resolver.
 * @param opcoes - `fatal: false` transforma o problema em aviso.
 */
function conferir(condicao, descricao, falha, { fatal = true } = {}) {
  if (condicao) ok.push(descricao);
  else (fatal ? problemas : avisos).push(falha ?? descricao);
}

/** Lê um package.json do repositório. */
function manifesto(pacote) {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, 'packages', pacote, 'package.json'), 'utf8'));
}

/** Roda um comando e devolve a saída, ou `null` se falhar. */
function rodar(comando, args) {
  try {
    return execFileSync(comando, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/**
 * Lê largura e altura de um PNG, sem decodificar a imagem.
 *
 * O cabeçalho IHDR é fixo: assinatura de 8 bytes, tamanho e tipo do chunk, e
 * então largura e altura em big-endian nos offsets 16 e 20.
 *
 * @param caminho - Arquivo a inspecionar.
 * @returns As dimensões, ou `null` se o arquivo não é um PNG.
 */
function dimensoesPng(caminho) {
  if (!fs.existsSync(caminho)) return null;
  const bytes = fs.readFileSync(caminho);
  if (bytes.length < 24 || bytes.subarray(1, 4).toString('ascii') !== 'PNG') return null;
  return { largura: bytes.readUInt32BE(16), altura: bytes.readUInt32BE(20) };
}

/** Consulta a versão publicada de um pacote, ou `null` se não existe. */
function versaoPublicada(nome) {
  const saida = rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['view', nome, 'version']);
  return saida === null ? null : saida.trim();
}

// --- Comuns a todos ---------------------------------------------------------

conferir(
  fs.existsSync(path.join(RAIZ, 'LICENSE')),
  'LICENSE na raiz',
  'LICENSE ausente na raiz do repositório',
);

for (const pacote of ['core', 'cli', 'vscode-extension']) {
  const p = manifesto(pacote);
  const url = JSON.stringify(p.repository ?? '');

  conferir(
    !url.includes(PLACEHOLDER),
    `packages/${pacote}: repository apontando para a URL real`,
    `packages/${pacote}: repository ainda contém "${PLACEHOLDER}" — troque pela URL do seu repositório`,
  );
  conferir(
    p.license !== undefined,
    `packages/${pacote}: campo license`,
    `packages/${pacote}: campo license ausente no package.json`,
  );
  conferir(
    fs.existsSync(path.join(RAIZ, 'packages', pacote, 'LICENSE')),
    `packages/${pacote}: arquivo LICENSE`,
    `packages/${pacote}: falta o arquivo LICENSE — copie o da raiz`,
  );

  const readme = path.join(RAIZ, 'packages', pacote, 'README.md');
  if (!fs.existsSync(readme)) {
    problemas.push(`packages/${pacote}: falta o README.md — é a página do pacote no registro`);
    continue;
  }
  ok.push(`packages/${pacote}: README.md`);

  const texto = fs.readFileSync(readme, 'utf8');

  conferir(
    !texto.includes(PLACEHOLDER),
    `packages/${pacote}: README sem placeholder`,
    `packages/${pacote}: o README ainda cita "${PLACEHOLDER}" — rode "npm run set-repo"`,
  );

  // O npm e o vsce reescrevem link relativo para URL absoluta por conta própria,
  // e o vsce produz `blob/HEAD/../../x`, que nenhum navegador resolve. Fora do
  // repositório não há como um link relativo funcionar.
  const relativos = [...texto.matchAll(/\]\((\.\.?\/[^)]+)\)/g)].map((achado) => achado[1]);
  conferir(
    relativos.length === 0,
    `packages/${pacote}: links do README absolutos`,
    `packages/${pacote}: o README tem link relativo (${relativos[0]}) — ` +
      'quebra no npm e no Marketplace; rode "npm run set-repo"',
  );
}

// --- Pacotes npm ------------------------------------------------------------

for (const pacote of ['core', 'cli']) {
  const p = manifesto(pacote);
  const dir = path.join(RAIZ, 'packages', pacote);

  conferir(
    p.private !== true,
    `${p.name}: publicável (private não está ligado)`,
    `${p.name}: está marcado como "private": true — o npm recusa publicar`,
  );
  conferir(
    fs.existsSync(path.join(dir, 'dist')),
    `${p.name}: dist/ construído`,
    `${p.name}: dist/ não existe — rode "npm run build"`,
  );

  for (const arquivo of p.files ?? []) {
    conferir(
      fs.existsSync(path.join(dir, arquivo)),
      `${p.name}: "${arquivo}" presente`,
      `${p.name}: "${arquivo}" está listado em "files" mas não existe no disco`,
    );
  }

  const publicada = versaoPublicada(p.name);
  if (publicada === null) {
    ok.push(`${p.name}: ainda não publicado — a versão ${p.version} está livre`);
  } else {
    conferir(
      publicada !== p.version,
      `${p.name}: versão ${p.version} livre (publicada: ${publicada})`,
      `${p.name}: a versão ${p.version} já existe no npm — suba a versão antes`,
    );
  }
}

// A CLI depende do core numa versão exata: publicar fora de ordem quebra.
const core = manifesto('core');
const cli = manifesto('cli');
conferir(
  cli.dependencies?.['@livetest/core'] === core.version,
  `@livetest/cli e @livetest/core alinhados na versão ${core.version}`,
  `@livetest/cli depende de @livetest/core@${cli.dependencies?.['@livetest/core']}, ` +
    `mas o core está em ${core.version} — alinhe os dois antes de publicar`,
);

// --- Extensão do VSCode -----------------------------------------------------

const ext = manifesto('vscode-extension');
const extDir = path.join(RAIZ, 'packages', 'vscode-extension');

conferir(
  typeof ext.publisher === 'string',
  'extensão: campo publisher',
  'extensão: falta o campo publisher — precisa bater com o publisher do Marketplace',
);
conferir(
  fs.existsSync(path.join(extDir, 'dist', 'extension.cjs')),
  'extensão: bundle construído',
  'extensão: dist/extension.cjs não existe — rode "npm run build"',
);
conferir(
  ext.dependencies === undefined,
  'extensão: sem dependências de runtime (tudo embutido pelo esbuild)',
  'extensão: há "dependencies" declaradas — o vsce tentaria empacotar node_modules inteiro',
);

const icone = dimensoesPng(path.join(extDir, ext.icon ?? ''));
if (icone === null) {
  problemas.push('extensão: o ícone está ausente ou não é PNG — o Marketplace recusa SVG');
} else {
  conferir(
    icone.largura >= 128 && icone.altura >= 128,
    `extensão: ícone ${icone.largura}x${icone.altura}`,
    `extensão: o ícone tem ${icone.largura}x${icone.altura}, o mínimo do Marketplace é 128x128`,
  );
}

// --- Landing ----------------------------------------------------------------

const landing = path.join(RAIZ, 'packages', 'landing');
const publico = path.join(landing, 'public');
const distLanding = path.join(landing, 'dist');

conferir(
  fs.existsSync(path.join(RAIZ, 'vercel.json')),
  'landing: vercel.json presente',
  'landing: sem vercel.json — a Vercel vai depender de configuração pelo painel',
);

// O cartão social é a diferença entre o link virar um cartão e virar texto cru.
const cartao = dimensoesPng(path.join(publico, 'og-image.png'));
if (cartao === null) {
  problemas.push('landing: falta public/og-image.png — rode "npm run build:og"');
} else {
  conferir(
    cartao.largura === 1200 && cartao.altura === 630,
    `landing: cartão social ${cartao.largura}x${cartao.altura}`,
    `landing: o cartão social tem ${cartao.largura}x${cartao.altura}; o esperado é 1200x630`,
  );
}

for (const arquivo of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', '404.html']) {
  conferir(
    fs.existsSync(path.join(publico, arquivo)),
    `landing: ${arquivo}`,
    `landing: falta public/${arquivo} — rode "npm run build:assets"`,
  );
}

// Um manifesto que aponta para ícone inexistente falha só no celular de quem
// tentar instalar — ou seja, silenciosamente.
const caminhoManifesto = path.join(publico, 'site.webmanifest');
if (!fs.existsSync(caminhoManifesto)) {
  problemas.push('landing: falta public/site.webmanifest');
} else {
  const manifesto = JSON.parse(fs.readFileSync(caminhoManifesto, 'utf8'));
  ok.push('landing: site.webmanifest é JSON válido');

  for (const icone of manifesto.icons ?? []) {
    const alvo = path.join(publico, icone.src.replace(/^\.?\//, ''));
    conferir(
      fs.existsSync(alvo),
      `landing: ícone do manifesto ${icone.src}`,
      `landing: o manifesto aponta para ${icone.src}, que não existe`,
    );
  }

  conferir(
    (manifesto.icons ?? []).some((icone) => icone.purpose === 'maskable'),
    'landing: manifesto tem ícone maskable',
    'landing: sem ícone "maskable" o Android recorta o ícone e corta a marca',
  );
}

// Estes três só existem depois do build — a Vercel refaz, mas conferir aqui
// pega um marcador que ficou para trás antes de ele ir ao ar.
if (!fs.existsSync(path.join(distLanding, 'index.html'))) {
  avisos.push('landing: dist/ não construído — rode "npm run build" para conferir o SEO');
} else {
  for (const arquivo of ['robots.txt', 'sitemap.xml', 'og-image.png']) {
    conferir(
      fs.existsSync(path.join(distLanding, arquivo)),
      `landing: dist/${arquivo}`,
      `landing: o build não gerou dist/${arquivo}`,
    );
  }

  const html = fs.readFileSync(path.join(distLanding, 'index.html'), 'utf8');
  conferir(
    !html.includes('__SITE_URL__'),
    'landing: URL do site substituída no HTML',
    'landing: sobrou "__SITE_URL__" no HTML — o plugin de SEO não rodou',
  );
  conferir(
    /property="og:image" content="https?:\/\//.test(html),
    'landing: og:image absoluto',
    'landing: og:image não é uma URL absoluta — as redes sociais o ignoram',
  );
}

// --- Relatório --------------------------------------------------------------

const simbolo = { ok: '  ok  ', aviso: 'aviso ', erro: ' ERRO ' };

for (const linha of ok) console.log(`[${simbolo.ok}] ${linha}`);
for (const linha of avisos) console.log(`[${simbolo.aviso}] ${linha}`);
for (const linha of problemas) console.log(`[${simbolo.erro}] ${linha}`);

console.log('');
if (problemas.length > 0) {
  console.log(`${problemas.length} problema(s) impedem a publicação.`);
  process.exit(1);
}
console.log(`Tudo pronto para publicar.${avisos.length > 0 ? ` ${avisos.length} aviso(s).` : ''}`);
