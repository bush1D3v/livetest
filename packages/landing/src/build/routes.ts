/**
 * O mapa do site: quais paginas existem, onde ficam e como se chamam.
 *
 * Tudo que o build precisa saber sobre estrutura esta aqui, e em nenhum outro
 * lugar. O sitemap, o menu lateral, o cabecalho, os links de pagina anterior e
 * seguinte e o indice de busca sao todos derivados desta tabela, o que torna
 * impossivel adicionar uma pagina e esquecer de lista-la em algum deles.
 *
 * O ingles mora na raiz e o portugues sob `/pt/`. As rotas sao as mesmas nos
 * dois idiomas, entao cada pagina tem exatamente uma contraparte, e o seletor de
 * idioma nunca joga ninguem de volta para a home.
 *
 * @packageDocumentation
 */

import type { Locale } from '../modules/i18n.js';

/** Uma pagina de documentacao. */
export interface Pagina {
  /** Rota sem idioma. `''` e a home. */
  rota: string;
  /** Arquivo em `content/<idioma>/`. */
  arquivo: string;
  /** Peso no sitemap. */
  prioridade: number;
}

/** Um item do menu lateral. */
export interface ItemDeMenu {
  /** Rota da pagina. */
  rota: string;
  /** Como o item aparece no menu. */
  rotulo: string;
  /**
   * Prefixo que marca o item como ativo no cabecalho.
   *
   * O link "Guia" aponta para a introducao, mas segue aceso em qualquer pagina
   * do guia. Sem o prefixo, so a propria rota acende.
   */
  prefixo?: string;
}

/** Um grupo do menu lateral. */
export interface GrupoDeMenu {
  /** Titulo do grupo. */
  titulo: string;
  /** Paginas do grupo, na ordem de leitura. */
  itens: readonly ItemDeMenu[];
}

/** Todas as paginas de documentacao, na ordem de leitura. */
export const PAGINAS_DOC: readonly Pagina[] = [
  { rota: 'guide/introduction', arquivo: 'guide/introduction.md', prioridade: 0.9 },
  { rota: 'guide/getting-started', arquivo: 'guide/getting-started.md', prioridade: 0.9 },
  { rota: 'guide/how-it-works', arquivo: 'guide/how-it-works.md', prioridade: 0.8 },
  { rota: 'guide/comparison', arquivo: 'guide/comparison.md', prioridade: 0.7 },
  { rota: 'guide/depth', arquivo: 'guide/depth.md', prioridade: 0.8 },
  { rota: 'guide/ai-agents', arquivo: 'guide/ai-agents.md', prioridade: 0.8 },
  { rota: 'guide/vscode', arquivo: 'guide/vscode.md', prioridade: 0.7 },
  { rota: 'guide/adapters', arquivo: 'guide/adapters.md', prioridade: 0.7 },
  { rota: 'reference/config', arquivo: 'reference/config.md', prioridade: 0.9 },
  { rota: 'reference/cli', arquivo: 'reference/cli.md', prioridade: 0.8 },
  { rota: 'reference/api', arquivo: 'reference/api.md', prioridade: 0.7 },
  { rota: 'reference/protocol', arquivo: 'reference/protocol.md', prioridade: 0.7 },
  { rota: 'changelog', arquivo: 'changelog.md', prioridade: 0.5 },
];

/** Textos que aparecem na moldura da pagina, fora do conteudo. */
export interface Textos {
  /** Nome do idioma no seletor. */
  idioma: string;
  /** Rotulo do seletor de idioma. */
  trocarIdioma: string;
  /** Rotulo do seletor de tema. */
  trocarTema: string;
  /** Nome de cada tema, na ordem clara, escura, sistema. */
  temas: readonly [string, string, string];
  /** Texto do campo de busca. */
  buscar: string;
  /** Texto longo do campo de busca, lido por leitor de tela. */
  buscarDescricao: string;
  /** Mostrado quando a busca nao acha nada. */
  semResultados: string;
  /** Ajuda de teclado no rodape da busca. */
  dicasDeBusca: readonly [string, string, string];
  /** Botao de instalar, no cabecalho. */
  instalar: string;
  /** Link do repositorio. */
  repositorio: string;
  /** Titulo do indice lateral direito. */
  nestaPagina: string;
  /** Link para a pagina anterior. */
  anterior: string;
  /** Link para a proxima pagina. */
  proxima: string;
  /** Rotulo do botao que abre o menu no celular. */
  menu: string;
  /** Rotulo da navegacao principal, lido por leitor de tela. */
  navegacao: string;
  /** Aviso de que a pagina foi traduzida automaticamente pelo navegador. */
  editarPagina: string;
  /** Grupos do menu lateral. */
  menuLateral: readonly GrupoDeMenu[];
  /** Links do cabecalho. */
  cabecalho: readonly ItemDeMenu[];
  /** Colunas do rodape. */
  rodape: readonly { titulo: string; links: readonly { rotulo: string; href: string }[] }[];
  /** Linha final do rodape. */
  licenca: string;
}

