# Tooling Scripts Reference

`tsx` utilities (run with `pnpm exec tsx <file>` or the listed npm script).
All paths below exist identically in both packages unless noted.

## Root `scripts/`

| File                | Invoke via            | What it does                                                                                                                                                                   |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sync-workspace.ts` | `pnpm sync-workspace` | Builds the inter-package dependency graph with `madge packages --image reports/architecture/workspace-graph.svg`, then checks shared deps resolve to one version per workspace |

## Per-package `scripts/` (invoked as `pnpm --filter <pkg> <script>`)

| Script file             | npm script           | What it does                                                                                                    |
| ----------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `check-licenses.js`     | `security:licenses`  | Validates installed deps against `license-policy.json` via `license-checker`; ESM (fixed from legacy `require`) |
| `check-license.ts`      | `check-license`      | Verifies `package.json` license matches the `LICENSE` file text                                                 |
| `check-dependencies.ts` | `check-dependencies` | Runs `knip` as a dependency-consistency check                                                                   |
| `validate-exports.ts`   | `validate-exports`   | `publint` + `tsc --noEmit` export validation                                                                    |
| `health-report.ts`      | `health-report`      | Runs typecheck + lint + tests, summarizes pass/fail                                                             |
| `dependency-graph.ts`   | `dependency-graph`   | `madge src --image reports/architecture/dependency-graph.svg`                                                   |
| `analyze-bundle.ts`     | `analyze-bundle`     | Rebuilds with tsup and lists largest `dist` entries                                                             |
| `clean-cache.ts`        | `clean-cache`        | Removes `dist/coverage/temp/.turbo/node_modules/.cache`                                                         |

## Practical rules

- DO use these instead of ad-hoc shell for the same jobs (they encode the
  repo's paths and flags).
- DO NOT import anything from `scripts/` into `src/` or tests — tooling flows
  one way (scripts consume packages, never reverse).
- `check-licenses.js` shells to `npx license-checker`; it needs network on
  first use for the npx cache.
