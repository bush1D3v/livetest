// @vitest-environment jsdom

/**
 * Testes que precisam de DOM.
 *
 * A pagina montada aqui nao e um HTML de teste escrito a mao: e a mesma que o
 * build publica, gerada pelas funcoes de `src/build/`. Um gancho que some da
 * moldura ou um `data-` renomeado quebra estes testes na hora, que e o unico
 * jeito de a fiacao e a marcacao nao se separarem em silencio.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHome } from '../src/build/home.js';
import { renderDocumento, resolvedorDeLinks, rotaCompleta } from '../src/build/layout.js';
import { renderMarkdown } from '../src/build/markdown.js';
import { copyText, legacyCopy } from '../src/modules/clipboard.js';
import type { FrameScheduler } from '../src/modules/motion.js';
import { setupReveal, type RevealObserverFactory } from '../src/modules/reveal.js';
import type { Locale } from '../src/modules/i18n.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CONTEUDO = path.join(AQUI, '..', 'content');

// O jsdom nao implementa `scrollIntoView`. A busca a usa para manter o
// resultado realcado dentro da vista enquanto as setas percorrem a lista, o que
// no navegador funciona e aqui precisa de um substituto.
Element.prototype.scrollIntoView = (): void => {};

/**
 * Monta no jsdom uma pagina real do site.
 *
 * @param locale - Idioma da pagina.
 * @param rota - Rota sem idioma; `''` monta a home.
 */
function montarPagina(locale: Locale = 'en', rota = ''): void {
  const home = rota === '';
  const caminho = rotaCompleta(locale, rota);

  let corpo = '';
  let headings: ReturnType<typeof renderMarkdown>['headings'] = [];

  if (home) {
    corpo = renderHome(locale);
  } else {
    const bruto = fs.readFileSync(path.join(CONTEUDO, locale, `${rota}.md`), 'utf8');
    const convertido = renderMarkdown(bruto.replace(/^---\n[\s\S]*?\n---\n?/, ''), {
      resolverLink: resolvedorDeLinks(caminho, locale),
    });
    corpo = convertido.html;
    headings = convertido.headings;
  }

  const html = renderDocumento({
    locale,
    rota,
    titulo: 'Titulo',
    descricao: 'Resumo',
    corpo,
    headings,
    home,
    versao: '0.1.0',
  });

  const atributos = /<body([^>]*)>/.exec(html)?.[1] ?? '';
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
  for (const achado of atributos.matchAll(/([\w-]+)="([^"]*)"/g)) {
    document.body.setAttribute(achado[1] as string, achado[2] as string);
  }
}

/** Observador falso: o teste decide quando o elemento "entra na tela". */
function observadorManual() {
  const observados: Element[] = [];
  let disparar: ((entries: Array<{ target: Element; isIntersecting: boolean }>) => void) | null =
    null;
  let desconectado = false;

  const factory: RevealObserverFactory = (callback) => {
    disparar = callback;
    return {
      observe: (element) => observados.push(element),
      disconnect: () => {
        desconectado = true;
      },
    };
  };

  return {
    factory,
    observados: () => observados,
    desconectado: () => desconectado,
    entrar: (elementos: Element[] = observados) =>
      disparar?.(elementos.map((target) => ({ target, isIntersecting: true }))),
    sair: () => disparar?.(observados.map((target) => ({ target, isIntersecting: false }))),
  };
}

