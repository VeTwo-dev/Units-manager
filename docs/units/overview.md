# `@vetwo/units` — Overview

`@vetwo/units` is a generic, domain-agnostic scientific units and
dimensional-analysis engine for TypeScript. It models physical quantities,
converts between units, enforces dimensional compatibility, propagates
measurement uncertainty, evaluates scientific formulas, and serializes values.
It knows nothing about nutrition, feed, or any application domain — that is
the job of layers built on top of it (see
[`@vetwo/nutrition-units`](../nutrition-units/overview.md)).

## Installation

```sh
npm install @vetwo/units
```

Requires Node `>= 18`. Ships ESM + CJS with TypeScript declarations.

## 5-minute quickstart

```ts
import { Quantity, Measurement, parseUnit, formatQuantity } from "@vetwo/units";

// A physical quantity: value + unit, always together.
const mass = Quantity.of(25, "kg");

// Conversion (never hand-write factors for supported units).
const grams = mass.to("g"); // 25000 g

// Dimensional arithmetic (mismatches throw, they never guess).
const total = mass.add(Quantity.of(500, "g")); // 25.5 kg

// Measurement with uncertainty.
const assay = Measurement.of(Quantity.of(100, "g"), Quantity.of(2, "g"));

// Parsing and formatting.
const unit = parseUnit("kg*m/s^2");
console.log(formatQuantity(total)); // "25.5 kg"
```

## Design principles

1. **Value + unit travel together.** A bare `number` is never a quantity.
2. **Dimensions are enforced.** `m + s` throws `UnitMismatchError`; `to()`
   across dimensions throws `ImpossibleConversionError`.
3. **Conversions are data, not code.** Factors/offsets live in unit
   definitions and packs — application code calls `.to()`.
4. **Immutability.** `Quantity`, `Measurement`, units, registries, and contexts
   are frozen; every operation returns a new object.
5. **Typed errors, never silent wrong numbers.** All failures surface as
   `UnitEngineError` subclasses (see [errors.md](errors.md)).
6. **Public entrypoint only.** Import from `@vetwo/units`; never reach into
   internal files (see [api-reference.md](api-reference.md)).

## Where to go next

- [quantities.md](quantities.md) — the `Quantity` API in depth
- [conversion.md](conversion.md) — conversion engine + temperature rules
- [measurement.md](measurement.md) — uncertainty done right
- [formulas.md](formulas.md) — expressions, formulas, calculation rules
- [serialization.md](serialization.md) — persistence and interop
- [errors.md](errors.md) — the full error taxonomy
- Package README (`packages/Units/README.md`) — exhaustive reference
- `packages/Units/docs/` — specs (dimensions, migration, extensions) and
  getting-started material
