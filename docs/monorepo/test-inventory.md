# Test Inventory — Every Suite in the Codebase

Suite names below are the literal `describe()` titles (extracted from source,
not paraphrased). Run subsets with
`pnpm --filter <pkg> vitest run tests/<file>.test.ts`.

## `@vetwo/units` (36 files, 1409 tests)

| File                             | Top-level suites (first three)                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `advanced-conversion.test.ts`    | 13.1 conversion model audit; 13.3 temperature conversions; 13.4 absolute vs differential |
| `api-snapshot.test.ts`           | prompt18 §3: public API snapshot                                                         |
| `audit.test.ts`                  | audit §3: immutability; audit §4: dimensions; audit §5: units                            |
| `certification-examples.test.ts` | prompt18 §12: mechanics / thermodynamics / electricity                                   |
| `constants.test.ts`              | constant identity; registration conflicts; namespaces and scopes                         |
| `conversion.test.ts`             | Conversion: same-unit optimization / linear / dimension validation                       |
| `dependency-graph.test.ts`       | graph construction and ordering; incremental recomputation; pipelines                    |
| `dimensionless.test.ts`          | 7.1 dimensionless foundation; 7.2 canonical; 7.3 quantities                              |
| `dimension.test.ts`              | defineDimension; canonical key; multiplyDim (A × B adds exponents)                       |
| `docs.test.ts`                   | getting-started examples; public API surface (stability tripwire)                        |
| `expression.test.ts`             | Expression literals and variables; arithmetic; dimension inference                       |
| `formatter.test.ts`              | formatUnit: atomic / composite / exponents                                               |
| `formula.test.ts`                | formula definition and evaluation; dimensional validation; compilation and caching       |
| `fuzz.test.ts`                   | parser / serialized-input / registry-definition fuzz (seeded)                            |
| `interop.test.ts`                | extension manifests; scoped registries; snapshots and aliases                            |
| `measurement-phase25.test.ts`    | extended metadata validation; significant figures; confidence intervals                  |
| `measurement.test.ts`            | Measurement construction / conversion / propagation                                      |
| `numerical.test.ts`              | 11.1–11.3 finite values; 11.4 division by zero; 11.5–11.6 approx vs exact                |
| `parser-advanced.test.ts`        | Parser strict mode; canonical unit keys; unit suggestions                                |
| `parser.test.ts`                 | Parser basic — atomic & aliases; prefixes; composites                                    |
| `prefix.test.ts`                 | Standard prefixes; PrefixRegistry; registration safety                                   |
| `properties.test.ts`             | dimension algebra invariants; conversion round-trips; canonicalization                   |
| `quantity-kind.test.ts`          | QuantityKindRegistry; semantic compatibility; kind resolution                            |
| `quantity-math.test.ts`          | Quantity roots; reciprocal and sign; clamp and modulo                                    |
| `quantity.test.ts`               | Quantity construction / immutability / conversion                                        |
| `scientific-pipeline.test.ts`    | scientific pipeline integration                                                          |
| `scientific-units.test.ts`       | mechanical derived identities; density; flow rates                                       |
| `scientific-validation.test.ts`  | prompt17 §2 dimensional algebra [seed 1701]; §3 unit algebra; §4 arithmetic identities   |
| `serializer.test.ts`             | serializeUnit / serializeQuantity round-trips; serialization version                     |
| `standards-profile.test.ts`      | ProfileRegistry; preferred units; cross-system conversion                                |
| `statistics.test.ts`             | combineUncertainties; CovarianceMatrix; MeasurementSeries                                |
| `unit-algebra.test.ts`           | canonical unit algebra; dimension inference; derived units                               |
| `unit-packs.test.ts`             | SI / Imperial / US customary packs                                                       |
| `unit-system.test.ts`            | UnitSystem registration; UnitPack registration; collisions                               |
| `unit.test.ts`                   | Unit construction / immutability / dimension                                             |
| `universal-dimension.test.ts`    | 14.2 universal basis; 14.3 dimension registry; 14.5 dimension vector                     |

Plus `src/conversion.bench.ts` (30+ benches, see [benchmarks.md](benchmarks.md)).

## `@vetwo/nutrition-units` (15 files, 314 tests)

| File                                    | Top-level suites                                                       |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `nutrition-phase2.test.ts`              | architecture; nutrient-kind registry; basis registry                   |
| `nutrition-phase3-phase4.test.ts`       | phase3 proximate/macros; minerals; vitamins                            |
| `nutrition-phase5-phase6.test.ts`       | phase5 basis model; dry-matter validation; basis conversion            |
| `nutrition-phase7-phase8.test.ts`       | phase7 physical vs semantic compatibility; phase8 metadata; invariants |
| `nutrition-uncertainty.test.ts`         | phase9 construction / unit conversion / basis conversion               |
| `nutrition-collections.test.ts`         | NutritionSample; NutritionMeasurementSet; NutritionMeasurementSeries   |
| `nutrition-interop.test.ts`             | phase11 canonical serialization; versioning/migration; identifiers     |
| `nutrition.test.ts`                     | NutritionMath.calculate / calculateCost; BasisConverter                |
| `nutrition-context-errors.test.ts`      | Missing / Invalid context errors; valid-context controls               |
| `nutrition-measurement-options.test.ts` | construction contract; serialization round-trip                        |
| `nutrition-sample-options.test.ts`      | construction contract; round-trip; lookup semantics                    |
| `validation-example.test.ts`            | validateRange behavior                                                 |
| `report-example.test.ts`                | renderDietReport behavior                                              |
| `lp-nutrition-data.test.ts`             | coefficient extraction, no solver                                      |
| `public-surface.test.ts`                | public surface via package name (built dist)                           |

## Consumer app (1 file, 4 tests)

| File                     | Suite                                                        |
| ------------------------ | ------------------------------------------------------------ |
| `tests/consumer.test.ts` | nutrition-units-example consumer (package-name imports only) |

## Conventions for new tests

- One `describe` per behavior area; file per module or prompt phase.
- Assert typed errors with `toThrow(SpecificError)`, never bare `toThrow()`
  for domain failures.
- Property/seeded tests pin their seed in the title (`[seed 1724]`).
- Snapshot files (`api-snapshot`) are tripwires: update intentionally, never
  with `-u` on autopilot.