/** Agendador de quadros controlado pelo teste. */
function agendadorManual() {
  const pendentes = new Map<number, (t: number) => void>();
  let proximo = 1;
  const scheduler: FrameScheduler = {
    request(callback) {
      const id = proximo++;
      pendentes.set(id, callback);
      return id;
    },
    cancel: (handle) => void pendentes.delete(handle),
  };
  return {
    scheduler,
    disparar(timestamp: number) {
      const entradas = [...pendentes.values()];
      pendentes.clear();
      for (const callback of entradas) callback(timestamp);
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('setupReveal', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div data-reveal></div><div data-reveal></div><div></div>';
  });

  it('observa todos os elementos marcados', () => {
    const manual = observadorManual();
    const reveal = setupReveal({ factory: manual.factory });
    expect(reveal.count).toBe(2);
    expect(manual.observados()).toHaveLength(2);
  });

  it('revela quando o elemento entra na tela', () => {
    const manual = observadorManual();
    setupReveal({ factory: manual.factory });
    manual.entrar();
    expect(document.querySelectorAll('.is-revealed')).toHaveLength(2);
  });

  it('nao revela quem ainda nao entrou', () => {
    const manual = observadorManual();
    setupReveal({ factory: manual.factory });
    manual.sair();
    expect(document.querySelectorAll('.is-revealed')).toHaveLength(0);
  });

  it('revela tudo de imediato no modo estatico', () => {
    const reveal = setupReveal({ immediate: true });
    expect(document.querySelectorAll('.is-revealed')).toHaveLength(2);
    expect(() => reveal.disconnect()).not.toThrow();
  });

  it('revela tudo quando nao ha observador disponivel', () => {
    setupReveal({ factory: undefined as unknown as RevealObserverFactory });
    expect(document.querySelectorAll('.is-revealed')).toHaveLength(2);
  });

  it('desconecta o observador quando pedido', () => {
    const manual = observadorManual();
    setupReveal({ factory: manual.factory }).disconnect();
    expect(manual.desconectado()).toBe(true);
  });

  it('usa o IntersectionObserver do navegador quando ele existe', async () => {
    const criado = vi.fn();
    class Falso {
      constructor(
        public callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void,
        public opcoes: unknown,
      ) {
        criado(opcoes);
      }
      observe(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('IntersectionObserver', Falso);

    try {
      const { intersectionFactory, observadorPadrao } = await import('../src/modules/reveal.js');
      expect(observadorPadrao()).toBe(intersectionFactory);

      const recebidas: Array<{ target: Element; isIntersecting: boolean }> = [];
      const observador = intersectionFactory((entries) => recebidas.push(...entries)) as Falso;

      expect(criado).toHaveBeenCalledWith({ rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
      const alvo = document.querySelector('[data-reveal]') as Element;
      observador.callback([{ target: alvo, isIntersecting: true }]);
      expect(recebidas).toEqual([{ target: alvo, isIntersecting: true }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('revela tudo onde o navegador nao tem o observador', async () => {
    const { observadorPadrao } = await import('../src/modules/reveal.js');
    expect(observadorPadrao()).toBeUndefined();
  });

  it('aceita seletor e classe customizados', () => {
    document.body.innerHTML = '<p class="alvo"></p>';
    setupReveal({ selector: '.alvo', revealedClass: 'visivel', immediate: true });
    expect(document.querySelector('.alvo')?.classList.contains('visivel')).toBe(true);
  });
});

describe('copyText', () => {
  it('usa a API moderna quando disponivel', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(copyText('npm i', { clipboard: { writeText } })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('npm i');
  });

  it('cai para o caminho alternativo quando a API falha', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('negado'));
    const fallback = vi.fn().mockReturnValue(true);
    await expect(copyText('x', { clipboard: { writeText }, fallback })).resolves.toBe(true);
    expect(fallback).toHaveBeenCalledWith('x');
  });

  it('usa o caminho alternativo quando nao ha API moderna', async () => {
    const fallback = vi.fn().mockReturnValue(true);
    await expect(copyText('x', { clipboard: undefined, fallback })).resolves.toBe(true);
  });

  it('reporta falha quando o caminho alternativo lanca', async () => {
    const fallback = vi.fn(() => {
      throw new Error('sem permissao');
    });
    await expect(copyText('x', { clipboard: undefined, fallback })).resolves.toBe(false);
  });

  it('reporta falha quando o caminho alternativo recusa', async () => {
    await expect(copyText('x', { clipboard: undefined, fallback: () => false })).resolves.toBe(
      false,
    );
  });

  it('consulta o navigator quando nada e injetado', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
    });
    try {
      await expect(copyText('x')).resolves.toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
    }
  });
});

describe('legacyCopy', () => {
  it('usa execCommand e limpa o campo temporario', () => {
    const execCommand = vi.fn().mockReturnValue(true);
    Object.assign(document, { execCommand });

    expect(legacyCopy('texto')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('devolve false quando execCommand nao existe', () => {
    Object.assign(document, { execCommand: undefined });
    expect(legacyCopy('texto')).toBe(false);
  });

  it('devolve false quando execCommand lanca', () => {
    Object.assign(document, {
      execCommand: () => {
        throw new Error('bloqueado');
      },
    });
    expect(legacyCopy('texto')).toBe(false);
  });
});

describe('setupCopyButtons', () => {
  beforeEach(() => montarPagina('pt'));

  it('liga os botoes da caixa de instalacao', async () => {
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    expect(setupCopyButtons().count).toBe(2);
  });

  it('copia o comando e confirma na tela, no idioma da pagina', async () => {
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    const writeText = vi.fn().mockResolvedValue(undefined);
    const agendados: Array<() => void> = [];

    setupCopyButtons({
      locale: 'pt',
      copy: { clipboard: { writeText } },
      schedule: (callback) => void agendados.push(callback),
    });

    const botao = document.querySelector<HTMLButtonElement>('[data-copy-button]') as HTMLButtonElement;
    botao.click();
    await vi.waitFor(() => expect(botao.classList.contains('is-done')).toBe(true));

    expect(writeText).toHaveBeenCalledWith('npm install --save-dev @livetest/cli');
    expect(botao.textContent?.trim()).toBe('Copiado');

    agendados[0]?.();
    expect(botao.classList.contains('is-done')).toBe(false);
    expect(botao.textContent?.trim()).toBe('Copiar');
  });

  it('avisa em ingles quando a copia falha', async () => {
    montarPagina('en');
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    setupCopyButtons({ copy: { clipboard: undefined, fallback: () => false }, schedule: () => {} });

    const botao = document.querySelector<HTMLButtonElement>('[data-copy-button]') as HTMLButtonElement;
    botao.click();
    await vi.waitFor(() => expect(botao.classList.contains('is-error')).toBe(true));
    expect(botao.textContent?.trim()).toBe('Copy manually');
  });

  it('copia o codigo que o botao carrega, e nao o bloco ja realcado', async () => {
    montarPagina('en', 'guide/getting-started');
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    const writeText = vi.fn().mockResolvedValue(undefined);
    setupCopyButtons({ copy: { clipboard: { writeText } }, schedule: () => {} });

    const botao = document.querySelector<HTMLButtonElement>(
      '.code-block__copy',
    ) as HTMLButtonElement;
    botao.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText).toHaveBeenCalledWith('$ npm install --save-dev @livetest/cli');
  });

  it('aceita uma raiz que nao e o documento inteiro', async () => {
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    const secao = document.querySelector('.heroi') as HTMLElement;
    expect(setupCopyButtons({ root: secao }).count).toBe(1);
  });

  it('cai no ingles quando o idioma pedido nao e publicado', async () => {
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    setupCopyButtons({
      locale: 'fr',
      copy: { clipboard: undefined, fallback: () => true },
      schedule: () => {},
    });

    const botao = document.querySelector<HTMLButtonElement>('[data-copy-button]') as HTMLButtonElement;
    botao.click();
    await vi.waitFor(() => expect(botao.textContent?.trim()).toBe('Copied'));
  });

  it('usa o proprio botao como rotulo quando nao ha um dentro', async () => {
    document.body.innerHTML =
      '<div data-copy-root><code data-copy-source>x</code><button data-copy-button>c</button></div>';
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    setupCopyButtons({
      locale: 'en',
      copy: { clipboard: undefined, fallback: () => true },
      schedule: () => {},
    });

    const botao = document.querySelector<HTMLButtonElement>('[data-copy-button]') as HTMLButtonElement;
    botao.click();
    await vi.waitFor(() => expect(botao.textContent).toBe('Copied'));
  });

  it('devolve o botao ao normal sozinho, sem agendador injetado', async () => {
    vi.useFakeTimers();

    try {
      const { setupCopyButtons } = await import('../src/setup/copy.js');
      setupCopyButtons({ locale: 'en', copy: { clipboard: undefined, fallback: () => true } });

      const botao = document.querySelector<HTMLButtonElement>(
        '[data-copy-button]',
      ) as HTMLButtonElement;
      botao.click();

      await vi.waitFor(() => expect(botao.textContent?.trim()).toBe('Copied'));
      vi.advanceTimersByTime(1800);
      expect(botao.textContent?.trim()).toBe('Copiar');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignora um botao sem texto nenhum para copiar', async () => {
    document.body.innerHTML = '<button data-copy-button></button>';
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    expect(setupCopyButtons().count).toBe(0);
  });

  it('sem nada injetado, usa a area de transferencia do proprio navegador', async () => {
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    const agendados: Array<() => void> = [];
    Object.assign(document, { execCommand: vi.fn().mockReturnValue(true) });

    // Nem `copy` nem `locale`: e o caminho que a pagina publicada percorre.
    setupCopyButtons({ schedule: (callback) => void agendados.push(callback) });

    const botao = document.querySelector<HTMLButtonElement>('[data-copy-button]') as HTMLButtonElement;
    botao.click();
    await vi.waitFor(() => expect(botao.textContent?.trim()).toBe('Copied'));
    expect(agendados).toHaveLength(1);
  });
});

describe('setupTerminal', () => {
  beforeEach(() => montarPagina('pt'));

  it('nao monta quando nao ha terminal na pagina', async () => {
    document.body.innerHTML = '';
    const { setupTerminal } = await import('../src/setup/terminal.js');
    const terminal = setupTerminal();
    expect(terminal.mounted).toBe(false);
    expect(() => terminal.stop()).not.toThrow();
  });

  it('escreve em portugues quando nao lhe dizem o idioma', async () => {
    const { setupTerminal } = await import('../src/setup/terminal.js');
    setupTerminal({ immediate: true });

    const saida = document.querySelector('[data-terminal-output]') as HTMLElement;
    expect(saida.textContent).toContain('livetest observando ~/projeto');
  });

  it('entrega o roteiro inteiro no modo estatico', async () => {
    const { setupTerminal } = await import('../src/setup/terminal.js');
    setupTerminal({ immediate: true, locale: 'pt' });

    const saida = document.querySelector('[data-terminal-output]') as HTMLElement;
    expect(saida.textContent).toContain('rodou porque src/header.ts importa src/login.ts');
    expect(saida.textContent).toContain('LIVETEST batch=batch-2 status=failed');
  });

  it('escreve o roteiro no idioma da pagina', async () => {
    montarPagina('en');
    const { setupTerminal } = await import('../src/setup/terminal.js');
    setupTerminal({ immediate: true, locale: 'en' });

    const saida = document.querySelector('[data-terminal-output]') as HTMLElement;
    expect(saida.textContent).toContain('ran because src/header.ts imports src/login.ts');
    expect(document.querySelector('[data-terminal-badge]')?.textContent).toBe('4 failures');
  });

  it('o distintivo acompanha o resultado do lote', async () => {
    const { badgeStateFor, roteiroDoTerminal, setupTerminal } = await import(
      '../src/setup/terminal.js'
    );

    expect(badgeStateFor([])).toBe('idle');
    expect(badgeStateFor([{ tone: 'pass' }])).toBe('passed');
    expect(badgeStateFor([{ tone: 'pass' }, { tone: 'fail' }])).toBe('failed');
    expect(roteiroDoTerminal('pt')[0]?.text).toBe('$ npx livetest start');

    const manual = agendadorManual();
    setupTerminal({ scheduler: manual.scheduler, locale: 'pt' });
    manual.disparar(0);
    expect(document.querySelector('[data-terminal-badge]')?.textContent).toBe('observando');
  });

  it('anima quadro a quadro e para quando pedido', async () => {
    const { setupTerminal } = await import('../src/setup/terminal.js');
    const manual = agendadorManual();
    const terminal = setupTerminal({ scheduler: manual.scheduler, locale: 'pt' });

    manual.disparar(0);
    manual.disparar(400);
    const saida = document.querySelector('[data-terminal-output]') as HTMLElement;
    expect(saida.textContent?.length).toBeGreaterThan(0);

    terminal.stop();
    expect(() => manual.disparar(800)).not.toThrow();
  });
});

describe('setupGraph', () => {
  beforeEach(() => montarPagina('pt', 'guide/depth'));

  it('nao monta onde nao ha demonstracao', async () => {
    document.body.innerHTML = '';
    const { setupGraph } = await import('../src/setup/graph.js');
    const grafo = setupGraph();
    expect(grafo.mounted).toBe(false);
    expect(grafo.current()).toBe('direct');
    expect(() => grafo.select('self')).not.toThrow();
  });

  it('desenha um no por arquivo e uma linha por aresta', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const { DEMO_GRAPH } = await import('../src/modules/depth-graph.js');
    setupGraph();

    expect(document.querySelectorAll('.graph-node')).toHaveLength(DEMO_GRAPH.nodes.length);
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(DEMO_GRAPH.edges.length);
  });

  it('comeca em direct e marca o botao correspondente', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    setupGraph();
    expect(document.querySelector('[data-depth="direct"]')?.getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('troca a profundidade ao clicar', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const grafo = setupGraph();

    document.querySelector<HTMLElement>('[data-depth="transitive"]')?.click();
    expect(grafo.current()).toBe('transitive');
    expect(document.querySelectorAll('[data-graph-tests] li')).toHaveLength(4);
  });

  it('ignora um botao com profundidade desconhecida', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const grafo = setupGraph();

    const botao = document.querySelector<HTMLElement>('[data-depth="self"]') as HTMLElement;
    botao.dataset['depth'] = 'inventada';
    botao.click();
    expect(grafo.current()).toBe('direct');
  });

  it('navega entre as profundidades com as setas', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const grafo = setupGraph();
    const botao = document.querySelector<HTMLElement>('[data-depth="direct"]') as HTMLElement;

    botao.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(grafo.current()).toBe('transitive');

    botao.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(grafo.current()).toBe('direct');

    botao.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(grafo.current()).toBe('direct');
  });

  it('circula ao passar do fim', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const grafo = setupGraph({ initial: 'transitive' });
    const botao = document.querySelector<HTMLElement>('[data-depth="transitive"]') as HTMLElement;

    botao.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(grafo.current()).toBe('self');
  });

  it('marca o arquivo salvo, os alcancados e os apagados', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    setupGraph().select('self');

    expect(document.querySelectorAll('.graph-node.is-changed')).toHaveLength(1);
    expect(document.querySelectorAll('.graph-node.is-dim').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.graph-node.is-test-run')).toHaveLength(1);
  });

  it('declara o gradiente das arestas ativas uma vez so', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    setupGraph();
    setupGraph();
    expect(document.querySelectorAll('#edge-gradient')).toHaveLength(1);
  });

  it('descarta aresta que aponta para um no inexistente', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const grafo = setupGraph({
      graph: {
        nodes: [{ id: 'a', label: 'a', kind: 'source', x: 0, y: 0 }],
        edges: [{ from: 'a', to: 'fantasma', kind: 'import' }],
      },
    });
    expect(grafo.mounted).toBe(true);
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(0);
  });

  it('mostra a configuracao que produz cada profundidade', async () => {
    const { configFor, setupGraph } = await import('../src/setup/graph.js');
    setupGraph().select('transitive');

    expect(configFor('direct')).not.toContain('overrides');
    expect(configFor('transitive')).toContain('"src/login.ts": "transitive"');
    expect(document.querySelector('[data-graph-config]')?.textContent).toContain('transitive');
  });

  it('funciona sem o bloco de configuracao ao lado', async () => {
    document.querySelector('[data-graph-config]')?.remove();
    const { setupGraph } = await import('../src/setup/graph.js');
    expect(setupGraph().mounted).toBe(true);
  });

  it('funciona sem o elemento SVG das arestas', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const grupo = document.querySelector('[data-graph-edges]') as Element;
    document.body.appendChild(grupo);
    expect(setupGraph().mounted).toBe(true);
  });
});

describe('setupChrome', () => {
  beforeEach(() => montarPagina('en', 'reference/config'));

  it('marca o cabecalho depois que a pagina rola', async () => {
    const { setupChrome, scrollProgress, currentSection } = await import('../src/setup/chrome.js');
    const chrome = setupChrome();
    const topo = document.querySelector('.topo') as HTMLElement;

    expect(topo.classList.contains('is-stuck')).toBe(false);
    Object.defineProperty(window, 'scrollY', { value: 300, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    expect(topo.classList.contains('is-stuck')).toBe(true);

    expect(scrollProgress(500, 2000, 1000)).toBe(0.5);
    expect(scrollProgress(0, 500, 1000)).toBe(0);
    expect(currentSection([{ id: 'a', top: 0 }], -10)).toBeNull();

    chrome.destroy();
  });

  it('atualiza a barra de progresso', async () => {
    const { setupChrome } = await import('../src/setup/chrome.js');
    setupChrome();
    Object.defineProperty(window, 'scrollY', { value: 100, configurable: true });
    window.dispatchEvent(new Event('scroll'));

    const barra = document.querySelector('[data-scroll-progress]') as HTMLElement;
    expect(barra.style.getPropertyValue('--progress')).not.toBe('');
  });

  it('acende no indice a secao em que a leitura esta', async () => {
    const { setupChrome } = await import('../src/setup/chrome.js');
    const links = [...document.querySelectorAll<HTMLAnchorElement>('.indice a')];
    expect(links.length).toBeGreaterThan(1);

    // O jsdom nao faz layout: as posicoes entram a mao.
    links.forEach((link, n) => {
      const alvo = document.getElementById(link.getAttribute('href')?.slice(1) ?? '');
      Object.defineProperty(alvo, 'offsetTop', { value: n * 1000, configurable: true });
    });

    setupChrome();
    Object.defineProperty(window, 'scrollY', { value: 2000, configurable: true });
    window.dispatchEvent(new Event('scroll'));

    expect(document.querySelectorAll('.indice a.is-current')).toHaveLength(1);
  });

  it('segue o cursor na home e para de seguir no modo estatico', async () => {
    montarPagina('en');
    const { setupChrome } = await import('../src/setup/chrome.js');
    setupChrome();

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 60 }));
    const brilho = document.querySelector('[data-cursor-glow]') as HTMLElement;
    expect(brilho.style.getPropertyValue('--cursor-x')).toBe('40px');

    montarPagina('en');
    setupChrome({ disableCursorGlow: true });
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
    const outro = document.querySelector('[data-cursor-glow]') as HTMLElement;
    expect(outro.style.getPropertyValue('--cursor-x')).toBe('');
  });

  it('move o halo dentro do cartao e solta o ouvinte ao destruir', async () => {
    montarPagina('en');
    const { setupChrome } = await import('../src/setup/chrome.js');
    const chrome = setupChrome();
    const cartao = document.querySelector('.cartao') as HTMLElement;

    cartao.dispatchEvent(new MouseEvent('mousemove', { clientX: 12, clientY: 20, bubbles: false }));
    expect(cartao.style.getPropertyValue('--mx')).toBe('12px');

    chrome.destroy();
    cartao.style.removeProperty('--mx');
    cartao.dispatchEvent(new MouseEvent('mousemove', { clientX: 99, clientY: 99 }));
    expect(cartao.style.getPropertyValue('--mx')).toBe('');
  });

  it('ignora um item do indice que nao aponta para lugar nenhum', async () => {
    const { setupChrome } = await import('../src/setup/chrome.js');
    const lista = document.querySelector('.indice ul') as HTMLElement;
    lista.insertAdjacentHTML('afterbegin', '<li><a>sem destino</a></li>');

    const chrome = setupChrome();
    expect(() => chrome.update()).not.toThrow();

    const orfao = lista.querySelector('a') as HTMLAnchorElement;
    expect(orfao.hasAttribute('href')).toBe(false);
    expect(orfao.classList.contains('is-current')).toBe(false);
    chrome.destroy();
  });

  it('nao quebra em pagina sem indice nem barra', async () => {
    document.body.innerHTML = '';
    const { setupChrome } = await import('../src/setup/chrome.js');
    expect(() => setupChrome().update()).not.toThrow();
  });
});

