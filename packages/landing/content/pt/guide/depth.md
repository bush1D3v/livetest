---
title: Profundidade de propagação
description: Decida por arquivo até onde a execução se propaga no grafo reverso de dependências, e veja acontecer.
---

# Profundidade de propagação

Esta é a configuração central. Para cada arquivo, você decide até onde a execução se
propaga no grafo **reverso**, ou seja, através de quem importa o arquivo.

| Valor | Saltos | Significado |
|---|---|---|
| `"self"` | 0 | apenas os testes do arquivo alterado |
| `"direct"` | 1 | o arquivo **+ quem o importa diretamente** (padrão) |
| `"transitive"` | ∞ | o arquivo + **toda a cadeia** de importadores |
| `n` | n | profundidade numérica exata |

## Experimente

Escolha uma profundidade e veja, agora, o que aconteceria ao salvar `login.ts`. É a mesma
busca em largura que roda no daemon.

<div class="grafo" data-reveal>
<div class="grafo__controles" role="tablist" aria-label="Profundidade de propagação">
<button class="grafo__btn" type="button" role="tab" data-depth="self"><span class="grafo__btn-nome">self</span><span class="grafo__btn-dica">só o arquivo</span></button>
<button class="grafo__btn" type="button" role="tab" data-depth="direct" aria-selected="true"><span class="grafo__btn-nome">direct</span><span class="grafo__btn-dica">+ importadores diretos</span></button>
<button class="grafo__btn" type="button" role="tab" data-depth="transitive"><span class="grafo__btn-nome">transitive</span><span class="grafo__btn-dica">+ cadeia completa</span></button>
</div>
<div class="grafo__palco">
<svg class="grafo__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g data-graph-edges></g></svg>
<div class="grafo__nos" data-graph-nodes></div>
</div>
<div class="grafo__painel">
<div class="grafo__resultado"><p class="grafo__legenda" data-graph-caption></p><ul class="grafo__testes" data-graph-tests></ul></div>
<div class="grafo__config"><p class="grafo__config-titulo">A regra que produz isso</p><pre class="code-block"><code data-graph-config></code></pre></div>
</div>
</div>

Repare que `self` ainda roda um teste. A propagação percorre arestas de *import*; o
mapeamento de um arquivo-fonte para o seu arquivo de teste acontece depois, por convenção
de nome. Colapsar as duas etapas faria `self` não rodar nada, porque o teste está a um
salto do fonte.

## Configurando

```jsonc
{
  "dependencyDepth": {
    "default": "direct",
    "overrides": {
      "src/util/**": "self",                    // utilitário estável: não propaga
      "src/components/Login.tsx": "transitive"  // crítico: propaga até o fim
    }
  }
}
```

Os `overrides` são avaliados **na ordem de declaração e o último que casar vence**, o que
permite escrever uma regra ampla seguida de exceções:

```jsonc
"overrides": {
  "src/**": "self",                         // regra geral
  "src/components/Login.tsx": "transitive"  // exceção
}
```

## Escolhendo um valor

**Testes demais rodando (lento).** Um arquivo importado por meio projeto, como um módulo de
tipos ou um arquivo de constantes, arrasta a suíte inteira a cada save. Prenda em `"self"`.

**Testes de menos rodando (regressões passam).** Um arquivo cuja quebra só aparece nos
consumidores, tipicamente autenticação, roteamento ou serialização, merece `"transitive"`.

**Sem certeza.** Deixe `"direct"`. É o padrão porque pega o caso comum, o importador que
quebrou, sem pagar pela cadeia inteira.

## Conferindo antes de assumir

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
  ...
```

Também dá para experimentar uma profundidade sem editar o arquivo de configuração:

```bash
npx livetest run src/login.ts --depth transitive
npx livetest why src/login.ts --depth self
```

::: warning O grafo não é onisciente
Import dinâmico com expressão calculada, injeção de dependência e reflexão não aparecem no
grafo. O `livetest why` avisa sobre os especificadores que não conseguiu resolver. Nesses
arquivos, considere uma profundidade maior ou rode a suíte inteira antes de concluir que
está tudo certo.
:::
