# `@livetest/cli`

Interface de linha de comando do [Live Test Runner](https://github.com/bush1D3v/livetest/blob/main/README.md).

```bash
npm install --save-dev @livetest/cli
npx livetest init
npx livetest start
```

## Comandos

### `livetest start`

Sobe o daemon em primeiro plano: observa o projeto, roda os testes afetados a cada
save, escreve `run.log` e `status.json` e abre o canal de eventos para a extensão do
VSCode. Encerre com `Ctrl+C` — o arquivo de descoberta é removido na saída.

```bash
livetest start
livetest start --depth transitive --concurrency 4
livetest start --json --quiet     # eventos NDJSON no stdout, sem relatório humano
livetest start --no-server        # sem canal de eventos
livetest start --once             # roda tudo uma vez e encerra
```

Para um agente de IA, é este o processo a manter em background.

### `livetest run [arquivos...]`

Execução única. Sem argumentos, roda os testes de tudo que está observado.

```bash
livetest run src/login.ts
livetest run src/a.ts src/b.ts --depth self
livetest run --dry-run            # mostra o plano sem executar
```

Não publica arquivo de descoberta: não é um daemon e não deve ser encontrado como um.

### `livetest why <arquivo>`

Explica o que rodaria e por quê, **sem executar nada**. O comando para quando a
seleção de testes surpreende.

```
$ livetest why src/login.ts
arquivo:       src/login.ts
runner:        js
profundidade:  transitive — arquivo + cadeia completa de importadores  [override: src/login.ts]

arquivos impactados (8):
  [0] src/login.ts
  [1] src/header.ts
  [2] src/layout.ts via src/header.ts

testes que rodariam (4):
  runner js:
    src/header.test.ts
      rodou porque src/header.ts importa src/login.ts (1 nivel)
```

Também mostra os imports que o grafo não conseguiu resolver — o aviso de que a
propagação pode estar incompleta naquele arquivo.

### `livetest status [--json]`

Estado do daemon e resultado do último lote. Tenta primeiro o canal de eventos (dado
sempre atual) e cai para `.livetest/status.json`, que sobrevive ao encerramento.

### `livetest watch`

Acompanha, em um segundo terminal, um daemon já em execução. Quando o daemon foi
iniciado em background por um agente, é assim que uma pessoa vê o mesmo fluxo.

### `livetest stop [--force] [--timeout <ms>]`

Encerra o daemon e **espera de fato** que ele saia antes de remover o registro de
descoberta — no Windows o `SIGTERM` mata o processo sem executar os handlers, então a
limpeza precisa acontecer aqui. Detecta e remove registro órfão de um daemon que morreu
sem limpar. `--timeout` ajusta a espera (padrão 4000 ms).

### `livetest init [--force] [--print]`

Cria `livetest.config.json` comentado na raiz.

### `livetest doctor [--json]`

Verifica, em ordem, tudo que pode fazer o daemon "não rodar nada" sem mensagem óbvia:

```
[ok  ] configuracao          /proj/livetest.config.json
[ok  ] node                  v22.14.0
[ok  ] arquivos observados   214 arquivo(s) casando com "watch"
[aviso] cobertura de testes  38 arquivo(s) sem teste, ex.: src/types.ts, src/const.ts
[ok  ] runner "js"           vitest/2.1.9
[ERRO] runner "python"       pytest indisponivel — saiu com codigo 1: No module named pytest
```

## Opções globais

| Flag | Significado |
|---|---|
| `-c, --config <caminho>` | arquivo de configuração explícito |
| `--root <caminho>` | raiz do projeto |
| `--log-level <nível>` | `debug`, `info`, `warn`, `error`, `silent` |
| `-h, --help` | ajuda do comando |

## Sobrescritas de configuração

Aceitas por `start`, `run` e `why`; têm prioridade sobre o arquivo.

| Flag | Sobrescreve |
|---|---|
| `-d, --depth <nível>` | `dependencyDepth.default` (`self`, `direct`, `transitive` ou número) |
| `--dry-run` | `dryRun` |
| `--concurrency <n>` | `concurrency` |
| `--idle-ms <ms>` | `debounce.idleMs` |
| `--max-window-ms <ms>` | `debounce.maxBatchWindowMs` |
| `--json` | `output.format: "ndjson"` |
| `-q, --quiet` | `output.stdout: false` |
| `--no-color` | `output.color: false` |

## Códigos de saída

Estáveis, seguros para usar em scripts e CI:

| Código | Significado |
|---|---|
| `0` | sucesso |
| `1` | testes falharam |
| `2` | erro de uso — comando ou flag inválida |
| `3` | configuração inválida |
| `4` | daemon não encontrado ou inacessível |
| `70` | erro inesperado |

```bash
npx livetest run src/login.ts && npm run build
```

## API programática

A CLI é embutível — útil em um script de build ou plugin de editor, sem criar processo:

```ts
import { runCli } from '@livetest/cli';

const exitCode = await runCli({
  argv: ['run', 'src/login.ts'],
  cwd: '/proj',
  output: {
    out: (line) => meuLog.info(line),
    err: (line) => meuLog.error(line),
  },
});
```

`runCli` **não chama `process.exit`**: devolve o código e deixa a decisão com quem
chamou. É o que torna a CLI inteira testável sem subprocesso.
