# Projetos de exemplo

Dois projetos mínimos que exercitam a propagação por dependência, cada um com a mesma
cadeia:

```
login  ←  header  ←  layout
   ↖
    footer
```

Alterar `login` deve, com `dependencyDepth: "transitive"`, disparar os testes de
`login`, `header`, `footer` **e** `layout`.

| Projeto | Linguagem | Runner |
|---|---|---|
| [`demo-js/`](demo-js/) | TypeScript | Vitest |
| [`demo-python/`](demo-python/) | Python | pytest |

## Experimentando

```bash
cd examples/demo-js

# O que rodaria, e por quê — sem executar nada
node ../../packages/cli/bin/livetest.mjs why src/login.ts

# Executa de verdade
node ../../packages/cli/bin/livetest.mjs run src/login.ts

# Observa: edite src/login.ts em outro terminal e veja os testes dispararem
node ../../packages/cli/bin/livetest.mjs start
```

Para ver a cascata de falhas que motiva a ferramenta, quebre a base da cadeia:

```bash
# em demo-js/src/login.ts, troque o corpo por `return false;`
node ../../packages/cli/bin/livetest.mjs run src/login.ts
# 4 de 5 testes falham — os de header, footer e layout, que ninguém teria rodado
```

O `demo-python` funciona igual. Ele precisa de `pytest` disponível no interpretador
configurado; para usar um venv, aponte `pythonPath` no `livetest.config.json`:

```jsonc
{ "pythonPath": ".venv/bin/python" }
```
