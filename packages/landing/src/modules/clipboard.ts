/**
 * Copia para a area de transferencia.
 *
 * O botao de copiar do comando de instalacao e o unico caminho de conversao
 * real da pagina: se ele falhar em silencio, o visitante desiste. Por isso o
 * resultado e sempre reportado, e ha um caminho alternativo quando a API
 * moderna nao esta disponivel (contexto sem HTTPS, por exemplo).
 *
 * @packageDocumentation
 */

/** Recurso de copia do navegador, na forma minima usada aqui. */
export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

/** Opcoes de {@link copyText}. */
export interface CopyOptions {
  /** API moderna. O padrao e `navigator.clipboard`. */
  clipboard?: ClipboardLike | undefined;
  /**
   * Caminho alternativo, usado quando a API moderna falta ou falha.
   * Devolve `true` se conseguiu copiar.
   */
  fallback?: (text: string) => boolean;
  /** Documento usado pelo caminho alternativo padrao. */
  document?: Document;
}

/** Caminho alternativo padrao: campo temporario mais `execCommand`. */
export function legacyCopy(text: string, doc: Document = document): boolean {
  const campo = doc.createElement('textarea');
  campo.value = text;
  campo.setAttribute('readonly', '');
  campo.style.position = 'fixed';
  campo.style.opacity = '0';
  doc.body.appendChild(campo);
  campo.select();

  let copiou = false;
  try {
    const comando = (doc as Document & { execCommand?: (name: string) => boolean }).execCommand;
    copiou = typeof comando === 'function' ? comando.call(doc, 'copy') : false;
  } catch {
    copiou = false;
  }

  // A limpeza fica fora do `try`: o campo temporario nao pode sobreviver a
  // nenhum caminho, e um `finally` aqui so criaria uma aresta impossivel.
  campo.remove();
  return copiou;
}

/**
 * Copia um texto e informa se deu certo.
 *
 * @example
 * ```ts
 * const copiou = await copyText('npm i -D @livetest/cli');
 * botao.textContent = copiou ? 'Copiado!' : 'Copie manualmente';
 * ```
 */
export async function copyText(text: string, options: CopyOptions = {}): Promise<boolean> {
  const clipboard =
    options.clipboard !== undefined
      ? options.clipboard
      : (globalThis.navigator as Navigator | undefined)?.clipboard;

  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Permissao negada ou contexto inseguro: tenta o caminho alternativo.
    }
  }

  const fallback = options.fallback ?? ((valor: string) => legacyCopy(valor, options.document));
  try {
    return fallback(text);
  } catch {
    return false;
  }
}
