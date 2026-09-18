# `@livetest/landing`

Site do [Live Test Runner](../../README.md): apresentação e documentação, em inglês e em
português. Estático, construído com Vite, **sem uma única dependência em runtime**.

```bash
npm run dev             # servidor de desenvolvimento
npm run build           # gera dist/ (28 páginas, índices de busca, robots.txt e sitemap.xml)
npm run preview         # serve o dist/ como um host estático serviria
npm test                # 353 testes, 100% de cobertura

npm run build:assets    # regenera ícones e cartão social (só quando a marca muda)
npm run build:standalone # a home em um arquivo só
```

## Como o site é montado

Nenhuma página é um arquivo HTML no repositório. Todas nascem no build, de três fontes:

| Fonte | O que define |
|---|---|
| `content/<idioma>/**.md` | o texto de cada página de documentação |
| `src/build/routes.ts` | quais páginas existem, o menu lateral, o cabeçalho e o rodapé |
| `src/build/layout.ts` | a moldura: cabeçalho, menu, índice, rodapé, diálogo de busca |

Acrescentar uma página é acrescentar um arquivo Markdown e uma linha na tabela de rotas. O
menu lateral, o sitemap, os links de anterior e próxima e o índice de busca se ajustam
sozinhos, porque todos derivam da mesma tabela. Um teste confere que cada rota listada tem
arquivo nos dois idiomas, e outro confere que todo link interno aponta para uma página que
existe, com uma âncora que existe.

O Vite entra com um só ponto de entrada, `src/main.ts`, e não com HTML. É o plugin em
`vite.config.ts` que escreve as páginas, já com as tags dos ativos que o próprio bundle
produziu, corrigidas para a profundidade de cada uma. Pelo caminho normal seriam vinte e
oito arquivos HTML quase idênticos no repositório, só para o Vite ter onde injetar um
`<script>`.

### Caminhos relativos e a barra no fim

Todo link do site é relativo, calculado a partir da distância entre a página atual e o
destino. Assim o site funciona na raiz de um domínio, em um subdiretório qualquer, ou
servido por qualquer host estático, sem reconfiguração.

Isso tem uma exigência: cada página é um diretório com `index.html` dentro, e o endereço
termina em barra. Sem a barra, o navegador resolveria os links a partir do diretório
**pai**, e todos subiriam um nível a menos. É por isso que o `vercel.json` declara
`trailingSlash: true`, e que o `npm run preview` traz um middleware que faz o mesmo que a
Vercel faz sozinha.

## Idioma

O inglês mora na raiz e o português sob `/pt/`, com as mesmas rotas. Cada página tem
exatamente uma contraparte, então o seletor de idioma nunca joga ninguém de volta para a
home.

A escolha tem três degraus: uma preferência guardada, o idioma do navegador quando for
português, e inglês. O redirecionamento automático acontece uma vez por aba, marcado em
`sessionStorage`. A marca existe porque em navegação privada a gravação da preferência
falha, e sem ela a página de destino detectaria o idioma do navegador, discordaria, e
mandaria a pessoa de volta.

## Tema

Claro, escuro ou o do sistema, com escuro como padrão. A decisão roda em um script
embutido no `<head>`, antes da primeira pintura: carregada com o bundle, a página piscaria
no tema errado antes de se corrigir.

Os dois temas são dois conjuntos de valores para as mesmas variáveis CSS, e nenhuma regra
da folha menciona uma cor literal. Blocos de código e o terminal mantêm superfície escura
nos dois temas: o realce de sintaxe foi ajustado para fundo escuro, e uma segunda paleta só
para o tema claro seria mais uma coisa para manter em sincronia sem ganho real.

## Busca

O índice é montado no build, um JSON por idioma, e baixado na primeira vez que alguém abre
a busca. Quem só veio ler um parágrafo não paga por ele. A unidade indexada é a **seção**,
e não a página: quem procura "profundidade transitive" quer cair no parágrafo que fala
disso, não no topo de um documento de duzentas linhas.

O ranqueamento é um BM25 com três ajustes que importam mais, na prática, que a fórmula:

- **campo pesa** — um termo no título vale mais que o mesmo termo no meio de um parágrafo;
- **cobertura pesa mais** — quem casa com todas as palavras digitadas sobe na frente de
  quem casa com uma só, mesmo que a segunda repita muito o termo;
- **a última palavra é um prefixo** — quem digita `confi` ainda está digitando, e a
  expansão usa busca binária sobre o vocabulário ordenado, não uma varredura por tecla.

Acentos saem dos dois lados, nomes em camelCase são quebrados (`depth` acha
`dependencyDepth`), e uma palavra com um erro de digitação ainda acha o termo certo, desde
que seja uma edição só.

## Arquitetura

