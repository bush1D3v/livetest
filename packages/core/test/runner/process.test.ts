import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import { killTree, needsShell, quoteForShell, runProcess } from '../../src/runner/process.js';
import { normalizePath } from '../../src/util/paths.js';

const cwd = normalizePath(process.cwd());

describe('needsShell', () => {
  it('nunca usa shell fora do Windows', () => {
    expect(needsShell('npx', 'linux')).toBe(false);
    expect(needsShell('python', 'darwin')).toBe(false);
  });

  it('usa shell no Windows para comandos sem extensao (npx.cmd)', () => {
    expect(needsShell('npx', 'win32')).toBe(true);
    expect(needsShell('python', 'win32')).toBe(true);
  });

  it('dispensa shell no Windows para .exe', () => {
    expect(needsShell('C:/Python/python.exe', 'win32')).toBe(false);
    expect(needsShell('node.EXE', 'win32')).toBe(false);
  });
});

describe('quoteForShell', () => {
  it('nao cita argumentos simples', () => {
    expect(quoteForShell('--reporter=json')).toBe('--reporter=json');
  });

  it('cita caminhos com espaco', () => {
    expect(quoteForShell('C:/meu projeto/a.ts')).toBe('"C:/meu projeto/a.ts"');
  });

  it('cita metacaracteres do shell', () => {
    expect(quoteForShell('a&b')).toBe('"a&b"');
    expect(quoteForShell('a|b')).toBe('"a|b"');
  });

  it('duplica aspas internas', () => {
    expect(quoteForShell('diz "oi"')).toBe('"diz ""oi"""');
  });

  it('representa string vazia como par de aspas', () => {
    expect(quoteForShell('')).toBe('""');
  });
});

describe('runProcess', () => {
  it('captura stdout e o codigo de saida', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("ola")'],
      cwd,
      timeoutMs: 20_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ola');
    expect(result.spawnError).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captura stderr e codigo de saida diferente de zero', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'process.stderr.write("ruim"); process.exit(3)'],
      cwd,
      timeoutMs: 20_000,
    });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe('ruim');
  });

  it('repassa variaveis de ambiente', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.env.LIVETEST_X ?? "")'],
      cwd,
      env: { LIVETEST_X: 'valor' },
      timeoutMs: 20_000,
    });
    expect(result.stdout).toBe('valor');
  });

  it('marca timedOut e mata o processo', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 30000)'],
      cwd,
      timeoutMs: 300,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it('marca cancelled quando o sinal aborta', async () => {
    const controller = new AbortController();
    const promise = runProcess({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 30000)'],
      cwd,
      timeoutMs: 30_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 150);
    const result = await promise;
    expect(result.cancelled).toBe(true);
  });

  it('reporta spawnError para executavel inexistente', async () => {
    const result = await runProcess({
      command: 'executavel-que-nao-existe-xyz',
      args: [],
      cwd,
      timeoutMs: 10_000,
    });
    expect(result.spawnError !== null || result.exitCode !== 0).toBe(true);
  });

  it('trunca a saida acima do limite de buffer', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(50000))'],
      cwd,
      timeoutMs: 20_000,
      maxBufferBytes: 1000,
    });
    expect(result.stdout).toContain('[saida truncada pelo Live Test Runner]');
  });
});

describe('killTree', () => {
  /** Processo falso: so o suficiente para o contrato de `killTree`. */
  function fakeChild(overrides: Record<string, unknown> = {}) {
    return { pid: 4242, exitCode: null, kill: vi.fn(), ...overrides } as never;
  }

  it('nao faz nada quando o processo nao tem pid', () => {
    const child = fakeChild({ pid: undefined });
    killTree(child, 'linux');
    expect((child as unknown as { kill: ReturnType<typeof vi.fn> }).kill).not.toHaveBeenCalled();
  });

  it('nao faz nada quando o processo ja terminou', () => {
    const child = fakeChild({ exitCode: 0 });
    killTree(child, 'linux');
    expect((child as unknown as { kill: ReturnType<typeof vi.fn> }).kill).not.toHaveBeenCalled();
  });

  it('usa SIGTERM fora do Windows', () => {
    const child = fakeChild();
    killTree(child, 'linux');
    expect((child as unknown as { kill: ReturnType<typeof vi.fn> }).kill).toHaveBeenCalledWith(
      'SIGTERM',
    );
  });

  it('cai para SIGTERM quando o taskkill do Windows falha', () => {
    // O pid e falso: o taskkill sai com codigo diferente de zero e o processo
    // precisa ser encerrado pelo caminho alternativo, nao ficar vivo.
    const child = fakeChild();
    killTree(child, 'win32');
    expect((child as unknown as { kill: ReturnType<typeof vi.fn> }).kill).toHaveBeenCalledWith(
      'SIGTERM',
    );
  });

  it('nao envia SIGTERM quando o taskkill encerra a arvore', () => {
    if (process.platform !== 'win32') return;
    const real = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const kill = vi.fn();
    try {
      killTree({ pid: real.pid, exitCode: null, kill } as never, 'win32');
      expect(kill).not.toHaveBeenCalled();
    } finally {
      real.kill('SIGKILL');
    }
  });

  it('ignora falha do kill de um processo ja encerrado', () => {
    const child = fakeChild({
      kill: vi.fn(() => {
        throw new Error('ESRCH');
      }),
    });
    expect(() => killTree(child, 'linux')).not.toThrow();
  });
});

describe('runProcess — falhas de criacao', () => {
  it('reporta erro quando o executavel nao existe (sem shell)', async () => {
    // A extensao `.exe` faz o spawn ocorrer sem shell, o que produz o evento
    // 'error' do processo filho em qualquer plataforma.
    const result = await runProcess({
      command: 'nao-existe-livetest-xyz.exe',
      args: [],
      cwd,
      timeoutMs: 10_000,
    });
    expect(result.spawnError).toContain('falha ao executar');
    expect(result.exitCode).toBeNull();
  });

  it('reporta erro quando o spawn falha de forma sincrona', async () => {
    const nulo = String.fromCharCode(0);
    const result = await runProcess({
      command: `node${nulo}`,
      args: [],
      cwd,
      timeoutMs: 10_000,
    });
    expect(result.spawnError).toContain('nao foi possivel iniciar');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('usa o relogio injetado para medir a duracao', async () => {
    let agora = 1000;
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', ''],
      cwd,
      timeoutMs: 10_000,
      now: () => (agora += 500),
    });
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('trunca tambem os chunks seguintes ao limite', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: [
        '-e',
        'process.stdout.write("a".repeat(600)); setTimeout(() => process.stdout.write("b".repeat(600)), 30);',
      ],
      cwd,
      timeoutMs: 20_000,
      maxBufferBytes: 500,
    });
    expect(result.stdout).toContain('[saida truncada pelo Live Test Runner]');
    expect(result.stdout).not.toContain('b');
  });
});
