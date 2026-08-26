import { describe, expect, it } from 'vitest';

import {
  DEMO_GRAPH,
  DEPTH_HOPS,
  DEPTH_LABELS,
  computeImpact,
  explainReach,
  explainTest,
  type Graph,
} from '../src/modules/depth-graph.js';

/** Nomes curtos e ordenados, para asserts legíveis. */
const nomes = (ids: readonly string[]): string[] =>
  ids.map((id) => id.split('/').pop() ?? id).sort();

/** Ids dos testes selecionados. */
const idsDosTestes = (resultado: ReturnType<typeof computeImpact>): string[] =>
  resultado.tests.map((teste) => teste.id);

describe('DEPTH_HOPS e DEPTH_LABELS', () => {
  it('mapeia cada profundidade para os saltos corretos', () => {
    expect(DEPTH_HOPS).toEqual({ self: 0, direct: 1, transitive: Number.POSITIVE_INFINITY });
  });

  it('descreve as três profundidades', () => {
    expect(Object.keys(DEPTH_LABELS)).toEqual(['self', 'direct', 'transitive']);
    for (const rotulo of Object.values(DEPTH_LABELS)) {
      expect(rotulo.descricao.length).toBeGreaterThan(10);
    }
  });
});

/**
 * Os números aqui vêm dos testes do core (`packages/core/test/planner`), sobre
 * o mesmo projeto de exemplo. A demonstração da landing tem de dar exatamente
 * o mesmo resultado que o daemon daria — se divergir, a página está mentindo.
 */
describe('computeImpact — paridade com o produto', () => {
  it('self roda o teste do próprio arquivo salvo', () => {
    const impacto = computeImpact(DEMO_GRAPH, 'src/login.ts', 'self');
    expect(idsDosTestes(impacto)).toEqual(['src/login.test.ts']);
  });

  it('direct inclui os testes dos importadores diretos', () => {
    const impacto = computeImpact(DEMO_GRAPH, 'src/login.ts', 'direct');
    expect(idsDosTestes(impacto)).toEqual([
      'src/footer.test.ts',
      'src/header.test.ts',
      'src/login.test.ts',
    ]);
  });

  it('transitive sobe a cadeia inteira', () => {
    const impacto = computeImpact(DEMO_GRAPH, 'src/login.ts', 'transitive');
    expect(idsDosTestes(impacto)).toEqual([
      'src/footer.test.ts',
      'src/header.test.ts',
      'src/layout.test.ts',
      'src/login.test.ts',
    ]);
  });

  it('a lista de testes cresce a cada profundidade', () => {
    const contar = (depth: 'self' | 'direct' | 'transitive'): number =>
      computeImpact(DEMO_GRAPH, 'src/login.ts', depth).tests.length;
    expect([contar('self'), contar('direct'), contar('transitive')]).toEqual([1, 3, 4]);
  });
});

describe('computeImpact — propagação', () => {
  it('self alcança apenas o próprio arquivo-fonte', () => {
    const impacto = computeImpact(DEMO_GRAPH, 'src/login.ts', 'self');
    expect(impacto.reached.map((node) => node.id)).toEqual(['src/login.ts']);
  });

  it('acende o fonte alcançado e o teste que o cobre', () => {
    const impacto = computeImpact(DEMO_GRAPH, 'src/login.ts', 'self');
    expect(nomes([...impacto.reachedIds])).toEqual(['login.test.ts', 'login.ts']);
  });

  it('direct alcança os importadores diretos', () => {
    const impacto = computeImpact(DEMO_GRAPH, 'src/login.ts', 'direct');
    expect(nomes(impacto.reached.map((node) => node.id))).toEqual([
      'footer.ts',
      'header.ts',
      'login.ts',
    ]);
  });

  it('registra a distância de cada fonte alcançado', () => {
    const impacto = computeImpact(DEMO_GRAPH, 'src/login.ts', 'transitive');
    const porId = new Map(impacto.reached.map((node) => [node.id, node.depth]));
    expect(porId.get('src/login.ts')).toBe(0);
    expect(porId.get('src/header.ts')).toBe(1);
    expect(porId.get('src/layout.ts')).toBe(2);
  });

  it('registra a cadeia de importação', () => {
    const impacto = computeImpact(DEMO_GRAPH, 'src/login.ts', 'transitive');
    const layout = impacto.reached.find((node) => node.id === 'src/layout.ts');
    expect(layout?.chain).toEqual(['src/login.ts', 'src/header.ts', 'src/layout.ts']);
  });

  it('não percorre as arestas de cobertura', () => {
    // `login.test.ts` cobre `login.ts`, mas isso não é um import: seguir essa
    // aresta faria a propagação vazar do grafo de fontes para o de testes.
    const impacto = computeImpact(DEMO_GRAPH, 'src/login.ts', 'transitive');
    const fontes = impacto.reached.map((node) => node.id);
    expect(fontes).not.toContain('src/login.test.ts');
  });

  it('marca as arestas de import percorridas e as coberturas usadas', () => {
    const impacto = computeImpact(DEMO_GRAPH, 'src/login.ts', 'direct');
    const imports = impacto.activeEdges.filter((edge) => edge.kind === 'import');
    const covers = impacto.activeEdges.filter((edge) => edge.kind === 'covers');

    expect(imports).toHaveLength(2);
    expect(imports.every((edge) => edge.to === 'src/login.ts')).toBe(true);
    expect(covers).toHaveLength(3);
  });

  it('devolve os testes em ordem estável', () => {
    const ids = idsDosTestes(computeImpact(DEMO_GRAPH, 'src/login.ts', 'transitive'));
    expect(ids).toEqual([...ids].sort());
  });
});

