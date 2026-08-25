import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  defaultPythonPath,
  findConfigFile,
  loadConfig,
  mergeRunnerConfig,
  mergeUserConfig,
  readConfigFile,
  resolveConfig,
  stripJsonComments,
} from '../../src/config/load.js';
import { LiveTestError } from '../../src/util/errors.js';
import type { RunnerConfig } from '../../src/types/config.js';
import { normalizePath } from '../../src/util/paths.js';
import { createTempProject } from '../helpers/tmp.js';

describe('stripJsonComments', () => {
  it('remove comentario de linha', () => {
    expect(JSON.parse(stripJsonComments('{"a": 1 // nota\n}'))).toEqual({ a: 1 });
  });

  it('remove comentario de bloco', () => {
    expect(JSON.parse(stripJsonComments('{/* nota */ "a": 1}'))).toEqual({ a: 1 });
  });

  it('preserva barras dentro de strings', () => {
    expect(JSON.parse(stripJsonComments('{"a": "http://x/y"}'))).toEqual({ a: 'http://x/y' });
  });

  it('preserva aspas escapadas dentro de strings', () => {
    expect(JSON.parse(stripJsonComments('{"a": "diz \\"oi\\" // nao"}'))).toEqual({
      a: 'diz "oi" // nao',
    });
  });
});

describe('findConfigFile', () => {
  it('encontra o arquivo na propria pasta', () => {
    const project = createTempProject({ 'livetest.config.json': '{}' });
    try {
      expect(findConfigFile(project.root)).toBe(project.path('livetest.config.json'));
    } finally {
      project.cleanup();
    }
  });

  it('sobe diretorios ate encontrar', () => {
    const project = createTempProject({ 'livetest.config.json': '{}', 'src/deep/keep.txt': '' });
    try {
      expect(findConfigFile(project.path('src/deep'))).toBe(project.path('livetest.config.json'));
    } finally {
      project.cleanup();
    }
  });

  it('devolve null quando nao existe', () => {
    const project = createTempProject({ 'a.txt': '' });
    try {
      // A raiz do sistema nao tem livetest.config.json em ambiente de teste.
      const found = findConfigFile(project.root);
      expect(found).toBeNull();
    } finally {
      project.cleanup();
    }
  });
});

describe('readConfigFile', () => {
  it('le JSON com comentarios', () => {
    const project = createTempProject({
      'livetest.config.json': '{\n // nota\n "concurrency": 4\n}',
    });
    try {
      return expect(readConfigFile(project.path('livetest.config.json'))).resolves.toEqual({
        concurrency: 4,
      });
    } finally {
      project.cleanup();
    }
  });

  it('le modulo .mjs com export default', async () => {
    const project = createTempProject({
      'livetest.config.mjs': 'export default { concurrency: 3 };',
    });
    try {
      await expect(readConfigFile(project.path('livetest.config.mjs'))).resolves.toEqual({
        concurrency: 3,
      });
    } finally {
      project.cleanup();
    }
  });

  it('lanca CONFIG_NOT_FOUND para arquivo inexistente', async () => {
    await expect(readConfigFile('/nao/existe/livetest.config.json')).rejects.toMatchObject({
      code: 'CONFIG_NOT_FOUND',
    });
  });

  it('lanca CONFIG_LOAD_FAILED para JSON invalido', async () => {
    const project = createTempProject({ 'livetest.config.json': '{ invalido' });
    try {
      await expect(readConfigFile(project.path('livetest.config.json'))).rejects.toMatchObject({
        code: 'CONFIG_LOAD_FAILED',
      });
    } finally {
      project.cleanup();
    }
  });
});

describe('mergeUserConfig', () => {
  it('faz o override vencer nos campos simples', () => {
    expect(mergeUserConfig({ concurrency: 1 }, { concurrency: 5 }).concurrency).toBe(5);
  });

  it('mescla overrides de profundidade em vez de substituir', () => {
    const merged = mergeUserConfig(
      { dependencyDepth: { default: 'self', overrides: { 'a/**': 'direct' } } },
      { dependencyDepth: { overrides: { 'b/**': 'transitive' } } },
    );
    expect(merged.dependencyDepth).toEqual({
      default: 'self',
      overrides: { 'a/**': 'direct', 'b/**': 'transitive' },
    });
  });

  it('mescla runners chave a chave', () => {
    const merged = mergeUserConfig(
      { runners: { js: { adapter: 'vitest', match: ['**/*.ts'] } } },
      { runners: { js: { adapter: 'jest' } } },
    );
    expect(merged.runners?.['js']).toEqual({ adapter: 'jest', match: ['**/*.ts'] });
  });

  it('mantem runners undefined quando nenhum lado define', () => {
    expect(mergeUserConfig({}, {}).runners).toBeUndefined();
  });
});

