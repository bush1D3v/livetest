---
title: Getting started
description: Install livetest as a devDependency, check your environment with doctor, and leave the daemon watching.
---

# Getting started

## Install

```bash
$ npm install --save-dev @livetest/cli
```

The package is published on npm as
[`@livetest/cli`](https://www.npmjs.com/package/@livetest/cli). It brings
[`@livetest/core`](https://www.npmjs.com/package/@livetest/core) with it, so you do not
need to install both.

## Create a config file

```bash
$ npx livetest init
```

This writes a commented `livetest.config.json` at the root. The step is **optional**: with
no config at all, the daemon already works on JS/TS or Python projects with a conventional
layout. The file exists for when you want fine control, which is covered in
[Configuration](/reference/config).

## Check the environment

```bash
$ npx livetest doctor
```

`doctor` checks, in order, everything that can make the daemon "run nothing" without an
obvious message:

```output
[ok  ] config               /proj/livetest.config.json
[ok  ] node                 v22.14.0
[ok  ] watched files        214 file(s) matching "watch"
[warn] test coverage        38 file(s) without tests, e.g. src/types.ts, src/const.ts
[ok  ] runner "js"          vitest/2.1.9
[ERR ] runner "python"      pytest unavailable, exited with code 1: No module named pytest
```

Run it before you spend time debugging silence.

## Start watching

```bash
$ npx livetest start
```

From here on, every file you save triggers the relevant tests. Stop with `Ctrl+C`: the
discovery file is removed on the way out.

For an AI agent, put it in the background and read the `LIVETEST` line at the end of each
batch:

```bash
npx livetest start > .livetest/daemon.out 2>&1 &
```

The full guide for that flow is in [AI agents](/guide/ai-agents).

## See what would run, without running it

```bash
$ npx livetest why src/login.ts
```

```output
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

Useful in two moments: to size up the impact of a change before making it, and to
understand why a test you did not expect ran, or did not.

## A one-off run, no daemon

`livetest run` performs a single run and returns **exit code 1** when a test fails, which
chains straight into a shell `&&` or a pre-commit hook:

```bash
npx livetest run src/login.ts && echo "safe to continue"
```

## Example projects

The repository ships two ready-to-try projects under `examples/`: `demo-js` (Vitest) and
`demo-python` (pytest). Both wire up the `login → header/footer → layout` chain that
exercises transitive propagation.

::: tip Next step
[Propagation depth](/guide/depth) is the one setting worth understanding before any other.
:::
