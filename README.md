# Live Test Runner

**Roda os testes certos, no instante em que você salva o arquivo — e explica por que rodou.**

Ferramenta de desenvolvimento instalada como `devDependency` que observa o projeto,
resolve quais testes uma alteração afeta usando o **grafo de dependências**, e executa
apenas esse subconjunto — publicando o resultado em três canais ao mesmo tempo:
o terminal (para um agente de IA), um log estruturado (para qualquer ferramenta) e
um painel no VSCode (para você).

```
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

Dois problemas recorrentes, agravados quando quem escreve o código é um agente de IA:

1. **Detecção tardia.** O ciclo real é *editar → editar → editar → só então testar*.
   Quando o teste enfim roda, várias mudanças já se acumularam e isolar a que quebrou
   custa caro.
2. **Escopo subestimado.** Ferramentas e agentes tendem a rodar apenas os testes do
   arquivo que mudou, ignorando quem **depende** dele. `login.ts` quebra, mas quem
   acusa são os testes de `header.ts` e `footer.ts` — que ninguém rodou.

## O diferencial

| Ferramenta | O que faz | Limitação |
|---|---|---|
| `jest`/`vitest --watch` | Roda testes afetados via grafo do bundler | Preso ao ecossistema JS; a saída não foi desenhada para um agente de IA ler |
| Wallaby.js | Execução ao vivo, inline no editor | Focado em UX humana dentro do editor |
| `pytest-watch` | Reexecuta ao salvar | Sem noção de grafo de dependência; roda escopo fixo |

O Live Test Runner é pensado desde a raiz para **dois consumidores simultâneos** — o
agente, que precisa saber *imediatamente* se algo quebrou, e a pessoa, que quer ver
isso no editor — com **controle configurável, por arquivo, de quão fundo** no grafo a
execução se propaga.

## Instalação

```bash
npm install --save-dev @livetest/cli
npx livetest init      # cria livetest.config.json comentado
npx livetest doctor    # confere ambiente, runners e cobertura
npx livetest start     # começa a observar
```

Requer Node.js 18.18+. Para projetos Python, um interpretador 3.8+ no `PATH`.

## Como funciona

```
┌──────────────────────────────── projeto do usuário ────────────────────────────────┐
│                                                                                     │
│   arquivo salvo                                                                     │
│        │                                                                            │
│        ▼                                                                            │
│   ┌─────────┐   ┌───────────┐   ┌───────────────┐   ┌─────────┐   ┌──────────────┐  │
│   │ Watcher │──▶│ Debounce  │──▶│ Grafo de dep. │──▶│ Planner │──▶│ Test runners │  │
│   └─────────┘   └───────────┘   └───────────────┘   └─────────┘   └──────┬───────┘  │
│                  agrupa saves     quem importa       o quê rodar          │         │
│                  consecutivos     este arquivo?      e por quê            │         │
│                                                                           ▼         │
│                                                                    ┌─────────────┐  │
│                                                                    │ Agregador   │  │
│                                                                    └──┬───┬───┬──┘  │
│                        ┌──────────────────────────────────────────────┘   │   │     │
│                        ▼                        ▼                         ▼         │
│                 ┌────────────┐          ┌──────────────┐        ┌──────────────────┐│
│                 │  stdout    │          │  run.log     │        │  socket TCP      ││
│                 │  (agente)  │          │  status.json │        │  (extensão)      ││
│                 └────────────┘          └──────────────┘        └──────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────────┘
```

Cada etapa é um módulo isolado e testado. Grafo de dependência e test runner são
**adapters plugáveis**: adicionar Go ou Rust não exige tocar no core — veja
[docs/adapters.md](docs/adapters.md).

## Profundidade de propagação

O ponto central da configuração. Para cada arquivo, você decide até onde a execução
se propaga no grafo reverso:

| Valor | Significado |
|---|---|
| `"self"` | apenas os testes do arquivo alterado |
| `"direct"` | o arquivo **+ quem o importa diretamente** (padrão) |
| `"transitive"` | o arquivo + **toda a cadeia** de importadores |
| `2` | profundidade numérica exata |

```jsonc
{
  "dependencyDepth": {
    "default": "direct",
    "overrides": {
      "src/util/**": "self",                  // utilitário estável: não propaga
      "src/components/Login.tsx": "transitive" // crítico: propaga até o fim
    }
  }
}
```

> **Nota sobre o PRD.** A seção 6.2 do PRD descreve `direct` como "roda apenas os
> testes do arquivo alterado", o que conflita com a seção 4.1, onde o adapter de grafo
> devolve "importadores diretos ou transitivos". Resolvemos a ambiguidade expondo os
> três níveis: quem quer o comportamento "só o arquivo" usa `"self"`.

Não tem certeza do que vai rodar? Pergunte:

```bash
$ npx livetest why src/login.ts
arquivo:       src/login.ts
runner:        js
profundidade:  transitive — arquivo + cadeia completa de importadores  [override: src/login.ts]

