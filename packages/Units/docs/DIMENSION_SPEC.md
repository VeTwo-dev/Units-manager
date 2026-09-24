# Specification — Generic Dimension System (Phase 1)

Status: **Accepted** · Scope: `@vetwo/units` dimension layer only.
This document is the contract that the Phase 2 implementation satisfies. It
covers the dimension model only; units, prefixes, conversion and quantity
redesigns are explicitly out of scope.

---

## 1. Core concepts

| Concept                    | Definition                                                                                                                  | Responsibility                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Dimension**              | A class of physical quantity (mass, length, time, …) that determines _what can be added, subtracted or compared_ with what. | Categorize quantities; make invalid combinations detectable.                 |
| **DimensionVector**        | The internal representation: a sparse, immutable map `dimension-id → integer exponent`.                                     | Carry the algebra; be cheap to copy and compare.                             |
| **Unit**                   | A named scale for one dimension (e.g. `g` for mass) with a factor to a canonical unit.                                      | Attach human conventions to dimensions; never participate in algebra itself. |
| **Quantity**               | A number paired with a unit.                                                                                                | Value-carrying arithmetic with dimensional safety.                           |
| **Conversion**             | Changing the unit while preserving the quantity (same dimension).                                                           | Rescale numbers; refuse cross-dimension attempts.                            |
| **Unit Registry**          | Lookup table of known atomic units.                                                                                         | Resolve unit symbols; extension point for new units.                         |
| **Prefix**                 | A scalar multiplier symbol (`k`, `m`, `µ`, …).                                                                              | Derive scaled units from atomic ones. _(Not implemented in this phase.)_     |
| **Dimensionless quantity** | A quantity whose dimension vector has all-zero exponents (ratios, counts of pure number).                                   | Behave as the multiplicative identity in algebra.                            |
| **Canonical unit**         | The reference unit of a dimension to which every other unit of that dimension is scaled (e.g. `kg` for mass).               | Single normalization target per dimension.                                   |
| **Atomic unit**            | A unit defined directly against a canonical unit (`kg`, `%`).                                                               | Building blocks; registered explicitly.                                      |
| **Derived unit**           | A unit formed by algebra over atomic units (`Mcal/kg`).                                                                     | Composed automatically by the parser; never special-cased.                   |

## 2. Dimension model

Dimensions are represented as **vectors of exponents over named base
dimensions**:

```
kg    → M¹
m     → L¹
s     → T¹
kg/s  → M¹ T⁻¹
N     → M¹ L¹ T⁻²
J     → M¹ L² T⁻²
```

The engine must **not** assume the set of base dimensions is fixed. Base
dimensions are arbitrary identifiers registered in a `DimensionRegistry`;
the algebra operates generically on `(id, exponent)` pairs and never
branches on specific ids such as "mass" or "energy".

The initial seed registry contains:

- the seven SI-style physical dimensions — Mass (`M`), Length (`L`),
  Time (`T`), Temperature (`Temp`), Amount of substance (`Substance`),
  Electric current (`I`), Luminous intensity (`J`) — and
- three additional **generic engine dimensions** required by the current
  public unit system: Energy (`E`), Currency (`C`), Count (`N`).

These last three are documented as generic semantic categories (not SI base
dimensions); they exist because the shipped unit set (Mcal, `cur`, IU)
needs them. They are ordinary vector components to the algebra.

## 3. Dimension algebra

| Operation               | Rule                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| multiplication          | add exponents per component: `A × B`, e.g. `M¹ × L¹T⁻² = M¹L¹T⁻²`                                                      |
| division                | subtract exponents per component: `A / B`                                                                              |
| power                   | multiply exponents by an integer power: `A^n`; `A⁰ = dimensionless`                                                    |
| root                    | divide exponents by `n`; **valid only if every exponent is exactly divisible** — `sqrt(L²) = L`, `sqrt(L)` is rejected |
| equality                | component-wise exponent equality (order-independent)                                                                   |
| canonicalization        | deterministic sorted key (see §4)                                                                                      |
| dimensionless detection | all exponents zero                                                                                                     |

## 4. Canonical representation

The canonical key is built by sorting dimension ids lexicographically and
joining `id^exponent` pairs with `·`; the empty vector canonicalizes to
`"1"`. Guarantees:

- equivalent vectors produce byte-identical keys regardless of construction
  path or insertion order;
- suitable as `Map` keys, cache keys, equality checks and interning;
- collision-safe because ids are validated at registration and exponents
  are integers rendered with an explicit sign.

Example: `{M:1, L:-2}` and `{L:-2, M:1}` both → `"L^-2·M^1"`.

## 5. Immutability

Every stored dimension is frozen. All algebra operations return new frozen
values (or interned canonical instances); inputs are never mutated.

## 6. Extensibility

No hard-coded branches on particular dimensions inside the math. New base
dimensions are added via the registry; derived dimensions are produced by
algebra, not declared as cases. Domain packages may register their own base
dimensions without touching the core.

Registry isolation semantics: `new DimensionRegistry()` **inherits** the
standard seed dimensions (extending the known set is the common case);
`new DimensionRegistry([])` builds a fully isolated one. The mathematical
operations are registry-agnostic — vectors only carry ids.

## 7. Error semantics

Reuse the existing hierarchy; add exactly one new type:

- `InvalidDimensionError` (new): malformed vector, unregistered dimension
  id, non-integer exponent.
- `DimensionError` (existing): mathematically impossible operation on a
  valid dimension, e.g. a non-exact root.

## 8. Numerical policy

Exponents are **integers only**, enforced at construction. Justification:
integer exponents keep equality and key generation exact (no float
rounding), cover all products/quotients/powers of base dimensions — which
is everything this phase needs — and admit a clean future upgrade path to
rationals without changing the public API (roots simply become exact when
the representation allows them). Arbitrary-precision exponents are
unnecessary: physical dimensions have small bounded exponents.

Values (magnitudes) remain IEEE-754 doubles; this phase makes no change to
value arithmetic.

## 9. Performance requirements

Hot paths: multiplication, division, equality, canonical-key generation,
dimensionless detection. Requirements:

- no hidden O(n log n) work on equality or multiply (key sorting happens
  only in `key()`), allocation kept minimal (one frozen object per result);
- design leaves room for future interning/caching/memoization without API
  change;
- readability trumps micro-optimization until profiling says otherwise.

## 10. Public API contract

```ts
// registry
class DimensionRegistry {
  register(id: string, name: string): void;
  has(id: string): boolean;
  getName(id: string): string;
  list(): readonly { id: string; name: string }[];
}
export const defaultDimensionRegistry: DimensionRegistry;
export function defineDimension(vector: Record<string, number>): DimensionVector;

// algebra (all pure functions over frozen vectors)
multiplyDim(a, b): DimensionVector   // A × B
divideDim(a, b): DimensionVector     // A / B
powDim(a, n: number): DimensionVector // A^n, integer n
rootDim(a, n: number): DimensionVector // exact roots only, else DimensionError

// queries
dimensionKey(d): string      // canonical key ("1" when dimensionless)
dimensionsEqual(a, b): boolean
isDimensionless(d): boolean

// constants
DIMENSIONLESS: DimensionVector
Dim: { Mass, Length, Time, Temperature, Substance, Current, LuminousIntensity,
       Energy, Currency, Count, Dimensionless }  // seeded convenience vectors
```

Internal helpers stay unexported from the package entry point.
