# `Quantity` — Construction, Arithmetic, Comparison

`Quantity` is the core type: an immutable `{ value, unit }` pair where `unit`
carries its dimension and conversion. Every code path below is verified
against the implementation.

## Construction

```ts
Quantity.of(value: number, unitSymbol: string | Unit, registry?: UnitRegistry): Quantity
```

- `value` must be finite (else `NumericalError`); the unit string must be
  non-empty and parseable (else `UnsupportedUnitError` / `InvalidUnitError`).
- `Q()` is an equivalent factory alias.
- `quantity.withKind(kindId)` attaches a semantic kind tag and returns a new
  `Quantity`; `.kind` reads it back; `.requireKind()` asserts it.

```ts
const m = Quantity.of(25, "kg");
const c = Quantity.of(20, "°C");
```

## Add / subtract (same dimension only)

```ts
quantity.add(other: Quantity, opts?: QuantityArithmeticOptions): Quantity
quantity.subtract(other: Quantity, opts?: QuantityArithmeticOptions): Quantity
```

- Operands must share a dimension — otherwise `UnitMismatchError`.
- Temperature interval algebra is built in:
  - `20°C + 10K → 30°C` (absolute + delta = absolute)
  - `20°C − 10°C → 10 K` (absolute − absolute = delta in `K`)
  - `20°C − 5K → 15°C` (absolute − delta = absolute)

DO NOT add two absolute temperatures (`°C + °C`) — it throws
`InvalidAffineOperationError`. That operation has no physical meaning.

## Multiply / divide / scale (dimensions derive)

```ts
quantity.multiply(other: Quantity | number): Quantity
quantity.divide(other: Quantity | number): Quantity
quantity.scale(factor: number): Quantity
quantity.negate(): Quantity
quantity.pow(n: number): Quantity
quantity.sqrt(): Quantity
quantity.reciprocal(): Quantity
```

- `Quantity × Quantity` computes the result dimension automatically and emits
  a composite unit whose symbol, scale, and value always agree
  (e.g. `kg·m/s²`).
- Affine (offset) temperatures may not be scaled or combined with offsets:
  `°C × 2`, `°C / 2`, `°C × kg` throw `InvalidAffineOperationError`.
  Linear `K` is fine: `K × kg`, `K / 2`, `K × K` are meaningful.
- Dividing two absolute temperatures is rejected; dividing by zero throws
  `DivisionByZeroError` (both scalar and quantity forms).

## Comparison and equality

```ts
quantity.hasSameDimension(other): boolean
quantity.exactEquals(other): boolean
quantity.approximatelyEquals(other, epsilon?: number | ComparisonOptions): boolean
quantity.lessThan / lessThanOrEqual / greaterThan / greaterThanOrEqual : boolean
quantity.isZero() / isPositive() / isNegative(): boolean
```

Prefer `approximatelyEquals` for converted values (decimal offsets such as
`273.15` rarely round-trip bit-exactly); reserve `exactEquals` for
canonical-form checks.

## Semantic kinds (opt-in strictness)

Quantities can carry a `kind` (e.g. distinguishing activity from frequency).
Arithmetic accepts `{ semanticPolicy: "dimensional-only" | "semantic-aware" }`
(default: dimensional-only). Use `semantic-aware` when two quantities share a
dimension but must not mix — domain layers such as `@vetwo/nutrition-units`
build on this mechanism.

## Practical rules

- DO keep values as `Quantity` through whole calculations; convert at the edges.
- DO use `hasSameDimension` as an explicit pre-check at trust boundaries.
- DO NOT destructure into `{ value, unitSymbol }` pairs and re-assemble later —
  you lose dimensional safety at every step in between.
- DO NOT catch `UnitMismatchError` to "make it compile". Fix the dimensions.
