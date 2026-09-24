# Architecture — @vetwo/nutrition-units

This document explains how `@vetwo/nutrition-units` is built internally,
how it uses [`@vetwo/units`](https://github.com/vetwo/units), and the
design decisions behind it. See [`README.md`](./README.md) for the plain
API reference.

---

## Table of contents

- [Design goal](#design-goal)
- [Relationship to @vetwo/units](#relationship-to-vetwounits)
- [Folder structure](#folder-structure)
- [File responsibilities](#file-responsibilities)
- [End-to-end data flow: JSON to solver coefficient](#end-to-end-data-flow-json-to-solver-coefficient)
- [Why nutrient math needs no per-nutrient formulas](#why-nutrient-math-needs-no-per-nutrient-formulas)
- [The as-fed / dry-matter basis problem](#the-as-fed--dry-matter-basis-problem)
- [The solver boundary](#the-solver-boundary)
- [Dependency graph](#dependency-graph)
- [SOLID justification](#solid-justification)
- [Verified example calculations](#verified-example-calculations)
- [Future extensibility](#future-extensibility)

---

## Design goal

Provide **all** the nutrition/feed-formulation domain knowledge a diet
optimization application needs — nutrient reporting units, basis
conversion, and solver-coefficient extraction — while containing **zero**
generic unit-conversion logic of its own. Every conversion or dimensional
check is delegated to `@vetwo/units`; this package only adds business
meaning on top.

Concretely, this package exists so that no file in a consuming application
ever needs to write:

```ts
const proteinGrams = (cp / 100) * kg * 1000; // ❌ never do this
```

and instead writes:

```ts
nutritionMath.calculate(intake, cp, "cp"); // ✅
```

---

## Relationship to @vetwo/units

`@vetwo/nutrition-units` depends on `@vetwo/units` and imports **only**
its public `index.ts` surface (`Quantity`, `CalculationRuleRegistry`,
error classes). It never reaches into `@vetwo/units`'s internal files
(`unit-parser.ts`, `atomic-units.ts`, etc.).

The boundary is intentionally asymmetric:

- `@vetwo/units` has **no idea this package exists**.
- `@vetwo/nutrition-units` is **entirely defined in terms of** `@vetwo/units`'s
  public API.

If you ever find yourself wanting to add a generic unit-conversion helper
here (e.g. "how do I convert kg to lb"), that belongs upstream in
`@vetwo/units`, not here — open an issue/PR against that repo instead.

---

## Folder structure

```
src/
  target-unit-registry.ts       nutrient key -> canonical reporting unit (pure config)
  basis-converter.ts            as-fed <-> dry-matter conversion (needs a DM% input)
  nutrition-rules.ts            registers domain rules into @vetwo/units's rule registry
  nutrition-math.ts             ⭐ the public facade application code should call
  coefficient-resolver.ts       strips Quantity -> plain number, for the LP solver
  feed-schema-loader.ts         reads a feed/animal/requirements JSON unit-map
  examples/
    lp-builder-example.ts       Feed DB row -> HiGHS-ready coefficients
    validation-example.ts       dimensionally-safe range checks
    report-generator-example.ts formatted diet report
  index.ts                      public API + automatic rule registration on import
```

---

## File responsibilities

| File                      | Single responsibility                                                                |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `target-unit-registry.ts` | Pure data: which unit each nutrient is reported in. No calculation logic.            |
| `basis-converter.ts`      | Convert a nutrient value between as-fed and dry-matter basis, given a DM% input.     |
| `nutrition-rules.ts`      | Register the `nutrition.nutrientContribution` and `nutrition.dietCost` rules.        |
| `nutrition-math.ts`       | The single facade the rest of a consuming app should call for nutrient math.         |
| `coefficient-resolver.ts` | The hard boundary that turns `Quantity` results into plain `number`s for the solver. |
| `feed-schema-loader.ts`   | Read a feed-formulation JSON unit-map and produce typed `Quantity` factories.        |
| `examples/*.ts`           | Reference integrations — not part of the public API, but kept in sync with it.       |

---

## End-to-end data flow: JSON to solver coefficient

```
1. FeedSchemaLoader reads your unit-map JSON once at startup.
2. A Feed Database row (e.g. cp: 12) + FeedSchemaLoader.asFed("cp", 12)
     -> Quantity(12, "%")
3. Decision-variable unit: Quantity(1, "kg/day")  (matches solver.decisionVariable)
4. NutritionMath.calculate(intake, concentration, "cp")
     -> Quantity.multiply()   [dimensional analysis, from @vetwo/units]
     -> .to("g/day")          [TargetUnitRegistry says cp reports in g/day]
5. CoefficientResolver.getCoefficient(...) -> a plain `number`
6. LP Builder puts that number into the HiGHS constraint matrix.
7. The solver itself never imports @vetwo/units or @vetwo/nutrition-units —
   it only ever sees `number`.
8. Report Generator takes solved amounts back out as numbers, re-wraps them
   as Quantity, and calls NutritionMath again to compute final totals for
   display via `formatQuantity()` (from @vetwo/units).
```

Units are created once (data ingestion, step 2) and destroyed once (solver
boundary, step 5). Everywhere else, only `Quantity` objects flow — it's
structurally impossible for a stray `cp / 100` to sneak into application
code, because there's no raw number to operate on until
`CoefficientResolver` deliberately unwraps one.

---

## Why nutrient math needs no per-nutrient formulas

`NUTRIENT_CONTRIBUTION_RULE` is a single rule:

```ts
registry.register(NUTRIENT_CONTRIBUTION_RULE, (...inputs) => {
  const [feedIntake, nutrientConcentration] = inputs;
  return feedIntake.multiply(nutrientConcentration);
});
```

This one line correctly computes CP%, Ca%, Fe(mg/kg), DE(Mcal/kg), and
VitA(IU/kg) contributions, because `Quantity.multiply()` (from
`@vetwo/units`) performs real dimensional analysis: percent, ppm, and
mg/kg are all dimensionless ratios with different scale factors, so one
multiplication handles all of them correctly.

**What _is_ nutrition-specific** is `NutritionMath.calculate()`'s second
step — looking up the correct **reporting unit** per nutrient via
`TargetUnitRegistry` and calling `.to()` on the raw result. That lookup
table (grams for macro-nutrients, milligrams for trace minerals, IU for
vitamins) is business knowledge this package owns; the arithmetic is not.

---

## The as-fed / dry-matter basis problem

A feed's nutrient content can be reported two ways:

- **As-fed**: relative to the feed's total weight including moisture.
- **Dry-matter (DM)**: relative to the feed's weight after moisture is
  removed.

Converting between them requires the feed's dry-matter percentage — an
_extra_ input beyond the value being converted. This can't be a pure unit
conversion (`Quantity.to()` deliberately refuses to bridge two different
basis tags — see `@vetwo/units`'s `ARCHITECTURE.md`), so it's implemented
here as domain logic:

```ts
BasisConverter.toAsFed(dmQuantity, dryMatterPercent): Quantity
BasisConverter.toDryMatterBasis(asFedQuantity, dryMatterPercent): Quantity
```

Internally, both call `Quantity.multiply()`/`divide()` and then explicitly
`.to()` the result into the desired unit — a past bug (fixed in `1.0.0`,
see `CHANGELOG.md`) came from skipping that final `.to()` call and
re-wrapping a raw base-unit value directly, which silently produced a
result off by the unit's scale factor. This is why `BasisConverter` tests
must assert exact magnitudes, not just "no exception was thrown."

---

## The solver boundary

```ts
class CoefficientResolver {
  getCoefficient(
    feedUnitIntake: Quantity,
    nutrientConcentration: Quantity,
    nutrientKey: NutrientKey,
  ): number;
  getCostCoefficient(feedUnitIntake: Quantity, pricePerKg: Quantity): number;
  getBound(quantity: Quantity, targetUnit: string): number;
}
```

Every method here returns a plain `number`. This class is the **only**
place in the whole nutrition stack where a `Quantity` is deliberately
unwrapped. Application code building an LP problem (HiGHS or otherwise)
should depend only on this class's output — never on `Quantity`,
`@vetwo/units`, or this package's other exports — keeping the solver
module's dependency footprint at zero for unit-related code.

---

## Dependency graph

```
solver (HiGHS)                <-- imports nothing from this package or @vetwo/units
        ^
        | number
CoefficientResolver
        ^
        | Quantity
NutritionMath ── BasisConverter ── TargetUnitRegistry
        │
        ▼
   @vetwo/units (Quantity, CalculationRuleRegistry, errors)
```

---

## SOLID justification

- **S — Single Responsibility.** `TargetUnitRegistry` is pure
  configuration; `BasisConverter` only does basis math; `NutritionMath`
  only orchestrates; `CoefficientResolver` only unwraps.
- **O — Open/Closed.** New nutrients are added via one line in
  `target-unit-registry.ts`. New reporting-unit conventions are set via
  `TargetUnitRegistry.override()` — no existing code changes.
- **L — Liskov Substitution.** Anywhere a `Quantity` is expected, any
  correctly-constructed `Quantity` (regardless of which unit it holds)
  behaves correctly, because all math is delegated to `@vetwo/units`.
- **I — Interface Segregation.** Application code depends on the narrow
  `NutritionMath`/`CoefficientResolver` facades, not on the shared
  `CalculationRuleRegistry` directly.
- **D — Dependency Inversion.** This package depends on `@vetwo/units`'s
  abstract `Quantity`/`CalculationRuleRegistry` API, never on its
  internals.

---

## Verified example calculations

These have been executed (not just reasoned about) against the compiled
package:

```
CP contribution:   10 kg/day × 12%        -> 1200 g/day
Ca contribution:   10 kg/day × 0.9%       -> 90 g/day
Fe contribution:   10 kg/day × 80 mg/kg   -> 800 mg/day
DE contribution:   10 kg/day × 3.2 Mcal/kg -> 32 Mcal/day
VitA contribution: 10 kg/day × 5000 IU/kg -> 50000 IU/day
Diet cost:         10 kg/day × 0.35 cur/kg -> 3.5 cur/day
Basis conversion:  15% DM at 88% DM       -> 13.2% as-fed
Dimension safety:  1 kg + 1 Mcal          -> throws UnitMismatchError
```

---

## Future extensibility

- **New animal species** (poultry, rabbit, sheep, goat): require no engine
  changes — only new JSON requirement values and, if needed, additional
  `NutrientKey` entries.
- **New nutrients**: one line in `target-unit-registry.ts`.
- **Alternate reporting conventions** (e.g. ME reported in Mcal instead of
  Kcal): `TargetUnitRegistry.override()`, no code change.
- **Multi-currency**: the generic `"cur"` atomic unit (from `@vetwo/units`)
  can be aliased per tenant/locale upstream; `CurrencyPerMass` and
  `CurrencyFlow` fall out of dimensional analysis automatically.
