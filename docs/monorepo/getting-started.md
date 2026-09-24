# Getting Started (Monorepo)

## Prerequisites

| Tool    | Version (verified)                                                 |
| ------- | ------------------------------------------------------------------ |
| Node.js | `>= 20` (root `engines`; packages accept `>= 18`)                  |
| pnpm    | `11.21.0` (`packageManager` field — use exactly this via corepack) |

```sh
corepack enable
corepack prepare pnpm@11.21.0 --activate
node --version  # v20+
```

## Layout

```text
packages/Units/            @vetwo/units            generic engine, zero runtime deps
packages/Nutrition-units/  @vetwo/nutrition-units  nutrition domain layer
apps/nutrition-units-example/                      external-style consumer demo
docs/                      this documentation + VitePress site sources
scripts/                   root automation (e.g. sync-workspace.ts)
```

Workspaces are declared in `pnpm-workspace.yaml` (`packages/*`, `apps/*`)
with `linkWorkspacePackages: true`, so cross-package imports resolve to live
workspace sources.

## First run

```sh
pnpm install          # install all workspaces (also runs husky prepare)
pnpm run build        # dependency-ordered, cached builds (turbo)
pnpm run test         # full test suites
```

Then explore:

- [`../units/overview.md`](../units/overview.md) — engine quickstart
- [`../nutrition-units/overview.md`](../nutrition-units/overview.md) — domain quickstart
- [`../together/end-to-end.md`](../together/end-to-end.md) — combined workflows
- `apps/nutrition-units-example`: `pnpm --filter @vetwo/nutrition-units-example start`

## Daily commands

```sh
pnpm run dev           # watch mode across packages
pnpm run verify        # lint + format + check-types + test + build (CI gate)
pnpm run lint          # eslint, zero-warning policy
pnpm run format:check  # prettier check (root script); `pnpm run format` writes
pnpm run check-types   # strict tsc --noEmit
```

Full script catalog: [scripts.md](scripts.md).
