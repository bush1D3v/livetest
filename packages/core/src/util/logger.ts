/**
 * Logger interno com niveis e escopo.
 * @packageDocumentation
 */

import type { LogLevel } from '../types/config.js';
import type { Logger } from '../types/logging.js';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/** Destino das linhas de log. Injetavel para testes. */
export interface LogSink {
  write(level: Exclude<LogLevel, 'silent'>, line: string, args: unknown[]): void;
}

/** Sink padrao: `console.error` para tudo, mantendo o stdout limpo para o relatorio. */
export const consoleSink: LogSink = {
  write(level, line, args) {
    // Logs internos vao para stderr; stdout e reservado ao relatorio de testes,
    // que e o canal lido por agentes de IA.
     
    console.error(`${line}`, ...args);
    void level;
  },
};

/** Opcoes de criacao do logger. */
export interface CreateLoggerOptions {
  level?: LogLevel;
  sink?: LogSink;
  scope?: string;
  /** Relogio injetavel, para timestamps deterministicos em teste. */
  now?: () => Date;
}

/**
 * Cria um {@link Logger}.
 *
 * @example
 * ```ts
 * const log = createLogger({ level: 'debug' }).child('watcher');
 * log.info('observando %s arquivos', 12);
 * ```
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const sink = options.sink ?? consoleSink;
  const scope = options.scope ?? '';
  const now = options.now ?? (() => new Date());
  const threshold = LEVEL_ORDER[level];

  function emit(entryLevel: Exclude<LogLevel, 'silent'>, message: string, args: unknown[]): void {
    if (LEVEL_ORDER[entryLevel] < threshold) return;
    const time = now().toISOString().slice(11, 23);
    const prefix = scope ? `[livetest:${scope}]` : '[livetest]';
    sink.write(entryLevel, `${time} ${prefix} ${entryLevel.toUpperCase()} ${message}`, args);
  }

  return {
    level,
    debug: (message, ...args) => emit('debug', message, args),
    info: (message, ...args) => emit('info', message, args),
    warn: (message, ...args) => emit('warn', message, args),
    error: (message, ...args) => emit('error', message, args),
    child: (childScope) =>
      createLogger({
        level,
        sink,
        now,
        scope: scope ? `${scope}:${childScope}` : childScope,
      }),
  };
}

/**
 * Logger que descarta tudo. Util em testes e como default de modulos que
 * aceitam um logger opcional.
 *
 * Nao precisa de um sink proprio: no nivel `silent` nenhuma linha chega a ser
 * formatada, quanto mais escrita.
 */
export const noopLogger: Logger = createLogger({ level: 'silent' });
