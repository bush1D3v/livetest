---
title: Configuration
description: Every field of livetest.config.json, with defaults, examples and the reasoning behind each one.
---

# Configuration

Live Test Runner looks upward from the current directory for the first file with one of
these names:

1. `livetest.config.json`
2. `livetest.config.mjs`
3. `livetest.config.js`
4. `livetest.config.cjs`
5. `.livetestrc.json`

The directory of the file it finds becomes the **project root**, and every glob and
relative path resolves from there. With no file at all, the defaults are used and the root
is the current directory.

`.json` files accept `//` and `/* */` comments, which are stripped before parsing.
`.js`, `.mjs` and `.cjs` modules must export the config as `default`.

Generate a commented file with `npx livetest init`.

## A complete example

```jsonc
{
  "$schema": "./node_modules/@livetest/core/livetest.config.schema.json",

  "watch": ["src/**/*.ts", "src/**/*.tsx", "app/**/*.py"],
  "ignore": ["**/generated/**"],
  "useGitignore": true,

  "dependencyDepth": {
    "default": "direct",
    "overrides": {
      "src/util/**": "self",
      "src/components/Login.tsx": "transitive"
    }
  },

  "debounce": { "mode": "both", "idleMs": 400, "maxBatchWindowMs": 3000 },

  "runners": {
    "js": { "adapter": "vitest", "match": ["src/**/*.{ts,tsx}"] },
    "python": { "adapter": "pytest", "match": ["app/**/*.py"] }
  },

  "output": {
    "logFile": ".livetest/run.log",
    "statusFile": ".livetest/status.json",
    "stdout": true,
    "format": "pretty",
    "color": "auto",
    "logTailLines": 40
  },

  "server": { "enabled": true, "host": "127.0.0.1", "port": 0 },

  "concurrency": 2,
  "pythonPath": "python3",
  "logLevel": "info"
}
```

## watch

`string[]`. Globs of the files being watched. A file outside this list never triggers
anything.

*Default:* `["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs", "**/*.py"]`

## ignore

`string[]`. Globs **added to** the default ignores (`node_modules`, `dist`, `build`,
`coverage`, `__pycache__`, `.venv`, `.livetest`, among others) and to `.gitignore`. They
apply to directories too, which prunes the scan before it descends into them.

## useGitignore

`boolean`. Reads the root `.gitignore` and converts its rules into exclusion globs.
Negations (`!pattern`) are **not** supported and produce a warning.

*Default:* `true`

## dependencyDepth

How deep into the **reverse** dependency graph a run propagates.

```ts
{ default: "self" | "direct" | "transitive" | number,
  overrides: Record<glob, "self" | "direct" | "transitive" | number> }
```

| Value | Hops | Meaning |
|---|---|---|
| `"self"` | 0 | only the tests of the changed file |
| `"direct"` | 1 | the file plus whoever imports it directly |
| `"transitive"` | ∞ | the file plus the whole chain of importers |
| `n` | n | an exact numeric depth |

The `overrides` are evaluated **in declaration order, and the last match wins**, which
lets you write a broad rule followed by exceptions:

```jsonc
"overrides": {
  "src/**": "self",                         // general rule
  "src/components/Login.tsx": "transitive"  // exception
}
```

*Default:* `{ "default": "direct", "overrides": {} }`

There is a longer treatment, with an interactive demo, in
[Propagation depth](/guide/depth).

## debounce

Grouping of consecutive saves.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `mode` | `"idle"`, `"batch"` or `"both"` | `"both"` | strategy |
| `idleMs` | `number` | `400` | silence required before firing |
| `maxBatchWindowMs` | `number` | `3000` | ceiling from the first save of the batch |

- **`idle`** fires after `idleMs` with no new saves. On its own it risks never firing
  during a long editing streak.
- **`batch`** fires `maxBatchWindowMs` after the *first* save of the batch.
- **`both`** (recommended) fires on whichever comes first. It solves both problems.

## runners

One object per language or framework. The key is free (`"js"`, `"python"`, `"go"`) and
shows up in the reports.

| Field | Type | Meaning |
|---|---|---|
| `adapter` | `"vitest"`, `"jest"`, `"pytest"` or `"command"` | how to build the command and read the output |
| `match` | `string[]` | globs of the source files it serves |
| `command` | `string` | executable; required for `adapter: "command"` |
| `args` | `string[]` | fixed arguments, before the test files |
| `env` | `Record<string,string>` | extra process variables |
| `timeoutMs` | `number` | timeout of one run (default `120000`) |
| `cwd` | `string` | working directory, relative to the root |
| `graph` | `"js-ts"` or `"python"` | graph adapter used for these files |
| `testPatterns` | `string[]` | path templates for the test file |
| `testMatch` | `string[]` | globs marking a file as being itself a test |
| `testExtensions` | `string[]` | extensions tried when expanding `{ext}` |

