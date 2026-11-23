"""Lint macros.

Linting is a first-class Bazel test so `bazel test //...` enforces the same
rules as the package-manager lint script.

Two linters are supported, matching the repository:

  * `oxlint`  — the fast Rust-based linter used by the repo root and the CLI
                packages (root devDependency, `oxlint@1.93.0`).
  * `eslint`  — used by the web/app packages (root devDependency, `eslint@9`).

Both are resolved from the workspace-root `node_modules` link tree that
`npm_link_all_packages()` generates in the root BUILD file, i.e.
`//:node_modules/<tool>`.

Why a generated harness: `rules_js` requires a `js_test` entry point to be a
source file in the same package as the target, and a linked npm package is
exposed as a tree artifact whose CLI is not an addressable file. A reusable
macro therefore cannot point `entry_point` at a shared file. Instead the macro
writes a tiny launcher and shell harness into the calling package with
`genrule`, and runs them through `sh_test` with the hermetic Node.js binary.
"""

load("@rules_shell//shell:sh_test.bzl", "sh_test")
load("//bazel/macros:harness.bzl", "VETWO_NODE", "vetwo_node_harness")
load("//bazel/macros:labels.bzl", "vetwo_label")

def _vetwo_lint_target(name, tool, srcs, deps, config, args, size, visibility, cwd = None, **kwargs):
    harness, launcher = vetwo_node_harness(name, prefix = "lint", cwd = cwd)

    lint_args = list(args)
    lint_data = [VETWO_NODE, launcher, "//:node_modules/%s" % tool] + list(deps)

    if config != None:
        config_label = vetwo_label(config)
        lint_data.append(config_label)

        # `sh_test` runs from the runfiles workspace root, so the config must be
        # passed as a runfiles-relative path, not as the bare label string.
        lint_args = ["--config", "$(rootpath %s)" % config_label] + lint_args

    # Source paths are passed as workspace-relative runfiles paths.
    src_args = []
    for src in srcs:
        src_args.append("$(rootpath %s)" % src)
    lint_data.extend(srcs)

    sh_test(
        name = name,
        srcs = [harness],
        data = lint_data,
        args = ["$(rootpath %s)" % VETWO_NODE, "$(rootpath %s)" % launcher, tool] + lint_args + src_args,
        size = size,
        visibility = visibility,
        **kwargs
    )

def vetwo_oxlint(name, srcs = [], deps = [], config = None, args = [], deny_warnings = True, size = "small", visibility = None, cwd = None, **kwargs):
    """Lint sources with oxlint.

    Warnings are fatal: oxlint exits 0 for warnings unless `--deny-warnings` is
    passed, and the repository's own lint scripts use `--max-warnings 0`
    (e.g. `create-vetwo-pack`'s `lint:fast`). The macro therefore enables
    `--deny-warnings` by default so `bazel test //...` enforces the same policy.

    `--quiet` is *not* an escape hatch: it only suppresses warning reporting and
    does not change the exit code, so callers must use `deny_warnings = False`
    to allow warnings.

    Args:
      name: target name.
      srcs: source labels to lint.
      deps: extra Bazel dependencies.
      config: optional oxlint config file (e.g. `.oxlintrc.json`).
      args: extra oxlint arguments.
      deny_warnings: when True (default), fail the test on warnings.
      size: Bazel test size.
      visibility: target visibility.
      cwd: optional path, relative to the runfiles workspace root, to run from.
      **kwargs: forwarded to `sh_test`.
    """
    lint_args = (["--deny-warnings"] if deny_warnings else []) + list(args)
    _vetwo_lint_target(name, "oxlint", srcs, deps, config, lint_args, size, visibility, cwd = cwd, **kwargs)

def vetwo_eslint(name, srcs = [], deps = [], config = None, args = [], size = "small", visibility = None, cwd = None, **kwargs):
    """Lint sources with ESLint.

    Args:
      name: target name.
      srcs: source labels to lint.
      deps: extra Bazel dependencies.
      config: optional ESLint config file (e.g. `eslint.config.mjs`).
      args: extra ESLint arguments.
      size: Bazel test size.
      visibility: target visibility.
      cwd: optional path, relative to the runfiles workspace root, to run from.
        Set it to the package path when the eslint config's `files` patterns
        are package-relative.
      **kwargs: forwarded to `sh_test`.
    """
    _vetwo_lint_target(name, "eslint", srcs, deps, config, args, size, visibility, cwd = cwd, **kwargs)