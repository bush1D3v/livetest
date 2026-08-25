/**
 * Primitivas assincronas usadas pelo core.
 * @packageDocumentation
 */

/** Promise cuja resolucao e controlada externamente. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

/** Cria um {@link Deferred}. */
export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Executa tarefas com um limite de concorrencia, preservando a ordem dos resultados.
 *
 * @param tasks - Funcoes que devolvem promises. Sao invocadas sob demanda.
 * @param limit - Numero maximo de tarefas simultaneas (minimo 1).
 *
 * @example
 * ```ts
 * const results = await mapWithConcurrency([() => a(), () => b()], 2);
 * ```
 */
export async function mapWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const effectiveLimit = Math.max(1, Math.floor(limit));
  const results = new Array<T>(tasks.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= tasks.length) return;
      const task = tasks[index];
      /* c8 ignore next */
      if (!task) return;
      results[index] = await task();
    }
  }

  const workers = Array.from({ length: Math.min(effectiveLimit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Aguarda `ms` milissegundos. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}
