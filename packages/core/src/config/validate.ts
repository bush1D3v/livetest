/**
 * Validacao estrutural da configuracao do usuario.
 *
 * A validacao e feita a mao (sem dependencia de schema em runtime) para manter
 * o pacote leve e as mensagens apontando o caminho exato do campo invalido —
 * ex.: `runners.js.timeoutMs`.
 *
 * Nenhuma funcao aqui lanca excecao: elas devolvem a lista de problemas para
 * que o chamador decida como reportar (a CLI formata no terminal, a extensao
 * mostra em notificacao).
 *
 * @packageDocumentation
 */

import type {
  DebounceMode,
  DependencyDepth,
  LiveTestUserConfig,
  LogLevel,
} from '../types/config.js';

/** Resultado da validacao. */
export interface ValidationResult {
  /** `true` quando nao ha nenhum erro (avisos nao impedem o uso). */
  ok: boolean;
  /** Mensagens de erro, uma por problema encontrado. */
  errors: string[];
  /** Avisos que nao impedem o uso da configuracao. */
  warnings: string[];
}

const DEBOUNCE_MODES: readonly DebounceMode[] = ['idle', 'batch', 'both'];
const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
const OUTPUT_FORMATS = ['pretty', 'ndjson'] as const;

const KNOWN_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  '$schema',
  'root',
  'watch',
  'ignore',
  'useGitignore',
  'dependencyDepth',
  'debounce',
  'runners',
  'output',
  'server',
  'concurrency',
  'dryRun',
  'pythonPath',
  'logLevel',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Verifica se um valor e uma {@link DependencyDepth} valida.
 *
 * @example
 * ```ts
 * isDependencyDepth('transitive'); // true
 * isDependencyDepth(-1);           // false
 * ```
 */
export function isDependencyDepth(value: unknown): value is DependencyDepth {
  if (value === 'self' || value === 'direct' || value === 'transitive') return true;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Converte uma {@link DependencyDepth} em numero de saltos no grafo reverso.
 *
 * @example
 * ```ts
 * depthToNumber('self');       // 0
 * depthToNumber('direct');     // 1
 * depthToNumber('transitive'); // Infinity
 * ```
 */
export function depthToNumber(depth: DependencyDepth): number {
  if (depth === 'self') return 0;
  if (depth === 'direct') return 1;
  if (depth === 'transitive') return Number.POSITIVE_INFINITY;
  return depth;
}

/** Descreve uma profundidade em texto curto, para logs e para a extensao. */
export function describeDepth(depth: DependencyDepth): string {
  if (depth === 'self') return 'apenas o proprio arquivo';
  if (depth === 'direct') return 'arquivo + importadores diretos';
  if (depth === 'transitive') return 'arquivo + cadeia completa de importadores';
  if (depth === 0) return 'apenas o proprio arquivo';
  return `arquivo + importadores ate ${depth} nivel(is)`;
}

/**
 * Valida um objeto de configuracao vindo de arquivo ou da API publica.
 *
 * @param input - Valor cru, tipicamente o `JSON.parse` de `livetest.config.json`.
 * @returns Erros e avisos encontrados. Nunca lanca.
 */
export function validateUserConfig(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: ['A configuracao deve ser um objeto JSON.'], warnings };
  }
  const cfg = input;

  for (const key of Object.keys(cfg)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) warnings.push(`Campo desconhecido ignorado: "${key}".`);
  }

  checkOptionalString(cfg, 'root', errors);
  checkOptionalString(cfg, 'pythonPath', errors);
  checkOptionalStringArray(cfg, 'watch', errors);
  checkOptionalStringArray(cfg, 'ignore', errors);
  checkOptionalBoolean(cfg, 'useGitignore', errors);
  checkOptionalBoolean(cfg, 'dryRun', errors);

  const concurrency = cfg['concurrency'];
  if (concurrency !== undefined) {
    if (typeof concurrency !== 'number' || !Number.isInteger(concurrency) || concurrency < 1) {
      errors.push('concurrency deve ser um inteiro maior ou igual a 1.');
    }
  }

  if (cfg['logLevel'] !== undefined && !LOG_LEVELS.includes(cfg['logLevel'] as LogLevel)) {
    errors.push(`logLevel deve ser um de: ${LOG_LEVELS.join(', ')}.`);
  }

  validateDependencyDepth(cfg['dependencyDepth'], errors);
  validateDebounce(cfg['debounce'], errors);
  validateRunners(cfg['runners'], errors, warnings);
  validateOutput(cfg['output'], errors);
  validateServer(cfg['server'], errors);

  return { ok: errors.length === 0, errors, warnings };
}

function checkOptionalString(cfg: Record<string, unknown>, key: string, errors: string[]): void {
  if (cfg[key] !== undefined && typeof cfg[key] !== 'string') {
    errors.push(`${key} deve ser uma string.`);
  }
}

function checkOptionalBoolean(cfg: Record<string, unknown>, key: string, errors: string[]): void {
  if (cfg[key] !== undefined && typeof cfg[key] !== 'boolean') {
    errors.push(`${key} deve ser um booleano.`);
  }
}

function checkOptionalStringArray(
  cfg: Record<string, unknown>,
  key: string,
  errors: string[],
): void {
  if (cfg[key] !== undefined && !isStringArray(cfg[key])) {
    errors.push(`${key} deve ser um array de strings.`);
  }
}

