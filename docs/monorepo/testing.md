# Testing Strategy

## Runners and layout

- **Vitest 4** in every workspace (`vitest.config.ts` includes
  `src/**/*.test.ts` + `tests/**/*.test.ts`, node environment, v8 coverage).
- Current scale: `@vetwo/units` 1409 tests (36 files),
  `@vetwo/nutrition-units` 314 tests (15 files), consumer app 4 tests.

## Test layers

| Layer       | Command                  | Purpose                                          |
| ----------- | ------------------------ | ------------------------------------------------ |
| Unit        | `test:unit`              | isolated module behavior                         |
| Integration | `test:integration`       | cross-module workflows (basis conversion, rules) |
| E2E / smoke | `test:e2e`, `test:smoke` | package-level journeys                           |
| Types       | `test:types`             | `tsc -p tsconfig.test.json` contract checks      |
| Browser     | `test:browser`           | browser-enabled run                              |
| Performance | `test:performance`       | `vitest bench --run` (see benchmarks.md)         |
| Coverage    | `coverage`               | v8 HTML/LCOV report (`coverage:open` views it)   |
| Debug       | `test:debug`             | `--inspect-brk` inspector session                |

`pnpm run test` executes the default `vitest run` suite; `pnpm run verify`
runs lint + format + types + tests + build as the merge gate.

## What good tests assert here

- Conversions against hand-derived values (including `°C↔K` offsets).
- Typed failures: `UnitMismatchError`, `ImpossibleConversionError`,
  `MissingNutritionContextError`, `InvalidNutritionContextError`.
- Round-trips: conversion (`a→b→a`), serialization (`toJSON→fromJSON→equals`).
- Semantic gates: incompatible nutrients rejected despite shared dimensions.
- Ambiguity behavior: duplicate collection entries → `undefined`/`AmbiguousMeasurementError`, never silent picks.
- Determinism: reports, canonical JSON, and built artifacts are byte-stable.

## Consumer-app testing

`apps/nutrition-units-example/tests/consumer.test.ts` imports **only package
names** (`@vetwo/units`, `@vetwo/nutrition-units`), proving the built `dist`
artifacts (not workspace sources) satisfy the public contracts. Always run it
after `build` (turbo `test` already `dependsOn: ^build`).
