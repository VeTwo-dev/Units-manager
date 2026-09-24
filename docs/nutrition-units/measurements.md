# Nutrition Measurements — Quantities, Measurements, Options

## Two levels: `NutritionQuantity` and `NutritionMeasurement`

- **`NutritionQuantity`** = `Quantity` (physical) + `NutrientKind` + `Basis`
  (+ optional metadata). For values without uncertainty.
- **`NutritionMeasurement`** = `Measurement` (value + uncertainty) +
  `NutrientKind` + `Basis` (+ optional context/metadata). For lab assays and
  sensor values — the level most application code should use.

```ts
NutritionQuantity.of(quantity: Quantity, nutrientId: string, basisId = "asFed", opts?: ...): NutritionQuantity
NutritionQuantity.from(value: number, unit: string, nutrientId: string, basisId = "asFed", ...): NutritionQuantity

NutritionMeasurement.of(measurement: Measurement, nutrientId: string, basisId = "asFed", opts?: NutritionMeasurementOptions): NutritionMeasurement
NutritionMeasurement.from(value: number, unit: string, nutrientId: string, basisId = "asFed", uncertainty?: Quantity | number, opts?: NutritionMeasurementOptions): NutritionMeasurement
```

```ts
const nq = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed");
const nm = NutritionMeasurement.from(100, "mg/kg", "ca", "asFed", Quantity.of(3, "mg/kg"));
```

## The options contracts (public API)

```ts
import type { NutritionMeasurementOptions, NutritionSampleOptions } from "@vetwo/nutrition-units";

const opts: NutritionMeasurementOptions = {
  context: createNutritionContext({ dryMatterFraction: 0.9 }),
  metadata: { reference: "lot-42" }, // known fields only (see metadata.md)
  // basisRegistry / kindRegistry overrides for advanced isolation
};
```

`of`/`from`/`fromJSON`/`convertBasis` all accept these options. Construction
validates nutrient (registry), basis (registry + unit-tag agreement), and
unit family — then freezes the result. Mutating your options object afterwards
cannot corrupt the measurement.

## Conversion (unit vs basis)

```ts
nm.to("g/kg"); // unit conversion (engine)
nm.convertBasis("dryMatter", ctx); // basis conversion (needs context)
nm.convert("mg/kg", "dryMatter", ctx); // both at once
nm.toJSON();
NutritionMeasurement.fromJSON(data); // serialization
nm.equals(other);
nm.compare(other); // comparison (same nutrient + basis)
```

`compare` requires the same nutrient **and** basis
(`InvalidNutritionQuantityError` / `InvalidNutritionBasisError` otherwise).

## Practical rules

- DO use `NutritionMeasurement` for anything with an assay tolerance.
- DO pass context at construction when you already know the dry matter.
- DO NOT construct from `{ value, unit }` pairs — build a real `Measurement`.
- DO NOT mix nutrients or bases and compare raw values; use `compare`/`equals`.
- DO NOT reuse one measurement object across bases — `convertBasis` returns a
  new object with conversion traceability in `metadata.conversion`.
