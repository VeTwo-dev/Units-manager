# Serialization & Interop

## Library serializers (preferred)

```ts
serializeQuantity(q) / deserializeQuantity(data);
serializeMeasurement(m) / deserializeMeasurement(data);
serializeUnit(u) / deserializeUnit(data);
```

- Round-trips preserve value, unit, scale agreement, dimension, and (for
  measurements) uncertainty. Always prefer these over ad-hoc
  `{ value, unit }` JSON.
- Deserializers **validate**: wrong versions/types, forbidden keys, and
  malformed shapes throw typed errors (`InvalidNutritionQuantityError` is the
  nutrition-layer analogue; core uses `InvalidMeasurementError`,
  `InvalidUnitError`, etc.). Never default silently.
- Constants registries round-trip too (`serializeConstantRegistry` /
  `deserializeConstantRegistry`).

```ts
const back = deserializeQuantity(JSON.parse(JSON.stringify(serializeQuantity(q))));
```

## Interchange and canonical forms

- `toInterchange` / `fromInterchange` exchange quantities across systems.
- `canonicalizeUnitText`, `canonicalUnitKey`, `unitExprKey`,
  `equivalentUnits`, and `parseUnitExpression` normalize and compare unit
  expressions (so `N` ≡ `kg·m/s²` is decidable, not string-matched).
- `validateExtension` / `applyExtension` add namespaced units safely;
  `resolveAmbiguous` + `parseNamespacedSymbol` (`"si:kg"`) disambiguate.
- `formatWithPreset` (`"compact"` etc.), `compareQuantities` policies, and
  `migrateSerialized` versioned-migration chains cover presentation,
  comparison, and schema evolution.

## Practical rules

- DO persist quantities/measurements with the library serializers.
- DO version your payloads and migrate with `migrateSerialized`.
- DO NOT invent a wire format when interchange helpers exist.
- DO NOT trust incoming payloads: deserialize through the typed functions and
  handle their errors at the boundary.
