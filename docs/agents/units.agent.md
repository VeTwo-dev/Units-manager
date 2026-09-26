# `@vetwo/units` — AI Coding-Agent Guide

> Portable operating guide. Copy this file into any TypeScript/JavaScript
> project that installs `@vetwo/units` from npm. It assumes only the
> **published package** — never any monorepo's internals.

## 1. Agent Operating Rules

```text
MUST:
- Reuse existing public abstractions (Quantity, Measurement, parsers, serializers).
- Inspect the installed public API before guessing (see §22).
- Preserve dimensional safety; never bypass validation to make code compile.
- Use the public package entrypoint "@vetwo/units" exclusively.
- Add tests for new integration behavior.

MUST NOT:
- Invent APIs not present in the installed package.
- Import internal files (e.g. "@vetwo/units/dist/quantity.js").
- Duplicate unit/conversion/uncertainty logic in application code.
- Bypass validation with casts (as any, as Quantity, @ts-ignore).
- Swallow dimensional or conversion errors into guessed values.
- Model non-physical values (ids, counters, enums) as Quantity.
```

## 2. Identity

`@vetwo/units` is a **generic, domain-agnostic scientific units and
dimensional-analysis engine**: physical quantities, unit conversion,
dimensional validation, measurement uncertainty, scientific formulas,
serialization. It knows **nothing** about nutrition, feed, medicine, or any
application domain.

```sh
npm install @vetwo/units
```

```ts
import { Quantity, Measurement, parseUnit } from "@vetwo/units";
```

## 3. When to Use `@vetwo/units`

A value is in scope when it is a **physical/scientific quantity**: masses,
lengths, times, temperatures, energies, concentrations, rates — anything
needing units, conversion, dimensional reasoning, uncertainty, or scientific
formulas. Also in scope: parsing unit expressions (`"kg*m/s^2"`), formatting
quantities, deterministic serialization round-trips.

## 4. When Not to Use It

```text
DO NOT wrap: identifiers, names, codes, enums, counters, indexes,
pagination offsets, plain ledger money, booleans, free text.
```

```text
ordinary number → physical quantity → (nutrition measurement → …)
```

Only ascend this ladder when the value genuinely gains the next level of
meaning. An arbitrary integer ID must never become a `Quantity`.

## 5. Decision Tree

```text
Is this value a physical/scientific quantity?
│
├── No → ordinary application type (number/string/enum).
│
└── Yes → needs units, conversion, or dimensional reasoning?
          │
          ├── No → plain number may suffice (document why).
          │
          └── Yes → @vetwo/units: Quantity (+Measurement if uncertain).
```

## 6. Responsibility / Ownership

| Concern                                  | Owner                                     |
| ---------------------------------------- | ----------------------------------------- |
| Physical quantities, units, dimensions   | `@vetwo/units`                            |
| Generic conversion (linear + affine)     | `@vetwo/units`                            |
| Measurement + uncertainty (all math)     | `@vetwo/units`                            |
| Formulas, expressions, dependency graphs | `@vetwo/units`                            |
| Parsing, formatting, serialization       | `@vetwo/units`                            |
| Unit systems, packs, standards profiles  | `@vetwo/units`                            |
| Constants, statistics over measurements  | `@vetwo/units`                            |
| Nutrient identity, basis, context        | `@vetwo/nutrition-units` (separate layer) |
| Workflows, UI, persistence, optimization | application (never this library)          |

## 7. API Selection Guide (verified)

```text
Physical quantity?            → Quantity.of(value, "kg")
Conversion?                   → quantity.to("g"), quantity.toBase()
Parse a unit string?          → parseUnit("kg*m/s^2")
Display?                      → formatQuantity(q), formatUnit(unit)
Value + uncertainty?          → Measurement.of(valueQ, uncQ) / Measurement.exact(q)
Persist?                      → serializeQuantity / deserializeQuantity (+Measurement/Unit variants)
Repeatable computation?       → defineFormula + compileFormula, Expression.* builders
Isolated unit set?            → createRegistry({ packs: [SI_PACK] })
Kind-strict checks?           → quantity.withKind(...) / requireKind(...)
```

Verified signatures (re-check against installed `.d.ts` on doubt):

```ts
Quantity.of(value: number, unitSymbol: string | Unit, registry?: UnitRegistry): Quantity
quantity.to(target: string | Unit, registry?): Quantity
Measurement.of(value: Quantity, uncertainty: Quantity | number): Measurement
parseUnit(text: string, registry?, opts?): Unit
createRegistry(options?: { packs?: [...] }): UnitRegistry
```

