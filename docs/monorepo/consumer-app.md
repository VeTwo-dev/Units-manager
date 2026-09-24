# Consumer App — `apps/nutrition-units-example`

An external-style consumer proving the **built** packages work through public
APIs only. Private (`private: true`, never published), depending on
`workspace:*` versions so it always exercises the current build.

## Structure

```text
apps/nutrition-units-example/
  package.json   deps: @vetwo/units, @vetwo/nutrition-units (workspace:*)
  tsconfig.json  extends base, noEmit (type gate)
  vitest.config.ts
  turbo.json     build outputs [] (type-only build)
  src/index.ts   runDemo() + tsx executable entrypoint
  tests/consumer.test.ts   package-name imports only
```

## What `runDemo()` exercises

1. Options-typed construction (`NutritionMeasurementOptions` with context +
   metadata; `NutritionSampleOptions` with id/context/measurements).
2. Range validation on the physical value.
3. Unit conversion (`mg/kg → g/kg`) and basis conversion (`asFed → dryMatter`).
4. Sample creation, set lookup (`getOrThrow`), JSON round-trip with equality.
5. Deterministic report + two handled failure modes
   (`MissingNutritionContextError`, `InvalidNutritionContextError`).

## Commands (run from repo root)

```sh
pnpm --filter @vetwo/nutrition-units-example start    # run the demo (tsx)
pnpm --filter @vetwo/nutrition-units-example verify  # types + lint + tests
```

Example output:

```text
sample consumer-demo-001 (2 measurements)
Ca 100.0 mg/kg asFed = 0.1 g/kg asFed
CP 9.0 % asFed = 10.0 % DM
round-trip ok
handled basis-without-context: MissingNutritionContextError
handled inconsistent-context: InvalidNutritionContextError
```

## Rules for extending it

- Import package names only — never relative `../../packages/...` paths
  (the test fails the point of the app otherwise).
- Always rebuild packages first (`turbo test dependsOn ^build` does this).
- Keep it dependency-free beyond the two libraries plus dev tooling.