```
content/        o texto, em Markdown, um diretório por idioma
src/
  build/        código que só roda no build, e não vai para o navegador
    markdown      Markdown para HTML, no subconjunto que a documentação usa
    routes        o mapa do site: páginas, menus, rodapé, textos da moldura
    layout        a moldura de toda página
    home          a home, a única página cujo conteúdo é o layout
    search-index  o índice de busca
    seo-assets    robots.txt e sitemap.xml
  modules/      lógica pura, sem DOM, testada isoladamente
    search        o motor de busca
    theme, i18n   as regras de tema e idioma
    depth-graph   propagação no grafo reverso + o grafo da demonstração
    highlight     realce de sintaxe em ~200 linhas (jsonc, bash, ts, saída)
    typewriter    máquina de estados do terminal, dirigida por tempo
    motion, reveal, clipboard, icons
  setup/        ligação com o DOM, uma função por comportamento
  styles/       tokens, fundo, barra de rolagem, moldura, componentes, texto, home
  main.ts       fiação
```

A divisão entre `modules/` e `setup/` existe por uma razão prática: **`modules/` não toca
no DOM**, então roda em milissegundos no ambiente `node`. Só os testes de `setup/` pedem
jsdom, e eles pedem explicitamente, com `@vitest-environment jsdom` no topo do arquivo. O
jsdom leva alguns segundos para subir e não deve pesar sobre a suíte inteira.

Os testes de DOM não montam um HTML escrito à mão: montam a mesma página que o build
publica, gerada pelas funções de `src/build/`. Um gancho que some da moldura ou um
atributo `data-` renomeado quebra os testes na hora, que é o único jeito de a fiação e a
marcação não se separarem em silêncio.

## A demonstração do grafo

A seção interativa de [Profundidade de propagação](content/en/guide/depth.md) não é
ilustração: ela reproduz as **duas etapas** que o daemon executa, e não uma só. Propagação
em largura sobre as arestas de *import*, depois mapeamento de cada fonte alcançado ao seu
teste por convenção de nome. Colapsar as duas daria resultados errados: `self` não rodaria
teste nenhum, porque o teste está a um salto do fonte.

Os números que a página mostra são verificados contra os testes do core sobre o mesmo
projeto de exemplo: 1, 3 e 4 arquivos de teste. Se divergirem, a suíte reprova. Uma página
que mente sobre o produto é pior que nenhuma página.

## Animações

Todas escrevem apenas `transform`, `opacity` e variáveis CSS. Nenhuma provoca reflow
durante a rolagem. São elas: malha de pontos à deriva, duas auroras que respiram, brilho
que segue o cursor, barra de progresso de leitura, revelação por rolagem, digitação do
terminal, arestas do grafo com fluxo animado e halo nos cartões da home.

`prefers-reduced-motion: reduce` desliga **todas** elas e entrega a página inteira,
estática e completa, nunca escondida. É o mesmo princípio da ferramenta: degradar, não
sumir.

## SEO, compartilhamento e instalação

| Arquivo | Para quê |
|---|---|
| `og-image.png` | O cartão do WhatsApp, Slack, LinkedIn, Discord e Twitter |
| `site.webmanifest` | Nome, cores e ícones ao "adicionar à tela de início" |
| `icon-192/512.png` | Os tamanhos que o manifesto exige, em PNG e não SVG |
| `icon-maskable-512.png` | O Android recorta o ícone; sem esta variante, corta a marca |
| `apple-touch-icon.png` | O iOS ignora SVG no atalho da tela de início |
| `favicon.ico` | Navegadores antigos ainda pedem `/favicon.ico` na raiz |
| `robots.txt` + `sitemap.xml` | Gerados no build, com a URL absoluta do deploy |
| `404.html` | CSS, idiomas e temas embutidos: um 404 que depende de outro arquivo quebra duas vezes |

O sitemap lista as vinte e oito páginas, e cada uma declara a contraparte no outro idioma
com `hreflang`. Nada disso é escrito à mão: tudo deriva da tabela de rotas.

Os ícones e o cartão são **gerados**, não desenhados à mão: `scripts/make-icons.mjs`
rasteriza o `favicon.svg` nos tamanhos necessários e `scripts/make-og-image.mjs` fotografa
`scripts/social-card.html`. Os dois usam o Chrome ou o Edge já instalado na máquina, em vez
de trazer `sharp` ou `puppeteer` para o projeto. Os PNGs são versionados, então nada disso
roda no deploy.

### A URL absoluta

Quase tudo no site usa caminho relativo. Três coisas não aceitam relativo, `og:image`,
`canonical` e o `sitemap.xml`, e o endereço só existe depois do deploy. O plugin em
`vite.config.ts` resolve isso em tempo de build, lendo, nesta ordem:

1. `SITE_URL`, se você definir
2. `VERCEL_PROJECT_PRODUCTION_URL`, que a Vercel preenche sozinha
3. o padrão em `src/build/site-url.ts`

```bash
SITE_URL=https://livetest.dev npm run build
```

## Por que nada disto vem de biblioteca

Um site de ferramenta de desenvolvimento que baixa trezentos kilobytes de JavaScript para
animar seis cartões contradiz o próprio produto, que promete não competir por CPU com o seu
editor. O conversor de Markdown, o realce de sintaxe e o motor de busca são código deste
repositório, testado linha a linha, e o que chega ao navegador são ~27 kB de JavaScript e
~31 kB de CSS, uma vez, para o site inteiro.
