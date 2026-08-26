# `@livetest/core`

Motor do [Live Test Runner](https://github.com/bush1D3v/livetest/blob/main/README.md): watcher, debounce, grafo de dependências,
execução incremental de testes e os três canais de saída. Agnóstico de linguagem e
independente de CLI e de editor.

```bash
npm install --save-dev @livetest/core
```

## Uso

```ts
import { createEngine, loadConfig } from '@livetest/core';

const { config, warnings } = await loadConfig({ cwd: process.cwd() });
for (const aviso of warnings) console.warn(aviso);

const engine = createEngine({ config });

engine.subscribe((event) => {
  if (event.type === 'batch.finished') {
    console.log(event.result.status, event.result.counts);
  }
});

await engine.start();
// ... o daemon roda até:
await engine.stop('encerrado');
```

## Dois pontos de entrada

| Import | Contém | Quando usar |
|---|---|---|
| `@livetest/core` | tudo, inclusive o motor | você **roda** testes |
| `@livetest/core/client` | conexão, descoberta, tipos, formatação | você só **consome** eventos de um daemon |

O índice principal arrasta o compilador TypeScript (usado pelo grafo JS/TS). Um
consumidor que apenas lê eventos — uma extensão de editor, um dashboard — deve importar
de `/client`: no bundle da extensão do VSCode isso é a diferença entre 9 MB e 24 KB.

```ts
import { connectToDaemon, readDiscoveryFile } from '@livetest/core/client';
```

## Arquitetura

Cada módulo faz uma coisa e é testável isoladamente:

| Módulo | Responsabilidade |
|---|---|
| `config/` | descoberta, validação e normalização da configuração |
| `watch/watcher.ts` | observa o disco (chokidar), aplica os filtros de glob |
| `watch/debouncer.ts` | agrupa saves consecutivos; timers injetáveis |
| `graph/` | grafo de dependências e propagação reversa; adapters JS/TS e Python |
| `testmap/` | mapeia arquivo-fonte → arquivo(s) de teste por templates |
| `planner/` | decide o que rodar **e registra por quê** |
| `runner/` | executa processos; adapters Vitest, Jest, pytest, `command` |
| `state/` | agrega resultados e mantém o snapshot do daemon |
| `report/` | relatório de terminal, log NDJSON, `status.json` |
| `server/` | canal de eventos TCP e descoberta do daemon |
| `events/bus.ts` | barramento único que alimenta os três canais |
| `engine.ts` | orquestra tudo |

Um princípio atravessa o código: **todo caminho que circula pelo core é absoluto e usa
`/` como separador**, inclusive no Windows. A conversão para o formato nativo acontece
só na fronteira com o sistema operacional.

## API principal

### `createEngine(options): LiveTestEngine`

```ts
interface LiveTestEngine {
  start(): Promise<EngineStartResult>;
  stop(reason?: string): Promise<void>;
  runFiles(files: readonly string[]): Promise<BatchResult>;
  flush(): void;
  snapshot(): DaemonSnapshot;
  subscribe(listener: (event: LiveTestEvent) => void): () => void;
  readonly config: ResolvedConfig;
  readonly graph: DependencyGraph;
  readonly resolver: TestFileResolver;
}
```

`graph` e `resolver` ficam expostos para diagnóstico — é o que `livetest why` usa.

Adapters de terceiros entram por aqui:

```ts
createEngine({
  config,
  graphAdapters: { go: (context) => createGoGraphAdapter(context) },
  runnerAdapters: { 'go-test': () => createGoTestAdapter() },
});
```

Ver [docs/adapters.md](https://github.com/bush1D3v/livetest/blob/main/docs/adapters.md).

### `loadConfig(options): Promise<LoadConfigResult>`

Procura o arquivo subindo a partir de `cwd`, valida, mescla os padrões e normaliza.
Lança `LiveTestError` com código `CONFIG_INVALID` listando **todos** os problemas
encontrados, não apenas o primeiro.

```ts
const { config } = await loadConfig({
  cwd: process.cwd(),
  overrides: { dependencyDepth: { default: 'transitive' } }, // flags da CLI
});
```

### Grafo de dependências

```ts
const graph = createDependencyGraph({ adapters: [jsTsAdapter] });
await graph.index(arquivos);

graph.impactedBy('/proj/src/login.ts', 1);
// [ { file: '.../login.ts',  depth: 0, chain: ['.../login.ts'] },
//   { file: '.../header.ts', depth: 1, chain: ['.../login.ts', '.../header.ts'] } ]
```

`chain` é o caminho completo de importação. É dele que sai a frase
*"rodou porque header.ts importa login.ts"*.

`impactedBy` aceita `Infinity` como profundidade e é seguro com ciclos.

### Planejamento

```ts
const plan = planBatch({ config, graph, resolver, changedFiles });

plan.entries[0].reasons['/proj/src/header.test.ts'];
// [{ kind: 'importer', changedFile: '.../login.ts', sourceFile: '.../header.ts',
//    depth: 1, chain: [...] }]

summarizeReason(reason, config.root);
// 'rodou porque src/header.ts importa src/login.ts (1 nivel)'
```

`plan.unmatched` traz os arquivos salvos sem teste, com a explicação de onde se
procurou.

### Consumindo um daemon

```ts
import { connectToDaemon, readDiscoveryFile } from '@livetest/core/client';

const discovery = readDiscoveryFile('.livetest/daemon.json', root);
if (discovery.status === 'running') {
  const conexao = await connectToDaemon({
    root,
    onEvent: (event) => { if (event.type === 'snapshot') render(event.state); },
    onClose: (motivo) => reconectar(motivo),
  });
}
```

Protocolo em [docs/protocol.md](https://github.com/bush1D3v/livetest/blob/main/docs/protocol.md).

## Erros

Tudo que a biblioteca lança deliberadamente é `LiveTestError`, com um `code` estável:

| Código | Situação |
|---|---|
| `CONFIG_INVALID` | validação falhou; `details` lista os problemas |
| `CONFIG_NOT_FOUND` / `CONFIG_LOAD_FAILED` | arquivo ausente ou ilegível |
| `DAEMON_NOT_RUNNING` | não há daemon — ofereça iniciar |
| `DAEMON_ALREADY_RUNNING` | `start()` chamado duas vezes |
| `CONNECTION_FAILED` | o socket não abriu — tente de novo |

`error.format()` devolve mensagem e detalhes prontos para um terminal.

**Falhas de runtime não lançam.** Adapter que quebra, Python ausente, disco cheio: tudo
vira um evento `error` com `degradedTo`, e o daemon continua. É o requisito de robustez
da seção 8 do PRD.

## Testes

```bash
npm test              # 762 testes
npm run test:coverage # 100% de linhas, ramos, funções e instruções
```
