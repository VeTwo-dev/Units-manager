"""Independent type-checking macros.

`vetwo_typecheck` runs `tsc --noEmit` on a package's sources without producing
any output. It is implemented with `ts_project(no_emit = True)`:

  * `no_emit = True` means no JS or declaration files are produced, so the
    transpiler-selection guard in `rules_ts` is not triggered (there are no
    outputs to transpile).
  * `rules_ts` detects "not emitting anything" and automatically creates the
    `<name>_typecheck` filegroup plus the `<name>_typecheck_test` build_test,
    which is what `bazel test //...` / `bazel build <name>_typecheck` run.

Use this when you want a pure typecheck target that is independent from the
build target, or when a package has no emit step at all.
"""

load("@aspect_rules_ts//ts:defs.bzl", "ts_config", "ts_project")
load("//bazel/macros:typescript.bzl", "vetwo_apply_defaults")

def vetwo_typecheck(
        name,
        srcs,
        deps = [],
        tsconfig = None,
        tsconfig_json = "tsconfig.json",
        use_tsconfig = True,
        visibility = None,
        **kwargs):
    """Type-check sources with `tsc --noEmit` (no outputs).

    Args:
      name: target name. `rules_ts` generates `<name>_typecheck` (buildable
        filegroup) and `<name>_typecheck_test` (build_test) alongside it.
      srcs: TypeScript sources to check.
      deps: Bazel dependencies (npm packages and/or other TS targets).
      tsconfig: label of an existing `ts_config` target. When omitted, a
        `ts_config` named `<name>_tsconfig` is created from `tsconfig_json`.
      tsconfig_json: tsconfig path used when `tsconfig` is omitted.
      use_tsconfig: if False, skip `ts_config` and pass compiler options
        directly to `ts_project` without `--project`. Use when the tsconfig
        has `include` paths that don't resolve in the Bazel sandbox.
      visibility: target visibility.
      **kwargs: forwarded to `ts_project` (e.g. `isolated_typecheck = True`).
    """
    opts = vetwo_apply_defaults(kwargs)

    # A pure typecheck emits nothing: `no_emit` removes the outputs and also
    # removes the transpiler-selection requirement (which only triggers when
    # there is something to emit). `transpiler` must therefore NOT be set,
    # otherwise rules_ts would treat tsc as the emitter and skip creating the
    # standalone `<name>_typecheck` / `<name>_typecheck_test` targets.
    opts.pop("transpiler", None)
    opts["no_emit"] = True

    # The package tsconfig is a build config (it does not set `noEmit`), so the
    # rules_ts option validator would reject the injected `no_emit`. The emit
    # mode is intentionally overridden here, so validation is disabled.
    opts.setdefault("validate", False)

    tsconfig_label = tsconfig
    if use_tsconfig and tsconfig_label == None:
        tsconfig_label = ":%s_tsconfig" % name
        ts_config(
            name = "%s_tsconfig" % name,
            src = tsconfig_json,
            visibility = visibility,
        )

    ts_project(
        name = name,
        srcs = srcs,
        deps = deps,
        tsconfig = tsconfig_label if use_tsconfig else None,
        visibility = visibility,
        **opts
    )