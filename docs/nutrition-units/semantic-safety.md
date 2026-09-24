# Semantic Safety — Compatibility, Energy, IU, Molar

Physical dimensions are necessary but not sufficient. These rules are the
reason the nutrition layer exists.

## Compatibility gates

```ts
checkNutrientCompatibility("cp", "ca");          // { isCompatible: false, ... }
checkNutrientCompatibility("CP", "crudeProtein");// compatible (alias-aware)
canConvert("vitA", "vitA");                      // true
canConvert("vitA", "vitD");                      // false — IU is not universal
assertNutrientCompatible("cp", "ca");            // throws IncompatibleNutrientError
assertSemanticCompatibility(...);                // full gate incl. basis/unit
```

`NutritionMeasurement.compare`/`isCompatibleWith` apply the same gates with
an optional `{ mode }` (strict vs permissive where supported).

## Energy identities are distinct

`ge` (gross), `de` (digestible), `me` (metabolizable), `nel` (net energy) are
separate nutrient identities sharing energy dimensions. Substituting one for
another silently changes the meaning of a diet — the library treats them as
incompatible. Conversions between them are nutritional modeling decisions for
_your_ application layer, never automatic unit conversions.

## IU / activity safety

Activity units (`IU/kg`, `IU/g`) are nutrient-specific potencies, not a
universal mass or amount:

- `vitA` in `IU/kg` and `vitD` in `IU/kg` are mutually incompatible.
- Vitamins A/D/E/K accept activity **or** mass units; C/B-group accept mass.
- Never convert IU↔mass without a nutrient-specific, documented factor from
  your own domain data — the library provides no such factor.

## Molar safety

Covered in [nutrients.md](nutrients.md): `getMolarMass` returns `undefined`
without chemical identity, and `convertMolarToMass` throws rather than
assuming. Molar-mass data is reference data about the nutrient, not a unit
conversion.

## Practical rules

- DO gate every cross-nutrient operation on compatibility, not dimensions.
- DO treat energy-kind, IU, and molar mismatches as hard errors.
- DO NOT add fallback chains (`de ≈ me × 0.82`) inside nutrition-data code —
  that is modeling, and it belongs in your application layer with provenance.
