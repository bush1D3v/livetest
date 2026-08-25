/**
 * Geracao de identificadores curtos e monotonicos para lotes e execucoes.
 *
 * Ids sao previsiveis por design (`prefixo-contador`), o que torna os logs
 * legiveis para humanos e para agentes de IA, e os testes deterministicos.
 *
 * @packageDocumentation
 */

/** Contador incremental com prefixo. */
export interface IdGenerator {
  /** Devolve o proximo id, ex.: `batch-1`. */
  next(): string;
  /** Reinicia o contador. Usado em testes. */
  reset(): void;
}

/** Cria um {@link IdGenerator}. */
export function createIdGenerator(prefix: string): IdGenerator {
  let counter = 0;
  return {
    next: () => `${prefix}-${++counter}`,
    reset: () => {
      counter = 0;
    },
  };
}
