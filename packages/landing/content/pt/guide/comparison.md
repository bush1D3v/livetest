---
title: Comparativo
description: Onde o livetest difere do vitest --watch, do Wallaby.js e do pytest-watch, e onde essas ferramentas também acertam.
---

# Comparativo

Já existe coisa parecida. Nenhuma faz exatamente isto.

| Capacidade | livetest | jest/vitest --watch | Wallaby.js | pytest-watch |
|---|---|---|---|---|
| Propaga pelo grafo de dependências | sim | sim | sim | não |
| Profundidade configurável por arquivo | sim | não | não | não |
| Saída desenhada para agente de IA | sim | não | não | não |
| Explica por que cada teste rodou | sim | não | parcial | não |
| JS/TS e Python no mesmo daemon | sim | não | não | não |
| Funciona sem o editor aberto | sim | sim | não | sim |

## Onde as outras acertam

O `vitest --watch` é excelente dentro do ecossistema dele, e o grafo vem de graça do
bundler, o que o torna mais rápido de indexar que o nosso. Se o projeto é JS/TS puro e você
trabalha sozinho no terminal, talvez seja tudo de que você precisa.

O Wallaby.js continua sendo a melhor experiência inline que existe. Resultado ao lado da
linha de código, enquanto você digita, é algo que um daemon publicando em socket não
reproduz.

O `pytest-watch` é simples e faz o que promete. O escopo fixo é uma escolha deliberada, não
um descuido.

## Onde o livetest difere

**A saída foi desenhada para ser lida por um programa.** Todo lote termina com uma linha
`chave=valor`, há um `status.json` escrito de forma atômica, e um log NDJSON append-only.
Nenhuma outra ferramenta da tabela trata um programa como leitor de primeira classe.

**Profundidade é configuração, não regra.** Um utilitário estável e muito importado pode
ser preso em `self` para não arrastar a suíte junto; um arquivo crítico pode ser preso em
`transitive`. Por arquivo, através de globs. Veja
[Profundidade de propagação](/guide/depth).

**Toda seleção carrega o motivo.** Não uma lista de arquivos, mas uma lista de arquivos com
a cadeia de importação que justifica cada um. É o que transforma um resultado surpreendente
em um resultado legível.

**Um daemon, mais de uma linguagem.** Um projeto com front em TypeScript e back em Python
ganha um watcher, um debounce e um relatório.

## Quando não usar

Se a sua suíte inteira roda em menos de dois segundos, propagação por grafo não compra
nada; rode tudo. Se o projeto é JS/TS puro, não há agente de IA no fluxo e você vive dentro
do editor, o Wallaby.js entrega uma experiência mais justa. Ser honesto sobre isso sai mais
barato do que você descobrir depois da instalação.
