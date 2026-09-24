# Benchmarks & Performance

## The benchmark suite

`packages/Units/src/conversion.bench.ts` (~660 lines, 30+ benches) measures
lookup, conversion (linear + affine + cached plans), parsing, quantity math,
formatter/serializer/guards, numerics, systems/packs, expressions, formulas,
measurements, statistics, profiles, and interop. It is benchmark-only
infrastructure: discovered by `vitest bench`, excluded from `dist` (tsup
entry is `src/index.ts`), and never imported by production code.

```sh
pnpm --filter @vetwo/units test:performance      # vitest bench --run
pnpm --filter @vetwo/units test:performance -- src/conversion.bench.ts
```

## Reading the numbers

Benches report hz/min/max/mean/p75/p99 — use them comparatively (before/after
a change on the same machine), never as absolute SLAs. No benchmark numbers
are claimed anywhere in these docs.

## Performance principles (verified mechanisms)

- `parseUnit` results and conversion plans are cached — reuse parsed `Unit`
  objects and compiled expressions in hot paths instead of re-parsing strings.
- `compileExpression` / `compileFormula` once, `evaluate` many contexts.
- Convert at the edges; keep rich objects through computation.
- Never bypass the engine with hand factors to "save" a conversion — the
  cache makes the engine call cheap and the manual factor a liability.
