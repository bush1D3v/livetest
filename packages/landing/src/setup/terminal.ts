/**
 * Terminal animado da hero.
 *
 * Encena um daemon real: sobe, observa, pega um save, roda quatro arquivos de
 * teste explicando o motivo de cada um, e depois pega uma regressao que so
 * aparece nos importadores — que e exatamente o argumento do produto.
 *
 * @packageDocumentation
 */

import type { Locale } from '../modules/i18n.js';
import { createTypewriter, type ScriptLine } from '../modules/typewriter.js';
import { startFrameLoop, type FrameLoop, type FrameScheduler } from '../modules/motion.js';

/** As duas frases que mudam de idioma dentro de uma linha do roteiro. */
interface Falas {
  /** Linha de abertura do daemon. */
  observando: string;
  /** Quantidade de arquivos de teste do lote. */
  arquivos: string;
  /** Motivo de cada teste, na ordem em que aparecem. */
  motivos: readonly [string, string, string, string];
  /** Resumo do lote que passou. */
  passou: string;
  /** Resumo do lote que falhou. */
  falhou: string;
  /** Nome do caso que quebrou. */
  caso: string;
  /** Mensagem da assertion. */
  assertion: string;
}

const FALAS: Readonly<Record<Locale, Falas>> = {
  en: {
    observando: 'livetest watching ~/project (214 files indexed, pid 4821)',
    arquivos: '  js -> 4 test file(s)',
    motivos: [
      '    src/footer.test.ts  ran because src/footer.ts imports src/login.ts (1 level)',
      '    src/header.test.ts  ran because src/header.ts imports src/login.ts (1 level)',
      '    src/layout.test.ts  ran because src/layout.ts imports src/login.ts via src/header.ts (2 levels)',
      '    src/login.test.ts   ran because src/login.ts changed',
    ],
    passou: '  PASSED js  4 file(s)  5 passed  0 failed  0 skipped  1.5s',
    falhou: '  FAILED js  4 file(s)  1 passed  4 failed  0 skipped  1.4s',
    caso: '    x src/header.test.ts > greets the authenticated user',
    assertion: "      AssertionError: expected 'Sign in' to be 'Hi, ana'",
  },
  pt: {
    observando: 'livetest observando ~/projeto (214 arquivos indexados, pid 4821)',
    arquivos: '  js -> 4 arquivo(s) de teste',
    motivos: [
      '    src/footer.test.ts  rodou porque src/footer.ts importa src/login.ts (1 nivel)',
      '    src/header.test.ts  rodou porque src/header.ts importa src/login.ts (1 nivel)',
      '    src/layout.test.ts  rodou porque src/layout.ts importa src/login.ts via src/header.ts (2 niveis)',
      '    src/login.test.ts   rodou porque src/login.ts foi alterado',
    ],
    passou: '  PASSOU js  4 arquivo(s)  5 passou  0 falhou  0 pulou  1.5s',
    falhou: '  FALHOU js  4 arquivo(s)  1 passou  4 falhou  0 pulou  1.4s',
    caso: '    x src/header.test.ts > sauda o usuario autenticado',
    assertion: "      AssertionError: expected 'Entrar' to be 'Ola, ana'",
  },
};

/**
 * Monta o roteiro do terminal no idioma pedido.
 *
 * O roteiro nao e decorativo: e a saida que o daemon realmente produz, com os
 * mesmos numeros que os testes do core conferem sobre o projeto de exemplo. O
 * segundo lote existe para encenar o argumento do produto, a regressao que so
 * aparece nos importadores.
 *
 * @example
 * ```ts
 * roteiroDoTerminal('en')[0]?.text; // '$ npx livetest start'
 * ```
 */
