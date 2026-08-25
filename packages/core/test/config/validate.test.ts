import { describe, expect, it } from 'vitest';

import {
  assertValidUserConfig,
  depthToNumber,
  describeDepth,
  isDependencyDepth,
  validateUserConfig,
} from '../../src/config/validate.js';

describe('isDependencyDepth', () => {
  it.each(['self', 'direct', 'transitive', 0, 1, 7])('aceita %s', (value) => {
    expect(isDependencyDepth(value)).toBe(true);
  });

  it.each([-1, 1.5, 'deep', null, {}])('rejeita %s', (value) => {
    expect(isDependencyDepth(value)).toBe(false);
  });
});

describe('depthToNumber', () => {
  it('mapeia os nomes para saltos', () => {
    expect(depthToNumber('self')).toBe(0);
    expect(depthToNumber('direct')).toBe(1);
    expect(depthToNumber('transitive')).toBe(Number.POSITIVE_INFINITY);
    expect(depthToNumber(3)).toBe(3);
  });
});

describe('describeDepth', () => {
  it('descreve cada nivel em texto', () => {
    expect(describeDepth('self')).toContain('proprio arquivo');
    expect(describeDepth('direct')).toContain('importadores diretos');
    expect(describeDepth('transitive')).toContain('cadeia completa');
    expect(describeDepth(0)).toContain('proprio arquivo');
    expect(describeDepth(2)).toContain('2 nivel');
  });
});

describe('validateUserConfig', () => {
  it('aceita objeto vazio', () => {
    expect(validateUserConfig({}).ok).toBe(true);
  });

  it('rejeita valores que nao sao objeto', () => {
    const result = validateUserConfig([1, 2]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('objeto JSON');
  });

  it('avisa sobre campos desconhecidos sem invalidar', () => {
    const result = validateUserConfig({ naoExiste: 1 });
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toContain('naoExiste');
  });

  it('nao avisa sobre $schema', () => {
    expect(validateUserConfig({ $schema: './s.json' }).warnings).toHaveLength(0);
  });

  it('valida tipos dos campos simples', () => {
    const result = validateUserConfig({ root: 1, watch: 'x', useGitignore: 'sim', concurrency: 0 });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'root deve ser uma string.',
        'watch deve ser um array de strings.',
        'useGitignore deve ser um booleano.',
        'concurrency deve ser um inteiro maior ou igual a 1.',
      ]),
    );
  });

  it('valida logLevel', () => {
    expect(validateUserConfig({ logLevel: 'verbose' }).ok).toBe(false);
    expect(validateUserConfig({ logLevel: 'debug' }).ok).toBe(true);
  });

  it('valida dependencyDepth e seus overrides', () => {
    const result = validateUserConfig({
      dependencyDepth: { default: 'deep', overrides: { 'src/a.ts': -2 } },
    });
    expect(result.errors).toHaveLength(2);
    expect(result.errors[1]).toContain('src/a.ts');
  });

  it('rejeita overrides que nao sao objeto', () => {
    const result = validateUserConfig({ dependencyDepth: { overrides: [] } });
    expect(result.errors[0]).toContain('overrides');
  });

  it('valida o debounce', () => {
    expect(validateUserConfig({ debounce: { mode: 'x' } }).ok).toBe(false);
    expect(validateUserConfig({ debounce: { idleMs: -1 } }).ok).toBe(false);
    expect(validateUserConfig({ debounce: { idleMs: 5000, maxBatchWindowMs: 1000 } }).errors[0])
      .toContain('nao pode ser maior');
    expect(validateUserConfig({ debounce: { idleMs: 400, maxBatchWindowMs: 3000 } }).ok).toBe(true);
  });

  it('valida runners', () => {
    const result = validateUserConfig({
      runners: {
        js: { adapter: 1, match: 'x', timeoutMs: 0, env: { A: 1 } },
        go: { adapter: 'command' },
      },
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'runners.js.adapter deve ser uma string.',
        'runners.js.match deve ser um array de strings.',
        'runners.js.timeoutMs deve ser um numero maior que 0.',
        'runners.js.env deve conter apenas valores string.',
        'runners.go.command e obrigatorio quando adapter e "command".',
      ]),
    );
  });

  it('avisa quando runners esta vazio', () => {
    expect(validateUserConfig({ runners: {} }).warnings[0]).toContain('vazio');
  });

  it('valida output', () => {
    const result = validateUserConfig({
      output: { logFile: 1, stdout: 'sim', format: 'xml', color: 'talvez', logTailLines: -1 },
    });
    expect(result.errors).toHaveLength(5);
  });

  it('aceita logFile null', () => {
    expect(validateUserConfig({ output: { logFile: null, statusFile: null } }).ok).toBe(true);
  });

  it('valida server', () => {
    const result = validateUserConfig({ server: { enabled: 'sim', host: 1, port: 70000 } });
    expect(result.errors).toHaveLength(3);
  });

  it('aceita porta 0 (escolhida pelo SO)', () => {
    expect(validateUserConfig({ server: { port: 0 } }).ok).toBe(true);
  });
});

