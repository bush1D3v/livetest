// @vitest-environment jsdom

/**
 * Testes que precisam de DOM: revelacao, area de transferencia e os modulos de
 * `src/setup/`, montados sobre o `index.html` real.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copyText, legacyCopy } from '../src/modules/clipboard.js';
import { setupReveal, type RevealObserverFactory } from '../src/modules/reveal.js';
import type { FrameScheduler } from '../src/modules/motion.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(AQUI, '..', 'index.html'), 'utf8');

/** Monta o `index.html` real dentro do jsdom. */
function montarPagina(): void {
  const corpo = /<body[^>]*>([\s\S]*)<\/body>/.exec(HTML)?.[1] ?? '';
  document.body.innerHTML = corpo;
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

describe('setupTerminal', () => {
  beforeEach(montarPagina);

  it('desenha o roteiro inteiro no modo estatico', async () => {
    const { setupTerminal, TERMINAL_SCRIPT } = await import('../src/setup/terminal.js');
    const terminal = setupTerminal({ immediate: true });

    expect(terminal.mounted).toBe(true);
    const saida = document.querySelector('[data-terminal-output]');
    expect(saida?.querySelectorAll('.terminal__line')).toHaveLength(TERMINAL_SCRIPT.length);
    expect(saida?.textContent).toContain('rodou porque');
  });

  it('anima quadro a quadro quando o movimento e permitido', async () => {
    const { setupTerminal } = await import('../src/setup/terminal.js');
    const manual = agendadorManual();
    const terminal = setupTerminal({ scheduler: manual.scheduler });

    manual.disparar(0);
    manual.disparar(400);
    const saida = document.querySelector('[data-terminal-output]');
    expect(saida?.textContent?.length).toBeGreaterThan(0);

    terminal.stop();
    expect(terminal.mounted).toBe(true);
  });

  it('marca a linha em digitacao com o cursor', async () => {
    const { setupTerminal } = await import('../src/setup/terminal.js');
    const manual = agendadorManual();
    setupTerminal({ scheduler: manual.scheduler });

    manual.disparar(0);
    manual.disparar(30);
    expect(document.querySelector('.terminal__line--typing')).not.toBeNull();
  });

  it('atualiza o distintivo conforme o resultado', async () => {
    const { setupTerminal, badgeStateFor } = await import('../src/setup/terminal.js');
    setupTerminal({ immediate: true });

    const distintivo = document.querySelector<HTMLElement>('[data-terminal-badge]');
    // O roteiro termina em falha; o distintivo precisa refletir isso.
    expect(distintivo?.dataset['state']).toBe('failed');
    expect(distintivo?.textContent).toBe('4 falhas');

    expect(badgeStateFor([{ tone: 'pass' }])).toBe('passed');
    expect(badgeStateFor([{ tone: 'muted' }])).toBe('idle');
    expect(badgeStateFor([])).toBe('idle');
  });

  it('escapa marcacao vinda do roteiro', async () => {
    const { setupTerminal } = await import('../src/setup/terminal.js');
    setupTerminal({
      immediate: true,
      script: [{ text: '<script>&</script>', instant: true }],
    });
    const saida = document.querySelector('[data-terminal-output]');
    expect(saida?.querySelector('script')).toBeNull();
    expect(saida?.textContent).toContain('<script>&</script>');
  });

  it('nao quebra quando o elemento nao existe', async () => {
    document.body.innerHTML = '';
    const { setupTerminal } = await import('../src/setup/terminal.js');
    const terminal = setupTerminal();
    expect(terminal.mounted).toBe(false);
    expect(() => terminal.stop()).not.toThrow();
  });

  it('funciona sem o distintivo na pagina', async () => {
    document.querySelector('[data-terminal-badge]')?.remove();
    const { setupTerminal } = await import('../src/setup/terminal.js');
    expect(setupTerminal({ immediate: true }).mounted).toBe(true);
  });
});

describe('setupGraph', () => {
  beforeEach(montarPagina);

  it('desenha um chip por no e uma linha por aresta', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const { DEMO_GRAPH } = await import('../src/modules/depth-graph.js');
    const demo = setupGraph();

    expect(demo.mounted).toBe(true);
    expect(document.querySelectorAll('.graph-node')).toHaveLength(DEMO_GRAPH.nodes.length);
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(DEMO_GRAPH.edges.length);
  });

  it('comeca em direct e marca o arquivo alterado', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const demo = setupGraph();

    expect(demo.current()).toBe('direct');
    expect(document.querySelectorAll('.graph-node.is-changed')).toHaveLength(1);
    expect(
      document.querySelector<HTMLElement>('[data-depth="direct"]')?.getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('troca o realce ao selecionar transitive', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const demo = setupGraph();

    const antes = document.querySelectorAll('.graph-node.is-test-run').length;
    demo.select('transitive');
    const depois = document.querySelectorAll('.graph-node.is-test-run').length;

    expect(antes).toBe(3);
    expect(depois).toBe(4);
    expect(document.querySelectorAll('.graph-node.is-dim')).toHaveLength(0);
  });

  it('self acende so o arquivo salvo e o teste que o cobre', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    setupGraph().select('self');

    // Dos oito nos, ficam acesos apenas login.ts e login.test.ts.
    expect(document.querySelectorAll('.graph-node.is-dim')).toHaveLength(6);
    expect(document.querySelectorAll('.graph-node.is-test-run')).toHaveLength(1);
    // Nenhum import e percorrido, mas a cobertura do proprio arquivo acende.
    expect(document.querySelectorAll('.graph-edge--import.is-active')).toHaveLength(0);
    expect(document.querySelectorAll('.graph-edge--covers.is-active')).toHaveLength(1);
    expect(document.querySelectorAll('[data-graph-tests] li')).toHaveLength(1);
  });

  it('lista os testes com a explicacao de cada um', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    setupGraph().select('transitive');

    const itens = [...document.querySelectorAll('[data-graph-tests] li')];
    expect(itens).toHaveLength(4);
    expect(itens.map((li) => li.querySelector('.graph-demo__test-name')?.textContent)).toContain(
      'layout.test.ts',
    );
    expect(document.querySelector('[data-graph-tests]')?.textContent).toContain('via header.ts');
  });

  it('atualiza a legenda e a configuracao exibida', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const demo = setupGraph();

    demo.select('transitive');
    expect(document.querySelector('[data-graph-caption]')?.textContent).toContain(
      '4 arquivos de teste',
    );
    expect(document.querySelector('[data-graph-config]')?.textContent).toContain('"transitive"');

    demo.select('direct');
    expect(document.querySelector('[data-graph-config]')?.textContent).not.toContain('overrides');
  });

  it('usa o singular quando so um teste roda', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    setupGraph().select('self');
    expect(document.querySelector('[data-graph-caption]')?.textContent).toContain(
      '1 arquivo de teste',
    );
  });

  it('usa o plural quando mais de um teste roda', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    setupGraph().select('direct');
    expect(document.querySelector('[data-graph-caption]')?.textContent).toContain(
      '3 arquivos de teste',
    );
  });

  it('responde ao clique nos botoes', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const demo = setupGraph();

    document.querySelector<HTMLElement>('[data-depth="transitive"]')?.click();
    expect(demo.current()).toBe('transitive');
  });

  it('ignora clique em botao com profundidade invalida', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const botao = document.querySelector<HTMLElement>('[data-depth="self"]');
    botao?.setAttribute('data-depth', 'inventada');

    const demo = setupGraph();
    botao?.click();
    expect(demo.current()).toBe('direct');
  });

  it('navega com as setas do teclado', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const demo = setupGraph();
    const botao = document.querySelector<HTMLElement>('[data-depth="direct"]');

    botao?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(demo.current()).toBe('transitive');

    document
      .querySelector<HTMLElement>('[data-depth="transitive"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(demo.current()).toBe('direct');
  });

  it('ignora teclas que nao sao setas', async () => {
    const { setupGraph } = await import('../src/setup/graph.js');
    const demo = setupGraph();
    document
      .querySelector<HTMLElement>('[data-depth="direct"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(demo.current()).toBe('direct');
  });

  it('nao quebra quando o palco nao existe', async () => {
    document.body.innerHTML = '';
    const { setupGraph } = await import('../src/setup/graph.js');
    const demo = setupGraph();
    expect(demo.mounted).toBe(false);
    expect(demo.current()).toBe('direct');
    expect(() => demo.select('self')).not.toThrow();
  });
});

