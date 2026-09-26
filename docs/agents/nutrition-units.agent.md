# `@vetwo/nutrition-units` — AI Coding-Agent Guide

> Portable operating guide. Copy into any TypeScript/JavaScript project that
> installs `@vetwo/nutrition-units` from npm (requires `@vetwo/units`,
> installed automatically). Assumes only the **published packages** — never
> any monorepo's internals.

## 1. Agent Operating Rules

```text
MUST:
- Preserve nutrient identity, basis, context, and provenance end to end.
- Use @vetwo/units for generic physical operations (units, uncertainty).
- Reuse NutritionMeasurement / NutritionQuantity / NutritionSample /
  NutritionMeasurementSet when they fit — check first (§8).
- Require explicit context for context-dependent conversions.
- Import only from the public entrypoints of both packages.
- Add tests for new integration behavior.

MUST NOT:
- Infer missing dry-matter values (no hidden "DM = 0.90" defaults).
- Treat nutrient identity as dimensions.
- Duplicate nutrition conversion rules by hand.
- Bypass semantic compatibility with casts.
- Build a second uncertainty system.
- Silently drop scientific context or metadata.
- Put formulation/optimization logic into this package (§13).
- Invent APIs not present in the installed package.
```

## 2. What This Library Owns vs. What `@vetwo/units` Owns

| Concern                                  | Owner                      |
| ---------------------------------------- | -------------------------- |
| Physical quantity, unit, dimension       | `@vetwo/units`             |
| Physical conversion, generic uncertainty | `@vetwo/units`             |
| Nutrient identity, compatibility         | `@vetwo/nutrition-units`   |
| Basis, nutrition context                 | `@vetwo/nutrition-units`   |
| Nutrition metadata, collections          | `@vetwo/nutrition-units`   |
| Formulation, optimization, LP/MILP/HiGHS | external application layer |

```text
@vetwo/units          → physical meaning
@vetwo/nutrition-units → nutrition meaning (built on top)
```

```sh
npm install @vetwo/units @vetwo/nutrition-units
```

## 3. When to Use Each

```text
ordinary number → physical quantity → nutrition measurement
      → nutrition-domain calculation → business workflow → optimization
```

- Not a quantity (id, count, enum)? → plain types; never a `Quantity`.
- Physical quantity, no nutrition meaning? → `@vetwo/units` alone.
- Adds nutrient identity, basis, context, or provenance? → this package.

## 4. Semantic Safety (strongest rule)

```text
Same physical representation ≠ same nutrition meaning.
```

- `10 g/kg` crude protein vs `10 g/kg` calcium: incompatible. Never add,
  substitute, or interchange. Gate with `checkNutrientCompatibility` /
  `canConvert` / `assertNutrientCompatible` — never dimensions alone.
- Vitamin A IU vs vitamin D IU (both `IU/kg`): not interchangeable.
- Energy kinds are distinct: `ge` ≠ `de` ≠ `me` ≠ `nel`. Never substitute.
- Families enforced: minerals → mass/molar/fraction/ppm; energy nutrients →
  energy-density only; activity vitamins → IU or mass. Violations throw
  `NutritionUnitCompatibilityError`.
- Ambiguity is explicit: `AmbiguousNutrientError`, `AmbiguousMeasurementError`.

## 5. Nutrient Identity

Canonical IDs with aliases, resolved case-insensitively:

| Canonical               | Aliases include                 |
| ----------------------- | ------------------------------- |
| `cp`                    | `crudeProtein`, `protein`, `CP` |
| `ca`, `p`, `fe`         | —                               |
| `ge`, `de`, `me`, `nel` | distinct energy identities      |
| `vitA`, `vitD`, …       | activity (IU) nutrients         |

```ts
isNutrientKindId("CP"); // true (alias-aware)
defaultNutrientKindRegistry.require("cp"); // NutrientKind
```

