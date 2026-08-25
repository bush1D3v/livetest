import { describe, expect, it } from 'vitest';

import { LiveTestError } from '@livetest/core';

import { EXIT, buildOverrides, parseDepthFlag, reportError } from '../src/context.js';
import { captureOutput } from './helpers/harness.js';

describe('parseDepthFlag', () => {
  it.each(['self', 'direct', 'transitive'])('aceita %s', (value) => {
    expect(parseDepthFlag(value)).toBe(value);
  });

  it('aceita profundidade numerica', () => {
    expect(parseDepthFlag('3')).toBe(3);
    expect(parseDepthFlag('0')).toBe(0);
  });

  it('rejeita valores invalidos', () => {
    expect(() => parseDepthFlag('fundo')).toThrow(/--depth invalido/);
    expect(() => parseDepthFlag('-1')).toThrow(/--depth invalido/);
    expect(() => parseDepthFlag('1.5')).toThrow(/--depth invalido/);
  });
});

describe('buildOverrides', () => {
  it('devolve objeto vazio sem flags', () => {
    expect(buildOverrides({})).toEqual({});
  });

  it('mapeia root e log-level', () => {
    expect(buildOverrides({ root: '/p', 'log-level': 'debug' })).toEqual({
      root: '/p',
      logLevel: 'debug',
    });
  });

  it('mapeia depth para dependencyDepth.default', () => {
    expect(buildOverrides({ depth: 'transitive' }).dependencyDepth).toEqual({
      default: 'transitive',
    });
  });

  it('mapeia dry-run e concurrency', () => {
    expect(buildOverrides({ 'dry-run': true, concurrency: 4 })).toMatchObject({
      dryRun: true,
      concurrency: 4,
    });
  });

  it('monta debounce apenas com as chaves informadas', () => {
    expect(buildOverrides({ 'idle-ms': 100 }).debounce).toEqual({ idleMs: 100 });
    expect(buildOverrides({ 'max-window-ms': 900 }).debounce).toEqual({ maxBatchWindowMs: 900 });
    expect(buildOverrides({}).debounce).toBeUndefined();
  });

  it('mapeia as flags de saida', () => {
    expect(buildOverrides({ json: true }).output).toEqual({ format: 'ndjson' });
    expect(buildOverrides({ quiet: true }).output).toEqual({ stdout: false });
    expect(buildOverrides({ 'no-color': true }).output).toEqual({ color: false });
  });

  it('ignora flags de tipo inesperado', () => {
    expect(buildOverrides({ root: 42, concurrency: 'muitos' })).toEqual({});
  });
});

describe('reportError', () => {
  it('mapeia erros de configuracao para o codigo de config', () => {
    const output = captureOutput();
    const code = reportError(new LiveTestError('CONFIG_INVALID', 'ruim', ['campo x']), output);
    expect(code).toBe(EXIT.config);
    expect(output.errText()).toContain('campo x');
  });

  it('mapeia erros de daemon para o codigo de daemon', () => {
    const output = captureOutput();
    expect(reportError(new LiveTestError('DAEMON_NOT_RUNNING', 'sem daemon'), output)).toBe(
      EXIT.daemon,
    );
  });

  it('mapeia erros desconhecidos para o codigo interno', () => {
    const output = captureOutput();
    expect(reportError(new LiveTestError('ADAPTER_NOT_FOUND', 'x'), output)).toBe(EXIT.internal);
    expect(reportError(new Error('inesperado'), output)).toBe(EXIT.internal);
    expect(reportError('texto solto', output)).toBe(EXIT.internal);
  });
});