describe('setupCodeBlocks', () => {
  beforeEach(montarPagina);

  it('realca os blocos estaticos', async () => {
    const { setupCodeBlocks } = await import('../src/setup/code.js');
    const code = setupCodeBlocks();

    expect(code.highlighted).toBeGreaterThan(0);
    expect(document.querySelector('.tok-prompt')).not.toBeNull();
    expect(document.querySelector('.tok-command')).not.toBeNull();
  });

  it('comeca na aba de JavaScript', async () => {
    const { setupCodeBlocks } = await import('../src/setup/code.js');
    expect(setupCodeBlocks().activeTab()).toBe('js');
    expect(document.querySelector('[data-config-body]')?.textContent).toContain('vitest');
  });

  it('troca o conteudo ao clicar em outra aba', async () => {
    const { setupCodeBlocks } = await import('../src/setup/code.js');
    const code = setupCodeBlocks();

    document.querySelector<HTMLElement>('[data-config-tab="python"]')?.click();
    expect(code.activeTab()).toBe('python');
    expect(document.querySelector('[data-config-body]')?.textContent).toContain('pytest');
    expect(
      document
        .querySelector('[data-config-tab="python"]')
        ?.getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('mostra o exemplo de outra linguagem', async () => {
    const { setupCodeBlocks } = await import('../src/setup/code.js');
    setupCodeBlocks();
    document.querySelector<HTMLElement>('[data-config-tab="outra"]')?.click();
    expect(document.querySelector('[data-config-body]')?.textContent).toContain('"go"');
  });

  it('trata exemplo ausente sem quebrar', async () => {
    const { setupCodeBlocks } = await import('../src/setup/code.js');
    const code = setupCodeBlocks({ examples: {} });
    expect(code.activeTab()).toBe('js');
    expect(document.querySelector('[data-config-body]')?.textContent).toBe('');
  });

  it('funciona em uma pagina sem a secao de configuracao', async () => {
    document.body.innerHTML = '<pre><code data-code="bash">$ ls</code></pre>';
    const { setupCodeBlocks } = await import('../src/setup/code.js');
    const code = setupCodeBlocks();
    expect(code.highlighted).toBe(1);
    expect(code.activeTab()).toBeNull();
  });

  it('ignora blocos vazios', async () => {
    document.body.innerHTML = '<code data-code="bash"></code>';
    const { setupCodeBlocks } = await import('../src/setup/code.js');
    expect(setupCodeBlocks().highlighted).toBe(0);
  });
});

describe('setupCopyButtons', () => {
  beforeEach(montarPagina);

  it('liga todos os botoes da pagina', async () => {
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    expect(setupCopyButtons().count).toBe(2);
  });

  it('copia e mostra o retorno visual', async () => {
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    const writeText = vi.fn().mockResolvedValue(undefined);
    const agendados: Array<() => void> = [];

    setupCopyButtons({
      copy: { clipboard: { writeText } },
      schedule: (callback) => void agendados.push(callback),
    });

    const botao = document.querySelector<HTMLButtonElement>('[data-copy-button]');
    botao?.click();
    // O retorno visual so aparece depois que a promessa de copia resolve.
    await vi.waitFor(() => expect(botao?.classList.contains('is-done')).toBe(true));

    expect(writeText).toHaveBeenCalledWith('npm install --save-dev @livetest/cli');
    expect(botao?.textContent).toContain('Copiado');

    // O rotulo volta ao original quando o retorno expira.
    agendados[0]?.();
    expect(botao?.classList.contains('is-done')).toBe(false);
    expect(botao?.textContent).toContain('Copiar');
  });

  it('avisa quando a copia falha', async () => {
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    setupCopyButtons({
      copy: { clipboard: undefined, fallback: () => false },
      schedule: () => {},
    });

    const botao = document.querySelector<HTMLButtonElement>('[data-copy-button]');
    botao?.click();
    await vi.waitFor(() => expect(botao?.classList.contains('is-error')).toBe(true));
    expect(botao?.textContent).toContain('Copie manualmente');
  });

  it('ignora grupos incompletos', async () => {
    document.body.innerHTML = '<div data-copy-root><code data-copy-source>x</code></div>';
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    expect(setupCopyButtons().count).toBe(0);
  });

  it('usa o proprio botao quando nao ha rotulo interno', async () => {
    document.body.innerHTML =
      '<div data-copy-root><code data-copy-source>abc</code>' +
      '<button data-copy-button>Copiar</button></div>';
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    const writeText = vi.fn().mockResolvedValue(undefined);
    setupCopyButtons({ copy: { clipboard: { writeText } }, schedule: () => {} });

    document.querySelector<HTMLButtonElement>('[data-copy-button]')?.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('abc'));
  });

  it('usa setTimeout quando nenhum agendador e injetado', async () => {
    const { setupCopyButtons } = await import('../src/setup/copy.js');
    const writeText = vi.fn().mockResolvedValue(undefined);

    // Espiar o `setTimeout` mantem o teste sincrono e evita relogios falsos
    // disputando com a promessa da copia.
    const agendados: Array<{ callback: () => void; ms: number }> = [];
    const espia = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((callback: () => void, ms?: number) => {
        agendados.push({ callback, ms: ms ?? 0 });
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);

    try {
      setupCopyButtons({ copy: { clipboard: { writeText } }, feedbackMs: 10 });
      const botao = document.querySelector<HTMLButtonElement>('[data-copy-button]');
      botao?.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(botao?.classList.contains('is-done')).toBe(true);
      expect(agendados[0]?.ms).toBe(10);

      agendados[0]?.callback();
      expect(botao?.classList.contains('is-done')).toBe(false);
    } finally {
      espia.mockRestore();
    }
  });
});

describe('setupChrome', () => {
  beforeEach(montarPagina);

  it('calcula o progresso de leitura', async () => {
    const { scrollProgress } = await import('../src/setup/chrome.js');
    expect(scrollProgress(0, 2000, 1000)).toBe(0);
    expect(scrollProgress(500, 2000, 1000)).toBe(0.5);
    expect(scrollProgress(1000, 2000, 1000)).toBe(1);
    expect(scrollProgress(9999, 2000, 1000)).toBe(1);
  });

  it('devolve zero quando a pagina nao rola', async () => {
    const { scrollProgress } = await import('../src/setup/chrome.js');
    expect(scrollProgress(0, 800, 1000)).toBe(0);
  });

  it('escolhe a secao atual pela posicao', async () => {
    const { currentSection } = await import('../src/setup/chrome.js');
    const secoes = [
      { id: 'a', top: 0 },
      { id: 'b', top: 500 },
      { id: 'c', top: 1000 },
    ];
    expect(currentSection(secoes, 200)).toBe('a');
    expect(currentSection(secoes, 700)).toBe('b');
    expect(currentSection(secoes, 5000)).toBe('c');
    expect(currentSection([], 0)).toBeNull();
  });

  it('marca o header como fixo depois de rolar', async () => {
    const { setupChrome } = await import('../src/setup/chrome.js');
    const chrome = setupChrome();
    const header = document.querySelector('[data-header]');

    expect(header?.classList.contains('is-stuck')).toBe(false);
    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    expect(header?.classList.contains('is-stuck')).toBe(true);

    chrome.destroy();
  });

  it('atualiza a barra de progresso', async () => {
    const { setupChrome } = await import('../src/setup/chrome.js');
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 3000,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 1000, configurable: true });

    const chrome = setupChrome();
    chrome.update();
    const barra = document.querySelector<HTMLElement>('[data-scroll-progress]');
    expect(barra?.style.getPropertyValue('--progress')).toBe('0.5000');
    chrome.destroy();
  });

  it('destaca o link da secao visivel', async () => {
    const { setupChrome } = await import('../src/setup/chrome.js');
    for (const secao of document.querySelectorAll('section[id]')) {
      Object.defineProperty(secao, 'offsetTop', { value: 0, configurable: true });
    }
    const chrome = setupChrome();
    chrome.update();
    expect(document.querySelectorAll('.site-nav a.is-current').length).toBeGreaterThan(0);
    chrome.destroy();
  });

  it('move o brilho com o cursor', async () => {
    const { setupChrome } = await import('../src/setup/chrome.js');
    const chrome = setupChrome();
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 80 }));

    const brilho = document.querySelector<HTMLElement>('[data-cursor-glow]');
    expect(brilho?.style.getPropertyValue('--cursor-x')).toBe('120px');
    expect(brilho?.style.getPropertyValue('--cursor-on')).toBe('1');
    chrome.destroy();
  });

  it('nao registra o brilho quando o movimento e reduzido', async () => {
    const { setupChrome } = await import('../src/setup/chrome.js');
    const chrome = setupChrome({ disableCursorGlow: true });
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));

    const brilho = document.querySelector<HTMLElement>('[data-cursor-glow]');
    expect(brilho?.style.getPropertyValue('--cursor-on')).toBe('');
    chrome.destroy();
  });

  it('posiciona o halo dentro do cartao de recurso', async () => {
    const { setupChrome } = await import('../src/setup/chrome.js');
    const chrome = setupChrome();
    const cartao = document.querySelector<HTMLElement>('.feature');
    cartao?.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 30, bubbles: true }));

    expect(cartao?.style.getPropertyValue('--mx')).toBe('40px');
    chrome.destroy();
  });

  it('funciona em uma pagina sem cromo', async () => {
    document.body.innerHTML = '';
    const { setupChrome } = await import('../src/setup/chrome.js');
    const chrome = setupChrome();
    expect(() => {
      chrome.update();
      chrome.destroy();
    }).not.toThrow();
  });

  it('ignora links que apontam para secoes inexistentes', async () => {
    document.body.innerHTML = '<nav class="site-nav"><a href="#fantasma">x</a></nav>';
    const { setupChrome } = await import('../src/setup/chrome.js');
    const chrome = setupChrome();
    chrome.update();
    expect(document.querySelector('.site-nav a')?.classList.contains('is-current')).toBe(false);
    chrome.destroy();
  });

  it('ignora links sem href', async () => {
    document.body.innerHTML = '<nav class="site-nav"><a>x</a></nav>';
    const { setupChrome } = await import('../src/setup/chrome.js');
    const chrome = setupChrome();
    expect(() => chrome.update()).not.toThrow();
    chrome.destroy();
  });
});

