import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { createNdjsonLogger, createStatusFileWriter } from '../../src/report/files.js';
import type { DaemonSnapshot, LiveTestEvent } from '../../src/types/events.js';
import { toNative } from '../../src/util/paths.js';
import { createTempProject } from '../helpers/tmp.js';

const event = (seq: number): LiveTestEvent => ({
  type: 'watch.change',
  seq,
  timestamp: 1000 + seq,
  path: '/proj/src/a.ts',
  kind: 'change',
});

const snapshot = (): DaemonSnapshot => ({
  pid: 1,
  root: '/proj',
  version: '0.1.0',
  protocolVersion: 1,
  startedAt: 0,
  running: false,
  lastBatch: null,
  files: [],
  totals: { batches: 0, runs: 0, failedRuns: 0 },
});

describe('createNdjsonLogger', () => {
  it('escreve um evento por linha', () => {
    const project = createTempProject();
    try {
      const logger = createNdjsonLogger({ file: '.livetest/run.log', root: project.root });
      logger.write(event(1));
      logger.write(event(2));
      logger.close();

      const lines = fs.readFileSync(toNative(logger.file), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0] as string)).toMatchObject({ type: 'watch.change', seq: 1 });
    } finally {
      project.cleanup();
    }
  });

  it('cria o diretorio do arquivo', () => {
    const project = createTempProject();
    try {
      const logger = createNdjsonLogger({ file: 'fundo/do/poco/run.log', root: project.root });
      logger.write(event(1));
      logger.close();
      expect(fs.existsSync(toNative(project.path('fundo/do/poco/run.log')))).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  it('anexa a um log existente', () => {
    const project = createTempProject({ '.livetest/run.log': '{"antigo":true}\n' });
    try {
      const logger = createNdjsonLogger({ file: '.livetest/run.log', root: project.root });
      logger.write(event(1));
      logger.close();
      const content = fs.readFileSync(toNative(logger.file), 'utf8');
      expect(content).toContain('antigo');
      expect(content.trim().split('\n')).toHaveLength(2);
    } finally {
      project.cleanup();
    }
  });

  it('rotaciona ao passar do tamanho maximo', () => {
    const project = createTempProject();
    try {
      const logger = createNdjsonLogger({
        file: '.livetest/run.log',
        root: project.root,
        maxBytes: 50,
      });
      for (let i = 1; i <= 6; i++) logger.write(event(i));
      logger.close();
      expect(fs.existsSync(toNative(`${logger.file}.1`))).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  it('reporta erro de escrita sem lancar', () => {
    const onError = vi.fn();
    // Um diretorio no lugar do arquivo torna a abertura impossivel.
    const project = createTempProject({ '.livetest/run.log/marcador': '' });
    try {
      const logger = createNdjsonLogger({ file: '.livetest/run.log', root: project.root, onError });
      expect(() => logger.write(event(1))).not.toThrow();
      expect(onError).toHaveBeenCalled();
      logger.close();
    } finally {
      project.cleanup();
    }
  });

  it('close e idempotente', () => {
    const project = createTempProject();
    try {
      const logger = createNdjsonLogger({ file: '.livetest/run.log', root: project.root });
      logger.write(event(1));
      logger.close();
      expect(() => logger.close()).not.toThrow();
    } finally {
      project.cleanup();
    }
  });
});

describe('createStatusFileWriter', () => {
  it('escreve o snapshot como JSON identado', () => {
    const project = createTempProject();
    try {
      const writer = createStatusFileWriter({ file: '.livetest/status.json', root: project.root });
      writer.write(snapshot());
      const parsed = JSON.parse(fs.readFileSync(toNative(writer.file), 'utf8')) as DaemonSnapshot;
      expect(parsed.version).toBe('0.1.0');
    } finally {
      project.cleanup();
    }
  });

  it('nao deixa arquivo temporario para tras', () => {
    const project = createTempProject();
    try {
      const writer = createStatusFileWriter({ file: '.livetest/status.json', root: project.root });
      writer.write(snapshot());
      expect(fs.existsSync(toNative(`${writer.file}.tmp`))).toBe(false);
    } finally {
      project.cleanup();
    }
  });

  it('sobrescreve a cada escrita', () => {
    const project = createTempProject();
    try {
      const writer = createStatusFileWriter({ file: '.livetest/status.json', root: project.root });
      writer.write(snapshot());
      writer.write({ ...snapshot(), running: true });
      const parsed = JSON.parse(fs.readFileSync(toNative(writer.file), 'utf8')) as DaemonSnapshot;
      expect(parsed.running).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  it('remove o arquivo no encerramento', () => {
    const project = createTempProject();
    try {
      const writer = createStatusFileWriter({ file: '.livetest/status.json', root: project.root });
      writer.write(snapshot());
      writer.remove();
      expect(fs.existsSync(toNative(writer.file))).toBe(false);
    } finally {
      project.cleanup();
    }
  });

  it('reporta erro sem lancar', () => {
    const onError = vi.fn();
    const project = createTempProject({ '.livetest/status.json/marcador': '' });
    try {
      const writer = createStatusFileWriter({
        file: '.livetest/status.json',
        root: project.root,
        onError,
      });
      expect(() => writer.write(snapshot())).not.toThrow();
      expect(onError).toHaveBeenCalled();
    } finally {
      project.cleanup();
    }
  });
});

describe('createNdjsonLogger — falhas de melhor esforco', () => {
  it('assume tamanho zero quando o stat do arquivo falha', () => {
    const project = createTempProject();
    const spy = vi.spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('EPERM');
    });
    try {
      const logger = createNdjsonLogger({ file: '.livetest/run.log', root: project.root });
      expect(() => logger.write(event(1))).not.toThrow();
      logger.close();
    } finally {
      spy.mockRestore();
      project.cleanup();
    }
  });

  it('segue anexando quando a rotacao falha', () => {
    const project = createTempProject();
    const logger = createNdjsonLogger({
      file: '.livetest/run.log',
      root: project.root,
      maxBytes: 1,
    });
    logger.write(event(1));

    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('EBUSY');
    });
    try {
      expect(() => logger.write(event(2))).not.toThrow();
      logger.close();
      expect(fs.readFileSync(toNative(logger.file), 'utf8')).toContain('"seq":2');
    } finally {
      spy.mockRestore();
      project.cleanup();
    }
  });

  it('ignora falha ao fechar o descritor', () => {
    const project = createTempProject();
    const logger = createNdjsonLogger({ file: '.livetest/run.log', root: project.root });
    logger.write(event(1));

    const spy = vi.spyOn(fs, 'closeSync').mockImplementation(() => {
      throw new Error('EBADF');
    });
    try {
      expect(() => logger.close()).not.toThrow();
    } finally {
      spy.mockRestore();
      project.cleanup();
    }
  });

  it('close sem nenhuma escrita nao abre arquivo', () => {
    const project = createTempProject();
    try {
      const logger = createNdjsonLogger({ file: '.livetest/run.log', root: project.root });
      expect(() => logger.close()).not.toThrow();
      expect(fs.existsSync(toNative(logger.file))).toBe(false);
    } finally {
      project.cleanup();
    }
  });

  it('nao exige callback de erro', () => {
    const project = createTempProject({ '.livetest/run.log/marcador': '' });
    try {
      const logger = createNdjsonLogger({ file: '.livetest/run.log', root: project.root });
      expect(() => logger.write(event(1))).not.toThrow();
    } finally {
      project.cleanup();
    }
  });
});

describe('createStatusFileWriter — falhas de melhor esforco', () => {
  it('ignora falha ao remover o arquivo', () => {
    const project = createTempProject();
    const writer = createStatusFileWriter({ file: '.livetest/status.json', root: project.root });
    writer.write(snapshot());

    const spy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw new Error('EPERM');
    });
    try {
      expect(() => writer.remove()).not.toThrow();
    } finally {
      spy.mockRestore();
      project.cleanup();
    }
  });

  it('nao exige callback de erro', () => {
    const project = createTempProject({ '.livetest/status.json/marcador': '' });
    try {
      const writer = createStatusFileWriter({ file: '.livetest/status.json', root: project.root });
      expect(() => writer.write(snapshot())).not.toThrow();
    } finally {
      project.cleanup();
    }
  });
});
