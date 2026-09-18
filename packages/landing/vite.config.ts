/**
 * Build do site.
 *
 * O site tem vinte e oito paginas, e nenhuma delas e um arquivo HTML no
 * repositorio. Elas nascem aqui, no build, de tres fontes: os arquivos Markdown
 * em `content/`, a tabela de rotas em `src/build/routes.ts` e a moldura em
 * `src/build/layout.ts`. Acrescentar uma pagina e acrescentar um arquivo e uma
 * linha na tabela; o menu lateral, o sitemap, os links de anterior e proxima e o
 * indice de busca se ajustam sozinhos.
 *
 * O Vite entra com um so ponto de entrada, `src/main.ts`, e nao com HTML. E o
 * plugin que escreve o HTML, ja com as tags dos ativos que o proprio bundle
 * produziu, corrigidas para a profundidade de cada pagina. Fosse pelo caminho
 * normal, seria preciso manter vinte e oito arquivos HTML quase identicos so
 * para o Vite ter onde injetar um `<script>`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';

import { LOCALES, type Locale } from './src/modules/i18n.js';
import { DESCRICAO_DA_HOME, renderHome } from './src/build/home.js';
import {
  MARCADOR_DE_ATIVOS,
  renderDocumento,
  resolvedorDeLinks,
  rotaCompleta,
} from './src/build/layout.js';
import { renderMarkdown, type Heading, type Secao } from './src/build/markdown.js';
import { caminhoRelativo, PAGINAS_DOC } from './src/build/routes.js';
import { montarIndice, serializarIndice } from './src/build/search-index.js';
import { buildRobots, buildSitemap, dataDoSitemap } from './src/build/seo-assets.js';
import { resolveSiteUrl } from './src/build/site-url.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CONTEUDO = path.join(AQUI, 'content');

/** Uma pagina pronta para virar arquivo. */
interface Documento {
  /** Idioma. */
  locale: Locale;
  /** Rota sem idioma. `''` e a home. */
  rota: string;
  /** Rota com idioma, que e tambem o caminho do arquivo no `dist/`. */
  caminho: string;
  /** Titulo da pagina. */
  titulo: string;
  /** Resumo de uma frase. */
  descricao: string;
  /** Corpo em HTML. */
  corpo: string;
  /** Titulos de nivel 2 e 3. */
  headings: Heading[];
  /** Secoes em texto puro, para a busca. */
  secoes: Secao[];
  /** `true` so para a home. */
  home: boolean;
}

/** Le a versao publicada no npm a partir do pacote da CLI. */
function versaoPublicada(): string {
  const bruto = fs.readFileSync(path.join(AQUI, '..', 'cli', 'package.json'), 'utf8');
  return (JSON.parse(bruto) as { version: string }).version;
}

/**
 * Separa o frontmatter do corpo.
 *
 * O formato e o minimo que serve: um bloco entre duas linhas de tres hifens, com
 * `chave: valor` por linha. Nao ha lista nem aninhamento porque nenhuma pagina
 * precisa, e um parser de YAML completo custaria mais que tudo que ele leria.
 */
function lerFrontmatter(bruto: string): { dados: Record<string, string>; corpo: string } {
  const achado = /^---\n([\s\S]*?)\n---\n?/.exec(bruto);
  if (!achado) return { dados: {}, corpo: bruto };

  const dados: Record<string, string> = {};
  for (const linha of (achado[1] as string).split('\n')) {
    const separador = linha.indexOf(':');
    if (separador === -1) continue;
    dados[linha.slice(0, separador).trim()] = linha.slice(separador + 1).trim();
  }

  return { dados, corpo: bruto.slice(achado[0].length) };
}

