# @vetwo units monorepo

A pnpm workspace for the **VeTwo unit engine** family — a dependency-free
scientific unit & dimensional-analysis engine for TypeScript, plus the
domain packages built on top of it.

## Structure

```
packages/
  Units/            @vetwo/units           generic dimension/unit/quantity engine (zero runtime deps)
  Nutrition-units/  @vetwo/nutrition-units feed-formulation domain layer on top of the engine
```

Dependency direction is strictly one-way:

```
applications → domain packages → @vetwo/units → zero runtime dependencies
```

## Getting started

```bash
pnpm install
pnpm run build
```

All orchestration runs through [Turbo](https://turbo.build):

- `pnpm run build` — build all packages (dependency-ordered, cached)
- `pnpm run dev` — watch mode across packages
- `pnpm run test` / `coverage` — test all packages
- `pnpm run lint` / `lint:fix` — ESLint + Prettier via lint-staged/husky
- `pnpm run check-types` — strict type-checking
- `pnpm run verify` — lint + check-types + test + build (what CI runs)
- `pnpm run circular` — circular-dependency audit (madge)
- `pnpm run clean` — remove build artifacts across the workspace

## Versioning & release

Changesets drive versioning: `pnpm changeset`, then `pnpm version` and
`pnpm release` when publishing.

## Documentation

- [`docs/README.md`](docs/README.md) — documentation hub: per-package guides,
  combined workflows, monorepo operations, and portable AI agent guides.
  Plain Markdown — read it directly in the repository or any Markdown viewer.

## License

MIT

## License Policy

This project validates dependency licenses against an allowlist
(`license-policy.json` in each package).

### Commands

- `pnpm security:licenses` — check dependency licenses against the policy

# Units-manager
