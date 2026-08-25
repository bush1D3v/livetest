# PRD — Live Test Runner (nome provisório)
### Ferramenta de execução automática de testes em tempo real, ao salvar arquivos

---

## 1. Contexto e Problema

Hoje, tanto desenvolvedores humanos quanto (principalmente) agentes de IA assistiva (Claude Code, Cursor, etc.) trabalham em ciclos de: **editar → editar → editar → só então rodar os testes**. Isso gera dois problemas recorrentes:

1. **Detecção tardia de quebras**: quando o teste finalmente roda, pode haver múltiplas alterações acumuladas, dificultando isolar qual mudança quebrou o quê.
2. **Escopo de teste subestimado**: ferramentas e agentes tendem a rodar apenas os testes do arquivo que foi diretamente alterado, ignorando arquivos que **dependem** dele (importadores diretos ou transitivos) e que também podem ter sido afetados.

Isso é agravado no fluxo com IA, porque a IA frequentemente decide sozinha quando e o que testar, e só percebe erros bem depois de já ter avançado com suposições erradas sobre o estado do código.

## 2. Objetivo do Produto

Criar uma ferramenta de desenvolvimento (instalada como `devDependency` do projeto) que:

- Observa (`watch`) os arquivos do projeto.
- Ao detectar salvamento de um arquivo, dispara automaticamente, **em background**, a execução dos testes relacionados àquele arquivo — do próprio arquivo e, opcionalmente, dos arquivos que dependem dele (importadores diretos ou em cadeia).
- Expõe o resultado tanto para consumo por um **agente de IA** (via terminal/log) quanto por um **desenvolvedor humano** (via uma extensão do VSCode com painel visual).
- É agnóstica de linguagem em sua arquitetura central, com adapters plugáveis por linguagem/framework de teste.

## 3. Diferencial vs. Ferramentas Existentes

Já existem soluções parecidas, mas nenhuma cobre exatamente esse caso de uso:

| Ferramenta | O que faz | Limitação em relação à nossa proposta |
|---|---|---|
| Jest/Vitest `--watch` | Roda testes afetados usando o próprio grafo de módulos do bundler | Preso ao ecossistema JS/TS; não pensado para ser lido/consumido por um agente de IA |
| Wallaby.js | Execução de testes em tempo real, inline no editor | Focado em UX humana dentro do editor; não é pensado como canal de feedback para um agente de IA autônomo |
| pytest-watch | Reexecuta testes ao salvar | Não tem noção de grafo de dependência (roda a suíte toda ou um escopo fixo), sem granularidade configurável |

**Diferencial central da proposta**: ser uma ferramenta pensada desde a raiz para servir **dois consumidores simultâneos** — o agente de IA (que precisa saber *imediatamente*, via terminal/log, se algo quebrou) e o humano (que quer uma interface visual no editor) — com controle granular e configurável de quão "fundo" no grafo de dependências os testes devem se propagar.

## 4. Arquitetura de Alto Nível