describe('mountLanding', () => {
  beforeEach(montarPagina);

  it('monta todas as partes da pagina', async () => {
    const { mountLanding } = await import('../src/main.js');
    const app = mountLanding({ reducedMotion: true });

    expect(app.reducedMotion).toBe(true);
    expect(app.terminal.mounted).toBe(true);
    expect(app.graph.mounted).toBe(true);
    expect(app.copy.count).toBe(2);
    expect(app.code.activeTab()).toBe('js');
    expect(app.reveal.count).toBeGreaterThan(5);

    app.destroy();
  });

  it('no modo estatico revela tudo e nao anima', async () => {
    const { mountLanding } = await import('../src/main.js');
    const app = mountLanding({ reducedMotion: true });

    expect(document.querySelectorAll('[data-reveal]:not(.is-revealed)')).toHaveLength(0);
    expect(document.querySelector('.terminal__line--typing')).toBeNull();

    app.destroy();
  });

  it('consulta a preferencia do sistema quando nada e informado', async () => {
    const original = globalThis.matchMedia;
    globalThis.matchMedia = ((query: string) =>
      ({ matches: true, media: query })) as unknown as typeof matchMedia;

    try {
      const { mountLanding } = await import('../src/main.js');
      const app = mountLanding();
      expect(app.reducedMotion).toBe(true);
      app.destroy();
    } finally {
      globalThis.matchMedia = original;
    }
  });

  it('o grafo montado responde a interacao', async () => {
    const { mountLanding } = await import('../src/main.js');
    const app = mountLanding({ reducedMotion: true });

    document.querySelector<HTMLElement>('[data-depth="transitive"]')?.click();
    expect(app.graph.current()).toBe('transitive');
    expect(document.querySelectorAll('[data-graph-tests] li')).toHaveLength(4);

    app.destroy();
  });

  it('destroy pode ser chamado sem efeitos colaterais', async () => {
    const { mountLanding } = await import('../src/main.js');
    const app = mountLanding({ reducedMotion: false });
    expect(() => {
      app.destroy();
      app.destroy();
    }).not.toThrow();
  });
});

