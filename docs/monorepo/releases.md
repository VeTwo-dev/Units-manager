# Releases, Versioning & Compliance

## Changesets lifecycle (verified)

`.changeset/config.json`: public access, `baseBranch: main`,
`updateInternalDependencies: patch`, changelog via `@changesets/cli`.

```sh
pnpm changeset            # describe a change (patch/minor/major per package)
pnpm version              # apply versions + changelogs (changeset version)
pnpm release              # publish (changeset publish)
pnpm verify:changesets    # changeset status (safe, read-only)
```

`@changesets/cli` is declared at root **and** in both packages (the root
scripts use the `changeset` binary directly). Never publish by hand with
`npm publish` bypassing changesets — versions and changelogs would diverge.

## Publishability gates

- `pnpm publint` / `verify:publint` — validates `exports`, types conditions,
  and file lists. (`@vetwo/units` is clean; nutrition-units carries one
  pre-existing types-condition warning — see project history before touching
  packaging config.)
- `pack:check` (`npm pack --dry-run`) / `pack:check:pnpm` — inspect the
  publish tarball without publishing. `prepublish` runs the full local verify.
- `circular` — `madge` must report no circular dependencies (dependency
  direction `nutrition-units → units` is architectural law).

## License compliance

Each package has `license-policy.json` (allowlist) and
`scripts/check-licenses.js` (ESM; shells out to `license-checker`):

```sh
pnpm security:licenses    # turbo across packages; fails on violations
```

## Workspace consistency (`manypkg` caveat)

`verify:manypkg` / `validate` invoke `npx manypkg check`, but `manypkg` is
**unpublished from the npm registry** — these scripts cannot run in a fresh
environment. Until the owner replaces them, rely on `publint`,
`verify:changesets`, and `pnpm -r list` for consistency. Do not reintroduce
the dependency (installs hard-fail).
