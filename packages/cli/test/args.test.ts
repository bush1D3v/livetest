import { describe, expect, it } from 'vitest';

import { formatFlagHelp, parseArgs, type FlagSpecs } from '../src/args.js';

const SPECS: FlagSpecs = {
  config: { type: 'string', alias: 'c', description: 'Configuracao', valueName: 'caminho' },
  depth: { type: 'string', description: 'Profundidade' },
  concurrency: { type: 'number', description: 'Simultaneas' },
  verbose: { type: 'boolean', alias: 'v', description: 'Verboso' },
  color: { type: 'boolean', description: 'Cores' },
  include: { type: 'string[]', description: 'Inclui um glob' },
};

describe('parseArgs', () => {
  it('trata argumentos posicionais', () => {
    expect(parseArgs(['a.ts', 'b.ts'], SPECS)).toEqual({
      values: {},
      positionals: ['a.ts', 'b.ts'],
      errors: [],
    });
  });

  it('aceita --flag valor', () => {
    expect(parseArgs(['--depth', 'transitive'], SPECS).values['depth']).toBe('transitive');
  });

  it('aceita --flag=valor', () => {
    expect(parseArgs(['--depth=self'], SPECS).values['depth']).toBe('self');
  });

  it('aceita alias de uma letra', () => {
    expect(parseArgs(['-c', 'x.json'], SPECS).values['config']).toBe('x.json');
  });

  it('flags booleanas nao consomem o proximo argumento', () => {
    const parsed = parseArgs(['--verbose', 'a.ts'], SPECS);
    expect(parsed.values['verbose']).toBe(true);
    expect(parsed.positionals).toEqual(['a.ts']);
  });

  it('--no-flag desliga uma booleana', () => {
    expect(parseArgs(['--no-color'], SPECS).values['color']).toBe(false);
  });

  it('--flag=false desliga uma booleana', () => {
    expect(parseArgs(['--color=false'], SPECS).values['color']).toBe(false);
    expect(parseArgs(['--color=0'], SPECS).values['color']).toBe(false);
  });

  it('converte numeros', () => {
    expect(parseArgs(['--concurrency', '4'], SPECS).values['concurrency']).toBe(4);
  });

  it('rejeita numero invalido', () => {
    expect(parseArgs(['--concurrency', 'muitos'], SPECS).errors[0]).toContain('espera um numero');
  });

  it('acumula flags de lista', () => {
    expect(parseArgs(['--include', 'a', '--include', 'b'], SPECS).values['include']).toEqual([
      'a',
      'b',
    ]);
  });

  it('reporta flag desconhecida', () => {
    expect(parseArgs(['--inexistente'], SPECS).errors[0]).toContain('Opcao desconhecida');
  });

  it('reporta flag de valor sem valor', () => {
    expect(parseArgs(['--depth'], SPECS).errors[0]).toContain('espera um valor');
    expect(parseArgs(['--depth', '--verbose'], SPECS).errors[0]).toContain('espera um valor');
  });

  it('-- encerra o parsing de flags', () => {
    const parsed = parseArgs(['--verbose', '--', '--nao-e-flag'], SPECS);
    expect(parsed.values['verbose']).toBe(true);
    expect(parsed.positionals).toEqual(['--nao-e-flag']);
  });

  it('trata "-" sozinho como posicional', () => {
    expect(parseArgs(['-'], SPECS).positionals).toEqual(['-']);
  });

  it('a ultima ocorrencia vence para flags escalares', () => {
    expect(parseArgs(['--depth', 'a', '--depth', 'b'], SPECS).values['depth']).toBe('b');
  });
});

describe('formatFlagHelp', () => {
  it('alinha nomes, aliases e descricoes', () => {
    const lines = formatFlagHelp(SPECS);
    expect(lines[0]).toContain('-c, --config <caminho>');
    expect(lines[0]).toContain('Configuracao');
  });

  it('nao mostra placeholder de valor para booleana', () => {
    const line = formatFlagHelp(SPECS).find((l) => l.includes('--verbose'));
    expect(line).not.toContain('<');
  });

  it('devolve lista vazia para spec vazia', () => {
    expect(formatFlagHelp({})).toEqual([]);
  });
});
