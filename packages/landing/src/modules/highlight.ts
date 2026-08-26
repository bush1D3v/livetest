/**
 * Realce de sintaxe minimo.
 *
 * A pagina mostra JSON de configuracao, comandos de terminal e saida do
 * livetest. Carregar uma biblioteca de highlight completa para tres blocos
 * custaria mais que todo o resto do site somado, entao ha aqui um tokenizador
 * pequeno, previsivel e testavel.
 *
 * A saida e HTML com `<span class="tok-*">`; tudo que nao e token vai escapado.
 *
 * @packageDocumentation
 */

/** Linguagens reconhecidas. */
export type Language = 'jsonc' | 'bash' | 'output';

/** Escapa os caracteres que quebrariam a marcacao. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Envolve o texto em um span de token. */
function tok(classe: string, texto: string): string {
  return `<span class="tok-${classe}">${escapeHtml(texto)}</span>`;
}

/** Realca uma linha de JSON com comentarios. */
function realcarJsonc(linha: string): string {
  const comentario = linha.indexOf('//');
  if (comentario !== -1 && !dentroDeString(linha, comentario)) {
    return `${realcarJsonc(linha.slice(0, comentario))}${tok('comment', linha.slice(comentario))}`;
  }

  let saida = '';
  let resto = linha;

  while (resto.length > 0) {
    const chave = /^(\s*)("(?:[^"\\]|\\.)*")(\s*:)/.exec(resto);
    if (chave) {
      saida += escapeHtml(chave[1] as string) + tok('key', chave[2] as string) + escapeHtml(chave[3] as string);
      resto = resto.slice((chave[0] as string).length);
      continue;
    }

    const texto = /^"(?:[^"\\]|\\.)*"/.exec(resto);
    if (texto) {
      saida += tok('string', texto[0]);
      resto = resto.slice(texto[0].length);
      continue;
    }

    const literal = /^\b(?:true|false|null)\b/.exec(resto);
    if (literal) {
      saida += tok('literal', literal[0]);
      resto = resto.slice(literal[0].length);
      continue;
    }

    const numero = /^-?\d+(?:\.\d+)?/.exec(resto);
    if (numero) {
      saida += tok('number', numero[0]);
      resto = resto.slice(numero[0].length);
      continue;
    }

    const pontuacao = /^[{}[\],:]/.exec(resto);
    if (pontuacao) {
      saida += tok('punct', pontuacao[0]);
      resto = resto.slice(1);
      continue;
    }

    saida += escapeHtml(resto[0] as string);
    resto = resto.slice(1);
  }

  return saida;
}

/** Indica se a posicao esta dentro de uma string JSON. */
function dentroDeString(linha: string, posicao: number): boolean {
  let aberta = false;
  for (let i = 0; i < posicao; i++) {
    const ch = linha[i];
    if (ch === '"' && linha[i - 1] !== '\\') aberta = !aberta;
  }
  return aberta;
}

/** Realca uma linha de terminal: prompt, comando e argumentos. */
function realcarBash(linha: string): string {
  const prompt = /^(\s*\$\s)/.exec(linha);
  if (!prompt) return tok('comment', linha);

  const resto = linha.slice((prompt[1] as string).length);
  const partes = resto.split(' ');
  const realcadas = partes.map((parte, indice) => {
    if (parte === '') return '';
    if (indice === 0) return tok('command', parte);
    if (parte.startsWith('-')) return tok('flag', parte);
    return tok('arg', parte);
  });

  return tok('prompt', prompt[1] as string) + realcadas.join(' ');
}

/** Realca uma linha de saida do livetest. */
function realcarOutput(linha: string): string {
  if (linha.startsWith('LIVETEST ')) {
    const campos = linha.slice('LIVETEST '.length).split(' ');
    const corpo = campos
      .map((campo) => {
        const separador = campo.indexOf('=');
        if (separador === -1) return escapeHtml(campo);
        return `${tok('key', campo.slice(0, separador))}${tok('punct', '=')}${tok(
          'value',
          campo.slice(separador + 1),
        )}`;
      })
      .join(' ');
    return `${tok('command', 'LIVETEST')} ${corpo}`;
  }

  const motivo = linha.indexOf('rodou porque');
  if (motivo !== -1) {
    return escapeHtml(linha.slice(0, motivo)) + tok('comment', linha.slice(motivo));
  }

  if (/\bPASSOU\b/.test(linha)) return linha.replace(/PASSOU/, () => tok('pass', 'PASSOU'));
  if (/\bFALHOU\b/.test(linha)) return linha.replace(/FALHOU/, () => tok('fail', 'FALHOU'));

  return escapeHtml(linha);
}

/**
 * Realca um bloco inteiro, linha a linha.
 *
 * @param code - Codigo cru, com quebras de linha.
 * @param language - Linguagem do bloco.
 * @returns HTML pronto para `innerHTML`, com todo o texto escapado.
 *
 * @example
 * ```ts
 * highlight('{ "a": 1 }', 'jsonc');
 * // '<span class="tok-punct">{</span> <span class="tok-key">"a"</span>...'
 * ```
 */
export function highlight(code: string, language: Language): string {
  const realcador =
    language === 'jsonc' ? realcarJsonc : language === 'bash' ? realcarBash : realcarOutput;
  return code.split('\n').map(realcador).join('\n');
}
