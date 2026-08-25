/** Logger de teste que acumula as linhas emitidas. */

import type { LogLevel } from '../../src/types/config.js';
import type { Logger } from '../../src/types/logging.js';
import { createLogger } from '../../src/util/logger.js';

/** Logger com as linhas capturadas em memoria. */
export interface RecordingLogger {
  logger: Logger;
  /** Linhas formatadas, na ordem de emissao. */
  lines: string[];
}

/** Cria um logger que grava tudo em um array em vez de escrever no console. */
export function createRecordingLogger(level: LogLevel = 'debug'): RecordingLogger {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    now: () => new Date(0),
    sink: { write: (_level, line, args) => lines.push([line, ...args.map(String)].join(' ')) },
  });
  return { logger, lines };
}
