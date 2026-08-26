/**
 * Blocos de codigo: realce dos estaticos e as abas de configuracao.
 * @packageDocumentation
 */

import { highlight, type Language } from '../modules/highlight.js';
import { createTabGroup } from '../modules/tabs.js';

/** Exemplos de configuracao mostrados nas abas. */
export const CONFIG_EXAMPLES: Readonly<Record<string, string>> = {
  js: [
    '{',
    '  // Sem este arquivo o daemon ja funciona. Ele existe para o controle fino.',
    '  "watch": ["src/**/*.ts", "src/**/*.tsx"],',
    '',
    '  "dependencyDepth": {',
    '    "default": "direct",',
    '    "overrides": {',
    '      // Utilitario estavel e muito importado: nao vale propagar.',
    '      "src/util/**": "self",',
    '      // Critico: qualquer quebra importa, sobe a cadeia inteira.',
    '      "src/core/auth.ts": "transitive"',
    '    }',
    '  },',
    '',
    '  "debounce": { "mode": "both", "idleMs": 400, "maxBatchWindowMs": 3000 },',
    '',
    '  "runners": {',
    '    "js": { "adapter": "vitest", "match": ["src/**/*.{ts,tsx}"] }',
    '  }',
    '}',
  ].join('\n'),

  python: [
    '{',
    '  "watch": ["app/**/*.py", "tests/**/*.py"],',
    '',
    '  "dependencyDepth": { "default": "direct" },',
    '',
    '  "runners": {',
    '    "python": { "adapter": "pytest", "match": ["app/**/*.py"] }',
    '  },',
    '',
    '  // Aponte para o venv do projeto quando houver um.',
    '  "pythonPath": ".venv/bin/python"',
    '}',
  ].join('\n'),

  outra: [
    '{',
    '  // Sem adapter dedicado, o adapter "command" ja entrega watch, debounce,',
    '  // mapeamento fonte-teste e execucao incremental. Falta so a propagacao.',
    '  "runners": {',
    '    "go": {',
    '      "adapter": "command",',
    '      "command": "go",',
    '      "args": ["test"],',
    '      "match": ["**/*.go"],',
    '      "testMatch": ["**/*_test.go"],',
    '      "testPatterns": ["{dir}/{name}_test.go"],',
    '      "testExtensions": ["go"]',
    '    }',
    '  }',
    '}',
  ].join('\n'),
};

/** Opcoes de {@link setupCodeBlocks}. */
export interface CodeOptions {
  root?: ParentNode;
  /** Exemplos usados nas abas. @defaultValue {@link CONFIG_EXAMPLES} */
  examples?: Readonly<Record<string, string>>;
}

/** Blocos montados. */
export interface CodeBlocks {
  /** Quantos blocos estaticos foram realcados. */
  readonly highlighted: number;
  /** Aba de configuracao ativa, ou `null` se a secao nao existe. */
  activeTab(): string | null;
}

/**
 * Realca os blocos estaticos e liga as abas de configuracao.
 *
 * Blocos estaticos sao marcados com `data-code="jsonc|bash|output"`.
 *
 * @example
 * ```ts
 * setupCodeBlocks().activeTab(); // 'js'
 * ```
 */
export function setupCodeBlocks(options: CodeOptions = {}): CodeBlocks {
  const root = options.root ?? document;
  const exemplos = options.examples ?? CONFIG_EXAMPLES;

  const estaticos = [...root.querySelectorAll<HTMLElement>('[data-code]')].filter(
    (bloco) => bloco.textContent !== null && bloco.textContent.length > 0,
  );

  for (const bloco of estaticos) {
    // O seletor garante o atributo, e `textContent` de um elemento nao e nulo.
    const linguagem = bloco.dataset['code'] as Language;
    bloco.innerHTML = highlight(bloco.textContent as string, linguagem);
  }

  const abas = [...root.querySelectorAll<HTMLElement>('[data-config-tab]')];
  const corpo = root.querySelector<HTMLElement>('[data-config-body]');

  if (abas.length === 0 || !corpo) {
    return { highlighted: estaticos.length, activeTab: () => null };
  }

  const ids = abas.map((aba) => aba.dataset['configTab'] as string);

  function pintar(id: string): void {
    if (corpo) corpo.innerHTML = highlight(exemplos[id] ?? '', 'jsonc');
    for (const aba of abas) {
      aba.setAttribute('aria-selected', String(aba.dataset['configTab'] === id));
    }
  }

  const grupo = createTabGroup(ids, { onChange: (id) => pintar(id) });

  for (const aba of abas) {
    aba.addEventListener('click', () => grupo.select(aba.dataset['configTab'] as string));
  }

  pintar(grupo.active());

  return { highlighted: estaticos.length, activeTab: () => grupo.active() };
}
