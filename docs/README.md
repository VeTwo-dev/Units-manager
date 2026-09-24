# VeTwo Units Documentation

This directory is the documentation hub for the VeTwo units monorepo, which
ships two complementary libraries:

```text
Application Domain
       │
       ▼
@vetwo/nutrition-units   nutrition-domain semantics (nutrient, basis, context)
       │
       ▼
@vetwo/units             generic scientific units & dimensional analysis
```

- Package READMEs remain the exhaustive references:
  - [`packages/Units/README.md`](../packages/Units/README.md) (~1300 lines)
  - [`packages/Nutrition-units/README.md`](../packages/Nutrition-units/README.md)
- `docs/agents/` holds portable AI coding-agent guides (decision rules,
  boundaries, anti-patterns):
  - [`agents/units.agent.md`](agents/units.agent.md)
  - [`agents/nutrition-units.agent.md`](agents/nutrition-units.agent.md)
- The pages below are **task-oriented guides**: focused narratives with
  verified examples. They complement — not duplicate — the READMEs.

## Map

### `@vetwo/units`

| Page                                             | Contents                                                 |
| ------------------------------------------------ | -------------------------------------------------------- |
| [units/overview.md](units/overview.md)           | Identity, install, 5-minute quickstart                   |
| [units/quantities.md](units/quantities.md)       | `Quantity`: construction, arithmetic, comparison, kinds  |
| [units/conversion.md](units/conversion.md)       | Conversion engine, temperature rules, registries & packs |
| [units/measurement.md](units/measurement.md)     | `Measurement`, uncertainty, significant figures          |
| [units/formulas.md](units/formulas.md)           | `Expression`, `Formula`, calculation rules               |
| [units/serialization.md](units/serialization.md) | Serializers, interop, canonical forms                    |
| [units/errors.md](units/errors.md)               | Error taxonomy and handling guide                        |
| [units/api-reference.md](units/api-reference.md) | Organized public API index                               |

### `@vetwo/nutrition-units`

| Page                                                                     | Contents                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| [nutrition-units/overview.md](nutrition-units/overview.md)               | Identity, install, quickstart                                  |
| [nutrition-units/nutrients.md](nutrition-units/nutrients.md)             | Nutrient identity, registry, aliases, families                 |
| [nutrition-units/measurements.md](nutrition-units/measurements.md)       | `NutritionQuantity`, `NutritionMeasurement`, options contracts |
| [nutrition-units/basis-context.md](nutrition-units/basis-context.md)     | Basis model, context, conversions, typed errors                |
| [nutrition-units/metadata.md](nutrition-units/metadata.md)               | Metadata, provenance, quality info                             |
| [nutrition-units/collections.md](nutrition-units/collections.md)         | Samples, sets, series, lookup semantics                        |
| [nutrition-units/semantic-safety.md](nutrition-units/semantic-safety.md) | Compatibility, energy, IU, molar rules                         |
| [nutrition-units/serialization.md](nutrition-units/serialization.md)     | JSON, canonical forms, tabular import, migrations              |
| [nutrition-units/errors.md](nutrition-units/errors.md)                   | Error taxonomy and handling guide                              |
| [nutrition-units/api-reference.md](nutrition-units/api-reference.md)     | Organized public API index                                     |

### Both packages together

| Page                                                 | Contents                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| [together/architecture.md](together/architecture.md) | Layered architecture, dependency direction, responsibility split |
| [together/end-to-end.md](together/end-to-end.md)     | Realistic multi-step workflows spanning both libraries           |
| [together/faq.md](together/faq.md)                   | Boundaries, when-to-use-what, formulation question               |

### Monorepo (whole project)

| Page                                                       | Contents                                            |
| ---------------------------------------------------------- | --------------------------------------------------- |
| [monorepo/getting-started.md](monorepo/getting-started.md) | Prerequisites, layout, first run, daily commands    |
| [monorepo/scripts.md](monorepo/scripts.md)                 | Root / package / app / docs script reference        |
| [monorepo/testing.md](monorepo/testing.md)                 | Test layers, commands, what good tests assert       |
| [monorepo/releases.md](monorepo/releases.md)               | Changesets lifecycle, gates, license compliance     |
| [monorepo/configuration.md](monorepo/configuration.md)     | TS, lint/format, build, analysis, workspace configs |
| [monorepo/consumer-app.md](monorepo/consumer-app.md)       | The external-style consumer demo                    |
| [monorepo/benchmarks.md](monorepo/benchmarks.md)           | Benchmark suite and performance principles          |
| [monorepo/project-tour.md](monorepo/project-tour.md)       | Every directory and file in the codebase            |
| [monorepo/tooling-scripts.md](monorepo/tooling-scripts.md) | Root and package script utilities                   |
| [monorepo/ci.md](monorepo/ci.md)                           | Workflows, gates, hooks, automation                 |
| [monorepo/installation.md](monorepo/installation.md)       | Detailed install paths and troubleshooting          |
| [monorepo/test-inventory.md](monorepo/test-inventory.md)   | Every test suite, per file                          |

## Conventions used in these docs

- All code examples import from public entrypoints only (`@vetwo/units`,
  `@vetwo/nutrition-units`) and were checked against the implementation.
- `DO` / `DO NOT` marks normative guidance; everything else is explanatory.
- If a doc page conflicts with the installed package's `.d.ts`, the package wins.
