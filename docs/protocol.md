# Protocolo de eventos

O daemon publica a mesma sequência de eventos em três canais. Todos veem os mesmos
objetos, na mesma ordem, com o mesmo número de sequência — porque os três são apenas
assinantes de um único barramento interno.

| Canal | Formato | Consumidor típico |
|---|---|---|
| stdout | texto formatado (`pretty`) ou NDJSON | agente de IA, pessoa no terminal |
| `output.logFile` | NDJSON append-only | histórico, análise posterior |
| socket TCP | NDJSON | extensão do VSCode, dashboards |

## Decisões de projeto

A seção 9 do PRD deixou o transporte em aberto. As escolhas:

**TCP em loopback, não named pipe nem socket Unix.** Named pipes do Windows e sockets
Unix exigiriam dois caminhos de código e duas formas de descoberta. TCP em `127.0.0.1`
é idêntico nas três plataformas.

**Porta `0` por padrão.** O SO escolhe uma porta livre e o número real vai para o
arquivo de descoberta. Dois projetos abertos ao mesmo tempo não colidem.

**NDJSON, não um protocolo binário.** Um evento por linha é depurável com `nc` ou
`tail -f`, e qualquer linguagem consegue consumir sem biblioteca.

**Snapshot na conexão.** O primeiro evento que um cliente recebe é sempre um
`snapshot` com o estado completo. A UI renderiza na hora, sem esperar o próximo lote.

## Descoberta

O daemon publica `.livetest/daemon.json` ao subir e **remove no encerramento limpo**:

```json
{
  "pid": 12345,
  "host": "127.0.0.1",
  "port": 51734,
  "root": "/home/ana/projeto",
  "version": "0.1.0",
  "protocolVersion": 1,
  "startedAt": 1730000000000
}
```

Um arquivo pode ficar órfão se o daemon morrer abruptamente. Por isso a leitura sempre
confere se o processo ainda existe, classificando em quatro estados:

| Estado | Significado |
|---|---|
| `running` | arquivo existe e o pid está vivo |
| `stale` | arquivo existe mas o pid morreu — registro órfão |
| `absent` | não há arquivo |
| `invalid` | JSON quebrado ou campos faltando |

```ts
import { readDiscoveryFile } from '@livetest/core/client';

const result = readDiscoveryFile('.livetest/daemon.json', root);
if (result.status === 'running') connect(result.info.host, result.info.port);
```

## Enquadramento

Cada evento é um objeto JSON em uma linha, terminado por `\n`. Um evento grande pode
chegar dividido em vários pacotes TCP: acumule até encontrar `\n`. O core já oferece o
divisor pronto (`createLineSplitter`), e `connectToDaemon` cuida disso por você.

## Campos comuns

Todo evento tem:

| Campo | Tipo | Significado |
|---|---|---|
| `type` | `string` | discriminante da união |
| `seq` | `number` | sequência monotônica, começando em 1 |
| `timestamp` | `number` | epoch em milissegundos |

> O evento `snapshot` enviado na conexão usa `seq: 0`: ele não faz parte da sequência
> de eventos ao vivo, é o estado que a precede.

**Consumidores devem ignorar `type` desconhecido.** O protocolo é aditivo: novos
eventos e novos campos aparecem sem incrementar `protocolVersion`, que só muda em
alteração incompatível.

## Eventos

### `daemon.started` / `daemon.stopped`

```json
{ "type": "daemon.started", "seq": 1, "timestamp": 1730000000000,
  "pid": 12345, "root": "/proj", "version": "0.1.0", "protocolVersion": 1,
  "server": { "host": "127.0.0.1", "port": 51734 },
  "configPath": "/proj/livetest.config.json", "indexedFiles": 214 }
```

`server` é `null` quando o canal está desabilitado ou não pôde ser aberto.

### `watch.change`

Um arquivo observado mudou. `kind` é `"add"`, `"change"` ou `"unlink"`.

### `batch.started`

O debounce fechou o lote e o plano foi calculado. **É aqui que mora a transparência**:
`plan[].reasons` explica, por arquivo de teste, por que ele entrou.

```json
{ "type": "batch.started", "seq": 8, "timestamp": 1730000001000,
  "batchId": "batch-3",
  "changedFiles": ["/proj/src/login.ts"],
  "trigger": "idle",
  "plan": [{
    "runnerKey": "js", "adapterId": "vitest",
    "testFiles": ["/proj/src/header.test.ts"],
    "reasons": {
      "/proj/src/header.test.ts": [{
        "kind": "importer",
        "changedFile": "/proj/src/login.ts",
        "sourceFile": "/proj/src/header.ts",
        "depth": 1,
        "chain": ["/proj/src/login.ts", "/proj/src/header.ts"]
      }]
    }
  }],
  "unmatched": [] }
```

`trigger` é `"idle"`, `"maxWindow"` ou `"manual"`.
`unmatched` lista arquivos salvos sem teste correspondente, com a explicação.

Em `SelectionReason`, `kind` é `"changed"` (o próprio arquivo salvo), `"importer"`
(alcançado pelo grafo) ou `"manual"`. `chain` é o caminho completo de importação, do
arquivo salvo até o arquivo coberto pelo teste.

### `run.started` / `run.finished`

`run.finished` carrega o `TestRunResult` completo: comando executado, contagens, casos
individuais com mensagens de falha, `stdoutTail`/`stderrTail` e os motivos de seleção.

`status` de uma execução: `passed`, `failed`, `errored` (não pôde rodar — binário
ausente, timeout, config inválida), `skipped` (nada a rodar ou `dryRun`) ou
`cancelled` (um lote novo tornou este obsoleto).

### `batch.finished`

Consolida o lote. O status agrega os das execuções, nesta precedência:

```
errored > cancelled > failed > passed > skipped
```

Um erro de infraestrutura aparece antes de uma falha de teste porque exige uma ação
diferente de quem lê.

### `error`

Degradação segura — o daemon **continua rodando**.

```json
{ "type": "error", "seq": 4, "timestamp": 1730000000500,
  "scope": "graph:python",
  "message": "interpretador Python indisponivel (\"python3\")",
  "detail": "spawn python3 ENOENT",
  "degradedTo": "o grafo Python passa a usar analise por expressao regular" }
```

`degradedTo` diz o que passou a valer no lugar. É o requisito de robustez da seção 8
do PRD tornado observável.

### `snapshot`

Só no socket, como primeiro evento de cada conexão. Contém `DaemonSnapshot`: metadados
do daemon, `running`, o `lastBatch` completo, o estado por arquivo (`files`) e
contadores acumulados (`totals`).

## Consumindo o canal

```ts
import { connectToDaemon } from '@livetest/core/client';

const connection = await connectToDaemon({
  root: '/proj',
  onEvent: (event) => {
    if (event.type === 'snapshot') renderizarTudo(event.state);
    if (event.type === 'batch.finished') atualizar(event.result);
  },
  onClose: (motivo) => reconectarDepois(motivo),
});
```

`connectToDaemon` lança `LiveTestError` com código `DAEMON_NOT_RUNNING` (não há daemon)
ou `CONNECTION_FAILED` (o socket não abriu). Distinguir os dois importa: o primeiro
significa "ofereça o botão de iniciar", o segundo, "tente de novo".

Sem TypeScript, o canal é só um socket de linhas:

```bash
PORT=$(jq -r .port .livetest/daemon.json)
nc 127.0.0.1 "$PORT" | jq -c 'select(.type == "batch.finished") | .result.status'
```
