# Collections — Samples, Sets, Series

Lightweight, immutable, validated containers. No DataFrame, no database, no
statistics engine.

## `NutritionSample` (construction contract: `NutritionSampleOptions`)

```ts
const sample = new NutritionSample({
  id: "sample-001", // /^[A-Za-z0-9._-]{1,128}$/
  context: createNutritionContext({ dryMatterFraction: 0.9 }),
  metadata: { reference: "trial-7" },
  measurements: [calcium, protein],
} satisfies NutritionSampleOptions);

const grown = sample.withMeasurement(extra); // new instance; original untouched
for (const m of sample) {
  /* iterable */
}
sample.toJSON();
NutritionSample.fromJSON(data);
```

Bad ids, non-object options, and non-measurement entries throw
`InvalidNutritionQuantityError`.

## `NutritionMeasurementSet` (lookup)

```ts
const set = new NutritionMeasurementSet([calcium, protein]);
set.size;
set.get("ca"); // single hit → measurement; else undefined
set.get("ca", "asFed"); // basis-aware lookup
set.getAll("ca"); // all matches (never throws for ambiguity)
set.getOrThrow("ca", "asFed"); // MeasurementNotFoundError | AmbiguousMeasurementError
set.has("zn"); // false when missing OR ambiguous
set.add(m);
set.remove("ca"); // return new sets
set.filter(pred);
set.filterByNutrient("cp");
set.filterByBasis("dryMatter");
set.toJSON(); // + fromJSON (see serialization.md)
```

**Ambiguity is explicit by design.** Duplicate nutrient+basis+unit entries make
`get` return `undefined` (not a silent first-pick); `getOrThrow` distinguishes
_not found_ from _ambiguous_ with typed errors. If duplicates are legitimate
in your domain (replicates), keep them in the set and disambiguate by basis,
or model replicates as a series.

## `NutritionMeasurementSeries`

Time-/replicate-ordered `SeriesPoint` sequences for repeated observations,
iterable and JSON-serializable. For aggregation semantics and method lists,
see the package README and the installed `.d.ts`.

## Practical rules

- DO look up with basis (`get("ca", "asFed")`) whenever a sample may hold
  multiple bases.
- DO use `getOrThrow` when absence/ambiguity must fail loudly.
- DO NOT index `measurements[i]` positionally across systems — serialize.
- DO NOT mutate a set in place; `add`/`remove`/`filter` return new sets.
