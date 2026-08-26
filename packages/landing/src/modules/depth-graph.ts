/**
 * Grafo de dependências interativo da landing.
 *
 * É a seção que explica o diferencial do produto: o visitante escolhe a
 * profundidade (`self`, `direct`, `transitive`) e vê, no mesmo instante, quais
 * arquivos são alcançados e quais testes rodariam.
 *
 * O modelo reproduz as **duas etapas** que o daemon executa, e não uma só:
 *
 * 1. **propagação** — busca em largura sobre as arestas de import, partindo do
 *    arquivo salvo e subindo até a profundidade escolhida. Só arquivos-fonte
 *    participam desta etapa;
 * 2. **mapeamento** — cada fonte alcançado é convertido no seu arquivo de teste
 *    por convenção de nome (`login.ts` → `login.test.ts`).
 *
 * Colapsar as duas em uma só — tratando o teste como um nó alcançável por
 * import — daria resultados errados: `self` não rodaria teste nenhum, porque o
 * teste está a um salto do fonte.
 *
 * A lógica é reimplementada aqui, mínima e sem dependências, porque a página é
 * um artefato estático que não deve carregar o motor inteiro (nem o compilador
 * TypeScript que ele arrasta) para desenhar oito círculos.
 *
 * @packageDocumentation
 */

/** Profundidades oferecidas na demonstração. */
export type Depth = 'self' | 'direct' | 'transitive';

/** Um nó do grafo desenhado. */
export interface GraphNode {
  /** Identificador, também usado como caminho exibido. */
  id: string;
  /** Rótulo curto mostrado dentro do nó. */
  label: string;
  /** `source` para arquivo-fonte, `test` para arquivo de teste. */
  kind: 'source' | 'test';
  /** Posição horizontal, em porcentagem da largura do palco. */
  x: number;
  /** Posição vertical, em porcentagem da altura do palco. */
  y: number;
}

/** Uma ligação entre dois nós. */
export interface GraphEdge {
  /** Origem da ligação. */
  from: string;
  /** Destino da ligação. */
  to: string;
  /**
   * - `import`: `from` importa `to`. É por estas que a propagação caminha.
   * - `covers`: `from` é o arquivo de teste de `to`. Não é percorrida — o
   *   daemon chega ao teste por convenção de nome, não pelo grafo.
   */
  kind: 'import' | 'covers';
}

