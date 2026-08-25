/**
 * Contrato da superficie publica da CLI.
 *
 * Protege o barril de exports: um `export` esquecido quebra quem embute a CLI
 * sem quebrar nenhum outro teste.
 */

import { describe, expect, it } from 'vitest';

import * as api from '../src/index.js';

const ESPERADO = [
  'runCli',
  'COMMANDS',
  'CLI_VERSION',
  'findCommand',
  'generalHelp',
  'commandHelp',
  'parseArgs',
  'formatFlagHelp',
  'buildOverrides',
  'parseDepthFlag',
  'processOutput',
  'EXIT',
  'GLOBAL_FLAGS',
  'CONFIG_OVERRIDE_FLAGS',
] as const;

describe('@livetest/cli — superficie publica', () => {
  it.each(ESPERADO)('exporta %s', (nome) => {
    expect(api).toHaveProperty(nome);
    expect((api as Record<string, unknown>)[nome]).toBeDefined();
  });

  it('nao exporta nada indefinido', () => {
    const indefinidos = Object.entries(api)
      .filter(([, valor]) => valor === undefined)
      .map(([nome]) => nome);
    expect(indefinidos).toEqual([]);
  });

  it('expoe a versao da CLI', () => {
    expect(api.CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('expoe os codigos de saida documentados', () => {
    expect(api.EXIT).toEqual({
      ok: 0,
      testsFailed: 1,
      usage: 2,
      config: 3,
      daemon: 4,
      internal: 70,
    });
  });
});

describe('processOutput', () => {
  it('escreve no stdout e no stderr do processo', async () => {
    const { vi } = await import('vitest');
    const saida = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const erro = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      api.processOutput.out('linha de saida');
      api.processOutput.err('linha de erro');
      expect(saida).toHaveBeenCalledWith('linha de saida\n');
      expect(erro).toHaveBeenCalledWith('linha de erro\n');
    } finally {
      saida.mockRestore();
      erro.mockRestore();
    }
  });

  it('e o destino padrao de runCli', async () => {
    const { vi } = await import('vitest');
    const saida = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(await api.runCli({ argv: ['--version'] })).toBe(api.EXIT.ok);
      expect(saida).toHaveBeenCalled();
    } finally {
      saida.mockRestore();
    }
  });
});
