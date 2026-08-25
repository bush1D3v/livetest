/**
 * Motor de digitacao do terminal da hero.
 *
 * A animacao mais importante da pagina e um terminal que "roda" o livetest de
 * verdade: mostra o lote sendo montado, o motivo de cada teste e o resumo
 * final. Para que ela seja testavel e nao dependa de `requestAnimationFrame`,
 * o motor e uma maquina de estados pura: quem desenha chama {@link Typewriter.advance}
 * com o tempo decorrido e recebe o quadro a renderizar.
 *
 * @packageDocumentation
 */

/** Uma linha do roteiro do terminal. */
export interface ScriptLine {
  /** Texto da linha. */
  text: string;
  /**
   * Classe CSS aplicada a linha, usada para colorir prompt, sucesso e falha.
   * @example `'prompt' | 'muted' | 'pass' | 'fail' | 'summary'`
   */
  tone?: string;
  /** Escreve a linha inteira de uma vez, sem digitar caractere a caractere. */
  instant?: boolean;
  /** Pausa adicional depois de completar a linha, em ms. */
  pauseMs?: number;
}

/** Linha ja renderizavel. */
export interface RenderedLine {
  text: string;
  tone: string;
  /** `true` enquanto a linha ainda esta sendo digitada. */
  typing: boolean;
}

/** Estado visivel do terminal em um instante. */
export interface TypewriterFrame {
  /** Todas as linhas visiveis, na ordem. */
  lines: RenderedLine[];
  /** `true` quando o roteiro inteiro terminou. */
  done: boolean;
}

/** Opcoes de {@link createTypewriter}. */
export interface TypewriterOptions {
  /** Tempo por caractere, em ms. @defaultValue 18 */
  charMs?: number;
  /** Pausa padrao ao terminar uma linha, em ms. @defaultValue 220 */
  linePauseMs?: number;
  /** Pausa antes de reiniciar o roteiro, em ms. `0` nao reinicia. @defaultValue 0 */
  loopPauseMs?: number;
}

/** Motor de digitacao. */
export interface Typewriter {
  /**
   * Avanca o tempo e devolve o quadro resultante.
   * @param deltaMs - Tempo decorrido desde a ultima chamada.
   */
  advance(deltaMs: number): TypewriterFrame;
  /** Quadro atual, sem avancar o tempo. */
  frame(): TypewriterFrame;
  /** Volta ao inicio do roteiro. */
  reset(): void;
  /** Pula direto para o fim do roteiro. */
  finish(): TypewriterFrame;
  /** Duracao total do roteiro, em ms. */
  readonly durationMs: number;
}

/**
 * Cria o motor de digitacao.
 *
 * @example
 * ```ts
 * const tw = createTypewriter([{ text: 'ola' }], { charMs: 10, linePauseMs: 0 });
 * tw.advance(10).lines[0]?.text; // 'o'
 * tw.advance(20).lines[0]?.text; // 'ola'
 * ```
 */
export function createTypewriter(
  script: readonly ScriptLine[],
  options: TypewriterOptions = {},
): Typewriter {
  const charMs = Math.max(1, options.charMs ?? 18);
  const linePauseMs = Math.max(0, options.linePauseMs ?? 220);
  const loopPauseMs = Math.max(0, options.loopPauseMs ?? 0);

  /** Momento, na linha do tempo do roteiro, em que cada linha comeca e termina. */
  const marcos = script.map(() => ({ inicio: 0, fimDigitacao: 0, fimPausa: 0 }));
  let relogio = 0;

  for (let i = 0; i < script.length; i++) {
    const linha = script[i] as ScriptLine;
    const marco = marcos[i] as { inicio: number; fimDigitacao: number; fimPausa: number };
    const digitacao = linha.instant ? 0 : linha.text.length * charMs;
    marco.inicio = relogio;
    marco.fimDigitacao = relogio + digitacao;
    marco.fimPausa = marco.fimDigitacao + (linha.pauseMs ?? linePauseMs);
    relogio = marco.fimPausa;
  }

  const durationMs = relogio;
  let decorrido = 0;

  /** Monta o quadro correspondente ao tempo acumulado. */
  function montar(): TypewriterFrame {
    const lines: RenderedLine[] = [];

    for (let i = 0; i < script.length; i++) {
      const linha = script[i] as ScriptLine;
      const marco = marcos[i] as { inicio: number; fimDigitacao: number };
      if (decorrido < marco.inicio) break;

      const tone = linha.tone ?? '';
      if (decorrido >= marco.fimDigitacao) {
        lines.push({ text: linha.text, tone, typing: false });
        continue;
      }

      const visiveis = Math.floor((decorrido - marco.inicio) / charMs);
      lines.push({ text: linha.text.slice(0, visiveis), tone, typing: true });
    }

    return { lines, done: decorrido >= durationMs };
  }

  return {
    durationMs,

    advance(deltaMs: number): TypewriterFrame {
      decorrido += Math.max(0, deltaMs);

      // Com laco ativo, o roteiro recomeca depois da pausa configurada.
      if (loopPauseMs > 0 && decorrido >= durationMs + loopPauseMs) {
        decorrido = 0;
      }
      return montar();
    },

    frame: montar,

    reset(): void {
      decorrido = 0;
    },

    finish(): TypewriterFrame {
      decorrido = durationMs;
      return montar();
    },
  };
}
