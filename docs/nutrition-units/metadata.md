# Metadata & Provenance

`createNutritionMetadata` / `mergeNutritionMetadata` build frozen, validated
descriptive context for measurements, samples, and conversions. Metadata
describes the science — it is not a LIMS, and it never affects calculations.

## Known fields (only these are stored)

```ts
{
  provenance: { sourceId, laboratoryId, instrumentId, timestamp, method, sample, conversion },
  sample: { ... },            // sample-level context
  method: { ... },            // analytical method (object form)
  qualityFlag: ...,           // quality flags
  detectionLimits: { ... },   // LOD/LOQ style limits
  reference: "lot-42",        // free reference string
  custom: { ... }             // namespaced caller extras
}
```

**Unknown top-level keys are dropped, not stored.** `{ source: "lab-a" }`
becomes `{}` — always use `provenance.sourceId`. Forbidden keys
(`__proto__`, `constructor`, `prototype`), over-deep nesting, and executable
values are rejected with typed errors.

## Conversion traceability

Every `convertBasis` stamps `metadata.conversion`:

```ts
{ sourceBasis: "asfed", targetBasis: "drymatter",
  dryMatterFraction: 0.9, conversionType: "basis-conversion" }
```

This makes any derived value auditable back to its inputs — preserve it
across your own transformations instead of rebuilding metadata from scratch
(`mergeNutritionMetadata` exists for that).

## Practical rules

- DO attach `reference`/`custom` at construction for lot/trial tracking.
- DO preserve `metadata.conversion` through pipelines.
- DO NOT rely on arbitrary keys surviving — check the known field list.
- DO NOT put executable content or secrets in metadata; it serializes.
