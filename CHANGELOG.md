# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
versionamento semântico.

## [0.1.0] — não publicado

Primeira versão. Implementa o MVP descrito em
[docs/PRD-live-test-runner.md](docs/PRD-live-test-runner.md).

### Adicionado

**Core (`@livetest/core`)**

- Watcher com filtragem por glob e poda de diretórios antes da varredura recursiva.
- Motor de debounce com os três modos do PRD (`idle`, `batch`, `both`) e timers
  injetáveis.
- Grafo de dependências com propagação reversa por busca em largura, seguro com ciclos
  e com profundidade configurável por arquivo.
- Adapter de grafo JS/TS pela API do compilador TypeScript: resolve `paths`, `baseUrl`,
  `index.*` e o mapeamento `./x.js → ./x.ts` de projetos ESM.
- Adapter de grafo Python pelo módulo `ast` nativo, com fallback por expressão regular
  quando não há interpretador disponível.
- Mapeamento fonte → teste por templates com os tokens `{dir}`, `{relDir}`,
  `{relDirTail}`, `{name}` e `{ext}`.
- Adapters de runner: Vitest, Jest (relatório JSON), pytest (JUnit XML) e `command`
  genérico por código de saída.
- Três canais de saída simultâneos: relatório de terminal, log NDJSON append-only com
  rotação, e `status.json` com escrita atômica.
- Canal de eventos em TCP loopback com NDJSON, snapshot na conexão e arquivo de
  descoberta que distingue daemon vivo de registro órfão.
- Ponto de entrada `@livetest/core/client` com apenas a superfície de consumo.

**CLI (`@livetest/cli`)**

- `start`, `run`, `why`, `status`, `watch`, `stop`, `init`, `doctor`.
- Códigos de saída estáveis, documentados, adequados a CI.
- `runCli` embutível, que devolve o código em vez de chamar `process.exit`.

**Extensão do VSCode**

- Árvore de arquivos com status, motivo da execução no tooltip e falhas como nós
  filhos.
- Diagnósticos no editor, canal de log e item de barra de status.
- Conexão a um daemon existente com reconexão automática; botão de início manual
  quando não há daemon — a extensão nunca o sobe sozinha.

### Decisões sobre pontos em aberto do PRD

A seção 9 do PRD deixou quatro questões em aberto. As respostas desta versão:

- **Protocolo do canal de eventos** — TCP em `127.0.0.1` com NDJSON, porta escolhida
  pelo sistema operacional e arquivo de descoberta `.livetest/daemon.json`. Named pipes
  e sockets Unix exigiriam dois caminhos de código; TCP em loopback é idêntico nas três
  plataformas.
- **Formato do log para IA** — três níveis de esforço: uma linha `LIVETEST chave=valor`
  ao fim de cada lote, um `status.json` sempre atual, e o NDJSON completo.
- **Dependências dinâmicas** — não são resolvidas, mas são **detectadas** e reportadas
  em `unresolved`, aparecendo como aviso em `livetest why`.
- **Ambiguidade de `direct`** — a seção 6.2 do PRD usa `direct` com o sentido de
  "somente o arquivo alterado", o que conflita com a 4.1. Expusemos três níveis
  (`self`, `direct`, `transitive`) em vez de escolher uma das leituras.

### Qualidade

Os três pacotes têm **100% de cobertura** de linhas, ramos, funções e instruções, com o
limite verificado a cada execução de `npm run test:coverage` — a suíte falha se cair.
São 988 testes: 762 no core, 144 na CLI e 82 na extensão.

Ficam de fora da medição apenas cinco arquivos de `src/types/` que contêm somente
`interface` e `type`: o TypeScript os compila para um `export {}` vazio, sem nenhuma
instrução para cobrir. `src/types/events.ts` **não** está entre eles, porque exporta uma
constante de verdade.

A extensão do VSCode é testada com um mock do módulo `vscode` (`test/mocks/vscode.ts`),
o que permite exercitar `extension.ts` — comandos, itens de árvore, diagnósticos — sem
subir um editor.

### Corrigido

Bugs reais encontrados enquanto a cobertura era fechada:

- **O cancelamento de lote nunca acontecia.** O `abort()` do lote anterior estava dentro
  de `processBatch`, que só roda depois que o lote anterior termina. Salvar durante uma
  execução esperava a antiga terminar em vez de cancelá-la. O cancelamento passou para o
  momento em que o lote entra na fila.
- **Arquivo apagado voltava ao grafo.** Em `refreshGraph`, o `removed.clear()` acontecia
  antes do filtro que devia excluir os apagados, tornando o filtro inócuo: o arquivo era
  removido e reindexado no mesmo lote.
- **`killTree` podia não matar nada no Windows.** `spawnSync` não lança quando o
  `taskkill` falha — devolve `error`/`status`. Sem checar isso, um `taskkill`
  indisponível deixava o processo de teste vivo, em silêncio. Agora há fallback para
  `SIGTERM`.
- **`livetest stop` deixava registro órfão.** No Windows o `SIGTERM` encerra o processo
  sem executar os handlers, então o daemon não limpava `.livetest/daemon.json`. O comando
  passou a esperar o encerramento e a limpar o registro, com `--timeout` configurável.
- **`--port` não ligava o canal de eventos** quando `server.enabled` era `false` na
  configuração. Agora a flag liga o servidor por implicação.
- **Falha de adapter de grafo ficava só no log interno**, invisível para quem consome o
  canal de eventos. Agora vira um evento `error` com `degradedTo`.

### Alterado

- `toNative`, `defaultPythonPath` e `killTree` aceitam a plataforma/separador como
  parâmetro, seguindo o padrão que `needsShell` já usava.
- `createFileWatcher` e `createEngine` aceitam `createWatcher`, e o adapter JS/TS aceita
  `preProcessFile` — pontos de injeção que também permitem trocar as implementações.
- `mergeRunnerConfig` recebe a base explicitamente em vez de consultar a tabela de
  embutidos por dentro, e passou a fazer parte da API pública.
- Mensagens de falha no terminal descartam quadros de pilha de `node_modules`, que
  empurravam a assertion real para fora da tela.

### Fora desta versão

Conforme a seção 7 do PRD: auto-start do daemon pela extensão, monorepos com múltiplas
configurações, dashboards de histórico e detecção de mudança puramente cosmética.
