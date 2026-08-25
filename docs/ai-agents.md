# Guia para agentes de IA

Este documento é escrito para o agente — Claude Code, Cursor, ou qualquer outro — que
está editando código em um projeto com Live Test Runner instalado.

## O problema que isto resolve para você

Seu ciclo natural é *editar → editar → editar → rodar os testes no fim*. Isso custa
duas coisas: quando o teste enfim roda, várias mudanças já se acumularam e isolar a
que quebrou é caro; e você tende a rodar só os testes do arquivo que tocou, ignorando
quem depende dele.

Com o daemon rodando, cada save dispara os testes do arquivo **e dos importadores**,
e o resultado chega em segundos.

## Início rápido

```bash
npx livetest start > .livetest/daemon.out 2>&1 &
```

Uma vez, no começo da sessão. A partir daí, cada arquivo que você salvar dispara os
testes relevantes automaticamente.

## Lendo o resultado

### Opção 1 — a linha resumo (mais barata)

Toda conclusão de lote termina com uma linha de campos `chave=valor`:

```
LIVETEST batch=batch-7 status=failed files=3 tests=12 passed=10 failed=2 skipped=0 duration=1.4s
```

```bash
grep '^LIVETEST' .livetest/daemon.out | tail -1
```

`status` é `passed`, `failed`, `errored`, `skipped` ou `cancelled`.

### Opção 2 — o snapshot (estado atual)

```bash
npx livetest status
```

```
fonte:     daemon em execucao
raiz:      /proj
rodando:   nao
totais:    7 lote(s), 9 execucao(oes), 2 com falha

ultimo lote: batch-7 — failed em 1421ms
  testes: 12 (10 passou, 2 falhou, 0 pulou)
  x header > sauda o usuario autenticado
  x layout > embrulha o cabecalho
```

`npx livetest status --json` devolve o snapshot completo. O arquivo
`.livetest/status.json` tem o mesmo conteúdo e é escrito atomicamente — pode ser lido
em loop sem risco de pegar um JSON pela metade.

### Opção 3 — o log de eventos (histórico completo)

`.livetest/run.log` é NDJSON, um evento por linha:

```bash
tail -5 .livetest/run.log | jq -c 'select(.type=="batch.finished") | .result.status'
```

Formato em [protocol.md](protocol.md).

## Execução pontual, sem daemon

Se preferir controlar quando testar, `livetest run` faz uma execução única e devolve
**exit code 1** quando algum teste falha:

```bash
npx livetest run src/login.ts && echo "seguro para continuar"
```

Isso encadeia direto em `&&`, o que costuma ser mais confiável do que interpretar
texto.

## Antes de editar: veja o que vai rodar

```bash
npx livetest why src/login.ts
```

```
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

Útil em dois momentos: para dimensionar o impacto de uma mudança antes de fazê-la, e
para entender por que um teste que você não esperava rodou (ou não rodou).

## Interpretando os status

| Status | O que significa | O que fazer |
|---|---|---|
| `passed` | tudo passou | siga |
| `failed` | um teste rodou e reprovou | **conserte o código** |
| `errored` | o runner não pôde rodar | **conserte o ambiente**: binário ausente, timeout, config inválida |
| `skipped` | nada a rodar, ou `dryRun` | provavelmente falta um arquivo de teste |
| `cancelled` | um save novo tornou este lote obsoleto | espere o próximo resultado |

A distinção entre `failed` e `errored` é deliberada e importa para você: uma exige
mudar o código, a outra exige mudar o ambiente.

## Armadilhas

**Um lote cancela o anterior.** Salvar durante uma execução cancela a que está em
andamento. `cancelled` não é falha — é "chegou coisa nova, espere o próximo".

**`skipped` costuma ser um teste faltando.** Quando um arquivo não tem teste
correspondente, o lote traz `unmatched` com os caminhos que foram procurados:

```
sem teste  src/orfao.ts: nenhum arquivo de teste encontrado
           (profundidade "direct" = arquivo + importadores diretos;
            procurados, entre outros: src/orfao.test.ts, src/orfao.spec.ts)
```

Se a intenção era ter teste, crie um em um dos caminhos listados.

**O grafo pode estar incompleto.** Import dinâmico com expressão, injeção de
dependência e reflexão não aparecem no grafo. `livetest why` avisa:

```
imports nao resolvidos (o grafo pode estar incompleto aqui):
  <import dinamico com expressao nao literal>
```

Nesses arquivos, considere `dependencyDepth` maior ou rode a suíte inteira antes de
concluir que está tudo certo.

**O daemon degrada em vez de morrer.** Se o Python sumir ou um adapter falhar, você
recebe um evento `error` com `degradedTo` explicando o que passou a valer. A ferramenta
continua funcionando, com menos precisão — vale ler esses avisos.

## Ajustando a propagação

Se os testes estão rodando demais (lento) ou de menos (perde regressão), ajuste a
profundidade por arquivo em `livetest.config.json`:

```jsonc
{
  "dependencyDepth": {
    "default": "direct",
    "overrides": {
      "src/util/**": "self",         // utilitário estável e muito importado
      "src/core/auth.ts": "transitive" // crítico: qualquer quebra importa
    }
  }
}
```

Ou experimente sem editar arquivo:

```bash
npx livetest run src/login.ts --depth transitive
npx livetest why src/login.ts --depth self
```

## Encerrando

```bash
npx livetest stop
```

Remove `.livetest/daemon.json` e libera a porta. Se o processo morreu sem limpar,
`livetest stop` detecta o registro órfão e remove.