## 8. Quantity and Unit Usage

```ts
const mass = Quantity.of(25, "kg"); // value + unit, together
const total = mass.add(Quantity.of(500, "g")); // 25.5 kg, new object
const grams = Quantity.of(25, "kg").to("g"); // 25000 g
```

`Quantity` is immutable; every operation returns a new object. `Q()` is an
equivalent factory alias. `withKind(kindId)` tags semantic kinds;
`requireKind(kindId)` asserts them (`IncompatibleQuantityKindError` on
mismatch). `toString()` renders `"25 kg"`-style output.

## 9. Dimensional Safety (critical)

```text
compatible dimensions ≠ arbitrary numeric compatibility
```

- `add`/`subtract` require **identical dimensions** → else `UnitMismatchError`.
- `multiply`/`divide` derive dimensions automatically; emitted composite
  units keep symbol, scale, and value in agreement.
- `to()` across dimensions → `ImpossibleConversionError` family.
- Pre-check with `hasSameDimension(other)`; compare with `exactEquals` /
  `approximatelyEquals` (tolerance-aware), `lessThan` / `greaterThan` / …,
  `isZero` / `isPositive` / `isNegative`.

DO NOT: add/subtract across dimensions, catch-and-ignore `UnitMismatchError`,
cast incompatible values into compatible types, or coerce units silently.

## 10. Conversion

Convert with `.to(target)` / `.toBase()`; incompatible targets throw — never
hand-write `* 1000` factors for supported units. Plans are cached
(`getConversionPlan` / `convertWithPlan`); logarithmic/custom conversions are
refused (`UnsupportedTransformationError`) because they need an explicit
context model. Verified edge cases:

- `K` is **linear** (interval): `K + K`, `K × kg`, `K / 2` are meaningful.
- `°C` / `°F` are **affine** (offset): `20°C + 10K = 30°C`;
  `20°C − 10°C = 10 K` (delta); `°C + °C`, `°C × 2`, `°C × kg` throw
  `InvalidAffineOperationError`.
- `isAffineUnit(u)` / `isAbsoluteTemperatureUnit(u)` expose the distinction —
  prefer them over string-matching symbols.

## 11. Derived Quantities

`multiply`/`divide` produce derived dimensions automatically
(`kg·m/s²`-shaped composites); `pow(n)`, `sqrt()`, `reciprocal()`,
`negate()`, `scale(factor)` build powers, roots, inverses, and multiples.
`divide(0)` (scalar or zero-valued quantity) throws `DivisionByZeroError`.
Dimensionless results (`m/m`, `% → fraction`) are first-class quantities.

## 12. Parsing and Formatting

```ts
parseUnit("kg*m/s^2"); // atomic, prefixed (mg, µm), composite, dimensionless
formatQuantity(Quantity.of(12.5, "kg")); // "12.5 kg"
```

Parsing is cached on hot paths, offers strict mode, and throws typed errors
(`InvalidUnitExpressionError`, `UnsupportedUnitError`) on malformed input —
never crashes. There is no `currency` unit: unknown symbols throw; domain
extensions define their own (e.g. `cur`).

## 13. Measurement and Uncertainty

```text
@vetwo/units owns the generic measurement/uncertainty model. Do not build a second one.
```

```ts
const m = Measurement.of(Quantity.of(100, "g"), Quantity.of(2, "g"));
const exact = Measurement.exact(Quantity.of(100, "g"));
```

- Uncertainty is absolute, finite, non-negative; affine units rejected.
- `relativeUncertainty()` throws for affine units — linear units only.
- Arithmetic propagates automatically (quadrature for sums, relative
  quadrature for products, incl. reciprocals); `equals`/`exactEquals`/
  `approximatelyEquals` mirror `Quantity`.
- `MeasurementSeries`, `CovarianceMatrix`, `combineUncertainties`, and
  `propagateWithCovariance` cover repeated observations — use them before
  hand-rolling statistics. Confidence-interval/metadata support exists on
  measurements; inspect `MeasurementMetadata` in the installed `.d.ts`.

## 14. Formula / Scientific Computation APIs

```ts
const expr = Expression.multiply(Expression.variable("mass"), Expression.variable("accel"));
const compiled = compileExpression(expr);
compiled.evaluate({ mass: Quantity.of(10, "kg"), accel: Quantity.of(9.81, "m/s^2") });
```

- `defineFormula({ id, expression, inputs, outputName }, { registry })`
  validates dimensions up front; `compileFormula` evaluates `Quantity` or
  `Measurement` bindings (uncertainty propagates).
