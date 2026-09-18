import { describe, expect, it } from 'vitest';

import { escapeHtml, highlight, resolverLinguagem } from '../src/modules/highlight.js';

/**
 * Devolve o texto que o navegador mostraria: sem as tags e com as entidades
 * desfeitas. E o unico jeito honesto de conferir que o realce nao perdeu nem
 * inventou caractere, ja que aspas e `&` viajam escapados.
 */
const comoSeVe = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

describe('escapeHtml', () => {
  it('escapa os caracteres perigosos', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('escapa o & antes dos demais, sem duplicar', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('highlight — jsonc', () => {
  it('marca chave, string, numero e literal', () => {
    const html = highlight('{ "a": "b", "n": 12, "ok": true }', 'jsonc');
    expect(html).toContain('<span class="tok-key">&quot;a&quot;</span>');
    expect(html).toContain('<span class="tok-string">&quot;b&quot;</span>');
    expect(html).toContain('<span class="tok-number">12</span>');
    expect(html).toContain('<span class="tok-literal">true</span>');
  });

  it('marca pontuacao', () => {
    expect(highlight('{}', 'jsonc')).toContain('<span class="tok-punct">{</span>');
  });

  it('marca comentario de linha', () => {
    const html = highlight('  // nota', 'jsonc');
    expect(html).toContain('<span class="tok-comment">// nota</span>');
  });

  it('nao confunde barras dentro de string com comentario', () => {
    const html = highlight('{ "url": "http://x/y" }', 'jsonc');
    expect(html).not.toContain('tok-comment');
    expect(html).toContain('<span class="tok-string">&quot;http://x/y&quot;</span>');
  });

  it('marca comentario que vem depois de um valor', () => {
    const html = highlight('"a": 1, // fim', 'jsonc');
    expect(html).toContain('tok-comment');
    expect(html).toContain('tok-number');
  });

  it('preserva numeros negativos e decimais', () => {
    expect(highlight('-2.5', 'jsonc')).toContain('<span class="tok-number">-2.5</span>');
  });

  it('escapa conteudo perigoso dentro de string', () => {
    const html = highlight('"<script>"', 'jsonc');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('lida com aspas escapadas dentro da string', () => {
    const html = highlight('{ "a": "diz \\"oi\\"" }', 'jsonc');
    expect(comoSeVe(html)).toBe('{ "a": "diz \\"oi\\"" }');
  });

  it('preserva o texto de linhas sem token', () => {
    expect(comoSeVe(highlight('   ', 'jsonc'))).toBe('   ');
  });

  it('realca varias linhas de uma vez', () => {
    const html = highlight('{\n  "a": 1\n}', 'jsonc');
    expect(html.split('\n')).toHaveLength(3);
  });
});

describe('highlight — bash', () => {
  it('marca prompt, comando, flag e argumento', () => {
    const html = highlight('$ npx livetest run --depth self', 'bash');
    expect(html).toContain('<span class="tok-prompt">$ </span>');
    expect(html).toContain('<span class="tok-command">npx</span>');
    expect(html).toContain('<span class="tok-flag">--depth</span>');
    expect(html).toContain('<span class="tok-arg">self</span>');
  });

  it('trata linha sem prompt como comentario', () => {
    expect(highlight('saida qualquer', 'bash')).toContain('tok-comment');
  });

  it('ignora espacos duplicados sem gerar span vazio', () => {
    const html = highlight('$ a  b', 'bash');
    expect(html).not.toContain('<span class="tok-arg"></span>');
  });
});

describe('highlight — output', () => {
  it('destaca a linha resumo campo a campo', () => {
    const html = highlight('LIVETEST batch=batch-1 status=passed', 'output');
    expect(html).toContain('<span class="tok-command">LIVETEST</span>');
    expect(html).toContain('<span class="tok-key">batch</span>');
    expect(html).toContain('<span class="tok-value">passed</span>');
  });

  it('preserva campo sem sinal de igual', () => {
    const html = highlight('LIVETEST solto', 'output');
    expect(comoSeVe(html)).toBe('LIVETEST solto');
  });

  it('esmaece o motivo da selecao', () => {
    const html = highlight('  a.test.ts  rodou porque b.ts importa a.ts', 'output');
    expect(html).toContain('<span class="tok-comment">rodou porque b.ts importa a.ts</span>');
  });

  it('colore PASSOU e FALHOU', () => {
    expect(highlight('  PASSOU js', 'output')).toContain('<span class="tok-pass">PASSOU</span>');
    expect(highlight('  FALHOU js', 'output')).toContain('<span class="tok-fail">FALHOU</span>');
  });

  it('escapa linhas comuns', () => {
    expect(highlight('a < b', 'output')).toBe('a &lt; b');
  });
});

describe('resolverLinguagem', () => {
  it('reconhece os apelidos que a documentacao usa', () => {
    expect(resolverLinguagem('json')).toBe('jsonc');
    expect(resolverLinguagem('shell')).toBe('bash');
    expect(resolverLinguagem('TypeScript')).toBe('ts');
    expect(resolverLinguagem('  text  ')).toBe('output');
  });

  it('nome desconhecido sai sem realce, em vez de quebrar', () => {
    expect(resolverLinguagem('go')).toBe('plain');
    expect(resolverLinguagem('')).toBe('plain');
  });
});

describe('highlight — typescript', () => {
  it('separa palavra-chave, tipo, literal e string', () => {
    const html = highlight("export const a: Depth = 'self';", 'ts');
    expect(html).toContain('<span class="tok-keyword">export</span>');
    expect(html).toContain('<span class="tok-keyword">const</span>');
    expect(html).toContain('<span class="tok-type">Depth</span>');
    expect(html).toContain('<span class="tok-string">&#39;self&#39;</span>');
  });

  it('marca a chamada de funcao e o nome de campo', () => {
    const html = highlight('createEngine({ config: 1 })', 'ts');
    expect(html).toContain('<span class="tok-command">createEngine</span>');
    expect(html).toContain('<span class="tok-key">config</span>');
    expect(html).toContain('<span class="tok-number">1</span>');
  });

  it('reconhece os valores embutidos', () => {
    expect(highlight('return null;', 'ts')).toContain('<span class="tok-literal">null</span>');
  });

  it('esmaece comentario de linha', () => {
    expect(highlight('const a = 1; // nota', 'ts')).toContain(
      '<span class="tok-comment">// nota</span>',
    );
  });

  it('atravessa comentario de bloco de varias linhas', () => {
    const html = highlight(['/**', ' * doc', ' */', 'const a = 1;'].join('\n'), 'ts');
    expect(html).toContain('<span class="tok-comment"> * doc</span>');
    expect(html).toContain('<span class="tok-keyword">const</span>');
  });

  it('fecha o bloco no meio da linha e volta a realcar', () => {
    const html = highlight('/* nota */ const a = 1;', 'ts');
    expect(html).toContain('<span class="tok-keyword">const</span>');
  });

  it('escapa o que nao vira token', () => {
    expect(highlight('a < b', 'ts')).toContain('&lt;');
  });

  it('aceita crase e aspas duplas como string', () => {
    expect(highlight('const a = `x`;', 'ts')).toContain('<span class="tok-string">`x`</span>');
    expect(highlight('const a = "x";', 'ts')).toContain(
      '<span class="tok-string">&quot;x&quot;</span>',
    );
  });
});

describe('highlight — sem linguagem', () => {
  it('apenas escapa', () => {
    expect(highlight('<a> & "b"', 'plain')).toBe('&lt;a&gt; &amp; &quot;b&quot;');
  });
});
