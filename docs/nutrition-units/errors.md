# Error Taxonomy & Handling — `@vetwo/nutrition-units`

All errors extend `UnitEngineError` via `NutritionError`, so a single
`instanceof UnitEngineError` catch covers both layers. Prefer specific
classes at trust boundaries.

## Reference (verified in `src/errors.ts`)

| Error                                                                                                        | When it fires                                                 |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `MissingNutritionContextError`                                                                               | basis conversion needs DM info; none provided                 |
| `InvalidNutritionContextError`                                                                               | malformed context (extends `NutritionContextError`)           |
| `NutritionContextError`                                                                                      | base for context problems                                     |
| `InvalidNutritionBasisError`                                                                                 | bad basis id, basis/unit-tag conflict, bad fraction value     |
| `UnsupportedBasisConversionError`                                                                            | unsupported basis pair / unparseable target unit              |
| `NutritionUnitCompatibilityError`                                                                            | nutrient↔unit family mismatch                                 |
| `InvalidNutrientKindError` / `UnknownNutrientError` / `AmbiguousNutrientError`                               | identity problems                                             |
| `IncompatibleNutrientError` (`extends NutrientSemanticMismatchError`) / `UnsupportedSemanticConversionError` | semantic mismatch                                             |
| `InvalidNutritionQuantityError`                                                                              | malformed quantity/measurement/sample payload or construction |
| `DuplicateMeasurementError`                                                                                  | duplicate insertion where prohibited                          |
| `MeasurementNotFoundError` / `AmbiguousMeasurementError`                                                     | collection lookup outcomes                                    |
| `InvalidSeriesError` / `CollectionConversionError`                                                           | series/collection failures                                    |
| `MissingChemicalIdentityError`                                                                               | molar operation without chemical identity                     |

Core engine errors (`UnitMismatchError`, `ImpossibleConversionError`,
`InvalidAffineOperationError`, …) surface unchanged through nutrition APIs —
see [`../units/errors.md`](../units/errors.md).

## Handling guide

```ts
try {
  sample.getOrThrow("zn", "asFed");
} catch (e) {
  if (e instanceof MeasurementNotFoundError) return absent();
  if (e instanceof AmbiguousMeasurementError) return disambiguate();
  throw e;
}

try {
  m.convertBasis("dryMatter", ctx);
} catch (e) {
  if (e instanceof MissingNutritionContextError) return needContext();
  if (e instanceof InvalidNutritionContextError) return fixContext();
  throw e;
}
```

- DO branch with `instanceof`, never message string-matching.
- DO distinguish _missing_ (go fetch data) from _invalid_ (go fix data).
- DO let semantic mismatches propagate from core logic — they are real bugs.
- DO NOT swallow validation errors into default values.
