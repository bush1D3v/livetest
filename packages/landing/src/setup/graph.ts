/**
 * Grafo de dependencias interativo.
 *
 * Desenha os nos e as arestas, e refaz o realce a cada troca de profundidade.
 * A decisao de o que acende fica em `modules/depth-graph.ts`; aqui so ha DOM.
 *
 * @packageDocumentation
 */

import {
  DEMO_GRAPH,
  DEPTH_LABELS,
  computeImpact,
  explainTest,
  type Depth,
  type Graph,
} from '../modules/depth-graph.js';
import { highlight } from '../modules/highlight.js';

/** Arquivo que o visitante "salva" na demonstracao. */
const ARQUIVO_ALTERADO = 'src/login.ts';

/** Profundidades na ordem dos botoes. */
const ORDEM: readonly Depth[] = ['self', 'direct', 'transitive'];

/** Configuracao mostrada ao lado, por profundidade. */
export function configFor(depth: Depth): string {
  if (depth === 'direct') {
    return [
      '{',
      '  "dependencyDepth": {',
      '    "default": "direct"',
      '  }',
      '}',
    ].join('\n');
  }

  return [
    '{',
    '  "dependencyDepth": {',
    '    "default": "direct",',
    '    "overrides": {',
    `      "src/login.ts": "${depth}"`,
    '    }',
    '  }',
    '}',
  ].join('\n');
}

/** Legenda que resume o resultado. */
export function captionFor(depth: Depth, total: number): string {
  const { descricao } = DEPTH_LABELS[depth];
  const plural = total === 1 ? 'arquivo de teste' : 'arquivos de teste';
  return `${descricao} Salvar <strong>login.ts</strong> roda <strong>${total} ${plural}</strong>.`;
}

/** Opcoes de {@link setupGraph}. */
export interface GraphOptions {
  root?: ParentNode;
  graph?: Graph;
  /** Profundidade inicial. @defaultValue `'direct'` */
  initial?: Depth;
}

/** Grafo montado. */
export interface GraphDemo {
  /** Troca a profundidade exibida. */
  select(depth: Depth): void;
  /** Profundidade atual. */
  current(): Depth;
  /** `true` quando o palco foi encontrado e desenhado. */
  readonly mounted: boolean;
}

/**
 * Monta o grafo interativo.
 *
 * @example
 * ```ts
 * const demo = setupGraph();
 * demo.select('transitive');
 * ```
 */
