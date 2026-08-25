/**
 * Logger interno minimalista, injetavel para facilitar testes.
 * @packageDocumentation
 */

import type { LogLevel } from './config.js';

/** Interface de log usada por todos os componentes do core. */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  /** Cria um logger derivado com prefixo adicional. */
  child(scope: string): Logger;
  /** Nivel efetivo do logger. */
  readonly level: LogLevel;
}
