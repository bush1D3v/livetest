import { describe, expect, it, vi } from 'vitest';

import { consoleSink, createLogger, noopLogger } from '../../src/util/logger.js';
import { createRecordingLogger } from '../helpers/logger.js';

describe('createLogger', () => {
  it('emite mensagens no nivel configurado ou acima', () => {
    const { logger, lines } = createRecordingLogger('warn');
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('WARN c');
    expect(lines[1]).toContain('ERROR d');
  });

  it('inclui o escopo no prefixo', () => {
    const { logger, lines } = createRecordingLogger('debug');
    logger.child('watcher').info('ola');
    expect(lines[0]).toContain('[livetest:watcher]');
  });

  it('aninha escopos filhos', () => {
    const { logger, lines } = createRecordingLogger('debug');
    logger.child('graph').child('python').debug('x');
    expect(lines[0]).toContain('[livetest:graph:python]');
  });

  it('usa prefixo sem escopo na raiz', () => {
    const { logger, lines } = createRecordingLogger('info');
    logger.info('raiz');
    expect(lines[0]).toContain('[livetest]');
  });

  it('repassa argumentos extras', () => {
    const { logger, lines } = createRecordingLogger('info');
    logger.info('%d arquivos', 12);
    expect(lines[0]).toContain('12');
  });

  it('inclui o horario no formato HH:MM:SS.mmm', () => {
    const { logger, lines } = createRecordingLogger('info');
    logger.info('x');
    expect(lines[0]).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3} /);
  });

  it('expoe o nivel efetivo', () => {
    expect(createLogger({ level: 'error' }).level).toBe('error');
  });

  it('silencia tudo no nivel silent', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'silent', sink: { write: (_l, line) => lines.push(line) } });
    logger.error('nada');
    expect(lines).toHaveLength(0);
  });
});

describe('noopLogger', () => {
  it('nao lanca em nenhum metodo', () => {
    expect(() => {
      noopLogger.debug('a');
      noopLogger.info('a');
      noopLogger.warn('a');
      noopLogger.error('a');
      noopLogger.child('x').info('a');
    }).not.toThrow();
  });
});

describe('consoleSink', () => {
  it('escreve em stderr, preservando o stdout para o relatorio', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      consoleSink.write('info', 'linha de log', ['extra', 42]);
      expect(spy).toHaveBeenCalledWith('linha de log', 'extra', 42);
    } finally {
      spy.mockRestore();
    }
  });

  it('e o destino padrao do logger', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      createLogger({ level: 'info' }).warn('atencao');
      expect(spy).toHaveBeenCalledOnce();
      expect(String(spy.mock.calls[0]?.[0])).toContain('WARN atencao');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('createLogger — sem opcoes', () => {
  it('usa nivel info por padrao', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const logger = createLogger();
      expect(logger.level).toBe('info');
      logger.debug('nao aparece');
      expect(spy).not.toHaveBeenCalled();
      logger.info('aparece');
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });

  it('usa o relogio real por padrao', () => {
    const lines: string[] = [];
    createLogger({ sink: { write: (_l, line) => lines.push(line) } }).info('x');
    expect(lines[0]).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3} /);
  });
});
