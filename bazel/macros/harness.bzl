"""Shared Node.js CLI harness.

`rules_js` exposes a linked npm package as a tree artifact whose CLI is not an
addressable Bazel file, and `npm_translate_lock` does not always generate a bin
target for a tool (`bins = {}`). It also requires a `js_test` / `js_binary`
entry point to be a source file in the same package as the target, so a shared
macro cannot point `entry_point` at a repo-wide runner.

This module solves both problems once, for every macro that needs to execute an
npm-shipped CLI: it generates a tiny shell harness and a JS launcher **inside
the calling package** with `genrule`, and the caller runs them through `sh_test`
with the hermetic Node.js runtime.

Public API:

  vetwo_node_harness(name) -> (harness_label, launcher_label)
      Generates `<name>_node_harness.sh` and `<name>_node_launcher.cjs`.

  VETWO_NODE
      Label of the hermetic Node.js binary for the current platform.

"""

# Hermetic Node.js runtime, resolved per platform.
#
# rules_nodejs registers a separate repo per platform (`@nodejs_linux_amd64`,
# `@nodejs_darwin_arm64`, ...), so a literal repo label here would pin every
# target to one platform. The alias in `bazel/macros/BUILD.bazel` selects the
# correct binary for the platform the harness executes on.
VETWO_NODE = "//bazel/macros:node"

# Launcher: resolves an npm package from the runfiles tree and runs its bin.
_LAUNCHER = """#!/usr/bin/env node
"use strict";

var path = require("path");
var spawnSync = require("child_process").spawnSync;
var createRequire = require("module").createRequire;

function main() {
  var tool = process.argv[2];
  var toolArgs = process.argv.slice(3);
  if (!tool) {
    console.error("usage: node_launcher <npm-package> [args...]");
    return 2;
  }

  var req = createRequire(__filename);
  var pkgJson = req.resolve(tool + "/package.json");
  var pkg = require(pkgJson);
  var bin;
  if (typeof pkg.bin === "string") {
    bin = pkg.bin;
  } else if (pkg.bin && pkg.bin[tool]) {
    bin = pkg.bin[tool];
  } else if (pkg.bin) {
    bin = Object.values(pkg.bin)[0];
  }
  if (!bin) {
    console.error("node_launcher: package " + tool + " declares no bin");
    return 1;
  }
  if (process.env.VETWO_TSCONFIG_NO_ROOTDIR) {
    var fs3 = require("fs");
    var realCwd3 = fs3.realpathSync(process.cwd());
    var tsconfigName = process.env.VETWO_TSCONFIG || "tsconfig.json";
    var tsconfigPath = path.join(realCwd3, tsconfigName);

    function resolveExtends(entryPath) {
      var chain = [];
      var cur = entryPath;
      var guard = 0;
      while (cur && guard++ < 32) {
        var raw = JSON.parse(fs3.readFileSync(cur, "utf8"));
        chain.unshift(raw);
        if (!raw.extends) break;
        var base = path.resolve(path.dirname(cur), raw.extends);
        if (!base.endsWith(".json")) base += ".json";
        if (!fs3.existsSync(base)) break;
        cur = base;
      }
      return chain;
    }

    if (fs3.existsSync(tsconfigPath)) {
      var chain3 = resolveExtends(tsconfigPath);
      var merged = {};
      for (var i3 = 0; i3 < chain3.length; i3++) {
        if (chain3[i3].compilerOptions) {
          merged = Object.assign(merged, chain3[i3].compilerOptions);
        }
      }
      // The declaration stage resolves source paths against a different base
      // than the action cwd; an explicit rootDir then fails TS6059. Omitting it
      // lets tsc infer the common source directory from the real inputs.
      delete merged.rootDir;
      var leaf3 = chain3[chain3.length - 1];
      var flat3 = { "compilerOptions": merged };
      if (leaf3.include) flat3.include = leaf3.include;
      if (leaf3.exclude) flat3.exclude = leaf3.exclude;
      if (leaf3.files) flat3.files = leaf3.files;
      var genPath3 = path.join(realCwd3, "vetwo.tsconfig.generated.json");
      fs3.writeFileSync(genPath3, JSON.stringify(flat3, null, 2));
      toolArgs = toolArgs.concat(["--tsconfig", genPath3]);
    }
  }
  var nodeArgs = [];
  var result = spawnSync(process.execPath, nodeArgs.concat([path.join(path.dirname(pkgJson), bin)]).concat(toolArgs), { stdio: "inherit" });
  return result.status === null ? 1 : result.status;
}

process.exit(main());
"""

_HARNESS = """#!/usr/bin/env bash
set -euo pipefail

# The runfiles workspace root. Tool and launcher arguments arrive as
# runfiles-relative paths, so they are resolved against this root even when the
# working directory is changed below.
if [ -n "$${RUNFILES_DIR:-}" ]; then
  root="$${RUNFILES_DIR}/$${TEST_WORKSPACE:-_main}"
else
  root="."
fi

cd "$$root/%s"

node="$$root/$$1"
launcher="$$root/$$2"
shift 2

exec "$$node" "$$launcher" "$$@"
"""

def vetwo_node_launcher(name, prefix = "node"):
    """Generate only the JS launcher inside the calling package.

    `js_binary` / `js_run_binary` need a `js_binary` entry point that lives in the
    calling package, but do not need the `sh_test` harness that `sh_test`-based
    consumers use. This generates the launcher alone.

    Args:
      name: target name; used to keep generated target names unique.
      prefix: short prefix for the generated target name.

    Returns:
      launcher label.
    """
    launcher_name = "%s_%s_launcher" % (name, prefix)

    # `$$` is Bazel's escape for a literal `$` in a genrule command.
    native.genrule(
        name = launcher_name,
        outs = ["%s_%s_launcher.cjs" % (name, prefix)],
        cmd = "cat > $@ <<'VETWO_NODE_EOF'\n" + _LAUNCHER + "VETWO_NODE_EOF\n",
    )

    return ":%s" % launcher_name

def vetwo_node_harness(name, prefix = "node", cwd = None):
    """Generate a shell harness and JS launcher inside the calling package.

    Args:
      name: target name; used to keep generated target names unique.
      prefix: short prefix for the generated target names.
      cwd: optional path, relative to the runfiles workspace root, to `cd` into
        before running. Defaults to the workspace root. Use it when the tool (or
        the suite it runs) resolves paths from `process.cwd()` rather than from
        the config file location, so the Bazel run matches the package-manager
        invocation (`pnpm --filter <pkg> test` runs with cwd = package dir).

    Returns:
      (harness_label, launcher_label)
    """
    harness_name = "%s_%s_harness" % (name, prefix)
    launcher_name = "%s_%s_launcher" % (name, prefix)

    # `$$` is Bazel's escape for a literal `$` in a genrule command, so the
    # generated script contains real shell expansions.
    cwd_suffix = "" if cwd == None else "/%s" % cwd.strip("/")

    native.genrule(
        name = harness_name,
        outs = ["%s_%s.sh" % (name, prefix)],
        cmd = "cat > $@ <<'VETWO_NODE_EOF'\n" + _HARNESS % cwd_suffix + "VETWO_NODE_EOF\n",
    )

    launcher_label = vetwo_node_launcher(name, prefix)

    return ":%s" % harness_name, launcher_label