describe('computeImpact — bordas', () => {
  it('devolve vazio para arquivo fora do grafo', () => {
    const impacto = computeImpact(DEMO_GRAPH, 'src/inexistente.ts', 'transitive');
    expect(impacto).toEqual({ reached: [], reachedIds: new Set(), activeEdges: [], tests: [] });
  });

  it('salvar um arquivo de teste roda ele mesmo', () => {
    const impacto = computeImpact(DEMO_GRAPH, 'src/header.test.ts', 'transitive');
    expect(idsDosTestes(impacto)).toEqual(['src/header.test.ts']);
    expect(impacto.activeEdges).toEqual([]);
  });

  it('não entra em laço com dependência circular', () => {
    const circular: Graph = {
      nodes: [
        { id: 'a.ts', label: 'a', kind: 'source', x: 20, y: 20 },
        { id: 'b.ts', label: 'b', kind: 'source', x: 60, y: 20 },
      ],
      edges: [
        { from: 'a.ts', to: 'b.ts', kind: 'import' },
        { from: 'b.ts', to: 'a.ts', kind: 'import' },
      ],
    };
    const impacto = computeImpact(circular, 'a.ts', 'transitive');
    expect(impacto.reached.map((node) => node.id)).toEqual(['a.ts', 'b.ts']);
  });

  it('fonte sem teste não gera execução', () => {
    const semTeste: Graph = {
      nodes: [{ id: 'a.ts', label: 'a', kind: 'source', x: 20, y: 20 }],
      edges: [],
    };
    const impacto = computeImpact(semTeste, 'a.ts', 'transitive');
    expect(impacto.reached).toHaveLength(1);
    expect(impacto.tests).toEqual([]);
  });

  it('ignora aresta de import vinda de nó desconhecido sem quebrar', () => {
    const solto: Graph = {
      nodes: [{ id: 'a.ts', label: 'a', kind: 'source', x: 20, y: 20 }],
      edges: [{ from: 'fantasma.ts', to: 'a.ts', kind: 'import' }],
    };
    const impacto = computeImpact(solto, 'a.ts', 'transitive');
    expect(impacto.reachedIds.has('fantasma.ts')).toBe(true);
    expect(impacto.tests).toEqual([]);
  });

  it('trata folha sem importadores', () => {
    const impacto = computeImpact(DEMO_GRAPH, 'src/layout.ts', 'transitive');
    expect(idsDosTestes(impacto)).toEqual(['src/layout.test.ts']);
  });
});

describe('explainTest', () => {
  it('descreve o teste do arquivo salvo', () => {
    expect(
      explainTest({
        id: 'src/login.test.ts',
        source: 'src/login.ts',
        depth: 0,
        chain: ['src/login.ts'],
      }),
    ).toBe('cobre login.ts, o arquivo que você salvou');
  });

  it('descreve um importador direto', () => {
    expect(
      explainTest({
        id: 'src/header.test.ts',
        source: 'src/header.ts',
        depth: 1,
        chain: ['src/login.ts', 'src/header.ts'],
      }),
    ).toBe('cobre header.ts, que importa login.ts (1 nível)');
  });

  it('descreve a cadeia intermediária', () => {
    expect(
      explainTest({
        id: 'src/layout.test.ts',
        source: 'src/layout.ts',
        depth: 2,
        chain: ['src/login.ts', 'src/header.ts', 'src/layout.ts'],
      }),
    ).toBe('cobre layout.ts, que importa login.ts via header.ts (2 níveis)');
  });

  it('descreve o teste que foi ele próprio salvo', () => {
    expect(
      explainTest({
        id: 'src/a.test.ts',
        source: 'src/a.test.ts',
        depth: 0,
        chain: ['src/a.test.ts'],
      }),
    ).toBe('é o arquivo que você salvou');
  });
});

