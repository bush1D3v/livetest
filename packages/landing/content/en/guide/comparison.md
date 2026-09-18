---
title: Comparison
description: Where livetest differs from vitest --watch, Wallaby.js and pytest-watch, and where those tools are right too.
---

# Comparison

Similar tools exist. None of them does quite this.

| Capability | livetest | jest/vitest --watch | Wallaby.js | pytest-watch |
|---|---|---|---|---|
| Propagates through the dependency graph | yes | yes | yes | no |
| Per-file configurable depth | yes | no | no | no |
| Output designed for an AI agent | yes | no | no | no |
| Explains why each test ran | yes | no | partial | no |
| JS/TS and Python in the same daemon | yes | no | no | no |
| Works with the editor closed | yes | yes | no | yes |

## What the others get right

`vitest --watch` is excellent inside its ecosystem, and its graph comes free from the
bundler, which makes it faster to index than ours. If your project is pure JS/TS and you
work alone in the terminal, it may be all you need.

Wallaby.js is still the best inline experience there is. Results next to the line of code,
as you type, is something a daemon publishing to a socket does not reproduce.

`pytest-watch` is simple and does what it promises. The fixed scope is a deliberate choice,
not an oversight.

## Where livetest differs

**The output was designed to be read by a program.** Every batch ends with a
`key=value` line, there is an atomically written `status.json`, and an append-only NDJSON
log. No other tool in the table treats a program as a first-class reader.

**Depth is a setting, not a rule.** A widely imported, stable utility can be pinned to
`self` so it does not drag the suite along; a critical file can be pinned to `transitive`.
Per file, through globs. See [Propagation depth](/guide/depth).

**Every selection carries its reason.** Not a list of files, a list of files with the
import chain that justifies each one. This is what turns a surprising result into a
readable one.

**One daemon, more than one language.** A project with a TypeScript front end and a Python
back end gets one watcher, one debounce and one report.

## When not to use it

If your suite runs in under two seconds in full, propagation by graph buys you nothing;
run everything. If your project is pure JS/TS, you have no AI agent in the loop and you
live inside the editor, Wallaby.js gives a tighter experience. Being honest about this is
cheaper than having you find out after the install.
