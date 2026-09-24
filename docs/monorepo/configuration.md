# Configuration Reference

All files below are verified present with the stated roles. Edit them only
with a stated reason — several encode project policy (zero-warning lint,
strict types, frozen public surface).

## TypeScript

- `tsconfig.base.json` — shared base: `ES2022`, `module/moduleResolution`
  `Node16` (root) or `Bundler` (base), `strict`, `skipLibCheck`,
  `noUnusedLocals` + `noUnusedParameters`, `verbatimModuleSyntax` (base).
- `tsconfig.json` / `tsconfig.build.json` (root) and per-package
  `tsconfig.json` (`extends` base, `include: ["src"]`, excludes
  `dist/node_modules/tests/scripts`) plus `tsconfig.test.json` for
  `test:types` runs.

## Lint & format

- `eslint.config.mjs` (root, flat config): `@eslint/js` recommended +
  `typescript-eslint` recommended + `eslint-config-prettier` last;
  `no-unused-vars` as error (`^_` exemption); ignores
  `dist/coverage/docs/node_modules/.turbo/scripts/reports`.
- `pnpm run lint` enforces `--max-warnings=0` — warnings fail CI.
- Prettier: `.prettierrc.json` + per-package `.prettierignore`; **root
  `.prettierignore`** excludes `node_modules/dist/coverage/.turbo`,
  lockfiles, and `reports/`.
- Root scripts (new): `format` (`prettier --write .`) and
  `format:check` (`prettier --check .`); packages mirror with per-package
  `format` / `format:check`.
- Husky + `lint-staged`: per-package `.husky/pre-commit` runs
  `npx lint-staged` against `.lintstagedrc.json`
  (`*.ts → eslint --fix, prettier --write`; `*.{json,md,yml} → prettier`).

## Build & test tooling

- `tsup.config.ts` (root + per-package): entry `src/index.ts` → ESM + CJS +
  DTS with sourcemaps (`treeshake`, `clean`). Examples/benchmarks/tests are
  never bundled.
- `vitest.config.ts` (per-package): node env, `src/**/*.test.ts` +
  `tests/**/*.test.ts`, v8 coverage over `src/**`.
- `turbo.json`: `build` outputs `dist/**`; `lint/check-types/test/...`
  all `dependsOn: ["^build"]`; app `build` (`tsc --noEmit`) overrides outputs
  to `[]` in its own `turbo.json`.

## Analysis & workspace

- `knip.json` (root workspaces-aware) + per-package `knip.json`: entries cover
  `src/index.ts`, tests, examples, and the bench file; config-driven
  devDependencies are allow-listed with evidence (see Prompt 25 report in
  project history). Root `pnpm knip` is the gate.
- `pnpm-workspace.yaml`: `packages/*` + `apps/*`, `linkWorkspacePackages`,
  `onlyBuiltDependencies: [esbuild]`.
- `.changeset/config.json`, `.manypkgrc.json` (see releases.md),
  `license-policy.json` per package, `.editorconfig`, `.vscode/`, `.github/`.
