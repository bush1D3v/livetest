---
title: O que é o livetest
description: Um executor de testes que observa o projeto, descobre pelo grafo de dependências quais testes uma alteração afeta, e explica por que cada um rodou.
---

# O que é o livetest

O Live Test Runner é uma ferramenta de desenvolvimento instalada como `devDependency`. Ela
observa o projeto, resolve quais testes uma alteração afeta usando o **grafo de
dependências**, e executa apenas esse subconjunto, publicando o resultado em três canais ao
mesmo tempo: o terminal (para um agente de IA), um log estruturado (para qualquer
ferramenta) e um painel no VSCode (para você).

```output
$ livetest start

livetest batch-3 (idle) src/login.ts
  js -> 4 arquivo(s) de teste
    src/footer.test.ts  rodou porque src/footer.ts importa src/login.ts (1 nivel)
    src/header.test.ts  rodou porque src/header.ts importa src/login.ts (1 nivel)
    src/layout.test.ts  rodou porque src/layout.ts importa src/login.ts via src/header.ts (2 niveis)
    src/login.test.ts   rodou porque src/login.ts foi alterado
  PASSOU js  4 arquivo(s)  5 passou  0 falhou  0 pulou  1.5s
  batch-3 PASSOU em 1.6s
LIVETEST batch=batch-3 status=passed files=4 tests=5 passed=5 failed=0 skipped=0 duration=1.6s
```

## Por que existe

Dois problemas recorrentes, agravados quando quem escreve o código é um agente de IA.

### Detecção tardia

O ciclo real é *editar, editar, editar, e só então testar*. Quando o teste enfim roda,
várias mudanças já se acumularam e isolar a que quebrou custa caro. O agente, enquanto
isso, já avançou meia dúzia de passos em cima de uma suposição errada.

### Escopo subestimado

Ferramentas e agentes tendem a rodar apenas os testes do arquivo que mudou, ignorando quem
**depende** dele. `login.ts` quebra, mas quem acusa são os testes de `header.ts` e
`footer.ts`, que ninguém rodou. A regressão passa.

## O diferencial

O Live Test Runner é pensado desde a raiz para **dois consumidores simultâneos**: o agente,
que precisa saber *imediatamente* se algo quebrou, e a pessoa, que quer ver isso no editor.
Sobre isso vem o **controle configurável, por arquivo, de quão fundo** a execução se
propaga no grafo.

| Ferramenta | O que faz | Limitação |
|---|---|---|
| `jest`/`vitest --watch` | Roda testes afetados via grafo do bundler | Preso ao ecossistema JS; a saída não foi desenhada para um agente de IA ler |
| Wallaby.js | Execução ao vivo, inline no editor | Focado em UX humana dentro do editor |
| `pytest-watch` | Reexecuta ao salvar | Sem noção de grafo de dependência; roda escopo fixo |

Há um detalhamento maior em [Comparativo](/guide/comparison).

## O que você ganha

- **Grafo de dependências de verdade.** JS/TS pela API do compilador TypeScript,
  resolvendo `paths`, `baseUrl`, `index.*` e o mapeamento `./x.js` para `./x.ts` de
  projetos ESM. Python pelo módulo `ast` nativo, com imports relativos e absolutos.
- **Toda seleção explicada.** Nenhum teste roda sem uma cadeia de importação anexada que o
  justifique. `livetest why src/login.ts` mostra o caminho inteiro antes de você mudar
  qualquer coisa.
- **Três canais de saída ao mesmo tempo.** Uma linha resumo grepável, um `status.json`
  escrito de forma atômica, e um log NDJSON append-only com o histórico completo.
- **Degradação segura.** Python ausente, adapter quebrado, porta indisponível: o daemon
  emite um evento `error` dizendo o que passou a valer e continua rodando.

## Requisitos

Node.js 18.18 ou mais novo. Para projetos Python, um interpretador 3.8+ no `PATH`.

::: tip Próximo passo
[Primeiros passos](/guide/getting-started) leva três comandos e uns trinta segundos.
:::
