# Configuração

O Live Test Runner procura, subindo a partir do diretório atual, o primeiro arquivo
com um destes nomes:

1. `livetest.config.json`
2. `livetest.config.mjs`
3. `livetest.config.js`
4. `livetest.config.cjs`
5. `.livetestrc.json`

O diretório do arquivo encontrado vira a **raiz do projeto** — todos os globs e
caminhos relativos são resolvidos a partir dela. Sem nenhum arquivo, os valores padrão
são usados e a raiz é o diretório atual.

Arquivos `.json` aceitam comentários `//` e `/* */`, que são removidos antes do parse.
Módulos `.js`/`.mjs`/`.cjs` devem exportar a configuração como `default`.

Gere um arquivo comentado com `npx livetest init`.

## Exemplo completo

```jsonc
{
  "$schema": "./node_modules/@livetest/core/livetest.config.schema.json",

  "watch": ["src/**/*.ts", "src/**/*.tsx", "app/**/*.py"],
  "ignore": ["**/generated/**"],
  "useGitignore": true,

  "dependencyDepth": {
    "default": "direct",
    "overrides": {
      "src/util/**": "self",
      "src/components/Login.tsx": "transitive"
    }
  },

  "debounce": { "mode": "both", "idleMs": 400, "maxBatchWindowMs": 3000 },

  "runners": {
    "js": { "adapter": "vitest", "match": ["src/**/*.{ts,tsx}"] },
    "python": { "adapter": "pytest", "match": ["app/**/*.py"] }
  },

  "output": {
    "logFile": ".livetest/run.log",
    "statusFile": ".livetest/status.json",
    "stdout": true,
    "format": "pretty",
    "color": "auto",
    "logTailLines": 40
  },

  "server": { "enabled": true, "host": "127.0.0.1", "port": 0 },

  "concurrency": 2,
  "pythonPath": "python3",
  "logLevel": "info"
}
```

## Referência

### `watch: string[]`

Globs dos arquivos observados. Um arquivo fora desta lista nunca dispara nada.

*Padrão:* `["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs", "**/*.py"]`

### `ignore: string[]`

Globs **somados** aos ignores padrão (`node_modules`, `dist`, `build`, `coverage`,
`__pycache__`, `.venv`, `.livetest`, entre outros) e ao `.gitignore`. Aplicados também
a diretórios, o que poda a varredura antes de descer neles.

### `useGitignore: boolean`

Lê o `.gitignore` da raiz e converte suas regras em globs de exclusão.
Negações (`!padrão`) **não** são suportadas e geram aviso.

*Padrão:* `true`

### `dependencyDepth`

Quão fundo no grafo **reverso** de dependências a execução se propaga.

```ts
{ default: "self" | "direct" | "transitive" | number,
  overrides: Record<glob, "self" | "direct" | "transitive" | number> }
```

| Valor | Saltos | Significado |
|---|---|---|
| `"self"` | 0 | apenas os testes do arquivo alterado |
| `"direct"` | 1 | o arquivo + quem o importa diretamente |
| `"transitive"` | ∞ | o arquivo + toda a cadeia de importadores |
| `n` | n | profundidade numérica exata |

Os `overrides` são avaliados **na ordem de declaração e o último que casar vence**,
o que permite escrever uma regra ampla seguida de exceções:

```jsonc
"overrides": {
  "src/**": "self",                        // regra geral
  "src/components/Login.tsx": "transitive" // exceção
}
```

*Padrão:* `{ "default": "direct", "overrides": {} }`

### `debounce`

Agrupamento de saves consecutivos.

| Campo | Tipo | Padrão | Significado |
|---|---|---|---|
| `mode` | `"idle" \| "batch" \| "both"` | `"both"` | estratégia |
| `idleMs` | `number` | `400` | silêncio necessário antes de disparar |
| `maxBatchWindowMs` | `number` | `3000` | teto desde o primeiro save do lote |

- **`idle`** — dispara após `idleMs` sem novos saves. Sozinho, corre o risco de nunca
  disparar durante uma sequência longa de edições.
- **`batch`** — dispara `maxBatchWindowMs` após o *primeiro* save do lote.
- **`both`** (recomendado) — o que ocorrer primeiro. Resolve os dois problemas.

### `runners`

Um objeto por linguagem/framework. A chave é livre (`"js"`, `"python"`, `"go"`) e
aparece nos relatórios.

| Campo | Tipo | Significado |
|---|---|---|
| `adapter` | `"vitest" \| "jest" \| "pytest" \| "command"` | como montar o comando e ler a saída |
| `match` | `string[]` | globs dos arquivos-fonte atendidos |
| `command` | `string` | executável; obrigatório para `adapter: "command"` |
| `args` | `string[]` | argumentos fixos, antes dos arquivos de teste |
| `env` | `Record<string,string>` | variáveis extras do processo |
| `timeoutMs` | `number` | timeout de uma execução (padrão `120000`) |
| `cwd` | `string` | diretório de trabalho, relativo à raiz |
| `graph` | `"js-ts" \| "python"` | adapter de grafo usado por estes arquivos |
| `testPatterns` | `string[]` | templates de caminho do arquivo de teste |
| `testMatch` | `string[]` | globs que marcam um arquivo como sendo, ele próprio, um teste |
| `testExtensions` | `string[]` | extensões testadas ao expandir `{ext}` |

