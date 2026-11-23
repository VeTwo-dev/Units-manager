"""Test macros.

The repository's primary test runner is Vitest; Jest is used only by Backstage.
Vitest runs through a generated Node.js CLI harness (see `harness.bzl`), because
`rules_js` exposes a linked npm package as a tree artifact whose CLI is not an
addressable Bazel file and `npm_translate_lock` does not generate a bin target
for these tools.

The public target convention is `//some/package:test`. Framework details stay
inside the macro: packages keep their existing configuration, discovery rules,
setup files and failure semantics.

Requirements on the caller:

  * `npm_link_all_packages()` must have run in the package BUILD file, so that
    `:node_modules/<runner>` exists.
  * `srcs` must cover every file the runner's `include` pattern would match.
    The sandbox only contains declared inputs, so anything not listed is
    invisible to the runner. `data` carries the remaining runtime inputs
    (sources under test, configs, fixtures, `package.json`).
"""

load("@aspect_rules_js//js:defs.bzl", "js_test")
load("@rules_shell//shell:sh_test.bzl", "sh_test")
load("//bazel/macros:harness.bzl", "VETWO_NODE", "vetwo_node_harness")
load("//bazel/macros:labels.bzl", "vetwo_label")

def _vetwo_rootpath(value):
    """Render a label as a runfiles-relative path for a `sh_test` argument."""
    return "$(rootpath %s)" % vetwo_label(value)

def _vetwo_runner_test(
        name,
        tool,
        entry_args,
        srcs,
        data,
        deps,
        env,
        size,
        visibility,
        cwd = None,
        **kwargs):
    harness, launcher = vetwo_node_harness(name, prefix = "runner", cwd = cwd)

    run_data = [VETWO_NODE, launcher, vetwo_label("//:node_modules/%s" % tool)]
    run_data.extend(srcs)
    run_data.extend(data)
    run_data.extend(deps)

    run_args = ["$(rootpath %s)" % VETWO_NODE, "$(rootpath %s)" % launcher, tool]
    run_args.extend(entry_args)

    sh_test(
        name = name,
        srcs = [harness],
        data = run_data,
        args = run_args,
        env = env,
        size = size,
        visibility = visibility,
        **kwargs
    )

def vetwo_test(name, entry_point, data = [], deps = [], size = "small", visibility = None, **kwargs):
    """Declare a generic JavaScript test executed by Node.js.

    Args:
      name: target name.
      entry_point: JS file executed as the test entry point (same package).
      data: runtime files the test needs.
      deps: Bazel dependencies (folded into `data`; `js_test` has no `deps`).
      size: Bazel test size.
      visibility: target visibility.
      **kwargs: forwarded to `js_test`.
    """
    js_test(
        name = name,
        entry_point = entry_point,
        data = list(data) + list(deps),
        size = size,
        visibility = visibility,
        **kwargs
    )

def vetwo_vitest(
        name,
        srcs = [],
        config = "vitest.config.ts",
        data = [],
        deps = [],
        env = {},
        args = [],
        size = "medium",
        visibility = None,
        cwd = None,
        **kwargs):
    """Declare a Vitest suite using the package's own configuration.

    Args:
      name: target name (conventionally `test`).
      srcs: every file matched by the config's `include` patterns.
      config: vitest config path, relative to the package.
      data: additional runtime inputs (sources under test, `package.json`,
        `tsconfig*.json`, setup files, fixtures).
      deps: Bazel dependencies.
      env: environment variables for the test action.
      args: extra vitest CLI arguments.
      size: Bazel test size.
      visibility: target visibility.
      cwd: optional path, relative to the runfiles workspace root, to run from.
        Set it to the package path when the suite resolves paths from
        `process.cwd()`.
      **kwargs: forwarded to `sh_test`.
    """
    config_label = vetwo_label(config)

    # Path handling depends on where the runner executes:
    #   cwd = None -> harness runs at the runfiles workspace root, so the config
    #                 must be a runfiles-relative path.
    #   cwd set    -> the runner executes inside `cwd`, so the config must be
    #                 relative to that directory. `config` is documented as
    #                 package-relative, and `cwd` is the package path in that
    #                 case, so it is passed through unchanged.
    if cwd == None:
        config_arg = _vetwo_rootpath(config)
    elif config.startswith("//") or config.startswith(":"):
        fail("vetwo_vitest: `config` must be package-relative when `cwd` is set")
    else:
        config_arg = config

    entry_args = ["run", "--config", config_arg] + list(args)

    run_data = list(data)
    run_data.append(config_label)

    _vetwo_runner_test(
        name = name,
        tool = "vitest",
        entry_args = entry_args,
        srcs = srcs,
        data = run_data,
        deps = deps,
        env = env,
        size = size,
        visibility = visibility,
        cwd = cwd,
        **kwargs
    )