"""TypeScript build macros for the VeTwo monorepo.

Thin wrappers around `rules_ts` (`ts_config` / `ts_project`) that encode the
repository-wide compiler defaults, so every package in the workspace emits
identical artifacts and is compiled with the same settings.

Callers only supply what is package-specific (sources, dependencies, tsconfig);
everything else is defaulted here.
"""

load("@aspect_rules_ts//ts:defs.bzl", "ts_config", "ts_project")

# Repository-wide defaults for emitted TypeScript.
#
# - `transpiler = "tsc"`  compile with tsc itself (no separate SWC/esbuild
#                         toolchain is provisioned in this repo). Because tsc
#                         emits both JS and .d.ts in one action, a dedicated
#                         `_typecheck` target is produced as well.
# - `declaration` / `declaration_map` / `source_map`  full, debuggable output.
# - `out_dir = "dist"` / `root_dir = "src"`  matches every package layout.
VETWO_TS_DEFAULTS = {
    "transpiler": "tsc",
    "declaration": True,
    "declaration_map": True,
    "source_map": True,
    "out_dir": "dist",
    "root_dir": "src",
}

def vetwo_apply_defaults(overrides):
    """Return VETWO_TS_DEFAULTS overlaid with the caller's overrides."""
    out = {}
    for key in VETWO_TS_DEFAULTS:
        out[key] = VETWO_TS_DEFAULTS[key]
    for key in overrides:
        out[key] = overrides[key]
    return out

def vetwo_ts_config(name, src = "tsconfig.json", deps = [], visibility = None, **kwargs):
    """Declare a `ts_config` target wrapping a package's tsconfig.json.

    Args:
      name: target name.
      src: path to the tsconfig.json (relative to the package).
      deps: extra labels the tsconfig depends on (e.g. a base tsconfig).
      visibility: target visibility.
      **kwargs: forwarded to `ts_config`.
    """
    ts_config(
        name = name,
        src = src,
        deps = deps,
        visibility = visibility,
        **kwargs
    )

def vetwo_ts_library(
        name,
        srcs,
        deps = [],
        tsconfig = None,
        tsconfig_json = "tsconfig.json",
        visibility = None,
        **kwargs):
    """Compile a TypeScript library.

    Emits `<out_dir>/*.js`, `*.d.ts` and source maps, exactly like the
    package's own `tsc -p tsconfig.json` build.

    Args:
      name: target name (also the default output bundle name).
      srcs: TypeScript sources (typically `glob(["src/**/*.ts"])`).
      deps: Bazel dependencies (npm packages and/or other `vetwo_ts_library`).
      tsconfig: label of an existing `ts_config` target. When omitted, a
        `ts_config` named `<name>_tsconfig` is created from `tsconfig_json`.
      tsconfig_json: tsconfig path used when `tsconfig` is omitted.
      visibility: target visibility.
      **kwargs: overrides for VETWO_TS_DEFAULTS (e.g. `declaration = False`).
    """
    opts = vetwo_apply_defaults(kwargs)

    tsconfig_label = tsconfig
    if tsconfig_label == None:
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
        tsconfig = tsconfig_label,
        visibility = visibility,
        **opts
    )