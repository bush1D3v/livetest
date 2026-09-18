/**
 * Tema e idioma, a parte que decide sem tocar no DOM.
 *
 * Os dois modulos existem separados da interface por um motivo pratico: a mesma
 * regra roda duas vezes, uma no script embutido no `<head>` e outra no bundle.
 * Testar a regra aqui e o que garante que as duas nao se separem.
 */

import { describe, expect, it } from 'vitest';

import {
  caminhoDaRota,
  detectLocale,
  isLocale,
  LOCALE_KEY,
  readStoredLocale,
  shouldRedirect,
  storeLocale,
} from '../src/modules/i18n.js';
import {
  isThemeChoice,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  THEME_KEY,
  THEME_PADRAO,
} from '../src/modules/theme.js';

/** Armazenamento de mentira, com a opcao de falhar como em navegacao privada. */
function armazenamento(inicial: Record<string, string> = {}, quebrado = false) {
  const dados = new Map(Object.entries(inicial));
  return {
    dados,
    getItem(chave: string): string | null {
      if (quebrado) throw new Error('bloqueado');
      return dados.get(chave) ?? null;
    },
    setItem(chave: string, valor: string): void {
      if (quebrado) throw new Error('bloqueado');
      dados.set(chave, valor);
    },
  };
}

describe('tema', () => {
  it('nasce escuro', () => {
    expect(THEME_PADRAO).toBe('dark');
    expect(readStoredTheme(armazenamento())).toBe('dark');
  });

  it('reconhece as tres escolhas e recusa o resto', () => {
    expect(isThemeChoice('system')).toBe(true);
    expect(isThemeChoice('sepia')).toBe(false);
  });

  it('traduz a escolha no tema aplicado', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('le o que foi guardado', () => {
    expect(readStoredTheme(armazenamento({ [THEME_KEY]: 'light' }))).toBe('light');
  });

  it('ignora valor invalido, armazenamento ausente e armazenamento que lanca', () => {
    expect(readStoredTheme(armazenamento({ [THEME_KEY]: 'sepia' }))).toBe('dark');
    expect(readStoredTheme(null)).toBe('dark');
    expect(readStoredTheme(armazenamento({}, true))).toBe('dark');
  });

  it('grava, e diz quando nao conseguiu', () => {
    const memoria = armazenamento();
    expect(storeTheme(memoria, 'light')).toBe(true);
    expect(memoria.dados.get(THEME_KEY)).toBe('light');
    expect(storeTheme(null, 'light')).toBe(false);
    expect(storeTheme(armazenamento({}, true), 'light')).toBe(false);
  });
});

describe('idioma', () => {
  it('reconhece os dois publicados', () => {
    expect(isLocale('pt')).toBe(true);
    expect(isLocale('fr')).toBe(false);
  });

  it('detecta pela subtag primaria', () => {
    expect(detectLocale(['pt-BR', 'en-US'])).toBe('pt');
    expect(detectLocale(['PT'])).toBe('pt');
    expect(detectLocale(['en-GB'])).toBe('en');
  });

  it('cai no ingles quando nao reconhece nenhum', () => {
    expect(detectLocale(['fr-FR', 'de'])).toBe('en');
    expect(detectLocale([])).toBe('en');
    expect(detectLocale(undefined)).toBe('en');
  });

  it('le e grava a escolha', () => {
    const memoria = armazenamento();
    expect(readStoredLocale(memoria)).toBeNull();
    expect(storeLocale(memoria, 'pt')).toBe(true);
    expect(readStoredLocale(memoria)).toBe('pt');
  });

  it('ignora valor invalido e armazenamento indisponivel', () => {
    expect(readStoredLocale(armazenamento({ [LOCALE_KEY]: 'fr' }))).toBeNull();
    expect(readStoredLocale(null)).toBeNull();
    expect(readStoredLocale(armazenamento({}, true))).toBeNull();
    expect(storeLocale(null, 'pt')).toBe(false);
    expect(storeLocale(armazenamento({}, true), 'pt')).toBe(false);
  });

  it('redireciona a primeira visita para o idioma do navegador', () => {
    expect(shouldRedirect('en', null, 'pt')).toBe(true);
    expect(shouldRedirect('pt', null, 'pt')).toBe(false);
  });

  it('nao desfaz uma escolha explicita', () => {
    expect(shouldRedirect('en', 'en', 'pt')).toBe(false);
    expect(shouldRedirect('en', 'pt', 'en')).toBe(true);
  });

  it('monta o caminho de uma rota', () => {
    expect(caminhoDaRota('en', '')).toBe('/');
    expect(caminhoDaRota('pt', '')).toBe('/pt');
    expect(caminhoDaRota('en', 'guide/depth')).toBe('/guide/depth');
    expect(caminhoDaRota('pt', 'guide/depth')).toBe('/pt/guide/depth');
  });
});
