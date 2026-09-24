# Security Policy

## Supported Versions

The latest published `1.x` release of `@vetwo/nutrition-units` receives
security fixes.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, email **security@vetwo.dev** with:

- A description of the vulnerability and its potential impact
- A minimal reproduction (a `NutritionMath`/`CoefficientResolver` snippet
  is ideal, since this package has no network or filesystem I/O)
- Any suggested fix, if you have one

We will acknowledge your report within **72 hours** and aim to provide a
fix or mitigation timeline within **7 days**. We'll credit you in the
release notes unless you prefer to remain anonymous.

## Scope Notes

This package is a pure computation library. Realistic security concerns
are limited to:

- Malformed JSON passed to `FeedSchemaLoader` producing unexpected unit
  strings (validate untrusted schema input before passing it in)
- Supply-chain issues in published npm artifacts — verify with
  `npm audit signatures`
- Vulnerabilities inherited from `@vetwo/units` — please also check
  https://github.com/vetwo/units/security/policy

Application-level concerns (e.g. how a consuming feed-formulation app
handles user-uploaded JSON) are out of scope for this repository.
