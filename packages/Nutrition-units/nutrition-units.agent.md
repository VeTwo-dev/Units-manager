# `@vetwo/nutrition-units` — AI Coding-Agent Guide

> Portable guidance. Copy this file into any TypeScript/JavaScript project that
> installs `@vetwo/nutrition-units` from npm. It assumes only the **published
> packages**, never any monorepo's internals. Requires `@vetwo/units`
> (installed automatically as a dependency).

## 1. Identity

`@vetwo/nutrition-units` is the **nutrition-domain semantic layer built on top
of `@vetwo/units`**. It adds nutrition meaning — nutrient identity, basis,
context, metadata/provenance, semantic compatibility, collections — to physical
quantities. All unit math, dimensional analysis, and uncertainty propagation
still belong to (and delegate to) `@vetwo/units`.

Install:

```sh
npm install @vetwo/units @vetwo/nutrition-units
```

Import from the public entrypoint only:

```ts
import {
  NutritionMeasurement,
  NutritionSample,
  createNutritionContext,
} from "@vetwo/nutrition-units";
import { Measurement, Quantity } from "@vetwo/units";
```

## 2. Nutrition vs Generic Units (the core distinction)

```text
@vetwo/units            = physical meaning  (dimensions, units, uncertainty)
@vetwo/nutrition-units  = nutrition meaning (nutrient, basis, context, provenance)
```

**Same physical unit ≠ same nutrient.** Crude protein (`cp`) at `10 g/kg` and
calcium (`ca`) at `10 g/kg` are physically compatible but nutritionally
**incompatible** — they must never be added, substituted, or interchanged.
The library enforces this via semantic compatibility checks, not dimensions.

```text
physical compatibility  — handled by @vetwo/units (dimensions)
nutrition compatibility — handled by @vetwo/nutrition-units (nutrient identity)
```

## 3. Decision: Which Library?

```text
Is this a nutrition-domain measurement?
│
├── No → use @vetwo/units (or another domain model).
│
└── Yes → does it need nutrient identity, basis, context, or provenance?
          │
          ├── No  → @vetwo/units alone may suffice (document why).
          │
          └── Yes → @vetwo/nutrition-units (+ @vetwo/units underneath).
```

## 4. Nutrient Identity (verified)

- Nutrients have stable canonical IDs with aliases, resolved case-insensitively:
  `cp` accepts `crudeProtein`, `protein`, `CP`; others include `ca`, `p`,
  `fe`, `de`, `me`, `ge`, `nel`, `vitA`, `vitD`.
- `NutrientKindRegistry` / `defaultNutrientKindRegistry` / `isNutrientKindId(id)`
  manage identity. `require(unknownId)` throws a typed error — never invent IDs.
- Compatibility: `checkNutrientCompatibility("cp", "ca")` → incompatible;
  `checkNutrientCompatibility("CP", "crudeProtein")` → compatible (alias-aware);
  `canConvert(...)` gates conversions; `assertNutrientCompatible(...)` throws.

DO NOT hard-code nutrient semantics as raw strings scattered through app code —
resolve through the registry and keep the `NutrientKind` on the measurement.

## 5. Nutrition Measurement Model (verified)

```text
NutritionMeasurement
├── Measurement     (@vetwo/units: value Quantity + uncertainty Quantity)
├── Nutrient        (NutrientKind: cp, ca, …)
├── Basis           (asFed, dryMatter, …)
├── Context         (optional NutritionContext: dry-matter info, …)
└── Metadata        (optional NutritionMetadata: provenance, …)
```

