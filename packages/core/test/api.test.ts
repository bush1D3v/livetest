/**
 * Contrato da superficie publica.
 *
 * Nao testa comportamento — isso e papel dos testes de cada modulo. O que este
 * arquivo protege e o **barril de exports**: um `export` esquecido ou renomeado
 * quebra consumidores sem quebrar nenhum outro teste.
 */

import { describe, expect, it } from 'vitest';

import * as api from '../src/index.js';
import * as client from '../src/client.js';

/** Nomes que a API principal precisa exportar. */
const API_ESPERADA = [
  // motor
  'createEngine',
  'ENGINE_VERSION',
  // configuracao
  'loadConfig',
  'resolveConfig',
  'readConfigFile',
  'findConfigFile',
  'mergeUserConfig',
  'mergeRunnerConfig',
  'defaultPythonPath',
  'stripJsonComments',
  'validateUserConfig',
  'assertValidUserConfig',
  'isDependencyDepth',
  'depthToNumber',
  'describeDepth',
  'resolveDepthForFile',
  'parseGitignore',
  'readGitignore',
  // grafo
  'createDependencyGraph',
  'createGraphAdapters',
  'BUILTIN_GRAPH_ADAPTERS',
  'createJsTsGraphAdapter',
  'loadCompilerOptions',
  'createPythonGraphAdapter',
  'createAstPythonExtractor',
  'createRegexPythonExtractor',
  'parsePythonImports',
  'findPackageRoot',
  'resolveImportRecord',
  'resolveAllImports',
  // testes e plano
  'createTestFileResolver',
  'expandTemplate',
  'planBatch',
  'summarizeReason',
  // execucao
  'executeRun',
  'formatCommand',
  'tailLines',
  'createRunnerAdapter',
  'BUILTIN_RUNNER_ADAPTERS',
  'createCommandAdapter',
  'createVitestAdapter',
  'createJestAdapter',
  'createPytestAdapter',
  'parseJestLikeJson',
  'parseJUnitXml',
  'runProcess',
  'needsShell',
  'quoteForShell',
  // observacao
  'createFileWatcher',
  'chokidarWatcherFactory',
  'createDebouncer',
  // eventos, estado e saidas
  'createEventBus',
  'createStateStore',
  'aggregateBatch',
  'deriveBatchStatus',
  'sumCounts',
  'createPrettyReporter',
  'formatSummaryLine',
  'cleanFailureMessage',
  'SUMMARY_PREFIX',
  'createNdjsonLogger',
  'createStatusFileWriter',
  // canal de eventos
  'createEventServer',
  'encodeEvent',
  'resolveServerAddress',
  'connectToDaemon',
  'createLineSplitter',
  'readDiscoveryFile',
  'writeDiscoveryFile',
  'removeDiscoveryFile',
  'isProcessAlive',
  'EVENT_PROTOCOL_VERSION',
  // utilitarios
  'LiveTestError',
  'createLogger',
  'noopLogger',
  'normalizePath',
  'relativeToRoot',
  'toPosix',
  // defaults
  'DEFAULT_JS_RUNNER',
  'DEFAULT_PY_RUNNER',
  'DEFAULT_DEBOUNCE',
  'DEFAULT_OUTPUT',
  'DEFAULT_SERVER',
  'CONFIG_FILE_NAMES',
] as const;

/** Nomes que a superficie cliente precisa exportar. */
const CLIENTE_ESPERADO = [
  'connectToDaemon',
  'createLineSplitter',
  'readDiscoveryFile',
  'writeDiscoveryFile',
  'removeDiscoveryFile',
  'isProcessAlive',
  'summarizeReason',
  'normalizePath',
  'relativeToRoot',
  'toPosix',
  'LiveTestError',
  'EVENT_PROTOCOL_VERSION',
] as const;

describe('@livetest/core — superficie publica', () => {
  it.each(API_ESPERADA)('exporta %s', (nome) => {
    expect(api).toHaveProperty(nome);
    expect((api as Record<string, unknown>)[nome]).toBeDefined();
  });

  it('nao exporta nada indefinido', () => {
    const indefinidos = Object.entries(api)
      .filter(([, valor]) => valor === undefined)
      .map(([nome]) => nome);
    expect(indefinidos).toEqual([]);
  });

  it('expoe a versao do motor', () => {
    expect(api.ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('@livetest/core/client — superficie enxuta', () => {
  it.each(CLIENTE_ESPERADO)('exporta %s', (nome) => {
    expect(client).toHaveProperty(nome);
  });

  it('nao arrasta o motor nem o compilador TypeScript', () => {
    // A razao de existir do ponto de entrada cliente: uma extensao que so le
    // eventos nao deve carregar o grafo, os runners e o `typescript` junto.
    const exportados = Object.keys(client);
    expect(exportados).not.toContain('createEngine');
    expect(exportados).not.toContain('createJsTsGraphAdapter');
    expect(exportados).not.toContain('createFileWatcher');
    expect(exportados).not.toContain('runProcess');
  });

  it('compartilha a implementacao com a API principal', () => {
    expect(client.connectToDaemon).toBe(api.connectToDaemon);
    expect(client.summarizeReason).toBe(api.summarizeReason);
    expect(client.LiveTestError).toBe(api.LiveTestError);
  });
});
