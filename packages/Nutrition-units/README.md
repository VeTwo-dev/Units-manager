# @vetwo/nutrition-units

Nutrition & feed-formulation calculation rules, built on top of
[`@vetwo/units`](https://www.npmjs.com/package/@vetwo/units).

This package contains **all the domain knowledge** for animal-nutrition
calculations: which unit each nutrient is reported in, how to convert
between as-fed and dry-matter basis, how to read a feed/animal JSON schema
into safe `Quantity` values, and how to turn that unit-safe math into plain
numbers your LP solver (HiGHS or any other) can consume directly.

It contains **zero generic unit-conversion logic** — that all lives in
`@vetwo/units`. This package only adds nutrition vocabulary on top, so it
stays small, testable, and easy to extend as new species/nutrients are
added.

```ts
import { Quantity } from "@vetwo/units";
import { nutritionMath } from "@vetwo/nutrition-units";

const cp = Quantity.of(12, "%"); // crude protein, as-fed
const intake = Quantity.of(10, "kg/day"); // feed intake

nutritionMath.calculate(intake, cp, "cp"); // Quantity(1200, "g/day")
```

No `/100`, no `*1000`, no manual unit math anywhere in your application code.

---

## Table of contents

- [Installation](#installation)
- [Why a separate package](#why-a-separate-package)
- [Quick start](#quick-start)
- [API reference (every exported function/class)](#api-reference)
  - [`NutritionMath`](#nutritionmath)
  - [`CoefficientResolver`](#coefficientresolver)
  - [`BasisConverter`](#basisconverter)
  - [`TargetUnitRegistry`](#targetunitregistry)
  - [`FeedSchemaLoader`](#feedschemaloader)
  - [Registered calculation rules](#registered-calculation-rules)
- [Default reporting units](#default-reporting-units)
- [Integration patterns](#integration-patterns)
  - [LP solver](#lp-solver-integration)
  - [Validation engine](#validation-engine-integration)
  - [Report generator](#report-generator-integration)
- [Design principles](#design-principles)

---

## Installation

```bash
npm install @vetwo/units @vetwo/nutrition-units
# or
bun add @vetwo/units @vetwo/nutrition-units
```

`@vetwo/units` is a required peer dependency — both packages must be
installed together.

---

## Why a separate package

`@vetwo/units` knows _how_ to convert and combine units — it has no idea
that `"cp"` means crude protein, or that vitamins are reported in IU/day.
That knowledge (reporting-unit conventions, as-fed/dry-matter conversion,
solver-coefficient extraction) is domain-specific and lives here, cleanly
separated so the core engine stays reusable for other fields (chemistry,
finance, engineering, veterinary pharmacology...).

---

## Quick start

```ts
import { Quantity } from "@vetwo/units";
import { nutritionMath, coefficientResolver, BasisConverter } from "@vetwo/nutrition-units";

const intake = Quantity.of(10, "kg/day");

// Nutrient contributions — reporting unit chosen automatically per nutrient
nutritionMath.calculate(intake, Quantity.of(12, "%"), "cp"); // 1200 g/day
nutritionMath.calculate(intake, Quantity.of(0.9, "%"), "ca"); // 90 g/day
nutritionMath.calculate(intake, Quantity.of(80, "mg/kg"), "fe"); // 800 mg/day
nutritionMath.calculate(intake, Quantity.of(3.2, "Mcal/kg"), "de"); // 32 Mcal/day
nutritionMath.calculate(intake, Quantity.of(5000, "IU/kg"), "vitA"); // 50000 IU/day

// Diet cost
coefficientResolver.getCostCoefficient(intake, Quantity.of(0.35, "cur/kg")); // 3.5 cur/day

// As-fed <-> dry-matter conversion
const dm = Quantity.of(88, "%");
const cpDmBasis = Quantity.of(15, "% DM");
BasisConverter.toAsFed(cpDmBasis, dm); // 13.2 % (as-fed)

// Plain numeric coefficient for an LP solver — units never reach the solver
coefficientResolver.getCoefficient(Quantity.of(1, "kg/day"), Quantity.of(12, "%"), "cp"); // 120
```

---

## API reference

### `NutritionMath`

The main facade — **the only entry point application code should call**
for nutrient math. Wraps the generic `nutrition.nutrientContribution` and
`nutrition.dietCost` rules and normalizes results to each nutrient's
canonical reporting unit.

```ts
class NutritionMath {
  constructor(rules?: CalculationRuleRegistry, targetUnits?: TargetUnitRegistry);
  calculate(
    feedIntake: Quantity,
    nutrientConcentration: Quantity,
    nutrientKey: NutrientKey,
  ): Quantity;
  calculateCost(feedIntake: Quantity, pricePerKg: Quantity): Quantity;
  sum(contributions: Quantity[]): Quantity;
}

export const nutritionMath: NutritionMath; // ready-to-use default instance
```

#### `.calculate(feedIntake, nutrientConcentration, nutrientKey)`

Computes a nutrient's contribution from a feed's inclusion rate and its
nutrient concentration, automatically converted to that nutrient's
registered reporting unit (see [Default reporting units](#default-reporting-units)).

```ts
nutritionMath.calculate(
  Quantity.of(10, "kg/day"), // how much of this feed the animal eats
  Quantity.of(12, "%"), // the feed's CP concentration
  "cp", // which nutrient — determines the output unit
); // Quantity(1200, "g/day")
```

Works identically for any nutrient/unit combination — percent, ppm, mg/kg,
Mcal/kg, IU/kg — because the underlying math is generic dimensional
analysis, not per-nutrient formulas.

#### `.calculateCost(feedIntake, pricePerKg)`

Computes the diet-cost contribution of one feed.

```ts
nutritionMath.calculateCost(Quantity.of(10, "kg/day"), Quantity.of(0.35, "cur/kg")); // Quantity(3.5, "cur/day")
```

#### `.sum(contributions)`

Sums multiple `Quantity` contributions of the **same nutrient** across
several feeds in a diet (e.g. total CP supplied by corn + soybean meal +
premix). Throws if the array is empty; throws `UnitMismatchError` if the
quantities aren't dimensionally compatible.

```ts
const totalCp = nutritionMath.sum([
  nutritionMath.calculate(cornIntake, cornCp, "cp"),
  nutritionMath.calculate(soyIntake, soyCp, "cp"),
]);
```

---

### `CoefficientResolver`

Strips units away entirely — the hard boundary your LP solver should sit
behind. Nothing downstream of this class should import `@vetwo/units` or
`@vetwo/nutrition-units` at all; it should only ever see `number`.

```ts
class CoefficientResolver {
  constructor(math?: NutritionMath);
  getCoefficient(
    feedUnitIntake: Quantity,
    nutrientConcentration: Quantity,
    nutrientKey: NutrientKey,
  ): number;
  getCostCoefficient(feedUnitIntake: Quantity, pricePerKg: Quantity): number;
  getBound(quantity: Quantity, targetUnit: string): number;
}

export const coefficientResolver: CoefficientResolver;
```

#### `.getCoefficient(feedUnitIntake, nutrientConcentration, nutrientKey)`

Returns a plain `number` — the per-unit-of-decision-variable coefficient
for an LP constraint row (e.g. "how many grams of CP does 1 kg/day of this
feed contribute").

```ts
coefficientResolver.getCoefficient(Quantity.of(1, "kg/day"), Quantity.of(12, "%"), "cp"); // 120
```

#### `.getCostCoefficient(feedUnitIntake, pricePerKg)`

Returns a plain `number` for the objective-function coefficient (cost per
unit of decision variable).

```ts
coefficientResolver.getCostCoefficient(Quantity.of(1, "kg/day"), Quantity.of(0.35, "cur/kg")); // 0.35
```

#### `.getBound(quantity, targetUnit)`

Converts any bound (min/max inclusion, min/max nutrient requirement) to a
plain number in a chosen target unit, for use as a constraint bound.

```ts
coefficientResolver.getBound(Quantity.of(2, "kg/day"), "kg/day"); // 2
coefficientResolver.getBound(Quantity.of(500, "g/day"), "kg/day"); // 0.5
```

---

### `BasisConverter`

Converts a nutrient value between **as-fed** and **dry-matter** reporting
basis. This requires the feed's dry-matter percentage as an extra input —
it is domain logic, not a pure unit conversion (a plain `Quantity.to()`
call deliberately refuses to bridge basis tags).

```ts
class BasisConverter {
  static toAsFed(dmQuantity: Quantity, dryMatterPercent: Quantity): Quantity;
  static toDryMatterBasis(asFedQuantity: Quantity, dryMatterPercent: Quantity): Quantity;
}
```

#### `BasisConverter.toAsFed(dmQuantity, dryMatterPercent)`

`dmQuantity` must carry a `"DM"` basis tag (e.g. parsed from `"15 % DM"`);
`dryMatterPercent` must be a plain `"%"` quantity (the feed's dry-matter
content). Returns the equivalent as-fed value (basis tag stripped).

```ts
const cpDmBasis = Quantity.of(15, "% DM");
const dm = Quantity.of(88, "%");
BasisConverter.toAsFed(cpDmBasis, dm); // Quantity(13.2, "%")
```

#### `BasisConverter.toDryMatterBasis(asFedQuantity, dryMatterPercent)`

The inverse operation — converts an as-fed value into its dry-matter-basis
equivalent (adds the `"DM"` basis tag). Throws `ConversionError` if
`dryMatterPercent` is zero.

```ts
BasisConverter.toDryMatterBasis(Quantity.of(13.2, "%"), Quantity.of(88, "%")); // Quantity(15, "% DM")
```

---

### `TargetUnitRegistry`

Pure configuration — maps each nutrient key to its canonical reporting
unit. Contains **no calculation logic**, so reporting conventions can
change without touching any math.

```ts
type NutrientKey =
  | "cp"
  | "lys"
  | "methionine"
  | "metCys"
  | "ee"
  | "cf"
  | "ndf"
  | "adf"
  | "ash"
  | "starch"
  | "sugar"
  | "tdn"
  | "ca"
  | "p"
  | "availableP"
  | "mg"
  | "k"
  | "na"
  | "cl"
  | "s"
  | "fe"
  | "mn"
  | "cu"
  | "zn"
  | "co"
  | "i"
  | "se"
  | "vitA"
  | "vitD"
  | "vitE"
  | "de"
  | "me"
  | "nel"
  | "cost";

class TargetUnitRegistry {
  getTargetUnit(nutrientKey: NutrientKey): string;
  override(nutrientKey: NutrientKey, unitSymbol: string): void;
}

export const defaultTargetUnitRegistry: TargetUnitRegistry;
```

#### `.getTargetUnit(nutrientKey)`

Returns the unit string a nutrient should be reported in.

```ts
defaultTargetUnitRegistry.getTargetUnit("vitA"); // "IU/day"
defaultTargetUnitRegistry.getTargetUnit("fe"); // "mg/day"
```

#### `.override(nutrientKey, unitSymbol)`

Changes the reporting unit for one nutrient, without forking the package —
useful if your product wants ME reported in Mcal instead of Kcal, for
example.

```ts
defaultTargetUnitRegistry.override("me", "Mcal/day");
nutritionMath.calculate(intake, Quantity.of(3000, "Kcal/kg"), "me"); // now returns Mcal/day
```

---

### `FeedSchemaLoader`

Reads a feed/animal/requirements JSON unit-map (as-fed and dry-matter
basis, animal data, requirements, solver variables, feed constraints,
minerals limits, economics) and returns `Quantity` factories per field —
the single place in your codebase that needs to know your schema's shape.

```ts
interface UnitSchema {
  feed: { asFed: Record<string, string>; dryMatterBasis: Record<string, string> };
  animal: Record<string, string>;
  requirements: Record<string, string>;
  solver: Record<string, string>;
  feedConstraints: Record<string, string>;
  mineralsLimits: Record<string, string>;
  economics: Record<string, string>;
}

class FeedSchemaLoader {
  constructor(schema: UnitSchema);
  asFed(field: string, value: number): Quantity;
  dryMatterBasis(field: string, value: number): Quantity;
  requirement(field: string, value: number): Quantity;
  animal(field: string, value: number): Quantity;
  economics(field: string, value: number): Quantity;
  feedConstraint(field: string, value: number): Quantity;
}
```

```ts
import { FeedSchemaLoader } from "@vetwo/nutrition-units";
import schema from "./units-schema.json";

const loader = new FeedSchemaLoader(schema);

const cp = loader.asFed("cp", 12); // Quantity(12, "%")
const cpDm = loader.dryMatterBasis("cp", 13.6); // Quantity(13.6, "% DM")
const cpRequirement = loader.requirement("cp", 480); // Quantity(480, "g/day")
const bodyWeight = loader.animal("bodyWeight", 450); // Quantity(450, "kg")
const feedPrice = loader.economics("feedPrice", 0.35); // Quantity(0.35, "cur/kg")
const maxInclusion = loader.feedConstraint("maxKg", 3); // Quantity(3, "kg/day")
```

---

### Registered calculation rules

On import, this package registers two rules into `@vetwo/units`'s shared
`CalculationRuleRegistry`. `NutritionMath` is the recommended way to call
them, but you can invoke them directly if you need to:

```ts
import { NUTRIENT_CONTRIBUTION_RULE, DIET_COST_RULE } from "@vetwo/nutrition-units";
import { defaultCalculationRuleRegistry } from "@vetwo/units";

defaultCalculationRuleRegistry.run(NUTRIENT_CONTRIBUTION_RULE, intake, concentration);
defaultCalculationRuleRegistry.run(DIET_COST_RULE, intake, price);
```

| Constant                     | Registry key                       | Inputs                                | Behavior                                     |
| ---------------------------- | ---------------------------------- | ------------------------------------- | -------------------------------------------- |
| `NUTRIENT_CONTRIBUTION_RULE` | `"nutrition.nutrientContribution"` | `(feedIntake, nutrientConcentration)` | `feedIntake.multiply(nutrientConcentration)` |
| `DIET_COST_RULE`             | `"nutrition.dietCost"`             | `(feedIntake, pricePerKg)`            | `feedIntake.multiply(pricePerKg)`            |

---

## Default reporting units

| Category        | Nutrients                                                                                      | Unit       |
| --------------- | ---------------------------------------------------------------------------------------------- | ---------- |
| Macro nutrients | `cp`, `lys`, `methionine`, `metCys`, `ee`, `cf`, `ndf`, `adf`, `ash`, `starch`, `sugar`, `tdn` | `g/day`    |
| Macro minerals  | `ca`, `p`, `availableP`, `mg`, `k`, `na`, `cl`, `s`                                            | `g/day`    |
| Trace minerals  | `fe`, `mn`, `cu`, `zn`, `co`, `i`, `se`                                                        | `mg/day`   |
| Vitamins        | `vitA`, `vitD`, `vitE`                                                                         | `IU/day`   |
| Energy          | `de`, `nel`                                                                                    | `Mcal/day` |
| Energy          | `me`                                                                                           | `Kcal/day` |
| Economics       | `cost`                                                                                         | `cur/day`  |

Change any of these via `TargetUnitRegistry.override()` without forking the
package.

---

## Integration patterns

### LP solver integration

```ts
import { Quantity } from "@vetwo/units";
import { coefficientResolver } from "@vetwo/nutrition-units";

function buildConstraintRow(feed: { name: string; cp: number; ca: number; price: number }) {
  const oneUnitIntake = Quantity.of(1, "kg/day"); // matches the solver's decision-variable unit

  return {
    feedName: feed.name,
    cpCoefficient: coefficientResolver.getCoefficient(
      oneUnitIntake,
      Quantity.of(feed.cp, "%"),
      "cp",
    ),
    caCoefficient: coefficientResolver.getCoefficient(
      oneUnitIntake,
      Quantity.of(feed.ca, "%"),
      "ca",
    ),
    costCoefficient: coefficientResolver.getCostCoefficient(
      oneUnitIntake,
      Quantity.of(feed.price, "cur/kg"),
    ),
  };
}
```

The returned object contains only `number`s — pass it straight into your
HiGHS (or any other LP) constraint matrix. The solver module itself never
needs to import this package or `@vetwo/units`.

### Validation engine integration

```ts
import { Quantity, DimensionError } from "@vetwo/units";

function validateRange(value: Quantity, min: Quantity, max: Quantity) {
  if (!value.hasSameDimension(min) || !value.hasSameDimension(max)) {
    throw new DimensionError(min.unit.symbol, value.unit.symbol);
  }
  const v = value.toBase().value;
  return v >= min.toBase().value && v <= max.toBase().value;
}
```

A mismatched comparison (e.g. a `Mcal/day` requirement checked against a
`g/day` value) throws instead of silently producing a wrong diet.

### Report generator integration

```ts
import { formatQuantity } from "@vetwo/units";
import { nutritionMath } from "@vetwo/nutrition-units";

const supplied = nutritionMath.calculate(intake, cp, "cp");
const required = Quantity.of(480, "g/day");
const pct = (supplied.toBase().value / required.toBase().value) * 100;

console.log(
  `CP: ${formatQuantity(supplied, { decimals: 1 })} / ${formatQuantity(required, { decimals: 1 })} (${pct.toFixed(0)}%)`,
);
// "CP: 1200.0 g/day / 480.0 g/day (250%)"
```

---

## Basis conversion (Phase 5)

Physical unit conversion (`g/kg → mg/kg`) is handled by `@vetwo/units`.
Nutrition **basis conversion** (`as-fed → dry-matter`) requires explicit
context — never silently.

```ts
import { NutritionQuantity, createNutritionContext } from "@vetwo/nutrition-units";
import { Quantity } from "@vetwo/units";

const ctx = createNutritionContext({ dryMatterFraction: 0.88 }); // 88% DM

const af = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed");
const dm = af.convertBasis("dryMatter", ctx); // 113.6 g/kg DM
const back = dm.convertBasis("asFed", ctx); // 100 g/kg as-fed (round-trip)

// Unified pipeline: unit + basis together
const mgDm = af.convert("mg/kg", "dryMatter", ctx); // 113636 mg/kg DM

// Legacy overload still works:
af.withBasis("dryMatter", Quantity.of(88, "%"));
```

Rules: `0 < DM ≤ 1` finite, `DM + moisture ≈ 1` within `1e-6`, missing context →
`MissingNutritionContextError`, malformed context → `InvalidNutritionContextError`,
contradictory → `NutritionContextError`.
Bases: `asFed` (bare), `dryMatter→DM`, `freshMatter→FM`, `wet→WB`, `normalized`.
Conversions preserve `nutrient` identity and are traceable via `metadata.conversion`.

> Physical unit conversion does not imply nutrition basis conversion.

### Construction options & context errors

`NutritionMeasurementOptions` and `NutritionSampleOptions` are the public
construction contracts (both exported from the package entrypoint):

```ts
import {
  NutritionMeasurement,
  NutritionSample,
  createNutritionContext,
  type NutritionMeasurementOptions,
  type NutritionSampleOptions,
} from "@vetwo/nutrition-units";
import { Measurement, Quantity } from "@vetwo/units";

const measurementOpts: NutritionMeasurementOptions = {
  context: createNutritionContext({ dryMatterFraction: 0.9 }),
  metadata: { reference: "lot-42" },
};
const calcium = NutritionMeasurement.of(
  Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(3, "mg/kg")),
  "ca",
  "asFed",
  measurementOpts,
);

const sampleOpts: NutritionSampleOptions = {
  id: "sample-001",
  context: measurementOpts.context,
  measurements: [calcium],
};
const sample = new NutritionSample(sampleOpts);
```

Basis conversion without the required context fails with the typed error —
never a silent wrong number:

```ts
import { MissingNutritionContextError, InvalidNutritionContextError } from "@vetwo/nutrition-units";

try {
  protein.convertBasis("dryMatter"); // no context
} catch (e) {
  if (e instanceof MissingNutritionContextError) console.log("need DM context");
}
createNutritionContext({ dryMatterFraction: 0.9, moistureFraction: 0.2 }); // throws InvalidNutritionContextError
```

See `apps/nutrition-units-example` for a runnable external-style consumer
that exercises these APIs end to end (`pnpm --filter @vetwo/nutrition-units-example start`).

## Advanced unit families (Phase 6)

```ts
import { inferUnitFamily, getMolarMass, convertMolarToMass } from "@vetwo/nutrition-units";

// Mass concentration: g/kg, mg/kg, µg/kg, g/100g (=10×g/kg), mg/100g, g/L, mg/L, µg/L
// Energy density: MJ/kg, kJ/kg, Kcal/kg, MJ/L
// Activity: IU/kg, IU/g, IU/L (nutrient-specific — vitA IU ≠ vitD IU)
// Molar: mol/kg, mmol/kg, µmol/kg, mol/L (requires chemical identity)
// Fraction: %, fraction, ratio  |  ppm (=1 mg/kg), ppb (=1 µg/kg)

inferUnitFamily(Quantity.of(10, "g/kg")); // "mass-concentration"
inferUnitFamily(Quantity.of(12.5, "MJ/kg")); // "energy-density"

// Mora: g/kg → mol/kg requires molar mass
const caMass = Quantity.of(100, "mg/kg");
convertMolarToMass(caMass, "ca"); // throws if cp (no mass) vs ca (40.078 g/mol) → g/kg
```

Compatibility matrix (strict):

- `cp/trueProtein/ee/cf …` → `mass-concentration`/`fraction`/`ppm-family`
- `ca/p/fe …` → `mass`/`molar`/`fraction`/`ppm`
- `vitA/D/E/K` → `activity` (IU) or `mass`; `vitC/B*` → `mass`
- `ge/de/me/nel …` → `energy-density` only
- `cost` → not a concentration

> IU is semantic activity, not a universal unit. `g↔mol` without molar mass throws. Nutrition-units does not calculate animal requirements or formulate/optimize diets.

## Semantic compatibility (Phase 7)

```ts
import { checkNutrientCompatibility, canConvert } from "@vetwo/nutrition-units";

checkNutrientCompatibility("cp", "ca"); // {status:"incompatible", reason:"..."}
checkNutrientCompatibility("CP", "crudeProtein"); // compatible (alias-aware)
canConvert("vitA", "vitA"); // compatible
canConvert("vitA", "vitD"); // incompatible — IU not universal

const a = NutritionQuantity.of(Quantity.of(10, "g/kg"), "ca", "asFed");
const b = NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed");
a.isCompatibleWith(b); // false
a.checkCompatibility(b); // {status:"incompatible", reason:"..."}
a.add(b); // throws IncompatibleNutrientError
a.add(b, { mode: "permissive" }); // still throws — permissive does not guess
a.compare(b); // throws — semantic mismatch
```

Strict (default) requires same canonical nutrient; permissive allows `unknown` generics but never silently equates `ca`≡`cp`. No global flags — `mode` is explicit per call.

## Metadata & provenance (Phase 8)

```ts
import { createNutritionMetadata, createNutritionContext } from "@vetwo/nutrition-units";

const meta = createNutritionMetadata({
  provenance: {
    source: "lab",
    sourceId: "LAB-001",
    laboratoryId: "LAB-001",
    timestamp: "2026-01-15T10:00:00.000Z",
  },
  sample: { sampleId: "S-001", replicateId: "R1", collectionTimestamp: "2026-01-10T08:00:00.000Z" },
  method: { id: "METHOD-001", name: "Kjeldahl" },
  qualityFlag: "valid",
  detectionLimits: { limitOfDetection: { value: 0.01, unit: "g/kg" } },
});

const nq = NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed", { metadata: meta });
// metadata frozen, preserved through to()/convertBasis() and serialize→deserialize
```

Fields: `provenance` (source/laboratory/method/sample/conversion provenance), `sample` (sampleId/replicateId/type/state/timestamps), `method` (id/name/version/reference), `qualityFlag` (valid/estimated/below-detection-limit/...), `detectionLimits`, `reference`, `custom` (preserved, pollution-safe). Timestamps ISO 8601, IDs `^[A-Za-z0-9._-]{1,128}$`, `custom` depth-guarded, frozen deep. Serialization deterministic, `__proto__` rejected, executable values rejected.

## Scientific measurements with uncertainty (Phase 9)

```ts
import { Quantity, Measurement } from "@vetwo/units";
import { NutritionMeasurement, createNutritionContext } from "@vetwo/nutrition-units";

const meas = Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(5, "mg/kg")); // absolute
// or relative: Measurement.of(Quantity.of(100, "mg/kg"), 0.05) → 5 mg/kg
const nm = NutritionMeasurement.of(meas, "ca", "asFed", {
  metadata: { sample: { sampleId: "S1" } } as never,
});

nm.to("g/kg"); // 0.1 ±0.005 g/kg — uncertainty converted
nm.convertBasis("dryMatter", createNutritionContext({ dryMatterFraction: 0.88 })); // scales uncertainty
nm.compare(other); // semantic-safe, basis-aware
nm.toJSON(); // preserves value/unit/nutrient/basis/uncertainty/context/metadata
```

Uncertainty via core `Measurement` (absolute `Quantity` or relative fraction), `NaN`/`Infinity`/`negative` rejected, basis conversion scales `σ` deterministically (`σ_DM = σ_AF / DM`), context uncertainty not silently ignored (documented limitation if DM itself uncertain). No second uncertainty engine.

## Collections & series (Phase 10)

```ts
import {
  NutritionSample,
  NutritionMeasurementSet,
  NutritionMeasurementSeries,
} from "@vetwo/nutrition-units";

const sample = new NutritionSample({ id: "S-001", measurements: [nm1, nm2] });
const set = new NutritionMeasurementSet([nm1, nm2, nm3]);
set.get("ca"); // nutrient lookup (alias-aware)
set.get("ca", "dryMatter"); // basis-aware, ambiguous → undefined
set.filterByNutrient("cp"); // immutable
set.convertUnits("mg/kg"); // atomic — fails if any fails
set.convertBasis("dryMatter", ctx); // atomic

const series = new NutritionMeasurementSeries([
  { timestamp: "2026-01-01T00:00:00.000Z", measurement: nm1 },
  { timestamp: "2026-01-02T00:00:00.000Z", measurement: nm2 },
]);
for (const point of series) {
  /* point.timestamp, point.measurement */
}
```

All collections frozen, iterable, deterministic lookup via `Map`, `toJSON`/`fromJSON` round-trip, prototype-pollution safe, lightweight (no DataFrame).

## Design principles

- **All domain knowledge, zero generic unit logic.** If a change is about
  _how units convert_, it belongs in `@vetwo/units`, not here.
- **Configuration over code.** Reporting units are data
  (`TargetUnitRegistry`), never `if/else` branches.
- **Hard boundary at the solver.** `CoefficientResolver` is the only place
  a `Quantity` becomes a `number`; nothing past that point should import
  either package.
- **One public facade.** Application code should call `NutritionMath` and
  `CoefficientResolver`; it should not reach into `nutrition-rules.ts` or
  the shared `CalculationRuleRegistry` directly except in advanced cases.
- **Explicit context.** Basis conversion never uses hidden defaults.
- **Explicit semantics.** Physical vs semantic compatibility separate; strict by default.

## Requirements

- `@vetwo/units` (peer dependency)
- TypeScript ^5.x

## License

MIT