Construction (the `NutritionMeasurementOptions` contract is public API):

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
// Shorthand: value + unit + uncertainty in one call
const protein = NutritionMeasurement.from(9, "%", "cp", "asFed");
```

Rules: the first argument must be a real `Measurement` (else
`InvalidNutritionQuantityError`); unknown nutrient/basis IDs throw; a unit
from the wrong family throws `NutritionUnitCompatibilityError` (e.g. `ca`
in `MJ/kg`, `me` in `mg/kg`). Measurements are frozen — caller mutation of
the options object afterwards cannot corrupt them.

## 6. Nutrition Basis (verified)

Basis IDs: `asFed` (bare), `dryMatter` (`DM`), `freshMatter` (`FM`), `wet`
(`WB`), `normalized`. Aliases like `DM`/`dm`/`AF` resolve deterministically.

> **A basis conversion is NOT a unit conversion.** `asFed → dryMatter`
> rescales by the dry-matter fraction; it requires explicit context.

```ts
const dm = protein.convertBasis("dryMatter", ctx); // 9% @0.9 DM → 10%
```

`NutritionQuantity` offers the same (`of/from/to/withBasis/convertBasis/
convert`). Conversions preserve nutrient identity and record
`metadata.conversion` traceability. Legacy helpers
`BasisConverter.toAsFed / toDryMatterBasis` operate on plain `Quantity`
with an explicit dry-matter `Quantity`.

## 7. Nutrition Context (verified)

Context carries the dry-matter/moisture facts that make basis conversion safe:

```ts
createNutritionContext({ dryMatterFraction: 0.9 }); // moisture derived (0.1)
createNutritionContext({ moistureFraction: 0.1 }); // DM derived (0.9)
```

Rules: `0 < DM ≤ 1`, finite; `DM + moisture ≈ 1` within `1e-6`. Contexts are
frozen; derived `resolvedDryMatterFraction` / `resolvedMoistureFraction` are
always populated when either fraction is supplied.

- **Missing context** (conversion needs DM info, none provided) →
  `MissingNutritionContextError`. Never a silent `NaN` or plausible wrong number.
- **Malformed context** (non-object, forbidden `__proto__` keys, inconsistent
  DM+moisture, non-Measurement DM measurement, bad `sampleState`/metadata) →
  `InvalidNutritionContextError` (a subclass of `NutritionContextError`).
- Out-of-range fractions raise basis errors. Failed conversions never mutate
  the source object.

DO NOT invent dry-matter fractions. If the fraction is unknown, fail with the
typed error and ask for data — a guessed 0.9 is a silent-corruption bug.

## 8. Metadata and Provenance (verified)

`createNutritionMetadata` / `mergeNutritionMetadata` build frozen, validated
metadata. Known fields include `provenance.sourceId`, `reference`, `custom`,
method/sample/quality/detection-limit structures. **Unknown top-level keys are
dropped, not stored** — so only documented fields are reliable:

```ts
{ provenance: { sourceId: "lab-a" }, reference: "lot-42" }  // kept
{ source: "lab-a" }                                        // dropped!
```

Metadata is descriptive scientific context, not a LIMS. Forbidden keys
(`__proto__`, `constructor`, `prototype`) are rejected.

## 9. Semantic Safety (strongest rule)

```text
Same physical unit ≠ same nutrient. Never interchange on dimensions alone.
```

- `cp` vs `ca` at identical `g/kg`: incompatible.
- Vitamin A IU vs vitamin D IU at identical `IU/kg`: **not interchangeable**
  (activity units are nutrient-specific).
- Energy kinds are distinct identities: `ge` (gross), `de` (digestible),
  `me` (metabolizable), `nel` (net) — never substitute silently.
- Unit-family guardrails: minerals accept mass/molar/fraction/ppm families;
  energy nutrients accept energy-density only. Violations throw
  `NutritionUnitCompatibilityError`.
- `isNutrientCompatible` / `assertNutrientCompatible` /
  `assertSemanticCompatibility` are the gates — call them instead of comparing
  ID strings by hand.

## 10. Molar Values (verified)

`getMolarMass(nutrientId)` returns `number | undefined` (e.g. `ca` →
`40.078`); `convertMolarToMass` requires a nutrient **with** chemical
identity and throws without it (`cp` has none). Never invent molecular
weights — a missing molar mass is a typed error, not a default of 1.

## 11. Collections (verified)

```ts
import { NutritionSample, NutritionMeasurementSet } from "@vetwo/nutrition-units";
import type { NutritionSampleOptions } from "@vetwo/nutrition-units";

const sample = new NutritionSample({
  id: "sample-001", measurements: [calcium, protein],
} satisfies NutritionSampleOptions);
const grown = sample.withMeasurement(extra); // new instance; no mutation
const set = new NutritionMeasurementSet([...sample]);
set.get("ca");                 // single hit or undefined
set.get("ca", "asFed");        // basis-aware lookup
set.getAll("ca");              // all matches
set.getOrThrow("ca", "asFed"); // MeasurementNotFoundError | AmbiguousMeasurementError
set.has("zn"); set.add(m); set.remove("ca"); set.filter(...);
set.filterByNutrient("cp"); set.filterByBasis("dryMatter");
```

Duplicate nutrient+basis+unit entries are **ambiguous by design**: `get`
returns `undefined`, `getOrThrow` raises `AmbiguousMeasurementError` — never a
silent first-pick. Samples/sets are immutable and iterable;
`toJSON`/`fromJSON` round-trip deterministically (a time-ordered
`NutritionMeasurementSeries` of `SeriesPoint`s exists for replicates — inspect
its exports before use).

## 12. Serialization (verified)

`toJSON`/`fromJSON` on measurements, quantities, samples, sets, and series;
canonical JSON (`toCanonicalJson`/`fromCanonicalJson`,
`canonicalJsonStringify`), migrations (`registerMigration`), and tabular-row
mapping (`mapTabularRowToNutritionMeasurement`) for external data. Malformed
payloads (wrong version/type, forbidden keys) throw typed errors — never
default. Prefer these over ad-hoc formats.

## 13. Anti-Patterns

```ts
// ❌ Bare numbers with parallel nutrient strings (no identity, no basis).
const cp = 9;
const cpUnit = "%";

// ❌ Treating cp and ca as interchangeable (same g/kg ≠ same nutrient).

