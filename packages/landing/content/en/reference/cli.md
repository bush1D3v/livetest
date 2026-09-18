---
title: CLI
description: Every livetest command, global flags, config overrides and exit codes.
---

# CLI

```bash
npm install --save-dev @livetest/cli
npx livetest init
npx livetest start
```

## livetest start

Brings the daemon up in the foreground: watches the project, runs the affected tests on
every save, writes `run.log` and `status.json`, and opens the event channel for the VSCode
extension. Stop it with `Ctrl+C`; the discovery file is removed on exit.

```bash
livetest start
livetest start --depth transitive --concurrency 4
livetest start --json --quiet     # NDJSON events on stdout, no human report
livetest start --no-server        # no event channel
livetest start --once             # runs everything once and exits
```

For an AI agent, this is the process to keep in the background.

## livetest run

`livetest run [files...]`

A single run. With no arguments, it runs the tests of everything being watched.

```bash
livetest run src/login.ts
livetest run src/a.ts src/b.ts --depth self
livetest run --dry-run            # shows the plan without running
```

It does not publish a discovery file: it is not a daemon and should not be found as one.

## livetest why

`livetest why <file>`

Explains what would run and why, **without running anything**. The command to reach for
when test selection surprises you.

```output
$ livetest why src/login.ts
file:       src/login.ts
runner:     js
depth:      transitive, file plus the full chain of importers  [override: src/login.ts]

impacted files (8):
  [0] src/login.ts
  [1] src/header.ts
  [2] src/layout.ts via src/header.ts

tests that would run (4):
  runner js:
    src/header.test.ts
      ran because src/header.ts imports src/login.ts (1 level)
```

It also lists the imports the graph could not resolve, which is the warning that
propagation may be incomplete in that file.

## livetest status

`livetest status [--json]`

Daemon state and the result of the last batch. It tries the event channel first, which is
always current, and falls back to `.livetest/status.json`, which survives shutdown.

## livetest watch

Follows a daemon that is already running, from a second terminal. When an agent started
the daemon in the background, this is how a person sees the same flow.

## livetest stop

`livetest stop [--force] [--timeout <ms>]`

Stops the daemon and **actually waits** for it to exit before removing the discovery
record. On Windows, `SIGTERM` kills the process without running its handlers, so the
cleanup has to happen here. It also detects and removes the orphan record of a daemon that
died without cleaning up. `--timeout` adjusts the wait (default 4000 ms).

## livetest init

`livetest init [--force] [--print]`

Creates a commented `livetest.config.json` at the root.

## livetest doctor

`livetest doctor [--json]`

Checks, in order, everything that can make the daemon "run nothing" without an obvious
message:

```output
[ok  ] config               /proj/livetest.config.json
[ok  ] node                 v22.14.0
[ok  ] watched files        214 file(s) matching "watch"
[warn] test coverage        38 file(s) without tests, e.g. src/types.ts, src/const.ts
[ok  ] runner "js"          vitest/2.1.9
[ERR ] runner "python"      pytest unavailable, exited with code 1: No module named pytest
```

## Global options

| Flag | Meaning |
|---|---|
| `-c, --config <path>` | explicit config file |
| `--root <path>` | project root |
| `--log-level <level>` | `debug`, `info`, `warn`, `error`, `silent` |
| `-h, --help` | help for the command |

## Config overrides

Accepted by `start`, `run` and `why`; they take priority over the file.

| Flag | Overrides |
|---|---|
| `-d, --depth <level>` | `dependencyDepth.default` (`self`, `direct`, `transitive` or a number) |
| `--dry-run` | `dryRun` |
| `--concurrency <n>` | `concurrency` |
| `--idle-ms <ms>` | `debounce.idleMs` |
| `--max-window-ms <ms>` | `debounce.maxBatchWindowMs` |
| `--json` | `output.format: "ndjson"` |
| `-q, --quiet` | `output.stdout: false` |
| `--no-color` | `output.color: false` |

## Exit codes

Stable and safe to use in scripts and CI:

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | tests failed |
| `2` | usage error, invalid command or flag |
| `3` | invalid configuration |
| `4` | daemon not found or unreachable |
| `70` | unexpected error |

```bash
npx livetest run src/login.ts && npm run build
```

## Programmatic API

The CLI is embeddable, which is useful in a build script or an editor plugin, with no
process to spawn:

```ts
import { runCli } from '@livetest/cli';

const exitCode = await runCli({
  argv: ['run', 'src/login.ts'],
  cwd: '/proj',
  output: {
    out: (line) => myLog.info(line),
    err: (line) => myLog.error(line),
  },
});
```

`runCli` **does not call `process.exit`**: it returns the code and leaves the decision to
the caller. That is what makes the whole CLI testable without a subprocess.
