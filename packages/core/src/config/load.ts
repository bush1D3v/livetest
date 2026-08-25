/**
 * Descoberta, carregamento e normalizacao da configuracao.
 *
 * O resultado de {@link loadConfig} e um {@link ResolvedConfig} totalmente
 * preenchido, com **todos os caminhos absolutos em formato POSIX**, pronto para
 * ser consumido pelo restante do core sem novas verificacoes.
 *
 * @packageDocumentation
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  LiveTestUserConfig,
  ResolvedConfig,
  RunnerConfig,
} from '../types/config.js';
import { LiveTestError, errorMessage } from '../util/errors.js';
import { normalizePath } from '../util/paths.js';
import {
  CONFIG_FILE_NAMES,
  DEFAULT_CONCURRENCY,
  DEFAULT_DEBOUNCE,
  DEFAULT_DEPENDENCY_DEPTH,
  DEFAULT_IGNORE,
  DEFAULT_JS_RUNNER,
  DEFAULT_OUTPUT,
  DEFAULT_PY_RUNNER,
  DEFAULT_SERVER,
  DEFAULT_WATCH,
} from './defaults.js';
import { readGitignore } from './gitignore.js';
import { validateUserConfig } from './validate.js';

/** Opcoes de {@link loadConfig}. */
export interface LoadConfigOptions {
  /** Diretorio a partir do qual procurar o arquivo de configuracao. */
  cwd?: string;
  /** Caminho explicito do arquivo de configuracao. Ignora a busca automatica. */
  configFile?: string;
  /**
   * Sobrescritas aplicadas **depois** do arquivo, tipicamente vindas de flags
   * da CLI. Tem prioridade maxima.
   */
  overrides?: LiveTestUserConfig;
}

/** Retorno de {@link loadConfig}. */
export interface LoadConfigResult {
  config: ResolvedConfig;
  /** Avisos de validacao e de conversao do `.gitignore`. */
  warnings: string[];
}

/**
 * Procura um arquivo de configuracao subindo a partir de `cwd` ate a raiz do
 * sistema de arquivos.
 *
 * @returns Caminho absoluto POSIX, ou `null` se nenhum arquivo for encontrado.
 */
