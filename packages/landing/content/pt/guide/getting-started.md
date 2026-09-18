---
title: Primeiros passos
description: Instale o livetest como devDependency, confira o ambiente com o doctor e deixe o daemon observando.
---

# Primeiros passos

## Instalação

```bash
$ npm install --save-dev @livetest/cli
```

O pacote está publicado no npm como
[`@livetest/cli`](https://www.npmjs.com/package/@livetest/cli). Ele traz o
[`@livetest/core`](https://www.npmjs.com/package/@livetest/core) junto, então não é preciso
instalar os dois.

## Crie o arquivo de configuração

```bash
$ npx livetest init
```

Isso escreve um `livetest.config.json` comentado na raiz. O passo é **opcional**: sem
configuração nenhuma, o daemon já funciona em projetos JS/TS ou Python com layout
convencional. O arquivo existe para quando você quer controle fino, que é o assunto de
[Configuração](/reference/config).

## Confira o ambiente

```bash
$ npx livetest doctor
```

O `doctor` verifica, em ordem, tudo que pode fazer o daemon "não rodar nada" sem mensagem
óbvia:

```output
[ok  ] configuracao          /proj/livetest.config.json
[ok  ] node                  v22.14.0
[ok  ] arquivos observados   214 arquivo(s) casando com "watch"
[aviso] cobertura de testes  38 arquivo(s) sem teste, ex.: src/types.ts, src/const.ts
[ok  ] runner "js"           vitest/2.1.9
[ERRO] runner "python"       pytest indisponivel, saiu com codigo 1: No module named pytest
```

Rode antes de perder tempo depurando silêncio.

## Deixe observando

```bash
$ npx livetest start
```

Daqui em diante, cada arquivo que você salvar dispara os testes relevantes. Encerre com
`Ctrl+C`: o arquivo de descoberta é removido na saída.

Para um agente de IA, jogue em background e leia a linha `LIVETEST` ao fim de cada lote:

```bash
npx livetest start > .livetest/daemon.out 2>&1 &
```

O guia completo desse fluxo está em [Agentes de IA](/guide/ai-agents).

## Veja o que rodaria, sem rodar

```bash
$ npx livetest why src/login.ts
```

```output
arquivo:       src/login.ts
runner:        js
profundidade:  transitive, arquivo + cadeia completa de importadores  [override: src/login.ts]

arquivos impactados (8):
  [0] src/login.ts
  [1] src/header.ts
  [2] src/layout.ts via src/header.ts

testes que rodariam (4):
  runner js:
    src/header.test.ts
      rodou porque src/header.ts importa src/login.ts (1 nivel)
```

Útil em dois momentos: para dimensionar o impacto de uma mudança antes de fazê-la, e para
entender por que um teste que você não esperava rodou, ou não rodou.

## Execução pontual, sem daemon

O `livetest run` faz uma execução única e devolve **exit code 1** quando algum teste falha,
o que encadeia direto em um `&&` de shell ou em um hook de pre-commit:

```bash
npx livetest run src/login.ts && echo "seguro para continuar"
```

## Projetos de exemplo

O repositório traz dois projetos prontos para experimentar em `examples/`: `demo-js`
(Vitest) e `demo-python` (pytest). Os dois montam a cadeia `login → header/footer → layout`
que exercita a propagação transitiva.

::: tip Próximo passo
[Profundidade de propagação](/guide/depth) é a única configuração que vale entender antes
de qualquer outra.
:::
