# End-to-End Workflows (Both Libraries)

Realistic multi-step workflows. Every step uses public APIs verified against
the implementation (see also `apps/nutrition-units-example`, a runnable
external-style consumer).

## Workflow 1 — Lab assay to dry-matter report

```ts
import { Measurement, Quantity } from "@vetwo/units";
import {
  NutritionMeasurement,
  NutritionSample,
  createNutritionContext,
} from "@vetwo/nutrition-units";

// 1. Physical assay + uncertainty (engine) with nutrient + basis (domain).
const calcium = NutritionMeasurement.of(
  Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(3, "mg/kg")),
  "ca",
  "asFed",
  { context: createNutritionContext({ dryMatterFraction: 0.9 }) },
);

// 2. Unit conversion for reporting (engine delegates, uncertainty follows).
const inGram = calcium.to("g/kg"); // 0.1 g/kg

// 3. Basis conversion with the attached context (domain rule, engine math).
const asDM = calcium.convertBasis("dryMatter", calcium.context);

// 4. Collect + serialize (domain containers, engine serializers underneath).
const sample = new NutritionSample({ id: "lot-42", measurements: [calcium, asDM] });
const stored = JSON.stringify(sample.toJSON());
const back = NutritionSample.fromJSON(JSON.parse(stored));
```

## Workflow 2 — Requirement check with dimensional safety

```ts
import { Quantity, DimensionError } from "@vetwo/units";
import { nutritionMath } from "@vetwo/nutrition-units";

// Contribution computed by registered nutrition rules (engine execution).
const supplied = nutritionMath.calculate(intake, cpConcentration, "cp");
const required = Quantity.of(480, "g/day");

// Dimension mismatch throws instead of producing a wrong diet.
if (!supplied.hasSameDimension(required)) throw new DimensionError("g/day", "supplied");
const pct = (supplied.toBase().value / required.toBase().value) * 100;
```

## Workflow 3 — Feed-table row to plain-number coefficients

For optimizer input, resolve schema-driven quantities to plain numbers
(the optimizer itself lives outside these packages):

```ts
import { Quantity } from "@vetwo/units";
import { coefficientResolver, FeedSchemaLoader } from "@vetwo/nutrition-units";

const loader = new FeedSchemaLoader(schema); // JSON unit map → factories
const cpConc = loader.asFed("cp", row.cp); // Quantity, no literals
const oneUnitIntake = Quantity.of(1, "kg/day"); // decision-variable scale
const cpPerKg = coefficientResolver.getCoefficient(oneUnitIntake, cpConc, "cp"); // 80
```

`8%` of `1 kg` is `80 g` — derived by the engine, never by `/100` literals.
The resulting plain numbers may feed any external solver; no solver code
enters the libraries.

## Workflow 4 — Importing external/tabular data safely

```ts
import { mapTabularRowToNutritionMeasurement, handleUnknownNutrient } from "@vetwo/nutrition-units";

const m = mapTabularRowToNutritionMeasurement(csvRow, fieldMapping);
// Bad rows throw typed errors here — never enter the dataset as wrong numbers.
```

Register external code mappings explicitly
(`registerExternalNutrientMapping`) and decide the unknown-nutrient policy up
front rather than defaulting silently.

## Rules spanning all workflows

- Wrap at trust boundaries (file/API input), keep rich types through
  computation, convert/serialize at the edges.
- Never split a measurement into parallel `value`/`unit`/`nutrient`/`basis`
  variables between steps.
- Preserve `metadata.conversion` traces through every transformation.
- Failures (`MissingNutritionContextError`, `UnitMismatchError`, …) are data:
  handle them, don't swallow them.
