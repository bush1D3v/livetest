---
title: Changelog
description: Todas as versões publicadas do Live Test Runner, seguindo Keep a Changelog e versionamento semântico.
---

# Changelog

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e
versionamento semântico.

## 0.1.0

Primeira versão. Implementa o MVP descrito no documento de requisitos do produto.

Publicada no npm como [`@livetest/core`](https://www.npmjs.com/package/@livetest/core) e
[`@livetest/cli`](https://www.npmjs.com/package/@livetest/cli), e no
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=livetest.livetest-vscode)
como `livetest-vscode`.

### Adicionado: core

- Watcher com filtragem por glob e poda de diretórios antes da varredura recursiva.
- Motor de debounce com os três modos (`idle`, `batch`, `both`) e timers injetáveis.
- Grafo de dependências com propagação reversa por busca em largura, seguro com ciclos e
  com profundidade configurável por arquivo.
- Adapter de grafo JS/TS pela API do compilador TypeScript: resolve `paths`, `baseUrl`,
  `index.*` e o mapeamento `./x.js` para `./x.ts` de projetos ESM.
- Adapter de grafo Python pelo módulo `ast` nativo, com fallback por expressão regular
  quando não há interpretador disponível.
- Mapeamento de fonte para teste por templates com os tokens `{dir}`, `{relDir}`,
  `{relDirTail}`, `{name}` e `{ext}`.
- Adapters de runner: Vitest, Jest (relatório JSON), pytest (JUnit XML) e `command`
  genérico por código de saída.
- Três canais de saída simultâneos: relatório de terminal, log NDJSON append-only com
  rotação, e `status.json` com escrita atômica.
- Canal de eventos em TCP loopback com NDJSON, snapshot na conexão e arquivo de descoberta
  que distingue daemon vivo de registro órfão.
- Ponto de entrada `@livetest/core/client` com apenas a superfície de consumo.

### Adicionado: CLI

- `start`, `run`, `why`, `status`, `watch`, `stop`, `init`, `doctor`.
- Códigos de saída estáveis, documentados, adequados a CI.
- `runCli` embutível, que devolve o código em vez de chamar `process.exit`.

### Adicionado: extensão do VSCode

- Árvore de arquivos com status, motivo da execução no tooltip e falhas como nós filhos.
- Diagnósticos no editor, canal de log e item de barra de status.
- Conexão a um daemon existente com reconexão automática; botão de início manual quando não
  há daemon. A extensão nunca o sobe sozinha.

### Adicionado: site de documentação

- Site estático em Vite, sem dependências em runtime.
- Terminal animado na home, encenando um daemon real, inclusive a regressão que só aparece
  nos importadores.
- Demonstração interativa de propagação: o visitante escolhe a profundidade e o grafo
  recalcula os arquivos alcançados, as arestas percorridas e o motivo de cada teste, com a
  mesma busca em largura do core.
- Realce de sintaxe próprio, em cerca de 120 linhas testadas, no lugar de uma biblioteca.
- `prefers-reduced-motion` desliga todas as animações e entrega a página completa.

### Decisões sobre pontos em aberto

O documento de requisitos deixou quatro questões em aberto. As respostas desta versão:

- **Protocolo do canal de eventos.** TCP em `127.0.0.1` com NDJSON, porta escolhida pelo
  sistema operacional e arquivo de descoberta `.livetest/daemon.json`. Named pipes e
  sockets Unix exigiriam dois caminhos de código; TCP em loopback é idêntico nas três
  plataformas.
- **Formato do log para IA.** Três níveis de esforço: uma linha `LIVETEST chave=valor` ao
  fim de cada lote, um `status.json` sempre atual, e o NDJSON completo.
