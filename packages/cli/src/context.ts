/**
 * Infraestrutura compartilhada pelos comandos da CLI.
 * @packageDocumentation
 */

import type { DependencyDepth, LiveTestUserConfig, LogLevel } from '@livetest/core';
import { LiveTestError, loadConfig, type LoadConfigResult } from '@livetest/core';

import type { FlagSpecs, FlagValue } from './args.js';

/** Codigos de saida do processo, estaveis para uso em scripts e CI. */
export const EXIT = {
  /** Tudo certo. */
  ok: 0,
  /** Testes falharam. */
  testsFailed: 1,
  /** Erro de uso: flag invalida, comando desconhecido. */
  usage: 2,
  /** Erro de configuracao. */
  config: 3,
  /** Daemon nao encontrado ou inacessivel. */
  daemon: 4,
  /** Erro inesperado. */
  internal: 70,
} as const;

/** Canal de saida, injetavel para testes. */
export interface OutputChannel {
  /** Escreve no stdout. */
  out(line: string): void;
  /** Escreve no stderr. */
  err(line: string): void;
}

/** Canal padrao, ligado ao processo. */
export const processOutput: OutputChannel = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

/** Contexto entregue a cada comando. */
export interface CommandContext {
  /** Argumentos posicionais do comando. */
  positionals: string[];
  /** Valores das flags. */
  flags: Record<string, FlagValue>;
  output: OutputChannel;
  /** Diretorio de trabalho. */
  cwd: string;
}

/** Um comando da CLI. */
export interface Command {
  readonly name: string;
  /** Resumo de uma linha, exibido na ajuda geral. */
  readonly summary: string;
  /** Linha de uso, ex.: `livetest run [arquivos...]`. */
  readonly usage: string;
  /** Flags aceitas alem das globais. */
  readonly flags: FlagSpecs;
  /** Texto adicional exibido no `--help` do comando. */
  readonly details?: string[];
  /** Executa o comando e devolve o codigo de saida. */
  run(context: CommandContext): Promise<number>;
}

/** Flags aceitas por todos os comandos. */
export const GLOBAL_FLAGS: FlagSpecs = {
  config: {
    type: 'string',
    alias: 'c',
    description: 'Caminho do arquivo de configuracao',
    valueName: 'caminho',
  },
  root: { type: 'string', description: 'Raiz do projeto', valueName: 'caminho' },
  'log-level': {
    type: 'string',
    description: 'Verbosidade: debug, info, warn, error, silent',
    valueName: 'nivel',
  },
  help: { type: 'boolean', alias: 'h', description: 'Mostra a ajuda deste comando' },
};

/** Flags que sobrescrevem a configuracao do arquivo. */
export const CONFIG_OVERRIDE_FLAGS: FlagSpecs = {
  depth: {
    type: 'string',
    alias: 'd',
    description: 'Profundidade: self, direct, transitive ou um numero',
    valueName: 'nivel',
  },
  'dry-run': { type: 'boolean', description: 'Mostra o plano sem executar os testes' },
  concurrency: { type: 'number', description: 'Execucoes simultaneas', valueName: 'n' },
  'idle-ms': { type: 'number', description: 'Debounce por inatividade, em ms', valueName: 'ms' },
  'max-window-ms': { type: 'number', description: 'Janela maxima do lote, em ms', valueName: 'ms' },
  json: { type: 'boolean', description: 'Emite eventos NDJSON no stdout, em vez do relatorio' },
  quiet: { type: 'boolean', alias: 'q', description: 'Nao escreve nada no stdout' },
  'no-color': { type: 'boolean', description: 'Desliga as cores' },
};

/** Converte o texto de `--depth` no valor tipado da configuracao. */
export function parseDepthFlag(raw: string): DependencyDepth {
  if (raw === 'self' || raw === 'direct' || raw === 'transitive') return raw;
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 0) return numeric;
  throw new LiveTestError(
    'CONFIG_INVALID',
    `--depth invalido: "${raw}". Use self, direct, transitive ou um inteiro >= 0.`,
  );
}

/** Monta as sobrescritas de configuracao a partir das flags. */
export function buildOverrides(flags: Record<string, FlagValue>): LiveTestUserConfig {
  const overrides: LiveTestUserConfig = {};

  if (typeof flags['root'] === 'string') overrides.root = flags['root'];
  if (typeof flags['log-level'] === 'string') {
    overrides.logLevel = flags['log-level'] as LogLevel;
  }
  if (typeof flags['depth'] === 'string') {
    overrides.dependencyDepth = { default: parseDepthFlag(flags['depth']) };
  }
  if (flags['dry-run'] === true) overrides.dryRun = true;
  if (typeof flags['concurrency'] === 'number') overrides.concurrency = flags['concurrency'];

  const debounce: NonNullable<LiveTestUserConfig['debounce']> = {};
  if (typeof flags['idle-ms'] === 'number') debounce.idleMs = flags['idle-ms'];
  if (typeof flags['max-window-ms'] === 'number') debounce.maxBatchWindowMs = flags['max-window-ms'];
  if (Object.keys(debounce).length > 0) overrides.debounce = debounce;

  const output: NonNullable<LiveTestUserConfig['output']> = {};
  if (flags['json'] === true) output.format = 'ndjson';
  if (flags['quiet'] === true) output.stdout = false;
  if (flags['no-color'] === true) output.color = false;
  if (Object.keys(output).length > 0) overrides.output = output;

  return overrides;
}

/**
 * Carrega a configuracao aplicando as flags, e reporta os avisos.
 *
 * @throws {@link LiveTestError} quando a configuracao e invalida.
 */
export async function loadConfigForCommand(
  context: CommandContext,
  extra: LiveTestUserConfig = {},
): Promise<LoadConfigResult> {
  const overrides = { ...buildOverrides(context.flags), ...extra };
  const result = await loadConfig({
    cwd: context.cwd,
    ...(typeof context.flags['config'] === 'string' ? { configFile: context.flags['config'] } : {}),
    overrides,
  });

  for (const warning of result.warnings) context.output.err(`aviso: ${warning}`);
  return result;
}

/** Traduz um erro em codigo de saida e mensagem. */
export function reportError(error: unknown, output: OutputChannel): number {
  if (error instanceof LiveTestError) {
    output.err(error.format());
    switch (error.code) {
      case 'CONFIG_INVALID':
      case 'CONFIG_NOT_FOUND':
      case 'CONFIG_LOAD_FAILED':
        return EXIT.config;
      case 'DAEMON_NOT_RUNNING':
      case 'DAEMON_ALREADY_RUNNING':
      case 'CONNECTION_FAILED':
        return EXIT.daemon;
      default:
        return EXIT.internal;
    }
  }
  output.err(error instanceof Error ? (error.stack ?? error.message) : String(error));
  return EXIT.internal;
}