describe('setupPrefs', () => {
  beforeEach(() => {
    montarPagina('en', 'guide/depth');
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  /** O menu suspenso de um dos dois seletores. */
  const menu = (qual: string): HTMLElement =>
    document.querySelector<HTMLElement>(`[data-menu="${qual}"]`) as HTMLElement;

  it('aplica o tema escuro quando nunca houve escolha', async () => {
    const { setupPrefs } = await import('../src/setup/prefs.js');
    const prefs = setupPrefs();

    expect(prefs.theme()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    prefs.destroy();
  });

  it('retoma a escolha guardada', async () => {
    window.localStorage.setItem('livetest:theme', 'light');
    const { setupPrefs } = await import('../src/setup/prefs.js');
    const prefs = setupPrefs();

    expect(prefs.applied()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    prefs.destroy();
  });

  it('abre o menu, troca o tema e fecha', async () => {
    const { setupPrefs } = await import('../src/setup/prefs.js');
    const prefs = setupPrefs();
    const tema = menu('tema');

    tema.querySelector<HTMLElement>('[aria-haspopup]')?.click();
    expect(tema.classList.contains('is-open')).toBe(true);
    expect(tema.querySelector('[aria-haspopup]')?.getAttribute('aria-expanded')).toBe('true');

    tema.querySelector<HTMLElement>('[data-tema="light"]')?.click();
    expect(prefs.theme()).toBe('light');
    expect(window.localStorage.getItem('livetest:theme')).toBe('light');
    expect(tema.classList.contains('is-open')).toBe(false);
    prefs.destroy();
  });

  it('marca a opcao vigente e troca o icone', async () => {
    const { setupPrefs } = await import('../src/setup/prefs.js');
    const prefs = setupPrefs();

    prefs.setTheme('light');
    expect(menu('tema').querySelector('[data-tema="light"]')?.hasAttribute('data-ativo')).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-tema-icone="light"]')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-tema-icone="dark"]')?.hidden).toBe(true);

    prefs.setTheme('dark');
    expect(menu('tema').querySelector('[data-tema="light"]')?.hasAttribute('data-ativo')).toBe(
      false,
    );
    prefs.destroy();
  });

  it('abrir um menu fecha o outro', async () => {
    const { setupPrefs } = await import('../src/setup/prefs.js');
    const prefs = setupPrefs();

    menu('idioma').querySelector<HTMLElement>('[aria-haspopup]')?.click();
    menu('tema').querySelector<HTMLElement>('[aria-haspopup]')?.click();

    expect(menu('idioma').classList.contains('is-open')).toBe(false);
    expect(menu('tema').classList.contains('is-open')).toBe(true);
    prefs.destroy();
  });

  it('clicar duas vezes no gatilho fecha o menu', async () => {
    const { setupPrefs } = await import('../src/setup/prefs.js');
    const prefs = setupPrefs();
    const gatilho = menu('tema').querySelector<HTMLElement>('[aria-haspopup]') as HTMLElement;

    gatilho.click();
    gatilho.click();
    expect(menu('tema').classList.contains('is-open')).toBe(false);
    prefs.destroy();
  });

  it('fecha ao clicar fora e ao apertar Escape', async () => {
    const { setupPrefs } = await import('../src/setup/prefs.js');
    const prefs = setupPrefs();
    const gatilho = menu('tema').querySelector<HTMLElement>('[aria-haspopup]') as HTMLElement;

    gatilho.click();
    document.body.click();
    expect(menu('tema').classList.contains('is-open')).toBe(false);

    gatilho.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu('tema').classList.contains('is-open')).toBe(false);
    prefs.destroy();
  });

  it('ignora um valor de tema que nao existe', async () => {
    const { setupPrefs } = await import('../src/setup/prefs.js');
    const prefs = setupPrefs();
    const opcao = menu('tema').querySelector<HTMLElement>('[data-tema="light"]') as HTMLElement;

    opcao.dataset['tema'] = 'sepia';
    opcao.click();
    expect(prefs.theme()).toBe('dark');
    prefs.destroy();
  });

  it('guarda o idioma escolhido e desarma o redirecionamento da aba', async () => {
    const { setupPrefs } = await import('../src/setup/prefs.js');
    const prefs = setupPrefs();

    menu('idioma').querySelector<HTMLElement>('[data-escolher-idioma="pt"]')?.click();
    expect(window.localStorage.getItem('livetest:locale')).toBe('pt');
    expect(window.sessionStorage.getItem('livetest:auto')).toBe('1');
    prefs.destroy();
  });

  it('ignora um idioma que nao e publicado', async () => {
    const { setupPrefs } = await import('../src/setup/prefs.js');
    const prefs = setupPrefs();
    const opcao = menu('idioma').querySelector<HTMLElement>('[data-escolher-idioma="pt"]') as HTMLElement;

    opcao.dataset['escolherIdioma'] = 'fr';
    opcao.click();
    expect(window.localStorage.getItem('livetest:locale')).toBeNull();
    prefs.destroy();
  });

  it('navega mesmo quando a sessao esta bloqueada', async () => {
    const original = window.sessionStorage.setItem;
    window.sessionStorage.setItem = () => {
      throw new Error('bloqueado');
    };

    try {
      const { setupPrefs } = await import('../src/setup/prefs.js');
      const prefs = setupPrefs();
      expect(() =>
        menu('idioma').querySelector<HTMLElement>('[data-escolher-idioma="pt"]')?.click(),
      ).not.toThrow();
      prefs.destroy();
    } finally {
      window.sessionStorage.setItem = original;
    }
  });

  it('acompanha o sistema enquanto a escolha for system', async () => {
    const ouvintes: Array<() => void> = [];
    let escuro = false;
    vi.spyOn(window, 'matchMedia').mockImplementation(
      () =>
        ({
          get matches() {
            return escuro;
          },
          addEventListener: (_: string, ouvinte: () => void) => void ouvintes.push(ouvinte),
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );

    const { setupPrefs } = await import('../src/setup/prefs.js');
    const prefs = setupPrefs();

    prefs.setTheme('system');
    expect(document.documentElement.dataset['theme']).toBe('light');

    escuro = true;
    for (const ouvinte of ouvintes) ouvinte();
    expect(document.documentElement.dataset['theme']).toBe('dark');

    prefs.setTheme('light');
    escuro = false;
    for (const ouvinte of ouvintes) ouvinte();
    expect(document.documentElement.dataset['theme']).toBe('light');
    prefs.destroy();
  });

  it('segue navegando quando a sessao esta bloqueada e nao ha navigator', async () => {
    // Uma janela de mentira encena o que o modo privado faz: a gravacao na
    // sessao lanca, e o link precisa navegar mesmo assim.
    const janela = {
      localStorage: window.localStorage,
      sessionStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('bloqueado');
        },
      },
      matchMedia: undefined,
      navigator: undefined,
    } as unknown as Window;

    const { setupPrefs } = await import('../src/setup/prefs.js');
    const prefs = setupPrefs({ doc: document, win: janela });

    expect(() =>
      menu('idioma').querySelector<HTMLElement>('[data-escolher-idioma="pt"]')?.click(),
    ).not.toThrow();
    expect(window.localStorage.getItem('livetest:locale')).toBe('pt');
    expect(document.querySelector('[data-tecla-modificador]')?.textContent).toBe('Ctrl');
    prefs.destroy();
  });

  it('assume escuro em um ambiente sem matchMedia', async () => {
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { value: undefined, configurable: true });

    try {
      const { setupPrefs } = await import('../src/setup/prefs.js');
      const prefs = setupPrefs();
      prefs.setTheme('system');
      expect(prefs.applied()).toBe('dark');
      prefs.destroy();
    } finally {
      Object.defineProperty(window, 'matchMedia', { value: original, configurable: true });
    }
  });

  it('mostra a tecla de comando em um Mac', async () => {
    Object.defineProperty(window.navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });

    const { setupPrefs } = await import('../src/setup/prefs.js');
    const prefs = setupPrefs();
    expect(document.querySelector('[data-tecla-modificador]')?.textContent).toBe('⌘');

    Object.defineProperty(window.navigator, 'platform', { value: 'Linux', configurable: true });
    prefs.destroy();
  });

  it('fecha os menus quando pedido de fora', async () => {
    const { setupPrefs } = await import('../src/setup/prefs.js');
    const prefs = setupPrefs();

    menu('tema').querySelector<HTMLElement>('[aria-haspopup]')?.click();
    prefs.closeMenus();
    expect(menu('tema').classList.contains('is-open')).toBe(false);
    prefs.destroy();
  });
});

