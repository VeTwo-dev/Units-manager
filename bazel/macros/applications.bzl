"""Application macros.

Applications are ordinary `js_binary` targets: the emitted JavaScript (from a
`vetwo_ts_library` build, or plain JS) plus its runtime data, packaged as a
runnable Node.js program.
"""

load("@aspect_rules_js//js:defs.bzl", "js_binary")

def vetwo_node_application(name, entry_point, data = [], deps = [], visibility = None, **kwargs):
    """Declare a runnable Node.js application.

    Args:
      name: target name.
      entry_point: JS file to execute (label of a file in this package).
      data: runtime files the application needs.
      deps: Bazel dependencies.
      visibility: target visibility.
      **kwargs: forwarded to `js_binary`.
    """
    js_binary(
        name = name,
        entry_point = entry_point,
        data = list(data) + list(deps),
        visibility = visibility,
        **kwargs
    )