# `@vetwo/nutrition-units` — Overview

`@vetwo/nutrition-units` is the nutrition-domain semantic layer built on
`@vetwo/units`. It adds nutrient identity, basis/context conversion, unit
families, semantic compatibility, metadata/provenance, uncertainty-aware
nutrition measurements, collections, and serialization — everything a
nutrition-data workflow needs **except** formulation and optimization (those
belong in a separate layer; see [together/faq.md](../together/faq.md)).

## Installation

```sh
npm install @vetwo/units @vetwo/nutrition-units
```

`@vetwo/units` is a peer dependency in spirit (a real dependency in practice):
every physical operation delegates to it.

## 5-minute quickstart

```ts
import { Measurement, Quantity } from "@vetwo/units";
import {
  NutritionMeasurement,
  NutritionSample,
  createNutritionContext,
} from "@vetwo/nutrition-units";

// 1. Physical value + uncertainty (engine) + nutrient + basis (domain).
const calcium = NutritionMeasurement.of(
  Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(3, "mg/kg")),
  "ca",
  "asFed",
  { context: createNutritionContext({ dryMatterFraction: 0.9 }) },
);

// 2. Safe unit conversion, then basis conversion with explicit context.
const inGram = calcium.to("g/kg"); // 0.1 g/kg
const asDM = calcium.convertBasis("dryMatter", calcium.context); // dry-matter basis

// 3. Collect, look up, serialize.
const sample = new NutritionSample({ id: "lot-42", measurements: [calcium] });
const json = JSON.stringify(sample.toJSON());
const back = NutritionSample.fromJSON(JSON.parse(json));
```

## Design principles

1. **Semantics travel with values.** Nutrient, basis, context, and provenance
   are attached at construction, not tracked in parallel variables.
2. **Same unit ≠ same nutrient.** `cp` and `ca` at identical `g/kg` are
   incompatible — enforced by semantic compatibility, not dimensions.
3. **Basis conversion needs explicit context.** No dry-matter fraction, no
   conversion — a typed error instead (`MissingNutritionContextError`).
4. **No silent invention.** Unknown nutrients, missing molar masses, and
   contradictory contexts all throw typed errors.
5. **Immutability.** Measurements, samples, sets, contexts, and metadata are
   frozen; operations return new objects.
6. **No formulation here.** Ration balancing, LP/MILP, HiGHS, and requirement
   models live outside this package — permanently.

## Where to go next

- [nutrients.md](nutrients.md) — identity, registry, aliases, families
- [measurements.md](measurements.md) — quantities, measurements, options
- [basis-context.md](basis-context.md) — basis conversion done safely
- [metadata.md](metadata.md) — provenance and quality info
- [collections.md](collections.md) — samples, sets, series
- [semantic-safety.md](semantic-safety.md) — compatibility, energy, IU, molar
- [serialization.md](serialization.md) — persistence and external data
- [errors.md](errors.md) — the full error taxonomy
- Package README (`packages/Nutrition-units/README.md`) — exhaustive reference