```
┌─────────────────────────────────────────────────────────┐
│                      Projeto do usuário                  │
│                                                           │
│  ┌────────────┐        ┌─────────────────────────────┐  │
│  │  Arquivos  │──save──▶│      CORE / DAEMON          │  │
│  │ do projeto │        │  (devDependency, roda local) │  │
│  └────────────┘        │                              │  │
│                         │  1. File Watcher             │  │
│                         │  2. Debounce Engine          │  │
│                         │  3. Dependency Graph Adapter │  │
│                         │  4. Test Runner Adapter      │  │
│                         │  5. Result Aggregator        │  │
│                         └───────┬───────────┬──────────┘  │
│                                 │           │              │
│                     stdout/log  │           │  canal de    │
│                     (IA lê)     │           │  eventos     │
│                                 ▼           ▼  (IPC/socket)│
│                         ┌──────────┐  ┌────────────────┐  │
│                         │ Terminal │  │ Extensão VSCode │  │
│                         │ (agente  │  │  (painel visual,│  │
│                         │  de IA)  │  │  logs por arq.) │  │
│                         └──────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 4.1. Core / Daemon (devDependency do projeto)

Responsável por toda a lógica agnóstica de linguagem:

- **File Watcher**: observa mudanças nos arquivos do projeto (respeitando `.gitignore`/ignore-list configurável).
- **Debounce Engine**: agrupa saves consecutivos antes de disparar testes (ver seção 6.3).
- **Dependency Graph Adapter** (plugável por linguagem): dado um arquivo alterado, retorna a lista de arquivos que o importam/dependem dele, direta ou transitivamente.
- **Test Runner Adapter** (plugável por linguagem/framework): sabe como rodar o(s) teste(s) associado(s) a um arquivo específico (ex.: `jest <arquivo>`, `pytest <arquivo>`, `vitest run <arquivo>`).
- **Result Aggregator**: consolida resultados (passou/falhou/erro/log) e os expõe pelos dois canais de saída.

### 4.2. Canais de Saída

1. **stdout / arquivo de log**: formato legível e "parseável" por um agente de IA que tenha iniciado o daemon como processo em background (ou que leia o log). Deve ser estruturado o suficiente para um agente entender rapidamente "quais arquivos rodaram, o que passou, o que falhou, e por quê".
2. **Canal de eventos local (IPC/socket/arquivo de eventos)**: consumido pela extensão VSCode para renderizar estado em tempo real (rodando/passou/falhou) por arquivo, com o log completo de cada execução.

### 4.3. Extensão VSCode

- Painel dedicado mostrando: árvore de arquivos monitorados, status de cada um (idle/rodando/passou/falhou), e o motivo de ter rodado (ex.: "rodou porque importa `login.ts`").
- Log completo de cada execução de teste, navegável por arquivo.
- **Comportamento de conexão**: a extensão tenta se conectar a um daemon já em execução; se não encontrar nenhum, exibe um botão para iniciá-lo manualmente (a extensão **não** sobe o daemon sozinha automaticamente).
- A extensão é a camada de visualização; o core funciona de forma independente dela (via CLI/terminal), garantindo que o fluxo com agente de IA funcione mesmo sem VSCode aberto.

### 4.4. Adapters do MVP

- **Linguagens**: JavaScript/TypeScript e Python.
- **Test Runners MVP**: Jest/Vitest (JS/TS), Pytest (Python).
- **Dependency Graph MVP**:
  - JS/TS: análise via AST (ex.: `ts-morph`/`babel-parser` ou alavancando `madge`/`dependency-cruiser`).
  - Python: análise via módulo `ast` nativo, resolvendo imports absolutos e relativos.
- Interface de adapter documentada e aberta, para que outras linguagens (Go, Rust, etc.) possam ser adicionadas depois sem alterar o core.

## 5. Fluxo de Funcionamento (passo a passo)

1. Desenvolvedor (ou agente de IA) salva um arquivo.
2. File Watcher detecta a mudança e a envia ao Debounce Engine.
3. Debounce Engine aguarda a janela configurada (ver 6.3) para agrupar saves subsequentes.
4. Ao expirar a janela, o Dependency Graph Adapter resolve quais arquivos devem ser testados: o próprio arquivo + (conforme configuração) importadores diretos e/ou transitivos.
5. O Test Runner Adapter dispara a execução dos testes para o conjunto de arquivos resolvido.
6. O Result Aggregator recebe os resultados e os publica:
   - no stdout/log (para o agente de IA);
   - no canal de eventos (para a extensão VSCode, se conectada).
7. Se um teste falhar, tanto o agente quanto o humano recebem o feedback quase instantaneamente, sem precisar esperar o fim de um bloco grande de alterações.

## 6. Configuração

Arquivo de configuração no root do projeto (ex.: `livetest.config.json`), com possibilidade de overrides por arquivo/teste via comentário de diretiva (a definir na fase de design detalhado).

### 6.1. Exemplo de schema de configuração

```json
{
  "watch": ["src/**/*.{ts,tsx,py}"],
  "ignore": ["**/node_modules/**", "**/*.test.*"],
  "dependencyDepth": {
    "default": "direct",
    "overrides": {
      "src/components/Login.tsx": "transitive"
    }
  },
  "debounce": {
    "mode": "both",
    "idleMs": 400,
    "maxBatchWindowMs": 3000
  },
  "runners": {
    "js": { "command": "vitest run --changed" },
    "python": { "command": "pytest" }
  },
  "output": {
    "logFile": ".livetest/run.log",
    "stdout": true
  }
}
```

### 6.2. Granularidade de dependência (por arquivo/projeto)

- `direct`: roda apenas os testes do arquivo alterado.
- `transitive`: roda o arquivo alterado + todos os arquivos que o importam, em cadeia completa.
- Configurável por projeto (default) e sobrescrevível por arquivo específico — cobrindo o caso citado pelo usuário (ex.: `login.ts` sendo importado por `header.ts` e `footer.ts`; o desenvolvedor decide, por arquivo, se quer propagação transitiva).

### 6.3. Debounce (evitar reexecução excessiva em edições em lote)

Modo `both` (recomendado como default):
- **Debounce por tempo (idle)**: só dispara após X ms sem novos saves.
- **Debounce por "sessão de edição"**: se saves continuarem chegando, adia a execução até uma janela máxima (`maxBatchWindowMs`), evitando que uma sequência muito longa de edições nunca dispare o teste.

## 7. Escopo do MVP

**Incluído:**
- Core/daemon com watcher, debounce configurável, dependency graph e test runner para JS/TS e Python.
- Saída via stdout + arquivo de log.
- Extensão VSCode com painel de status e logs, conectando-se a um daemon já em execução (com botão de start manual).
- Configuração via arquivo `livetest.config.json`, incluindo overrides por arquivo.

**Fora do MVP (mencionar como fase futura):**
- Suporte a outras linguagens (Go, Rust, Java etc.) — arquitetura de adapter deve permitir isso sem retrabalho do core.
- Auto-start do daemon pela extensão.
- Suporte a monorepos complexos (múltiplos daemons/múltiplas configs).
- Dashboards de histórico/métricas de execução ao longo do tempo.
- Detecção automática de "apenas mudança cosmética" (comentário, formatação) para evitar disparo desnecessário de testes.

## 8. Requisitos Não-Funcionais

- **Performance**: o daemon não pode competir de forma perceptível por CPU/IO com o editor ou com o processo do agente de IA; execução de testes deve ser incremental (apenas o subconjunto de arquivos resolvido, nunca a suíte inteira, salvo comando explícito).
- **Robustez**: falha em um adapter (ex.: dependency graph não conseguir resolver um import dinâmico) não deve derrubar o daemon; deve degradar de forma segura (ex.: rodar só o arquivo direto e logar aviso).
- **Transparência**: toda decisão de "por que esse conjunto de arquivos foi testado" deve ser exposta no log/evento, para que tanto IA quanto humano entendam o motivo.
- **Independência de IDE**: o core deve funcionar 100% via terminal, sem exigir VSCode aberto.

## 9. Riscos e Questões em Aberto (para fase de design detalhado)

- Resolução de dependências dinâmicas/reflexivas (import dinâmico, `require` condicional, DI) pode gerar falsos negativos no grafo de dependência.
- Definição exata do protocolo do canal de eventos entre daemon e extensão (WebSocket local? Unix socket? Arquivo de eventos append-only?).
- Formato exato do log estruturado para consumo por IA (precisa ser simples o bastante para qualquer agente "entender" sem parser dedicado).
- Comportamento em monorepos (múltiplos `package.json`/projetos dentro do mesmo repositório).
- Como lidar com testes que dependem de estado externo (banco de dados, rede) sem virar gargalo de performance no modo "ao vivo".

## 10. Critérios de Sucesso

- Ao salvar um arquivo, o desenvolvedor/agente recebe o resultado do(s) teste(s) relevante(s) em poucos segundos (não minutos).
- Redução mensurável de "blocos de alteração" que só são testados no final, quando usados junto de um agente de IA.
- Extensão VSCode reflete o estado do daemon em tempo real, sem necessidade de recarregar/reiniciar.
- Configuração de profundidade de dependência funciona corretamente no caso de teste: alterar `login.ts` importado por `header.ts` e `footer.ts`, com overrides distintos por arquivo.