/** Monta as vinte e oito paginas a partir do disco. */
function lerDocumentos(): Documento[] {
  const documentos: Documento[] = [];

  for (const locale of LOCALES) {
    documentos.push({
      locale,
      rota: '',
      caminho: rotaCompleta(locale, ''),
      titulo: 'Live Test Runner',
      descricao: DESCRICAO_DA_HOME[locale],
      corpo: renderHome(locale),
      headings: [],
      secoes: [],
      home: true,
    });

    for (const pagina of PAGINAS_DOC) {
      const arquivo = path.join(CONTEUDO, locale, pagina.arquivo);
      const { dados, corpo } = lerFrontmatter(fs.readFileSync(arquivo, 'utf8'));
      const caminho = rotaCompleta(locale, pagina.rota);
      const convertido = renderMarkdown(corpo, {
        resolverLink: resolvedorDeLinks(caminho, locale),
      });

      documentos.push({
        locale,
        rota: pagina.rota,
        caminho,
        titulo: dados.title ?? pagina.rota,
        descricao: dados.description ?? '',
        corpo: convertido.html,
        headings: convertido.headings,
        secoes: convertido.secoes,
        home: false,
      });
    }
  }

  return documentos;
}

/** Envolve um documento na moldura, ja com as tags de ativos no lugar certo. */
function montarHtml(documento: Documento, versao: string, ativos: string, site: string): string {
  const html = renderDocumento({
    locale: documento.locale,
    rota: documento.rota,
    titulo: documento.titulo,
    descricao: documento.descricao,
    corpo: documento.corpo,
    headings: documento.headings,
    home: documento.home,
    versao,
  });

  const raiz = caminhoRelativo(documento.caminho, '');

  return html
    .replace(MARCADOR_DE_ATIVOS, ativos.replaceAll('__RAIZ__', raiz))
    .replaceAll('__SITE_URL__', site);
}

/** Os indices de busca, um por idioma. */
function indicesDeBusca(documentos: readonly Documento[]): Map<string, string> {
  const arquivos = new Map<string, string>();

  for (const locale of LOCALES) {
    const paginas = documentos
      .filter((documento) => documento.locale === locale && !documento.home)
      .map((documento) => ({
        rota: documento.caminho,
        titulo: documento.titulo,
        secoes: documento.secoes,
      }));

    arquivos.set(`search-${locale}.json`, serializarIndice(montarIndice(paginas)));
  }

  return arquivos;
}