describe('explainReach', () => {
  it('descreve o arquivo salvo', () => {
    expect(explainReach({ id: 'src/login.ts', depth: 0, chain: ['src/login.ts'] })).toBe(
      'arquivo que você salvou',
    );
  });

  it('descreve um importador direto', () => {
    expect(
      explainReach({
        id: 'src/header.ts',
        depth: 1,
        chain: ['src/login.ts', 'src/header.ts'],
      }),
    ).toBe('header.ts importa login.ts (1 nível)');
  });

  it('descreve a cadeia intermediária', () => {
    expect(
      explainReach({
        id: 'src/layout.ts',
        depth: 2,
        chain: ['src/login.ts', 'src/header.ts', 'src/layout.ts'],
      }),
    ).toBe('layout.ts importa login.ts via header.ts (2 níveis)');
  });

  it('lida com caminho sem barra', () => {
    expect(explainReach({ id: 'a.ts', depth: 1, chain: ['b.ts', 'a.ts'] })).toBe(
      'a.ts importa b.ts (1 nível)',
    );
  });
});

describe('DEMO_GRAPH — enquadramento no palco', () => {
  /**
   * Os nós são posicionados em porcentagem e centralizados com
   * `translate(-50%, -50%)`: metade do chip fica para fora da coordenada. Um nó
   * próximo demais da borda vaza o palco — foi o que aconteceu com
   * `footer.test.ts` em y=96.
   */
  const MARGEM = { min: 14, max: 80 };

  it.each(DEMO_GRAPH.nodes.map((node) => [node.label, node] as const))(
    '%s fica dentro da faixa segura',
    (_label, node) => {
      expect(node.x).toBeGreaterThanOrEqual(MARGEM.min);
      expect(node.x).toBeLessThanOrEqual(MARGEM.max);
      expect(node.y).toBeGreaterThanOrEqual(MARGEM.min);
      expect(node.y).toBeLessThanOrEqual(MARGEM.max);
    },
  );

  it('não empilha dois nós na mesma coordenada', () => {
    const posicoes = DEMO_GRAPH.nodes.map((node) => `${node.x},${node.y}`);
    expect(new Set(posicoes).size).toBe(posicoes.length);
  });

  it('toda aresta liga dois nós declarados', () => {
    const ids = new Set(DEMO_GRAPH.nodes.map((node) => node.id));
    for (const edge of DEMO_GRAPH.edges) {
      expect(ids.has(edge.from), `origem ausente: ${edge.from}`).toBe(true);
      expect(ids.has(edge.to), `destino ausente: ${edge.to}`).toBe(true);
    }
  });

  it('todo arquivo-fonte tem exatamente um teste que o cobre', () => {
    const fontes = DEMO_GRAPH.nodes.filter((node) => node.kind === 'source');
    for (const fonte of fontes) {
      const covers = DEMO_GRAPH.edges.filter(
        (edge) => edge.kind === 'covers' && edge.to === fonte.id,
      );
      expect(covers, `cobertura ausente ou duplicada: ${fonte.id}`).toHaveLength(1);
    }
  });

  it('todo arquivo de teste cobre o fonte de nome correspondente', () => {
    for (const edge of DEMO_GRAPH.edges) {
      if (edge.kind !== 'covers') continue;
      expect(edge.from).toBe(edge.to.replace('.ts', '.test.ts'));
    }
  });

  it('nenhuma aresta de import parte de um arquivo de teste', () => {
    const testes = new Set(
      DEMO_GRAPH.nodes.filter((node) => node.kind === 'test').map((node) => node.id),
    );
    for (const edge of DEMO_GRAPH.edges) {
      if (edge.kind !== 'import') continue;
      expect(testes.has(edge.from), `import saindo de teste: ${edge.from}`).toBe(false);
    }
  });
});