/** Grafo completo da demonstração. */
export interface Graph {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

/** Um arquivo-fonte alcançado pela propagação. */
export interface ReachedNode {
  id: string;
  /** Distância em arestas até o arquivo salvo (`0` = o próprio). */
  depth: number;
  /** Caminho de importação, do arquivo salvo até este nó. */
  chain: string[];
}

/** Um teste selecionado para rodar. */
export interface SelectedTest {
  /** Arquivo de teste. */
  id: string;
  /** Arquivo-fonte que ele cobre. */
  source: string;
  /** Distância do fonte coberto até o arquivo salvo. */
  depth: number;
  /** Cadeia de importação do arquivo salvo até o fonte coberto. */
  chain: string[];
}

/** Resultado da propagação para uma profundidade. */
export interface ImpactResult {
  /** Fontes alcançados, em ordem crescente de distância. */
  reached: ReachedNode[];
  /** Ids de tudo que acende: os fontes alcançados e os testes selecionados. */
  reachedIds: ReadonlySet<string>;
  /** Ligações que participam do resultado, para animar só elas. */
  activeEdges: GraphEdge[];
  /** Testes que rodariam, ordenados pelo caminho. */
  tests: SelectedTest[];
}

/** Quantos saltos cada profundidade permite. */
export const DEPTH_HOPS: Readonly<Record<Depth, number>> = {
  self: 0,
  direct: 1,
  transitive: Number.POSITIVE_INFINITY,
};

/** Texto curto de cada profundidade, usado nos botões e na legenda. */
export const DEPTH_LABELS: Readonly<Record<Depth, { titulo: string; descricao: string }>> = {
  self: {
    titulo: 'self',
    descricao: 'Roda apenas os testes do arquivo que você salvou.',
  },
  direct: {
    titulo: 'direct',
    descricao: 'Inclui os testes de quem importa esse arquivo diretamente.',
  },
  transitive: {
    titulo: 'transitive',
    descricao: 'Sobe toda a cadeia de importadores, até o topo.',
  },
};

/**
 * Grafo da demonstração: `login` na base, importado por `header` e `footer`,
 * e `layout` um nível acima — o mesmo exemplo usado no PRD e nos testes do core.
 *
 * Cada fonte tem o seu teste ligado por uma aresta `covers`, desenhada mas
 * nunca percorrida pela propagação.
 */
export const DEMO_GRAPH: Graph = {
  nodes: [
    { id: 'src/login.ts', label: 'login.ts', kind: 'source', x: 15, y: 50 },
    { id: 'src/login.test.ts', label: 'login.test.ts', kind: 'test', x: 15, y: 79 },
    { id: 'src/header.ts', label: 'header.ts', kind: 'source', x: 43, y: 21 },
    { id: 'src/header.test.ts', label: 'header.test.ts', kind: 'test', x: 43, y: 47 },
    { id: 'src/footer.ts', label: 'footer.ts', kind: 'source', x: 43, y: 74 },
    { id: 'src/footer.test.ts', label: 'footer.test.ts', kind: 'test', x: 73, y: 74 },
    { id: 'src/layout.ts', label: 'layout.ts', kind: 'source', x: 73, y: 21 },
    { id: 'src/layout.test.ts', label: 'layout.test.ts', kind: 'test', x: 73, y: 47 },
  ],
  edges: [
    { from: 'src/header.ts', to: 'src/login.ts', kind: 'import' },
    { from: 'src/footer.ts', to: 'src/login.ts', kind: 'import' },
    { from: 'src/layout.ts', to: 'src/header.ts', kind: 'import' },

    { from: 'src/login.test.ts', to: 'src/login.ts', kind: 'covers' },
    { from: 'src/header.test.ts', to: 'src/header.ts', kind: 'covers' },
    { from: 'src/footer.test.ts', to: 'src/footer.ts', kind: 'covers' },
    { from: 'src/layout.test.ts', to: 'src/layout.ts', kind: 'covers' },
  ],
};

/** Indexa as arestas de import ao contrário: `arquivo -> quem o importa`. */
function indexarImportadores(graph: Graph): Map<string, string[]> {
  const indice = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'import') continue;
    const lista = indice.get(edge.to);
    if (lista) lista.push(edge.from);
    else indice.set(edge.to, [edge.from]);
  }
  return indice;
}

/** Indexa qual teste cobre cada fonte. */
function indexarCoberturas(graph: Graph): Map<string, string> {
  const indice = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.kind === 'covers') indice.set(edge.to, edge.from);
  }
  return indice;
}

/**
 * Calcula o impacto de alterar um arquivo, para uma profundidade.
 *
 * @param graph - Grafo desenhado na página.
 * @param changed - Arquivo que o visitante "salvou".
 * @param depth - Profundidade escolhida nos botões.
 *
 * @example
 * ```ts
 * computeImpact(DEMO_GRAPH, 'src/login.ts', 'self').tests.map((t) => t.id);
 * // ['src/login.test.ts'] — o teste do próprio arquivo, sempre
 *
 * computeImpact(DEMO_GRAPH, 'src/login.ts', 'direct').tests.length;
 * // 3 — o do próprio arquivo, mais os de header e footer
 * ```
 */
