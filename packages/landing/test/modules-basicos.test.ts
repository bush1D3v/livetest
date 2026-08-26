import { describe, expect, it, vi } from 'vitest';

import {
  prefersReducedMotion,
  rafScheduler,
  startFrameLoop,
  type FrameScheduler,
} from '../src/modules/motion.js';
import { createTabGroup } from '../src/modules/tabs.js';

/** Agendador controlado: os quadros disparam quando o teste manda. */
function agendadorManual() {
  const pendentes = new Map<number, (t: number) => void>();
  let proximo = 1;
  const scheduler: FrameScheduler = {
    request(callback) {
      const id = proximo++;
      pendentes.set(id, callback);
      return id;
    },
    cancel(handle) {
      pendentes.delete(handle);
    },
  };
  return {
    scheduler,
    pendentes: () => pendentes.size,
    disparar(timestamp: number) {
      const entradas = [...pendentes.entries()];
      pendentes.clear();
      for (const [, callback] of entradas) callback(timestamp);
    },
  };
}

describe('prefersReducedMotion', () => {
  it('devolve o que a consulta responder', () => {
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true);
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false);
  });

  it('assume movimento normal sem suporte a matchMedia', () => {
    expect(prefersReducedMotion(undefined)).toBe(false);
  });

  it('consulta a media correta', () => {
    const espia = vi.fn(() => ({ matches: false }));
    prefersReducedMotion(espia);
    expect(espia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });
});

describe('startFrameLoop', () => {
  it('entrega delta zero no primeiro quadro', () => {
    const manual = agendadorManual();
    const deltas: number[] = [];
    startFrameLoop((delta) => void deltas.push(delta), manual.scheduler);

    manual.disparar(1000);
    manual.disparar(1016);
    expect(deltas).toEqual([0, 16]);
  });

  it('para quando o callback devolve false', () => {
    const manual = agendadorManual();
    let chamadas = 0;
    const loop = startFrameLoop(() => {
      chamadas++;
      return false;
    }, manual.scheduler);

    manual.disparar(0);
    expect(loop.running()).toBe(false);
    expect(manual.pendentes()).toBe(0);
    manual.disparar(16);
    expect(chamadas).toBe(1);
  });

  it('stop interrompe e cancela o quadro pendente', () => {
    const manual = agendadorManual();
    const loop = startFrameLoop(() => {}, manual.scheduler);
    loop.stop();

    expect(loop.running()).toBe(false);
    expect(manual.pendentes()).toBe(0);
  });

  it('stop duas vezes nao quebra', () => {
    const manual = agendadorManual();
    const loop = startFrameLoop(() => {}, manual.scheduler);
    loop.stop();
    expect(() => loop.stop()).not.toThrow();
  });

  it('ignora quadros que chegam depois do stop', () => {
    const manual = agendadorManual();
    let chamadas = 0;
    const loop = startFrameLoop(() => void chamadas++, manual.scheduler);
    manual.disparar(0);
    loop.stop();
    manual.disparar(16);
    expect(chamadas).toBe(1);
  });

  it('expoe um agendador apoiado no requestAnimationFrame', () => {
    const request = vi.fn(() => 7);
    const cancel = vi.fn();
    const original = {
      raf: globalThis.requestAnimationFrame,
      caf: globalThis.cancelAnimationFrame,
    };
    globalThis.requestAnimationFrame = request as never;
    globalThis.cancelAnimationFrame = cancel as never;

    try {
      const handle = rafScheduler.request(() => {});
      rafScheduler.cancel(handle);
      expect(request).toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledWith(7);
    } finally {
      globalThis.requestAnimationFrame = original.raf;
      globalThis.cancelAnimationFrame = original.caf;
    }
  });
});

describe('createTabGroup', () => {
  it('comeca na primeira aba', () => {
    expect(createTabGroup(['a', 'b']).active()).toBe('a');
  });

  it('respeita a aba inicial informada', () => {
    expect(createTabGroup(['a', 'b'], { initial: 'b' }).active()).toBe('b');
  });

  it('ignora aba inicial desconhecida', () => {
    expect(createTabGroup(['a', 'b'], { initial: 'z' }).active()).toBe('a');
  });

  it('seleciona e notifica a mudanca', () => {
    const onChange = vi.fn();
    const grupo = createTabGroup(['a', 'b'], { onChange });
    expect(grupo.select('b')).toBe(true);
    expect(onChange).toHaveBeenCalledWith('b', 'a');
  });

  it('nao notifica ao reselecionar a mesma aba', () => {
    const onChange = vi.fn();
    const grupo = createTabGroup(['a', 'b'], { onChange });
    expect(grupo.select('a')).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('recusa aba desconhecida', () => {
    const grupo = createTabGroup(['a', 'b']);
    expect(grupo.select('z')).toBe(false);
    expect(grupo.active()).toBe('a');
  });

  it('circula com next e previous', () => {
    const grupo = createTabGroup(['a', 'b', 'c']);
    expect(grupo.next()).toBe('b');
    expect(grupo.next()).toBe('c');
    expect(grupo.next()).toBe('a');
    expect(grupo.previous()).toBe('c');
  });

  it('funciona sem callback de mudanca', () => {
    const grupo = createTabGroup(['a', 'b']);
    expect(() => grupo.select('b')).not.toThrow();
  });

  it('expoe os ids na ordem declarada', () => {
    expect(createTabGroup(['x', 'y']).ids).toEqual(['x', 'y']);
  });

  it('rejeita grupo vazio', () => {
    expect(() => createTabGroup([])).toThrow(/ao menos uma aba/);
  });
});

describe('startFrameLoop — quadro tardio', () => {
  it('ignora um quadro que chega apos o stop', () => {
    // Um agendador cujo `cancel` nao faz nada encena o caso em que o navegador
    // ja tinha o quadro na fila quando o laco foi interrompido.
    const pendentes: Array<(t: number) => void> = [];
    const scheduler: FrameScheduler = {
      request(callback) {
        pendentes.push(callback);
        return pendentes.length;
      },
      cancel: () => {},
    };

    let chamadas = 0;
    const loop = startFrameLoop(() => void chamadas++, scheduler);
    loop.stop();
    pendentes[0]?.(16);

    expect(chamadas).toBe(0);
    expect(loop.running()).toBe(false);
  });
});

