# Migration & API Stability

## Schema versions

Every serialized form carries an explicit version:

- Quantities/measurements/expressions: `version: 1`
- Interchange envelopes: `schemaVersion: 1`
- Registries/profiles/datasets: `version: 1`

Unknown versions throw; they are never silently reinterpreted.

## Migrating serialized data

```ts
import { migrateSerialized } from "@vetwo/units";

const current = migrateSerialized(
  oldPayload, // { version: 0, ... }
  [{ kind: "quantity", fromVersion: 0, toVersion: 1, migrate: (d) => upgraded }],
  1,
  "quantity",
);
```

Migrations are host-registered functions applied in a bounded chain
(64 steps max, cycle-safe). Missing steps and version mismatches throw
`MigrationError`.

## Unknown fields

`fromInterchange` accepts an unknown-field policy:

- `reject` (default): unknown structural fields throw.
- `ignore`: unknown fields are dropped.
- `preserve`: unknown fields travel in `extensions` (data only, never executed).

## API stability policy

| Marker       | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| stable       | Public API below; breaking changes get a major version + guide |
| experimental | New surface, may evolve in minors (none currently)             |
| deprecated   | Functional, warns where practical, has a migration path        |
| internal     | Not exported from the package root; may change anytime         |

Stable surface (representative, see `src/index.ts` for the full list):
`Quantity`, `Measurement`, `MeasurementSeries`, `MeasurementDataset`,
`UnitRegistry`, `QuantityKindRegistry`, `FunctionRegistry`,
`ConstantRegistry`, `ProfileRegistry`, `UnitSystemRegistry`,
`defineFormula` / `compileFormula` / `evaluateFormula`,
`parseUnit`, `formatQuantity`, serializers, `createExtensionScope`,
`applyExtension`, `resolveAmbiguous`, `toInterchange`/`fromInterchange`,
`migrateSerialized`, `compareQuantities`, `resolveStrictness`.

Internal (importable but unsupported for external use): anything under a
file path deeper than the package root (e.g. `@vetwo/units/dist/...`
internals). Only the root export map is public API.

## Deprecation mechanism

Deprecated APIs remain functional for their compatibility period, are
listed here when they exist, and carry migration guidance. There are
currently no deprecated public APIs. The duplicate `statistics.js`
re-export removed in 0.0.2 changed no runtime behavior.

## Interchange

`toInterchange` / `fromInterchange` exchange Quantity, Measurement,
MeasurementSeries, MeasurementDataset, formula results and reference-data
registries as plain versioned data (`schemaVersion: 1`). Consumers never
see the internal object graph.
