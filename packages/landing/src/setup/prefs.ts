/**
 * Os dois seletores do cabecalho: tema e idioma.
 *
 * O tema ja foi aplicado pelo script embutido no `<head>`, antes da primeira
 * pintura. O que sobra aqui e a interacao: abrir o menu, gravar a escolha,
 * repintar, e acompanhar o sistema operacional enquanto a opcao `system`
 * estiver valendo.
 *
 * O idioma nao troca nada na pagina: cada idioma e um endereco. O seletor apenas
 * grava a escolha antes de deixar o link navegar, para que a proxima visita
 * chegue direto no idioma certo e o redirecionamento automatico nao desfaca o
 * que a pessoa acabou de escolher.
 *
 * @packageDocumentation
 */

import {
  isLocale,
  storeLocale,
  type Locale,
} from '../modules/i18n.js';
import {
  isThemeChoice,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  type ResolvedTheme,
  type ThemeChoice,
} from '../modules/theme.js';

/** Marca, na sessao, que o redirecionamento automatico ja fez o que tinha de fazer. */
const MARCA_DE_SESSAO = 'livetest:auto';

/** Opcoes de {@link setupPrefs}. */
export interface PrefsOptions {
  /** Documento usado. @defaultValue `document` */
  doc?: Document;
  /** Janela usada. @defaultValue `window` */
  win?: Window;
}

/** Seletores montados. */
export interface Prefs {
  /** Escolha de tema corrente. */
  theme(): ThemeChoice;
  /** Troca o tema como se o menu tivesse sido usado. */
  setTheme(escolha: ThemeChoice): void;
  /** Tema efetivamente aplicado no documento. */
  applied(): ResolvedTheme;
  /** Fecha todos os menus abertos. */
  closeMenus(): void;
  /** Remove os ouvintes registrados. */
  destroy(): void;
}

/** Consulta o sistema, tolerando um ambiente sem `matchMedia`. */
function consultaDeSistema(win: Window): MediaQueryList | null {
  return typeof win.matchMedia === 'function'
    ? win.matchMedia('(prefers-color-scheme: dark)')
    : null;
}

/**
 * Liga os menus de tema e de idioma.
 *
 * @example
 * ```ts
 * const prefs = setupPrefs();
 * prefs.setTheme('light');
 * prefs.applied(); // 'light'
 * ```
 */
export function setupPrefs(options: PrefsOptions = {}): Prefs {
  const doc = options.doc ?? document;
  const win = options.win ?? (doc.defaultView as Window);
  const raiz = doc.documentElement;

  const menus = [...doc.querySelectorAll<HTMLElement>('[data-menu]')];
  const sistema = consultaDeSistema(win);

  let escolha = readStoredTheme(win.localStorage);
  let aplicado: ResolvedTheme = 'dark';

  /** O que o sistema operacional prefere, ou escuro onde ele nao diz. */
  const sistemaEscuro = (): boolean => sistema?.matches ?? true;

  /** Fecha todos os menus. */
  function fechar(): void {
    for (const menu of menus) {
      menu.classList.remove('is-open');
      menu.querySelector('[aria-haspopup]')?.setAttribute('aria-expanded', 'false');
    }
  }

  /** Abre um menu e fecha os outros. */
  function alternar(menu: HTMLElement): void {
    const abrindo = !menu.classList.contains('is-open');
    fechar();
    if (!abrindo) return;
    menu.classList.add('is-open');
    menu.querySelector('[aria-haspopup]')?.setAttribute('aria-expanded', 'true');
  }

  /** Repinta o documento e o menu a partir da escolha corrente. */
  function aplicar(): ResolvedTheme {
    aplicado = resolveTheme(escolha, sistemaEscuro());

    raiz.dataset['theme'] = aplicado;
    raiz.dataset['temaEscolhido'] = escolha;

    for (const icone of doc.querySelectorAll<HTMLElement>('[data-tema-icone]')) {
      icone.hidden = icone.dataset['temaIcone'] !== aplicado;
    }

    for (const botao of doc.querySelectorAll<HTMLElement>('[data-tema]')) {
      if (botao.dataset['tema'] === escolha) botao.setAttribute('data-ativo', '');
      else botao.removeAttribute('data-ativo');
    }

    return aplicado;
  }

  /** Troca a escolha, grava e repinta. */
  function trocar(nova: ThemeChoice): void {
    escolha = nova;
    storeTheme(win.localStorage, nova);
    aplicar();
    fechar();
  }

  const aoClicar = (evento: Event): void => {
    const alvo = evento.target as HTMLElement | null;
    const dentro = alvo?.closest<HTMLElement>('[data-menu]');

    const gatilho = alvo?.closest<HTMLElement>('[aria-haspopup]');
    if (gatilho && dentro) {
      evento.preventDefault();
      alternar(dentro);
      return;
    }

    const opcaoDeTema = alvo?.closest<HTMLElement>('[data-tema]');
    if (opcaoDeTema) {
      const pedida = opcaoDeTema.dataset['tema'];
      if (isThemeChoice(pedida)) trocar(pedida);
      return;
    }

    // O atributo e `data-escolher-idioma`, e nao `data-locale`: o `<body>`
    // carrega `data-locale` para o resto do script, e um clique em qualquer
    // ponto da pagina passaria por ele.
    const opcaoDeIdioma = alvo?.closest<HTMLElement>('[data-escolher-idioma]');
    if (opcaoDeIdioma) {
      const pedido = opcaoDeIdioma.dataset['escolherIdioma'];
      if (isLocale(pedido)) guardarIdioma(pedido);
      return;
    }

    if (!dentro) fechar();
  };

  /**
   * Grava o idioma escolhido e desarma o redirecionamento automatico.
   *
   * A marca de sessao existe porque em navegacao privada a gravacao pode
   * falhar; sem ela, a pagina de destino detectaria o idioma do navegador,
   * discordaria, e mandaria a pessoa de volta.
   */
  function guardarIdioma(idioma: Locale): void {
    storeLocale(win.localStorage, idioma);
    try {
      win.sessionStorage.setItem(MARCA_DE_SESSAO, '1');
    } catch {
      /* Sem sessionStorage, o link navega mesmo assim. */
    }
  }

  const aoTeclar = (evento: KeyboardEvent): void => {
    if (evento.key === 'Escape') fechar();
  };

  const aoMudarSistema = (): void => {
    if (escolha === 'system') aplicar();
  };

  doc.addEventListener('click', aoClicar);
  doc.addEventListener('keydown', aoTeclar);
  sistema?.addEventListener('change', aoMudarSistema);

  // O atalho da busca muda de nome no Mac, e mostrar "Ctrl" a quem usa "⌘" e
  // pior que nao mostrar nada.
  if (/Mac|iPhone|iPad/.test(win.navigator?.platform ?? '')) {
    for (const tecla of doc.querySelectorAll<HTMLElement>('[data-tecla-modificador]')) {
      tecla.textContent = '⌘';
    }
  }

  aplicar();

  return {
    theme: () => escolha,
    setTheme: trocar,
    // O tema aplicado e o que a ultima pintura decidiu, e nao um recalculo: o
    // recalculo podia divergir do que esta na tela.
    applied: () => aplicado,
    closeMenus: fechar,
    destroy(): void {
      doc.removeEventListener('click', aoClicar);
      doc.removeEventListener('keydown', aoTeclar);
      sistema?.removeEventListener('change', aoMudarSistema);
    },
  };
}
