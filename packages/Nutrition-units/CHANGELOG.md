# Changelog

All notable changes to `@vetwo/nutrition-units` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added — Phase 9: Uncertainty & Scientific Measurements + Phase 10: Collections & Series

- **NutritionMeasurement** (`nutrition-measurement.ts`): `Measurement` (core) + `NutrientKind` + `Basis` + `NutritionContext` + `NutritionMetadata` — absolute/relative uncertainty via core `Measurement.of`, validation, unit conversion via `measurement.to`, basis conversion via `scale(DM)` with uncertainty scaling, comparison safety, `toJSON`/`fromJSON` versioned, frozen.
- **Collections** (`nutrition-collections.ts`): `NutritionSample` (id, metadata, measurements, frozen, `withMeasurement`, iterable), `NutritionMeasurementSet` (immutable, `Map` indexed by `nutrient|basis|unit`, `get`/`getAll`/`getOrThrow`/`has`/`add`/`remove`/`filter`/`filterByNutrient`/`filterByBasis`/`map`/`convertUnits`/`convertBasis` atomic, `toJSON`/`fromJSON`), `NutritionMeasurementSeries` (ordered `timestamp` ISO8601, `add`/`filter`, frozen, `toJSON`/`fromJSON`), all deterministic, pollution-safe, lightweight.
- **Tests**: +32 Phase9/10 tests (229 total), covering construction (exact/absolute/relative), validation, unit/basis conversion with uncertainty, comparison safety, equality, serialization, sample/set/series (ordering, replicates, filtering, conversion, atomicity, serialization), adversarial (malformed metadata, pollution, NaN, deep nesting).

### Added — Phase 7: Semantic Compatibility & Safety + Phase 8: Metadata, Provenance & Context

- **Semantic compatibility** (`semantic-compatibility.ts`): `SemanticMode` (`strict`/`permissive`), `CompatibilityResult` (`compatible`/`incompatible`/`unknown`/`ambiguous` + `reason`), `checkNutrientCompatibility`/`isNutrientCompatible`/`assertNutrientCompatible`/`canConvert`/`assertCanConvert` — alias-aware (CP→cp), deterministic, no global state; family ≠ equivalence, energy/IU/molar safety preserved.
- **NutritionQuantity safety** (`nutrition-quantity.ts`): `checkCompatibility`/`isCompatibleWith`/`canConvertTo`/`compare` (semantic-aware, `compare` respects basis+nutrient), `add`/`subtract` now `mode` param (`strict` default, `permissive` explicit), arithmetic/comparison fail safely for `ca+cp`, `vitA IU` vs `vitD IU`, `ge` vs `me`.
- **Metadata/provenance** (`nutrition-metadata.ts`): `NutritionMetadata` (`provenance`, `sample`, `method`, `qualityFlag`, `detectionLimits`, `reference`, `custom`), `SampleContext`/`AnalyticalMethod`/`Provenance`/`DetectionLimits`/`QualityFlag` (`valid`/`estimated`/`below-detection-limit`/…), `createNutritionMetadata`/`mergeNutritionMetadata` — validated (ID `^[A-Za-z0-9._-]{1,128}$`, ISO8601 timestamps, quality enum), frozen deep, pollution-safe, extensible via `custom`.
- **Serialization safety**: `toJSON`/`fromJSON` preserve canonical `nutrient` id + `basis`, `qualityFlag`, `provenance`, `custom`; `__proto__` rejected, executable values rejected.
- **Tests**: +33 Phase7+8 tests (197 total), covering strict/permissive, unknown/ambiguous, family safety, energy/IU/molar, unit compatibility diagnostics, typed errors, guards, `canConvert` API, arithmetic/comparison safety, metadata/provenance/sample/method/quality/detection-limit/replicate, conversion provenance, serialization, property-based alias idempotence & round-trips, adversarial (malformed aliases, pollution, NaN/Infinity, deep nesting, conflicting provenance).

### Added — Phase 5: Basis & Context Conversion + Phase 6: Advanced Unit Families

