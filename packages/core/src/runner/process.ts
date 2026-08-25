/**
 * Execucao de processos de teste.
 *
 * Concentra tres detalhes que, se espalhados pelos adapters, seriam fonte
 * garantida de bug:
 *
 * 1. **Windows** — desde as correcoes de seguranca do Node 18.20/20.12,
 *    `spawn('npx', ...)` falha para arquivos `.cmd`/`.bat` sem `shell: true`.
 *    Ligamos o shell automaticamente e citamos os argumentos nos.
 * 2. **Timeout e cancelamento** — matar so o processo direto deixa orfaos
 *    (`npx` -> `node` -> worker). Matamos a arvore inteira.
 * 3. **Limite de buffer** — a saida de um teste ruidoso nao pode consumir a
 *    memoria do daemon.
 *
 * @packageDocumentation
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

import { toNative } from '../util/paths.js';

/** Resultado bruto da execucao de um processo. */
export interface ProcessResult {
  exitCode: number | null;
  /** Sinal que encerrou o processo, quando aplicavel. */
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Mensagem quando o processo nao pode nem ser iniciado. */
  spawnError: string | null;
}

/** Opcoes de {@link runProcess}. */
export interface RunProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  /** Variaveis adicionadas ao ambiente herdado. */
  env?: Record<string, string>;
  timeoutMs: number;
  /** Cancela a execucao (novo lote de alteracoes chegou). */
  signal?: AbortSignal;
  /** Limite de bytes capturados por fluxo. @defaultValue 2_000_000 */
  maxBufferBytes?: number;
  /** Relogio injetavel, para testes deterministicos. */
  now?: () => number;
}

/** Argumentos que precisam de aspas ao passar pelo `cmd.exe`. */
const NEEDS_QUOTING = /[\s&|<>^()"]/;

/**
 * Decide se o comando precisa ser executado atraves do shell.
 *
 * Exportado para teste: a regra e sutil e especifica de plataforma.
 */
export function needsShell(command: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return false;
  return !/\.(exe|com)$/i.test(command);
}

/**
 * Cita um argumento para uso dentro do `cmd.exe`.
 *
 * @example
 * ```ts
 * quoteForShell('C:/meu projeto/a.ts'); // '"C:/meu projeto/a.ts"'
 * ```
 */
export function quoteForShell(argument: string): string {
  if (argument.length === 0) return '""';
  if (!NEEDS_QUOTING.test(argument)) return argument;
  return `"${argument.replace(/"/g, '""')}"`;
}

/**
 * Mata o processo e seus descendentes.
 *
 * No Windows `child.kill()` nao alcanca os netos: `npx` cria um `node`, que
 * cria workers. Usamos `taskkill /T` para derrubar a arvore.
 */
export function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
  if (child.pid === undefined || child.exitCode !== null) return;

  if (platform === 'win32') {
    // `spawnSync` nao lanca quando o comando falha: devolve `error` ou um
    // `status` diferente de zero. Sem checar isso, um `taskkill` indisponivel
    // deixaria o processo vivo em silencio.
    const resultado = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
    });
    if (!resultado.error && resultado.status === 0) return;
  }

  try {
    child.kill('SIGTERM');
  } catch {
    /* processo ja encerrado entre a checagem e o sinal */
  }
}

/** Acumulador de saida com limite de bytes. */
function createCollector(limit: number) {
  const chunks: string[] = [];
  let size = 0;
  let truncated = false;
  return {
    push(chunk: string): void {
      if (size >= limit) {
        truncated = true;
        return;
      }
      const bytes = Buffer.byteLength(chunk);
      if (size + bytes <= limit) {
        size += bytes;
        chunks.push(chunk);
        return;
      }
      // Um unico chunk pode estourar o limite sozinho (um teste que despeja
      // megabytes de uma vez); cortamos dentro dele em vez de aceitar tudo.
      chunks.push(chunk.slice(0, Math.max(0, limit - size)));
      size = limit;
      truncated = true;
    },
    value(): string {
      const text = chunks.join('');
      return truncated ? `${text}\n[saida truncada pelo Live Test Runner]` : text;
    },
  };
}

/**
 * Executa um processo e devolve a saida capturada.
 *
 * Nunca rejeita: qualquer falha vira um {@link ProcessResult} com
 * `spawnError`, `timedOut` ou `cancelled` preenchidos.
 *
 * @example
 * ```ts
 * const result = await runProcess({
 *   command: 'npx', args: ['vitest', 'run'], cwd: '/proj', timeoutMs: 60_000,
 * });
 * result.exitCode; // 0
 * ```
 */
export function runProcess(options: RunProcessOptions): Promise<ProcessResult> {
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const useShell = needsShell(options.command);
  const maxBuffer = options.maxBufferBytes ?? 2_000_000;

  return new Promise<ProcessResult>((resolve) => {
    const stdout = createCollector(maxBuffer);
    const stderr = createCollector(maxBuffer);
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const args = useShell ? options.args.map(quoteForShell) : options.args;
    const command = useShell ? quoteForShell(options.command) : options.command;

    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd: toNative(options.cwd),
        env: { ...process.env, ...(options.env ?? {}) },
        shell: useShell,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve(failure(`nao foi possivel iniciar "${options.command}": ${String(error)}`));
      return;
    }

    function failure(message: string): ProcessResult {
      return {
        exitCode: null,
        signal: null,
        timedOut,
        cancelled,
        stdout: stdout.value(),
        stderr: stderr.value(),
        durationMs: now() - startedAt,
        spawnError: message,
      };
    }

    function finish(result: ProcessResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, options.timeoutMs);
    timer.unref?.();

    function onAbort(): void {
      cancelled = true;
      killTree(child);
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));

    child.on('error', (error) => {
      finish(failure(`falha ao executar "${options.command}": ${error.message}`));
    });

    child.on('close', (code, signal) => {
      finish({
        exitCode: code,
        signal,
        timedOut,
        cancelled,
        stdout: stdout.value(),
        stderr: stderr.value(),
        durationMs: now() - startedAt,
        spawnError: null,
      });
    });
  });
}