describe('index.html — estrutura', () => {
  beforeEach(montarPagina);

  it('tem uma unica h1', () => {
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });

  it('todas as secoes de navegacao existem', () => {
    for (const link of document.querySelectorAll<HTMLAnchorElement>('.site-nav a')) {
      const id = link.getAttribute('href')?.slice(1) ?? '';
      expect(document.getElementById(id), `secao ausente: ${id}`).not.toBeNull();
    }
  });

  it('nenhum link interno aponta para uma ancora inexistente', () => {
    const quebrados = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
      .map((link) => link.getAttribute('href')?.slice(1) ?? '')
      .filter((id) => id.length > 0 && document.getElementById(id) === null);
    expect(quebrados).toEqual([]);
  });

  it('todo link externo abre em nova aba com rel seguro', () => {
    // `target="_blank"` sem `rel="noopener"` da a pagina de destino acesso a
    // `window.opener`. Nao ha razao para deixar passar em uma pagina nova.
    const inseguros = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')]
      .filter(
        (link) =>
          link.getAttribute('target') !== '_blank' ||
          !(link.getAttribute('rel') ?? '').includes('noopener'),
      )
      .map((link) => link.getAttribute('href'));

    expect(inseguros).toEqual([]);
  });

  it('cada pacote aponta para a propria pagina no npm', () => {
    // O erro que este teste existe para pegar: um link escrito "@livetest/core"
    // que leva a uma ancora da propria pagina. Continua sendo um link valido,
    // entao nenhuma checagem de ancora quebrada o encontra.
    for (const pacote of ['@livetest/core', '@livetest/cli']) {
      const link = [...document.querySelectorAll<HTMLAnchorElement>('a')].find(
        (candidato) => candidato.textContent?.trim() === pacote,
      );

      expect(link, `sem link para ${pacote}`).toBeDefined();
      expect(link?.getAttribute('href')).toBe(`https://www.npmjs.com/package/${pacote}`);
    }
  });

  it('o repositorio esta acessivel da pagina', () => {
    const paraOGitHub = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(
      (link) => (link.getAttribute('href') ?? '').startsWith('https://github.com/'),
    );

    expect(paraOGitHub.length).toBeGreaterThan(0);
  });

  it('a extensao aponta para a propria pagina no Marketplace', () => {
    // O ID e `publisher`.`name` do manifesto da extensao. Errar essa composicao
    // — usar so o publisher, ou o nome do arquivo .vsix — da um link que abre
    // uma pagina de erro do Marketplace, nao um 404 evidente.
    const link = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((candidato) =>
      candidato.textContent?.trim().startsWith('Extensão VSCode'),
    );

    expect(link, 'sem link para a extensao').toBeDefined();
    expect(link?.getAttribute('href')).toBe(
      'https://marketplace.visualstudio.com/items?itemName=livetest.livetest-vscode',
    );
  });

  it('todo botao tem tipo declarado', () => {
    const semTipo = [...document.querySelectorAll('button')].filter(
      (botao) => botao.getAttribute('type') !== 'button',
    );
    expect(semTipo).toHaveLength(0);
  });

  it('a tabela comparativa tem legenda e cabecalhos com escopo', () => {
    const tabela = document.querySelector('table.compare');
    expect(tabela?.querySelector('caption')).not.toBeNull();
    for (const th of tabela?.querySelectorAll('th') ?? []) {
      expect(th.getAttribute('scope')).toBeTruthy();
    }
  });

  it('os icones decorativos ficam escondidos de leitores de tela', () => {
    const svgs = [...document.querySelectorAll('svg')];
    const expostos = svgs.filter(
      (svg) => svg.closest('[aria-hidden="true"]') === null && !svg.hasAttribute('aria-hidden'),
    );
    expect(expostos).toHaveLength(0);
  });
});

