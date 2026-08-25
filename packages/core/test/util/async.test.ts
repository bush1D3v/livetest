import { describe, expect, it, vi } from 'vitest';

import { createDeferred, delay, mapWithConcurrency } from '../../src/util/async.js';

describe('createDeferred', () => {
  it('resolve externamente', async () => {
    const deferred = createDeferred<number>();
    deferred.resolve(42);
    await expect(deferred.promise).resolves.toBe(42);
  });

  it('rejeita externamente', async () => {
    const deferred = createDeferred<number>();
    deferred.reject(new Error('boom'));
    await expect(deferred.promise).rejects.toThrow('boom');
  });
});

describe('mapWithConcurrency', () => {
  it('preserva a ordem dos resultados', async () => {
    const tasks = [3, 1, 2].map((ms, index) => async () => {
      await delay(ms);
      return index;
    });
    await expect(mapWithConcurrency(tasks, 3)).resolves.toEqual([0, 1, 2]);
  });

  it('respeita o limite de concorrencia', async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 6 }, () => async () => {
      active++;
      peak = Math.max(peak, active);
      await delay(5);
      active--;
      return null;
    });
    await mapWithConcurrency(tasks, 2);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('trata limite menor que 1 como 1', async () => {
    const order: number[] = [];
    const tasks = [0, 1].map((i) => async () => {
      order.push(i);
      return i;
    });
    await expect(mapWithConcurrency(tasks, 0)).resolves.toEqual([0, 1]);
    expect(order).toEqual([0, 1]);
  });

  it('devolve array vazio para lista vazia', async () => {
    await expect(mapWithConcurrency([], 4)).resolves.toEqual([]);
  });

  it('propaga erro de uma tarefa', async () => {
    const tasks = [async () => 1, async () => { throw new Error('falhou'); }];
    await expect(mapWithConcurrency(tasks, 2)).rejects.toThrow('falhou');
  });
});

describe('delay', () => {
  it('aguarda o tempo pedido', async () => {
    vi.useFakeTimers();
    let done = false;
    const promise = delay(100).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});
