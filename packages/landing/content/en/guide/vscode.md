---
title: VSCode extension
description: The visual panel: watched files, per-file status, the reason each test ran, and the full run log.
---

# VSCode extension

A dedicated panel with the tree of watched files, the status of each one, the **reason** it
ran in the tooltip, and the complete log of every run.

Install it from the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=livetest.livetest-vscode).

## What it does

- **File tree** with per-file status: `idle`, `running`, `passed`, `failed`, `errored`,
  `skipped`. Directories inherit the worst status of their children, so a failure buried
  deep shows up at the root.
- **Reason in the tooltip.** Hover a file and read *"ran because src/header.ts imports
  src/login.ts (1 level)"*.
- **Failures as children** of the file in the tree, with the assertion message.
- **Editor diagnostics**, marking the files that failed.
- **Log channel** with the history of every batch.
- **Status bar item** with the connection state.

## Connection

The extension **does not start the daemon on its own**. It looks for one already running
through `.livetest/daemon.json` and:

- **found it**, it connects, receives the full snapshot and starts receiving live events;
- **did not find it**, it shows the **Start daemon** button, which opens a terminal with
  the configured command. The action stays yours.

If the daemon goes down, the extension reconnects on its own at the configured interval.

::: info Why it never starts the daemon by itself
Starting a long-lived process without being asked is the kind of thing that surprises
someone at the worst moment. The button makes the decision explicit, and the terminal it
opens shows exactly what was run.
:::

## Commands

| Command | What it does |
|---|---|
| `Live Test: Connect to daemon` | forces a connection attempt |
| `Live Test: Start daemon` | opens a terminal with the configured command |
| `Live Test: Stop daemon` | sends `SIGTERM` to the daemon |
| `Live Test: Refresh` | redraws the tree |
| `Live Test: Open run log` | opens the log channel |
| `Live Test: Run tests for this file` | runs `livetest run` on the file |

## Settings

| Key | Default | Meaning |
|---|---|---|
| `livetest.discoveryFile` | `.livetest/daemon.json` | where to look for the daemon |
| `livetest.startCommand` | `npx livetest start` | command behind the "Start daemon" button |
| `livetest.reconnectIntervalMs` | `3000` | interval between reconnection attempts |
| `livetest.revealFailures` | `true` | mark failures in the editor |

## Independence from the editor

The core runs entirely in the terminal. The extension is a visualization layer only, which
means the agent flow works with the editor closed, and the panel is a convenience rather
than a requirement.
