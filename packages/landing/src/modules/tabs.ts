/**
 * Grupos de abas.
 *
 * Usado nos blocos de configuracao (JS/TS e Python) e no comparativo de
 * runners. O estado fica aqui, separado do DOM, para que a regra de "so uma
 * aba ativa por grupo" seja testavel sem renderizar nada.
 *
 * @packageDocumentation
 */

/** Controle de um grupo de abas. */
export interface TabGroup {
  /** Id da aba ativa. */
  active(): string;
  /** Ativa uma aba. Ids desconhecidos sao ignorados. */
  select(id: string): boolean;
  /** Avanca para a proxima aba, circulando. */
  next(): string;
  /** Volta para a aba anterior, circulando. */
  previous(): string;
  /** Ids na ordem declarada. */
  readonly ids: readonly string[];
}

/** Opcoes de {@link createTabGroup}. */
export interface TabGroupOptions {
  /** Aba ativa inicial. O padrao e a primeira. */
  initial?: string;
  /** Notificado a cada mudanca efetiva. */
  onChange?: (id: string, anterior: string) => void;
}

/**
 * Cria um grupo de abas.
 *
 * @throws Error quando a lista de ids esta vazia.
 *
 * @example
 * ```ts
 * const abas = createTabGroup(['js', 'python']);
 * abas.select('python'); // true
 * abas.next();           // 'js'
 * ```
 */
export function createTabGroup(
  ids: readonly string[],
  options: TabGroupOptions = {},
): TabGroup {
  if (ids.length === 0) throw new Error('um grupo de abas precisa de ao menos uma aba');

  const primeira = ids[0] as string;
  let ativa = options.initial !== undefined && ids.includes(options.initial)
    ? options.initial
    : primeira;

  function definir(id: string): boolean {
    if (!ids.includes(id)) return false;
    if (id === ativa) return true;
    const anterior = ativa;
    ativa = id;
    options.onChange?.(id, anterior);
    return true;
  }

  function deslocar(passo: number): string {
    const indice = ids.indexOf(ativa);
    const proximo = (indice + passo + ids.length) % ids.length;
    definir(ids[proximo] as string);
    return ativa;
  }

  return {
    ids,
    active: () => ativa,
    select: definir,
    next: () => deslocar(1),
    previous: () => deslocar(-1),
  };
}
