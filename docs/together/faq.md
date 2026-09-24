# FAQ — Boundaries and When-to-Use-What

## Which library do I need?

- Only physical quantities (masses, doses, sensor readings, conversions)?
  → `@vetwo/units` alone.
- Quantities **plus** nutrient identity, basis/context, provenance, or
  collections? → both (`@vetwo/nutrition-units` on top of `@vetwo/units`).
- Unsure whether a number is a quantity? If it has no unit, dimension, or
  conversion story, it is probably an id, count, or enum — keep it a plain
  type. See `units.agent.md` §3 (in `docs/agents/`).

## Why are `cp` and `ca` incompatible at the same `g/kg`?

Because units describe physics and nutrients describe domain meaning. The
engine correctly reports them dimensionally compatible; the nutrition layer
adds the semantic gate (`IncompatibleNutrientError`). Both answers are right
at their own layer — that is the point of layering.

## Where does feed formulation / LP / HiGHS go?

In **your application layer**, never in these packages.
`@vetwo/nutrition-units` supplies validated measurements and plain-number
coefficients (`coefficientResolver`, `FeedSchemaLoader`); an external
optimizer consumes them. Ration balancing, requirement models, least-cost
solving, and solver infrastructure are permanently out of scope for both
libraries.

## Can I use `@vetwo/units` without the nutrition package?

Yes — that is its primary design goal. It has zero nutrition knowledge and
zero nutrition dependencies. The nutrition package is an optional layer.

## Can I use `@vetwo/nutrition-units` without learning the engine?

You will use engine types constantly (`Quantity`, `Measurement`,
`UnitRegistry`, errors), because nutrition objects contain and return them.
Read [`../units/overview.md`](../units/overview.md) first; it takes five minutes.

## How do I report a docs/API mismatch?

The installed `dist/index.d.ts` wins over any documentation, including this
directory. If a page disagrees with the declarations, follow the declarations
and report the mismatch against the docs (never "fix" it by editing library
source casually — see the contributing guides).