- **NutritionContext** (`nutrition-context.ts`): `createNutritionContext({dryMatterFraction, moistureFraction, sampleState, source, sampleId, method, timestamp})` — validated (`0<DM≤1`, `DM+moisture≈1`), frozen, `resolvedDryMatterFraction`/`resolvedMoistureFraction` derived, `MissingNutritionContextError`/`InvalidNutritionContextError` on misuse.
- **Basis conversion pipeline** (`nutrition-quantity.ts`): `convertBasis(targetBasis, NutritionContext)` (explicit, deterministic, traceable via `metadata.conversion{sourceBasis,targetBasis,dryMatterFraction}`), `convert(targetUnit, targetBasis, context)` unified pipeline (`unitConvert(basisConvert)≈basisConvert(unitConvert)`), identity `asFed→asFed`/`DM→DM` preserved, `withBasis` legacy `%`-Quantity overload retained; supports `asFed/dryMatter/freshMatter/wet/normalized` via `DM` semantics.
- **Unit-family architecture** (`unit-family.ts`): `NutritionUnitFamily` (`mass-concentration`, `energy-density`, `activity-concentration`, `molar-concentration`, `fraction`, `ratio`, `ppm-family`), `inferUnitFamily`, `isFamilyCompatible`/`assertFamilyCompatible`, conservative compatibility matrix, `getMolarMass`/`convertMolarToMass` (SI fallback, throws `MissingChemicalIdentity` for `cp` etc.), `ppm=1 mg/kg`/`ppb=1 µg/kg` as `ppm-family`.
- **Enriched taxonomy**: `NutrientKind.family`/`chemicalMetadata`/`deprecated`, expanded to 55 kinds (added `trueProtein`, `lignin`, `totalCarbohydrates`, `dryMatter`, `moisture`, `mo`, `cr`, `vitK/C/B1-B12`, `ge/nem/neg` with `nutrient:*` aliases); `NutrientKey`/`TARGET_UNITS` mirrored.
- **Validation**: family-aware `NutritionQuantity.of` (energy only `energy-density`, IU only vitamins, molar requires mass → strict), basis tag vs semantic basis alignment lenient (bare allowed, mismatched tag throws).
- **Tests**: +38 Phase5+6 tests (164 total), covering basis/context validation, DM 0/NaN/Infinity/contradictory, round-trips `AF→DM→AF`, unit+basis commutativity, mass/energy/activity/molar/fraction/ppm/ppb/ratio families, semantic safety (`cp+MJ/kg`, `vitA IU`≠`vitD IU`, `g↔mol` without mass), property-based round-trips, adversarial (small DM, large values, malformed units, missing molar, context immutability, traceability), serialization for families.

### Added — Phase 3+4: Taxonomy Expansion & Concentration Units

- Expanded taxonomy `34→55` kinds (detailed above) with `family` grouping and alias `nutrient:*` canonical IDs.
- Concentration forms `g/kg`, `mg/kg`, `µg/kg`, `g/100g×10`, `g/L`, `mol/kg` (SI), `MJ/kg`, `Kcal/kg`, `IU/kg`, `fraction`, `ppm/ppb` validated via `inferUnitFamily`.

### Added — Phase 2: Nutrition Domain Model

- **Nutrient semantic model** (`nutrient-kind.ts`): first-class `NutrientKind`
  and `NutrientKindRegistry` — stable identifiers, canonical names, aliases,
  categories, default reporting units, descriptions, deterministic lookup,
  collision detection, immutable snapshots, prototype-pollution guards.
  Seeded with 34 kinds (cp, lys, ca, fe, vitA, de, me, cost …).
  Dimension equality no longer implies nutrient equality.
- **Basis model** (`basis.ts`): explicit `BasisDefinition` and `BasisRegistry`
  for `asFed` / `dryMatter` / `freshMatter` / `wet` with aliases,
  `unitBasis` mapping to core `Unit.basis` tags, deterministic lookup and
  snapshots. Basis is semantic/contextual metadata, not a dimension.
- **Nutrition quantity abstraction** (`nutrition-quantity.ts`):
  `NutritionQuantity = Quantity + NutrientKind + Basis` — immutable wrapper
  composing the certified `Quantity`. Delegates all physical conversion to
  `@vetwo/units`; enforces semantic validation (same nutrient + same basis
  for add/subtract), basis-aware conversions (asFed ↔ dryMatter via DM%),
  deterministic serialization (`version:1` + `type:"nutrition-quantity"`),
  and pollution-safe deserialization.
- **Error model** (`errors.ts`): `NutritionError` hierarchy —
  `InvalidNutrientKindError`, `NutrientSemanticMismatchError`,
  `InvalidNutritionBasisError`, `NutritionContextError`,
  `NutritionUnitCompatibilityError`, `InvalidNutritionQuantityError`.
  Core unit/dimension errors continue to be re-used.
- **Serialization foundation**: `serializeNutritionQuantity` /
  `deserializeNutritionQuantity` preserving quantity + nutrient + basis +
  metadata with round-trip guarantees.
- **TypeScript quality**: strict `readonly`, frozen objects, discriminated
  registries, no `any`.
- **Tests**: 35 new tests (semantic, basis, serialization, immutability,
  property-based, regression) — total 53 (18 existing + 35 new), all green.

## [0.0.1] — 2026-07-12

### Added

- Initial public release, built on `@vetwo/units@^1.0.0`.
- `NutritionMath` facade — `calculate()`, `calculateCost()`, `sum()`.
- `CoefficientResolver` — strips `Quantity` results to plain `number`s for
  LP solver consumption (`getCoefficient`, `getCostCoefficient`,
  `getBound`).
- `BasisConverter` — `toAsFed()` / `toDryMatterBasis()` conversions that
  require an explicit dry-matter percentage input.
- `TargetUnitRegistry` — configurable nutrient → canonical reporting unit
  mapping, covering macro nutrients, macro/trace minerals, vitamins,
  energy (DE/ME/NEL), and diet cost.
- `FeedSchemaLoader` — reads a feed/animal/requirements JSON unit-map into
  typed `Quantity` factories.
- Registered calculation rules: `nutrition.nutrientContribution`,
  `nutrition.dietCost`.
- Integration examples: LP builder, validation engine, report generator
  (`src/examples/`).

### Fixed

- `BasisConverter.toAsFed()` previously re-wrapped a raw base-unit value
  directly instead of converting it, producing results off by the DM-basis
  scale factor. Fixed to use `Quantity.to()` for the final conversion step.

[Unreleased]: https://github.com/vetwo/nutrition-units/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/vetwo/nutrition-units/releases/tag/v1.0.0
