---
title: Como funciona
description: O caminho de um arquivo salvo até um resultado de teste, com um módulo isolado por etapa.
---

# Como funciona

Cada etapa é um módulo isolado e testado. O grafo de dependência e o test runner são
**adapters plugáveis**: adicionar Go ou Rust não exige tocar no core.

```output
┌──────────────────────────── projeto do usuário ───────────────────────┐
│                                                                       │
│   arquivo salvo                                                       │
│        │                                                              │
│        ▼                                                              │
│   ┌─────────┐   ┌──────────┐   ┌────────────┐   ┌────────┐   ┌──────┐ │
│   │ Watcher │──▶│ Debounce │──▶│ Grafo dep. │──▶│Planner │──▶│Runner│ │
│   └─────────┘   └──────────┘   └────────────┘   └────────┘   └──┬───┘ │
│                  agrupa saves    quem importa    o quê rodar     │    │
│                  consecutivos    este arquivo?   e por quê       │    │
│                                                                  ▼    │
│                                                          ┌──────────┐ │
│                                                          │ Agregador│ │
│                                                          └─┬──┬──┬──┘ │
│                     ┌──────────────────────────────────────┘  │  │    │
│                     ▼                    ▼                    ▼       │
│              ┌───────────┐       ┌────────────┐      ┌─────────────┐  │
│              │  stdout   │       │  run.log   │      │ socket TCP  │  │
│              │  (agente) │       │status.json │      │ (extensão)  │  │
│              └───────────┘       └────────────┘      └─────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

## Watcher

Observa o disco através do chokidar e aplica os filtros de glob. Diretórios são podados
**antes** de a varredura recursiva descer neles, então `node_modules` nunca custa uma
caminhada.

Só arquivos que casam com `watch` disparam alguma coisa. Todo o resto é invisível para o
daemon.

## Debounce

Agrupa saves consecutivos em um único lote. São três modos, detalhados em
[`debounce`](/reference/config#debounce):

- **`idle`** dispara após um período de silêncio. Sozinho, corre o risco de nunca disparar
  durante uma sequência longa de edições.
- **`batch`** dispara uma janela fixa depois do *primeiro* save do lote.
- **`both`**, o padrão recomendado, dispara no que ocorrer primeiro, o que resolve os dois
  problemas.

## Grafo de dependências

Responde a uma pergunta: *quem importa este arquivo?* O grafo é montado uma vez, indexado,
e atualizado conforme os arquivos mudam. A propagação reversa é uma busca em largura sobre
as arestas de import, segura com ciclos e limitada pela profundidade configurada.

JS/TS passa pela API do compilador TypeScript, então `paths`, `baseUrl`, `index.*` e o
mapeamento ESM `./x.js` para `./x.ts` resolvem do jeito que o compilador resolve. Python
passa pelo módulo `ast` nativo, caindo para expressões regulares quando não há
interpretador disponível.

Escrever um adapter para outra linguagem é o assunto de
[Escrevendo um adapter](/guide/adapters).

## Planner

Decide o que rodar **e registra por quê**. Cada arquivo-fonte alcançado é mapeado aos seus
arquivos de teste por convenção de nome, e todo teste selecionado carrega a cadeia de
importação que o colocou ali.

É aqui que as duas etapas ficam separadas de propósito. A propagação roda sobre arestas de
*import*; o mapeamento de fonte para teste acontece depois. Colapsar as duas daria
respostas erradas: `self` não rodaria teste nenhum, porque o teste está a um salto do
fonte.

Arquivos sem teste correspondente voltam em `unmatched`, junto com os caminhos procurados.

## Runners

O core executa o processo, o que compra cancelamento, timeout, captura limitada de saída e
limpeza de arquivos temporários para todos os adapters de uma vez. O adapter só monta a
linha de comando e interpreta a saída.

Vêm embutidos: Vitest, Jest (relatório JSON), pytest (JUnit XML), e um adapter `command`
genérico que julga pelo código de saída.

## Agregador

Consolida o lote e publica a mesma sequência de eventos em três canais, na mesma ordem,
com o mesmo número de sequência, porque os três são apenas assinantes de um único
barramento interno. O formato está descrito em
[Protocolo de eventos](/reference/protocol).

O status do lote agrega o das execuções nesta precedência:

```output
errored > cancelled > failed > passed > skipped
```

Um erro de infraestrutura aparece antes de uma falha de teste porque exige uma ação
diferente de quem lê.
