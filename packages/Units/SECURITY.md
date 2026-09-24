# Security Policy

## Supported Versions

The latest published `1.x` release of `@vetwo/units` receives security fixes.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, email **security@vetwo.dev** with:

- A description of the vulnerability and its potential impact
- A minimal reproduction (a `Quantity`/`UnitRegistry` snippet is ideal,
  since this package has no network or filesystem I/O)
- Any suggested fix, if you have one

We will acknowledge your report within **72 hours** and aim to provide a
fix or mitigation timeline within **7 days**. We'll credit you in the
release notes unless you prefer to remain anonymous.

## Scope Notes

This package is a pure computation library (no network calls, no file
system access, no `eval`/dynamic code execution). Realistic security
concerns are limited to:

- Prototype pollution or unsafe property access via crafted unit strings
  passed to `parseUnit()` / `Quantity.of()`
- Denial-of-service via pathological input to the unit parser (e.g. very
  long or deeply nested composite unit strings)
- Supply-chain issues in published npm artifacts — verify with
  `npm audit signatures`

Vulnerabilities in downstream domain packages (e.g.
`@vetwo/nutrition-units`) should be reported to that package's repository.