/** Endereco dos pacotes e do repositorio, iguais nos dois idiomas. */
export const LINKS = {
  github: 'https://github.com/bush1D3v/livetest',
  issues: 'https://github.com/bush1D3v/livetest/issues',
  licenca: 'https://github.com/bush1D3v/livetest/blob/master/LICENSE',
  npmCore: 'https://www.npmjs.com/package/@livetest/core',
  npmCli: 'https://www.npmjs.com/package/@livetest/cli',
  marketplace: 'https://marketplace.visualstudio.com/items?itemName=livetest.livetest-vscode',
} as const;

const MENU_EN: readonly GrupoDeMenu[] = [
  {
    titulo: 'Introduction',
    itens: [
      { rota: 'guide/introduction', rotulo: 'What is livetest' },
      { rota: 'guide/getting-started', rotulo: 'Getting started' },
      { rota: 'guide/how-it-works', rotulo: 'How it works' },
      { rota: 'guide/comparison', rotulo: 'Comparison' },
    ],
  },
  {
    titulo: 'Guide',
    itens: [
      { rota: 'guide/depth', rotulo: 'Propagation depth' },
      { rota: 'guide/ai-agents', rotulo: 'AI agents' },
      { rota: 'guide/vscode', rotulo: 'VSCode extension' },
      { rota: 'guide/adapters', rotulo: 'Writing an adapter' },
    ],
  },
  {
    titulo: 'Reference',
    itens: [
      { rota: 'reference/config', rotulo: 'Configuration' },
      { rota: 'reference/cli', rotulo: 'CLI' },
      { rota: 'reference/api', rotulo: 'Core API' },
      { rota: 'reference/protocol', rotulo: 'Event protocol' },
    ],
  },
  {
    titulo: 'Project',
    itens: [{ rota: 'changelog', rotulo: 'Changelog' }],
  },
];

const MENU_PT: readonly GrupoDeMenu[] = [
  {
    titulo: 'Introdução',
    itens: [
      { rota: 'guide/introduction', rotulo: 'O que é o livetest' },
      { rota: 'guide/getting-started', rotulo: 'Primeiros passos' },
      { rota: 'guide/how-it-works', rotulo: 'Como funciona' },
      { rota: 'guide/comparison', rotulo: 'Comparativo' },
    ],
  },
  {
    titulo: 'Guia',
    itens: [
      { rota: 'guide/depth', rotulo: 'Profundidade de propagação' },
      { rota: 'guide/ai-agents', rotulo: 'Agentes de IA' },
      { rota: 'guide/vscode', rotulo: 'Extensão do VSCode' },
      { rota: 'guide/adapters', rotulo: 'Escrevendo um adapter' },
    ],
  },
  {
    titulo: 'Referência',
    itens: [
      { rota: 'reference/config', rotulo: 'Configuração' },
      { rota: 'reference/cli', rotulo: 'CLI' },
      { rota: 'reference/api', rotulo: 'API do core' },
      { rota: 'reference/protocol', rotulo: 'Protocolo de eventos' },
    ],
  },
  {
    titulo: 'Projeto',
    itens: [{ rota: 'changelog', rotulo: 'Changelog' }],
  },
];

