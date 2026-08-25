/**
 * `livetest init` — cria um `livetest.config.json` comentado na raiz.
 * @packageDocumentation
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Command, CommandContext } from '../context.js';
import { EXIT } from '../context.js';

/** Conteudo do arquivo gerado, com comentarios explicando cada bloco. */
export const TEMPLATE = `{
  // Globs observados. Arquivos fora daqui nunca disparam testes.
  "watch": ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py"],

  // Somados aos ignores padrao (node_modules, dist, __pycache__, ...) e ao .gitignore.
  "ignore": [],

  // Quao fundo no grafo de importadores a execucao se propaga:
  //   "self"       -> so o arquivo alterado
  //   "direct"     -> o arquivo + quem o importa diretamente
  //   "transitive" -> o arquivo + toda a cadeia de importadores
  //   <numero>     -> profundidade exata
  "dependencyDepth": {
    "default": "direct",
    "overrides": {
      // "src/components/Login.tsx": "transitive"
    }
  },

  // Agrupamento de saves consecutivos:
  //   idleMs           -> espera de silencio antes de disparar
  //   maxBatchWindowMs -> teto desde o primeiro save do lote
  "debounce": {
    "mode": "both",
    "idleMs": 400,
    "maxBatchWindowMs": 3000
  },

  // Um runner por linguagem/framework. Remova o que nao usar.
  "runners": {
    "js": {
      "adapter": "vitest",
      "match": ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]
    },
    "python": {
      "adapter": "pytest",
      "match": ["**/*.py"]
    }
  },

  // Canais de saida. O log NDJSON e o status.json servem a agentes de IA.
  "output": {
    "logFile": ".livetest/run.log",
    "statusFile": ".livetest/status.json",
    "stdout": true,
    "format": "pretty"
  },

  // Canal de eventos consumido pela extensao do VSCode.
  "server": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 0
  },

  "concurrency": 2
}
`;

/** Implementacao de `livetest init`. */
export const initCommand: Command = {
  name: 'init',
  summary: 'Cria um livetest.config.json comentado na raiz do projeto',
  usage: 'livetest init [opcoes]',
  flags: {
    force: { type: 'boolean', alias: 'f', description: 'Sobrescreve um arquivo existente' },
    print: { type: 'boolean', description: 'Imprime o conteudo em vez de gravar' },
  },

  async run(context: CommandContext): Promise<number> {
    if (context.flags['print'] === true) {
      context.output.out(TEMPLATE.trimEnd());
      return EXIT.ok;
    }

    const target = path.join(context.cwd, 'livetest.config.json');
    if (fs.existsSync(target) && context.flags['force'] !== true) {
      context.output.err(`${target} ja existe. Use --force para sobrescrever.`);
      return EXIT.usage;
    }

    fs.writeFileSync(target, TEMPLATE, 'utf8');
    context.output.out(`Criado ${target}`);
    context.output.out('Rode `livetest start` para comecar a observar o projeto.');
    return EXIT.ok;
  },
};
