# Basis & Context — Conversion Done Safely

## The basis model

Basis IDs (aliases resolve deterministically, e.g. `DM`/`dm` → `drymatter`):

| ID            | Unit tag | Meaning                        |
| ------------- | -------- | ------------------------------ |
| `asFed`       | bare     | As-fed / as-received material  |
| `dryMatter`   | `DM`     | Dry-matter basis               |
| `freshMatter` | `FM`     | Fresh-matter basis             |
| `wet`         | `WB`     | Wet basis                      |
| `normalized`  | —        | Normalized concentration basis |

`defaultBasisRegistry` / `BasisRegistry`, `isBasisId(id)` manage them.
`BasisConverter.toAsFed` / `.toDryMatterBasis` are low-level static helpers
over plain `Quantity` + explicit dry-matter `Quantity` — prefer
`convertBasis` on nutrition objects unless you are writing plumbing.

## The critical rule

> **Basis conversion is not unit conversion.** `asFed → dryMatter` rescales by
> the dry-matter fraction. Without that fraction there is no answer — only a
> typed error.

```ts
const ctx = createNutritionContext({ dryMatterFraction: 0.88 });
const dm = af.convertBasis("dryMatter", ctx); // 100 g/kg → 113.6 g/kg DM
const back = dm.convertBasis("asFed", ctx); // round-trips to 100 g/kg
af.convert("mg/kg", "dryMatter", ctx); // unit + basis in one step
```

## Context facts

```ts
createNutritionContext({ dryMatterFraction: 0.9 }); // moisture derived: 0.1
createNutritionContext({ moistureFraction: 0.1 }); // DM derived: 0.9
```

- Rules: finite numbers, `0 < DM ≤ 1`, `DM + moisture ≈ 1` within `1e-6`.
- Contexts are frozen; `resolvedDryMatterFraction` /
  `resolvedMoistureFraction` are always derived when either input is present.
- `resolveDryMatterFraction(context | Quantity(%) | number)` extracts the
  fraction wherever it legitimately lives.

## The two typed errors

| Situation                                                                                                                       | Error                                                            |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Conversion needs DM info, none provided                                                                                         | `MissingNutritionContextError`                                   |
| Context object malformed (non-object, `__proto__` keys, inconsistent DM+moisture, non-Measurement DM, bad sampleState/metadata) | `InvalidNutritionContextError` (extends `NutritionContextError`) |
| Out-of-range fraction values                                                                                                    | `InvalidNutritionBasisError`                                     |

```ts
try {
  protein.convertBasis("dryMatter"); // no context anywhere
} catch (e) {
  if (e instanceof MissingNutritionContextError) askUserForDryMatter();
  else throw e;
}
```

Failed conversions never mutate the source object and never return a
plausible-but-wrong number.

## Practical rules

- DO require explicit dry-matter data; DO NOT invent `0.9` defaults.
- DO carry context on the measurement (`NutritionMeasurementOptions.context`)
  so downstream `convertBasis` calls just work.
- DO distinguish the errors: _missing_ (go get data) vs _invalid_ (fix data).
- DO NOT confuse `moistureFraction` with `dryMatterFraction` — the `≈ 1`
  consistency check exists precisely because this mistake is common.
