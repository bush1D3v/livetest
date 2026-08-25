/**
 * `livetest doctor` — diagnostico do ambiente.
 *
 * Verifica, em ordem, tudo que pode fazer o daemon "nao rodar nada" sem uma
 * mensagem obvia: configuracao invalida, nenhum arquivo casando com os globs,
 * runner sem binario instalado, interpretador Python ausente e arquivos-fonte
 * sem teste correspondente.
 *
 * @packageDocumentation
 */

import { createEngine, relativeToRoot, runProcess } from '@livetest/core';

import type { Command, CommandContext } from '../context.js';
import { EXIT, loadConfigForCommand } from '../context.js';

/** Resultado de uma verificacao. */
export interface Check {
  name: string;
  status: 'ok' | 'aviso' | 'erro';
  detail: string;
}

/** Simbolo de cada status. */
const SYMBOL: Record<Check['status'], string> = { ok: 'ok  ', aviso: 'aviso', erro: 'ERRO' };

/** Testa se um comando existe e responde. */
export async function probeCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<{ available: boolean; detail: string }> {
  const result = await runProcess({ command, args: [...args], cwd, timeoutMs: 20_000 });
  if (result.spawnError) return { available: false, detail: result.spawnError };
  if (result.exitCode !== 0) {
    // `split` sempre devolve ao menos um elemento, entao o indice 0 existe.
    const detail = (result.stderr || result.stdout).trim().split('\n')[0] as string;
    return { available: false, detail: `saiu com codigo ${result.exitCode}: ${detail}` };
  }
  return {
    available: true,
    detail: (result.stdout || result.stderr).trim().split('\n')[0] as string,
  };
}

/** Implementacao de `livetest doctor`. */
export const doctorCommand: Command = {
  name: 'doctor',
  summary: 'Verifica configuracao, runners e ambiente',
  usage: 'livetest doctor [opcoes]',
  flags: {
    json: { type: 'boolean', description: 'Imprime as verificacoes como JSON' },
  },

  async run(context: CommandContext): Promise<number> {
    const checks: Check[] = [];
    const { config, warnings } = await loadConfigForCommand(context, {
      server: { enabled: false },
      output: { stdout: false, logFile: null, statusFile: null },
    });

    checks.push({
      name: 'configuracao',
      status: warnings.length > 0 ? 'aviso' : 'ok',
      detail: config.configPath ?? 'usando os valores padrao (nenhum arquivo encontrado)',
    });
    checks.push({ name: 'node', status: 'ok', detail: process.version });

    const engine = createEngine({ config });
    await engine.start();

    try {
      const files = engine.graph.files();
      checks.push({
        name: 'arquivos observados',
        status: files.length > 0 ? 'ok' : 'erro',
        detail:
          files.length > 0
            ? `${files.length} arquivo(s) casando com "watch"`
            : `nenhum arquivo casa com ${JSON.stringify(config.watch)}`,
      });

      const semTeste = files.filter(
        (file) => !engine.resolver.isTestFile(file) && engine.resolver.resolve(file).testFiles.length === 0,
      );
      checks.push({
        name: 'cobertura de testes',
        status: semTeste.length === files.length && files.length > 0 ? 'erro' : semTeste.length > 0 ? 'aviso' : 'ok',
        detail:
          semTeste.length === 0
            ? 'todo arquivo-fonte tem teste correspondente'
            : `${semTeste.length} arquivo(s) sem teste, ex.: ${semTeste
                .slice(0, 3)
                .map((f) => relativeToRoot(config.root, f))
                .join(', ')}`,
      });

      for (const [key, runner] of Object.entries(config.runners)) {
        const probe = await probeRunner(key, runner.adapter, runner.command, config, context.cwd);
        checks.push(probe);
      }
    } finally {
      await engine.stop('diagnostico concluido');
    }

    if (context.flags['json'] === true) {
      context.output.out(JSON.stringify({ checks }, null, 2));
    } else {
      for (const check of checks) {
        context.output.out(`[${SYMBOL[check.status]}] ${check.name.padEnd(22)} ${check.detail}`);
      }
    }

    return checks.some((check) => check.status === 'erro') ? EXIT.config : EXIT.ok;
  },
};

/**
 * Verifica se o binario de um runner esta disponivel.
 *
 * @param key - Chave do runner na configuracao, usada no nome da verificacao.
 * @param adapter - Id do adapter, que decide qual binario procurar.
 * @param command - Comando declarado pelo usuario, quando houver.
 */
export async function probeRunner(
  key: string,
  adapter: string,
  command: string | undefined,
  config: { root: string; pythonPath: string },
  cwd: string,
): Promise<Check> {
  const name = `runner "${key}"`;

  if (adapter === 'pytest') {
    const probe = await probeCommand(command ?? config.pythonPath, ['-m', 'pytest', '--version'], cwd);
    return {
      name,
      status: probe.available ? 'ok' : 'erro',
      detail: probe.available ? probe.detail : `pytest indisponivel — ${probe.detail}`,
    };
  }

  if (adapter === 'vitest' || adapter === 'jest') {
    const probe = await probeCommand(command ?? 'npx', [adapter, '--version'], cwd);
    return {
      name,
      status: probe.available ? 'ok' : 'erro',
      detail: probe.available ? probe.detail : `${adapter} indisponivel — ${probe.detail}`,
    };
  }

  if (adapter === 'command') {
    return {
      name,
      status: command ? 'ok' : 'erro',
      detail: command ? `comando "${command}"` : 'adapter "command" exige a chave "command"',
    };
  }

  return { name, status: 'aviso', detail: `adapter customizado "${adapter}" nao verificado` };
}
