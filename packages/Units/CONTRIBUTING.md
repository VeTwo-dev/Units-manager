# Contributing to @vetwo/units

Thanks for considering a contribution. `@vetwo/units` is a generic,
domain-agnostic dimensional-analysis engine — please read
[`ARCHITECTURE.md`](./ARCHITECTURE.md) before your first PR so your change
fits the existing design.

---

## Table of contents

- [Code of Conduct](#code-of-conduct)
- [The one rule that matters most](#the-one-rule-that-matters-most)
- [Getting started](#getting-started)
- [Project layout](#project-layout)
- [Making changes](#making-changes)
  - [Adding a new atomic unit](#adding-a-new-atomic-unit)
  - [Adding a new base dimension](#adding-a-new-base-dimension)
  - [Changing `Quantity` arithmetic](#changing-quantity-arithmetic)
  - [Adding a new error type](#adding-a-new-error-type)
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

**This package must never contain domain-specific code.** No nutrient
names, no feed concepts, no chemistry, no finance — nothing that assumes a
specific field of use. If your change teaches the engine about a specific
domain, it belongs in a separate package that depends on `@vetwo/units`
(e.g. [`@vetwo/nutrition-units`](https://github.com/vetwo/nutrition-units)),
not here.

The second rule: **no magic numbers outside `src/units/atomic-units.ts`.**
That file is the single source of truth for every raw conversion constant
in the package. A PR introducing a bare number like `0.001` or `1000`
anywhere else will be asked to move it there.

Reviewers check both rules on every PR — please self-check before opening
one.

---

## Getting started

```bash
git clone https://github.com/vetwo/units.git
cd units
npm install       # or: bun install
npm run typecheck # or: npx tsc --noEmit
```

There is no build step for consumers — the package publishes `.ts` source
directly with `types` pointing at `src/index.ts`. All PRs must type-check
cleanly under `strict: true`.

---

## Project layout

See [`ARCHITECTURE.md`](./ARCHITECTURE.md#folder-structure) for the full
breakdown. In short:

```
src/dimension.ts               dimension vector algebra
src/units/atomic-units.ts      the ONLY file with raw conversion constants
src/unit-registry.ts           atomic unit registry
src/unit-parser.ts             string -> Unit
src/quantity.ts                the Quantity value object + math
src/calculation-rule-registry.ts   extension point for domain packages
src/errors/index.ts            error hierarchy
src/index.ts                   public API — the only import path for consumers
```

---

## Making changes

### Adding a new atomic unit

Add one entry to `src/units/atomic-units.ts`:

```ts
{ symbol: "L", dimension: Dim.Volume, toBaseFactor: 1, label: "liter" },
```

- Pick the existing base dimension that fits (`Dim.Mass`, `Dim.Time`,
  `Dim.Energy`, `Dim.Currency`, `Dim.Count`) wherever possible.
- `toBaseFactor` must convert **into** the base unit of that dimension
  (kg for Mass, day for Time, Mcal for Energy, cur for Currency, IU for
  Count, fraction for Ratio) — document the source of the conversion
  factor in a code comment if it's not a well-known constant (e.g. `MJ`).
- Composite units built from your new atomic (e.g. `"L/day"`) require no
  further changes — the parser composes them automatically.

### Adding a new base dimension

The dimension system is extensible at runtime: consumers can register new
base dimensions via `defaultDimensionRegistry.register(id, name)` without
changing the core. However, adding one to the **seeded defaults** shipped
with the package is a bigger decision — it becomes part of the public
contract. **Open an issue before submitting a PR** so the design can be
discussed; include:

- Why an existing base dimension can't represent what you need.
- Which units would use the new dimension.
- Whether this could instead be modeled as a domain-package concern.

### Changing `Quantity` arithmetic

Changes to `add`, `subtract`, `multiply`, `divide`, or `to` are
high-risk — every consumer package depends on these being dimensionally
correct. Any PR touching `quantity.ts` must include:

- At least one test proving the "happy path" produces the mathematically
  correct value (not just that it doesn't throw).
- At least one test proving a dimensionally-invalid case correctly throws
  the right error type.

### Adding a new error type

Only add a new `UnitEngineError` subclass if the failure mode is genuinely
distinct from existing ones (see the taxonomy in `ARCHITECTURE.md`).
Reusing an existing error class with a slightly different meaning makes
`catch` blocks in consumer code unreliable — prefer precision.

---

## Testing

Every PR touching calculation logic must include a runnable check, e.g.:

```ts
import { Quantity, assertQuantityClose } from "./src/index.js";

const result = Quantity.of(10, "kg/day").multiply(Quantity.of(12, "%")).to("g/day");
assertQuantityClose(result, Quantity.of(1200, "g/day"));

// and the negative case:
try {
  Quantity.of(1, "kg").add(Quantity.of(1, "Mcal"));
  throw new Error("expected UnitMismatchError");
} catch (e) {
  if (!(e instanceof UnitMismatchError)) throw e;
}
```

Run the full type-check before opening a PR:

```bash
npx tsc -p tsconfig.json --noEmit
```

---

## Commit messages

Loosely follows [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add liter and mole atomic units
fix: correct unit-parser handling of trailing "asFed" basis tag
docs: expand Quantity.multiply() examples in README
chore: bump devDependencies
```

---

## Pull request process

1. Fork the repo and branch from `main`.
2. Make your change, following the rules above.
3. Ensure `tsc --noEmit` passes with no errors.
4. Update `README.md` if you added or changed any public function/class.
5. Add a `CHANGELOG.md` entry under `[Unreleased]`.
6. Open a PR describing what changed and why; link an issue if one exists.
7. A maintainer will review for: correctness, absence of domain-specific
   code, absence of magic numbers outside `atomic-units.ts`, and
   README/changelog completeness.

---

## Releasing

Maintainers only:

```bash
npm version <patch|minor|major>
npm publish --access public
```

Because `@vetwo/nutrition-units` (and any other domain package) depends on
this package, review whether a change is breaking (major) before
publishing — a breaking change here forces a coordinated update downstream.

---

## Reporting bugs / requesting features

Please use the issue templates under `.github/ISSUE_TEMPLATE/`. For
security issues, do **not** open a public issue — see
[`SECURITY.md`](./SECURITY.md).