describe('resolveConfig', () => {
  const root = normalizePath('/proj');

  it('preenche todos os defaults', () => {
    const { config } = resolveConfig({ useGitignore: false }, { root });
    expect(config.debounce).toEqual({ mode: 'both', idleMs: 400, maxBatchWindowMs: 3000 });
    expect(config.dependencyDepth.default).toBe('direct');
    expect(config.concurrency).toBe(2);
    expect(config.output.logFile).toBe('.livetest/run.log');
    expect(config.server).toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      discoveryFile: '.livetest/daemon.json',
    });
  });

  it('ativa os runners embutidos por padrao', () => {
    const { config } = resolveConfig({ useGitignore: false }, { root });
    expect(Object.keys(config.runners).sort()).toEqual(['js', 'python']);
    expect(config.runners['js']?.adapter).toBe('vitest');
    expect(config.runners['python']?.graph).toBe('python');
  });

  it('restringe aos runners declarados pelo usuario', () => {
    const { config } = resolveConfig(
      { useGitignore: false, runners: { js: { adapter: 'jest' } } },
      { root },
    );
    expect(Object.keys(config.runners)).toEqual(['js']);
    // A base embutida continua fornecendo match e testPatterns.
    expect(config.runners['js']?.adapter).toBe('jest');
    expect(config.runners['js']?.testPatterns?.length).toBeGreaterThan(0);
  });

  it('aceita runner totalmente novo', () => {
    const { config } = resolveConfig(
      {
        useGitignore: false,
        runners: { go: { adapter: 'command', command: 'go', match: ['**/*.go'] } },
      },
      { root },
    );
    expect(config.runners['go']).toMatchObject({ adapter: 'command', command: 'go' });
  });

  it('avisa quando nenhum runner fica ativo', () => {
    const { warnings } = resolveConfig({ useGitignore: false, runners: {} }, { root });
    expect(warnings.join(' ')).toContain('Nenhum runner ativo');
  });

  it('soma ignores do usuario aos defaults', () => {
    const { config } = resolveConfig({ useGitignore: false, ignore: ['meu/**'] }, { root });
    expect(config.ignore).toContain('**/node_modules/**');
    expect(config.ignore).toContain('meu/**');
  });

  it('normaliza a raiz para caminho absoluto POSIX', () => {
    const { config } = resolveConfig({ useGitignore: false, root: 'sub' }, { root });
    expect(config.root).toBe(normalizePath('sub', root));
  });
});

