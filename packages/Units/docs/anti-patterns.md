# Anti-Patterns

Unsafe patterns the library prevents — and what to do instead.

## 1. Manually multiplying conversion constants

```ts
// WRONG: magic numbers drift, round inconsistently, and ignore affine units.
const kg = lbs * 0.45359237;

// RIGHT: conversion lives in one validated place.
Quantity.of(lbs, "lb").to("kg");
```

## 2. Stripping units into bare numbers before calculating

```ts
// WRONG: dimensional safety is lost the moment units leave the value.
const v = distance.value / time.value;

// RIGHT: arithmetic stays unit-aware end to end.
distance.divide(time).to("km/h");
```

## 3. Mixing incompatible dimensions

```ts
Quantity.of(1, "kg").add(Quantity.of(1, "m")); // throws UnitMismatchError
```

If you hit this, the formula is wrong — not the library. Declare honest
intermediate quantities instead of coercing.

## 4. Assuming ambiguous units

`ton`, `ounce`, `gallon`, `pint`, `calorie`, `mile` differ across systems.
The engine never guesses under `strict`/`standard` policies:

```ts
resolveAmbiguous("ton", { sources, strategy: "strict" }); // throws AmbiguousUnitError
// Disambiguate: "us:ton", a unit system, a profile, or an explicit variant.
```

## 5. Treating affine units as scale units

```ts
Quantity.of(20, "°C").add(Quantity.of(10, "°C")); // throws InvalidAffineOperationError
```

Absolute temperatures don't add. Convert to `K` first, or work with
temperature-difference quantities. Uncertainty on `°C`/`°F` is rejected —
express intervals in kelvin.

## 6. Confusing `equals()` with `approximatelyEquals()`

```ts
quantitiesEqual(a, b); // deterministic Object.is on base values
quantitiesApproximatelyEqual(a, b, { relativeTolerance: 1e-9 }); // explicit policy
compareQuantities(a, b, "combined", { absoluteTolerance: 1e-12 }); // full control
```

Floating point is approximate; say which approximation you mean.

## 7. Trusting serialized input

Never `JSON.parse` + cast. Every decoder validates shape, version, units,
dimensions, pollution keys and size limits, and throws typed errors:

```ts
fromInterchange(payload, { unknownFields: "reject" }); // default: strict
```

## 8. Global registry mutation from libraries

Libraries must use `createExtensionScope()` (or their own registry
instances) and `applyExtension()`. The process-wide defaults exist for
applications and quick scripts — a library that mutates them can corrupt
unrelated consumers.
