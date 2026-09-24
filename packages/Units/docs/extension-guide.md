# Extension Guide

Domain packages and applications extend the engine through explicit,
validated, data-only manifests — never monkey-patching, never global
mutation.

## Extension manifests

```ts
import { applyExtension, createExtensionScope } from "@vetwo/units";

const scope = createExtensionScope(); // isolated registries, zero globals touched
const applied = applyExtension(
  {
    id: "acme-units",
    version: "1.0.0",
    requiresUnits: ">=0.0.2",
    units: [{ symbol: "smoot", dimension: { L: 1 }, toBaseFactor: 1.7018, label: "smoot" }],
    kinds: [{ id: "whiteness", name: "Whiteness", dimension: {} }],
  },
  { units: scope.units, kinds: scope.kinds },
);
// applyExtension is atomic: any failure leaves every target untouched.
```

Rules:

- `requiresUnits` accepts `>=X.Y.Z`, `>X.Y.Z`, `=X.Y.Z`, `^X.Y.Z`, `~X.Y.Z`.
- Conflicts (same symbol/alias/identifier with different dimension, factor
  or kind) are reported by `validateExtension()` and fail `applyExtension`
  explicitly — definitions are never silently replaced.
- Function implementations are host code registered via `register()`;
  serialized formulas reference functions **by name only** and never execute
  anything from data. Treat plugin metadata as untrusted input.

## Scoped registries

```ts
import { snapshotScope } from "@vetwo/units";

const snap = snapshotScope(scope); // detached, reproducible
```

Snapshots share frozen entries and isolate later registrations on either
side. `UnitRegistry`, `QuantityKindRegistry`, `FunctionRegistry`,
`ConstantRegistry` and `ProfileRegistry` all support `snapshot()`.

## Namespaces and ambiguity

```ts
import { resolveAmbiguous } from "@vetwo/units";

resolveAmbiguous("us:ton", { sources }); // explicit namespace wins
resolveAmbiguous("ton", { sources, strategy: "strict" }); // throws AmbiguousUnitError
```

Strategies: `strict` rejects every multi-definition hit; `standard`
resolves only physically identical candidates (deterministic first);
`permissive` guesses deterministically and reports `resolution:
"ambiguous"`. An explicit `system`/`profile` hint filters candidates first.

## Strictness policies

```ts
import { resolveStrictness } from "@vetwo/units";

resolveStrictness("strict"); // parserStrict, strict-semantic, rejects deprecated + ambiguous
resolveStrictness("standard"); // safe defaults
resolveStrictness("permissive"); // documented compat; dimensional safety has no off-switch
```

Permissive mode can never disable dimensional analysis — no such flag
exists by construction.

## Scientific warnings

`explainConversion` / `explainFormula` return structured warnings
(`deprecated-unit`, `ambiguous-unit`, `implicit-conversion`,
`precision-loss`, `unsupported-uncertainty`, `profile-mismatch`,
`approximate-conversion`) alongside results. The fast path
(`Quantity.to`, `evaluateFormula`) never pays for diagnostics.
