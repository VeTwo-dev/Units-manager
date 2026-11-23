"""JavaScript execution macros (thin wrappers over `rules_js`).

These cover the JavaScript side of the build: turning JS sources into a runnable
program (`vetwo_js_binary`) and grouping JS files into a library
(`vetwo_js_library`). TypeScript never uses these directly — `ts_project` emits
JS that is consumed by `js_library` / `js_binary`.
"""

load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_library")

def vetwo_js_library(name, srcs = [], deps = [], visibility = None, **kwargs):
    """Group JavaScript sources into a library.

    Args:
      name: target name.
      srcs: JavaScript/JSON source files.
      deps: Bazel dependencies.
      visibility: target visibility.
      **kwargs: forwarded to `js_library`.
    """
    js_library(
        name = name,
        srcs = srcs,
        deps = deps,
        visibility = visibility,
        **kwargs
    )

def vetwo_js_binary(
        name,
        entry_point,
        data = [],
        deps = [],
        visibility = None,
        **kwargs):
    """Build a runnable Node.js program.

    Args:
      name: target name.
      entry_point: the JS file to execute (label of a file in this package).
      data: runtime files the program needs.
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