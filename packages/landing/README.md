# `@livetest/landing`

Landing page do [Live Test Runner](../../README.md). Site estático, construído com
Vite, **sem uma única dependência em runtime** — o que você baixa é HTML, CSS e um
bundle de ~20 kB.

```bash
npm run dev             # servidor de desenvolvimento
npm run build           # gera dist/ (inclui robots.txt e sitemap.xml)
npm run preview         # serve o dist/
npm test                # 194 testes, 100% de cobertura

npm run build:assets    # regenera ícones e cartão social (só quando a marca muda)
npm run build:standalone # a página inteira em um arquivo só
```

## O argumento da página

Marketing de ferramenta de teste erra quase sempre do mesmo jeito: lista recursos.
Esta página faz o contrário — ela **encena o problema** antes de oferecer a solução, e
depois deixa o visitante *provar* a solução sozinho.

| Seção | O que ela precisa conseguir |
|---|---|
| Hero | Um terminal que roda de verdade, mostrando o motivo de cada teste ter rodado |
| O problema | Nomear a dor em duas frases: detecção tardia e escopo subestimado |
| **Como funciona** | O visitante troca a profundidade e vê o grafo reagir — é a peça central |
| Para agentes | Mostrar que a saída foi desenhada para ser lida por IA, com exemplos reais |
| Comparativo | Ser honesto: dizer onde as outras ferramentas também acertam |
| Começar | Três comandos, sem promessa de "configuração zero" que não se cumpre |

A seção do grafo não é ilustração: ela reproduz as **duas etapas** que o daemon
executa, e não uma só — propagação em largura sobre as arestas de *import*, depois
mapeamento de cada fonte alcançado ao seu teste por convenção de nome. Colapsar as
duas daria resultados errados: `self` não rodaria teste nenhum, porque o teste está a
um salto do fonte.

Os números que a página mostra são verificados contra os testes do core sobre o mesmo
projeto de exemplo — 1, 3 e 4 arquivos de teste. Se divergirem, a suíte reprova: uma
página que mente sobre o produto é pior que nenhuma página.

## Arquitetura

```
src/
  modules/      lógica pura, sem DOM — testada isoladamente
    typewriter    máquina de estados do terminal, dirigida por tempo
    depth-graph   propagação no grafo reverso + o grafo da demonstração
    highlight     realce de sintaxe em ~120 linhas (jsonc, bash, saída)
    motion        laço de quadros e prefers-reduced-motion
    reveal        revelação por IntersectionObserver
    clipboard     cópia com caminho alternativo
    tabs          estado de grupos de abas
  setup/        ligação com o DOM — uma função por comportamento
  build/        código de build: URL do site, robots.txt e sitemap.xml
  styles/       tokens, fundo, barra de rolagem, componentes, seções, animações
  main.ts       fiação
```

A divisão existe por uma razão prática: **`modules/` não toca no DOM**, então roda em
milissegundos no ambiente `node`. Só os testes de `setup/` pedem jsdom, e eles pedem
explicitamente, com `@vitest-environment jsdom` no topo do arquivo — o jsdom leva ~15 s
para subir e não deve pesar sobre a suíte inteira.

## Animações

Todas escrevem apenas `transform`, `opacity` e variáveis CSS — nenhuma provoca reflow
durante a rolagem. São elas: malha de pontos à deriva, duas auroras que respiram,
brilho que segue o cursor, barra de progresso de leitura, revelação por rolagem,
digitação do terminal, arestas do grafo com fluxo animado e halo nos cartões de
recurso. A barra de rolagem também é estilizada — a do sistema seria a única coisa
clara em uma página escura.

`prefers-reduced-motion: reduce` desliga **todas** elas e entrega a página inteira,
estática e completa — nunca escondida. É o mesmo princípio da ferramenta: degradar,
não sumir.

## SEO, compartilhamento e instalação

O que um link precisa para não parecer um rascunho quando alguém o cola em algum
lugar:

| Arquivo | Para quê |
|---|---|
| `og-image.png` | O cartão do WhatsApp, Slack, LinkedIn, Discord e Twitter |
| `site.webmanifest` | Nome, cores e ícones ao "adicionar à tela de início" |
| `icon-192/512.png` | Os tamanhos que o manifesto exige — PNG, não SVG |
| `icon-maskable-512.png` | O Android recorta o ícone; sem esta variante, corta a marca |
| `apple-touch-icon.png` | O iOS ignora SVG no atalho da tela de início |
| `favicon.ico` | Navegadores antigos ainda pedem `/favicon.ico` na raiz |
| `robots.txt` + `sitemap.xml` | Gerados no build, com a URL absoluta do deploy |
| `404.html` | CSS embutido: um 404 que depende de outro arquivo quebra duas vezes |

Os ícones e o cartão são **gerados**, não desenhados à mão: `scripts/make-icons.mjs`
rasteriza o `favicon.svg` nos tamanhos necessários e `scripts/make-og-image.mjs`
fotografa `scripts/social-card.html`. Os dois usam o Chrome ou o Edge já instalado na
máquina, em vez de trazer `sharp` ou `puppeteer` para o projeto — os PNGs são
versionados, então nada disso roda no deploy.

O cartão social é HTML de verdade, e não um PNG opaco: dá para abrir
`scripts/social-card.html` no navegador, ajustar, e rodar `npm run build:og`.

### A URL absoluta

Quase tudo na página usa caminho relativo, para que ela funcione aberta do disco ou em
qualquer subdiretório. Três coisas não aceitam relativo — `og:image`, `canonical` e o
`sitemap.xml` — e o endereço só existe depois do deploy. O plugin em `vite.config.ts`
resolve isso em tempo de build, lendo, nesta ordem:

1. `SITE_URL`, se você definir
2. `VERCEL_PROJECT_PRODUCTION_URL`, que a Vercel preenche sozinha (inclusive com
   domínio próprio)
3. o padrão em `src/build/site-url.ts`

```bash
SITE_URL=https://livetest.dev npm run build
```

## Por que não há biblioteca de animação nem de highlight

Uma landing de ferramenta de desenvolvimento que baixa 300 kB de JavaScript para
animar seis cartões contradiz o próprio produto, que promete não competir por CPU com
o seu editor. O realce de sintaxe tem 120 linhas testadas; o motor de animação é uma
função que recebe um delta em milissegundos.