describe('assertValidUserConfig', () => {
  it('nao lanca para configuracao valida', () => {
    expect(() => assertValidUserConfig({ concurrency: 2 })).not.toThrow();
  });

  it('lanca listando os problemas', () => {
    expect(() => assertValidUserConfig({ concurrency: 0 })).toThrow(/concurrency/);
  });
});

describe('validateUserConfig — secoes com tipo errado', () => {
  it.each([
    ['dependencyDepth', 'dependencyDepth deve ser um objeto.'],
    ['debounce', 'debounce deve ser um objeto.'],
    ['runners', 'runners deve ser um objeto.'],
    ['output', 'output deve ser um objeto.'],
    ['server', 'server deve ser um objeto.'],
  ])('rejeita %s que nao e objeto', (campo, mensagem) => {
    expect(validateUserConfig({ [campo]: 'texto' }).errors).toContain(mensagem);
  });

  it('rejeita um runner que nao e objeto', () => {
    expect(validateUserConfig({ runners: { js: 'vitest' } }).errors).toContain(
      'runners.js deve ser um objeto.',
    );
  });

  it('rejeita env que nao e objeto', () => {
    expect(validateUserConfig({ runners: { js: { env: [] } } }).errors).toContain(
      'runners.js.env deve ser um objeto de strings.',
    );
  });

  it('aceita todos os campos de runner com os tipos corretos', () => {
    const result = validateUserConfig({
      runners: {
        js: {
          adapter: 'vitest',
          command: 'npx',
          graph: 'js-ts',
          cwd: 'pacote',
          match: ['**/*.ts'],
          args: ['--silent'],
          testPatterns: ['{dir}/{name}.test.{ext}'],
          testMatch: ['**/*.test.ts'],
          testExtensions: ['ts'],
          env: { CI: '1' },
          timeoutMs: 1000,
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it('rejeita testExtensions que nao e array de strings', () => {
    expect(validateUserConfig({ runners: { js: { testExtensions: [1] } } }).errors).toContain(
      'runners.js.testExtensions deve ser um array de strings.',
    );
  });

  it('aceita debounce com maxBatchWindowMs zero (sem teto)', () => {
    expect(validateUserConfig({ debounce: { idleMs: 900, maxBatchWindowMs: 0 } }).ok).toBe(true);
  });

  it('rejeita idleMs nao numerico', () => {
    expect(validateUserConfig({ debounce: { idleMs: 'rapido' } }).errors[0]).toContain('idleMs');
  });

  it('aceita output.color booleano', () => {
    expect(validateUserConfig({ output: { color: true } }).ok).toBe(true);
    expect(validateUserConfig({ output: { color: false } }).ok).toBe(true);
  });

  it('aceita server.discoveryFile', () => {
    expect(validateUserConfig({ server: { discoveryFile: '.x/d.json' } }).ok).toBe(true);
  });

  it('rejeita port nao inteiro', () => {
    expect(validateUserConfig({ server: { port: 1.5 } }).errors[0]).toContain('server.port');
  });

  it('rejeita concurrency nao numerico', () => {
    expect(validateUserConfig({ concurrency: 'muitos' }).errors[0]).toContain('concurrency');
  });

  it('rejeita dryRun nao booleano', () => {
    expect(validateUserConfig({ dryRun: 'sim' }).errors[0]).toContain('dryRun');
  });

  it('rejeita pythonPath nao string', () => {
    expect(validateUserConfig({ pythonPath: 3 }).errors[0]).toContain('pythonPath');
  });

  it('rejeita ignore que nao e array de strings', () => {
    expect(validateUserConfig({ ignore: [1, 2] }).errors[0]).toContain('ignore');
  });

  it('aceita profundidade numerica nos overrides', () => {
    expect(
      validateUserConfig({ dependencyDepth: { default: 2, overrides: { 'a/**': 0 } } }).ok,
    ).toBe(true);
  });
});
