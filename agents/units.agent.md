# `@vetwo/units` — AI Coding-Agent Guide

> Portable guidance. Copy this file into any TypeScript/JavaScript project that
> installs `@vetwo/units` from npm. It assumes only the **published package**,
> never this monorepo's internals.

## 1. Identity

`@vetwo/units` is a **generic, domain-agnostic scientific units and
dimensional-analysis engine**. It models physical quantities, converts between
units, validates dimensions, propagates measurement uncertainty, evaluates
scientific formulas, and serializes values. It knows **nothing** about
nutrition, feed, medicine, or any other application domain.

Install:

```sh
npm install @vetwo/units
```

Import everything from the public entrypoint only:

```ts
import { Quantity, Measurement, parseUnit } from "@vetwo/units";
```

## 2. When to Use It

Use `@vetwo/units` when the value is a **physical/scientific quantity**:

- masses, lengths, times, temperatures, energies, concentrations, rates
- unit conversion (`kg → g`, `°C → K`, `% → fraction`)
- dimensional validation (refusing `m + s`)
- measured values with uncertainty (`100 ± 2 mg/kg`)
- scientific formulas over quantities (`force = mass × accel`)
- parsing unit expressions (`"kg*m/s^2"`) and formatting quantities
- deterministic serialization round-trips

## 3. When NOT to Use It

DO NOT force `Quantity` onto values that are not physical quantities:

- identifiers, names, codes, enums
- arbitrary counters, indexes, pagination offsets
- money stored as a plain ledger number (unless you genuinely model currency dimensions)
- booleans, timestamps-as-strings, free text

```text
number  ≠  physical quantity. Only wrap the latter.
```

## 4. API Selection Guide (verified public API)

```text
Need a physical quantity?            → Quantity.of(value, "kg")
Need conversion?                     → quantity.to("g"), quantity.toBase()
Need to parse a unit string?         → parseUnit("kg*m/s^2")
Need to display a value?             → formatQuantity(q), formatUnit(unit)
Need value + uncertainty?            → Measurement.of(valueQ, uncQ) / Measurement.exact(q)
Need serialization?                  → serializeQuantity / deserializeQuantity,
                                       serializeMeasurement / deserializeMeasurement,
                                       serializeUnit / deserializeUnit
Need a formula?                      → defineFormula(...) + compileFormula(...),
                                       Expression.* builders
Need an isolated unit set?           → createRegistry({ packs: [SI_PACK] })
Need semantic kind checks?           → quantity.withKind(...) + semantic-aware policies
```

Key signatures (verify against installed `.d.ts` if in doubt):

```ts
Quantity.of(value: number, unitSymbol: string | Unit, registry?: UnitRegistry): Quantity
quantity.to(target: string | Unit, registry?): Quantity
quantity.toBase(): Quantity
Measurement.of(value: Quantity, uncertainty: Quantity | number): Measurement
Measurement.exact(value: Quantity): Measurement
parseUnit(text: string, registry?, opts?): Unit
createRegistry(options?: { packs?: [...] }): UnitRegistry
```

## 5. Dimensional Safety Rules (critical)

- `add`/`subtract` require **identical dimensions**; mismatch throws the typed
  `UnitMismatchError`. Never catch-and-ignore it to "make it compile".
- `multiply`/`divide` derive dimensions automatically (`kg * m/s^2 → N`-shaped
  composites). The emitted composite unit's symbol, scale, and value always agree.
- `to()` between incompatible dimensions throws (`ImpossibleConversionError` family).
- `hasSameDimension(other)` is the explicit pre-check; `exactEquals` /
  `approximatelyEquals` compare within dimension.
- Scalar helpers exist: `scale(factor)`, `negate()`, `pow(n)`, `sqrt()`,
  `reciprocal()`. `divide(0)` throws `DivisionByZeroError`.

DO:

```ts
const total = Quantity.of(10, "kg").add(Quantity.of(500, "g")); // 10.5 kg
const grams = Quantity.of(25, "kg").to("g"); // 25000 g
```

DO NOT:

```ts
// @ts-expect-error or try/catch-and-ignore around this is always a bug:
Quantity.of(1, "m").add(Quantity.of(1, "s"));
```

## 6. Conversion Rules

