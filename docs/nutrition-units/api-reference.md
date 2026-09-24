# `@vetwo/nutrition-units` — Public API Index

Organized map of the public entrypoint (`@vetwo/nutrition-units`). For exact
signatures, read the installed `dist/index.d.ts` — it wins over this page.
For exhaustive per-method docs, see `packages/Nutrition-units/README.md`.

## Calculation core (Phase 1)

- `NutritionMath` / `nutritionMath` — `calculate(feedIntake, concentration, key)`,
  `calculateCost`, `sum`
- `CoefficientResolver` / `coefficientResolver` — `getCoefficient`,
  `getCostCoefficient`, `getBound`
- `BasisConverter` — static `toAsFed` / `toDryMatterBasis` over plain quantities
- `TargetUnitRegistry` / `defaultTargetUnitRegistry` — `getTargetUnit`,
  `override`; type `NutrientKey`
- `FeedSchemaLoader` (+ type `UnitSchema`) — `asFed`, `dryMatterBasis`,
  `requirement`, `animal`, `economics` quantity factories over a JSON unit map
- Rules: `NUTRIENT_CONTRIBUTION_RULE`, `DIET_COST_RULE` (+ registration on import)

## Semantic model (Phases 2–4)

- `NutrientKindRegistry` / `defaultNutrientKindRegistry` / `isNutrientKindId`;
  type `NutrientKind`
- `BasisRegistry` / `defaultBasisRegistry` / `isBasisId`; types
  `BasisDefinition`, `BasisId`
- `NutritionQuantity` — `of`, `from`, `to`, `withBasis`, `convertBasis`,
  `convert`, `toJSON`/`fromJSON`; type `NutritionQuantityOptions`,
  `SerializedNutritionQuantity`
- `NutritionMeasurement` — `of`, `from`, `to`, `convertBasis`, `convert`,
  `equals`, `exactEquals`, `isCompatibleWith`, `compare`, `toJSON`/`fromJSON`;
  types `NutritionMeasurementOptions`, `SerializedNutritionMeasurement`

## Context, families, compatibility (Phases 5–7)

- `createNutritionContext`, `resolveDryMatterFraction`; types
  `NutritionContext`, `NutritionContextOptions`
- `inferUnitFamily`, `isFamilyCompatible`, `assertFamilyCompatible`,
  `listUnitFamilies`, `getMolarMass`, `convertMolarToMass`; types
  `NutritionUnitFamily`, `UnitFamilyDefinition`
- `checkNutrientCompatibility`, `isNutrientCompatible`,
  `assertNutrientCompatible`, `assertSemanticCompatibility`, `canConvert`,
  `assertCanConvert`; types `SemanticMode`, `CompatibilityStatus`,
  `CompatibilityResult`

## Metadata, collections, interop (Phases 8–11)

- `createNutritionMetadata`, `mergeNutritionMetadata`; types
  `NutritionMetadata`, `Provenance`, `SampleContext`, `AnalyticalMethod`,
  `DetectionLimits`, `QualityFlag`
- `NutritionSample` (+ `NutritionSampleOptions`, `SerializedNutritionSample`),
  `NutritionMeasurementSet` (+ serialized type), `NutritionMeasurementSeries`
  (+ `SerializedNutritionMeasurementSeries`, `SeriesPoint`)
- `SCHEMA_VERSION`, `canonicalJsonStringify`,
  `createExternalNutrientIdentifier`, `createExternalUnitIdentifier`,
  `registerExternalNutrientMapping`, `resolveExternalNutrient`,
  `clearExternalNutrientMappings`, `registerMigration`,
  `migrateSerializedNutritionMeasurement`,
  `serializeNutritionMeasurementCanonical`, `toCanonicalJson`,
  `fromCanonicalJson`, `handleUnknownNutrient`,
  `mapTabularRowToNutritionMeasurement`; types `ExternalNutrientIdentifier`,
  `ExternalUnitIdentifier`, `CanonicalNutritionMeasurement`,
  `MigrationFunction`, `TabularFieldMapping`, `TabularRowMapping`,
  `UnknownNutrientHandling`
- Errors: `export * from "./errors.js"` — full list in [errors.md](errors.md)

## Internal-only (never import)

Anything not re-exported above — `coefficient-resolver` internals beyond the
facade, `nutrition-rules` registration details, `src/examples/*` (integration
examples, not API), `scripts/`, tests. If it is not in this index or the
`.d.ts` entrypoint, it is not public API.
