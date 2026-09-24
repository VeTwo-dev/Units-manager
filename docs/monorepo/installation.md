# Installation & Troubleshooting

## Prerequisites (verified)

- **Node.js `>= 20`** (root `engines`; packages accept `>= 18`; CI uses Node 20).
- **pnpm `11.21.0` exactly** (`packageManager` field). Use corepack:

```sh
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm --version  # 11.21.0
```

## Install paths

**Contributors (this repo):**

```sh
pnpm install   # all workspaces; runs husky prepare per package
pnpm run build # turbo, dependency-ordered
pnpm run test  # full suites
```

**Consumers (your own project):**

```sh
npm install @vetwo/units                          # engine only
npm install @vetwo/units @vetwo/nutrition-units   # engine + domain layer
```

Published artifacts per package: ESM (`dist/index.js`), CJS
(`dist/index.cjs`), types (`dist/index.d.ts` / `.d.cts`).

## Troubleshooting (all observed first-hand)

| Symptom                                                   | Cause                                  | Fix                                                          |
| --------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| `.git can't be found … Done` during install               | `husky prepare` outside a git checkout | Benign — hooks install on the next git-backed install        |
| `pnpm install` resolves a different pnpm                  | corepack not activated                 | Run the corepack commands above                              |
| `ERR_PNPM_ADDING_TO_ROOT` on `pnpm add -D`                | pnpm protects the workspace root       | Re-run with `-w` (`pnpm add -Dw <pkg>`)                      |
| `require is not defined in ES module scope` (old scripts) | legacy CJS in `"type": "module"`       | Already fixed repo-wide (ESM imports); report any recurrence |
| `No versions available … unpublished` (manypkg)           | package removed upstream               | Do not install; see releases.md                              |
| Turbo re-runs everything after formatting                 | source mtimes changed cache keys       | Expected — one slow run, then cached                         |
| `vitest bench` takes minutes                              | full benchmark suite is large          | Scope it: `vitest bench --run src/conversion.bench.ts`       |

## Verifying your setup

```sh
node --version && pnpm --version
pnpm run check-types && pnpm run lint
pnpm --filter @vetwo/nutrition-units-example start   # runnable proof
```
