# Changelog

All notable changes to `@vetwo/units` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed (Prompt 17–18 validation corrections)

- **Electrical power base factor (HIGH):** `W` was registered with
  `toBaseFactor: 1`, silently meaning 1 Mcal/day (≈48.4 MW). `V`, `Ω`, `S`,
  `F`, `Wb`, `T`, `H` and `hp`/`hp_metric`/`hp_electric` composed from the
  same false premise, so cross-clique conversions were silently wrong
  (e.g. `120 J / 60 C → V` gave `0.0413` instead of `2`). All now compose
  from `1 W = 1 J/s` in base units (`WATT_PER_BASE`), so `V ≡ J/(A·s)`,
  `Ω ≡ V/A`, `Wh ≡ W·h`, `1 hp = 745.69987158227 W`, etc. hold by
  construction, with regression tests (`compositional identities`).
- **Composite multiply/divide representation (HIGH):** results stored the
  base-unit value with scale `1` under a composite symbol, so re-parsing
  the symbol (serialization, canonical identity, downstream consumers)
  silently corrupted values (e.g. `9 N·m` round-tripped as `5e20` base).
  Values now read in the emitted composite unit with a truthful scale;
  physics via `to()`/`toBase()` is unchanged.
- **Covariance PSD check (MEDIUM):** `CovarianceMatrix` accepted
  mathematically impossible correlation structures (zero Cholesky pivots
  masked nonzero remainders). Inconsistent matrices are now rejected.
- **Canonical identity float dust (LOW):** equivalent spellings computed
  via different float paths (e.g. `kg·m·s⁻²` vs `kg*m/s^2`) produced
  different identity keys. Keys now round scales to 12 significant digits.
- **Parser:** the canonical dimensionless identity `"1"` is now a valid
  factor, so engine-emitted symbols like `(1)·(kg)` re-parse and
  serialization round-trips hold. Only the exact token `"1"` is accepted.

### Migration

- Raw `.value` of composite `multiply()`/`divide()` results now reads in
  the displayed composite unit instead of base units (e.g. `1 km / 1 m`
  yields value `1` in `(km)/(m)` rather than `1000`). Use `.toBase().value`
  or `.to("1").value` for the pure number. All conversions, arithmetic
  and serialization behavior for physics is unchanged.
- Absolute `toBaseFactor` values of `W`, `V`, `Ω`, `S`, `F`, `Wb`, `T`,
  `H`, `hp`, `hp_metric`, `hp_electric` (and prefixed forms `kW`, `mW`,
  …) changed to compositionally correct values; relative/prefix ratios
  (`1 kW = 1000 W`) are unchanged.
- `CovarianceMatrix.fromData` / `combineUncertainties` now reject
  globally-inconsistent correlations that were previously (incorrectly)
  accepted. Valid matrices are unaffected.

## [0.0.1] — 2026-07-11

## [0.0.2] — 2026-07-13

### Added

- Initial public release.
- Dimension vector algebra over five base dimensions: Mass, Time, Energy,
  Currency, Count (`dimension.ts`).
- `Quantity` value object with `to`, `toBase`, `add`, `subtract`,
  `multiply`, `divide`, `scale`, `equals`, `hasSameDimension`.
- Generic compound-unit parser (`unit-parser.ts`) — composes atomic units
  from `"A/B"` strings, automatically detecting dimensionless ratio units
  (e.g. `mg/kg`).
- `UnitRegistry` with a seeded `defaultUnitRegistry` and support for custom
  isolated registries.
- Built-in atomic units: `kg`, `g`, `mg`, `µg`, `lb`, `day`, `hour`, `Mcal`,
  `Kcal`, `MJ`, `cur`, `IU`, `fraction`, `%`, `ppm`.
- Basis-tag metadata support (`"% DM"`, `"Mcal/kg asFed"`) for downstream
  domain packages.
- `CalculationRuleRegistry` — generic named-rule extension point for domain
  packages.
- Custom error hierarchy: `UnitEngineError`, `UnitMismatchError`,
  `UnsupportedUnitError`, `DimensionError`, `ConversionError`,
  `ImpossibleConversionError`, `RuleNotFoundError`.
- `formatQuantity()` for display formatting.
- `serializeQuantity()` / `deserializeQuantity()` for JSON persistence.
- Type guards: `isQuantity`, `isUnit`, `isRatioUnit`, `isSameDimension`,
  `isMoneyQuantity`.
- Testing utilities: `assertQuantityClose`, `approxEqual`.

[Unreleased]: https://github.com/vetwo/units/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/vetwo/units/releases/tag/v0.0.2