export function computeImpact(graph: Graph, changed: string, depth: Depth): ImpactResult {
  const vazio: ImpactResult = { reached: [], reachedIds: new Set(), activeEdges: [], tests: [] };

  const porId = new Map(graph.nodes.map((node) => [node.id, node]));
  const alvo = porId.get(changed);
  if (!alvo) return vazio;

  // Salvar um arquivo de teste roda ele mesmo: não há fonte a propagar.
  if (alvo.kind === 'test') {
    return {
      reached: [{ id: changed, depth: 0, chain: [changed] }],
      reachedIds: new Set([changed]),
      activeEdges: [],
      tests: [{ id: changed, source: changed, depth: 0, chain: [changed] }],
    };
  }

  // --- Etapa 1: propagar sobre as arestas de import --------------------------
  const importadores = indexarImportadores(graph);
  const maxHops = DEPTH_HOPS[depth];

  const reached: ReachedNode[] = [{ id: changed, depth: 0, chain: [changed] }];
  const vistos = new Set<string>([changed]);
  const activeEdges: GraphEdge[] = [];
  let fronteira: ReachedNode[] = [reached[0] as ReachedNode];

  // A parada real é a fronteira esvaziar; `maxHops` pode ser infinito.
  for (let hop = 1; hop <= maxHops && fronteira.length > 0; hop++) {
    const proxima: ReachedNode[] = [];

    for (const node of fronteira) {
      for (const importador of importadores.get(node.id) ?? []) {
        if (vistos.has(importador)) continue;
        vistos.add(importador);
        activeEdges.push({ from: importador, to: node.id, kind: 'import' });
        proxima.push({ id: importador, depth: hop, chain: [...node.chain, importador] });
      }
    }

    reached.push(...proxima);
    fronteira = proxima;
  }

  // --- Etapa 2: mapear cada fonte alcançado ao seu teste ---------------------
  const coberturas = indexarCoberturas(graph);
  const tests: SelectedTest[] = [];
  const reachedIds = new Set<string>(vistos);

  for (const node of reached) {
    const teste = coberturas.get(node.id);
    if (teste === undefined) continue;
    tests.push({ id: teste, source: node.id, depth: node.depth, chain: node.chain });
    reachedIds.add(teste);
    activeEdges.push({ from: teste, to: node.id, kind: 'covers' });
  }

  tests.sort((a, b) => a.id.localeCompare(b.id));
  return { reached, reachedIds, activeEdges, tests };
}

/** Nome curto de um caminho. */
function nomeCurto(caminho: string): string {
  // `split` sempre devolve ao menos um elemento, então há o que remover.
  return caminho.split('/').pop() as string;
}

/**
 * Descreve, em uma frase, por que um teste entra na execução.
 *
 * É a mesma explicação que o produto imprime no terminal — repeti-la aqui é o
 * ponto da seção: mostrar que a ferramenta sempre justifica o que roda.
 *
 * @example
 * ```ts
 * explainTest({ id: 'src/login.test.ts', source: 'src/login.ts', depth: 0, chain: [...] });
 * // 'cobre login.ts, o arquivo que você salvou'
 *
 * explainTest({ id: 'src/layout.test.ts', source: 'src/layout.ts', depth: 2,
 *               chain: ['src/login.ts', 'src/header.ts', 'src/layout.ts'] });
 * // 'cobre layout.ts, que importa login.ts via header.ts (2 níveis)'
 * ```
 */
export function explainTest(test: SelectedTest): string {
  const alvo = nomeCurto(test.source);
  if (test.depth === 0) {
    return test.id === test.source
      ? 'é o arquivo que você salvou'
      : `cobre ${alvo}, o arquivo que você salvou`;
  }

  const origem = nomeCurto(test.chain[0] as string);
  const intermediarios = test.chain.slice(1, -1).map(nomeCurto);
  const via = intermediarios.length > 0 ? ` via ${intermediarios.join(' → ')}` : '';
  const unidade = test.depth === 1 ? 'nível' : 'níveis';

  return `cobre ${alvo}, que importa ${origem}${via} (${test.depth} ${unidade})`;
}

/**
 * Descreve por que um arquivo-fonte foi alcançado pela propagação.
 *
 * @example
 * ```ts
 * explainReach({ id: 'src/header.ts', depth: 1, chain: ['src/login.ts', 'src/header.ts'] });
 * // 'header.ts importa login.ts (1 nível)'
 * ```
 */
export function explainReach(node: ReachedNode): string {
  if (node.depth === 0) return 'arquivo que você salvou';

  const origem = nomeCurto(node.chain[0] as string);
  const alvo = nomeCurto(node.id);
  const intermediarios = node.chain.slice(1, -1).map(nomeCurto);
  const via = intermediarios.length > 0 ? ` via ${intermediarios.join(' → ')}` : '';
  const unidade = node.depth === 1 ? 'nível' : 'níveis';

  return `${alvo} importa ${origem}${via} (${node.depth} ${unidade})`;
}
