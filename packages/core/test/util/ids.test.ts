import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../../src/util/ids.js';

describe('createIdGenerator', () => {
  it('gera ids sequenciais com prefixo', () => {
    const ids = createIdGenerator('batch');
    expect(ids.next()).toBe('batch-1');
    expect(ids.next()).toBe('batch-2');
  });

  it('reinicia o contador', () => {
    const ids = createIdGenerator('run');
    ids.next();
    ids.reset();
    expect(ids.next()).toBe('run-1');
  });

  it('mantem contadores independentes por instancia', () => {
    const a = createIdGenerator('a');
    const b = createIdGenerator('b');
    a.next();
    expect(b.next()).toBe('b-1');
  });
});
