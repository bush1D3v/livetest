/**
 * Grava a URL do repositório nos três pacotes publicáveis.
 *
 * A URL entra em `repository`, `homepage` e `bugs` de cada manifesto, e cada um
 * usa um formato diferente (`git+...git`, `/tree/main/...#readme`, `/issues`).
 * Editar os três à mão é onde se erra; este script deriva tudo de um argumento.
 *
 * Ele também conserta os links dos READMEs. Um `](../../docs/x.md)` funciona ao
 * navegar o repositório, mas o pacote publicado não tem repositório em volta: o
 * npm e o `vsce` reescrevem esses links para URLs absolutas por conta própria, e
 * o `vsce` produz `blob/HEAD/../../docs/x.md`, que nenhum navegador resolve.
 * Deixá-los já absolutos evita a reescrita e funciona nos dois lugares.
 *
 * O branch dos links vem do git; passe um segundo argumento para fixar outro.
 *
 * Uso: `npm run set-repo -- https://github.com/usuario/repositorio [branch]`
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACOTES = ['core', 'cli', 'vscode-extension'];

/** Lê o branch atual do git, ou cai em `main` fora de um repositório. */
function detectarBranch() {
  try {
    const saida = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: RAIZ,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return saida === '' || saida === 'HEAD' ? 'main' : saida;
  } catch {
    return 'main';
  }
}

/**
 * Branch usada nos links do GitHub.
 *
 * Chutar `main` é o erro clássico: em um repositório cujo branch é `master`
 * todos os links nascem apontando para o vazio, e ninguém percebe até alguém
 * clicar. O segundo argumento permite fixar outro branch, para quem publica a
 * partir de um que não é o atual.
 */
const BRANCH = process.argv[3] ?? detectarBranch();

const entrada = process.argv[2];
if (entrada === undefined) {
  console.error('Uso: npm run set-repo -- https://github.com/usuario/repositorio [branch]');
  process.exit(1);
}

// Aceita as formas que se copia do GitHub: com .git no fim, com barra, ou SSH.
const url = entrada
  .trim()
  .replace(/^git\+/, '')
  .replace(/^git@github\.com:/, 'https://github.com/')
  .replace(/\.git$/, '')
  .replace(/\/$/, '');

if (!/^https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+$/.test(url)) {
  console.error(`URL não reconhecida: "${entrada}"`);
  console.error('Esperado algo como https://github.com/usuario/repositorio');
  process.exit(1);
}

/**
 * Torna absolutos os links de um README que apontam para fora do pacote.
 *
 * Também reaponta links já absolutos, para que rodar o script de novo com outra
 * URL atualize tudo em vez de deixar metade apontando para o repositório antigo.
 *
 * @param pacote - Nome da pasta em `packages/`.
 * @returns `true` se o arquivo mudou.
 */
function ajustarLinks(pacote) {
  const caminho = path.join(RAIZ, 'packages', pacote, 'README.md');
  if (!fs.existsSync(caminho)) return false;

  const original = fs.readFileSync(caminho, 'utf8');
  const base = `packages/${pacote}`;

  const texto = original
    .replace(/\]\((\.\.?\/[^)]+)\)/g, (todo, relativo) => {
      // Resolve de verdade a partir da pasta do pacote: `../x` e `../../x`
      // apontam para lugares diferentes, e tratá-los igual erraria um dos dois.
      const alvo = path.posix.normalize(path.posix.join(base, relativo));
      if (alvo.startsWith('..')) return todo; // escapou do repositório
      return `](${url}/blob/${BRANCH}/${alvo})`;
    })
    .replace(
      /\]\(https:\/\/github\.com\/[^/)]+\/[^/)]+\/blob\/[^/)]+\/([^)]+)\)/g,
      (_todo, alvo) => `](${url}/blob/${BRANCH}/${alvo})`,
    );

  if (texto === original) return false;
  fs.writeFileSync(caminho, texto);
  return true;
}

for (const pacote of PACOTES) {
  const caminho = path.join(RAIZ, 'packages', pacote, 'package.json');
  const p = JSON.parse(fs.readFileSync(caminho, 'utf8'));

  p.homepage = `${url}/tree/${BRANCH}/packages/${pacote}#readme`;
  p.repository = { type: 'git', url: `git+${url}.git`, directory: `packages/${pacote}` };
  p.bugs = { url: `${url}/issues` };

  fs.writeFileSync(caminho, `${JSON.stringify(p, null, 2)}\n`);

  const mexeuNoReadme = ajustarLinks(pacote);
  console.log(`packages/${pacote}  ->  ${url}${mexeuNoReadme ? '  (+ links do README)' : ''}`);
}

console.log(`\nBranch usada nos links: ${BRANCH}`);
console.log('Confira com: npm run preflight');
