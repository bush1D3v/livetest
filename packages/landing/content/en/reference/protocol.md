---
title: Event protocol
description: The event format published on stdout, on the NDJSON log and on the TCP socket, plus daemon discovery.
---

# Event protocol

The daemon publishes the same sequence of events on three channels. All three see the same
objects, in the same order, with the same sequence number, because all three are just
subscribers to a single internal bus.

| Channel | Format | Typical consumer |
|---|---|---|
| stdout | formatted text (`pretty`) or NDJSON | AI agent, person at the terminal |
| `output.logFile` | append-only NDJSON | history, later analysis |
| TCP socket | NDJSON | VSCode extension, dashboards |

## Design decisions

**TCP on loopback, not a named pipe or a Unix socket.** Windows named pipes and Unix
sockets would need two code paths and two discovery mechanisms. TCP on `127.0.0.1` is
identical on all three platforms.

**Port `0` by default.** The OS picks a free port and the real number goes into the
discovery file. Two projects open at the same time do not collide.

**NDJSON, not a binary protocol.** One event per line is debuggable with `nc` or `tail -f`,
and any language can consume it without a library.

**A snapshot on connect.** The first event a client receives is always a `snapshot` with
the complete state. The UI renders immediately, without waiting for the next batch.

## Discovery

The daemon publishes `.livetest/daemon.json` on startup and **removes it on a clean
shutdown**:

```json
{
  "pid": 12345,
  "host": "127.0.0.1",
  "port": 51734,
  "root": "/home/ana/project",
  "version": "0.1.0",
  "protocolVersion": 1,
  "startedAt": 1730000000000
}
```

A file can be left orphaned if the daemon dies abruptly. That is why reading it always
checks whether the process still exists, classifying into four states:

| State | Meaning |
|---|---|
| `running` | the file exists and the pid is alive |
| `stale` | the file exists but the pid is gone, an orphan record |
| `absent` | there is no file |
| `invalid` | broken JSON or missing fields |

```ts
import { readDiscoveryFile } from '@livetest/core/client';

const result = readDiscoveryFile('.livetest/daemon.json', root);
if (result.status === 'running') connect(result.info.host, result.info.port);
```

## Framing

Each event is a JSON object on one line, terminated by `\n`. A large event can arrive split
across several TCP packets, so accumulate until you find a `\n`. The core ships the
splitter (`createLineSplitter`), and `connectToDaemon` handles it for you.

## Common fields

Every event carries:

| Field | Type | Meaning |
|---|---|---|
| `type` | `string` | discriminant of the union |
| `seq` | `number` | monotonic sequence, starting at 1 |
| `timestamp` | `number` | epoch in milliseconds |

::: info seq 0 is not part of the sequence
The `snapshot` sent on connect uses `seq: 0`. It is not part of the live event sequence, it
is the state that precedes it.
:::

**Consumers must ignore unknown `type` values.** The protocol is additive: new events and
new fields appear without bumping `protocolVersion`, which only changes on an incompatible
alteration.

## Events

### daemon.started and daemon.stopped

```json
{ "type": "daemon.started", "seq": 1, "timestamp": 1730000000000,
  "pid": 12345, "root": "/proj", "version": "0.1.0", "protocolVersion": 1,
  "server": { "host": "127.0.0.1", "port": 51734 },
  "configPath": "/proj/livetest.config.json", "indexedFiles": 214 }
```

`server` is `null` when the channel is disabled or could not be opened.

### watch.change

A watched file changed. `kind` is `"add"`, `"change"` or `"unlink"`.

### batch.started

The debounce closed the batch and the plan was computed. **This is where the transparency
lives**: `plan[].reasons` explains, per test file, why it was included.

```json
{ "type": "batch.started", "seq": 8, "timestamp": 1730000001000,
  "batchId": "batch-3",
  "changedFiles": ["/proj/src/login.ts"],
  "trigger": "idle",
  "plan": [{
    "runnerKey": "js", "adapterId": "vitest",
    "testFiles": ["/proj/src/header.test.ts"],
    "reasons": {
      "/proj/src/header.test.ts": [{
        "kind": "importer",
        "changedFile": "/proj/src/login.ts",
        "sourceFile": "/proj/src/header.ts",
        "depth": 1,
        "chain": ["/proj/src/login.ts", "/proj/src/header.ts"]
      }]
    }
  }],
  "unmatched": [] }
```

`trigger` is `"idle"`, `"maxWindow"` or `"manual"`. `unmatched` lists saved files with no
matching test, with the explanation.

In `SelectionReason`, `kind` is `"changed"` (the saved file itself), `"importer"` (reached
through the graph) or `"manual"`. `chain` is the full import path, from the saved file to
the file the test covers.

### run.started and run.finished

`run.finished` carries the complete `TestRunResult`: the command that ran, counts,
individual cases with failure messages, `stdoutTail` and `stderrTail`, and the selection
reasons.

A run's `status` is `passed`, `failed`, `errored` (could not run: missing binary, timeout,
invalid config), `skipped` (nothing to run, or `dryRun`) or `cancelled` (a new batch made
this one obsolete).

### batch.finished

Consolidates the batch. Its status aggregates the runs, in this precedence:

```output
errored > cancelled > failed > passed > skipped
```

An infrastructure error ranks above a test failure because it demands a different action
from whoever reads it.

### error

Safe degradation. The daemon **keeps running**.

```json
{ "type": "error", "seq": 4, "timestamp": 1730000000500,
  "scope": "graph:python",
  "message": "Python interpreter unavailable (\"python3\")",
  "detail": "spawn python3 ENOENT",
  "degradedTo": "the Python graph falls back to regular expression analysis" }
```

`degradedTo` says what took over. It is the robustness requirement made observable.

### snapshot

Socket only, as the first event of every connection. Contains `DaemonSnapshot`: daemon
metadata, `running`, the complete `lastBatch`, per-file state (`files`) and accumulated
counters (`totals`).

## Consuming the channel

```ts
import { connectToDaemon } from '@livetest/core/client';

const connection = await connectToDaemon({
  root: '/proj',
  onEvent: (event) => {
    if (event.type === 'snapshot') renderEverything(event.state);
    if (event.type === 'batch.finished') update(event.result);
  },
  onClose: (reason) => reconnectLater(reason),
});
```

`connectToDaemon` throws `LiveTestError` with code `DAEMON_NOT_RUNNING` (there is no
daemon) or `CONNECTION_FAILED` (the socket did not open). Telling those apart matters: the
first means "offer the start button", the second means "try again".

Without TypeScript, the channel is just a socket of lines:

```bash
PORT=$(jq -r .port .livetest/daemon.json)
nc 127.0.0.1 "$PORT" | jq -c 'select(.type == "batch.finished") | .result.status'
```