// ❌ Basis conversion without context, or with an invented DM fraction.

// ❌ Assuming every value is as-fed.

// ❌ Dropping provenance/metadata across a conversion boundary.

// ❌ Confusing nutrient identity with physical dimensions.

// ❌ Re-implementing %↔fraction, asFed↔DM, or IU logic by hand.

// ❌ Importing internals (".../dist/nutrition-quantity.js"). Use entrypoints.

// ❌ Putting formulation/optimization/HiGHS code in this package (see §14).
```

## 14. Critical Scope Boundary: NO Feed Formulation

`@vetwo/nutrition-units` is **NOT** a formulation engine. It must never
implement: feed/ration/diet formulation or balancing, least-cost formulation,
ingredient optimization/selection/allocation, animal/species requirement
calculations, linear programming, LP, MILP, nonlinear optimization,
optimization infrastructure, HiGHS, or solver infrastructure.

```text
Need formulation/optimization? → build a SEPARATE domain/application layer
that consumes @vetwo/nutrition-units measurements as input data.
```

The library provides the unit/measurement foundation a future optimizer may
consume; the optimizer itself lives elsewhere. If an agent proposes adding
solver code here, refuse and redirect.

## 15. Correct End-to-End Pattern (verified)

```ts
// 1. Options-typed construction with context + metadata
const calcium = NutritionMeasurement.of(
  Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(3, "mg/kg")),
  "ca",
  "asFed",
  { context: createNutritionContext({ dryMatterFraction: 0.9 }) },
);
// 2. Safe unit conversion (delegates to @vetwo/units)
const inGram = calcium.to("g/kg"); // 0.1 g/kg
// 3. Basis conversion with explicit context
const asDM = calcium.convertBasis("dryMatter", calcium.context);
// 4. Collection + lookup + serialization
const sample = new NutritionSample({ id: "s1", measurements: [calcium] });
const back = NutritionSample.fromJSON(JSON.parse(JSON.stringify(sample.toJSON())));
```

## 16. Error Handling (verified public errors)

All extend `UnitEngineError` (via `NutritionError`):

| Error                                                                                  | Meaning                                       |
| -------------------------------------------------------------------------------------- | --------------------------------------------- |
| `MissingNutritionContextError`                                                         | basis conversion needs DM info; none given    |
| `InvalidNutritionContextError`                                                         | malformed context object                      |
| `NutritionContextError`                                                                | base for context problems                     |
| `InvalidNutritionBasisError`                                                           | bad basis id/value                            |
| `UnsupportedBasisConversionError`                                                      | unsupported basis pair                        |
| `NutritionUnitCompatibilityError`                                                      | nutrient↔unit family mismatch                 |
| `InvalidNutrientKindError` / `UnknownNutrientError` / `AmbiguousNutrientError`         | identity problems                             |
| `IncompatibleNutrientError` / `NutrientSemanticMismatchError`                          | semantic mismatch                             |
| `InvalidNutritionQuantityError`                                                        | malformed quantity/measurement/sample payload |
| `DuplicateMeasurementError` / `MeasurementNotFoundError` / `AmbiguousMeasurementError` | collection problems                           |

Catch at trust boundaries; propagate from core logic.

## 17. Public API Boundary & Source of Truth

```text
DO:    import { ... } from "@vetwo/nutrition-units"
       import { ... } from "@vetwo/units"
DO NOT: import internal files of either package.
```

If this guide conflicts with the installed packages, the packages win.
Verify: (1) `node_modules/@vetwo/nutrition-units/dist/index.d.ts`,
(2) `package.json` exports, (3) READMEs, (4) tests/examples, (5) source last.
Never invent APIs.

## 18. Agent Workflow / Testing / Security / Performance

- Workflow: identify domain meaning → physical quantity? → nutrition
  semantics? → select layer → inspect public API → reuse abstractions →
  preserve dimensional+semantic safety → validate → test.
- Test: semantic compatibility/incompatibility, basis correctness with and
  without context (typed errors), metadata preservation, collection lookup
  incl. ambiguity, serialization round-trips, uncertainty preservation.
- Security: contexts/metadata/deserializers reject `__proto__`-style keys;
  validate external rows via the typed mapping APIs; never swallow validation
  errors; only claim protections the installed version documents.
- Performance: reuse registries/contexts, avoid repeated string parsing in hot
  paths, convert at the edges. No benchmark numbers claimed.

## 19. Relationship to `@vetwo/units`

```text
Application Domain
       │
       ▼
@vetwo/nutrition-units   (nutrition-domain meaning)
       │
       ▼
@vetwo/units             (physical meaning)
```

- `@vetwo/units` only: the problem is purely physical quantities.
- Both: any value with nutrient identity, basis, context, or provenance.
- `nutrition-units` builds on `units`; it never replaces it. Uncertainty,
  dimensions, conversion, and formulas always come from `@vetwo/units`.
  Full physical-quantity guidance: see `units.agent.md`.
