---
title: How it works
description: The pipeline from a saved file to a test result, one isolated module per stage.
---

# How it works

Every stage is an isolated, tested module. The dependency graph and the test runner are
**pluggable adapters**: adding Go or Rust does not require touching the core.

```output
┌──────────────────────────── your project ────────────────────────────┐
│                                                                       │
│   file saved                                                          │
│        │                                                              │
│        ▼                                                              │
│   ┌─────────┐   ┌──────────┐   ┌────────────┐   ┌────────┐   ┌──────┐ │
│   │ Watcher │──▶│ Debounce │──▶│ Dep. graph │──▶│ Planner│──▶│Runner│ │
│   └─────────┘   └──────────┘   └────────────┘   └────────┘   └──┬───┘ │
│                  groups saves    who imports     what runs       │    │
│                  in a row        this file?      and why         │    │
│                                                                  ▼    │
│                                                          ┌──────────┐ │
│                                                          │Aggregator│ │
│                                                          └─┬──┬──┬──┘ │
│                     ┌──────────────────────────────────────┘  │  │    │
│                     ▼                    ▼                    ▼       │
│              ┌───────────┐       ┌────────────┐      ┌─────────────┐  │
│              │  stdout   │       │  run.log   │      │  TCP socket │  │
│              │  (agent)  │       │status.json │      │ (extension) │  │
│              └───────────┘       └────────────┘      └─────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

## Watcher

Watches the disk through chokidar and applies the glob filters. Directories are pruned
**before** the recursive scan descends into them, so `node_modules` never costs a walk.

Only files matching `watch` trigger anything. Everything else is invisible to the daemon.

## Debounce

Groups consecutive saves into a single batch. Three modes, covered in detail under
[`debounce`](/reference/config#debounce):

- **`idle`** fires after a period of silence. On its own it risks never firing during a
  long editing streak.
- **`batch`** fires a fixed window after the *first* save of the batch.
- **`both`**, the recommended default, fires on whichever comes first, which solves both
  problems.

## Dependency graph

Answers one question: *who imports this file?* The graph is built once, indexed, and
updated as files change. Reverse propagation is a breadth-first search over the import
edges, safe with cycles and bounded by the configured depth.

JS/TS goes through the TypeScript compiler API, so `paths`, `baseUrl`, `index.*` and the
ESM `./x.js` to `./x.ts` mapping all resolve the way the compiler resolves them. Python
goes through the native `ast` module, falling back to regular expressions when no
interpreter is available.

Writing an adapter for another language is covered in
[Writing an adapter](/guide/adapters).

## Planner

Decides what to run **and records why**. Each reached source file is mapped to its test
files by naming convention, and every selected test carries the import chain that put it
there.

This is where the two stages stay separate on purpose. Propagation runs over *import*
edges; mapping source to test happens afterwards. Collapsing them would give wrong
answers: `self` would run no test at all, because the test sits one hop away from the
source.

Files with no matching test come back in `unmatched`, along with the paths that were
searched.

## Runners

The core runs the process, which buys cancellation, timeouts, bounded output capture and
temporary-file cleanup for every adapter at once. The adapter only builds the command line
and interprets the output.

Built in: Vitest, Jest (JSON report), pytest (JUnit XML), and a generic `command` adapter
that judges by exit code.

## Aggregator

Consolidates the batch and publishes the same event sequence on three channels, in the
same order, with the same sequence number, because all three are just subscribers to one
internal bus. The format is described in [Event protocol](/reference/protocol).

Batch status aggregates the runs in this precedence:

```output
errored > cancelled > failed > passed > skipped
```

An infrastructure error ranks above a test failure because it demands a different action
from whoever reads it.
