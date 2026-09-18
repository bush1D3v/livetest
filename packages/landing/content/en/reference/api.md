---
title: Core API
description: The programmatic surface of @livetest/core: engine, config, graph, planner and the client entry point.
---

# Core API

`@livetest/core` is the engine: watcher, debounce, dependency graph, incremental test
execution and the three output channels. It is language agnostic and independent of both
the CLI and any editor.

```bash
npm install --save-dev @livetest/core
```

## Usage

```ts
import { createEngine, loadConfig } from '@livetest/core';

const { config, warnings } = await loadConfig({ cwd: process.cwd() });
for (const warning of warnings) console.warn(warning);

const engine = createEngine({ config });

engine.subscribe((event) => {
  if (event.type === 'batch.finished') {
    console.log(event.result.status, event.result.counts);
  }
});

await engine.start();
// ... the daemon runs until:
await engine.stop('shutting down');
```

## Two entry points

| Import | Contains | When to use it |
|---|---|---|
| `@livetest/core` | everything, including the engine | you **run** tests |
| `@livetest/core/client` | connection, discovery, types, formatting | you only **consume** events from a daemon |

The main index drags in the TypeScript compiler, used by the JS/TS graph. A consumer that
only reads events, such as an editor extension or a dashboard, should import from
`/client`: in the VSCode extension bundle that is the difference between 9 MB and 24 KB.

```ts
import { connectToDaemon, readDiscoveryFile } from '@livetest/core/client';
```

## Architecture

Every module does one thing and is testable in isolation.

| Module | Responsibility |
|---|---|
| `config/` | discovery, validation and normalization of the configuration |
| `watch/watcher.ts` | watches the disk (chokidar), applies the glob filters |
| `watch/debouncer.ts` | groups consecutive saves; injectable timers |
| `graph/` | dependency graph and reverse propagation; JS/TS and Python adapters |
| `testmap/` | maps source file to test file(s) through templates |
| `planner/` | decides what to run **and records why** |
| `runner/` | runs processes; Vitest, Jest, pytest and `command` adapters |
| `state/` | aggregates results and keeps the daemon snapshot |
| `report/` | terminal report, NDJSON log, `status.json` |
| `server/` | TCP event channel and daemon discovery |
| `events/bus.ts` | the single bus that feeds all three channels |
| `engine.ts` | orchestrates everything |

One principle runs through the code: **every path circulating through the core is absolute
and uses `/` as its separator**, on Windows included. Conversion to the native format
happens only at the boundary with the operating system.

## createEngine

`createEngine(options): LiveTestEngine`

```ts
interface LiveTestEngine {
  start(): Promise<EngineStartResult>;
  stop(reason?: string): Promise<void>;
  runFiles(files: readonly string[]): Promise<BatchResult>;
  flush(): void;
  snapshot(): DaemonSnapshot;
  subscribe(listener: (event: LiveTestEvent) => void): () => void;
  readonly config: ResolvedConfig;
  readonly graph: DependencyGraph;
  readonly resolver: TestFileResolver;
}
```

`graph` and `resolver` are exposed for diagnostics; they are what `livetest why` uses.

Third-party adapters come in here:

```ts
createEngine({
  config,
  graphAdapters: { go: (context) => createGoGraphAdapter(context) },
  runnerAdapters: { 'go-test': () => createGoTestAdapter() },
});
```

See [Writing an adapter](/guide/adapters).

## loadConfig

`loadConfig(options): Promise<LoadConfigResult>`

Searches upward from `cwd`, validates, merges the defaults and normalizes. Throws
`LiveTestError` with code `CONFIG_INVALID`, listing **all** the problems it found, not just
the first.

```ts
const { config } = await loadConfig({
  cwd: process.cwd(),
  overrides: { dependencyDepth: { default: 'transitive' } }, // CLI flags
});
```

## Dependency graph

```ts
const graph = createDependencyGraph({ adapters: [jsTsAdapter] });
await graph.index(files);

graph.impactedBy('/proj/src/login.ts', 1);
// [ { file: '.../login.ts',  depth: 0, chain: ['.../login.ts'] },
//   { file: '.../header.ts', depth: 1, chain: ['.../login.ts', '.../header.ts'] } ]
```

`chain` is the full import path. It is where the sentence *"ran because header.ts imports
login.ts"* comes from.

`impactedBy` accepts `Infinity` as a depth and is safe with cycles.

## Planning

```ts
const plan = planBatch({ config, graph, resolver, changedFiles });

plan.entries[0].reasons['/proj/src/header.test.ts'];
// [{ kind: 'importer', changedFile: '.../login.ts', sourceFile: '.../header.ts',
//    depth: 1, chain: [...] }]

summarizeReason(reason, config.root);
// 'ran because src/header.ts imports src/login.ts (1 level)'
```

`plan.unmatched` carries the saved files with no test, along with an explanation of where
the search looked.

## Consuming a daemon

```ts
import { connectToDaemon, readDiscoveryFile } from '@livetest/core/client';

const discovery = readDiscoveryFile('.livetest/daemon.json', root);
if (discovery.status === 'running') {
  const connection = await connectToDaemon({
    root,
    onEvent: (event) => { if (event.type === 'snapshot') render(event.state); },
    onClose: (reason) => reconnect(reason),
  });
}
```

The protocol is documented in [Event protocol](/reference/protocol).

## Errors

Everything the library throws deliberately is a `LiveTestError`, with a stable `code`:

| Code | Situation |
|---|---|
| `CONFIG_INVALID` | validation failed; `details` lists the problems |
| `CONFIG_NOT_FOUND` / `CONFIG_LOAD_FAILED` | file missing or unreadable |
| `DAEMON_NOT_RUNNING` | there is no daemon, offer to start one |
| `DAEMON_ALREADY_RUNNING` | `start()` called twice |
| `CONNECTION_FAILED` | the socket did not open, try again |

`error.format()` returns the message and details, ready for a terminal.

::: info Runtime failures do not throw
A broken adapter, a missing Python, a full disk: all of it becomes an `error` event with
`degradedTo`, and the daemon carries on. Robustness here means degrading, not disappearing.
:::
