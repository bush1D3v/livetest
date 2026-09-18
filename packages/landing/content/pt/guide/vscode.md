---
title: Extensão do VSCode
description: O painel visual: arquivos monitorados, status de cada um, o motivo de ter rodado e o log completo.
---

# Extensão do VSCode

Painel dedicado com a árvore de arquivos monitorados, o status de cada um, o **motivo** de
ter rodado no tooltip, e o log completo de cada execução.

Instale pelo
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=livetest.livetest-vscode).

## O que faz

- **Árvore de arquivos** com status por arquivo: `idle`, `running`, `passed`, `failed`,
  `errored`, `skipped`. Diretórios herdam o pior status dos filhos, então uma falha lá no
  fundo aparece na raiz.
- **Motivo no tooltip.** Passe o mouse sobre um arquivo e veja *"rodou porque src/header.ts
  importa src/login.ts (1 nivel)"*.
- **Falhas como filhos** do arquivo na árvore, com a mensagem de assertion.
- **Diagnósticos no editor**, marcando os arquivos que falharam.
- **Canal de log** com o histórico de todos os lotes.
- **Barra de status** com o estado da conexão.

## Conexão

A extensão **não sobe o daemon sozinha**. Ela procura um em execução via
`.livetest/daemon.json` e:

- **encontrou**, conecta, recebe o snapshot completo e passa a receber os eventos ao vivo;
- **não encontrou**, mostra o botão **Iniciar daemon**, que abre um terminal com o comando
  configurado. A ação continua sendo sua.

Se o daemon cair, a extensão reconecta sozinha no intervalo configurado.

::: info Por que ela nunca sobe o daemon sozinha
Subir um processo de vida longa sem ser pedido é o tipo de coisa que surpreende alguém no
pior momento. O botão torna a decisão explícita, e o terminal que ele abre mostra
exatamente o que foi executado.
:::

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

## Independência do editor

O core roda inteiramente no terminal. A extensão é só uma camada de visualização, o que
significa que o fluxo com agente funciona com o editor fechado, e o painel é uma
conveniência, não um requisito.
