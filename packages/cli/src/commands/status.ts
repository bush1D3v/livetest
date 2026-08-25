/**
 * `livetest status` — mostra o estado atual do daemon.
 *
 * Tenta primeiro o canal de eventos (dado sempre atual). Se nao houver daemon
 * rodando, cai para `.livetest/status.json`, que sobrevive ao encerramento e
 * responde "como estava o projeto na ultima execucao".
 *
 * @packageDocumentation
 */

import fs from 'node:fs';

import {
  connectToDaemon,
  normalizePath,
  readDiscoveryFile,
  type DaemonSnapshot,
} from '@livetest/core';

import type { Command, CommandContext, OutputChannel } from '../context.js';
import { EXIT, loadConfigForCommand } from '../context.js';

/** Le o snapshot do daemon vivo, ou `null` se nao houver um. */
async function fetchLiveSnapshot(
  root: string,
  discoveryFile: string,
): Promise<DaemonSnapshot | null> {
  if (readDiscoveryFile(discoveryFile, root).status !== 'running') return null;

  return new Promise<DaemonSnapshot | null>((resolve) => {
    let settled = false;
    const finish = (value: DaemonSnapshot | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    connectToDaemon({
      root,
      discoveryFile,
      timeoutMs: 3000,
      onEvent: (event) => {
        // O primeiro evento de toda conexao e o snapshot completo.
        if (event.type === 'snapshot') finish(event.state);
      },
      onClose: () => finish(null),
    })
      .then((connection) => {
        setTimeout(() => {
          connection.close();
          finish(null);
        }, 3000).unref?.();
      })
      .catch(() => finish(null));
  });
}

/** Le o snapshot persistido em disco. */
function readSnapshotFile(file: string | null, root: string): DaemonSnapshot | null {
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(normalizePath(file, root), 'utf8')) as DaemonSnapshot;
  } catch {
    return null;
  }
}

/** Imprime o snapshot em formato legivel. */
function printSnapshot(snapshot: DaemonSnapshot, source: string, output: OutputChannel): void {
  const { out } = output;
  out(`fonte:     ${source}`);
  out(`raiz:      ${snapshot.root}`);
  out(`pid:       ${snapshot.pid}`);
  out(`rodando:   ${snapshot.running ? 'sim' : 'nao'}`);
  out(
    `totais:    ${snapshot.totals.batches} lote(s), ${snapshot.totals.runs} execucao(oes), ` +
      `${snapshot.totals.failedRuns} com falha`,
  );

  const batch = snapshot.lastBatch;
  if (batch) {
    out('');
    out(`ultimo lote: ${batch.batchId} — ${batch.status} em ${Math.round(batch.durationMs)}ms`);
    out(
      `  testes: ${batch.counts.total} (${batch.counts.passed} passou, ` +
        `${batch.counts.failed} falhou, ${batch.counts.skipped} pulou)`,
    );
    for (const run of batch.runs) {
      for (const testCase of run.cases) {
        if (testCase.status === 'failed') out(`  x ${testCase.fullName}`);
      }
    }
  }

  const interesting = snapshot.files.filter((file) => file.status !== 'idle');
  if (interesting.length > 0) {
    out('');
    out('arquivos com estado:');
    for (const file of interesting) out(`  ${file.status.padEnd(8)} ${file.relativePath}`);
  }
}

/** Implementacao de `livetest status`. */
export const statusCommand: Command = {
  name: 'status',
  summary: 'Mostra o estado do daemon e o resultado do ultimo lote',
  usage: 'livetest status [opcoes]',
  flags: { json: { type: 'boolean', description: 'Imprime o snapshot como JSON' } },

  async run(context: CommandContext): Promise<number> {
    const { config } = await loadConfigForCommand(context);

    const live = await fetchLiveSnapshot(config.root, config.server.discoveryFile);
    const snapshot = live ?? readSnapshotFile(config.output.statusFile, config.root);
    const source = live ? 'daemon em execucao' : 'arquivo status.json';

    if (!snapshot) {
      context.output.err('Nenhum daemon rodando e nenhum status.json encontrado.');
      context.output.err('Rode `livetest start` na raiz do projeto.');
      return EXIT.daemon;
    }

    if (context.flags['json'] === true) {
      context.output.out(JSON.stringify(snapshot, null, 2));
      return EXIT.ok;
    }

    printSnapshot(snapshot, source, context.output);
    return snapshot.lastBatch?.status === 'failed' ? EXIT.testsFailed : EXIT.ok;
  },
};
