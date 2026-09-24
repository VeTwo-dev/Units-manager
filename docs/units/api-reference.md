# `@vetwo/units` — Public API Index

Organized map of the public entrypoint (`@vetwo/units`). For exact
signatures, read the installed `dist/index.d.ts` — it wins over this page.
For exhaustive per-method docs, see `packages/Units/README.md`.

## Core

- `Quantity` — `of`, `withKind`, `to`, `toBase`, `add`, `subtract`,
  `multiply`, `divide`, `scale`, `negate`, `pow`, `sqrt`, `reciprocal`,
  `sin`/`cos` (dimensionless), `exactEquals`, `approximatelyEquals`,
  `hasSameDimension`, comparisons, `isZero/isPositive/isNegative`,
  `kind/requireKind`, `toString`; factory `Q()`
- `Unit`, `isAffineUnit`, `isAbsoluteTemperatureUnit`, `canonicalUnitKey`;
  `ATOMIC_UNITS`, `AtomicUnitDef`
- `Dimension` model: `Dim`, `multiplyDim/divideDim/powDim`, `dimensionKey`,
  `dimensionsEqual`
- `UnitRegistry` (`resolve`, …), `createRegistry`, `defaultUnitRegistry`
- `parseUnit`, `parseUnitExpression`, `unitExprKey`, `equivalentUnits`,
  `formatUnitExpr`

## Conversion & systems

- `convert`, `toBase`, `fromBase`, `linearScaleOf`, `getConversionPlan`,
  `convertWithPlan`
- `defaultUnitSystemRegistry`, `IMPERIAL_SYSTEM`, `normalizeToSystem`,
  `selectUnitForMagnitude`, `formatWithContext`, `ProfileRegistry`
- Packs: `SI_PACK` (+ splits), `IMPERIAL_PACK` (+ defs), `US_CUSTOMARY_PACK`,
  `CGS_PACK`, `SCIENTIFIC_PACK`, `ANGLE_PACK`, `RADIATION_PACK`,
  `ASTRONOMY_PACK`, `INFORMATION_PACK`
- Prefixes: `defaultPrefixRegistry`, `Prefix`/`PrefixRegistry`

## Measurement & math

- `Measurement` — `of`, `exact`, `relativeOf`/`relativeUncertainty`, arithmetic,
  equality; `MeasurementMetadata`; `MeasurementSeries`, `CovarianceMatrix`,
  `combineUncertainties`, `propagateWithCovariance`
- Numerical policy: `defaultNumericalPolicy`, `get/set/resetNumericalPolicy`,
  `classifyNumber`, `assertValidQuantityValue`, `approxEqual`, `exactEqual`,
  `checkFiniteResult`, `roundValue`; types `ComparisonOptions`,
  `RoundingMode`, `NumericalPolicy`, `NumberKind`
- `toSignificantFigures`, `toEngineeringNotation`
- Constants: `createStandardConstantRegistry`, serialization helpers

## Formulas & rules

- `Expression` builders, `compileExpression`, `evaluateExpression`
- `defineFormula`, `compileFormula`, `FormulaRegistry`
- `CalculationRuleRegistry`
- `function-registry` (safe named functions), `dependency-graph` utilities

## Presentation, persistence, interop

- `formatUnit`, `formatQuantity`, `formatQuantityDisplay`,
  `formatUnitCanonical`, `formatWithPreset`
- `serializeUnit/deserializeUnit`, `serializeQuantity/deserializeQuantity`
  (+ legacy variant), `serializeMeasurement/deserializeMeasurement`
- `toInterchange/fromInterchange`, `canonicalizeUnitText`,
  `validateExtension/applyExtension`, `resolveAmbiguous`,
  `parseNamespacedSymbol`, `compareQuantities`, `migrateSerialized`
- Guards: `isQuantity`, `isUnit` (cross-realm safe); `testing` utilities

## Errors

- Full list in [errors.md](errors.md); base class `UnitEngineError`.

## Internal-only (never import)

Anything not re-exported above — e.g. `conversion-engine` internals beyond
the listed helpers, `unit-registry` private members, `scripts/`, `*.bench.ts`,
`*.test.ts`. If it is not in this index or the `.d.ts` entrypoint, it is not
public API.
