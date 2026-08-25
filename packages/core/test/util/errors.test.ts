import { describe, expect, it } from 'vitest';

import { LiveTestError, errorDetail, errorMessage } from '../../src/util/errors.js';

describe('LiveTestError', () => {
  it('carrega codigo e detalhes', () => {
    const error = new LiveTestError('CONFIG_INVALID', 'invalida', ['a', 'b']);
    expect(error.code).toBe('CONFIG_INVALID');
    expect(error.details).toEqual(['a', 'b']);
    expect(error.name).toBe('LiveTestError');
    expect(error).toBeInstanceOf(Error);
  });

  it('formata mensagem com detalhes', () => {
    const error = new LiveTestError('CONFIG_INVALID', 'invalida', ['campo x']);
    expect(error.format()).toBe('invalida\n  - campo x');
  });

  it('formata apenas a mensagem quando nao ha detalhes', () => {
    expect(new LiveTestError('DAEMON_NOT_RUNNING', 'sem daemon').format()).toBe('sem daemon');
  });
});

describe('errorMessage', () => {
  it('extrai a mensagem de um Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('devolve strings como estao', () => {
    expect(errorMessage('texto')).toBe('texto');
  });

  it('serializa objetos', () => {
    expect(errorMessage({ a: 1 })).toBe('{"a":1}');
  });

  it('cai para String() em valores nao serializaveis', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(errorMessage(circular)).toContain('object');
  });
});

describe('errorDetail', () => {
  it('devolve a stack de um Error', () => {
    expect(errorDetail(new Error('x'))).toContain('Error: x');
  });

  it('devolve null para valores sem stack', () => {
    expect(errorDetail('x')).toBeNull();
  });
});