describe('setupNav', () => {
  beforeEach(() => montarPagina('en', 'guide/depth'));

  it('abre e fecha a gaveta', async () => {
    const { setupNav } = await import('../src/setup/nav.js');
    const nav = setupNav();
    const lateral = document.querySelector('.lateral') as HTMLElement;
    const cortina = document.querySelector('[data-cortina]') as HTMLElement;

    document.querySelector<HTMLElement>('[data-menu-lateral]')?.click();
    expect(nav.isOpen()).toBe(true);
    expect(lateral.classList.contains('is-open')).toBe(true);
    expect(cortina.hidden).toBe(false);
    expect(document.documentElement.style.overflow).toBe('hidden');

    document.querySelector<HTMLElement>('[data-menu-lateral]')?.click();
    expect(nav.isOpen()).toBe(false);
    expect(cortina.hidden).toBe(true);
    nav.destroy();
  });

  it('fecha ao clicar na cortina, em um link do menu, ou com Escape', async () => {
    const { setupNav } = await import('../src/setup/nav.js');
    const nav = setupNav();

    nav.toggle();
    document.querySelector<HTMLElement>('[data-cortina]')?.click();
    expect(nav.isOpen()).toBe(false);

    nav.toggle();
    document.querySelector<HTMLElement>('.lateral a')?.click();
    expect(nav.isOpen()).toBe(false);

    nav.toggle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(nav.isOpen()).toBe(false);

    // Fechar de novo com ela ja fechada nao faz nada.
    nav.close();
    expect(nav.isOpen()).toBe(false);
    nav.destroy();
  });

  it('a home tambem tem gaveta, com os links do cabecalho', async () => {
    montarPagina('en');
    const { setupNav } = await import('../src/setup/nav.js');
    const nav = setupNav();

    expect(nav.mounted).toBe(true);
    document.querySelector<HTMLElement>('[data-menu-lateral]')?.click();
    expect(nav.isOpen()).toBe(true);

    const movel = document.querySelector('.lateral__grupo--movel') as HTMLElement;
    expect(movel.querySelectorAll('a').length).toBeGreaterThan(0);
    nav.destroy();
  });

  it('nao monta onde nao ha gaveta nenhuma', async () => {
    document.body.innerHTML = '';
    const { setupNav } = await import('../src/setup/nav.js');
    const nav = setupNav();

    expect(nav.mounted).toBe(false);
    expect(nav.isOpen()).toBe(false);
    expect(() => {
      nav.toggle();
      nav.close();
      nav.destroy();
    }).not.toThrow();
  });

  it('funciona sem a cortina na pagina', async () => {
    document.querySelector('[data-cortina]')?.remove();
    const { setupNav } = await import('../src/setup/nav.js');
    const nav = setupNav();

    nav.toggle();
    expect(nav.isOpen()).toBe(true);
    nav.destroy();
  });
});

