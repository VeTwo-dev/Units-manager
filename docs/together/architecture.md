# Architecture — How the Two Libraries Fit Together

## The layer diagram

```text
┌─────────────────────────────────────────────┐
│ Application Domain                          │
│ (your ration tool, lab importer, dashboard) │
└──────────────────────┬──────────────────────┘
                       │ consumes
┌──────────────────────▼──────────────────────┐
│ @vetwo/nutrition-units                      │
│ nutrient identity · basis/context · families│
│ compatibility · metadata · collections      │
└──────────────────────┬──────────────────────┘
                       │ depends on (never the reverse)
┌──────────────────────▼──────────────────────┐
│ @vetwo/units                                │
│ dimensions · units · conversion · Quantity  │
│ Measurement/uncertainty · formulas · ser/des│
└─────────────────────────────────────────────┘
```

## Dependency direction (hard rule)

```text
@vetwo/units
    ↓  (depends on)
@vetwo/nutrition-units
```

- `@vetwo/units` imports **nothing** nutrition-specific. It is a certified
  generic engine usable by any science domain.
- `@vetwo/nutrition-units` declares `@vetwo/units` as a dependency and
  delegates every physical operation to it: unit math, conversion, uncertainty
  propagation, serialization primitives.
- No circular imports (verified by `circular` checks in both packages).

## Responsibility split

| Concern                       | Owner                    | Examples                             |
| ----------------------------- | ------------------------ | ------------------------------------ |
| Dimensions, units, conversion | `@vetwo/units`           | `kg→g`, `°C→K`, `m+s` rejection      |
| Uncertainty math              | `@vetwo/units`           | quadrature, relative propagation     |
| Formulas over quantities      | `@vetwo/units`           | `defineFormula`, compiled evaluation |
| Serialization primitives      | `@vetwo/units`           | `serializeQuantity`, interchange     |
| Nutrient identity             | `@vetwo/nutrition-units` | `cp` vs `ca`, aliases                |
| Basis & context               | `@vetwo/nutrition-units` | asFed↔DM with DM fraction            |
| Unit families, compatibility  | `@vetwo/nutrition-units` | `ca`+`MJ/kg` rejection               |
| Metadata/provenance           | `@vetwo/nutrition-units` | lot, lab, conversion traces          |
| Collections                   | `@vetwo/nutrition-units` | samples, sets, series                |
| Formulation/optimization      | **neither**              | separate application layer           |

## How delegation works (concrete)

A `NutritionMeasurement` **contains** a core `Measurement` (which contains a
core `Quantity`). Unit conversion (`.to("g/kg")`) runs entirely in the engine;
basis conversion (`.convertBasis("dryMatter", ctx)`) resolves the DM fraction
via nutrition context, then scales through the engine's `Measurement` math.
Uncertainty propagates with the value in both cases — the nutrition layer
never re-implements propagation.

Errors compose the same way: every nutrition error extends `UnitEngineError`,
so one `instanceof UnitEngineError` catch spans both layers, while specific
classes (`MissingNutritionContextError`, `UnitMismatchError`, …) stay
distinguishable.

## What this means for your code

- Model **physical** facts with `@vetwo/units` types; add **nutrition**
  meaning by wrapping them in nutrition types — never by parallel variables.
- Put generic calculations in engine terms (`Quantity`, `Measurement`,
  formulas); put nutrient/basis/context decisions in nutrition terms.
- Keep formulation, requirements, and optimization in your application layer,
  consuming nutrition measurements as input data (see [faq.md](faq.md) and
  [end-to-end.md](end-to-end.md)).