> Declarar `runners` **restringe** aos runners declarados. Para `"js"` e `"python"`,
> o que você escrever é mesclado sobre a base embutida, então
> `{"js": {"adapter": "jest"}}` mantém `match`, `testPatterns` e o resto.

#### Templates de arquivo de teste

`testPatterns` diz onde procurar o teste de um arquivo-fonte. Tokens:

| Token | Valor para `src/util/date.ts` (raiz `/proj`) |
|---|---|
| `{dir}` | `/proj/src/util` |
| `{relDir}` | `src/util` |
| `{relDirTail}` | `util` (`{relDir}` sem o primeiro segmento) |
| `{name}` | `date` |
| `{ext}` | expandido sobre `testExtensions` |

Templates que **não** começam com `{dir}` são resolvidos a partir da raiz, o que cobre
o layout `tests/` no topo do repositório. Barras duplicadas por tokens vazios são
colapsadas.

Padrão para JS/TS:

```
{dir}/{name}.test.{ext}          {dir}/__tests__/{name}.test.{ext}
{dir}/{name}.spec.{ext}          {dir}/__tests__/{name}.spec.{ext}
test/{relDir}/{name}.test.{ext}  test/{relDirTail}/{name}.test.{ext}
tests/{relDir}/{name}.test.{ext} tests/{relDirTail}/{name}.test.{ext}
```

Padrão para Python:

```
{dir}/test_{name}.py         {dir}/{name}_test.py       {dir}/tests/test_{name}.py
tests/{relDir}/test_{name}.py  tests/{relDirTail}/test_{name}.py  tests/test_{name}.py
```

Para conferir o que está sendo procurado num caso concreto:
`livetest why <arquivo>`.

#### Adapter `command`

Porta de entrada para qualquer linguagem sem adapter dedicado. O comando recebe os
arquivos de teste como argumentos finais e o resultado vem do **código de saída**
(sem casos individuais).

```jsonc
"runners": {
  "go": {
    "adapter": "command",
    "command": "go",
    "args": ["test"],
    "match": ["**/*.go"],
    "testMatch": ["**/*_test.go"],
    "testPatterns": ["{dir}/{name}_test.go"],
    "testExtensions": ["go"]
  }
}
```

### `output`

| Campo | Tipo | Padrão | Significado |
|---|---|---|---|
| `logFile` | `string \| null` | `".livetest/run.log"` | log NDJSON append-only; rotaciona em 5 MB |
| `statusFile` | `string \| null` | `".livetest/status.json"` | snapshot do estado, escrito atomicamente |
| `stdout` | `boolean` | `true` | emitir relatório no stdout |
| `format` | `"pretty" \| "ndjson"` | `"pretty"` | formato do stdout |
| `color` | `boolean \| "auto"` | `"auto"` | `"auto"` respeita TTY, `NO_COLOR` e `FORCE_COLOR` |
| `logTailLines` | `number` | `40` | linhas de stdout/stderr guardadas por execução |

### `server`

Canal de eventos consumido pela extensão do VSCode.

| Campo | Tipo | Padrão | Significado |
|---|---|---|---|
| `enabled` | `boolean` | `true` | liga o canal |
| `host` | `string` | `"127.0.0.1"` | mantenha em loopback |
| `port` | `number` | `0` | `0` deixa o SO escolher — evita colisão entre projetos |
| `discoveryFile` | `string` | `".livetest/daemon.json"` | onde o daemon publica pid/host/porta |

Se a porta não puder ser aberta, o daemon **não aborta**: emite um aviso e segue com
stdout e log de arquivo. Ver [docs/protocol.md](protocol.md).

### Demais campos

| Campo | Tipo | Padrão | Significado |
|---|---|---|---|
| `root` | `string` | dir. do arquivo de config | raiz do projeto |
| `concurrency` | `number` | `2` | execuções de teste simultâneas |
| `dryRun` | `boolean` | `false` | monta e loga o plano sem executar nada |
| `pythonPath` | `string` | `python3` (`python` no Windows) | interpretador usado pelo grafo e pelo pytest |
| `logLevel` | `"debug" \| "info" \| "warn" \| "error" \| "silent"` | `"info"` | logs internos, sempre em stderr |

## Sobrescritas pela linha de comando

Flags têm prioridade sobre o arquivo:

```bash
livetest start --depth transitive --concurrency 4 --idle-ms 150
livetest run src/a.ts --dry-run
livetest start --json --quiet          # eventos NDJSON, sem relatório humano
livetest start --no-server             # sem canal de eventos
```

## Validação

A configuração é validada no carregamento, com o caminho exato do campo inválido:

```
$ livetest start
Configuracao invalida em /proj/livetest.config.json
  - runners.js.timeoutMs deve ser um numero maior que 0.
  - debounce.idleMs nao pode ser maior que debounce.maxBatchWindowMs.
```

Campos desconhecidos geram aviso, não erro — configurações de versões futuras não
quebram versões antigas. `livetest doctor` roda a mesma validação e ainda verifica se
os binários dos runners existem.
