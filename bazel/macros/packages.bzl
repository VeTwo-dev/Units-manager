"""Package-level macros.

`vetwo_ts_package` is the one-call entry point for a TypeScript package: it
wires the shared tsconfig, the build target and the independent typecheck
target, so a package BUILD file stays declarative.
"""

load("@npm//:defs.bzl", "npm_link_all_packages")
load("//bazel/macros:typecheck.bzl", "vetwo_typecheck")
load("//bazel/macros:typescript.bzl", "vetwo_ts_config", "vetwo_ts_library")

def vetwo_ts_package(
        name = "package",
        srcs = [],
        deps = [],
        tsconfig = "tsconfig.json",
        tsconfig_deps = [],
        link_workspace_root = False,
        build_name = "build",
        visibility = None,
        **kwargs):
    """Declare a complete TypeScript package.

    Generates:
      * `tsconfig`              — `ts_config` over the package tsconfig.
      * `build`                 — `ts_project` emitting `dist/*.js` + `.d.ts`.
      * `build_types`           — `ts_project` type output group (from rules_ts).
      * `build_typecheck`       — buildable `tsc --noEmit` check.
      * `build_typecheck_test`  — `build_test` over the typecheck output group.
      * `ts_typecheck`          — buildable independent typecheck target.
      * `ts_typecheck_test`     — `build_test` over `ts_typecheck`.
      * `typecheck`             — alias for `ts_typecheck`.

    Args:
      name: package name (informational; target names are fixed below).
      srcs: TypeScript sources (typically `glob(["src/**/*.ts"])`).
      deps: Bazel dependencies (npm packages and/or other TS targets).
      tsconfig: tsconfig path relative to the package.
      tsconfig_deps: labels of tsconfig files the package tsconfig extends.
        `rules_ts` does not pull an extended config in transitively, so a
        package whose tsconfig `extends` a parent must declare it here.
      link_workspace_root: when True, call `npm_link_all_packages()` to create
        the package's `node_modules` link tree. Set False for packages outside
        the pnpm workspace (e.g. Bazel fixtures).
      build_name: name of the build target.
      visibility: target visibility.
      **kwargs: forwarded to `ts_project` (e.g. `declaration = False`).
    """
    if link_workspace_root:
        npm_link_all_packages()

    vetwo_ts_config(
        name = "tsconfig",
        src = tsconfig,
        deps = tsconfig_deps,
        visibility = visibility,
    )

    vetwo_ts_library(
        name = build_name,
        srcs = srcs,
        deps = deps,
        tsconfig = ":tsconfig",
        visibility = visibility,
        **kwargs
    )

    vetwo_typecheck(
        name = "ts",
        srcs = srcs,
        deps = deps,
        tsconfig = ":tsconfig",
        visibility = visibility,
    )

    native.alias(
        name = "typecheck",
        actual = ":ts_typecheck",
        visibility = visibility,
    )