describe('intersectionFactory', () => {
  it('adapta as entradas do IntersectionObserver do navegador', async () => {
    const original = globalThis.IntersectionObserver;
    const caixa: { callback?: (entries: unknown[]) => void } = {};

    globalThis.IntersectionObserver = class {
      constructor(callback: (entries: unknown[]) => void) {
        caixa.callback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn();
      root = null;
      rootMargin = '';
      thresholds = [];
    } as unknown as typeof IntersectionObserver;

    try {
      vi.resetModules();
      const { intersectionFactory } = await import('../src/modules/reveal.js');
      expect(intersectionFactory).toBeDefined();

      const recebidas: Array<{ target: Element; isIntersecting: boolean }> = [];
      const alvo = document.createElement('div');
      intersectionFactory?.((entries) => recebidas.push(...entries));

      // O adaptador precisa reduzir a entrada nativa ao par que o modulo usa.
      caixa.callback?.([{ target: alvo, isIntersecting: true, extra: 'ignorado' }]);
      expect(recebidas).toEqual([{ target: alvo, isIntersecting: true }]);
    } finally {
      globalThis.IntersectionObserver = original;
      vi.resetModules();
    }
  });
});

describe('copyText — caminho alternativo padrao', () => {
  it('usa o legacyCopy quando nada e injetado', async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    Object.assign(document, { execCommand });

    await expect(copyText('texto', { clipboard: undefined })).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });
});