export function roteiroDoTerminal(locale: Locale): readonly ScriptLine[] {
  const f = FALAS[locale];

  return [
    { text: '$ npx livetest start', tone: 'prompt', pauseMs: 420 },
    { text: f.observando, tone: 'muted', instant: true, pauseMs: 700 },
    { text: '', instant: true, pauseMs: 0 },

    { text: 'livetest batch-1 (idle) src/login.ts', pauseMs: 200 },
    { text: f.arquivos, tone: 'muted', instant: true, pauseMs: 160 },
    { text: f.motivos[0], tone: 'reason', instant: true, pauseMs: 120 },
    { text: f.motivos[1], tone: 'reason', instant: true, pauseMs: 120 },
    { text: f.motivos[2], tone: 'reason', instant: true, pauseMs: 120 },
    { text: f.motivos[3], tone: 'reason', instant: true, pauseMs: 520 },
    { text: f.passou, tone: 'pass', instant: true, pauseMs: 260 },
    {
      text: 'LIVETEST batch=batch-1 status=passed files=4 tests=5 passed=5 failed=0 skipped=0 duration=1.6s',
      tone: 'summary',
      instant: true,
      pauseMs: 1500,
    },
    { text: '', instant: true, pauseMs: 0 },

    { text: 'livetest batch-2 (idle) src/login.ts', pauseMs: 200 },
    { text: f.falhou, tone: 'fail', instant: true, pauseMs: 220 },
    { text: f.caso, tone: 'fail', instant: true, pauseMs: 160 },
    { text: f.assertion, tone: 'muted', instant: true, pauseMs: 420 },
    {
      text: 'LIVETEST batch=batch-2 status=failed files=4 tests=5 passed=1 failed=4 skipped=0 duration=1.4s',
      tone: 'summary',
      instant: true,
      pauseMs: 2600,
    },
  ];
}

/** Opcoes de {@link setupTerminal}. */
export interface TerminalOptions {
  /** Raiz da busca pelos elementos. @defaultValue `document` */
  root?: ParentNode;
  /** Roteiro exibido. @defaultValue o de {@link roteiroDoTerminal} */
  script?: readonly ScriptLine[];
  /** Idioma do roteiro e do distintivo. @defaultValue `'pt'` */
  locale?: Locale;
  /** Mostra o roteiro inteiro de imediato, sem animar. */
  immediate?: boolean;
  /** Agendador de quadros, injetavel em teste. */
  scheduler?: FrameScheduler;
}

/** Terminal em execucao. */
export interface Terminal {
  /** Interrompe a animacao. */
  stop(): void;
  /** `true` quando o elemento de saida foi encontrado e ligado. */
  readonly mounted: boolean;
}

/** Deriva o estado do distintivo a partir da ultima linha visivel. */
export function badgeStateFor(lines: ReadonlyArray<{ tone: string }>): BadgeState {
  for (let i = lines.length - 1; i >= 0; i--) {
    const tone = lines[i]?.tone;
    if (tone === 'fail') return 'failed';
    if (tone === 'pass') return 'passed';
  }
  return 'idle';
}

/** Estados possiveis do distintivo. */
export type BadgeState = 'idle' | 'passed' | 'failed';

/** Texto exibido no distintivo para cada estado, por idioma. */
const BADGE_TEXT: Readonly<Record<Locale, Readonly<Record<BadgeState, string>>>> = {
  en: { idle: 'watching', passed: 'all green', failed: '4 failures' },
  pt: { idle: 'observando', passed: 'tudo verde', failed: '4 falhas' },
};

/**
 * Liga o terminal da hero.
 *
 * @example
 * ```ts
 * const terminal = setupTerminal({ immediate: prefersReducedMotion() });
 * terminal.stop();
 * ```
 */
export function setupTerminal(options: TerminalOptions = {}): Terminal {
  const root = options.root ?? document;
  const saida = root.querySelector<HTMLElement>('[data-terminal-output]');
  const distintivo = root.querySelector<HTMLElement>('[data-terminal-badge]');

  if (!saida) return { stop: () => {}, mounted: false };
  const alvo = saida;

  const locale = options.locale ?? 'pt';
  const script = options.script ?? roteiroDoTerminal(locale);
  const typewriter = createTypewriter(script, { charMs: 16, linePauseMs: 180, loopPauseMs: 2200 });

  /** Desenha um quadro no elemento de saida. */
  function pintar(quadro: { lines: Array<{ text: string; tone: string; typing: boolean }> }): void {
    const html = quadro.lines
      .map((linha) => {
        const classes = ['terminal__line'];
        if (linha.tone) classes.push(`terminal__line--${linha.tone}`);
        if (linha.typing) classes.push('terminal__line--typing');
        const texto = linha.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<span class="${classes.join(' ')}">${texto || ' '}</span>`;
      })
      .join('');

    alvo.innerHTML = html;

    if (distintivo) {
      const estado = badgeStateFor(quadro.lines);
      distintivo.dataset['state'] = estado;
      distintivo.textContent = BADGE_TEXT[locale][estado];
    }
  }

  if (options.immediate === true) {
    pintar(typewriter.finish());
    return { stop: () => {}, mounted: true };
  }

  const loop: FrameLoop = startFrameLoop((delta) => {
    pintar(typewriter.advance(delta));
  }, options.scheduler);

  return { stop: () => loop.stop(), mounted: true };
}