arquivos impactados (8):
  [0] src/login.ts
  [1] src/header.ts
  [2] src/layout.ts via src/header.ts
  ...
```

## Uso com agentes de IA

Suba o daemon uma vez, em background, e leia o resultado sem parser dedicado:

```bash
npx livetest start > .livetest/daemon.out 2>&1 &
```

Três formas de consumir, da mais simples à mais completa:

**1. A linha resumo.** Toda conclusão de lote termina com uma linha `chave=valor`:

```
LIVETEST batch=batch-7 status=failed files=3 tests=12 passed=10 failed=2 skipped=0 duration=1.4s
```

```bash
grep '^LIVETEST' .livetest/daemon.out | tail -1
```

**2. O snapshot.** `.livetest/status.json` sempre reflete o estado atual, com escrita
atômica — nunca se lê um JSON pela metade:

```bash
npx livetest status --json | jq '.lastBatch.status'
```

**3. O log de eventos.** `.livetest/run.log` é NDJSON append-only, um evento por linha,
com o histórico completo, incluindo o motivo de cada teste ter rodado.

Para uma execução pontual, sem daemon, `livetest run` devolve **exit code 1** quando
algum teste falha — direto em `&&` de shell ou em hook de pre-commit:

```bash
npx livetest run src/login.ts && echo "seguro para continuar"
```

Guia detalhado: [docs/ai-agents.md](docs/ai-agents.md).

## Extensão do VSCode

Painel dedicado com a árvore de arquivos monitorados, status de cada um
(`idle`/`running`/`passed`/`failed`), o **motivo** de ter rodado no tooltip, e o log
completo de cada execução.

Conforme o PRD, a extensão **não sobe o daemon sozinha**: ela procura um em execução
via `.livetest/daemon.json` e, quando não acha, mostra o botão *Iniciar daemon*, que
abre um terminal com o comando — a ação continua sendo sua.

## Comandos

| Comando | Para quê |
|---|---|
| `livetest start` | Observa o projeto e roda os testes afetados a cada save |
| `livetest run [arquivos...]` | Execução única; exit code 1 se falhar |
| `livetest why <arquivo>` | Explica o que rodaria e por quê, sem executar |
| `livetest status [--json]` | Estado do daemon e resultado do último lote |
| `livetest watch` | Acompanha, em outro terminal, um daemon já em execução |
| `livetest stop` | Encerra o daemon |
| `livetest init` | Cria `livetest.config.json` comentado |
| `livetest doctor` | Verifica configuração, runners e ambiente |

## Suporte

| | Grafo de dependência | Test runners |
|---|---|---|
| **JavaScript / TypeScript** | API do compilador TS (`paths`, `baseUrl`, `index`, ESM `.js`→`.ts`) | Vitest, Jest |
| **Python** | módulo `ast` nativo, com fallback por regex | pytest |
| **Qualquer outra** | adapter próprio ([docs/adapters.md](docs/adapters.md)) | adapter `command` (exit code) |

## Landing page

O site de apresentação vive em [packages/landing/](packages/landing/). É estático,
construído com Vite e **sem nenhuma dependência em runtime** — a seção central roda a
mesma busca em largura do core, para que o visitante troque a profundidade e veja o
grafo reagir na hora.

```bash
npm run dev --workspace @livetest/landing              # servidor local
npm run build:standalone --workspace @livetest/landing # HTML em arquivo único
```

## Documentação

- [Configuração completa](docs/configuration.md) — todos os campos, com exemplos
- [Escrevendo um adapter](docs/adapters.md) — suporte a uma nova linguagem
- [Protocolo de eventos](docs/protocol.md) — formato do socket e do NDJSON
- [Guia para agentes de IA](docs/ai-agents.md) — como consumir a saída
- [`@livetest/core`](packages/core/README.md) — API programática
- [`@livetest/cli`](packages/cli/README.md) — referência da CLI
- [`@livetest/landing`](packages/landing/README.md) — a página de apresentação

## Desenvolvimento

```bash
npm install
npm run verify        # typecheck + cobertura + build, tudo de uma vez

npm test              # 1167 testes nos quatro pacotes
npm run test:coverage # 100% de cobertura, com limite obrigatório
npm run typecheck     # TypeScript estrito
npm run build
```

Projetos de exemplo prontos para experimentar em [examples/](examples/):
`demo-js` (Vitest) e `demo-python` (pytest), ambos com a cadeia
`login → header/footer → layout` que exercita a propagação transitiva.

## Licença

MIT