- `CalculationRuleRegistry` (`register` / `resolve` / `run`) hosts named
  domain rules; missing rules throw `RuleNotFoundError`.
- Function registry holds safe named functions only — no arbitrary execution.
- `DependencyGraph` evaluates chains, fan-outs, diamonds deterministically.

## 15. Serialization

```ts
const back = deserializeQuantity(JSON.parse(JSON.stringify(serializeQuantity(q))));
```

Prefer `serializeQuantity` / `deserializeQuantity`,
`serializeMeasurement` / `deserializeMeasurement`,
`serializeUnit` / `deserializeUnit` (+ constant-registry variants) over ad-hoc
formats. Deserializers validate (wrong version/type, forbidden keys →
typed errors). For cross-system exchange use `toInterchange` /
`fromInterchange`, canonical keys (`canonicalUnitKey`, `unitExprKey`,
`equivalentUnits`), namespaced symbols (`"si:kg"`), and `migrateSerialized`
chains. Guards `isQuantity` / `isUnit` are cross-realm safe.

## 16. Error Handling

All errors extend `UnitEngineError`. Verified classes include:
`UnitMismatchError`, `ImpossibleConversionError`/`ConversionError`,
`InvalidAffineOperationError`, `DivisionByZeroError`, `UnsupportedUnitError`,
`InvalidUnitError`, `InvalidUnitExpressionError`, `InvalidDimensionError`,
`NumericalError`, `InvalidMeasurementError`,
`UnsupportedTransformationError`, `RuleNotFoundError`, `FormulaError`/
`ExpressionError`/`UnknownVariableError`/`ExpressionLimitError`,
`IncompatibleQuantityKindError`, `AmbiguousUnitError`, `ExtensionError`,
`MigrationError`, `CyclicDependencyError`.

```text
Catch specific errors at trust boundaries (input, files, APIs).
Propagate dimensional errors from core logic — swallowing them
produces silently wrong science. Branch with instanceof, never
message string-matching.
```

## 17. Anti-Patterns

```ts
const weight = 25; const unit = "kg";   // ❌ parallel number + unit string
const grams = kg * 1000;                // ❌ manual conversion factor
quantity as unknown as Quantity;        // ❌ cast to bypass validation
import ... from "@vetwo/units/dist/quantity.js";  // ❌ internal import
```

Also forbidden: stringly-typed units, duplicated conversion tables, parallel
`Quantity` re-implementations, swallowed unit errors, invented symbols/APIs,
raw numbers where uncertainty matters.

## 18. Correct Usage Patterns

See §8, §10, §12–§15 examples. Standing pattern:

```text
DO:  wrap at trust boundaries → keep Quantity through computation →
     convert/serialize at the edges.
DO NOT: destructure into { value, unit } pairs and reassemble later.
```

## 19. Testing Guidance

Test: hand-derived conversions (incl. `°C↔K` offsets), mismatch failures,
affine rejections, round-trip conversion + serialization, uncertainty
propagation, exact-vs-approximate equality, parser malformed-input behavior.

## 20. Security and Safety

Unit strings and payloads are untrusted input: parse/deserialize through
typed APIs, handle their errors, never `eval`. Never swallow dimensional
errors. Claim only protections the installed version documents.

## 21. Performance Guidance

Reuse parsed `Unit`/`Quantity` objects and compiled expressions in hot paths
(parse results and conversion plans are cached); batch conversions; convert
at boundaries. No benchmark numbers are claimed here.

## 22. Public API / Source of Truth

```text
This guide is operational guidance, not an API specification.
If it conflicts with the installed package, the installed package wins.
Never invent an API to satisfy this document.
```

Verify: (1) `node_modules/@vetwo/units/dist/index.d.ts`, (2) `package.json`
exports, (3) README/docs, (4) tests/examples, (5) source last. Never depend
on repository-internal paths when installed from npm.

## 23. Agent Workflow

1. Classify each number (quantity vs count vs id) per §5.
2. Wrap quantities at trust boundaries; keep them through computation.
3. Use `Measurement` wherever uncertainty exists.
4. Validate with types, serialize with library serializers.
5. Test conversions, failures, round-trips, uncertainty.

## 24. Relationship to nutrition-units

```text
Application Domain → @vetwo/nutrition-units → @vetwo/units
```

Use `@vetwo/units` alone for purely physical problems. When a quantity also
carries nutrition meaning (nutrient, basis, context, provenance), layer
`@vetwo/nutrition-units` on top — it never replaces this engine. See
`nutrition-units.agent.md`.