function validateDependencyDepth(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push('dependencyDepth deve ser um objeto.');
    return;
  }
  if (value['default'] !== undefined && !isDependencyDepth(value['default'])) {
    errors.push(
      'dependencyDepth.default deve ser "self", "direct", "transitive" ou um inteiro >= 0.',
    );
  }
  const overrides = value['overrides'];
  if (overrides === undefined) return;
  if (!isPlainObject(overrides)) {
    errors.push('dependencyDepth.overrides deve ser um objeto de glob -> profundidade.');
    return;
  }
  for (const [glob, depth] of Object.entries(overrides)) {
    if (!isDependencyDepth(depth)) {
      errors.push(
        `dependencyDepth.overrides["${glob}"] deve ser "self", "direct", "transitive" ou um inteiro >= 0.`,
      );
    }
  }
}

function validateDebounce(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push('debounce deve ser um objeto.');
    return;
  }
  if (value['mode'] !== undefined && !DEBOUNCE_MODES.includes(value['mode'] as DebounceMode)) {
    errors.push(`debounce.mode deve ser um de: ${DEBOUNCE_MODES.join(', ')}.`);
  }
  for (const key of ['idleMs', 'maxBatchWindowMs'] as const) {
    const ms = value[key];
    if (ms !== undefined && (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0)) {
      errors.push(`debounce.${key} deve ser um numero >= 0.`);
    }
  }
  const idle = value['idleMs'];
  const max = value['maxBatchWindowMs'];
  if (typeof idle === 'number' && typeof max === 'number' && max > 0 && idle > max) {
    errors.push('debounce.idleMs nao pode ser maior que debounce.maxBatchWindowMs.');
  }
}

function validateRunners(value: unknown, errors: string[], warnings: string[]): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push('runners deve ser um objeto.');
    return;
  }
  if (Object.keys(value).length === 0) {
    warnings.push('runners esta vazio: nenhum teste sera executado.');
  }
  for (const [key, runner] of Object.entries(value)) {
    validateRunner(`runners.${key}`, runner, errors);
  }
}

function validateRunner(path: string, runner: unknown, errors: string[]): void {
  if (!isPlainObject(runner)) {
    errors.push(`${path} deve ser um objeto.`);
    return;
  }
  for (const stringKey of ['adapter', 'command', 'graph', 'cwd'] as const) {
    if (runner[stringKey] !== undefined && typeof runner[stringKey] !== 'string') {
      errors.push(`${path}.${stringKey} deve ser uma string.`);
    }
  }
  const arrayKeys = ['match', 'args', 'testPatterns', 'testMatch', 'testExtensions'] as const;
  for (const arrayKey of arrayKeys) {
    if (runner[arrayKey] !== undefined && !isStringArray(runner[arrayKey])) {
      errors.push(`${path}.${arrayKey} deve ser um array de strings.`);
    }
  }
  const timeout = runner['timeoutMs'];
  if (timeout !== undefined) {
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
      errors.push(`${path}.timeoutMs deve ser um numero maior que 0.`);
    }
  }
  const env = runner['env'];
  if (env !== undefined) {
    if (!isPlainObject(env)) {
      errors.push(`${path}.env deve ser um objeto de strings.`);
    } else if (!Object.values(env).every((v) => typeof v === 'string')) {
      errors.push(`${path}.env deve conter apenas valores string.`);
    }
  }
  if (runner['adapter'] === 'command' && typeof runner['command'] !== 'string') {
    errors.push(`${path}.command e obrigatorio quando adapter e "command".`);
  }
}

function validateOutput(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push('output deve ser um objeto.');
    return;
  }
  for (const key of ['logFile', 'statusFile'] as const) {
    const v = value[key];
    if (v !== undefined && v !== null && typeof v !== 'string') {
      errors.push(`output.${key} deve ser uma string ou null.`);
    }
  }
  if (value['stdout'] !== undefined && typeof value['stdout'] !== 'boolean') {
    errors.push('output.stdout deve ser um booleano.');
  }
  const format = value['format'];
  if (format !== undefined && !OUTPUT_FORMATS.includes(format as (typeof OUTPUT_FORMATS)[number])) {
    errors.push(`output.format deve ser um de: ${OUTPUT_FORMATS.join(', ')}.`);
  }
  const color = value['color'];
  if (color !== undefined && typeof color !== 'boolean' && color !== 'auto') {
    errors.push('output.color deve ser true, false ou "auto".');
  }
  const tail = value['logTailLines'];
  if (tail !== undefined && (typeof tail !== 'number' || !Number.isInteger(tail) || tail < 0)) {
    errors.push('output.logTailLines deve ser um inteiro >= 0.');
  }
}

function validateServer(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push('server deve ser um objeto.');
    return;
  }
  if (value['enabled'] !== undefined && typeof value['enabled'] !== 'boolean') {
    errors.push('server.enabled deve ser um booleano.');
  }
  for (const key of ['host', 'discoveryFile'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      errors.push(`server.${key} deve ser uma string.`);
    }
  }
  const port = value['port'];
  if (port !== undefined) {
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) {
      errors.push('server.port deve ser um inteiro entre 0 e 65535.');
    }
  }
}

/**
 * Versao lancavel de {@link validateUserConfig}, util como type guard na API.
 *
 * @throws Error quando a configuracao e invalida, com todos os problemas na mensagem.
 */
export function assertValidUserConfig(input: unknown): asserts input is LiveTestUserConfig {
  const result = validateUserConfig(input);
  if (!result.ok) {
    throw new Error(`Configuracao invalida:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`);
  }
}