::: info Declaring runners restricts them
Declaring `runners` **restricts** the daemon to the runners you declared. For `"js"` and
`"python"`, whatever you write is merged over the built-in base, so
`{"js": {"adapter": "jest"}}` keeps `match`, `testPatterns` and the rest.
:::

### Test file templates

`testPatterns` says where to look for the test of a source file. Tokens:

| Token | Value for `src/util/date.ts` (root `/proj`) |
|---|---|
| `{dir}` | `/proj/src/util` |
| `{relDir}` | `src/util` |
| `{relDirTail}` | `util` (`{relDir}` without its first segment) |
| `{name}` | `date` |
| `{ext}` | expanded over `testExtensions` |

Templates that do **not** start with `{dir}` resolve from the root, which covers the
top-level `tests/` layout. Slashes doubled by empty tokens are collapsed.

Default for JS/TS:

```output
{dir}/{name}.test.{ext}          {dir}/__tests__/{name}.test.{ext}
{dir}/{name}.spec.{ext}          {dir}/__tests__/{name}.spec.{ext}
test/{relDir}/{name}.test.{ext}  test/{relDirTail}/{name}.test.{ext}
tests/{relDir}/{name}.test.{ext} tests/{relDirTail}/{name}.test.{ext}
```

Default for Python:

```output
{dir}/test_{name}.py           {dir}/{name}_test.py         {dir}/tests/test_{name}.py
tests/{relDir}/test_{name}.py  tests/{relDirTail}/test_{name}.py  tests/test_{name}.py
```

To check what is being searched in a concrete case, run `livetest why <file>`.

### The command adapter

The way in for any language without a dedicated adapter. The command receives the test
files as its final arguments and the result comes from the **exit code**, with no
individual cases.

```jsonc
"runners": {
  "go": {
    "adapter": "command",
    "command": "go",
    "args": ["test"],
    "match": ["**/*.go"],
    "testMatch": ["**/*_test.go"],
    "testPatterns": ["{dir}/{name}_test.go"],
    "testExtensions": ["go"]
  }
}
```

## output

| Field | Type | Default | Meaning |
|---|---|---|---|
| `logFile` | `string` or `null` | `".livetest/run.log"` | append-only NDJSON log; rotates at 5 MB |
| `statusFile` | `string` or `null` | `".livetest/status.json"` | state snapshot, written atomically |
| `stdout` | `boolean` | `true` | emit the report on stdout |
| `format` | `"pretty"` or `"ndjson"` | `"pretty"` | stdout format |
| `color` | `boolean` or `"auto"` | `"auto"` | `"auto"` respects TTY, `NO_COLOR` and `FORCE_COLOR` |
| `logTailLines` | `number` | `40` | lines of stdout/stderr kept per run |

## server

The event channel the VSCode extension consumes.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | `boolean` | `true` | turns the channel on |
| `host` | `string` | `"127.0.0.1"` | keep it on loopback |
| `port` | `number` | `0` | `0` lets the OS choose, which avoids collisions between projects |
| `discoveryFile` | `string` | `".livetest/daemon.json"` | where the daemon publishes pid, host and port |

If the port cannot be opened the daemon **does not abort**: it emits a warning and carries
on with stdout and the file log. See [Event protocol](/reference/protocol).

## Remaining fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `root` | `string` | dir. of the config file | project root |
| `concurrency` | `number` | `2` | simultaneous test runs |
| `dryRun` | `boolean` | `false` | builds and logs the plan without running anything |
| `pythonPath` | `string` | `python3` (`python` on Windows) | interpreter used by the graph and by pytest |
| `logLevel` | `"debug"`, `"info"`, `"warn"`, `"error"` or `"silent"` | `"info"` | internal logs, always on stderr |

## Command line overrides

Flags take priority over the file:

```bash
livetest start --depth transitive --concurrency 4 --idle-ms 150
livetest run src/a.ts --dry-run
livetest start --json --quiet          # NDJSON events, no human report
livetest start --no-server             # no event channel
```

The full list is in the [CLI reference](/reference/cli).

## Validation

The config is validated on load, with the exact path of the invalid field:

```output
$ livetest start
Invalid configuration at /proj/livetest.config.json
  - runners.js.timeoutMs must be a number greater than 0.
  - debounce.idleMs cannot be greater than debounce.maxBatchWindowMs.
```

Unknown fields produce a warning, not an error, so configs from future versions do not
break older ones. `livetest doctor` runs the same validation and also checks that the
runner binaries exist.
