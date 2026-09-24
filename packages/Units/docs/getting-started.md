# Getting Started

`@vetwo/units` is a dependency-free scientific unit and dimensional-analysis
engine. This guide covers the basic workflow; every snippet below is
executed by `tests/docs.test.ts`, so documentation cannot drift from the API.

## Quantities

```ts
import { Quantity } from "@vetwo/units";

const distance = Quantity.of(100, "m");
const time = Quantity.of(10, "s");
const velocity = distance.divide(time);

velocity.to("km/h"); // Quantity(36, "km/h")
```

Dimensions are checked on every operation. Incompatible units throw
`UnitMismatchError` instead of producing garbage:

```ts
Quantity.of(1, "kg").add(Quantity.of(1, "m")); // throws UnitMismatchError
```

## Measurements

A `Quantity` is exact. A `Measurement` adds uncertainty:

```ts
import { Measurement } from "@vetwo/units";

const mass = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
mass.relativeUncertainty(); // 0.02
```

Arithmetic propagates uncertainty (independent, first-order):

```ts
const total = mass.add(Measurement.of(Quantity.of(5, "kg"), Quantity.of(0.1, "kg")));
total.uncertainty.value; // ≈ 0.2236 kg  (√(0.2² + 0.1²))
```

## Formulas

```ts
import { defineFormula, evaluateFormula, Expression } from "@vetwo/units";

const speed = defineFormula({
  id: "speed",
  expression: Expression.divide(Expression.variable("d"), Expression.variable("t")),
  inputs: { d: { dimension: "m" }, t: { dimension: "s" } },
  outputName: "v",
});

evaluateFormula(speed, { d: Quantity.of(100, "m"), t: Quantity.of(10, "s") });
// Quantity in base units (m/day time base); convert for display.
```

Dimensional mistakes fail at definition time (`length + time` throws
`FormulaError`), never mid-computation.

## Systems and display

```ts
import {
  formatWithContext,
  ProfileRegistry,
  registerStandardProfiles,
  createRegistry,
  SI_PACK,
  CGS_PACK,
} from "@vetwo/units";

const profiles = new ProfileRegistry();
registerStandardProfiles(profiles);
// Derived units live in packs — compose an explicit registry (N from SI,
// dyn from CGS).
const si = createRegistry({ packs: [SI_PACK, CGS_PACK] });
formatWithContext(Quantity.of(1, "N", si), { unitSystem: "cgs", profiles, registry: si });
// "100000 dyn" — original quantity untouched
```

## Why it works this way

- **Dimensions are integer vectors**, not strings: `kg·m/s²` and `N` are
  recognized as the same physics without string tricks.
- **Units carry conversion data; quantities carry values.** Display choices
  (system, profile, format) never change identity.
- **Registries are instances.** The process-wide defaults exist for
  convenience; isolated scopes keep applications from interfering.
- **Formulas are data.** The AST is validated, dimension-checked, cached
  and evaluated deterministically — no `eval`, no generated code.
