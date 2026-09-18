---
title: What is livetest
description: A test runner that watches your project, works out which tests a change affects through the dependency graph, and explains why each one ran.
---

# What is livetest

Live Test Runner is a development tool you install as a `devDependency`. It watches your
project, resolves which tests a change affects using the **dependency graph**, and runs
only that subset, publishing the result on three channels at the same time: the terminal
(for an AI agent), a structured log (for any tool), and a panel inside VSCode (for you).

```output
$ livetest start

livetest batch-3 (idle) src/login.ts
  js -> 4 test file(s)
    src/footer.test.ts  ran because src/footer.ts imports src/login.ts (1 level)
    src/header.test.ts  ran because src/header.ts imports src/login.ts (1 level)
    src/layout.test.ts  ran because src/layout.ts imports src/login.ts via src/header.ts (2 levels)
    src/login.test.ts   ran because src/login.ts changed
  PASSED js  4 file(s)  5 passed  0 failed  0 skipped  1.5s
  batch-3 PASSED in 1.6s
LIVETEST batch=batch-3 status=passed files=4 tests=5 passed=5 failed=0 skipped=0 duration=1.6s
```

## Why it exists

Two recurring problems, both worse when the code is being written by an AI agent.

### Late detection

The real cycle is *edit, edit, edit, and only then test*. By the time the tests finally
run, several changes have piled up, and isolating the one that broke something is
expensive. An agent, meanwhile, has already taken half a dozen steps on top of a wrong
assumption.

### Underestimated scope

Tools and agents tend to run only the tests of the file that changed, ignoring whatever
**depends** on it. `login.ts` breaks, but the ones reporting it are the tests of
`header.ts` and `footer.ts`, which nobody ran. The regression slips through.

## The difference

Live Test Runner is designed from the root for **two simultaneous consumers**: the agent,
which needs to know *immediately* whether something broke, and the person, who wants to
see it in the editor. On top of that it gives you **configurable, per-file control of how
deep** the run propagates through the graph.

| Tool | What it does | Limitation |
|---|---|---|
| `jest`/`vitest --watch` | Runs affected tests through the bundler graph | Tied to the JS ecosystem; output was not designed for an AI agent to read |
| Wallaby.js | Live execution, inline in the editor | Focused on human UX inside the editor |
| `pytest-watch` | Re-runs on save | No notion of a dependency graph; runs a fixed scope |

There is a fuller breakdown in [Comparison](/guide/comparison).

## What you get

- **A real dependency graph.** JS/TS through the TypeScript compiler API, resolving
  `paths`, `baseUrl`, `index.*` and the `./x.js` to `./x.ts` mapping of ESM projects.
  Python through the native `ast` module, with relative and absolute imports.
- **Every selection explained.** No test runs without an import chain attached to justify
  it. `livetest why src/login.ts` prints the whole path before you change anything.
- **Three output channels at once.** A grepable summary line, an atomically written
  `status.json` snapshot, and an append-only NDJSON log with the full history.
- **Safe degradation.** Python missing, adapter broken, port unavailable: the daemon emits
  an `error` event saying what took over and keeps running.

## Requirements

Node.js 18.18 or newer. For Python projects, a 3.8+ interpreter on your `PATH`.

::: tip Next step
[Getting started](/guide/getting-started) takes three commands and about thirty seconds.
:::