export function findConfigFile(cwd: string): string | null {
  let dir = path.resolve(cwd);
  for (;;) {
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return normalizePath(candidate);
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Le e faz o parse de um arquivo de configuracao.
 *
 * Aceita `.json` (JSON estrito, com comentarios `//` e `/* *\/` removidos) e
 * modulos `.js`/`.mjs`/`.cjs` que exportem a configuracao como `default`.
 *
 * @throws {@link LiveTestError} com codigo `CONFIG_LOAD_FAILED` em caso de erro.
 */
export async function readConfigFile(file: string): Promise<LiveTestUserConfig> {
  const absolute = normalizePath(file);
  if (!fs.existsSync(absolute)) {
    throw new LiveTestError('CONFIG_NOT_FOUND', `Arquivo de configuracao nao encontrado: ${absolute}`);
  }
  const ext = path.extname(absolute).toLowerCase();

  if (ext === '.json' || ext === '') {
    let raw: string;
    try {
      raw = fs.readFileSync(absolute, 'utf8');
    } catch (error) {
      throw new LiveTestError(
        'CONFIG_LOAD_FAILED',
        `Nao foi possivel ler ${absolute}: ${errorMessage(error)}`,
      );
    }
    try {
      return JSON.parse(stripJsonComments(raw)) as LiveTestUserConfig;
    } catch (error) {
      throw new LiveTestError(
        'CONFIG_LOAD_FAILED',
        `JSON invalido em ${absolute}: ${errorMessage(error)}`,
      );
    }
  }

  try {
    const module = (await import(pathToFileURL(absolute).href)) as {
      default?: LiveTestUserConfig;
    };
    const value = module.default ?? (module as unknown as LiveTestUserConfig);
    return value;
  } catch (error) {
    throw new LiveTestError(
      'CONFIG_LOAD_FAILED',
      `Falha ao importar ${absolute}: ${errorMessage(error)}`,
    );
  }
}

/**
 * Remove comentarios de linha e de bloco de um texto JSON, preservando o que
 * estiver dentro de strings.
 */
export function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;
    const next = input[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        const escaped = input[i + 1];
        if (escaped !== undefined) {
          out += escaped;
          i++;
        }
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Runners embutidos, usados como base quando o usuario declara apenas parte deles. */
const BUILTIN_RUNNERS: Readonly<Record<string, RunnerConfig>> = {
  js: DEFAULT_JS_RUNNER,
  python: DEFAULT_PY_RUNNER,
};

/**
 * Mescla a configuracao de um runner sobre uma base.
 *
 * @param base - Configuracao embutida do runner, quando existe.
 * @param user - O que o usuario declarou. Vence a base campo a campo.
 *
 * @example
 * ```ts
 * mergeRunnerConfig(DEFAULT_JS_RUNNER, { adapter: 'jest' }).testPatterns;
 * // os templates padrao continuam valendo
 * ```
 */
export function mergeRunnerConfig(
  base: RunnerConfig | undefined,
  user: Partial<RunnerConfig> | undefined,
): RunnerConfig {
  const merged: RunnerConfig = {
    adapter: user?.adapter ?? base?.adapter ?? 'command',
    match: user?.match ?? base?.match ?? [],
    graph: user?.graph ?? base?.graph,
    args: user?.args ?? base?.args ?? [],
    env: { ...(base?.env ?? {}), ...(user?.env ?? {}) },
    timeoutMs: user?.timeoutMs ?? base?.timeoutMs ?? 120_000,
    testPatterns: user?.testPatterns ?? base?.testPatterns ?? [],
    testMatch: user?.testMatch ?? base?.testMatch ?? [],
    testExtensions: user?.testExtensions ?? base?.testExtensions ?? [],
  };
  // `command` e `cwd` sao opcionais na forma resolvida: so aparecem quando
  // algum dos dois lados os define, para nao poluir o objeto com `undefined`.
  const command = user?.command ?? base?.command;
  if (command !== undefined) merged.command = command;
  const cwd = user?.cwd ?? base?.cwd;
  if (cwd !== undefined) merged.cwd = cwd;
  return merged;
}

/** Mescla duas configuracoes de usuario; `override` tem prioridade. */
export function mergeUserConfig(
  base: LiveTestUserConfig,
  override: LiveTestUserConfig,
): LiveTestUserConfig {
  const runners: LiveTestUserConfig['runners'] = { ...(base.runners ?? {}) };
  for (const [key, value] of Object.entries(override.runners ?? {})) {
    runners[key] = { ...(runners[key] ?? {}), ...value };
  }
  return {
    ...base,
    ...override,
    dependencyDepth: {
      ...(base.dependencyDepth ?? {}),
      ...(override.dependencyDepth ?? {}),
      overrides: {
        ...(base.dependencyDepth?.overrides ?? {}),
        ...(override.dependencyDepth?.overrides ?? {}),
      },
    },
    debounce: { ...(base.debounce ?? {}), ...(override.debounce ?? {}) },
    output: { ...(base.output ?? {}), ...(override.output ?? {}) },
    server: { ...(base.server ?? {}), ...(override.server ?? {}) },
    runners: Object.keys(runners).length > 0 ? runners : undefined,
  };
}

/**
 * Normaliza uma configuracao de usuario ja validada em {@link ResolvedConfig}.
 *
 * @param user - Configuracao do usuario (campos opcionais).
 * @param context - Raiz e caminho do arquivo de origem.
 * @returns Configuracao resolvida e avisos de normalizacao.
 */
export function resolveConfig(
  user: LiveTestUserConfig,
  context: { root: string; configPath?: string | null },
): { config: ResolvedConfig; warnings: string[] } {
  const warnings: string[] = [];
  const root = normalizePath(user.root ?? context.root, context.root);

  const useGitignore = user.useGitignore ?? true;
  const gitignore = useGitignore ? readGitignore(root) : { patterns: [], warnings: [] };
  warnings.push(...gitignore.warnings);

  const runnerKeys = new Set([...Object.keys(BUILTIN_RUNNERS), ...Object.keys(user.runners ?? {})]);
  const runners: Record<string, RunnerConfig> = {};
  // Quando o usuario declara `runners`, apenas as chaves declaradas ficam ativas;
  // os embutidos servem so como base de merge para `js` e `python`.
  const activeKeys = user.runners ? Object.keys(user.runners) : Object.keys(BUILTIN_RUNNERS);
  for (const key of runnerKeys) {
    if (!activeKeys.includes(key)) continue;
    runners[key] = mergeRunnerConfig(BUILTIN_RUNNERS[key], user.runners?.[key]);
  }

  const config: ResolvedConfig = {
    root,
    configPath: context.configPath ? normalizePath(context.configPath) : null,
    watch: user.watch ?? [...DEFAULT_WATCH],
    ignore: [...DEFAULT_IGNORE, ...gitignore.patterns, ...(user.ignore ?? [])],
    useGitignore,
    dependencyDepth: {
      default: user.dependencyDepth?.default ?? DEFAULT_DEPENDENCY_DEPTH.default,
      overrides: user.dependencyDepth?.overrides ?? {},
    },
    debounce: { ...DEFAULT_DEBOUNCE, ...(user.debounce ?? {}) },
    runners,
    output: { ...DEFAULT_OUTPUT, ...(user.output ?? {}) },
    server: { ...DEFAULT_SERVER, ...(user.server ?? {}) },
    concurrency: user.concurrency ?? DEFAULT_CONCURRENCY,
    dryRun: user.dryRun ?? false,
    pythonPath: user.pythonPath ?? defaultPythonPath(),
    logLevel: user.logLevel ?? 'info',
  };

  if (Object.keys(config.runners).length === 0) {
    warnings.push('Nenhum runner ativo: nenhum teste sera executado.');
  }
  return { config, warnings };
}

/**
 * Interpretador Python padrao.
 *
 * No Windows o executavel costuma se chamar `python`; nas demais plataformas,
 * `python3` (onde `python` pode nem existir, ou apontar para a versao 2).
 *
 * @param platform - Plataforma alvo. Informe explicitamente em teste.
 */
export function defaultPythonPath(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'python' : 'python3';
}

/**
 * Carrega a configuracao completa: encontra o arquivo, valida, mescla defaults
 * e normaliza.
 *
 * @example
 * ```ts
 * const { config, warnings } = await loadConfig({ cwd: process.cwd() });
 * console.log(config.root, config.debounce.idleMs);
 * ```
 *
 * @throws {@link LiveTestError} `CONFIG_INVALID` quando a validacao falha.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadConfigResult> {
  const cwd = normalizePath(options.cwd ?? process.cwd());
  const configPath = options.configFile
    ? normalizePath(options.configFile, cwd)
    : findConfigFile(cwd);

  let fromFile: LiveTestUserConfig = {};
  const fileWarnings: string[] = [];

  if (configPath) {
    fromFile = await readConfigFile(configPath);
    const validation = validateUserConfig(fromFile);
    if (!validation.ok) {
      throw new LiveTestError(
        'CONFIG_INVALID',
        `Configuracao invalida em ${configPath}`,
        validation.errors,
      );
    }
    fileWarnings.push(...validation.warnings);
  }

  const merged = options.overrides ? mergeUserConfig(fromFile, options.overrides) : fromFile;
  const overrideValidation = validateUserConfig(merged);
  if (!overrideValidation.ok) {
    throw new LiveTestError(
      'CONFIG_INVALID',
      'Configuracao invalida apos aplicar sobrescritas da linha de comando',
      overrideValidation.errors,
    );
  }

  const root = configPath ? path.dirname(configPath) : cwd;
  const resolved = resolveConfig(merged, { root, configPath });

  return {
    config: resolved.config,
    warnings: [...fileWarnings, ...overrideValidation.warnings, ...resolved.warnings],
  };
}