- Convert with `.to(target)` / `.toBase()`. Never hand-write `* 1000` factors
  for units the library supports — that duplicates the engine and drifts.
- Temperature is special (verified semantics):
  - `K` is **linear** (an interval): `K + K`, `K × kg`, `K / 2` are meaningful.
  - `°C` / `°F` are **affine** (offset): `20°C + 10K = 30°C` works;
    `20°C − 10°C = 10 K` (a delta); `°C + °C`, `°C × 2`, `°C × kg` throw
    `InvalidAffineOperationError`.
- `isAffineUnit(u)` / `isAbsoluteTemperatureUnit(u)` expose the distinction;
  prefer them over string-matching unit symbols.

## 7. Measurement and Uncertainty

- `Measurement` = `Quantity` value + absolute-uncertainty `Quantity`.
  Uncertainty must be finite and non-negative; affine (offset) units are
  rejected for uncertainty.
- `relativeUncertainty()` exists but **throws for affine units** — use it only
  on linear-unit measurements.
- Arithmetic propagates uncertainty (addition in quadrature, relative
  quadrature for multiply/divide) via the same methods (`m1.add(m2)`).
- Comparisons/equality mirror `Quantity`. Never build a second uncertainty
  engine in application code; delegate to `Measurement`.

```ts
import { Measurement, Quantity } from "@vetwo/units";
const m = Measurement.of(Quantity.of(100, "g"), Quantity.of(2, "g"));
const exact = Measurement.exact(Quantity.of(100, "g"));
```

## 8. Serialization

- Use `serializeQuantity` / `deserializeQuantity`,
  `serializeMeasurement` / `deserializeMeasurement`,
  `serializeUnit` / `deserializeUnit`. Round-trips preserve value, unit, and
  dimension — prefer them over ad-hoc `{ value, unit }` JSON.
- Deserializers validate and throw typed errors on malformed payloads; never
  `eval` unit strings or blindly trust incoming JSON.
- Interop helpers (`toInterchange` / `fromInterchange`, canonicalization,
  migrations) exist for cross-system exchange — use them instead of inventing
  a wire format.

## 9. Anti-Patterns

```ts
// ❌ Parallel number + unit-string: no dimensional safety.
const mass = 25;
const unit = "kg";

// ❌ Manual conversion factors (drift, no validation).
const grams = kg * 1000;

// ❌ Stringly-typed units passed around instead of Quantity/Unit.

// ❌ Catching UnitMismatchError/ImpossibleConversionError and continuing
//    with a guessed value.

// ❌ Casting: `as unknown as Quantity`, `// @ts-ignore` around add/to.

// ❌ Importing internals: "@vetwo/units/dist/quantity.js". Use the entrypoint.

// ❌ Re-implementing conversion, parsing, or uncertainty in app code.

// ❌ Inventing unit symbols ("calorieX") or APIs not in the public exports.

// ❌ Using raw numbers where uncertainty matters (lab assays, sensors).
```

## 10. Correct Usage Patterns

```ts
import {
  Quantity,
  Measurement,
  parseUnit,
  formatQuantity,
  serializeQuantity,
  deserializeQuantity,
  createRegistry,
  SI_PACK,
} from "@vetwo/units";

// Quantity + conversion + formatting
const dose = Quantity.of(500, "mg").to("g"); // 0.5 g
console.log(formatQuantity(dose)); // "0.5 g"

// Measurement with uncertainty
const assay = Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(3, "mg/kg"));

// Parsing (throws typed errors on malformed input, never crashes)
const unit = parseUnit("kg*m/s^2");

// Serialization round-trip
const back = deserializeQuantity(JSON.parse(JSON.stringify(serializeQuantity(dose))));

