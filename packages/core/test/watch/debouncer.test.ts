import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDebouncer, type FlushTrigger } from '../../src/watch/debouncer.js';

interface Flush {
  paths: string[];
  trigger: FlushTrigger;
}

function setup(overrides: Partial<Parameters<typeof createDebouncer>[0]> = {}) {
  const flushes: Flush[] = [];
  const debouncer = createDebouncer({
    mode: 'both',
    idleMs: 400,
    maxBatchWindowMs: 3000,
    onFlush: (paths, trigger) => flushes.push({ paths, trigger }),
    ...overrides,
  });
  return { debouncer, flushes };
}

describe('createDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it('dispara por inatividade apos idleMs', () => {
    const { debouncer, flushes } = setup();
    debouncer.push('/a.ts');
    vi.advanceTimersByTime(399);
    expect(flushes).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(flushes).toEqual([{ paths: ['/a.ts'], trigger: 'idle' }]);
  });

  it('reinicia a janela de inatividade a cada save', () => {
    const { debouncer, flushes } = setup();
    debouncer.push('/a.ts');
    vi.advanceTimersByTime(300);
    debouncer.push('/b.ts');
    vi.advanceTimersByTime(300);
    expect(flushes).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(flushes[0]?.paths).toEqual(['/a.ts', '/b.ts']);
  });

  it('dispara pela janela maxima quando os saves nao param', () => {
    const { debouncer, flushes } = setup();
    for (let elapsed = 0; elapsed < 3000; elapsed += 200) {
      debouncer.push(`/f${elapsed}.ts`);
      vi.advanceTimersByTime(200);
    }
    expect(flushes).toHaveLength(1);
    expect(flushes[0]?.trigger).toBe('maxWindow');
    expect(flushes[0]?.paths.length).toBe(15);
  });

  it('conta a janela maxima a partir do primeiro evento do lote', () => {
    const { debouncer, flushes } = setup({ mode: 'batch' });
    debouncer.push('/a.ts');
    vi.advanceTimersByTime(2000);
    debouncer.push('/b.ts');
    vi.advanceTimersByTime(1000);
    expect(flushes).toHaveLength(1);
    expect(flushes[0]?.paths).toEqual(['/a.ts', '/b.ts']);
  });

  it('no modo idle nunca dispara pela janela maxima', () => {
    const { debouncer, flushes } = setup({ mode: 'idle' });
    for (let elapsed = 0; elapsed < 6000; elapsed += 100) {
      debouncer.push('/a.ts');
      vi.advanceTimersByTime(100);
    }
    expect(flushes).toHaveLength(0);
    vi.advanceTimersByTime(400);
    expect(flushes).toHaveLength(1);
  });

  it('no modo batch nao dispara por inatividade', () => {
    const { debouncer, flushes } = setup({ mode: 'batch' });
    debouncer.push('/a.ts');
    vi.advanceTimersByTime(1000);
    expect(flushes).toHaveLength(0);
  });

  it('deduplica caminhos preservando a ordem do primeiro save', () => {
    const { debouncer, flushes } = setup();
    debouncer.push('/b.ts');
    debouncer.push('/a.ts');
    debouncer.push('/b.ts');
    vi.advanceTimersByTime(400);
    expect(flushes[0]?.paths).toEqual(['/b.ts', '/a.ts']);
  });

  it('flushNow fecha o lote imediatamente', () => {
    const { debouncer, flushes } = setup();
    debouncer.push('/a.ts');
    debouncer.flushNow();
    expect(flushes).toEqual([{ paths: ['/a.ts'], trigger: 'manual' }]);
  });

  it('flushNow com lote vazio nao dispara nada', () => {
    const { debouncer, flushes } = setup();
    debouncer.flushNow();
    expect(flushes).toHaveLength(0);
  });

  it('nao dispara duas vezes o mesmo lote', () => {
    const { debouncer, flushes } = setup();
    debouncer.push('/a.ts');
    debouncer.flushNow();
    vi.advanceTimersByTime(5000);
    expect(flushes).toHaveLength(1);
  });

  it('reinicia a janela maxima para o lote seguinte', () => {
    const { debouncer, flushes } = setup({ mode: 'batch' });
    debouncer.push('/a.ts');
    vi.advanceTimersByTime(3000);
    debouncer.push('/b.ts');
    vi.advanceTimersByTime(3000);
    expect(flushes.map((f) => f.paths)).toEqual([['/a.ts'], ['/b.ts']]);
  });

  it('pending expoe o lote em andamento', () => {
    const { debouncer } = setup();
    debouncer.push('/a.ts');
    expect(debouncer.pending()).toEqual(['/a.ts']);
  });

  it('clear descarta o lote sem disparar', () => {
    const { debouncer, flushes } = setup();
    debouncer.push('/a.ts');
    debouncer.clear();
    vi.advanceTimersByTime(5000);
    expect(flushes).toHaveLength(0);
    expect(debouncer.pending()).toEqual([]);
  });

  it('dispose ignora pushes posteriores', () => {
    const { debouncer, flushes } = setup();
    debouncer.dispose();
    debouncer.push('/a.ts');
    debouncer.flushNow();
    vi.advanceTimersByTime(5000);
    expect(flushes).toHaveLength(0);
  });

  it('trata valores negativos como zero', () => {
    const { debouncer, flushes } = setup({ idleMs: -100 });
    debouncer.push('/a.ts');
    vi.advanceTimersByTime(0);
    expect(flushes).toHaveLength(1);
  });

  it('aceita uma API de timers injetada', () => {
    const scheduled: Array<() => void> = [];
    const { debouncer, flushes } = setup({
      timers: {
        setTimeout: (handler) => {
          scheduled.push(handler);
          return scheduled.length;
        },
        clearTimeout: () => {},
      },
    });
    debouncer.push('/a.ts');
    scheduled[0]?.();
    expect(flushes[0]?.trigger).toBe('idle');
  });
});