/** Textos da moldura, por idioma. */
export const TEXTOS: Readonly<Record<Locale, Textos>> = {
  en: {
    idioma: 'English',
    trocarIdioma: 'Change language',
    trocarTema: 'Change theme',
    temas: ['Light', 'Dark', 'System'],
    buscar: 'Search',
    buscarDescricao: 'Search the documentation',
    semResultados: 'No results for',
    dicasDeBusca: ['to select', 'to navigate', 'to close'],
    instalar: 'Install',
    repositorio: 'GitHub repository',
    nestaPagina: 'On this page',
    anterior: 'Previous',
    proxima: 'Next',
    menu: 'Menu',
    navegacao: 'Main navigation',
    editarPagina: 'Edit this page on GitHub',
    menuLateral: MENU_EN,
    cabecalho: [
      { rota: 'guide/introduction', rotulo: 'Guide', prefixo: 'guide/' },
      { rota: 'reference/config', rotulo: 'Config' },
      { rota: 'reference/api', rotulo: 'API' },
      { rota: 'changelog', rotulo: 'Changelog' },
    ],
    rodape: [
      {
        titulo: 'Documentation',
        links: [
          { rotulo: 'Getting started', href: '/guide/getting-started' },
          { rotulo: 'Configuration', href: '/reference/config' },
          { rotulo: 'AI agents', href: '/guide/ai-agents' },
          { rotulo: 'Event protocol', href: '/reference/protocol' },
        ],
      },
      {
        titulo: 'Packages',
        links: [
          { rotulo: '@livetest/cli', href: LINKS.npmCli },
          { rotulo: '@livetest/core', href: LINKS.npmCore },
          { rotulo: 'VSCode extension', href: LINKS.marketplace },
        ],
      },
      {
        titulo: 'Project',
        links: [
          { rotulo: 'Source on GitHub', href: LINKS.github },
          { rotulo: 'Report an issue', href: LINKS.issues },
          { rotulo: 'Changelog', href: '/changelog' },
          { rotulo: 'MIT license', href: LINKS.licenca },
        ],
      },
    ],
    licenca: 'Released under the MIT license.',
  },
  pt: {
    idioma: 'Português',
    trocarIdioma: 'Trocar de idioma',
    trocarTema: 'Trocar de tema',
    temas: ['Claro', 'Escuro', 'Sistema'],
    buscar: 'Buscar',
    buscarDescricao: 'Buscar na documentação',
    semResultados: 'Nenhum resultado para',
    dicasDeBusca: ['para abrir', 'para navegar', 'para fechar'],
    instalar: 'Instalar',
    repositorio: 'Repositório no GitHub',
    nestaPagina: 'Nesta página',
    anterior: 'Anterior',
    proxima: 'Próxima',
    menu: 'Menu',
    navegacao: 'Navegação principal',
    editarPagina: 'Editar esta página no GitHub',
    menuLateral: MENU_PT,
    cabecalho: [
      { rota: 'guide/introduction', rotulo: 'Guia', prefixo: 'guide/' },
      { rota: 'reference/config', rotulo: 'Configuração' },
      { rota: 'reference/api', rotulo: 'API' },
      { rota: 'changelog', rotulo: 'Changelog' },
    ],
    rodape: [
      {
        titulo: 'Documentação',
        links: [
          { rotulo: 'Primeiros passos', href: '/guide/getting-started' },
          { rotulo: 'Configuração', href: '/reference/config' },
          { rotulo: 'Agentes de IA', href: '/guide/ai-agents' },
          { rotulo: 'Protocolo de eventos', href: '/reference/protocol' },
        ],
      },
      {
        titulo: 'Pacotes',
        links: [
          { rotulo: '@livetest/cli', href: LINKS.npmCli },
          { rotulo: '@livetest/core', href: LINKS.npmCore },
          { rotulo: 'Extensão do VSCode', href: LINKS.marketplace },
        ],
      },
      {
        titulo: 'Projeto',
        links: [
          { rotulo: 'Código no GitHub', href: LINKS.github },
          { rotulo: 'Relatar um problema', href: LINKS.issues },
          { rotulo: 'Changelog', href: '/changelog' },
          { rotulo: 'Licença MIT', href: LINKS.licenca },
        ],
      },
    ],
    licenca: 'Publicado sob a licença MIT.',
  },
};

/**
 * Achata o menu lateral na ordem de leitura.
 *
 * E dessa lista que saem os links de pagina anterior e seguinte, o que garante
 * que a sequencia mostrada no rodape do texto e a mesma que o menu sugere.
 *
 * @example
 * ```ts
 * ordemDeLeitura(TEXTOS.en)[0]?.rota; // 'guide/introduction'
 * ```
 */
export function ordemDeLeitura(textos: Textos): ItemDeMenu[] {
  return textos.menuLateral.flatMap((grupo) => [...grupo.itens]);
}

/**
 * Acha a pagina anterior e a seguinte de uma rota.
 *
 * @param textos - Textos do idioma, de onde sai a ordem.
 * @param rota - Rota da pagina atual.
 */
export function vizinhas(
  textos: Textos,
  rota: string,
): { anterior: ItemDeMenu | null; proxima: ItemDeMenu | null } {
  const ordem = ordemDeLeitura(textos);
  const onde = ordem.findIndex((item) => item.rota === rota);
  if (onde === -1) return { anterior: null, proxima: null };
  return { anterior: ordem[onde - 1] ?? null, proxima: ordem[onde + 1] ?? null };
}

/**
 * Caminho relativo que leva de uma rota a outra.
 *
 * O site nao assume onde esta hospedado: pode estar na raiz de um dominio, em um
 * subdiretorio, ou aberto direto do disco. Por isso nenhum link e absoluto, e
 * cada um e calculado a partir da profundidade das duas pontas.
 *
 * @param de - Rota completa da pagina atual, com idioma. `''` e a raiz.
 * @param para - Rota completa do destino, com idioma.
 *
 * @example
 * ```ts
 * caminhoRelativo('pt/guide/depth', 'pt/reference/config'); // '../reference/config/'
 * caminhoRelativo('guide/depth', '');                       // '../../'
 * ```
 */
export function caminhoRelativo(de: string, para: string): string {
  const daqui = de === '' ? [] : de.split('/');
  const ate = para === '' ? [] : para.split('/');

  let comum = 0;
  while (comum < daqui.length && comum < ate.length && daqui[comum] === ate[comum]) comum++;

  const sobe = '../'.repeat(daqui.length - comum);
  const desce = ate.slice(comum).join('/');

  const caminho = `${sobe}${desce}${desce === '' ? '' : '/'}`;
  return caminho === '' ? './' : caminho;
}
