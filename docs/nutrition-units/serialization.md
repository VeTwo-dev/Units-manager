# Serialization — JSON, Canonical Forms, Tabular Import

## Object JSON (`toJSON` / `fromJSON`)

Available on `NutritionQuantity`, `NutritionMeasurement`, `NutritionSample`,
`NutritionMeasurementSet`, and series types. Payloads are versioned
(`version: 1`) and typed (`type: "nutrition-measurement"`, …):

```ts
const back = NutritionSample.fromJSON(JSON.parse(JSON.stringify(sample.toJSON())));
```

Malformed payloads (wrong version/type, non-string nutrient/basis,
forbidden keys) throw `InvalidNutritionQuantityError` — never default.
`fromJSON` accepts the same options contracts as constructors, so registries
and context handling stay consistent.

## Canonical JSON (deterministic interchange)

```ts
toCanonicalJson(measurement); fromCanonicalJson(data);
canonicalJsonStringify(value);
serializeNutritionMeasurementCanonical(measurement);
createExternalNutrientIdentifier(...) / createExternalUnitIdentifier(...);
registerExternalNutrientMapping(...) / resolveExternalNutrient(...) / clearExternalNutrientMappings(...);
```

Canonical forms give byte-stable output for hashing, dedupe, and
cross-system exchange. External identifiers map your codes (feed-table IDs,
lab codes) to canonical nutrients/units explicitly — with
`handleUnknownNutrient` policies for the unmapped case. Migrations
(`registerMigration`, `migrateSerializedNutritionMeasurement`) evolve schemas
without breaking stored data.

## Tabular import (spreadsheets / CSV rows)

```ts
mapTabularRowToNutritionMeasurement(row, mapping: TabularRowMapping);
```

`TabularFieldMapping` declares how each column maps to value/unit/nutrient/
basis fields. Validation runs on the way in: bad rows throw typed errors
instead of entering your dataset as plausible wrong numbers.

## Practical rules

- DO persist samples/sets with `toJSON`, exchange with canonical JSON.
- DO register external-ID mappings explicitly; decide the unknown-nutrient
  policy up front (`handleUnknownNutrient`).
- DO version and migrate stored payloads; never hand-edit serialized shapes.
- DO NOT accept tabular data without the typed mapping + validation path.