export function setupGraph(options: GraphOptions = {}): GraphDemo {
  const root = options.root ?? document;
  const graph = options.graph ?? DEMO_GRAPH;

  const caixaNos = root.querySelector<HTMLElement>('[data-graph-nodes]');
  const caixaArestas = root.querySelector<SVGGElement>('[data-graph-edges]');
  const legenda = root.querySelector<HTMLElement>('[data-graph-caption]');
  const listaTestes = root.querySelector<HTMLElement>('[data-graph-tests]');
  const bloco = root.querySelector<HTMLElement>('[data-graph-config]');
  const botoes = [...root.querySelectorAll<HTMLElement>('[data-depth]')];

  if (!caixaNos || !caixaArestas || !legenda || !listaTestes) {
    return { select: () => {}, current: () => 'direct', mounted: false };
  }

  // Referencias ja verificadas, para o compilador nao reclamar dentro do closure.
  const alvoLegenda = legenda;
  const alvoTestes = listaTestes;

  const svg = caixaArestas.ownerSVGElement;
  const ns = 'http://www.w3.org/2000/svg';

  // Gradiente das arestas ativas, declarado uma vez.
  if (svg && !svg.querySelector('#edge-gradient')) {
    const defs = document.createElementNS(ns, 'defs');
    const grad = document.createElementNS(ns, 'linearGradient');
    grad.setAttribute('id', 'edge-gradient');
    grad.setAttribute('x1', '0');
    grad.setAttribute('x2', '1');
    for (const [offset, cor] of [
      ['0%', '#22d3ee'],
      ['100%', '#a78bfa'],
    ] as const) {
      const stop = document.createElementNS(ns, 'stop');
      stop.setAttribute('offset', offset);
      stop.setAttribute('stop-color', cor);
      grad.appendChild(stop);
    }
    defs.appendChild(grad);
    svg.insertBefore(defs, svg.firstChild);
  }

  const porId = new Map(graph.nodes.map((node) => [node.id, node]));

  // Arestas: uma linha por import, indexada para o realce.
  const linhas = new Map<string, SVGLineElement>();
  for (const edge of graph.edges) {
    const de = porId.get(edge.from);
    const para = porId.get(edge.to);
    if (!de || !para) continue;

    const linha = document.createElementNS(ns, 'line');
    linha.setAttribute('x1', String(de.x));
    linha.setAttribute('y1', String(de.y));
    linha.setAttribute('x2', String(para.x));
    linha.setAttribute('y2', String(para.y));
    // A ligacao fonte-teste e uma relacao diferente de um import: ela nao
    // participa da propagacao, e o desenho precisa dizer isso.
    linha.setAttribute('class', `graph-edge graph-edge--${edge.kind}`);
    caixaArestas.appendChild(linha);
    linhas.set(`${edge.from}->${edge.to}`, linha);
  }

  // Nos: um chip posicionado em porcentagem do palco.
  const chips = new Map<string, HTMLElement>();
  for (const node of graph.nodes) {
    const chip = document.createElement('span');
    chip.className = `graph-node graph-node--${node.kind}`;
    chip.style.left = `${node.x}%`;
    chip.style.top = `${node.y}%`;
    chip.textContent = node.label;
    chip.title = node.id;
    caixaNos.appendChild(chip);
    chips.set(node.id, chip);
  }

  let atual: Depth = options.initial ?? 'direct';

  /** Redesenha o realce para a profundidade escolhida. */
  function pintar(depth: Depth): void {
    const impacto = computeImpact(graph, ARQUIVO_ALTERADO, depth);
    const testes = new Set(impacto.tests.map((teste) => teste.id));

    for (const [id, chip] of chips) {
      const alcancado = impacto.reachedIds.has(id);
      chip.classList.toggle('is-reached', alcancado && id !== ARQUIVO_ALTERADO);
      chip.classList.toggle('is-changed', id === ARQUIVO_ALTERADO);
      chip.classList.toggle('is-test-run', testes.has(id));
      chip.classList.toggle('is-dim', !alcancado);
    }

    const ativas = new Set(impacto.activeEdges.map((edge) => `${edge.from}->${edge.to}`));
    for (const [chave, linha] of linhas) {
      linha.classList.toggle('is-active', ativas.has(chave));
    }

    alvoLegenda.innerHTML = captionFor(depth, impacto.tests.length);

    alvoTestes.innerHTML = impacto.tests
      .map((teste) => {
        const nome = teste.id.split('/').pop() as string;
        return [
          '<li>',
          `<span class="graph-demo__test-name">${nome}</span>`,
          `<span class="graph-demo__test-why">${explainTest(teste)}</span>`,
          '</li>',
        ].join('');
      })
      .join('');

    if (bloco) bloco.innerHTML = highlight(configFor(depth), 'jsonc');

    for (const botao of botoes) {
      const selecionado = botao.dataset['depth'] === depth;
      botao.setAttribute('aria-selected', String(selecionado));
    }

    atual = depth;
  }

  for (const botao of botoes) {
    botao.addEventListener('click', () => {
      const escolhida = botao.dataset['depth'];
      if (escolhida === 'self' || escolhida === 'direct' || escolhida === 'transitive') {
        pintar(escolhida);
      }
    });

    // Setas navegam entre as profundidades, como em um grupo de abas.
    botao.addEventListener('keydown', (evento) => {
      const passo = evento.key === 'ArrowRight' ? 1 : evento.key === 'ArrowLeft' ? -1 : 0;
      if (passo === 0) return;
      evento.preventDefault();
      const indice = ORDEM.indexOf(atual);
      const proxima = ORDEM[(indice + passo + ORDEM.length) % ORDEM.length] as Depth;
      pintar(proxima);
      root.querySelector<HTMLElement>(`[data-depth="${proxima}"]`)?.focus();
    });
  }

  pintar(atual);

  return {
    select: pintar,
    current: () => atual,
    mounted: true,
  };
}
