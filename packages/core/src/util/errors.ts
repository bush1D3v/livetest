/**
 * Erros tipados do Live Test Runner.
 * @packageDocumentation
 */

/** Codigos de erro estaveis, seguros para uso programatico. */
export type LiveTestErrorCode =
  | 'CONFIG_INVALID'
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_LOAD_FAILED'
  | 'ADAPTER_NOT_FOUND'
  | 'DAEMON_NOT_RUNNING'
  | 'DAEMON_ALREADY_RUNNING'
  | 'CONNECTION_FAILED';

/** Erro base da biblioteca, sempre portando um {@link LiveTestErrorCode}. */
export class LiveTestError extends Error {
  readonly code: LiveTestErrorCode;
  /** Detalhes adicionais, ex.: lista de problemas de validacao. */
  readonly details: string[];

  constructor(code: LiveTestErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = 'LiveTestError';
    this.code = code;
    this.details = details;
  }

  /** Mensagem completa, incluindo detalhes, pronta para exibicao em terminal. */
  format(): string {
    if (this.details.length === 0) return this.message;
    return [this.message, ...this.details.map((d) => `  - ${d}`)].join('\n');
  }
}

/** Converte qualquer valor lancado em uma mensagem legivel. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Extrai a stack quando disponivel. */
export function errorDetail(error: unknown): string | null {
  return error instanceof Error && error.stack ? error.stack : null;
}