describe('setupSearch', () => {
  const DOCS = [
    { u: 'guide/depth/', p: 'Propagation depth', s: '', t: 'How far a run propagates.' },
    {
      u: 'reference/config/#debounce',
      p: 'Configuration',
      s: 'debounce',
      t: 'Grouping of consecutive saves.',
    },
  ];

  beforeEach(() => montarPagina('en', 'guide/depth'));

  /** Monta a busca com um indice de mentira, sem rede. */
  async function comIndice(docs = DOCS) {
    const { setupSearch } = await import('../src/setup/search.js');
    const busca = setupSearch({ carregar: async () => docs });
    await busca.open();
    return busca;
  }

  it('nao monta quando o dialogo nao esta na pagina', async () => {
    document.body.innerHTML = '';
    const { setupSearch } = await import('../src/setup/search.js');
    const busca = setupSearch();

    expect(busca.mounted).toBe(false);
    expect(busca.isOpen()).toBe(false);
    expect(busca.query('x')).toEqual([]);
    await expect(busca.open()).resolves.toBeUndefined();
    expect(() => {
      busca.close();
      busca.destroy();
    }).not.toThrow();
  });

  it('abre pelo botao do cabecalho e fecha pelo fundo', async () => {
    const { setupSearch } = await import('../src/setup/search.js');
    const busca = setupSearch({ carregar: async () => DOCS });
    const dialogo = document.querySelector('[data-busca]') as HTMLElement;

    expect(dialogo.hidden).toBe(true);
    document.querySelector<HTMLElement>('[data-busca-abrir]')?.click();
    await vi.waitFor(() => expect(busca.isOpen()).toBe(true));

    document.querySelector<HTMLElement>('[data-busca-fechar]')?.click();
    expect(busca.isOpen()).toBe(false);
    busca.destroy();
  });

  it('abre e fecha com o atalho de teclado', async () => {
    const { setupSearch } = await import('../src/setup/search.js');
    const busca = setupSearch({ carregar: async () => DOCS });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await vi.waitFor(() => expect(busca.isOpen()).toBe(true));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', metaKey: true }));
    expect(busca.isOpen()).toBe(false);
    busca.destroy();
  });

  it('fecha com Escape e devolve o foco a quem abriu', async () => {
    const { setupSearch } = await import('../src/setup/search.js');
    const busca = setupSearch({ carregar: async () => DOCS });
    const gatilho = document.querySelector<HTMLElement>('[data-busca-abrir]') as HTMLElement;

    gatilho.focus();
    gatilho.click();
    await vi.waitFor(() => expect(busca.isOpen()).toBe(true));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(busca.isOpen()).toBe(false);
    expect(document.activeElement).toBe(gatilho);
    busca.destroy();
  });

  it('lista os resultados agrupados por pagina', async () => {
    const busca = await comIndice();
    busca.query('debounce');

    const itens = document.querySelectorAll('.busca__item');
    expect(itens).toHaveLength(1);
    expect(document.querySelector('.busca__grupo')?.textContent).toBe('Configuration');
    expect(document.querySelector('.busca__titulo')?.textContent).toBe('debounce');
    expect(document.querySelector('.busca__contexto')?.textContent).toBe('Configuration');
    busca.destroy();
  });

  it('aponta o link para a ancora, a partir da raiz do site', async () => {
    const busca = await comIndice();
    busca.query('debounce');

    const item = document.querySelector('.busca__item') as HTMLAnchorElement;
    expect(item.getAttribute('href')).toBe('../../reference/config/#debounce');
    busca.destroy();
  });

  it('realca o que casou', async () => {
    const busca = await comIndice();
    busca.query('debounce');
    expect(document.querySelector('.busca__titulo mark')?.textContent).toBe('debounce');
    busca.destroy();
  });

  it('avisa quando nada casa e some com o aviso quando o campo esvazia', async () => {
    const busca = await comIndice();
    const vazio = document.querySelector('[data-busca-vazio]') as HTMLElement;

    busca.query('kubernetes');
    expect(vazio.hidden).toBe(false);
    expect(document.querySelector('[data-busca-termo]')?.textContent).toBe('kubernetes');

    busca.query('');
    expect(vazio.hidden).toBe(true);
    busca.destroy();
  });

  it('busca a cada tecla digitada', async () => {
    const busca = await comIndice();
    const entrada = document.querySelector<HTMLInputElement>('[data-busca-entrada]') as HTMLInputElement;

    entrada.value = 'depth';
    entrada.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('.busca__item')).toHaveLength(1);
    busca.destroy();
  });

  it('navega pelos resultados com as setas, circulando nas pontas', async () => {
    const busca = await comIndice([
      { u: 'a/', p: 'A', s: '', t: 'alvo um' },
      { u: 'b/', p: 'B', s: '', t: 'alvo dois' },
    ]);
    busca.query('alvo');

    const ativo = (): number =>
      [...document.querySelectorAll('.busca__item')].findIndex((item) =>
        item.classList.contains('is-active'),
      );

    expect(ativo()).toBe(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(ativo()).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(ativo()).toBe(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(ativo()).toBe(1);
    busca.destroy();
  });

  it('o mouse tambem move o realce', async () => {
    const busca = await comIndice([
      { u: 'a/', p: 'A', s: '', t: 'alvo um' },
      { u: 'b/', p: 'B', s: '', t: 'alvo dois' },
    ]);
    busca.query('alvo');

    const segundo = document.querySelectorAll('.busca__item')[1] as HTMLElement;
    segundo.dispatchEvent(new MouseEvent('mousemove'));
    expect(segundo.classList.contains('is-active')).toBe(true);
    busca.destroy();
  });

  it('Enter abre o resultado realcado', async () => {
    const busca = await comIndice();
    busca.query('debounce');

    const item = document.querySelector('.busca__item') as HTMLAnchorElement;
    const clique = vi.fn();
    item.addEventListener('click', (evento) => {
      evento.preventDefault();
      clique();
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(clique).toHaveBeenCalled();
    busca.destroy();
  });

  it('as setas nao quebram com a lista vazia', async () => {
    const busca = await comIndice();
    busca.query('kubernetes');
    expect(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })),
    ).not.toThrow();
    busca.destroy();
  });

  it('consultar antes de o indice chegar devolve vazio', async () => {
    const { setupSearch } = await import('../src/setup/search.js');
    const busca = setupSearch({ carregar: async () => DOCS });
    expect(busca.query('debounce')).toEqual([]);
    busca.destroy();
  });

  it('Enter sem resultado nenhum nao faz nada', async () => {
    const busca = await comIndice();
    busca.query('kubernetes');
    expect(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })),
    ).not.toThrow();
    busca.destroy();
  });

  it('teclas fora do dialogo fechado sao ignoradas', async () => {
    const { setupSearch } = await import('../src/setup/search.js');
    const busca = setupSearch({ carregar: async () => DOCS });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(busca.isOpen()).toBe(false);
    busca.destroy();
  });

  it('baixa o indice uma vez so', async () => {
    const { setupSearch } = await import('../src/setup/search.js');
    const carregar = vi.fn(async () => DOCS);
    const busca = setupSearch({ carregar });

    await busca.open();
    busca.close();
    await busca.open();

    expect(carregar).toHaveBeenCalledTimes(1);
    expect(carregar).toHaveBeenCalledWith('../../search-en.json');
    busca.destroy();
  });

  it('continua abrindo quando o indice nao chega', async () => {
    const { setupSearch } = await import('../src/setup/search.js');
    const busca = setupSearch({
      carregar: async () => {
        throw new Error('offline');
      },
    });

    await busca.open();
    expect(busca.isOpen()).toBe(true);
    expect(busca.query('debounce')).toEqual([]);
    busca.destroy();
  });

  it('respeita o limite de resultados', async () => {
    const muitos = Array.from({ length: 40 }, (_, n) => ({
      u: `p${n}/`,
      p: `P${n}`,
      s: '',
      t: 'alvo repetido',
    }));

    const { setupSearch } = await import('../src/setup/search.js');
    const busca = setupSearch({ carregar: async () => muitos, limite: 5 });
    await busca.open();

    expect(busca.query('alvo')).toHaveLength(5);
    busca.destroy();
  });

  it('busca pela rede quando nada e injetado', async () => {
    const resposta = { json: async () => DOCS };
    const espia = vi.fn().mockResolvedValue(resposta);
    vi.stubGlobal('fetch', espia);

    try {
      const { setupSearch } = await import('../src/setup/search.js');
      const busca = setupSearch();
      await busca.open();

      expect(espia).toHaveBeenCalledWith('../../search-en.json');
      expect(busca.query('debounce')).toHaveLength(1);
      busca.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cai no ingles quando a pagina nao diz o idioma', async () => {
    document.body.removeAttribute('data-locale');
    document.body.removeAttribute('data-raiz');

    const { setupSearch } = await import('../src/setup/search.js');
    const carregar = vi.fn(async () => DOCS);
    const busca = setupSearch({ carregar });
    await busca.open();

    expect(carregar).toHaveBeenCalledWith('./search-en.json');
    busca.destroy();
  });
});

