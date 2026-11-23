"""Shared label helpers.

`vetwo_label` is used by every macro that has to turn a possibly-relative label
(the form callers write in BUILD files) into a fully-qualified `//pkg:name`
label. Keeping a single implementation avoids the lint and test macros drifting
apart on how paths are normalized.
"""

def vetwo_label(value):
    """Normalize a possibly-relative label to a full `//pkg:name` label.

    Args:
      value: a label string, either already absolute (`//pkg:name`, `:name`) or
        relative to the calling package.

    Returns:
      The absolute label string.
    """
    if value.startswith("//") or value.startswith(":"):
        return value
    return "//%s:%s" % (native.package_name(), value)