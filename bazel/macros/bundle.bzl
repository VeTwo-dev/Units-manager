"""Bundler integration for packages whose real build is a bundler.

Several repository packages build with `tsup` (esbuild) rather than with `tsc`:
`ts_project` emits one output file per source file, so it cannot reproduce a
bundle, and it cannot emit the `.cjs` / `.d.cts` artifacts that those packages'
export maps require.

`vetwo_bundle` closes that gap without replacing the bundler: it runs the
package's real bundler (`tsup` by default) as a Bazel build action and declares
its output directory, so the bundler remains the single source of truth for the
artifact while Bazel owns caching, sandboxing and incrementality.

Public API:

  vetwo_bundle(name, tool, srcs, deps, data, args, out_dir, config, env, ...)

The target it creates is a build action producing a directory tree (the bundle),
not a test and not a runnable binary.

Measured execution model (supersedes the earlier "runs from the runfiles
workspace root" note, which was wrong)
--------------------------------------------------------------------------
`js_run_binary(chdir = <package>)` sets the action's working directory to
`bazel-out/<config>/bin/<package>` -- verified directly by a probe that printed
`process.cwd()` from inside the action. `copy_srcs_to_bin = True` places the
declared sources, the bundler config, `tsconfig.json` and `package.json` in that
same directory, so cwd, config discovery and the source tree do agree.

An earlier attempt to force this from the generated launcher
(`process.chdir(__dirname)`) had no effect for a mundane reason: `__dirname` is
the launcher's own generated package (`bazel/macros/`), not the target package.
That experiment measured the wrong directory, not a failure of `chdir`.

`copy_srcs_to_bin = False` is not a workaround: with no bin copy the sources are
absent from the sandbox working tree and the bundler reports "No input files".

Open blocker B5-8 (root cause narrowed to a path-base split, not closed)
---------------------------------------------------------------------------
Every input was verified present and correctly placed in the action's working
directory, and `tsc --showConfig -p tsconfig.json` resolves `rootDir` to `./src`
there. The declaration pass still rejects the same files.

Overriding `rootDir` to an absolute path proved which two paths disagree:

  error TS6059: File '<output-base>/execroot/_main/bazel-out/<cfg>/bin/<pkg>/src/index.ts'
                is not under 'rootDir'
                '<sandbox>/execroot/_main/bazel-out/<cfg>/bin/<pkg>/src'

The file path carries no sandbox segment; the working-directory-derived `rootDir`
does. `fs.realpathSync(process.cwd())` and `fs.realpathSync(<cwd>/src)` both
still return the sandbox-prefixed path, so the disagreement is not a symlink that
Node resolves -- the declaration stage resolves its file paths against the real
output base while the launcher's cwd is the sandboxed bind mount of it.

Because the package's own `rootDir: ./src` is correct under `pnpm build`, the fix
must reconcile these two bases. It is deliberately not implemented by rewriting
the package tsconfig, by dropping `rootDir`, or by disabling declaration emit.

Levers measured and closed:
  - `copy_srcs_to_bin = False`: working directory loses `src/`, `tsconfig.json`
    and the bundler config; the bundler reports "No input files".
  - Launcher `process.chdir(__dirname)`: targeted the launcher's own generated
    package, not the target package, so it measured nothing.
  - `--tsconfig` pointing at a generated config with an absolute `rootDir`:
    honoured (the diagnostic shows the generated path) but still mismatched,
    because the absolute value was derived from the sandboxed cwd.
"""

load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//bazel/macros:harness.bzl", "vetwo_node_launcher")

def _dedupe(labels):
    """Drop duplicate labels while preserving order.

    Callers commonly pass a shared dependency set that already contains a label
    they also list explicitly; Bazel rejects duplicates in `data`, so the macro
    normalises them instead of pushing that onto every call site.
    """
    seen = {}
    result = []
    for label in labels:
        if label in seen:
            continue
        seen[label] = True
        result.append(label)
    return result

def vetwo_bundle(
        name,
        tool = "tsup",
        srcs = [],
        deps = [],
        data = [],
        args = [],
        out_dir = "dist",
        config = None,
        env = {},
        copy_srcs_to_bin = True,
        visibility = None,
        **kwargs):
    """Run a JavaScript bundler and declare its output directory.

    The bundler runs through the same generated Node.js launcher used by the
    lint and test macros, so an npm-shipped CLI (which `npm_translate_lock`
    exposes as a tree artifact with no bin target) is addressable.

    Args:
      name: target name; conventionally `build`.
      tool: npm package name of the bundler (resolved from this package's
        `:node_modules/<tool>` link).
      srcs: every file the bundler reads (sources, its config, `package.json`,
        `tsconfig*.json`).
      deps: Bazel dependencies that must be present in the sandbox (type
        resolution for declaration emit).
      data: additional runtime inputs.
      args: bundler CLI arguments. `tool` itself is prepended by the launcher.
      out_dir: the directory the bundler writes, relative to the package; also
        the name of the declared Bazel output directory.
      config: optional bundler config path, passed as `--config`.
      env: environment variables for the action.
      copy_srcs_to_bin: forwarded to `js_run_binary`. Defaults to True, which
        copies the declared inputs under `bazel-bin`; set False to run against the
        runfiles copy instead. The choice must match the bundler's working
        directory, or the config and the sources end up in different trees (see
        the `chdir` note below).
      visibility: target visibility.
      **kwargs: forwarded to `js_run_binary`.
    """
    launcher = vetwo_node_launcher(name, prefix = "bundle")
    tool_name = "%s_tool" % name

    js_binary(
        name = tool_name,
        entry_point = launcher,
        data = _dedupe([":node_modules/%s" % tool] + list(deps) + list(data)),
    )

    run_srcs = list(srcs) + list(data)
    bundle_args = list(args)
    if config != None:
        run_srcs.append(config)
        bundle_args = ["--config", config] + bundle_args

    js_run_binary(
        name = name,
        tool = ":" + tool_name,
        srcs = _dedupe(run_srcs),
        out_dirs = [out_dir],
        args = [tool] + bundle_args,
        # Run from the package directory so the bundler finds its own config and
        # sources exactly as it does under `pnpm --filter <pkg> build`.
        chdir = native.package_name(),
        copy_srcs_to_bin = copy_srcs_to_bin,
        env = env,
        visibility = visibility,
        **kwargs
    )