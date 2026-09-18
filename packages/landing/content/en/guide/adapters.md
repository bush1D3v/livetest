---
title: Writing an adapter
description: Add support for a new language through the two extension points, or through no code at all.
---

# Writing an adapter

Adding a new language does not require touching the core. There are two independent
extension points, and you can implement just one of them.

| Adapter | Answers | Without it |
|---|---|---|
| **Dependency graph** | "who imports this file?" | files stay isolated; only their own test runs |
| **Test runner** | "how do I run these test files and read the result?" | use `adapter: "command"`, which judges by exit code |

The fastest path to a new language is **no code at all**: `adapter: "command"` plus
`testPatterns` covers the basics. A dedicated adapter is worth it when you want dependency
propagation or per-case results.

## No code: the `command` adapter

```jsonc
{
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
}
```

That already gives you the watcher, debounce, source-to-test mapping, incremental
execution and all three output channels. The only thing missing is dependency propagation.

## Dependency graph adapter

```ts
interface DependencyGraphAdapter {
  readonly id: string;
  readonly extensions: readonly string[];
  analyze(files: string[]): Promise<FileImports[]>;
  dispose?(): void | Promise<void>;
}

interface FileImports {
  file: string;         // absolute, POSIX separators
  imports: string[];    // PROJECT files it imports, absolute
  unresolved: string[]; // specifiers that did not resolve, become a warning
}
```

The core inverts that map and answers the reverse question. All you have to say is, for
each file, what it imports.

### The contract

1. **Never throw.** A file with a syntax error, or deleted between the event and the
   analysis, returns `{ imports: [], unresolved: [] }`. If `analyze` throws, the core
   degrades the whole group and emits an `error`. It works, but it is the bad path.
2. **Absolute paths, with `/`.** On Windows too. Use `normalizePath`.
3. **Project files only.** Discard installed dependencies: they have no tests in the
   project and would bloat the graph.
4. **Analyze the whole batch at once.** `analyze` receives a list precisely so you can run
   one process or one parse per batch, not one per file.
5. **Report what did not resolve.** Dynamic imports, dependency injection, reflection:
   putting them in `unresolved` makes the warning show up in `livetest why`, and the
   person understands why the graph is incomplete there.

### Example: Go

```ts
import { spawn } from 'node:child_process';
import type { DependencyGraphAdapter, GraphAdapterContext } from '@livetest/core';
import { normalizePath } from '@livetest/core';

export function createGoGraphAdapter(context: GraphAdapterContext): DependencyGraphAdapter {
  return {
    id: 'go',
    extensions: ['.go'],

    async analyze(files) {
      try {
        // A single `go list` for the whole batch.
        const output = await runGoList(files, context.root);
        return files.map((file) => ({
          file,
          imports: (output[file] ?? []).map((target) => normalizePath(target, context.root)),
          unresolved: [],
        }));
      } catch (error) {
        context.reportDegradation(
          'could not run `go list`',
          error instanceof Error ? error.message : String(error),
        );
        return files.map((file) => ({ file, imports: [], unresolved: [] }));
      }
    },
  };
}
```

`context` carries `root`, a pre-prefixed `logger`, `pythonPath` and `reportDegradation`.
Use that last one instead of throwing when something fails but the run can continue.

## Test runner adapter

Two pure functions: build the command, interpret the output. **The core runs the
process**, which gives you cancellation, timeouts, bounded output capture and cleanup of
temporary report files for free.

```ts
interface TestRunnerAdapter {
  readonly id: string;
  /** Extension of the temporary report, e.g. '.json'. `null` or absent if unused. */
  readonly reportFileExtension?: string | null;

  buildInvocation(
    testFiles: string[],
    context: RunnerAdapterContext,
    reportFile: string | null,
  ): RunnerInvocation;

  parseOutput(output: RunnerProcessOutput, context: RunnerAdapterContext): RunnerParseResult;
}
```

When `reportFileExtension` is set, the core creates a unique temporary path, hands it to
you in `reportFile` so you can pass it along to the runner (`--outputFile=...`), reads the
content into `output.reportContent`, and deletes the file afterwards, even if the run
failed.

### Interpreting the output

`parseOutput` **must never throw**. Handle the infrastructure cases before looking at the
report; the `interpretProcessFailure` helper does exactly that:

```ts
import { interpretProcessFailure } from '@livetest/core';

parseOutput(output) {
  // Covers cancellation, timeout and spawn failure.
  const failure = interpretProcessFailure(output);
  if (failure) return failure;

  if (!output.reportContent) {
    return output.exitCode === 0
      ? { status: 'passed', counts: empty, cases: [], error: null }
      : { status: 'errored', counts: empty, cases: [],
          error: `the runner produced no report (exit ${output.exitCode})` };
  }
  return interpretMyFormat(output.reportContent);
}
```

Distinguish **`failed`** (the test ran and failed, the user fixes the code) from
**`errored`** (it could not run, the user fixes the environment). Batch status precedence
depends on it.

### Example: Go

```ts
import type { TestRunnerAdapter } from '@livetest/core';
import { interpretProcessFailure } from '@livetest/core';

export function createGoTestAdapter(): TestRunnerAdapter {
  return {
    id: 'go-test',
    reportFileExtension: null, // `go test -json` writes to stdout

    buildInvocation(testFiles, context) {
      return {
        command: context.config.command ?? 'go',
        args: ['test', '-json', ...packagesOf(testFiles)],
        cwd: context.root,
        env: context.config.env ?? {},
        reportFile: null,
        timeoutMs: context.config.timeoutMs ?? 120_000,
      };
    },

    parseOutput(output) {
      const failure = interpretProcessFailure(output);
      if (failure) return failure;
      return interpretGoTestJson(output.stdout);
    },
  };
}
```

## Registering

```ts
import { createEngine, loadConfig } from '@livetest/core';

const { config } = await loadConfig({ cwd: process.cwd() });

const engine = createEngine({
  config,
  graphAdapters: { go: (context) => createGoGraphAdapter(context) },
  runnerAdapters: { 'go-test': () => createGoTestAdapter() },
});
```

And in the project config:

```jsonc
{
  "runners": {
    "go": {
      "adapter": "go-test",
      "graph": "go",
      "match": ["**/*.go"],
      "testMatch": ["**/*_test.go"],
      "testPatterns": ["{dir}/{name}_test.go"],
      "testExtensions": ["go"]
    }
  }
}
```

An unknown id does not bring the daemon down: it produces an `error` event explaining what
was left uncovered.

## Testing your adapter

`buildInvocation` and `parseOutput` are pure functions, so test them with no process at
all:

```ts
it('builds the command line', () => {
  const invocation = createGoTestAdapter().buildInvocation(['/proj/pkg/a_test.go'], context, null);
  expect(invocation.args).toEqual(['test', '-json', './pkg']);
});

it('reports a timeout as errored', () => {
  const result = createGoTestAdapter().parseOutput({ ...emptyOutput, timedOut: true }, context);
  expect(result.status).toBe('errored');
});
```

For the graph adapter, a temporary project on disk with a handful of files is enough. See
`packages/core/test/graph/` for the pattern used by the built-in adapters.
