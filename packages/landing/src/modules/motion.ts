/**
 * Camada de movimento.
 *
 * Duas responsabilidades: respeitar quem pediu menos animacao no sistema
 * operacional, e oferecer um laco de quadros que os testes conseguem controlar.
 *
 * @packageDocumentation
 */

/** Consulta de media, na forma minima usada aqui. */
export interface MediaQuery {
  matches: boolean;
}

/**
 * Indica se o visitante pediu movimento reduzido.
 *
 * @param match - Funcao de consulta. Injetavel porque `matchMedia` nao existe
 * em todo ambiente de teste, e porque a resposta precisa ser forcada nos dois
 * sentidos.
 */
export function prefersReducedMotion(
  match: ((query: string) => MediaQuery) | undefined = globalThis.matchMedia?.bind(globalThis),
): boolean {
  if (!match) return false;
  return match('(prefers-reduced-motion: reduce)').matches;
}

/** Laco de quadros que pode ser parado. */
export interface FrameLoop {
  /** Interrompe o laco. Chamar duas vezes nao faz mal. */
  stop(): void;
  /** `true` enquanto o laco esta ativo. */
  running(): boolean;
}

/** Agendador de quadros, injetavel em teste. */
export interface FrameScheduler {
  request(callback: (timestamp: number) => void): number;
  cancel(handle: number): void;
}

/** Agendador padrao, apoiado no `requestAnimationFrame`. */
export const rafScheduler: FrameScheduler = {
  request: (callback) => globalThis.requestAnimationFrame(callback),
  cancel: (handle) => globalThis.cancelAnimationFrame(handle),
};

/**
 * Executa `onFrame` a cada quadro, entregando o tempo decorrido desde o quadro
 * anterior.
 *
 * @param onFrame - Recebe o delta em ms. Devolver `false` encerra o laco.
 * @param scheduler - Agendador. O padrao usa `requestAnimationFrame`.
 *
 * @example
 * ```ts
 * const loop = startFrameLoop((delta) => terminal.advance(delta) && undefined);
 * loop.stop();
 * ```
 */
export function startFrameLoop(
  onFrame: (deltaMs: number) => boolean | void,
  scheduler: FrameScheduler = rafScheduler,
): FrameLoop {
  let handle: number | null = null;
  let anterior: number | null = null;
  let ativo = true;

  function passo(timestamp: number): void {
    if (!ativo) return;
    // O primeiro quadro nao tem delta: serve so para marcar o inicio.
    const delta = anterior === null ? 0 : timestamp - anterior;
    anterior = timestamp;

    if (onFrame(delta) === false) {
      ativo = false;
      return;
    }
    handle = scheduler.request(passo);
  }

  handle = scheduler.request(passo);

  return {
    stop(): void {
      if (!ativo) return;
      ativo = false;
      if (handle !== null) scheduler.cancel(handle);
      handle = null;
    },
    running: () => ativo,
  };
}