describe('mountSite', () => {
  it('monta a home com terminal e gaveta', async () => {
    montarPagina('en');
    const { mountSite } = await import('../src/main.js');
    const app = mountSite({ reducedMotion: true });

    expect(app.locale).toBe('en');
    expect(app.reducedMotion).toBe(true);
    expect(app.terminal?.mounted).toBe(true);
    expect(app.graph).toBeNull();
    expect(app.nav.mounted).toBe(true);
    expect(app.search.mounted).toBe(true);
    expect(app.copy.count).toBe(2);

    app.destroy();
  });

  it('monta a documentacao com gaveta e sem terminal', async () => {
    montarPagina('pt', 'guide/depth');
    const { mountSite } = await import('../src/main.js');
    const app = mountSite({ reducedMotion: true });

    expect(app.locale).toBe('pt');
    expect(app.terminal).toBeNull();
    expect(app.graph?.mounted).toBe(true);
    expect(app.nav.mounted).toBe(true);

    app.destroy();
  });

  it('nao monta o grafo em uma pagina que nao o tem', async () => {
    montarPagina('en', 'changelog');
    const { mountSite } = await import('../src/main.js');
    const app = mountSite({ reducedMotion: true });

    expect(app.graph).toBeNull();
    app.destroy();
  });

  it('consulta prefers-reduced-motion quando nao lhe dizem', async () => {
    montarPagina('en', 'changelog');
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList);

    const { mountSite } = await import('../src/main.js');
    const app = mountSite();
    expect(app.reducedMotion).toBe(true);
    app.destroy();
  });

  it('cai no ingles quando o idioma da pagina nao e reconhecido', async () => {
    montarPagina('en', 'changelog');
    document.body.dataset['locale'] = 'fr';

    const { mountSite } = await import('../src/main.js');
    const app = mountSite({ reducedMotion: true });
    expect(app.locale).toBe('en');
    app.destroy();
  });
});
