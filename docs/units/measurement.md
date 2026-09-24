# `Measurement` — Value, Uncertainty, Significance

`@vetwo/units` owns the generic measurement/uncertainty machinery. Domain
layers (e.g. nutrition) wrap it — they never re-implement it.

## Construction

```ts
Measurement.of(value: Quantity, uncertainty: Quantity | number): Measurement
Measurement.exact(value: Quantity, metadata?): Measurement
```

- `value` must be a `Quantity`; `uncertainty` is an absolute uncertainty as a
  `Quantity` (same dimension expected) or a non-negative finite number.
- Uncertainty rejects affine (offset) units: an uncertainty in `°C` is
  meaningless — express it in `K`.
- `Measurement.exact(q)` records a value with zero uncertainty.

```ts
const assay = Measurement.of(Quantity.of(100, "g"), Quantity.of(2, "g"));
```

## Uncertainty model

- `measurement.value` / `.uncertainty` expose the two quantities;
  `.dimension` forwards the value dimension.
- `relativeUncertainty()` returns the relative figure — and **throws for
  affine units**; only call it on linear-unit measurements.
- `Measurement.of` rejects _relative_ uncertainty specifications for affine
  units at construction time.
- Arithmetic (`add`, `multiply`, …) propagates uncertainty automatically
  (quadrature for sums, relative quadrature for products) and converts units
  as needed. Reciprocals propagate via relative uncertainty.
- Equality mirrors `Quantity` (`equals`, `exactEquals`).

## Significant figures and presentation

`toSignificantFigures(value, digits)` and `toEngineeringNotation(value,
digits)` render numbers honestly; `formatQuantity`/`formatQuantityDisplay`
format quantities. Keep full precision internally and round only for display.

## Statistics and series (advanced)

The engine also provides `MeasurementSeries` (mean/variance/serialization),
`CovarianceMatrix` with covariance-aware propagation
(`propagateWithCovariance`), and `combineUncertainties` for multi-component
budgets. Reach for these before hand-rolling statistics — see the package
README's statistics section and `api-reference.md` for entry points.

## Practical rules

- DO store lab/sensor values as `Measurement`, never as parallel
  `value`/`±` numbers.
- DO express all uncertainties in linear units (`K`, never `°C`).
- DO NOT invent a second uncertainty representation in application code.
- DO NOT compare `.value` floats with `===` after conversion — use the
  measurement/quantity equality helpers.
