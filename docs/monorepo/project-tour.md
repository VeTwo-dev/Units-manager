# Project Tour — Every Part of the Codebase

## Root

| Path                                                           | What it is                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                                 | Private workspace root (`goog`). Scripts orchestrate via turbo; `workspaces: packages/*, apps/*`; devDeps are repo tooling (turbo, eslint, prettier, knip, publint, tsx, changesets, madge) |
| `pnpm-workspace.yaml`                                          | Workspace globs, `linkWorkspacePackages`, esbuild build approval                                                                                                                            |
| `turbo.json`                                                   | Task graph: `build` outputs `dist/**`; lint/types/test/analyze all `dependsOn: ^build`                                                                                                      |
| `tsconfig.json` / `tsconfig.build.json` / `tsconfig.base.json` | Strict TS settings shared by packages (ES2022, `noUnusedLocals`, composite builds)                                                                                                          |
| `eslint.config.mjs`                                            | Flat config: `@eslint/js` + `typescript-eslint` + `eslint-config-prettier`; zero-warning policy                                                                                             |
| `.prettierrc.json` / `.prettierignore`                         | Formatting rules; root `format` / `format:check` scripts                                                                                                                                    |
| `knip.json`                                                    | Workspaces-aware unused-code config (the CI gate)                                                                                                                                           |
| `scripts/sync-workspace.ts`                                    | Workspace maintenance: madge inter-package graph + shared-dep version check                                                                                                                 |
| `.changeset/`                                                  | Changesets state (versioning source of truth)                                                                                                                                               |
| `.manypkgrc.json`                                              | manypkg workspace declaration (tool unpublished upstream — see releases.md)                                                                                                                 |
| `.husky/` (per package)                                        | `pre-commit` → `npx lint-staged`; `commit-msg` length guard                                                                                                                                 |
| `.github/`                                                     | `workflows/` (verify, release, publish), dependabot, issue/PR templates, funding                                                                                                            |
| `docs/`                                                        | This documentation (guides + monorepo operations + agent guides)                                                                                                                            |
| `agents/`                                                      | Portable AI agent guides (`units.agent.md`, `nutrition-units.agent.md`)                                                                                                                     |
| ` turbo` cache dirs (`.turbo/`)                                | Never edit; `pnpm run clean` removes them                                                                                                                                                   |

## A package (`packages/Units`, `packages/Nutrition-units`)

```text
package/
  src/            library source; entry src/index.ts (the ONLY public surface)
  src/examples/  integration examples (nutrition only; never exported from index)
  src/*.bench.ts benchmark sources (Units conversion.bench.ts; never bundled)
  tests/         vitest suites (see test-inventory.md)
  scripts/       tsx utilities (see tooling-scripts.md)
  docs/          package-local specs (Units: getting-started, DIMENSION_SPEC…)
  dist/          build output (tsup: ESM+CJS+DTS) — generated, never edited
  coverage/      v8 reports — generated
  ARCHITECTURE.md / README.md / CHANGELOG.md / LICENSE
  package.json   publish metadata, exports map, full script catalog
  tsup.config.ts / vitest.config.ts / tsconfig*.json / knip.json / eslint bits
  license-policy.json + .lintstagedrc.json + .husky/
```

## The consumer app (`apps/nutrition-units-example`)

Private workspace package proving the built `dist` artifacts through public
APIs only: `src/index.ts` (`runDemo()` + tsx entrypoint),
`tests/consumer.test.ts` (package-name imports). See [consumer-app.md](consumer-app.md).

## Dependency direction (architectural law)

```text
apps → @vetwo/nutrition-units → @vetwo/units → zero runtime dependencies
```

`@vetwo/units` has no runtime dependencies at all. Verified continuously by
the `circular` (madge) gate — see [ci.md](ci.md).