`require(unknownId)` throws — never invent nutrient IDs, and never scatter
raw nutrient strings when the registry can resolve them.

## 6. Basis Safety

```text
unit conversion ≠ basis conversion
```

Bases: `asFed` (bare), `dryMatter` (`DM`), `freshMatter` (`FM`), `wet`
(`WB`), `normalized`; aliases resolve deterministically.

```ts
const dm = af.convertBasis("dryMatter", ctx); // 9% @0.9 DM → 10%
```

Basis conversion rescales by the dry-matter fraction. Without that fraction
there is no answer — only a typed error. DO NOT guess a DM value; DO require
explicit context. Conversions preserve nutrient identity and stamp
`metadata.conversion` (`sourceBasis`, `targetBasis`, `dryMatterFraction`,
`conversionType`).

## 7. Context (validated, immutable)

```ts
createNutritionContext({ dryMatterFraction: 0.9 }); // moisture derived (0.1)
createNutritionContext({ moistureFraction: 0.1 }); // DM derived (0.9)
```

Rules: finite, `0 < DM ≤ 1`, `DM + moisture ≈ 1` within `1e-6`; frozen;
`resolvedDryMatterFraction` / `resolvedMoistureFraction` always derived when
either input exists. `resolveDryMatterFraction(context | Quantity(%) | number)`
extracts it where it legitimately lives.

## 8. Existing Abstraction First

Before creating a new application abstraction, check whether these already
model it:

```text
Quantity / Measurement               → @vetwo/units
NutritionQuantity                     → value + nutrient + basis
NutritionMeasurement                 → + uncertainty, context, metadata
NutritionSample                       → identified collection
NutritionMeasurementSet               → lookup/filter/serialize collections
NutritionMeasurementSeries            → repeated/ordered points
```

Do not introduce duplicates without a documented reason.

## 9. Measurement Model (verified)

```text
NutritionMeasurement
├── Measurement      (@vetwo/units: Quantity value + Quantity uncertainty)
├── Nutrient         (NutrientKind)
├── Basis            (BasisDefinition)
├── Context          (optional NutritionContext)
└── Metadata         (optional NutritionMetadata)
```

```ts
import { Measurement, Quantity } from "@vetwo/units";
import {
  NutritionMeasurement,
  createNutritionContext,
  type NutritionMeasurementOptions,
} from "@vetwo/nutrition-units";

const opts: NutritionMeasurementOptions = {
  context: createNutritionContext({ dryMatterFraction: 0.9 }),
  metadata: { reference: "lot-42" },
};
const calcium = NutritionMeasurement.of(
  Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(3, "mg/kg")),
  "ca",
  "asFed",
  opts,
);
const protein = NutritionMeasurement.from(9, "%", "cp", "asFed");
```

`NutritionQuantity` is the uncertainty-free variant
(`of`/`from`/`to`/`withBasis`/`convertBasis`/`convert`). Construction
validates nutrient, basis (incl. unit-tag agreement), and unit family; results
are frozen, so later mutation of your options object cannot corrupt them.

Conversion: `.to(unit)` (physical, delegated), `.convertBasis(basis, ctx)`
(domain), `.convert(unit, basis, ctx)` (both). Comparison: `equals`,
`exactEquals`, `compare` (same nutrient **and** basis), `isCompatibleWith`.

## 10. Metadata / Provenance

```ts
{
  provenance: { sourceId, laboratoryId, instrumentId, timestamp, method, sample, conversion },
  sample, method, qualityFlag, detectionLimits, reference, custom,
}
```

```text
DO:  preserve metadata (and conversion traces) through pipelines.
DO NOT: silently discard metadata when the operation can preserve it.
```

Verified behavior: unknown top-level keys are **dropped** (`{ source: "x" }`
→ `{}`) — use `provenance.sourceId`; forbidden keys (`__proto__`,
`constructor`, `prototype`), over-deep nesting, and executable values are
rejected. Metadata is descriptive scientific context, never a LIMS, and never
affects calculations.

