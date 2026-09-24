# CI, Hooks & Automation

## GitHub workflows (`.github/workflows/`, verified)

| Workflow      | Trigger                  | Steps                                                                                    |
| ------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `verify.yml`  | push / PR to `main`      | Node 20, `pnpm install --frozen-lockfile`, then `lint`, `check-types`, `test`, `build`   |
| `release.yml` | push to `main`           | build, then `changesets/action` — opens a version PR or publishes via `pnpm run publish` |
| `publish.yml` | GitHub release published | build, then `npm publish --provenance` (needs `NPM_TOKEN`)                               |

Note: CI runs the four stages separately (not the local `verify` alias, which
additionally includes `format`). Keep `pnpm format:check` green locally so
auto-fix commits never appear.

## Local gates (husky + lint-staged)

Each package ships `.husky/`:

- `pre-commit` → `npx lint-staged` → per `.lintstagedrc.json`:
  `*.ts` get `eslint --fix` + `prettier --write`;
  `*.{json,md,yml}` get `prettier --write`.
- `commit-msg` → rejects one-liners (minimum 10 characters).
- `prepare` script installs hooks on `pnpm install`. The
  `.git can't be found … Done` notice during install is benign (hook install
  skipped outside a git checkout).

`CONTRIBUTING.md` asks for conventional commits
(`<type>(<scope>): <description>`) and `npm test` before pushing; PRs use
`.github/PULL_REQUEST_TEMPLATE.md`, issues use `ISSUE_TEMPLATE/`.

## Dependency automation

`dependabot.yml`: weekly npm + GitHub-Actions updates, max 10 open PRs.
Treat dependabot PRs like any change: they must pass `verify.yml` plus local
`pnpm verify` (which additionally runs format, knip via `verify:full`, and
publint).

## Gate map (what enforces what)

| Gate                        | Enforces                                 |
| --------------------------- | ---------------------------------------- |
| `lint` (`--max-warnings=0`) | zero-warning ESLint                      |
| `format:check`              | prettier-clean tree                      |
| `check-types`               | strict `tsc`, no unused locals/params    |
| `test`                      | 1700+ behavioral assertions              |
| `build`                     | publishable ESM+CJS+DTS                  |
| `knip`                      | no unused files/exports/deps (root gate) |
| `publint`                   | valid `exports`/types/files for npm      |
| `circular` (madge)          | one-way dependency direction             |
| `security:licenses`         | dependency license allowlist             |
