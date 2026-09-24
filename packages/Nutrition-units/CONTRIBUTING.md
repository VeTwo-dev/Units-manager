# Contributing to @vetwo/nutrition-units

Thanks for considering a contribution. `@vetwo/nutrition-units` is the
nutrition/feed-formulation domain layer built on top of
[`@vetwo/units`](https://github.com/vetwo/units). Please read
[`ARCHITECTURE.md`](./ARCHITECTURE.md) before your first PR so your change
fits the existing design and the core/domain split it depends on.

---

## Table of contents

- [Code of Conduct](#code-of-conduct)
- [The one rule that matters most](#the-one-rule-that-matters-most)
- [Getting started](#getting-started)
- [Project layout](#project-layout)
- [Making changes](#making-changes)
  - [Adding a new nutrient](#adding-a-new-nutrient)
  - [Changing a nutrient's default reporting unit](#changing-a-nutrients-default-reporting-unit)
  - [Adding a new calculation rule](#adding-a-new-calculation-rule)
  - [Changing the feed schema shape](#changing-the-feed-schema-shape)
- [Testing](#testing)
- [Commit messages](#commit-messages)
- [Pull request process](#pull-request-process)
- [Releasing](#releasing)
- [Reporting bugs / requesting features](#reporting-bugs--requesting-features)

---

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

---

## The one rule that matters most

**This package must never contain generic unit-conversion logic.** If a
change is about _how units convert_ (a new atomic unit, a new base
dimension, a change to how `Quantity.multiply()` behaves), it belongs in
[`@vetwo/units`](https://github.com/vetwo/units), not here. Open an issue
or PR there instead.

This package should only ever contain:

- Nutrient reporting-unit configuration (`TargetUnitRegistry`)
- As-fed/dry-matter basis conversion (`BasisConverter`)
- Facades over `@vetwo/units`'s generic APIs (`NutritionMath`,
  `CoefficientResolver`)
- Feed-schema-shaped JSON reading (`FeedSchemaLoader`)

If you're unsure which repo a change belongs in, ask: _"does this need to
know what a nutrient, feed, or animal is?"_ If no, it belongs upstream.

---

## Getting started

```bash
git clone https://github.com/vetwo/nutrition-units.git
cd nutrition-units
npm install       # installs @vetwo/units as a dependency
npm run typecheck # or: npx tsc --noEmit
```

There is no build step for consumers — the package publishes `.ts` source
directly. All PRs must type-check cleanly under `strict: true`.

---

## Project layout

See [`ARCHITECTURE.md`](./ARCHITECTURE.md#folder-structure) for the full
breakdown. In short:

```
src/target-unit-registry.ts    nutrient -> reporting unit (pure config)
src/basis-converter.ts         as-fed <-> dry-matter conversion
src/nutrition-rules.ts         registers rules into @vetwo/units's registry
src/nutrition-math.ts          ⭐ the public facade for nutrient math
src/coefficient-resolver.ts    Quantity -> plain number, for the solver
src/feed-schema-loader.ts      reads a feed/animal/requirements JSON schema
src/examples/                  reference integrations (LP, validation, reporting)
src/index.ts                   public API
```

---

## Making changes

### Adding a new nutrient

1. Add the key to the `NutrientKey` union type in `target-unit-registry.ts`.
2. Add its canonical reporting unit to the `TARGET_UNITS` table.

No calculation-logic changes are needed — nutrient math is generic
(`Quantity.multiply()`, from `@vetwo/units`), so a new nutrient is purely a
configuration change.

```ts
// target-unit-registry.ts
export type NutrientKey = ... | "biotin"; // 1. add the key

const TARGET_UNITS: Record<NutrientKey, string> = {
  ...
  biotin: "mg/day", // 2. add its reporting unit
};
```

### Changing a nutrient's default reporting unit

Prefer `TargetUnitRegistry.override()` at the application level over
editing the default table, unless the current default is simply wrong
(e.g. doesn't match established nutrition science convention) — in which
case, explain the correction and cite a source in the PR description.

### Adding a new calculation rule

New rules must be registered via `CalculationRuleRegistry.register()` in
`nutrition-rules.ts`, and exposed through a method on `NutritionMath` (or a
new facade class if the concept is significantly different from nutrient
contribution/cost). Don't require consumers to call the shared registry
directly — that defeats the purpose of having a facade.

### Changing the feed schema shape

`FeedSchemaLoader` assumes a specific JSON shape (`feed.asFed`,
`feed.dryMatterBasis`, `animal`, `requirements`, `solver`,
`feedConstraints`, `mineralsLimits`, `economics`). If your application
needs a different shape, prefer extending `UnitSchema` and
`FeedSchemaLoader` with new optional fields over breaking the existing
ones — this loader is likely used by every consumer at startup.

---

## Testing

Every PR touching calculation logic must include a runnable check, e.g.:

```ts
import { Quantity, assertQuantityClose } from "@vetwo/units";
import { nutritionMath } from "./src/index.js";

const result = nutritionMath.calculate(Quantity.of(10, "kg/day"), Quantity.of(12, "%"), "cp");
assertQuantityClose(result, Quantity.of(1200, "g/day"));
```

For `BasisConverter` changes specifically, always assert the **exact
numeric magnitude** of the result, not just that no exception was thrown —
a past bug in this package (see `CHANGELOG.md`) silently produced a result
off by a scale factor while still "succeeding".

Run the full type-check before opening a PR:

```bash
npx tsc -p tsconfig.json --noEmit
```

---

## Commit messages

Loosely follows [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add biotin nutrient with mg/day reporting unit
fix: correct BasisConverter.toAsFed magnitude
docs: add validation-engine integration example to README
chore: bump @vetwo/units to ^1.1.0
```

---

## Pull request process

1. Fork the repo and branch from `main`.
2. Make your change, following the rules above.
3. Ensure `tsc --noEmit` passes with no errors.
4. Update `README.md` if you added or changed any public function/class.
5. Add a `CHANGELOG.md` entry under `[Unreleased]`.
6. Open a PR describing what changed and why; link an issue if one exists.
7. A maintainer will review for: correctness, absence of generic
   unit-conversion logic (that belongs upstream), and
   README/changelog completeness.

---

## Releasing

Maintainers only:

```bash
npm version <patch|minor|major>
npm publish --access public
```

Check the `@vetwo/units` dependency range in `package.json` before
releasing — if this release relies on a new `@vetwo/units` feature, bump
the minimum version accordingly.

---

## Reporting bugs / requesting features

Please use the issue templates under `.github/ISSUE_TEMPLATE/`. If your
request is actually about generic unit conversion rather than nutrition
domain logic, please file it against
[`vetwo/units`](https://github.com/vetwo/units) instead. For security
issues, do **not** open a public issue — see [`SECURITY.md`](./SECURITY.md).