describe('loadConfig', () => {
  it('funciona sem arquivo de configuracao', async () => {
    const project = createTempProject({ 'src/a.ts': '' });
    try {
      const { config } = await loadConfig({ cwd: project.root });
      expect(config.root).toBe(project.root);
      expect(config.configPath).toBeNull();
    } finally {
      project.cleanup();
    }
  });

  it('carrega e normaliza o arquivo encontrado', async () => {
    const project = createTempProject({
      'livetest.config.json': JSON.stringify({
        useGitignore: false,
        debounce: { idleMs: 100 },
        dependencyDepth: { default: 'transitive' },
      }),
    });
    try {
      const { config } = await loadConfig({ cwd: project.root });
      expect(config.configPath).toBe(project.path('livetest.config.json'));
      expect(config.debounce.idleMs).toBe(100);
      expect(config.debounce.maxBatchWindowMs).toBe(3000);
      expect(config.dependencyDepth.default).toBe('transitive');
    } finally {
      project.cleanup();
    }
  });

  it('aplica sobrescritas da linha de comando por ultimo', async () => {
    const project = createTempProject({
      'livetest.config.json': JSON.stringify({ useGitignore: false, concurrency: 1 }),
    });
    try {
      const { config } = await loadConfig({
        cwd: project.root,
        overrides: { concurrency: 8, dryRun: true },
      });
      expect(config.concurrency).toBe(8);
      expect(config.dryRun).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  it('incorpora o .gitignore quando habilitado', async () => {
    const project = createTempProject({
      '.gitignore': 'gerado/\n',
      'livetest.config.json': '{}',
    });
    try {
      const { config } = await loadConfig({ cwd: project.root });
      expect(config.ignore).toContain('**/gerado/**');
    } finally {
      project.cleanup();
    }
  });

  it('lanca CONFIG_INVALID com a lista de problemas', async () => {
    const project = createTempProject({
      'livetest.config.json': JSON.stringify({ concurrency: 0, debounce: { mode: 'x' } }),
    });
    try {
      const error = await loadConfig({ cwd: project.root }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LiveTestError);
      expect((error as LiveTestError).code).toBe('CONFIG_INVALID');
      expect((error as LiveTestError).details).toHaveLength(2);
    } finally {
      project.cleanup();
    }
  });

  it('valida tambem o resultado apos as sobrescritas', async () => {
    const project = createTempProject({ 'livetest.config.json': '{}' });
    try {
      await expect(
        loadConfig({ cwd: project.root, overrides: { concurrency: -1 } }),
      ).rejects.toThrow(/sobrescritas/);
    } finally {
      project.cleanup();
    }
  });
});

describe('readConfigFile — falhas de leitura e importacao', () => {
  it('lanca CONFIG_LOAD_FAILED quando o arquivo existe mas nao pode ser lido', async () => {
    const project = createTempProject({ 'livetest.config.json': '{}' });
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('EACCES: permissao negada');
    });
    try {
      await expect(readConfigFile(project.path('livetest.config.json'))).rejects.toMatchObject({
        code: 'CONFIG_LOAD_FAILED',
      });
    } finally {
      spy.mockRestore();
      project.cleanup();
    }
  });

  it('lanca CONFIG_LOAD_FAILED quando o modulo tem erro de sintaxe', async () => {
    const project = createTempProject({ 'livetest.config.mjs': 'export default {' });
    try {
      await expect(readConfigFile(project.path('livetest.config.mjs'))).rejects.toMatchObject({
        code: 'CONFIG_LOAD_FAILED',
      });
    } finally {
      project.cleanup();
    }
  });

  it('aceita modulo que exporta a configuracao sem default', async () => {
    const project = createTempProject({ 'livetest.config.mjs': 'export const concurrency = 5;' });
    try {
      const config = await readConfigFile(project.path('livetest.config.mjs'));
      expect(config).toMatchObject({ concurrency: 5 });
    } finally {
      project.cleanup();
    }
  });

  it('trata arquivo sem extensao como JSON', async () => {
    const project = createTempProject({ '.livetestrc': '{"concurrency": 2}' });
    try {
      await expect(readConfigFile(project.path('.livetestrc'))).resolves.toEqual({
        concurrency: 2,
      });
    } finally {
      project.cleanup();
    }
  });
});

describe('loadConfig — arquivo explicito', () => {
  it('usa o caminho informado em vez de procurar', async () => {
    const project = createTempProject({
      'config/meu.json': JSON.stringify({ useGitignore: false, concurrency: 7 }),
    });
    try {
      const { config } = await loadConfig({
        cwd: project.root,
        configFile: 'config/meu.json',
      });
      expect(config.concurrency).toBe(7);
      expect(config.configPath).toBe(project.path('config/meu.json'));
      // A raiz passa a ser o diretorio do arquivo informado.
      expect(config.root).toBe(project.path('config'));
    } finally {
      project.cleanup();
    }
  });

  it('propaga CONFIG_NOT_FOUND para caminho inexistente', async () => {
    const project = createTempProject({});
    try {
      await expect(
        loadConfig({ cwd: project.root, configFile: 'nao/existe.json' }),
      ).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' });
    } finally {
      project.cleanup();
    }
  });
});

describe('stripJsonComments — casos de borda', () => {
  it('preserva barra solta fora de string', () => {
    expect(stripJsonComments('{"a": 1}').trim()).toBe('{"a": 1}');
  });

  it('remove comentario de bloco sem fechamento ate o fim', () => {
    expect(JSON.parse(stripJsonComments('{"a": 1} /* sobra'))).toEqual({ a: 1 });
  });

  it('remove comentario de linha sem quebra final', () => {
    expect(JSON.parse(stripJsonComments('{"a": 1} // fim'))).toEqual({ a: 1 });
  });

  it('trata contrabarra no fim da entrada sem estourar', () => {
    // Uma contrabarra final dentro de string: o escape nao tem proximo caractere.
    const contrabarra = String.fromCharCode(92);
    expect(() => stripJsonComments(`{"a": "x${contrabarra}`)).not.toThrow();
  });
});

describe('mergeRunnerConfig', () => {
  const base = {
    adapter: 'vitest',
    match: ['**/*.ts'],
    args: ['--base'],
    env: { BASE: '1' },
    timeoutMs: 1000,
    testPatterns: ['{dir}/{name}.test.{ext}'],
    testMatch: ['**/*.test.ts'],
    testExtensions: ['ts'],
    graph: 'js-ts',
    command: 'npx',
    cwd: 'base-dir',
  } satisfies RunnerConfig;

  it('aplica os defaults quando nao ha base nem usuario', () => {
    expect(mergeRunnerConfig(undefined, undefined)).toEqual({
      adapter: 'command',
      match: [],
      graph: undefined,
      args: [],
      env: {},
      timeoutMs: 120_000,
      testPatterns: [],
      testMatch: [],
      testExtensions: [],
    });
  });

  it('herda todos os campos da base quando o usuario nao declara nada', () => {
    expect(mergeRunnerConfig({ ...base }, undefined)).toMatchObject({
      adapter: 'vitest',
      command: 'npx',
      cwd: 'base-dir',
      graph: 'js-ts',
      timeoutMs: 1000,
    });
  });

  it('o usuario vence campo a campo', () => {
    const merged = mergeRunnerConfig({ ...base }, {
      adapter: 'jest',
      command: 'pnpm',
      cwd: 'user-dir',
      timeoutMs: 5000,
      match: ['**/*.tsx'],
    });
    expect(merged).toMatchObject({
      adapter: 'jest',
      command: 'pnpm',
      cwd: 'user-dir',
      timeoutMs: 5000,
      match: ['**/*.tsx'],
    });
    // Campos nao declarados continuam vindo da base.
    expect(merged.testPatterns).toEqual(['{dir}/{name}.test.{ext}']);
  });

  it('mescla env somando os dois lados', () => {
    const merged = mergeRunnerConfig({ ...base }, { env: { USER: '2' } });
    expect(merged.env).toEqual({ BASE: '1', USER: '2' });
  });

  it('omite command e cwd quando nenhum lado os define', () => {
    const merged = mergeRunnerConfig({ adapter: 'command', match: [] }, {});
    expect('command' in merged).toBe(false);
    expect('cwd' in merged).toBe(false);
  });

  it('aceita command e cwd vindos apenas do usuario', () => {
    const merged = mergeRunnerConfig(undefined, { command: 'go', cwd: 'pkg' });
    expect(merged).toMatchObject({ command: 'go', cwd: 'pkg' });
  });
});

describe('defaultPythonPath', () => {
  it('usa python no Windows', () => {
    expect(defaultPythonPath('win32')).toBe('python');
  });

  it('usa python3 nas demais plataformas', () => {
    expect(defaultPythonPath('linux')).toBe('python3');
    expect(defaultPythonPath('darwin')).toBe('python3');
  });

  it('usa a plataforma atual por padrao', () => {
    expect(['python', 'python3']).toContain(defaultPythonPath());
  });
});

describe('resolveConfig — runner sem base embutida', () => {
  it('aplica os defaults minimos', () => {
    const { config } = resolveConfig(
      { useGitignore: false, runners: { go: { adapter: 'command', command: 'go' } } },
      { root: normalizePath('/proj') },
    );
    expect(config.runners['go']).toMatchObject({ adapter: 'command', match: [], timeoutMs: 120_000 });
  });

  it('cai para o adapter command quando nada e declarado', () => {
    const { config } = resolveConfig(
      { useGitignore: false, runners: { misterioso: {} } },
      { root: normalizePath('/proj') },
    );
    expect(config.runners['misterioso']?.adapter).toBe('command');
  });
});

describe('mergeUserConfig — runner so no override', () => {
  it('cria a chave que nao existia na base', () => {
    const merged = mergeUserConfig({}, { runners: { go: { adapter: 'command' } } });
    expect(merged.runners?.['go']).toEqual({ adapter: 'command' });
  });
});

describe('loadConfig — sem cwd explicito', () => {
  it('usa o diretorio de trabalho do processo', async () => {
    const { config } = await loadConfig();
    expect(config.root.length).toBeGreaterThan(0);
  });
});
