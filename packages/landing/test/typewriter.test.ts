import { describe, expect, it } from 'vitest';

import { createTypewriter, type ScriptLine } from '../src/modules/typewriter.js';

const roteiro: ScriptLine[] = [
  { text: 'abc', tone: 'prompt', pauseMs: 0 },
  { text: 'de', pauseMs: 0 },
];

describe('createTypewriter', () => {
  it('comeca vazio antes de qualquer avanco', () => {
    const tw = createTypewriter(roteiro, { charMs: 10 });
    expect(tw.frame()).toEqual({ lines: [{ text: '', tone: 'prompt', typing: true }], done: false });
  });

  it('digita caractere a caractere', () => {
    const tw = createTypewriter(roteiro, { charMs: 10 });
    expect(tw.advance(10).lines[0]?.text).toBe('a');
    expect(tw.advance(10).lines[0]?.text).toBe('ab');
    expect(tw.advance(10).lines[0]?.text).toBe('abc');
  });

  it('marca a linha ativa como em digitacao', () => {
    const tw = createTypewriter(roteiro, { charMs: 10 });
    expect(tw.advance(10).lines[0]?.typing).toBe(true);
    expect(tw.advance(20).lines[0]?.typing).toBe(false);
  });

  it('preserva o tom de cada linha', () => {
    const tw = createTypewriter(roteiro, { charMs: 10 });
    const quadro = tw.finish();
    expect(quadro.lines.map((l) => l.tone)).toEqual(['prompt', '']);
  });

  it('so mostra a proxima linha depois da anterior', () => {
    const tw = createTypewriter(roteiro, { charMs: 10 });
    expect(tw.advance(25).lines).toHaveLength(1);
    expect(tw.advance(10).lines).toHaveLength(2);
  });

  it('escreve linhas instantaneas de uma vez', () => {
    const tw = createTypewriter([{ text: 'inteira', instant: true, pauseMs: 0 }], { charMs: 10 });
    expect(tw.advance(0).lines[0]).toEqual({ text: 'inteira', tone: '', typing: false });
  });

  it('respeita a pausa de cada linha', () => {
    const tw = createTypewriter(
      [
        { text: 'a', pauseMs: 100 },
        { text: 'b', pauseMs: 0 },
      ],
      { charMs: 10 },
    );
    expect(tw.advance(10).lines).toHaveLength(1);
    expect(tw.advance(50).lines).toHaveLength(1);
    expect(tw.advance(60).lines).toHaveLength(2);
  });

  it('usa a pausa padrao quando a linha nao define uma', () => {
    const tw = createTypewriter([{ text: 'a' }, { text: 'b' }], { charMs: 10, linePauseMs: 50 });
    expect(tw.advance(10).lines).toHaveLength(1);
    expect(tw.advance(51).lines).toHaveLength(2);
  });

  it('calcula a duracao total do roteiro', () => {
    const tw = createTypewriter(roteiro, { charMs: 10, linePauseMs: 0 });
    expect(tw.durationMs).toBe(50);
  });

  it('finish salta para o fim', () => {
    const tw = createTypewriter(roteiro, { charMs: 10 });
    const quadro = tw.finish();
    expect(quadro.done).toBe(true);
    expect(quadro.lines.map((l) => l.text)).toEqual(['abc', 'de']);
  });

  it('reset volta ao inicio', () => {
    const tw = createTypewriter(roteiro, { charMs: 10 });
    tw.finish();
    tw.reset();
    expect(tw.frame().lines[0]?.text).toBe('');
  });

  it('ignora avanco negativo', () => {
    const tw = createTypewriter(roteiro, { charMs: 10 });
    tw.advance(20);
    expect(tw.advance(-100).lines[0]?.text).toBe('ab');
  });

  it('reinicia sozinho quando ha laco configurado', () => {
    const tw = createTypewriter([{ text: 'a', pauseMs: 0 }], {
      charMs: 10,
      loopPauseMs: 30,
    });
    tw.advance(10);
    expect(tw.frame().done).toBe(true);
    tw.advance(30);
    expect(tw.frame().lines[0]?.text).toBe('');
  });

  it('nao reinicia quando o laco esta desligado', () => {
    const tw = createTypewriter([{ text: 'a', pauseMs: 0 }], { charMs: 10 });
    tw.advance(10_000);
    expect(tw.frame().lines[0]?.text).toBe('a');
  });

  it('trata roteiro vazio', () => {
    const tw = createTypewriter([]);
    expect(tw.durationMs).toBe(0);
    expect(tw.advance(100)).toEqual({ lines: [], done: true });
  });

  it('aplica um minimo de 1ms por caractere', () => {
    const tw = createTypewriter([{ text: 'ab', pauseMs: 0 }], { charMs: 0 });
    expect(tw.durationMs).toBe(2);
  });

  it('trata pausa negativa como zero', () => {
    const tw = createTypewriter([{ text: 'a', pauseMs: 0 }], { charMs: 10, linePauseMs: -50 });
    expect(tw.durationMs).toBe(10);
  });

  it('trata loopPauseMs negativo como desligado', () => {
    const tw = createTypewriter([{ text: 'a', pauseMs: 0 }], { charMs: 10, loopPauseMs: -5 });
    tw.advance(1000);
    expect(tw.frame().lines[0]?.text).toBe('a');
  });
});
