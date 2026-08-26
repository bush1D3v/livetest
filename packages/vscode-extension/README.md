# Live Test Runner — extensão do VSCode

Painel visual do [Live Test Runner](https://github.com/bush1D3v/livetest/blob/master/README.md): árvore de arquivos monitorados,
status de cada um, o motivo de ter rodado, e o log completo de cada execução.

## O que faz

- **Árvore de arquivos** com status por arquivo — `idle`, `running`, `passed`,
  `failed`, `errored`, `skipped`. Diretórios herdam o pior status dos filhos, então
  uma falha lá no fundo aparece na raiz.
- **Motivo no tooltip.** Passe o mouse sobre um arquivo e veja
  *"rodou porque src/header.ts importa src/login.ts (1 nivel)"*.
- **Falhas como filhos** do arquivo na árvore, com a mensagem de assertion.
- **Diagnósticos no editor**, marcando os arquivos que falharam.
- **Canal de log** com o histórico de todos os lotes.
- **Barra de status** com o estado da conexão.

## Conexão

A extensão **não sobe o daemon sozinha** — decisão explícita do PRD (seção 4.3). Ela
procura um daemon em execução via `.livetest/daemon.json` e:

- **encontrou** → conecta, recebe o snapshot completo e passa a receber os eventos ao
  vivo;
- **não encontrou** → mostra o botão **Iniciar daemon**, que abre um terminal com o
  comando configurado. A ação continua sendo sua.

Se o daemon cair, a extensão reconecta sozinha no intervalo configurado.

## Comandos

| Comando | O que faz |
|---|---|
| `Live Test: Conectar ao daemon` | força uma tentativa de conexão |
| `Live Test: Iniciar daemon` | abre um terminal com o comando configurado |
| `Live Test: Encerrar daemon` | envia `SIGTERM` ao daemon |
| `Live Test: Atualizar` | redesenha a árvore |
| `Live Test: Abrir log de execucao` | abre o canal de log |
| `Live Test: Rodar testes deste arquivo` | roda `livetest run` no arquivo |

## Configurações

| Chave | Padrão | Significado |
|---|---|---|
| `livetest.discoveryFile` | `.livetest/daemon.json` | onde procurar o daemon |
| `livetest.startCommand` | `npx livetest start` | comando do botão "Iniciar daemon" |
| `livetest.reconnectIntervalMs` | `3000` | intervalo entre tentativas de reconexão |
| `livetest.revealFailures` | `true` | marcar falhas no editor |

## Desenvolvimento

```bash
npm run build        # empacota em dist/extension.cjs (esbuild, CJS)
npm run build:watch
npm test             # 82 testes, 100% de cobertura
```

O código é dividido em duas camadas por uma razão prática de teste:

- `src/model/` — estado da conexão e da árvore. **Não importa `vscode`**, e por isso é
  testável com vitest comum, sem instância de editor.
- `src/extension.ts` — a única camada que fala com a API do VSCode. Traduz eventos em
  itens de árvore, diagnósticos e linhas de log; cliques em comandos.

Para testar essa segunda camada sem baixar um editor, o `vitest.config.ts` aponta o
especificador `vscode` para `test/mocks/vscode.ts` — uma implementação mínima da API
que registra o que a extensão criou. Os testes então invocam os comandos de verdade e
inspecionam árvore, diagnósticos e barra de status.

A extensão importa de `@livetest/core/client`, não do índice completo: o índice traria
junto o compilador TypeScript usado pelo grafo JS/TS, e o bundle saltaria de 24 KB para
9 MB.
