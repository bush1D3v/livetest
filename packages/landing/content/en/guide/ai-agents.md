---
title: AI agents
description: How an agent consumes livetest output, from a single grepable line to the full NDJSON event log.
---

# AI agents

This page is written for the agent, Claude Code, Cursor or any other, editing code in a
project with Live Test Runner installed.

## The problem this solves for you

Your natural cycle is *edit, edit, edit, run the tests at the end*. That costs two things:
by the time the tests finally run several changes have piled up and isolating the one that
broke something is expensive; and you tend to run only the tests of the file you touched,
ignoring what depends on it.

With the daemon running, every save triggers the tests of the file **and of its
importers**, and the result arrives in seconds.

## Quick start

```bash
npx livetest start > .livetest/daemon.out 2>&1 &
```

Once, at the start of the session. From there on, every file you save triggers the
relevant tests automatically.

## Reading the result

### Option 1: the summary line (cheapest)

Every batch conclusion ends with a line of `key=value` fields:

```output
LIVETEST batch=batch-7 status=failed files=3 tests=12 passed=10 failed=2 skipped=0 duration=1.4s
```

```bash
grep '^LIVETEST' .livetest/daemon.out | tail -1
```

`status` is `passed`, `failed`, `errored`, `skipped` or `cancelled`.

### Option 2: the snapshot (current state)

```bash
npx livetest status
```

```output
source:    daemon running
root:      /proj
running:   no
totals:    7 batch(es), 9 run(s), 2 failing

last batch: batch-7, failed in 1421ms
  tests: 12 (10 passed, 2 failed, 0 skipped)
  x header > greets the authenticated user
  x layout > wraps the header
```

`npx livetest status --json` returns the full snapshot. The file `.livetest/status.json`
holds the same content and is written atomically, so it can be polled in a loop with no
risk of reading half a JSON document.

### Option 3: the event log (full history)

`.livetest/run.log` is NDJSON, one event per line:

```bash
tail -5 .livetest/run.log | jq -c 'select(.type=="batch.finished") | .result.status'
```

The format is documented in [Event protocol](/reference/protocol).

## A one-off run, no daemon

If you would rather control when to test, `livetest run` performs a single run and returns
**exit code 1** when a test fails:

```bash
npx livetest run src/login.ts && echo "safe to continue"
```

That chains straight into `&&`, which is usually more reliable than parsing text.

## Before editing: see what will run

```bash
npx livetest why src/login.ts
```

Useful in two moments: to size up the impact of a change before making it, and to
understand why a test you did not expect ran, or did not.

## Reading the statuses

| Status | What it means | What to do |
|---|---|---|
| `passed` | everything passed | carry on |
| `failed` | a test ran and failed | **fix the code** |
| `errored` | the runner could not run | **fix the environment**: missing binary, timeout, invalid config |
| `skipped` | nothing to run, or `dryRun` | probably a missing test file |
| `cancelled` | a new save made this batch obsolete | wait for the next result |

The distinction between `failed` and `errored` is deliberate and it matters to you: one
requires changing code, the other requires changing the environment.

## Traps

**A batch cancels the previous one.** Saving during a run cancels the one in flight.
`cancelled` is not a failure, it means "something new arrived, wait for the next one".

**`skipped` usually means a missing test.** When a file has no matching test, the batch
carries `unmatched` with the paths that were searched:

```output
no test  src/orphan.ts: no test file found
         (depth "direct" = file plus direct importers;
          searched, among others: src/orphan.test.ts, src/orphan.spec.ts)
```

If a test was meant to exist, create one at any of the listed paths.

**The graph can be incomplete.** Dynamic imports with an expression, dependency injection
and reflection do not show up. `livetest why` warns:

```output
unresolved imports (the graph may be incomplete here):
  <dynamic import with non-literal expression>
```

In those files, consider a larger `dependencyDepth` or run the full suite before
concluding all is well.

**The daemon degrades instead of dying.** If Python disappears or an adapter fails, you
get an `error` event with `degradedTo` explaining what took over. The tool keeps working,
with less precision. Those warnings are worth reading.

## Tuning propagation

If tests are running too much (slow) or too little (missed regressions), adjust the depth
per file in `livetest.config.json`:

```jsonc
{
  "dependencyDepth": {
    "default": "direct",
    "overrides": {
      "src/util/**": "self",           // stable, widely imported utility
      "src/core/auth.ts": "transitive" // critical: any breakage matters
    }
  }
}
```

Or try it without editing a file:

```bash
npx livetest run src/login.ts --depth transitive
npx livetest why src/login.ts --depth self
```

## Shutting down

```bash
npx livetest stop
```

Removes `.livetest/daemon.json` and frees the port. If the process died without cleaning
up, `livetest stop` detects the orphan record and removes it.