/** O plugin que faz o site inteiro. */
function site(): Plugin {
  const endereco = resolveSiteUrl(process.env);
  const versao = versaoPublicada();

  return {
    name: 'livetest-site',

    configureServer(server) {
      // Em desenvolvimento nao ha bundle: o `main.ts` entra pelo caminho do
      // proprio Vite, e o restante da pagina e montado a cada requisicao, para
      // que editar um Markdown apareca no recarregamento seguinte.
      server.middlewares.use((req, res, proximo) => {
        const url = (req.url ?? '/').split('?')[0] as string;

        if (url === '/search-en.json' || url === '/search-pt.json') {
          const conteudo = indicesDeBusca(lerDocumentos()).get(url.slice(1));
          res.setHeader('Content-Type', 'application/json');
          res.end(conteudo);
          return;
        }

        if (!url.endsWith('/')) {
          // Toda pagina e um diretorio. Sem a barra, um link relativo subiria um
          // nivel a menos e quebraria, e o erro so apareceria em producao.
          const documentos = lerDocumentos();
          if (documentos.some((documento) => `/${documento.caminho}` === url)) {
            res.statusCode = 301;
            res.setHeader('Location', `${url}/`);
            res.end();
            return;
          }
          proximo();
          return;
        }

        const caminho = url.slice(1, -1);
        const documento = lerDocumentos().find((alvo) => alvo.caminho === caminho);
        if (documento === undefined) {
          proximo();
          return;
        }

        const raiz = caminhoRelativo(documento.caminho, '');

        // Em desenvolvimento o Vite entrega o CSS como um modulo JavaScript, que
        // so injeta os estilos depois que o bundle roda: a pagina pisca sem
        // estilo nenhum a cada navegacao. O `?direct` pede o CSS de verdade, em
        // um `<link>` que bloqueia a renderizacao, como no site publicado.
        //
        // O `main.ts` continua importando a mesma folha, e e por ele que passa o
        // HMR. A copia do `<link>` fica congelada no conteudo do carregamento:
        // valores alterados sao vencidos pelo estilo injetado, que vem depois na
        // cascata, mas uma regra *apagada* so some de fato no proximo
        // recarregamento.
        const ativos = [
          `<link rel="stylesheet" href="${raiz}src/styles/index.css?direct" />`,
          `<script type="module" src="${raiz}src/main.ts"></script>`,
        ].join('\n    ');

        const html = montarHtml(documento, versao, ativos, endereco);

        server
          .transformIndexHtml(url, html)
          .then((pronto) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(pronto);
          })
          .catch(proximo);
      });
    },

    configurePreviewServer(server) {
      // O `vite preview` serve arquivos, e nao paginas: ele nao sabe que
      // `/guide/depth/` quer dizer `/guide/depth/index.html`, e devolveria 404
      // para o site inteiro. A Vercel faz as duas coisas sozinha, e e por isso
      // que o `vercel.json` declara `trailingSlash: true`. Aqui elas sao feitas
      // a mao, para que a previa se comporte como o host de verdade.
      server.middlewares.use((req, res, proximo) => {
        const [url = '/', consulta] = (req.url ?? '/').split('?');
        const sufixo = consulta === undefined ? '' : `?${consulta}`;

        if (url.endsWith('/')) {
          req.url = `${url}index.html${sufixo}`;
          proximo();
          return;
        }

        if (!path.extname(url) && fs.existsSync(path.join(AQUI, 'dist', url, 'index.html'))) {
          res.statusCode = 301;
          res.setHeader('Location', `${url}/${sufixo}`);
          res.end();
          return;
        }

        proximo();
      });
    },

    generateBundle(_opcoes, bundle) {
      const documentos = lerDocumentos();

      // As tags saem do proprio bundle, e nao de um `index.html` processado: e o
      // unico jeito de todas as paginas receberem o mesmo hash sem que exista um
      // arquivo HTML por pagina no repositorio.
      const entrada = Object.values(bundle).find(
        (peca) => peca.type === 'chunk' && peca.isEntry,
      );
      const estilos = Object.keys(bundle).filter((nome) => nome.endsWith('.css'));

      const ativos = [
        ...estilos.map((nome) => `<link rel="stylesheet" href="__RAIZ__${nome}" />`),
        entrada === undefined
          ? ''
          : `<script type="module" src="__RAIZ__${entrada.fileName}"></script>`,
      ]
        .filter((tag) => tag !== '')
        .join('\n    ');

      for (const documento of documentos) {
        this.emitFile({
          type: 'asset',
          fileName: documento.caminho === '' ? 'index.html' : `${documento.caminho}/index.html`,
          source: montarHtml(documento, versao, ativos, endereco),
        });
      }

      for (const [nome, conteudo] of indicesDeBusca(documentos)) {
        this.emitFile({ type: 'asset', fileName: nome, source: conteudo });
      }

      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: buildRobots(endereco) });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: buildSitemap(endereco, dataDoSitemap(new Date())),
      });
    },
  };
}

export default defineConfig({
  // Caminhos relativos: o site funciona na raiz de um dominio, em um
  // subdiretorio qualquer, ou servido por qualquer host estatico, sem
  // reconfiguracao. Cada pagina calcula a propria distancia ate a raiz.
  base: './',
  appType: 'custom',
  plugins: [site()],
  server: {
    watch: {
      // `dist/` e `coverage/` ficam dentro da raiz e sao reescritos inteiros a
      // cada build ou rodada de cobertura. Sem ignora-los, rodar os testes com
      // o servidor no ar dispara centenas de recarregamentos em sequencia, e o
      // servidor nao sobrevive a enxurrada.
      ignored: ['**/dist/**', '**/coverage/**'],
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    cssMinify: true,
    reportCompressedSize: true,
    rollupOptions: {
      input: path.join(AQUI, 'src', 'main.ts'),
    },
  },
});