// Isolated registry (packs are additive; default registry exists)
const si = createRegistry({ packs: [SI_PACK] });
const v = Quantity.of(1, "N", si).to("kg*m/s^2", si);
```

## 11. Error Handling (verified public errors)

All extend `UnitEngineError` (catch-all base):

| Error                                                                      | Meaning                                       |
| -------------------------------------------------------------------------- | --------------------------------------------- |
| `UnitMismatchError`                                                        | `add`/`subtract` across dimensions            |
| `ImpossibleConversionError` / `ConversionError`                            | `to()` across incompatible units              |
| `InvalidAffineOperationError`                                              | meaningless temperature ops (`°C+°C`, `°C×2`) |
| `DivisionByZeroError`                                                      | zero divisor                                  |
| `UnsupportedUnitError` / `InvalidUnitError` / `InvalidUnitExpressionError` | unknown/malformed units                       |
| `NumericalError`                                                           | non-finite/unsafe numeric results             |
| `FormulaError` / `ExpressionError` / `UnknownVariableError`                | formula problems                              |

Catch specific errors at trust boundaries (user input, file import); let
dimensional errors propagate from core logic — swallowing them produces
silently wrong science.

## 12. Public API Boundary

```text
DO:    import { ... } from "@vetwo/units"
DO NOT: import from "@vetwo/units/dist/..." or any internal file path.
```

Internal modules (`quantity.js`, `conversion-engine.js`, …) are
implementation details even when visible in the published file layout.

## 13. Source-of-Truth Rule

If this guide conflicts with the installed package, **the installed package wins**.
Verify in this order:

1. `node_modules/@vetwo/units/dist/index.d.ts` (TypeScript declarations)
2. `node_modules/@vetwo/units/package.json` (`exports`, version)
3. Official package README/docs
4. Tests/examples shipped or referenced by the docs
5. Implementation source — last resort, never an excuse to use internals

Never invent a missing API. If it is not exported, it does not exist for you.

## 14. Decision Tree

```text
Is this value a physical/scientific quantity?
│
├── No → ordinary application type (number/string/enum) is appropriate.
│
└── Yes → does it need units, conversion, or dimensional reasoning?
          │
          ├── No → a plain number may suffice (document why).
          │
          └── Yes → @vetwo/units (Quantity; +Measurement if uncertain).
```

## 15. Agent Workflow

1. Identify the domain meaning of each number (quantity vs. count vs. id).
2. Wrap quantities in `Quantity` at trust boundaries (input parsing, I/O).
3. Keep values as `Quantity` through calculations; convert only at the edges.
4. Use `Measurement` wherever uncertainty exists; never track `±` separately.
5. Validate with types (`hasSameDimension`, typed errors), not string checks.
6. Serialize with library serializers; deserialize with library validators.
7. Add tests: conversions, mismatch failures, round-trips, uncertainty.

## 16. Testing Guidance

- conversion correctness against hand-derived values (include offsets: `°C↔K`)
- incompatible-unit failures (`UnitMismatchError`, `ImpossibleConversionError`)
- affine rejections (`°C+°C`, `°C×2`, `°C×kg`)
- round-trip conversion (`a → b → a`) and serialization round-trips
- uncertainty propagation and exact-vs-approximate equality
- parser: malformed input throws typed errors, never crashes

## 17. Security and Safety Guidance

- Treat unit strings from users/files as **untrusted input**: parse with
  `parseUnit`, handle typed errors, never `eval` or template them into code.
- Validate deserialized payloads with the typed deserializers; reject
  malformed shapes instead of defaulting.
- Never swallow dimensional/conversion errors — a caught-and-ignored
  `UnitMismatchError` is a silent wrong-result bug.
- Only claim protections the installed version documents; re-verify per upgrade.

## 18. Performance Guidance

- Reuse parsed `Unit` / constructed `Quantity` objects in hot paths; the
  engine caches parse results and conversion plans.
- Prefer batching conversions over repeated string parsing in loops.
- Do not micro-optimize by bypassing the engine (manual factors reintroduce
  the bugs the library removes). No benchmark numbers are claimed here.

## 19. Relationship to `@vetwo/nutrition-units`

```text
Application Domain
       │
       ▼
@vetwo/nutrition-units   (nutrition-domain meaning: nutrient, basis, context)
       │
       ▼
@vetwo/units             (physical meaning: dimensions, units, uncertainty)
```

- Use `@vetwo/units` **only** when the problem is fundamentally about physical
  quantities with no nutrition semantics.
- Use `@vetwo/nutrition-units` **+** `@vetwo/units` when a quantity also
  carries nutrition meaning (nutrient identity, basis, context, provenance).
- `nutrition-units` builds on `units`; it never replaces it. See
  `nutrition-units.agent.md` for the domain layer.