describe('setupChrome — pagina sem brilho', () => {
  it('ignora o movimento do cursor', async () => {
    montarPagina();
    document.querySelector('[data-cursor-glow]')?.remove();

    const { setupChrome } = await import('../src/setup/chrome.js');
    const chrome = setupChrome();
    expect(() =>
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5 })),
    ).not.toThrow();
    chrome.destroy();
  });
});

describe('setupGraph — aresta invalida', () => {
  it('ignora aresta que aponta para no inexistente', async () => {
    montarPagina();
    const { setupGraph } = await import('../src/setup/graph.js');

    setupGraph({
      graph: {
        nodes: [{ id: 'a.ts', label: 'a', kind: 'source', x: 10, y: 10 }],
        edges: [
          { from: 'a.ts', to: 'fantasma.ts', kind: 'import' },
          { from: 'fantasma.ts', to: 'a.ts', kind: 'import' },
        ],
      },
    });

    expect(document.querySelectorAll('.graph-node')).toHaveLength(1);
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(0);
  });
});

describe('setupCopyButtons — sem opcoes de copia', () => {
  it('usa o navigator do ambiente', async () => {
    montarPagina();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
    });

    try {
      const { setupCopyButtons } = await import('../src/setup/copy.js');
      setupCopyButtons({ schedule: () => {} });

      const botao = document.querySelector<HTMLButtonElement>('[data-copy-button]');
      botao?.click();
      await vi.waitFor(() => expect(botao?.classList.contains('is-done')).toBe(true));
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
    }
  });
});
