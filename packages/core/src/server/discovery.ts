/**
 * Descoberta do daemon em execucao.
 *
 * O daemon publica `.livetest/daemon.json` com pid, host e porta. A extensao do
 * VSCode e a CLI leem esse arquivo para saber onde se conectar — e o mecanismo
 * que permite a extensao "tentar se conectar a um daemon ja em execucao" sem
 * subir nenhum processo (secao 4.3 do PRD).
 *
 * O arquivo pode ficar orfao se o daemon morrer sem limpar; por isso a leitura
 * sempre verifica se o processo ainda existe.
 *
 * @packageDocumentation
 */

import fs from 'node:fs';
import path from 'node:path';

import type { DaemonDiscoveryInfo } from '../types/events.js';
import { normalizePath, toNative } from '../util/paths.js';

/** Verifica se um processo esta vivo, sem envia-lo nenhum sinal real. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // O sinal 0 nao afeta o processo: serve so para testar a existencia.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM significa que o processo existe mas pertence a outro usuario.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Grava o arquivo de descoberta. */
export function writeDiscoveryFile(file: string, root: string, info: DaemonDiscoveryInfo): string {
  const target = normalizePath(file, root);
  fs.mkdirSync(path.dirname(toNative(target)), { recursive: true });
  fs.writeFileSync(toNative(target), `${JSON.stringify(info, null, 2)}\n`, 'utf8');
  return target;
}

/** Remove o arquivo de descoberta, ignorando falhas. */
export function removeDiscoveryFile(file: string, root: string): void {
  try {
    fs.rmSync(toNative(normalizePath(file, root)), { force: true });
  } catch {
    /* melhor esforco */
  }
}

/** Resultado da leitura do arquivo de descoberta. */
export type DiscoveryResult =
  | { status: 'running'; info: DaemonDiscoveryInfo; file: string }
  | { status: 'stale'; info: DaemonDiscoveryInfo; file: string }
  | { status: 'absent'; file: string }
  | { status: 'invalid'; file: string; error: string };

/**
 * Le o arquivo de descoberta e classifica o estado do daemon.
 *
 * @example
 * ```ts
 * const result = readDiscoveryFile('.livetest/daemon.json', '/proj');
 * if (result.status === 'running') connect(result.info.host, result.info.port);
 * ```
 */
export function readDiscoveryFile(file: string, root: string): DiscoveryResult {
  const target = normalizePath(file, root);
  let raw: string;
  try {
    raw = fs.readFileSync(toNative(target), 'utf8');
  } catch {
    return { status: 'absent', file: target };
  }

  let info: DaemonDiscoveryInfo;
  try {
    info = JSON.parse(raw) as DaemonDiscoveryInfo;
  } catch (error) {
    return { status: 'invalid', file: target, error: (error as Error).message };
  }

  if (typeof info.pid !== 'number' || typeof info.port !== 'number') {
    return { status: 'invalid', file: target, error: 'campos pid/port ausentes' };
  }

  return isProcessAlive(info.pid)
    ? { status: 'running', info, file: target }
    : { status: 'stale', info, file: target };
}