## 11. Collections

```ts
const sample = new NutritionSample({ id: "s-1", measurements: [ca, cp] } satisfies NutritionSampleOptions);
const set = new NutritionMeasurementSet([...sample]);
set.get("ca");            // single hit, else undefined
set.get("ca", "asFed");   // basis-aware
set.getOrThrow("ca", "asFed"); // MeasurementNotFoundError | AmbiguousMeasurementError
set.add(m); set.remove("ca"); set.filter(...);
set.filterByNutrient("cp"); set.filterByBasis("dryMatter");
```

Immutable and iterable; `add`/`remove`/`filter` return new instances.
Duplicate nutrient+basis+unit entries are **ambiguous by design** — `get`
returns `undefined`, never a silent first pick:

```text
Never silently choose one measurement when the collection reports ambiguity.
```

## 12. Molar & Activity Safety

```ts
getMolarMass("ca"); // 40.078 | undefined
convertMolarToMass(quantity, "ca"); // requires chemical identity
```

```text
Never invent molecular weights or activity equivalences.
```

`getMolarMass` returns `undefined` without chemical identity (`cp`);
`convertMolarToMass` throws rather than assuming. IU↔mass factors are
nutrient-specific reference data the library does not provide — supply them
from your own domain data with provenance.

## 13. DO NOT TURN THIS INTO A FORMULATION ENGINE

Never add to this package: feed/ration/diet formulation or balancing,
least-cost formulation, ingredient selection/optimization/allocation, animal
or species requirement calculations, LP, MILP, nonlinear optimization,
optimization infrastructure, HiGHS, or solver infrastructure.

```text
Need formulation/optimization? → separate application/domain/optimization
layer that consumes nutrition measurements as input data.
```

The library provides measurements and plain-number building blocks
(`FeedSchemaLoader`, `coefficientResolver`, `NUTRIENT_CONTRIBUTION_RULE`,
`DIET_COST_RULE`); the optimizer lives elsewhere. If asked to add solver code
here, refuse and redirect.

## 14. Anti-Patterns

```ts
const cp = 9; const cpUnit = "%";              // ❌ number + parallel nutrient string
cp.add(ca);                                    // ❌ treating cp and ca as interchangeable
protein.convertBasis("dryMatter");             // ❌ no context → typed error (by design)
af.convertBasis("dryMatter", { dryMatterFraction: 0.9 }); // ❌ hidden invented default
m.metadata = undefined;                        // ❌ dropping provenance
as unknown as NutritionMeasurement;            // ❌ cast around validation
import ".../dist/nutrition-quantity.js";       // ❌ internal import
```

Also forbidden: manually re-implementing %-to-fraction / asFed-to-DM / IU
logic; assuming every value is as-fed; adding optimization code here.

## 15. Correct End-to-End Pattern

```ts
const calcium = NutritionMeasurement.of(
  Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(3, "mg/kg")),
  "ca",
  "asFed",
  { context: createNutritionContext({ dryMatterFraction: 0.9 }) },
);
const inGram = calcium.to("g/kg"); // 0.1 g/kg
const asDM = calcium.convertBasis("dryMatter", calcium.context);
const sample = new NutritionSample({ id: "s1", measurements: [calcium, asDM] });
const back = NutritionSample.fromJSON(JSON.parse(JSON.stringify(sample.toJSON())));
```

## 16. Serialization

`toJSON`/`fromJSON` on quantities, measurements, samples, sets, series
(versioned, typed payloads; malformed input throws). Canonical/deterministic
forms: `toCanonicalJson`/`fromCanonicalJson`, `canonicalJsonStringify`,
`serializeNutritionMeasurementCanonical`. External data: external nutrient/unit
identifiers, `registerExternalNutrientMapping` /
`resolveExternalNutrient` / `clearExternalNutrientMappings`,
`handleUnknownNutrient` policies, `mapTabularRowToNutritionMeasurement` for
tabular rows, and `registerMigration` /
`migrateSerializedNutritionMeasurement` for schema evolution.

