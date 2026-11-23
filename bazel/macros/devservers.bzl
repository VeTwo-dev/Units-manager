"""Dev-server macros.

Wraps `js_run_devserver` so long-running development servers (Vite, Next.js)
are started with `bazel run` and are restartable, matching the package-manager
dev script.

`js_run_devserver` takes an already-built `js_binary` as its `tool` (its own
`entry_point` is an internal shim and may not be overridden), so this macro
creates that `js_binary` from the caller's `entry_point` and hands it over.
"""

load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_devserver")

def vetwo_devserver(name, entry_point, data = [], deps = [], args = [], visibility = None, **kwargs):
    """Declare a development server.

    Args:
      name: target name.
      entry_point: JS file that starts the server.
      data: runtime files the server needs.
      deps: Bazel dependencies.
      args: arguments passed to the server.
      visibility: target visibility.
      **kwargs: forwarded to `js_run_devserver`.
    """
    tool_name = "%s_tool" % name
    runtime_data = data + deps

    js_binary(
        name = tool_name,
        entry_point = entry_point,
        data = runtime_data,
        visibility = ["//visibility:private"],
    )

    js_run_devserver(
        name = name,
        tool = ":%s" % tool_name,
        data = runtime_data,
        args = args,
        visibility = visibility,
        **kwargs
    )