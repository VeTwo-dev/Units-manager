# Script Reference

All names below are verified against the actual `package.json` files. Root
scripts orchestrate via `turbo run <task>` (dependency-ordered, cached);
package scripts do the real work.

## Root (`package.json`)

| Script                                                                                                                         | What it does                                                          |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `format` / `format:check`                                                                                                      | `prettier --write .` / `--check .` across the repo (new root scripts) |
| `dev` / `build` / `clean`                                                                                                      | turbo watch / build / clean artifacts                                 |
| `lint` / `lint:fix`                                                                                                            | turbo eslint (`--max-warnings=0`)                                     |
| `check-types`                                                                                                                  | turbo `tsc --noEmit`                                                  |
| `check`                                                                                                                        | `turbo run check-types lint test`                                     |
| `verify`                                                                                                                       | `turbo run lint format check-types test build` (the CI gate)          |
| `verify:full`                                                                                                                  | `verify` + `knip` + `publint`                                         |
| `test`, `test:unit`, `test:integration`, `test:e2e`, `test:smoke`, `test:browser`, `test:performance`, `test:ci`, `test:debug` | turbo test variants                                                   |
| `coverage`                                                                                                                     | turbo coverage                                                        |
| `knip`                                                                                                                         | unused-code analysis (root workspaces config)                         |
| `publint` / `verify:publint`                                                                                                   | package publishability lint                                           |
| `circular`                                                                                                                     | `madge` circular-dependency audit                                     |
| `analyze`, `analyze:circular`, `analyze:deps`                                                                                  | architecture/dependency reports                                       |
| `deps`, `deps:check`, `deps:dedupe`, `deps:list`, `deps:outdated`, `deps:update`, `deps:why`                                   | dependency inspection                                                 |
| `security` / `security:ci` / `security:licenses`                                                                               | license-policy checks                                                 |
| `changeset` / `version` / `release` / `verify:changesets`                                                                      | changesets lifecycle                                                  |
| `verify:manypkg` / `validate`                                                                                                  | `npx manypkg check` (see releases.md — tool unpublished upstream)     |
| `sync-workspace`                                                                                                               | `tsx scripts/sync-workspace.ts` workspace maintenance                 |
| `publish`                                                                                                                      | `npm publish --access public` (packages publish individually too)     |

## Package scripts (`packages/*/package.json`)

Each package provides: `dev` (tsup watch), `build` (tsup ESM+CJS+DTS),
`clean`, `check-types`, `format` / `format:check` (prettier),
`lint` / `lint:fix`, `coverage` (+ `coverage:open`, `coverage:ui`),
`test` / `test:watch` / `test:unit` / `test:integration` / `test:e2e` /
`test:types` / `test:browser` / `test:ci` / `test:debug` / `test:performance`
(`vitest bench --run`) / `test:smoke`, `circular`, `knip`, `pack:check`
(+ `:pnpm` variant), `packit`, `publint`, `check`, `ci`, `verify` (+ `:bun`,
`:pnpm`, `:full` variants), `prepublish` (+ `:full`), `publish`, `analyze`
(+ `:circular`, `:deps`), `deps*`, `prepare` (husky), `security*`, plus
`tsx` utilities: `clean-cache`, `analyze-bundle`, `check-license`,
`validate-exports`, `check-dependencies`, `health-report`, `dependency-graph`.

## Consumer app (`apps/nutrition-units-example`)

`start` (`tsx src/index.ts`), `build`/`check-types` (`tsc --noEmit`),
`lint`, `test` (`vitest run`), `verify` (types + lint + test).
