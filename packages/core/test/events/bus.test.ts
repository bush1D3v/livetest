import { describe, expect, it, vi } from 'vitest';

import { createEventBus } from '../../src/events/bus.js';
import type { LiveTestEvent } from '../../src/types/events.js';

describe('createEventBus', () => {
  it('carimba seq monotonico e timestamp', () => {
    const bus = createEventBus({ now: () => 1000 });
    const first = bus.emit({ type: 'watch.change', path: '/a.ts', kind: 'change' });
    const second = bus.emit({ type: 'watch.change', path: '/b.ts', kind: 'add' });
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(first.timestamp).toBe(1000);
    expect(bus.lastSeq()).toBe(2);
  });

  it('entrega o evento a todos os assinantes', () => {
    const bus = createEventBus();
    const a: LiveTestEvent[] = [];
    const b: LiveTestEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));
    bus.emit({ type: 'daemon.stopped', reason: 'teste' });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('cancela a assinatura', () => {
    const bus = createEventBus();
    const received: LiveTestEvent[] = [];
    const unsubscribe = bus.subscribe((e) => received.push(e));
    unsubscribe();
    bus.emit({ type: 'daemon.stopped', reason: 'x' });
    expect(received).toHaveLength(0);
  });

  it('isola a falha de um assinante dos demais', () => {
    const onListenerError = vi.fn();
    const bus = createEventBus({ onListenerError });
    const received: LiveTestEvent[] = [];
    bus.subscribe(() => {
      throw new Error('assinante quebrado');
    });
    bus.subscribe((e) => received.push(e));
    expect(() => bus.emit({ type: 'daemon.stopped', reason: 'x' })).not.toThrow();
    expect(received).toHaveLength(1);
    expect(onListenerError).toHaveBeenCalledOnce();
  });

  it('tolera assinante que cancela a propria assinatura durante a entrega', () => {
    const bus = createEventBus();
    let calls = 0;
    const unsubscribe = bus.subscribe(() => {
      calls++;
      unsubscribe();
    });
    bus.emit({ type: 'daemon.stopped', reason: 'a' });
    bus.emit({ type: 'daemon.stopped', reason: 'b' });
    expect(calls).toBe(1);
  });

  it('clear remove todos os assinantes', () => {
    const bus = createEventBus();
    const received: LiveTestEvent[] = [];
    bus.subscribe((e) => received.push(e));
    bus.clear();
    bus.emit({ type: 'daemon.stopped', reason: 'x' });
    expect(received).toHaveLength(0);
  });
});
