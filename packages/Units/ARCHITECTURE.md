# Architecture — @vetwo/units

This document explains how `@vetwo/units` is built internally and the
design decisions behind it. It's written for contributors and for anyone
integrating the package who wants to understand _why_ it behaves the way
it does, not just _what_ the API is (see [`README.md`](./README.md) for
that).

---

## Table of contents

- [Design goal](#design-goal)
- [The core idea: dimension vectors](#the-core-idea-dimension-vectors)
- [Folder structure](#folder-structure)
- [File responsibilities](#file-responsibilities)
- [How a unit string becomes a `Quantity`](#how-a-unit-string-becomes-a-quantity)
- [How `multiply()`/`divide()` compute a new dimension](#how-multiplydivide-compute-a-new-dimension)
- [Why basis tags (`% DM`) live outside dimensional analysis](#why-basis-tags--dm-live-outside-dimensional-analysis)
- [Error hierarchy](#error-hierarchy)
- [The `CalculationRuleRegistry` extension point](#the-calculationruleregistry-extension-point)
- [Dependency graph](#dependency-graph)
- [SOLID justification](#solid-justification)
- [What this package deliberately does NOT do](#what-this-package-deliberately-does-not-do)
- [Extending to a new scientific domain](#extending-to-a-new-scientific-domain)

---

## Design goal

Provide a **domain-agnostic** unit and dimensional-analysis engine that:

- Never lets two incompatible quantities combine silently (no adding mass
  to energy, no comparing `g/day` to `Mcal/day`).
- Handles composite/derived units (`Mcal/kg`, `IU/day`, `mg/kg`) through
  genuine dimensional algebra instead of hand-written special cases.
- Contains **zero** raw conversion constants outside a single, documented
  file.
- Can be published standalone and reused by any domain package — nutrition,
  chemistry, physics, finance — without modification.

Every design decision below serves one of these four goals.

---

## The core idea: dimension vectors

Instead of hard-coding "kg is compatible with g" and "Mcal/kg times kg
gives Mcal" as special cases, the engine represents **every unit as a
vector of integer exponents over an extensible registry of named base
dimensions** (see [`docs/DIMENSION_SPEC.md`](./docs/DIMENSION_SPEC.md)):

| Symbol      | Base dimension                                         |
| ----------- | ------------------------------------------------------ |
| `M`         | Mass                                                   |
| `L`         | Length                                                 |
| `T`         | Time                                                   |
| `Temp`      | Temperature                                            |
| `Substance` | Amount of substance                                    |
| `I`         | Electric current                                       |
| `J`         | Luminous intensity                                     |
| `E`         | Energy (generic engine dimension)                      |
| `C`         | Currency (generic engine dimension)                    |
| `N`         | Count / biological activity (generic engine dimension) |

New base dimensions are added via the `DimensionRegistry` at runtime —
the algebra never branches on particular ids.

```
kg        → { M: 1 }
kg/day    → { M: 1, T: -1 }
Mcal/kg   → { E: 1, M: -1 }
IU/kg     → { N: 1, M: -1 }
%, ppm    → {}                (dimensionless ratio)
```

Multiplying two quantities **adds** their exponent vectors; dividing
**subtracts** them. This one rule is what makes `CP% × kg/day → g/day`,
`Fe(mg/kg) × kg/day → mg/day`, and `Mcal/kg × kg/day → Mcal/day` all work
through the exact same code path (`Quantity.multiply()`), with no
per-nutrient or per-unit-type branching anywhere.

This is the same technique used by mature dimensional-analysis libraries
(Pint in Python, Boost.Units in C++, F#'s units-of-measure) — the engine
doesn't invent new theory, it applies a well-established one generically.

---

## Folder structure

```
src/
  dimension.ts                # dimension vector algebra (multiply/divide/compare)
  unit.ts                     # the Unit value type
  units/
    atomic-units.ts           # ⚠️ the ONLY file allowed to contain raw conversion constants
  unit-registry.ts            # registry of atomic units, extensible at runtime
  unit-parser.ts              # string -> Unit, composes atomics generically
  quantity.ts                 # Quantity value object + all dimensionally-safe math
  guards.ts                   # runtime type guards
  formatter.ts                # Quantity -> display string
  serializer.ts                # Quantity <-> JSON
  calculation-rule-registry.ts # generic named-rule registry (extension point for domain packages)
  testing.ts                  # assertion helpers for consumers' test suites
  errors/
    index.ts                  # the full error hierarchy
  index.ts                    # public API surface — the only import path consumers should use
```

---

## File responsibilities

| File                           | Single responsibility                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `dimension.ts`                 | Represent dimensions as exponent vectors; multiply/divide/compare them; nothing else. |
| `units/atomic-units.ts`        | Define every built-in atomic unit and its factor to its dimension's base unit.        |
| `unit.ts`                      | The `Unit` value type — symbol, dimension, factor, optional basis tag.                |
| `unit-registry.ts`             | Hold/lookup atomic units; the extension point for new atomic units.                   |
| `unit-parser.ts`               | Turn a unit string into a resolved `Unit`, composing atomics for compound units.      |
| `quantity.ts`                  | The `Quantity` value object and every arithmetic operation on it.                     |
| `guards.ts`                    | Runtime type-checking helpers (`isQuantity`, `isRatioUnit`, etc.).                    |
| `formatter.ts`                 | Display formatting only — never used in calculation paths.                            |
| `serializer.ts`                | `Quantity ⇄ {value, unit}` JSON round-tripping for persistence.                       |
| `calculation-rule-registry.ts` | Generic named-rule registry — the seam domain packages plug into.                     |
| `errors/index.ts`              | The complete, precise error taxonomy.                                                 |
| `testing.ts`                   | Assertion helpers so consumers don't reinvent tolerance-based equality checks.        |

Each file has exactly one reason to change. If a PR touches two of these
files for one logical change, that's a signal the responsibilities may be
blurring — call it out in the PR description.

---

## How a unit string becomes a `Quantity`

```
"Mcal/kg"
   │
   ▼
extractBasis()          →  strips a trailing " DM"/" asFed" if present
   │
   ▼
split on "/"             →  numerator "Mcal", denominator "kg"
   │
   ▼
registry.getAtomic each  →  looks up factor + dimension for each side
   │
   ▼
divideDim(numDim, denDim) →  { E: 1 } − { M: 1 } = { E: 1, M: -1 }
   │
   ▼
toBaseFactor = numFactor / denFactor
   │
   ▼
Unit { symbol: "Mcal/kg", dimension: {E:1,M:-1}, toBaseFactor, basis }
   │
   ▼
Quantity.of(value, unit)
```

Parsed units are cached per (registry, string) pair so repeated parsing of
the same symbol is cheap.

**Why this matters for contributors:** adding a new _composite_ unit never
requires touching the parser. Only _atomic_ units need registration —
composites fall out of the algebra automatically.

---

## How `multiply()`/`divide()` compute a new dimension

```ts
multiply(other: Quantity): Quantity {
  const resultDim = multiplyDim(this.unit.dimension, other.unit.dimension);
  const resultBaseValue =
    this.value * this.unit.toBaseFactor * other.value * other.unit.toBaseFactor;
  return new Quantity(resultBaseValue, { symbol: ..., dimension: resultDim, toBaseFactor: 1 });
}
```

Two things to notice:

1. The result is always expressed in the **base unit** of the resulting
   dimension (`toBaseFactor: 1`). This is deliberate — the caller then
   calls `.to(desiredUnit)` to normalize to whatever unit they actually
   want reported, keeping `multiply()`/`divide()` themselves free of any
   "what unit should this be displayed in" decision. That decision is
   domain knowledge and belongs to the caller (see `@vetwo/nutrition-units`'s
   `TargetUnitRegistry` for an example).
2. Because both operands are converted to their base-unit numeric value
   before multiplying, the operation is correct regardless of which unit
   each operand was originally expressed in (e.g. `g/day × mg/kg` and
   `kg/day × %` both resolve correctly without special-casing).

---

## Why basis tags (`% DM`) live outside dimensional analysis

`"15 % DM"` and `"13.2 %"` (as-fed) describe the _same physical quantity_
reported against two different reference bases (dry matter vs as-fed
weight). Converting between them requires **an extra piece of information**
— the feed's dry-matter percentage — which `Quantity.to()` does not have
access to and should not silently assume.

So `unit.basis` is carried as metadata only:

- `Quantity.to()` will throw `ConversionError` if you try to convert
  directly between two different non-`undefined` basis tags — this is
  intentional friction, not a bug, to stop accidental unit-only conversion
  of a value that actually needs a domain-specific basis conversion.
- The actual conversion logic (`BasisConverter.toAsFed()` /
  `toDryMatterBasis()`) lives in `@vetwo/nutrition-units`, because it
  requires nutrition-specific business meaning (what "dry matter" means for
  a feed), not just unit algebra.

This is the clearest example in the codebase of the boundary between "this
package" (units) and "a domain package" (business meaning).

---

## Error hierarchy

```
UnitEngineError                     (base — catch this for "any engine error")
├── UnitMismatchError               add()/subtract() with different dimensions
├── UnsupportedUnitError            unregistered unit symbol
├── DimensionError                  an operation required a specific dimension
├── ConversionError                 conversion failed (e.g. clashing basis tags)
├── ImpossibleConversionError       no shared dimension between two units at all
└── RuleNotFoundError               CalculationRuleRegistry.resolve() on an unknown key
```

Each error carries a specific, actionable message (the two unit symbols
involved, or the missing symbol) rather than a generic "conversion failed".
When adding a new failure mode, prefer adding a new subclass over reusing
an existing one with a different meaning — precise catch blocks are a
feature for consumers.

---

## The `CalculationRuleRegistry` extension point

```ts
class CalculationRuleRegistry {
  register(key: string, rule: (...inputs: Quantity[]) => Quantity): void;
  run(key: string, ...inputs: Quantity[]): Quantity;
}
```

This is the **only** sanctioned way for a domain package to add named
formulas without forking or wrapping this package's internals. It's
intentionally minimal — a string key to a function — because the
_meaning_ of a rule (what "nutrient contribution" or "molarity" means) is
domain knowledge this package must not encode.

`@vetwo/nutrition-units` is the reference implementation of how to use
this registry; see its `ARCHITECTURE.md` for the pattern.

---

## Dependency graph

```
consumers (nutrition-units, chemistry-units, application code)
        │
        ▼
   @vetwo/units/index.ts   (the only file consumers should import from)
        │
        ├── quantity.ts ──────┬── dimension.ts
        │                     ├── unit-parser.ts ── unit-registry.ts ── units/atomic-units.ts
        │                     └── errors/index.ts
        ├── calculation-rule-registry.ts
        ├── formatter.ts / serializer.ts / guards.ts / testing.ts
```

`@vetwo/units` has **zero external runtime dependencies** and zero
outgoing dependencies on any domain concept.

---

## SOLID justification

- **S — Single Responsibility.** Every file in the table above does one
  job. `atomic-units.ts` is the only file allowed to contain a bare number
  like `0.001` or `1000`.
- **O — Open/Closed.** New units are added by calling
  `registry.registerAtomic()` — no existing file needs to change. New
  domain formulas are added via `CalculationRuleRegistry.register()`.
- **L — Liskov Substitution.** `Quantity` depends only on the `Unit`
  interface; any object satisfying that shape (atomic or composite) works
  everywhere a `Unit` is expected.
- **I — Interface Segregation.** Consumers import a narrow `index.ts`
  surface; internals (`unit-parser.ts`, `atomic-units.ts`) are not part of
  the public contract and can change without a major version bump if the
  public API surface is unaffected.
- **D — Dependency Inversion.** Domain packages depend on the abstract
  `Quantity`/`CalculationRuleRegistry` API, never on internal
  implementation files.

---

## What this package deliberately does NOT do

- It does not know what a "nutrient", "feed", "reaction", or "asset" is.
- It does not decide what unit a calculated result _should_ be displayed
  in — callers always call `.to(...)` explicitly.
- It does not perform basis conversions that require external business
  data (dry matter %, molar mass, exchange rates) — those need a domain
  package.
- It does not do I/O, network calls, or file access of any kind.

If a proposed change would require any of the above, it belongs in a
domain package instead — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## Extending to a new scientific domain

To build `@yourscope/chemistry-units` (or any other domain) on top of this
package:

1. `npm install @vetwo/units` as a dependency.
2. Register any atomic units your domain needs:
   ```ts
   defaultUnitRegistry.registerAtomic({
     symbol: "mol",
     dimension: { N: 1 },
     toBaseFactor: 1,
     label: "mole",
   });
   ```
3. Register your domain's formulas:
   ```ts
   defaultCalculationRuleRegistry.register("chemistry.molarity", (moles, volume) =>
     moles.divide(volume),
   );
   ```
4. Wrap both behind a small facade class (mirroring `NutritionMath` /
   `CoefficientResolver` in `@vetwo/nutrition-units`) so your consumers
   never need to touch the generic registries directly.
5. Never import from `@vetwo/units`'s internal files (`unit-parser.ts`,
   `atomic-units.ts`, etc.) — only from its public `index.ts`.

---

## The generic dimension system (Phase 2)

`dimension.ts` implements the dimension layer described in
[`docs/DIMENSION_SPEC.md`](./docs/DIMENSION_SPEC.md). Summary:

- A dimension is a **frozen, sparse map of `id → integer exponent`** over an
  extensible registry of base dimensions — no id is hard-coded into the algebra.
- Seeded ids: SI-style `M` Mass, `L` Length, `T` Time, `Temp` Temperature,
  `Substance`, `I` Current, `J` Luminous intensity — plus the generic engine
  dimensions required by the current unit set: `E` Energy, `C` Currency,
  `N` Count (documented semantic categories, ordinary components to the algebra).
- Algebra is pure and immutable:

```ts
import { Dim, multiplyDim, divideDim, powDim, rootDim, dimensionKey } from "@vetwo/units";

const force = multiplyDim(Dim.Mass, divideDim(Dim.Length, powDim(Dim.Time, 2))); // M¹L¹T⁻²
const speed = divideDim(Dim.Length, Dim.Time); // L¹T⁻¹
const density = divideDim(Dim.Mass, powDim(Dim.Length, 3)); // M¹L⁻³

dimensionKey(force); // "L^1·M^1·T^-2"  — deterministic canonical key
rootDim(powDim(speed, 2), 2); // back to L¹T⁻¹ — exact roots only; sqrt(L) throws
```

- Derived dimensions are **never special cases**: velocity, force, energy,
  etc. all fall out of multiply/divide/pow. Named derived dimensions, if
  added later, are aliases over this algebra.
- Exponents are integers only (exact equality/canonicalization); see the
  spec's numerical-policy section for the rationale and upgrade path.
- Errors: malformed vectors / unregistered ids / non-integer exponents throw
  `InvalidDimensionError`; mathematically impossible operations (non-exact
  roots) throw the existing `DimensionError`.
- Property-based invariants (commutativity, associativity, identity,
  cancellation, round-trip, power identities) are enforced by
  `tests/dimension.test.ts` with a seeded deterministic generator.
