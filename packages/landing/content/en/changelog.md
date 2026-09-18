---
title: Changelog
description: Every released version of Live Test Runner, following Keep a Changelog and semantic versioning.
---

# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semantic
versioning.

## 0.1.0

The first release. It implements the MVP described in the product requirements document.

Published on npm as [`@livetest/core`](https://www.npmjs.com/package/@livetest/core) and
[`@livetest/cli`](https://www.npmjs.com/package/@livetest/cli), and on the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=livetest.livetest-vscode)
as `livetest-vscode`.

### Added: core

- Watcher with glob filtering and directory pruning before the recursive scan.
- Debounce engine with the three modes (`idle`, `batch`, `both`) and injectable timers.
- Dependency graph with reverse propagation by breadth-first search, safe with cycles and
  with per-file configurable depth.
- JS/TS graph adapter through the TypeScript compiler API: resolves `paths`, `baseUrl`,
  `index.*` and the `./x.js` to `./x.ts` mapping of ESM projects.
- Python graph adapter through the native `ast` module, falling back to regular
  expressions when no interpreter is available.
- Source to test mapping through templates with the `{dir}`, `{relDir}`, `{relDirTail}`,
  `{name}` and `{ext}` tokens.
- Runner adapters: Vitest, Jest (JSON report), pytest (JUnit XML) and a generic `command`
  adapter driven by exit code.
- Three simultaneous output channels: terminal report, append-only NDJSON log with
  rotation, and `status.json` with atomic writes.
- Event channel over loopback TCP with NDJSON, a snapshot on connect and a discovery file
  that tells a live daemon apart from an orphan record.
- A `@livetest/core/client` entry point carrying only the consumption surface.

### Added: CLI

- `start`, `run`, `why`, `status`, `watch`, `stop`, `init`, `doctor`.
- Stable, documented exit codes, suitable for CI.
- An embeddable `runCli` that returns the code instead of calling `process.exit`.

### Added: VSCode extension

- File tree with status, the run reason in the tooltip and failures as child nodes.
- Editor diagnostics, a log channel and a status bar item.
- Connection to an existing daemon with automatic reconnection, and a manual start button
  when there is no daemon. The extension never brings it up on its own.

### Added: documentation site

- Static site built with Vite, with no runtime dependencies.
- Animated terminal on the home page, staging a real daemon run, regression included.
- Interactive propagation demo: pick a depth and the graph recalculates the reached files,
  the traversed edges and the reason for each test, with the same breadth-first search the
  core runs.
- Syntax highlighting written in house, in around 120 tested lines, instead of a library.
- `prefers-reduced-motion` turns every animation off and delivers the complete page.

### Resolved open questions

The requirements document left four questions open. This version answers them:

- **Event channel protocol.** TCP on `127.0.0.1` with NDJSON, a port chosen by the
  operating system and a `.livetest/daemon.json` discovery file. Named pipes and Unix
  sockets would need two code paths; loopback TCP is identical on all three platforms.
- **Log format for AI.** Three levels of effort: a `LIVETEST key=value` line at the end of
  each batch, an always-current `status.json`, and the complete NDJSON log.
