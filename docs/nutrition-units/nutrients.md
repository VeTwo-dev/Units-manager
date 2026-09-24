# Nutrient Identity — Kinds, Registry, Aliases, Families

## Canonical IDs and aliases

Every nutrient has a stable lowercase canonical ID plus aliases, resolved
case-insensitively by `NutrientKindRegistry`:

| Canonical                  | Aliases include                 | Notes                                            |
| -------------------------- | ------------------------------- | ------------------------------------------------ |
| `cp`                       | `crudeProtein`, `protein`, `CP` | protein mass                                     |
| `ca`                       | —                               | calcium mineral                                  |
| `p`                        | —                               | phosphorus                                       |
| `fe`                       | —                               | iron                                             |
| `de` / `me` / `ge` / `nel` | —                               | distinct energy identities (see semantic-safety) |
| `vitA` / `vitD` / …        | —                               | activity (IU) nutrients, not interchangeable     |

```ts
import { defaultNutrientKindRegistry, isNutrientKindId } from "@vetwo/nutrition-units";
isNutrientKindId("CP"); // true (alias-aware)
defaultNutrientKindRegistry.require("cp"); // NutrientKind
defaultNutrientKindRegistry.require("nope"); // throws typed error
```

DO NOT invent IDs, and DO NOT scatter raw nutrient strings through
application code — resolve once via the registry and carry the `NutrientKind`.

## Unit families

`inferUnitFamily(quantity)` classifies a value (`mass-concentration`,
`energy-density`, `activity`, `molar`, `fraction`, `ppm-family`, …);
`isFamilyCompatible` / `assertFamilyCompatible` enforce the matrix:

- `cp` and protein-like nutrients → mass-concentration / fraction / ppm
- minerals (`ca`, `p`, `fe`) → mass / molar / fraction / ppm
- energy (`de`, `me`, …) → energy-density **only**
- vitamins A/D/E/K → activity (IU) **or** mass; C/B-group → mass

`NutritionMeasurement.of` runs this check at construction: `ca` in `MJ/kg`
or `me` in `mg/kg` throws `NutritionUnitCompatibilityError`.

## Molar values

```ts
getMolarMass("ca"); // 40.078 | undefined
convertMolarToMass(quantity, "ca"); // g↔mol using chemical identity
```

`getMolarMass` returns `undefined` for nutrients without chemical identity
(`cp`); `convertMolarToMass` then throws instead of assuming a weight of 1.
Never invent molecular weights.

## Practical rules

- DO resolve nutrient IDs through `defaultNutrientKindRegistry`.
- DO keep the nutrient on the measurement — never a parallel string field.
- DO check `isNutrientKindId` at trust boundaries (file imports, API input).
- DO NOT compare nutrients by unit (`mg/kg` tells you nothing about identity).
- DO NOT treat IU values as interchangeable across nutrients.