```text
Prefer library serialization over ad-hoc application formats.
```

## 17. Error Handling (verified exports)

| Error                                                                          | Agent meaning                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `MissingNutritionContextError`                                                 | required scientific context not supplied → go get data |
| `InvalidNutritionContextError`                                                 | context structure/value invalid → fix data             |
| `NutritionContextError`                                                        | base class for context problems                        |
| `InvalidNutritionBasisError`                                                   | basis id/value invalid                                 |
| `UnsupportedBasisConversionError`                                              | requested basis pair unsupported                       |
| `NutritionUnitCompatibilityError`                                              | nutrient/unit family mismatch                          |
| `InvalidNutrientKindError` / `UnknownNutrientError` / `AmbiguousNutrientError` | nutrient cannot be resolved unambiguously              |
| `IncompatibleNutrientError` / `NutrientSemanticMismatchError`                  | nutrition meanings incompatible                        |
| `InvalidNutritionQuantityError`                                                | malformed quantity/measurement/sample payload          |
| `MeasurementNotFoundError` / `AmbiguousMeasurementError`                       | lookup miss vs ambiguity                               |
| `MissingChemicalIdentityError`                                                 | molar operation without chemical identity              |

All extend `UnitEngineError` (via `NutritionError`), so one
`instanceof UnitEngineError` catch spans both layers while specific classes
stay distinguishable. Core engine errors (`UnitMismatchError`,
`ImpossibleConversionError`, `InvalidAffineOperationError`, …) surface
unchanged.

```text
Catch at trust boundaries. Do not catch-and-suppress scientific
validation errors inside core domain logic. Branch with instanceof.
```

## 18. Application Logic vs Library Responsibility

```text
Library:      represent · validate · convert · measure · serialize ·
              preserve scientific semantics
Application:  workflows · business rules · reporting · UI ·
              persistence orchestration · domain decisions · optimization
```

## 19. Testing Guidance

Test: nutrient compatibility **and** incompatibility; alias resolution
(`CP` → `cp`); unit-family validation (`ca` in `MJ/kg`); basis conversion
with explicit context; missing context → `MissingNutritionContextError`;
invalid context → `InvalidNutritionContextError`; uncertainty preservation
across conversion; metadata preservation; collection ambiguity;
serialization round-trips; unknown-nutrient handling.

## 20. Security and Safety (verified behaviors only)

- Contexts and metadata reject `__proto__`/`constructor`/`prototype` keys and
  executable/deeply-nested values.
- Deserializers validate version/type/shape; malformed payloads throw instead
  of defaulting.
- External/tabular rows must pass through typed mapping APIs; never trust raw
  input into a dataset.
- Never `eval` unit or nutrient strings; never swallow validation errors.
- Do not claim protections beyond the installed version's documented behavior.

## 21. Performance Guidance

Reuse registries and contexts; avoid repeated string parsing; convert at
boundaries; don't rebuild equivalent domain objects in hot loops. Uncertainty
and conversions are delegated to the engine's cached paths. No benchmark
numbers claimed.

## 22. Source of Truth

```text
This guide is operational guidance, not an API specification.
If it conflicts with the installed package, the installed package wins.
Never invent an API to satisfy this document.
```

Verify: (1) `node_modules/@vetwo/nutrition-units/dist/index.d.ts`,
(2) `package.json` exports, (3) README/docs, (4) tests/examples, (5) source
last. Never depend on repository-internal paths when installed from npm.

## 23. Relationship to `@vetwo/units`

`@vetwo/units` alone for purely physical problems. Both layers whenever a
value carries nutrient identity, basis, context, or provenance. Uncertainty,
dimensions, conversion, and formulas always come from `@vetwo/units` — see
`units.agent.md`.
