---
title: Propagation depth
description: Decide per file how far through the reverse dependency graph a run propagates, and see it happen.
---

# Propagation depth

This is the central setting. For each file you decide how far the run propagates through
the **reverse** graph, meaning through the files that import it.

| Value | Hops | Meaning |
|---|---|---|
| `"self"` | 0 | only the tests of the changed file |
| `"direct"` | 1 | the file **plus whoever imports it directly** (default) |
| `"transitive"` | ∞ | the file plus **the whole chain** of importers |
| `n` | n | an exact numeric depth |

## Try it

Pick a depth and see, right now, what would happen when `login.ts` is saved. This runs the
same breadth-first search the daemon runs.

<div class="grafo" data-reveal>
<div class="grafo__controles" role="tablist" aria-label="Propagation depth">
<button class="grafo__btn" type="button" role="tab" data-depth="self"><span class="grafo__btn-nome">self</span><span class="grafo__btn-dica">the file only</span></button>
<button class="grafo__btn" type="button" role="tab" data-depth="direct" aria-selected="true"><span class="grafo__btn-nome">direct</span><span class="grafo__btn-dica">plus direct importers</span></button>
<button class="grafo__btn" type="button" role="tab" data-depth="transitive"><span class="grafo__btn-nome">transitive</span><span class="grafo__btn-dica">plus the whole chain</span></button>
</div>
<div class="grafo__palco">
<svg class="grafo__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g data-graph-edges></g></svg>
<div class="grafo__nos" data-graph-nodes></div>
</div>
<div class="grafo__painel">
<div class="grafo__resultado"><p class="grafo__legenda" data-graph-caption></p><ul class="grafo__testes" data-graph-tests></ul></div>
<div class="grafo__config"><p class="grafo__config-titulo">The rule that produces this</p><pre class="code-block"><code data-graph-config></code></pre></div>
</div>
</div>

Notice that `self` still runs a test. Propagation walks *import* edges; mapping a source
file to its test file happens afterwards, by naming convention. Collapsing the two stages
would make `self` run nothing at all, because the test sits one hop away from the source.

## Configuring it

```jsonc
{
  "dependencyDepth": {
    "default": "direct",
    "overrides": {
      "src/util/**": "self",                   // stable utility: does not propagate
      "src/components/Login.tsx": "transitive"  // critical: propagates all the way
    }
  }
}
```

Overrides are evaluated **in declaration order, and the last match wins**, which lets you
write a broad rule followed by exceptions:

```jsonc
"overrides": {
  "src/**": "self",                         // general rule
  "src/components/Login.tsx": "transitive"  // exception
}
```

## Choosing a value

**Too many tests running (slow).** A file imported by half the project, like a types
module or a constants file, drags the whole suite along on every save. Pin it to `"self"`.

**Too few tests running (regressions slip through).** A file whose breakage shows up only
in its consumers, typically authentication, routing or serialization, deserves
`"transitive"`.

**Not sure.** Leave `"direct"`. It is the default because it catches the common case, the
importer that broke, without paying for the full chain.

## Checking before you commit to it

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
  ...
```

You can also try a depth without editing the config file:

```bash
npx livetest run src/login.ts --depth transitive
npx livetest why src/login.ts --depth self
```

::: warning The graph is not omniscient
Dynamic imports with a computed expression, dependency injection and reflection do not
appear in the graph. `livetest why` warns about the specifiers it could not resolve. In
those files, consider a larger depth or run the full suite before concluding all is well.
:::
