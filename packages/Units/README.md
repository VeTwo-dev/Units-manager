# @vetwo/units

A small, dependency-free **scientific unit & dimensional-analysis engine** for TypeScript.

It represents every unit as a vector of integer exponents over an
**extensible registry of named base dimensions** — the SI-style physical
dimensions (Mass, Length, Time, Temperature, Amount of substance, Electric
current, Luminous intensity) plus generic engine dimensions (Energy,
Currency, Count) — and lets you multiply,
divide, add, subtract, and convert `Quantity` values with full dimensional
safety, so incompatible units can never silently combine.

`@vetwo/units` is **completely domain-agnostic** — it has no knowledge of
nutrition, feed, chemistry, or finance. It is the foundation that domain
packages (like [`@vetwo/nutrition-units`](https://www.npmjs.com/package/@vetwo/nutrition-units))
build on top of.

```ts
import { Quantity } from "@vetwo/units";

const cp = Quantity.of(12, "%");
const intake = Quantity.of(10, "kg/day");

intake.multiply(cp).to("g/day"); // Quantity(1200, "g/day")
```

One generic operation — `Quantity.multiply()` — correctly handles percent,
ppm, mg/kg, Mcal/kg, IU/kg, and any other ratio/rate unit, because it does
real dimensional analysis instead of special-casing each unit type.

---

## Table of contents

- [Installation](#installation)
- [Core concept: dimensions](#core-concept-dimensions)
- [Built-in units](#built-in-units)
- [Prefix Engine](#prefix-engine)
- [Dimensionless & Ratio System](#dimensionless--ratio-system)
- [Universal Unit Parser](#universal-unit-parser)
- [Numerical Policy & Math](#numerical-policy--math)
- [Scientific Quantity Math](#scientific-quantity-math)
- [Measurement, Uncertainty & Significant Figures](#measurement-uncertainty--significant-figures)
- [Scientific Constants & Reference Data](#scientific-constants--reference-data)
- [Statistical Measurements & Datasets](#statistical-measurements--datasets)
- [Unit Systems, Standards Profiles & Contexts](#unit-systems-standards-profiles--contexts)
- [Physical & Scientific Unit Coverage](#physical--scientific-unit-coverage)
- [Semantic Quantity Kinds](#semantic-quantity-kinds)
- [Unit Algebra & Derived Units](#unit-algebra--derived-units)
- [Formula Engine & Pipelines](#formula-engine--pipelines)
- [Unit Systems & Packs](#unit-systems--packs)
- [Advanced Conversion & Temperature](#advanced-conversion--temperature)
- [Universal Dimension Model](#universal-dimension-model)
- [Expression Engine & Formulas](#expression-engine--formulas)
- [Performance, Caching & Limits](#performance-caching--limits)
- [API reference (every exported function/class)](#api-reference)
  - [`Quantity`](#quantity)
  - [`Q()` factory](#q-factory)
  - [`parseUnit()`](#parseunit)
  - [`Prefix` / `PrefixRegistry`](#prefix--prefixregistry)
  - [`UnitRegistry`](#unitregistry)
  - [Unit systems & packs API](#unit-systems--packs-api)
  - [`CalculationRuleRegistry`](#calculationruleregistry)
  - [`Expression` / `FormulaRegistry`](#expression--formularegistry)
  - [`formatQuantity()`](#formatquantity)
  - [`serializeQuantity()` / `deserializeQuantity()`](#serializequantity--deserializequantity)
  - [Type guards](#type-guards)
  - [Testing utilities](#testing-utilities)
  - [Errors](#errors)
  - [Immutability & Numerical Policy](#immutability--numerical-policy)
- [Extending the engine for a new domain](#extending-the-engine-for-a-new-domain)
- [Interoperability & extension APIs](#interoperability--extension-apis)
- [Design principles](#design-principles)

---

## Installation

```bash
npm install @vetwo/units
# or
bun add @vetwo/units
```

No runtime dependencies. Requires TypeScript ^5.x for full type support
(plain JS consumers can still use it — types are just erased).

---

## Core concept: dimensions

Every unit is described by a **dimension vector** — exponents over an
extensible registry of named base dimensions:

| Symbol           | Dimension                   | Example units                                                            |
| ---------------- | --------------------------- | ------------------------------------------------------------------------ |
| `M`              | Mass                        | `kg`, `g`, `mg`, `µg`, `lb`                                              |
| `L`              | Length                      | `m`, `cm`, `mm`, `km`, `ft`, `in`                                        |
| `T`              | Time                        | `day`, `hour`, `min`, `s`                                                |
| `Temp`           | Temperature                 | `K`, `°C`, `°F`                                                          |
| `E`              | Energy                      | `Mcal`, `Kcal`, `MJ`, `kJ`                                               |
| `C`              | Currency                    | `cur`                                                                    |
| `N`              | Count / biological activity | `IU`                                                                     |
| _(empty vector)_ | Dimensionless ratio         | `%`, `ppm`, `fraction`, and any compound that cancels out (e.g. `mg/kg`) |

Composite units are parsed **generically** as `"<numerator>/<denominator>"`.
The parser looks up each side as an atomic unit and combines their
dimension vectors and conversion factors — so `"Mcal/kg"`, `"IU/day"`,
`"cur/kg"`, `"mg/kg"` all work automatically with zero special-casing.
Crucially, if a compound's dimensions cancel out entirely (mass ÷ mass, as
in `mg/kg`), the parser recognizes this and treats it as a plain ratio —
identical in kind to `%` or `ppm`, just with a different scale factor.

---

## Built-in units

```
Mass:        kg, g, mg, µg, lb
Length:      m, cm, mm, km, ft, in
Time:        day, hour, min, s, yr (Julian year, 365.25 d — documented approximation)
Temperature: K, °C, °F, °R (Rankine, linear: 1 °R = 5/9 K)
Energy:      Mcal, Kcal, MJ, kJ
Currency:    cur          (generic — map to your real currency symbol upstream)
Count:       IU
Ratio:       fraction, %, ‰, ppm, ppb, ppt
Frequency:   Hz           (prefixable: kHz, MHz …; 1 Hz = 86400/day — see audit note)
Power:       W            (prefixable: kW, mW …)
```

No civil `month` unit exists on purpose: calendar months are not a fixed
duration, and faking one as linear would be silently wrong. Use `day`
(30 d explicitly) or `yr` where an approximation is acceptable and documented.

Any `"A/B"` combination of the above (or of units you register yourself)
works immediately without extra configuration.

Modular scientific packs (all data-only, applied explicitly via
`createRegistry({ packs: [...] })` — importing them registers nothing):

```
si           A, mol, cd, lm, lx, N, Pa, J, Wh, V, Ω, C, F, Wb, T, H, S,
             tonne, L, nmi, ha
scientific   bar (prefixable: mbar), atm, mmHg, inHg, kgf, cal (prefixable:
             kcal), BTU/BTU_th/BTU_mean (variants never collapsed),
             hp/hp_metric/hp_electric (variants never collapsed), week
imperial     yd, mile, oz, ton (long), acre, gal, qt, pt, floz, mph, knot,
             lbf, psi, psf
us-customary short ton/volume counterparts (collides with imperial by design —
             use separate registries)
cgs          dyn, erg, P (poise), St (stokes)
angle        rad, deg, arcmin, arcsec, rev (+turn), sr — dimensionless per SI
             with explicit semantic kinds (angle / solid-angle)
radiation    Bq, Ci (1 Ci = 3.7e10 Bq exact), Gy, rd (= 0.01 Gy; named "rd"
             because "rad" is the radian), Sv, rem (= 0.01 Sv)
astronomy    AU (149597870700 m, IAU 2012), lyr (c × Julian year),
             pc (648000/π AU, IAU 2015; prefixable: kpc, Mpc)
information  bit, byte (= 8 bit), kB/MB/… (decimal SI) vs KiB/MiB/GiB
             (binary IEC 80000-13) — never confused; dedicated Info dimension
```

Density, flow, viscosity, molar concentration, pressure etc. need no special
dimension: `kg/m³`, `L/min`, `Pa·s`, `mol/L` emerge from dimension algebra.
Derived identities hold dimensionally: `N = kg·m/s²`, `Pa = N/m²`,
`W = J/s`, `V = W/A`. (Known engine model: energy `J` lives on the `E`
base dimension for backward compat, so `J` is deliberately NOT `N·m`
dimensionally here — see docs/DIMENSION_SPEC.md.)

Any `"A/B"` combination of the above (or of units you register yourself)
works immediately without extra configuration.

### Prefix Engine

The engine ships all 24 SI decimal prefixes (2022 revision, `Q`/`R`/`q`/`r` included) via `PrefixRegistry`. Any prefixable unit (`m`, `g`, `s`, `Hz`, `W` — marked `metadata.prefixable`) can be combined lazily: `km`, `µm`/`ug`, `nF`, `MHz`, `kW` etc. are derived on demand as `prefix.factor * baseUnit.conversion.scale` without pre-registering millions of combos. The derived unit is cached after first `parseUnit`/`Quantity.of`.

**Prefixability:** only units explicitly marked prefixable participate. `kg` (canonical SI base, factor 1) is intentionally NOT prefixable — `g` is the scalable mass unit, so `k+g → kg` is handled by the existing `kg` atomic taking precedence; `kkg`/`µkg`/`mkg` are rejected. Likewise `°C`/`°F`/`K`/`day`/`lb`/`in` are not prefixable. Temperature affine units cannot be prefixed.

**Precedence & collisions:** exact unit/alias hit beats prefix-derived; at most one prefix is applied (`kmm` fails because `mm` itself is atomic but not prefixable). `q` (quecto, 1e-30) vs `Q` (quetta, 1e30) are case-sensitive; `da` (deca, 1e1) is longest-match before `d`/`a`. `has("nm")` is true if `n`+`m` is valid, but `list()` only shows explicit atomics — lazy cache does not pollute the registry.

**Kilo-gram note:** SI `kg` already contains a prefix in its name yet remains the base `M¹` unit. To avoid `kkg`, the model keeps `kg` (non-prefixable, factor 1) as canonical and `g` (0.001, prefixable) as the only mass base for prefix generation. `mg`/`µg` exist as atomics but `ng`/`pg`/`Qg` are generated via `n`+`g` etc.

```ts
import { Quantity } from "@vetwo/units";

Quantity.of(1, "km").to("m"); // 1000 m
Quantity.of(1, "µm").to("m"); // 1e-6 m  (also "ug" → "g" via alias u→µ)
Quantity.of(1, "MHz").to("Hz"); // 1e6 Hz
Quantity.of(15, "%").to("fraction"); // 0.15 — % is dimensionless
Quantity.of(10, "m").divide(Quantity.of(2, "m")); // 5 (dimensionless)
Quantity.of(1, "kW").to("W"); // 1000 W
Quantity.of(1, "qm").to("m"); // 1e-30 m — extreme prefix verified
```

```ts
import { defaultPrefixRegistry } from "@vetwo/units";
defaultPrefixRegistry.get("k"); // { symbol:"k", name:"kilo", factor:1e3 }
defaultPrefixRegistry.has("u"); // true → alias to µ (1e-6)
```

### Dimensionless & Ratio System

A quantity is **dimensionless** when all dimension exponents cancel (`isDimensionless(dimension)`). `m/m`, `kg/kg`, `10 m / 2 m → 5` are dimensionless — determined mathematically via `Dimension`, not by string checks. The canonical mathematical dimensionless unit is `DIMENSIONLESS_UNIT` (`"1"`, scale 1, frozen) — exactly one identity, avoiding thousands of equivalent objects; scaled dimensionless units (`%`=0.01, `‰`=0.001, `ppm`=1e-6, `ppb`=1e-9, `ppt`=1e-12, `fraction`=1) remain distinct but share empty dimension.

```ts
Quantity.of(15, "%").to("fraction"); // 0.15 — raw value, not 15
Quantity.of(1, "%").to("ppm"); // 10000 ppm — mathematically well-defined
Quantity.of(10, "m").divide(Quantity.of(2, "m")); // 5 dimensionless

Quantity.of(2, "fraction").multiply(Quantity.of(10, "kg")).to("kg"); // 20 kg — dimensionless × mass = mass
Quantity.of(10, "kg").divide(2); // 5 kg — mass / dimensionless = mass

parseUnit("%").dimension; // {} — not a physical dimension
Quantity.of(15, "%").isDimensionless(); // true
isDimensionlessUnit(parseUnit("ppm")); // true
```

`kg/L` (`M·L⁻¹`) vs `kg/kg` (dimensionless) — slash alone does not imply ratio; dimension algebra decides. Basis-tagged `"% DM"` vs `"% asFed"` are both dimensionless but **not** interchangeable via `to()` (throws `ConversionError`); basis is generic metadata preserved for backward compat, but domain meaning (`dry matter`) belongs to `@vetwo/nutrition-units`.

Dividing any quantity by zero (`q.divide(0)` or `q.divide(zeroQty)`) throws `DivisionByZeroError` — never silent `Infinity`, per numerical policy.

### Universal Unit Parser

Grammar (whitespace ignored, `()` highest, `^`/`²` next, then `*`/`/` left-associative):
`expression := term ( ("/" | "*" | "·" | "⋅" | "×" | implicit) term )*`
`term := factor ( "^" INTEGER | SUPERSCRIPT | trailing INTEGER )?` // `m2` ≡ `m^2` ≡ `m²`
`factor := UNIT | "(" expression ")"`

- **Atomic**: `kg`, `%`, `ppm`, `‰`, `°C`, aliases (`meter`→`m` if registered)
- **Prefixes**: `km`, `µm`/`ug`, `MHz`, `kW`, `kPa`, `dam` (deca longest-match beats deci) via `PrefixRegistry` (single prefix, `kkg`/`µkg`/`kmm` rejected, case-sensitive `W`≠`w`, `Pa`≠`pa`)
- **Multiplication**: `*` `·` `⋅` `×` and implicit adjacency (`kg m` or `kg m^-2`, lenient only)
- **Division**: `kg/s`, `kg / s` (left-assoc, `a/b/c` = `a/(b*c)`)
- **Exponents**: `m^2`, `m^-2`, `m2` (lenient), `m²`, `s^-1`/`s⁻¹`, `cm²`, `kg·m/s²`, `(kg*m)/s^2`, `kg/m³`, `(m/s)^2`; integer only (`m^1.5` rejected — integer dimension model)
- **Grouping**: `(kg*m)/s^2`, `J/(kg·K)`, `N·m` with correct precedence (exponent > `*`/`/` > implicit)
- **Case**: `W` (watt) ≠ `w` (unsupported); `Pa`≠`pa`; registry is case-sensitive, never lowercased.
- **Strict mode**: `{ strict: true }` rejects implicit multiplication and bare-digit exponents (`kg m`, `m2`, `(kg)(m)`); superscripts/`^`/explicit operators work in both modes. Default lenient (backward compatible).
- **Normalization**: NFC-normalized input (deterministic); `µ` (U+00B5) and `μ` (U+03BC) both resolve via prefix aliases without changing meaning.
- **Canonicalization**: `canonicalUnitKey(unit)` = `dimension|kind:scale[+offset][|basis]` — `N` and `kg·m/s²` share keys; equivalent expressions share dimensions/scales.
- **Diagnostics**: `parseWithDiagnostics(input)` returns `{ok, unit?, error?, suggestions}`; `suggestUnit("kgs")` → `["kg"]` (bounded Levenshtein, deterministic, off the hot path — never auto-applied).
- **Security**: no `eval`/`Function`, prototype-safe, invalid input like `constructor`/`__proto__` or `kg//s`, `/kg`, `kg/`, `kg**`, `kg^^2`, `kg^`, `kg^abc`, `kg^1.5`, `kg;` throws `InvalidUnitExpressionError` or `UnsupportedUnitError` with expression+position (messages truncate huge inputs at 200 chars; `.expression` keeps the full text).
- **DoS limits**: text ≤ 4096 chars, paren nesting ≤ 100, bounded per-registry cache (500, version-scoped); repeated `kg/m³` reuses same `Unit` instance.

```ts
import { parseUnit, UnitParser } from "@vetwo/units";

parseUnit("kg/m³"); // M·L⁻³
parseUnit("kg·m/s²"); // M·L·T⁻² — generic, no hard-coded N
parseUnit("m/s²"); // equivalent to "m·s^-1" / "m s^-1"
UnitParser.parse("cm²"); // L², 0.0001
```

### Basis tags (generic metadata)

A unit string may carry a trailing basis tag: `"% DM"`, `"Mcal/kg DM"`,
`"IU/kg asFed"`. This is stored as metadata (`unit.basis`) and does **not**
participate in dimensional math — converting between reporting bases (e.g.
dry-matter vs as-fed) needs an extra domain input (a moisture percentage)
and is therefore left to domain packages, not this engine. The generic parser
preserves this suffix for backward compat with `@vetwo/nutrition-units` but
interprets it as **generic metadata**, not domain logic.

### Numerical Policy & Math

Central policy in `src/numerical.ts` — no scattered `0.000001` tolerances.

- **Type:** `Quantity` uses `number` (IEEE-754 double). No `BigInt`/`Decimal` by default; extensible.
- **Validation:** `Quantity.of("10" as any, "kg")` throws `NumericalError` (no string coercion); `classifyNumber` distinguishes `finite`/`nan`/`infinity`/`neg-zero`/`non-number`.
- **Finite:** Default `requireFinite:false` for backward compat, but `allowNaN:true`/`allowInfinity:true` documented; set `setNumericalPolicy({requireFinite:true,allowNaN:false})` to enforce finite-only.
- **Division by zero:** `q.divide(0)` and `q.divide(zeroQty)` throw `DivisionByZeroError`, never silent `Infinity`.
- **Approx equality:** `|a-b| <= max(absTol, relTol*max(|a|,|b|))` with defaults `abs 1e-12`, `rel 1e-9`; callers provide `ComparisonOptions` or `epsilon` shorthand. `exactEquals` uses `Object.is` (distinguishes `-0`).
- **Conversion accuracy:** `value × factor` (or `(value+offset)×factor` for affine) with no rounding; chains `A→base→C` deterministic, no repeated converts for comparison.
- **Scale safety:** `Q`/`q` prefixes (1e±30) stay finite for normal magnitudes; `1e308*10` overflows to `Infinity` → throws `NumericalError` if `allowInfinity:false`, otherwise documented.
- **Rounding:** No auto-rounding in arithmetic/conversion. Explicit `q.round(decimals, mode)` with modes `half-up`/`half-even`/`floor`/`ceil`/`trunc`; does not mutate.
- **Pow:** `Quantity.pow(n)` integer only (keeps exponents integral); `4 m .pow(2)`→`16 m²`, `pow(-1)`→`0.25 m⁻¹`, `pow(0)`→`1` dimensionless, `pow` on affine `°C` throws.
- **Min/Max:** `q.min(other)`/`max(other)` by base value, same dimension required.

```ts
setNumericalPolicy({ requireFinite: true }); // enforce finite-only
Quantity.of(5, "m").pow(2); // 25 m²
Quantity.of(4, "m").pow(-1); // 0.25 m⁻¹
Quantity.of(1.5, "kg").round(0, "half-even"); // 2 kg
Quantity.of(1, "kg").approximatelyEquals(Quantity.of(1000, "g"), { absoluteTolerance: 1e-9 }); // true
```

### Scientific Quantity Math

Generic roots, reciprocal, clamping, remainders and dimensionless transcendentals — no domain knowledge, `Quantity` stays immutable and delegates dimension math to `Dimension`:

- **Roots:** `sqrt()` needs every exponent even (`9 m² → 3 m`), `cbrt()` needs divisibility by 3 (`-8 m³ → -2 m`); fractional dimensions throw `DimensionError`, `sqrt` of negatives throws `NumericalError`, affine inputs throw.
- **Reciprocal/sign:** `reciprocal(2 s) = 0.5 s⁻¹` keeps the inverted original unit (not a base composite); zero throws `DivisionByZeroError`. `sign()` returns dimensionless `-1/0/1`.
- **Clamp/modulo/roundTo:** `clamp(min, max)` keeps this unit and converts bounds; `modulo` is truncated `%` semantics keeping this unit; `roundTo(unit, decimals, mode)` is explicit convert-then-round composition.
- **Transcendentals:** `sin/cos/tan/exp/ln/log10` require dimensionless input (angle = dimensionless radians convention) — `exp(5 kg)` throws `DimensionError`. `ln/log10` reject non-positive values; `exp` overflow follows the numerical policy (`allowInfinity`).
- **Zero policy:** zero is NOT dimension-polymorphic — `0 kg + 0 m` throws, `equals` across dimensions is `false` (not throw), `a - a` keeps the dimension.

```ts
Quantity.of(9, "m^2").sqrt().to("m"); // 3 m
Quantity.of(2, "s").reciprocal().value; // 0.5 s⁻¹
Quantity.of(Math.PI / 4, "fraction").tan().value; // ≈ 1
Quantity.of(1.234, "kg").roundTo("g").value; // 1234 g
```

### Measurement, Uncertainty & Significant Figures

`Quantity` is deliberately lightweight (value + unit). `Measurement` is an OPTIONAL separate abstraction for nominal ± absolute uncertainty — basic `Quantity` operations never slow down because it exists:

- **Quantity vs Measurement:** use `Quantity` for exact computation; use `Measurement.of(valueQty, uncertaintyQty | relativeFraction)` when you need error bars. `Measurement.exact(q)` records a stated-exact claim (constants, counts), never inferred from a literal.
- **Uncertainty model:** absolute, same dimension as the value, linear (scale-only) units — temperature uncertainty must be `K`, never `°C/°F`. Conversion is scale-only for uncertainty (`10 ± 2 K → °C` stays `±2`). Propagation assumes INDEPENDENT uncertainties (first-order): add/subtract quadrature `σ=√(σ₁²+σ₂²)`, multiply/divide relative quadrature, `pow(n)` scales relative by `|n|`. Correlation is a documented limitation. Zero nominal with nonzero uncertainty is undefined for relative ops (`NumericalError`).
- **Comparison:** `equals` (tolerance, base-normalized), `exactEquals` (`Object.is` on base values, like `Quantity`), explicit `overlaps()` interval intersection — never implicit. Metadata (`confidenceLevel`, `method: "linearized"`, `source`) never affects identity.
- **Significant figures** live in decimal text or explicit counts, never inferred from floats: `countSignificantFigures("12.30") = 4`, `mulDivSigFigs` takes the minimum count, `addSubDecimalPlaces` the minimum places. Rendering (`toSignificantFigures`, `toScientificNotation`, `toEngineeringNotation`) is presentation-only.
- **Formatter:** `formatQuantity(q, { significantFigures: 3 })` (`1.23e+4 m`) and `{ notation: "scientific" | "engineering" }` render text only — the stored value is never altered. Serialization is versioned with `NaN/Infinity/-0` string encoding and prototype-pollution rejection.
- **Phase 25 extensions:** correlation-aware arithmetic (`addCorrelated/subtractCorrelated/multiplyCorrelated/divideCorrelated` with `σ=√(σ₁²+σ₂²±2ρσ₁σ₂)`); function propagation (`sqrt/cbrt/abs/negate/reciprocal/exp/ln/log10/sin/cos/tan/min/max` via `σf≈|f′|σx`, unknown functions throw); per-measurement significant figures (`getEffectiveSigFigs`, `formatWithSigFigs`, `autoSigFigs`); coverage metadata (`getConfidenceInterval` with `coverageFactor`); provenance (`method/instrumentId/laboratoryId/operatorId/timestamp/integrityHash/derivedFrom`); text parsing (`parseMeasurement("10 ± 0.5 kg")`, `"10.0 +/- 0.2 m"`, `"10 kg ± 200 g"`). Correlation defaults to independence — never assumed silently where a coefficient is supplied.

```ts
const m = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
m.add(Measurement.of(Quantity.of(5, "kg"), Quantity.of(0.1, "kg"))).uncertainty.value; // ≈ 0.2236
Measurement.of(Quantity.of(10, "kg"), 0.02).uncertainty.value; // 0.2 (±2% as fraction)
formatQuantity(Quantity.of(12345, "m"), { notation: "engineering" }); // "12.3e+3 m"
parseMeasurement("10 ± 0.5 kg").uncertainty.value; // 0.5
```

### Scientific Constants & Reference Data

Infrastructure, not an encyclopedia: `ScientificConstant` (stable id + symbol + aliases, `Quantity` value, optional absolute uncertainty reusing the `Measurement` model, `exact` flag, required `source`, version, validity interval, provenance) plus `ConstantRegistry` (conflict-rejecting registration, deterministic id→symbol→alias lookup, `namespace:name` resolution, parent-scoped shadowing, detached immutable `snapshot()`, versioned data-only serialization). Seven justified built-ins via `createStandardConstantRegistry()` (SI-defining `c/h/e/NA/kB`, conventional `g0`, CODATA-2018 `G` with uncertainty).

```ts
const reg = createStandardConstantRegistry();
reg.require("c").quantity.value; // 299792458 (m/s, exact)
reg.require("G").measurement.uncertainty.value; // 1.5e-15 (propagates!)
defineFormula({ id: "emc2", expression: mul(v("m"), pow(v("c"), 2)), inputs: {...},
  constants: { c: reg.require("c") } }); // exact folds; uncertain G becomes a pre-bound Measurement input
```

Formulas record constant `{id, version}` refs; deserialization re-resolves them through a supplied registry and fails on version mismatch instead of silently recomputing — pin a `snapshot()` for reproducibility (`recordConstantUsage` captures the id/value/version/unit/source tuple).

### Statistical Measurements & Datasets

Phase 27 extends `Measurement` without duplicating it — statistics live in `statistics.ts`, uncertainty math stays in `measurement.ts`:

- **Uncertainty components:** `combineUncertainties([{ id, standardUncertainty, type: "A" | "B" }], { correlations })` implements `u_c² = Σu_i² + 2Σρu_iu_j` (Type A/B never inferred — the caller classifies). All components must share one dimension.
- **Covariance:** `CovarianceMatrix.fromData/fromMeasurements` — immutable, dimension-checked, symmetry-checked, finite-checked, positive-semidefinite via Cholesky (bounded size). `correlation()` clamps only 1e-12 float noise at ±1.
- **Series:** `MeasurementSeries.of([...])` requires dimensional homogeneity (mixed units normalize to a common unit, originals preserved). `mean()` documents its strategy (`√(SEM² + ū²)`), `weightedMean` supports explicit or `"inverse-variance"` weights (dimensionless only), `variance()` carries the squared unit, `stddev()`/`standardError()` keep the unit. `mean(x,x,x)=x`, `std(x,x,x)=0` hold.
- **Intervals:** `MeasurementInterval` (physical bounds, no statistics) vs `ConfidenceBounds` (bounds + explicit level/coverage metadata) — separate types, never conflated. `expandUncertainty(u, k)` scales without claiming confidence.
- **Datasets:** `MeasurementDataset` (rectangular named variables) with `filter/select/normalize/summarize/applyFormula` — formulas evaluate per row through the existing engine with provenance (`formula:id`, shallow by default). Versioned, bounded serialization throughout.
- **Nonlinear covariance propagation:** `propagateWithCovariance(expr, bindings, cov)` differentiates `+−×÷^convert` forward-mode over the AST (`u²=ΣΣ(∂f/∂xᵢ)(∂f/∂xⱼ)Cov`); function nodes throw explicitly (they assume independence), as do missing entries and domain violations. Monte Carlo is a typed extension point (`runMonteCarloPropagation` throws `UnsupportedTransformationError`).

```ts
const s = MeasurementSeries.of([m(1, 0.1), m(2, 0.2), m(3, 0.3)]);
s.mean().value.value; // 2 m, uncertainty √(SEM² + ū²)
s.weightedMean("inverse-variance").value.value; // ≈ 1.29 m
```

### Unit Systems, Standards Profiles & Contexts

Phase 28 adds policy on top of units — `Unit` stays physical, `UnitSystem` stays the collection, `StandardsProfile` adds preferences:

- **Profiles:** `ProfileRegistry` with validated registration, single `extends` inheritance (parents-first, so cycles are structurally impossible; flattened + frozen), `allowedUnits`/`deprecatedUnits` (policy metadata — deprecated units still resolve), symbol/formatting/conversion policies, reference-data pins, versioned data-only serialization.
- **Interop:** `normalizeToSystem` / `convertBetweenSystems` select targets (base dims via system categories, composites via explicit profile maps — never guessed) and convert through the existing engine (affine-safe, kind-aware, logarithmic rejected). `100 km/h → 62.137 mph`, `1 N → 100000 dyn`.
- **Display:** `selectUnitForMagnitude` (deterministic engineering/SI prefix choice, display-only, collision-safe), `formatWithContext`, `displayMeasurement` (`62.137 ± 1.243 mph`, original untouched). `importUnitName` maps external names (`kg/m3`) through explicit validated mappings.
- **Context:** `ScientificContext({ unitSystem, profile, referenceData, formatting })` resolved by `resolveContext` (unambiguous system→profile auto-adoption); `evaluateInContext` runs formulas then presents results in system units without teaching the engine about SI or Imperial.

```ts
const regs = new ProfileRegistry();
registerStandardProfiles(regs);
formatWithContext(Quantity.of(1, "N", reg), { unitSystem: "cgs", profiles: regs, registry: reg });
// "100000 dyn"
```

### Physical & Scientific Unit Coverage

Broad, scientifically-checked coverage across mechanics, thermodynamics,
electricity, chemistry, optics, acoustics (as far as linear), radiation,
fluids, materials, astronomy, geoscience time/length scales and digital
information — via the data-only pack architecture, never one giant file and
never domain business logic.

- **Coverage audit (21.1/21.30):** every factor is an exact definitional
  value with its source in the pack file (IAU resolutions, 1959 agreement,
  SI Brochure, IEC 80000-13, conventional exact definitions). Audit
  corrections are documented, not silent — e.g. `Hz` was `1/day`-implied
  and is now `86400/day` (1 Hz = 1/s with the day time-base), consistent
  with `C = A·s` so `A/C` algebra yields hertz.
- **Variants (21.31):** `BTU` (IT, default) vs `BTU_th` vs `BTU_mean`;
  `hp` (mechanical) vs `hp_metric` (PS) vs `hp_electric`; imperial vs US
  gallons/tons (separate registries — combining them throws by design).
- **Temperature (21.11/21.28):** `K`, `°C`, `°F` plus linear `°R`;
  absolute vs interval handled by the affine engine (`absolute − absolute`
  yields a `K` delta; `absolute + absolute` throws).
- **Logarithmic units (21.27 — explicitly NOT faked):** `dB`/`pH`/Richter
  cannot be `value × factor`. `ConversionDef` now declares `logarithmic`
  (`{ reference, factor }`) and `custom` (`{ id }`) kinds as an extension
  point, but the numeric engine, the parser composites and every Quantity
  math path reject them with `UnsupportedTransformationError` / explicit
  expression errors instead of producing silent `NaN`.
- **Information (21.26 — explicit decision):** dedicated `Info` dimension
  (not dimensionless, not Count). `byte` is decimal-prefixable
  (`kB = 1000 B`); `KiB/MiB/GiB` are separate binary units
  (`KiB = 8192 bit`). `8 bit` never equals `8 (fraction)`.

```ts
import { createRegistry, SI_PACK, ANGLE_PACK, ASTRONOMY_PACK } from "@vetwo/units";
const reg = createRegistry({ packs: [SI_PACK, ANGLE_PACK, ASTRONOMY_PACK] });
Quantity.of(180, "deg", reg).to("rad", reg).value; // π
Quantity.of(1, "pc", reg).to("m", reg).value; // 3.08567758149137e16
Quantity.of(1000, "kg/m³", reg).to("g/cm³", reg).value; // 1
```

### Semantic Quantity Kinds

`Dimension` is mathematical structure; `QuantityKind` is scientific meaning
(Phase 22). `Bq` vs `Hz` share `T⁻¹`; `Gy` vs `Sv` share `E·M⁻¹` — dimensions
alone cannot keep them apart, so units may carry `metadata.kind` and
quantities expose it as `Quantity.kind` (`undefined` = no claim, generic).

```ts
Quantity.of(1, "Bq", reg).kind; // "activity"
Quantity.of(60, "Hz").kind; // "frequency"
Quantity.of(20, "°C", reg).subtract(Quantity.of(15, "°C", reg)).kind; // "temperature-difference"
q.requireKind("angle").sin(); // opt-in gate for kind-sensitive math
q.withKind("temperature-difference"); // explicit interval marking (validated)
q.add(other, { semanticPolicy: "semantic-aware" }); // default: "dimensional-only"
```

- **Policies (22.4):** `dimensional-only` (default — legacy behavior,
  zero overhead beyond two string comparisons), `semantic-aware` (same
  kind, unknown-wildcard, or explicitly registered compatibility),
  `strict-semantic` (identical kinds only; unknown ≠ known). Use strict
  for gates (`requireKind`), aware for mixing checks.
- **Registry (22.11/22.12):** `QuantityKindRegistry` — frozen data-only
  kinds (`id`, `name`, `dimension`, `compatibleKinds?`,
  `requiresContext?`), validated registration (no functions, no pollution,
  no self-compatibility), isolated instances plus the shared
  `defaultQuantityKindRegistry` (12 seed kinds).
- **Context conversions (22.13):** kinds with `requiresContext` fail via
  `MissingSemanticContextError` unless context is supplied; incompatible
  pairs fail via `UnsupportedSemanticConversionError` /
  `IncompatibleQuantityKindError`.
- **Serialization (22.15):** explicit `kind` field, round-tripped and
  validated (registered + dimension-compatible with the unit); never
  inferred from display strings. Formatter `showKind: true` appends
  `[kind]` display-only. Parser resolves kinds from registered
  definitions — no semantic logic in the parser.

### Unit Algebra & Derived Units

Structural unit expressions (`unit-algebra.ts`) complement the
conversion-oriented parser, which flattens `kg·m/s²` to
(dimension, scale). The algebra keeps structure:

```ts
parseUnitExpression("kg*m/s^2", reg); // atom/mul/div/pow AST (immutable)
unitExprKey(parse("m/s")) === unitExprKey(parse("m·s^-1")); // canonical
formatUnitExpr(parse("(m/s)*s")); // "m" (cancellation, deterministic order)
equivalentUnits(parse("N", reg), parse("kg*m/s^2", reg)); // true (dim + scale)
dimensionOfUnitExpr(parse("V", reg)); // { E: 1, T: -1, I: -1 } — no numerics
```

- **Canonicalization:** factor collection, integer-exponent aggregation,
  zero elimination, deterministic ordering, cancellation. Exponents stay
  exact integers; scale comparison uses a documented 1e-12 relative
  tolerance for chained float constants only.
- **Derived units:** `N → kg·m/s²`, `Pa → N/m²`, `W → J/s` (transitive),
  `Hz → 1/s`, `C/V/Ω` as data in `DerivedUnitRegistry`; `matchDerived`
  recovers display intent (`N`) from structure. Expansion terminates by
  construction (definitions reference core symbols).
- **Safety:** affine/logarithmic/custom atoms are rejected from
  multiplicative algebra explicitly; equivalence additionally guards basis
  tags and semantic kinds (never dimension-only). Exact roots only
  (`sqrt(m²) → m`; `sqrt(m)` throws — no fractional dimensions).
- **Limits & interning:** `maxExpressionLength/maxAstNodes/maxDepth/
maxExponent/maxDerivedExpansionDepth` with safe defaults; canonical keys
  interned (bounded); serialization versioned and validated.

### Formula Engine & Pipelines

One coherent stack reusing the `Expression` AST (formulas reference it —
no second engine):

```text
defineFormula → validate (dimensions, kinds, units) → constants folded
  → compileFormula (stack-machine plan, cached, immutable)
  → evaluate / graph.evaluate (Quantity | number | Measurement)
```

```ts
const force = defineFormula({
  id: "force",
  expression: Expression.multiply(Expression.variable("mass"), Expression.variable("accel")),
  inputs: { mass: { dimension: Dim.Mass }, accel: { dimension: "m/s^2" } },
  outputName: "force",
  outputUnit: "N",
  expectedDimension: { M: 1, L: 1, T: -2 },
});
compileFormula(force).evaluate({
  mass: Quantity.of(10, "kg"),
  accel: Quantity.of(9.81, "m/s²", reg),
});
// → 98.1 N. Invalid formulas (length + time) die at defineFormula.
```

- **Functions:** `sqrt/cbrt/abs/negate/reciprocal/min/max/exp/ln/log10/
sin/cos/tan` via a safe name-only `FunctionRegistry` (usable as
  `Expression.call("sqrt", [x])`); dimensional rules enforced by Quantity
  methods; hosts may register more (validated, host-trusted code only).
  `sin/cos/tan` additionally gate on kind `angle` in the formula layer.
- **Measurements** propagate uncertainty through `+−×÷^convert`
  (delegating to `Measurement` methods); function calls on Measurements
  fail explicitly. Numbers bind as dimensionless.
- **Graphs & pipelines:** `createDependencyGraph(formulas)` gives a
  deterministic topological order, cycle paths (`CyclicDependencyError`),
  missing-input reports, `evaluate` (full) and `reevaluate` (dirty-set
  incremental with reference-stable untouched branches);
  `createPipeline` adds staged views (`stages`, `validation`,
  `intermediates`). Serialization is data-only and revalidates on load.
- **Trace & partial eval:** `evaluate(..., { trace: true })` records
  deterministic steps (Quantity bindings); constants/defaults fold at
  define time (`formulaVariables` shows what remains).
- **Security:** expression/formula/graph limits (`maxVariables`,
  `maxGraphNodes`, `maxDependencies`, `maxEvaluationSteps`, …), depth-
  bounded validation, pollution-key rejection, no `eval`/`Function`.

### Unit Systems & Packs

Generic grouping, not math. A `UnitSystem`/`UnitPack` is data: `{name, version, units, aliases, preferredUnits, prefixes, metadata}`. Systems do not change `Dimension`. Pack modules are side-effect free — importing them registers nothing; apply explicitly.

```ts
import { SI_PACK, IMPERIAL_PACK, createRegistry, Quantity } from "@vetwo/units";

// Explicit isolated registries — no global mutation, tree-shakeable:
const si = createRegistry({ packs: [SI_PACK] });
const imp = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK] });
Quantity.of(1, "N", si).to("lbf", imp); // cross-system via shared dimensions
defaultUnitSystemRegistry.resolveWithSystem("ton", "imperial"); // long ton (1016 kg)
defaultUnitSystemRegistry.resolveWithSystem("ton", "us-customary"); // short ton (907 kg)
```

- **Built-ins:** `si` (base extras A/mol/cd/lm/lx, derived N/Pa/J/Wh/V/Ω/C/F/Wb/T/H/S, accepted tonne/L/nmi/ha), `si-derived` (N/Pa/J/Wh subset), `imperial` (yd/mile/oz/long-ton/acre/gal/qt/pt/floz/mph/knot/lbf/psi), `us-customary` (short-ton/US-gal/qt/pt/cup/floz + shared 1959 defs), `cgs` (dyn/erg), `scientific` (bar/atm/mmHg/cal/BTU/hp/week).
- **Energy model:** `J`/`Wh`/`cal`/`BTU`/`erg` use the engine `E` dimension (consistent with `Mcal`/`MJ`); mechanical `N`/`Pa`/`dyn`/`lbf`/`psi`/`bar`/`atm`/`mmHg` use `M·L·T` combinations. Electric units derive from `A` + `W` bases. Documented per-unit, never faked.
- **Shared definitions:** US reuses Imperial's 1959-agreement objects (`yd`, `mile`, `oz`, `mph`, `knot`, `lbf`, `psi`) by import — identical objects, no duplication.
- **Collisions:** `ton`/`gal`/`qt`/`pt`/`floz` differ between Imperial and US → combining both packs in one registry throws `UnitRegistrationError`; use separate registries or explicit system context. Registration order never silently wins.
- **Preferred:** `getPreferredUnit("si", "mass")` → `"kg"`; display metadata only, arithmetic never auto-converts.
- **Snapshots:** `registry.snapshot()` returns a detached point-in-time copy for reproducibility.
- **Deprecation:** `getDeprecationNotice(unit)` returns the notice or `undefined` — explicit mechanism, no hot-path warnings.
- **Versioning:** systems/packs carry `version`; changing a factor/symbol/dimension is breaking. Registries expose a monotonic `version` counter for cache invalidation.
- **Security:** packs are declarative data (no functions — validated at registration); `__proto__` rejected.

### Advanced Conversion & Temperature

Conversion is explicit: `LinearConversion {scale}` (`y=x*scale`) vs `AffineConversion {scale,offset}` (`y=x*scale+offset`). Temperature is canonical test: `K` (linear), `°C` (affine `K=°C+273.15`), `°F` (affine `K=(°F-32)*5/9+273.15`). Absolute vs delta: `1°C` interval = `1 K` but `1°C` absolute ≠ `1 K`; `adding two absolutes` throws `InvalidAffineOperationError`, `absolute - absolute` yields delta `K`, `affine ×`/`/` throws. Composition is deterministic direct `→base→target` (no graph search, no order dependence), cached base path. Non-linear (dB/pH) is intentionally deferred as declarative transformation would need separate model — not faked as linear.

```ts
Quantity.of(0, "°C").to("K"); // 273.15 K
Quantity.of(10, "°C").add(Quantity.of(5, "K")); // 15°C (absolute+delta)
Quantity.of(10, "°C").subtract(Quantity.of(5, "°C")); // 5 K delta
Quantity.of(10, "°C").add(Quantity.of(5, "°C")); // throws InvalidAffineOperationError
```

### Universal Dimension Model

Dimensions are extensible vectors over registered base ids, not hard-coded 5. Seed 10: `M,L,T,Temp,Substance,I,J` (SI) + `E,C,N` (generic, `E` kept as base for compat though scientifically `M·L²·T⁻²`; migration documented). New bases via `new DimensionRegistry().register("Info","Information")` without touching core. Derived `Force = M·L·T⁻²`, `Energy` generic vs derived, `Power = E·T⁻¹`. `Angle` = dimensionless with `metadata.category="angle"` (SI radian), `Information` = explicit `Info` dimension if needed (not forced into `N`), `Currency`/`Count` semantic. `dimensionKey` sorted `L^1·M^1·T^-2` deterministic; interning bounded 1000. Serialization via `dimensionKey` versioned.

```ts
const reg = new DimensionRegistry();
reg.register("MyDim", "My");
const my = reg.normalize({ MyDim: 1 }); // generic, no core change
```

### Expression Engine & Formulas

Build unit-aware calculations as immutable, declarative ASTs — never as
JavaScript functions — so they can be inspected, dimension-checked,
serialized, optimized and cached:

```ts
import { Expression, compileExpression, FormulaRegistry } from "@vetwo/units";

const expr = Expression.multiply(
  Expression.variable("intake"), // kg/day
  Expression.variable("conc"), // mg/kg
);

// Static dimension inference — no numeric evaluation needed:
inferExpressionDimension(expr, { intake: "kg/day", conc: "mg/kg" }); // mg/day (M·T⁻¹)

// Evaluate with a context:
evaluateExpression(expr, { intake: Quantity.of(10, "kg/day"), conc: Quantity.of(80, "mg/kg") }).to(
  "mg/day",
); // 800 mg/day

// Compile once, evaluate many times (units pre-resolved, constants folded):
const compiled = compileExpression(expr);
compiled.evaluate(ctx1);
compiled.evaluate(ctx2); // batch evaluation, no re-parsing

// Reusable named formulas (generic — contrast CalculationRuleRegistry, which holds domain functions):
const formulas = new FormulaRegistry();
formulas.define(
  "work",
  ["force", "distance"],
  Expression.multiply(Expression.variable("force"), Expression.variable("distance")),
);
formulas.run("work", { force: Quantity.of(10, "kg"), distance: Quantity.of(5, "m") });
```

Expressions support literals, variables, `add`/`subtract`/`multiply`/`divide`,
integer `power`, `convert`, and grouping via nesting. `simplifyExpression`
folds constants (`2 kg × 3 → 6 kg`, `1000 m + 1 km → 2000 m`) and safe
identities (`x·1→x`, `x/1→x`, `x^1→x`, `x^0→1`) — never unsafe `x/x→1`.
Serialization is versioned (`{version:1,type:"expression",root}`) and validated;
limits (`maxDepth` 64, `maxNodes` 2048) guard hostile input.

### Performance, Caching & Limits

Hot paths stay allocation-light: same-unit conversion short-circuits,
dimension vectors are interned, and all caches are bounded:

- **Parser cache**: per-registry `WeakMap` (500 entries each) — distinct custom
  registries never collide, discarded registries GC cleanly.
- **Conversion plans**: bounded `Map` (500), keys embed full conversion
  parameters, so a hit is always mathematically identical — correctness never
  depends on the cache.
- **Formatter / dimension interning / compiled expressions**: bounded
  (500 / 1000 / 100 per registry).
- **Registry `version`**: monotonic generation counter bumped on every
  register/unregister; caches keyed by content invalidate accordingly.

Safety limits: unit-expression text ≤ 4096 chars, expression depth ≤ 64,
nodes ≤ 2048, serialized JSON ≤ 65536 chars (all configurable via
`ExpressionOptions`). No unbounded global `Map` anywhere — a DoS requirement,
not just hygiene. Benchmarks (`vitest bench --run`) cover Quantity ops,
conversion, parsing, formatting, serialization, expression direct vs compiled
vs batch, and cache hit/miss.

---

### `Quantity`

The central value object of the whole package — an immutable `{ value, unit }`
pair with dimensionally-safe arithmetic. Every calculation in an application
built on this package should flow through `Quantity` instances.

```ts
class Quantity {
  static of(value: number, unit: string | Unit, registry?: UnitRegistry): Quantity;
  to(unit: string | Unit, registry?: UnitRegistry): Quantity;
  toBase(): Quantity;
  add(other: Quantity): Quantity; // preserves left unit
  subtract(other: Quantity): Quantity;
  multiply(other: Quantity | number): Quantity; // number → alias to scale
  divide(other: Quantity | number): Quantity; // throws DivisionByZeroError on 0
  scale(factor: number): Quantity;
  negate(): Quantity;
  abs(): Quantity;
  pow(power: number): Quantity; // integer only, Dimension*power, value^power
  min(other: Quantity): Quantity;
  max(other: Quantity): Quantity;
  round(decimals: number, mode?: RoundingMode): Quantity; // half-up|half-even|floor|ceil|trunc
  equals(other: Quantity, epsilon?: number | ComparisonOptions): boolean; // approx (abs+rel)
  approximatelyEquals(other: Quantity, epsilon?: number | ComparisonOptions): boolean;
  exactEquals(other: Quantity): boolean; // Object.is after toBase
  lessThan(other: Quantity): boolean; // throws on dimension mismatch
  lessThanOrEqual(other: Quantity): boolean;
  greaterThan(other: Quantity): boolean;
  greaterThanOrEqual(other: Quantity): boolean;
  isZero(): boolean;
  isPositive(): boolean;
  isNegative(): boolean;
  isDimensionless(): boolean;
  hasSameDimension(other: Quantity): boolean;
  toString(): string;
  get dimension(): DimensionVector; // alias to unit.dimension
  readonly value: number;
  readonly unit: Unit;
}
```

> **Immutability (Quantity):** every operation returns a new `Quantity`; `a.scale(2)` leaves `a` unchanged. Unit & Prefix are also frozen.

> **Numerical policy:** values are IEEE-754 `number` (`NaN`/`Infinity` allowed, never silently coerced to `0`; `-0` is zero not negative). `equals` uses `toBase()` with epsilon. Extreme prefix scales (1e±30) stay within double range for normal magnitudes.

#### `Quantity.of(value, unit)`

Creates a new quantity. `unit` can be a string (`"kg"`, `"Mcal/day"`) or an
already-resolved `Unit` object.

```ts
const weight = Quantity.of(450, "kg");
const rate = Quantity.of(2.1, "kg/day");
```

#### `.to(unit)`

Converts to another unit of the **same dimension**. Throws
`ImpossibleConversionError` if the dimensions differ, or `ConversionError`
if the two units have conflicting basis tags (e.g. `"% DM"` → `"%"`
directly — use a domain `BasisConverter` for that instead).

```ts
Quantity.of(1, "kg").to("g"); // Quantity(1000, "g")
Quantity.of(3000, "Kcal").to("Mcal"); // Quantity(3, "Mcal")
```

#### `.toBase()`

Returns the value expressed in the canonical base unit of its dimension
(kg for Mass, day for Time, Mcal for Energy, cur for Currency, IU for
Count, fraction for Ratio). Useful for comparisons and validation.

```ts
Quantity.of(50, "%").toBase().value; // 0.5
```

#### `.add(other)` / `.subtract(other)`

Dimensionally-safe addition/subtraction. The result is expressed in the
unit of the receiver (`this`). Throws `UnitMismatchError` if dimensions
differ.

```ts
Quantity.of(1, "kg").add(Quantity.of(500, "g")); // Quantity(1.5, "kg")
Quantity.of(1, "kg").add(Quantity.of(1, "Mcal")); // throws UnitMismatchError
```

#### `.multiply(other)` / `.divide(other)`

Performs real dimensional analysis: the resulting dimension is the product
(or quotient) of the two operands' dimensions, computed automatically. This
is the operation that replaces hand-written formulas like `cp/100 * kg` or
`mg/kg * kg` everywhere in a consuming application.

```ts
const cp = Quantity.of(12, "%");
const intake = Quantity.of(10, "kg/day");
intake.multiply(cp).to("g/day"); // Quantity(1200, "g/day")

const price = Quantity.of(0.35, "cur/kg");
intake.multiply(price).to("cur/day"); // Quantity(3.5, "cur/day")
```

#### `.scale(factor)`

Multiplies the numeric value by a plain `number`, keeping the same unit.
Use this only for dimensionless scaling factors (e.g. a safety margin), not
for anything that has its own unit — use `.multiply()` for that.

```ts
Quantity.of(10, "kg/day").scale(1.1); // Quantity(11, "kg/day") — a 10% buffer
```

#### `.negate()` / `.abs()`

```ts
Quantity.of(5, "kg").negate(); // -5 kg — original unchanged
Quantity.of(-5, "kg").abs(); // 5 kg
```

#### `.isZero()` / `.isPositive()` / `.isNegative()`

```ts
Quantity.of(0, "kg").isZero(); // true  (-0 is zero)
Quantity.of(1, "kg").isPositive(); // true  (Infinity true, NaN false)
Quantity.of(-1, "kg").isNegative(); // true  (-0 is not negative)
```

#### `.equals(other, epsilon?)` / `.approximatelyEquals(other, epsilon?)`

Compares two quantities for equality within a tolerance, after normalizing
both to their base unit. Returns `false` (not an error) if dimensions
differ.

```ts
Quantity.of(1000, "g").equals(Quantity.of(1, "kg")); // true
Quantity.of(1, "kg").approximatelyEquals(Quantity.of(1000.0000001, "g"), 1e-6); // true
```

#### Comparison: `lessThan` / `greaterThan` …

Every ordering check validates dimensions first and throws `UnitMismatchError` if they differ — raw numbers are never compared across units.

```ts
const distance = Quantity.of(5, "km");
const meters = distance.to("m"); // 5000 m

Quantity.of(1, "kg").lessThan(Quantity.of(1500, "g")); // false (1 kg = 1000 g)
Quantity.of(1, "km").greaterThan(Quantity.of(500, "m")); // true

Quantity.of(1, "kg").add(Quantity.of(1, "m")); // throws UnitMismatchError
Quantity.of(1, "kg").lessThan(Quantity.of(1, "m")); // throws UnitMismatchError
```

#### `divide(other: number)` & `multiply(other: number)`

```ts
Quantity.of(10, "kg").divide(2); // 5 kg (same unit)
Quantity.of(10, "kg").multiply(2); // 20 kg (alias to scale)

Quantity.of(10, "m").divide(Quantity.of(2, "m")); // 5 (dimensionless, M⁰)
```

#### `.hasSameDimension(other)`

Checks dimension compatibility without throwing — the safe way to guard a
conversion or comparison before doing it.

```ts
if (value.hasSameDimension(requirement)) {
  /* safe to compare */
}
```

#### `.toString()`

Human-readable debug string, e.g. `"12 % DM"`, `"3.2 Mcal/kg"`.

#### `.kind` / `.withKind()` / `.requireKind()`

Semantic kind id from the unit's registered metadata (`undefined` when the
unit makes no claim). `.withKind(id)` returns a copy with an explicit kind
(validated: registered + dimension-compatible). `.requireKind(id, policy?)`
throws `IncompatibleQuantityKindError` unless compatible and returns `this`
for chaining. `add`/`subtract` accept `{ semanticPolicy }`; `to()` accepts
`{ semanticPolicy, context }` — all default to `"dimensional-only"`.

---

### `Q()` factory

Sugar for `Quantity.of()`.

```ts
import { Q } from "@vetwo/units";
const intake = Q(10, "kg/day");
```

---

### `parseUnit()`

Parses a unit string into a resolved `Unit` object without creating a
`Quantity`. Mostly useful internally or when you need to inspect a unit's
dimension before deciding what to do with a value.

```ts
import { parseUnit } from "@vetwo/units";

const unit = parseUnit("mg/kg DM");
unit.dimension; // {} (dimensionless — mass/mass cancels)
unit.basis; // "DM"

parseUnit("kg/m³"); // M·L⁻³
parseUnit("kg·m/s²"); // M·L·T⁻² — generic, no hard-coded N
parseUnit("m2", undefined, { strict: true }); // throws: strict requires m^2
```

```ts
function parseUnit(input: string, registry?: UnitRegistry, opts?: ParseOptions): Unit;
interface ParseOptions {
  readonly strict?: boolean; // reject implicit mul + bare-digit exponents
}
class UnitParser {
  constructor(registry?: UnitRegistry, defaultOpts?: ParseOptions);
  parse(input: string, opts?: ParseOptions): Unit;
  static parse(input: string, registry?: UnitRegistry, opts?: ParseOptions): Unit;
}

// Diagnostics & suggestions (off the hot path):
function suggestUnit(
  input: string,
  registry?: UnitRegistry,
  opts?: SuggestOptions,
): readonly string[];
function parseWithDiagnostics(
  input: string,
  registry?: UnitRegistry,
  opts?: SuggestOptions & { strict?: boolean },
): ParseDiagnostics; // { ok, unit?, error?, suggestions }
```

---

### `Prefix` / `PrefixRegistry`

```ts
interface Prefix {
  readonly symbol: string;
  readonly name: string;
  readonly factor: number;
  readonly aliases: readonly string[];
}
class PrefixRegistry {
  constructor(seed?: readonly Prefix[]); // defaults to 24 SI prefixes
  register(prefix: Prefix): Prefix; // throws on duplicate/invalid
  has(symbol: string): boolean; // canonical or alias
  get(symbol: string): Prefix;
  list(): readonly Prefix[];
  listSortedByLength(): readonly Prefix[]; // da before d/a (longest-match)
}
export const defaultPrefixRegistry: PrefixRegistry; // Q,R,Y,Z,E,P,T,G,M,k,h,da,d,c,m,µ(u/μ),n,p,f,a,z,y,r,q
```

### `UnitRegistry`

Holds the set of known atomic units. The package ships a
`defaultUnitRegistry` seeded with the built-in units; you can register more
atomic units for your own domain, or create an isolated registry instance
(useful in tests or multi-tenant setups).

```ts
// Unit value object (immutable)
interface Unit {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly dimension: DimensionVector;
  readonly conversion:
    { kind: "linear"; scale: number } | { kind: "affine"; scale: number; offset: number };
  readonly toBaseFactor: number;
  readonly aliases: readonly string[];
  readonly metadata?: {
    prefixable?: boolean;
    system?: string;
    category?: string;
    deprecated?: string;
    docs?: string;
  };
}
function makeUnit(opts: MakeUnitOptions): Unit;

class UnitRegistry {
  constructor(seed?: readonly AtomicUnitDef[], prefixRegistry?: PrefixRegistry);
  readonly version: number; // monotonic generation counter
  register(unit: Unit): Unit;
  registerAtomic(def: AtomicUnitDef, options?: { aliases?: string[] }): Unit;
  unregister(symbol: string): Unit | undefined;
  resolve(symbol: string): Unit; // exact > alias > prefix-derived (one prefix only)
  has(symbol: string): boolean; // includes prefix-derivable
  getCanonicalUnit(dimension: DimensionVector): Unit | undefined;
  list(): readonly Unit[];
  snapshot(): UnitRegistry; // detached point-in-time copy
}

export const defaultUnitRegistry: UnitRegistry;

// Unit identity helpers:
function unitKey(u: Unit): string; // id (+basis)
function unitsEqual(a: Unit, b: Unit): boolean;
function unitsCompatible(a: Unit, b: Unit): boolean; // same dimension
function canonicalUnitKey(u: Unit): string; // dimension|kind:scale[+offset][|basis]
function isAffineUnit(u: Unit): boolean;
function isDimensionlessUnit(u: Unit): boolean;
function getDeprecationNotice(u: Unit): string | undefined; // explicit, no auto-warn

// Isolated registries from packs (no global mutation, tree-shakeable):
function createRegistry(options?: {
  seed?: readonly AtomicUnitDef[]; // defaults to core ATOMIC_UNITS
  packs?: readonly UnitPack[]; // applied in order, collisions throw
  units?: readonly AtomicUnitDef[];
  prefixRegistry?: PrefixRegistry;
}): UnitRegistry;

// Built-in packs (side-effect free data — apply explicitly):
// SI_PACK (A/mol/cd/lm/lx/N/Pa/J/Wh/tonne/L/nmi/ha + aliases)
// IMPERIAL_PACK, US_CUSTOMARY_PACK, CGS_PACK, SCIENTIFIC_PACK
```

#### Conversion Engine

```ts
import { convert, toBase, fromBase } from "@vetwo/units";

// Low-level: numeric value conversion
convert(100, parseUnit("°C"), parseUnit("K")); // 373.15
convert(1, parseUnit("kg"), parseUnit("g")); // 1000

// Affine example — temperature requires scale + offset
Quantity.of(0, "°C").to("K"); // 273.15 K
Quantity.of(32, "°F").to("°C"); // 0 °C
Quantity.of(100, "°C").to("°F"); // 212 °F
```

```ts
import { defaultUnitRegistry } from "@vetwo/units";

defaultUnitRegistry.registerAtomic({
  symbol: "mol",
  dimension: { N: 1 }, // pick whichever base dimension fits your domain
  toBaseFactor: 1,
  label: "mole",
});

// "mol/L" now parses automatically — no other change required
```

```ts
// Isolated registry for tests:
const testRegistry = new UnitRegistry();
Quantity.of(1, "kg", testRegistry);
```

---

### `CalculationRuleRegistry`

A generic, named registry for **domain** calculation rules layered on top
of `Quantity` math. The core package doesn't know what "molarity" or
"crude protein contribution" means — domain packages register named rules
here instead of hard-coding formulas inline.

```ts
class CalculationRuleRegistry {
  register(key: string, rule: (...inputs: Quantity[]) => Quantity): void;
  has(key: string): boolean;
  resolve(key: string): (...inputs: Quantity[]) => Quantity;
  run(key: string, ...inputs: Quantity[]): Quantity;
  listKeys(): string[];
}

export const defaultCalculationRuleRegistry: CalculationRuleRegistry;
```

```ts
import { defaultCalculationRuleRegistry, Quantity } from "@vetwo/units";

defaultCalculationRuleRegistry.register("chemistry.molarity", (moles, volume) =>
  moles.divide(volume),
);

defaultCalculationRuleRegistry.run(
  "chemistry.molarity",
  Quantity.of(0.5, "mol"),
  Quantity.of(2, "L"),
); // 0.25 mol/L
```

### `Expression` / `FormulaRegistry`

```ts
// Builders (all frozen immutable AST nodes):
Expression.literal(value: number, unit: string): Expression;
Expression.variable(name: string): Expression;
Expression.add/subtract/multiply/divide(left, right): Expression;
Expression.power(base: Expression, exponent: integer): Expression;
Expression.convert(expr: Expression, unit: string): Expression;

// Evaluation & analysis:
evaluateExpression(expr, context?: ExpressionContext, opts?: ExpressionOptions): Quantity;
inferExpressionDimension(expr, varDimensions?: VariableDimensions, opts?: ExpressionOptions): DimensionVector;
simplifyExpression(expr, opts?: ExpressionOptions): Expression;
compileExpression(expr, opts?: ExpressionOptions): CompiledExpression; // .evaluate(ctx), .inferDimension(varDims)
serializeExpression(expr): SerializedExpression; // {version:1,type:"expression",root}
deserializeExpression(data: unknown, limits?: ExpressionLimits): Expression;
canonicalExpressionKey(expr): string;
expressionDepth(expr): number;

class FormulaRegistry {
  define(name, variables: readonly string[], expression: Expression, opts?: ExpressionOptions): FormulaDefinition;
  has(name: string): boolean;
  get(name: string): FormulaDefinition;
  list(): readonly string[];
  run(name: string, context: ExpressionContext, opts?: ExpressionOptions): Quantity;
  inferDimension(name: string, varDimensions: VariableDimensions, opts?: ExpressionOptions): DimensionVector;
}
export const defaultFormulaRegistry: FormulaRegistry;
```

`ExpressionContext` is `{ [name: string]: Quantity }` (own-property lookup —
prototype members never resolve). `ExpressionOptions` is
`{ registry?: UnitRegistry; limits?: { maxDepth?, maxNodes?, maxSerializedChars? } }`.
`CalculationRuleRegistry` (domain functions) stays separate from
`FormulaRegistry` (declarative ASTs).

---

### Unit systems & packs API

```ts
interface UnitSystem {
  readonly name: string; // e.g. "si", "imperial"
  readonly version: string; // content version — factor changes are breaking
  readonly units: readonly AtomicUnitDef[];
  readonly aliases?: Readonly<Record<string, string>>; // must target pack units
  readonly preferredUnits?: Readonly<Record<string, string>>; // display only
  readonly metadata?: Readonly<Record<string, unknown>>; // declarative, no functions
}
interface UnitPack {
  readonly name: string;
  readonly version: string;
  readonly units: readonly AtomicUnitDef[];
  readonly aliases?: Readonly<Record<string, string>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

class UnitSystemRegistry {
  readonly version: number; // bumps on register/unregister
  registerSystem(system: UnitSystem): UnitSystem; // validates dims/factors/aliases
  unregisterSystem(name: string): UnitSystem | undefined;
  registerPack(pack: UnitPack): UnitPack;
  unregisterPack(name: string): UnitPack | undefined;
  getSystem(name: string): UnitSystem | undefined;
  getPack(name: string): UnitPack | undefined;
  hasSystem(name: string): boolean;
  hasPack(name: string): boolean;
  listSystems(): readonly UnitSystem[];
  listPacks(): readonly UnitPack[];
  getPreferredUnit(systemName: string, category: string): string | undefined;
  applySystemToRegistry(systemName: string, registry: UnitRegistry): void;
  applyPackToRegistry(packName: string, registry: UnitRegistry): void;
  resolveWithSystem(symbol: string, systemName: string, fallback?: UnitRegistry): Unit;
}
export const defaultUnitSystemRegistry: UnitSystemRegistry; // si/imperial/us-customary/cgs systems + all packs

// Built-in packs (import only what you need — tree-shakeable):
// SI_PACK, IMPERIAL_PACK, US_CUSTOMARY_PACK, CGS_PACK, SCIENTIFIC_PACK
```

Conflict policy: same symbol with different meanings (`ton`, `gal`) in two
packs → applying both to one registry throws `UnitRegistrationError`.
Deterministic across registration order. Use separate registries or
`resolveWithSystem(symbol, system)` to disambiguate.

---

### `formatUnit()` / `formatQuantity()`

Render Units and Quantities for display or for canonical snapshots. The
formatter never does math — it only represents what is already there. For
canonical (snapshot) vs display, use options:

```ts
function formatUnit(
  unit: Unit,
  opts?: { ascii?: boolean; multiplicationSymbol?: string; superscript?: boolean },
): string;
function formatQuantity(
  q: Quantity,
  opts?: {
    decimals?: number; // default 2
    showBasis?: boolean; // default true
    locale?: string;
    ascii?: boolean;
    multiplicationSymbol?: string;
    superscript?: boolean;
    spacing?: string;
  },
): string;
function formatUnitCanonical(unit: Unit): string; // ascii false, "·", unicode superscripts
```

Canonical unit symbol is deterministic (`·` and `²`/`⁻¹` by default) and
parser-compatible: `parse(formatUnit(u))` ≈ `u` (same dimension + scale).
`m/s` and `m·s⁻¹` are mathematically identical; formatter prefers `·`/`/` and
`²`/`⁻¹` but both parse.

```ts
formatUnit(parseUnit("kg")); // "kg"
formatUnit(parseUnit("m/s")); // "m/s" (or "m·s⁻¹" with options)
formatUnit(parseUnit("kg·m/s²")); // "kg·m/s²"
formatUnit(parseUnit("m^2"), { ascii: true }); // "m^2"
formatUnit(parseUnit("m^2"), { ascii: false }); // "m²"

formatQuantity(Quantity.of(12.345, "Mcal/day"), { decimals: 1 }); // "12.3 Mcal/day"
formatQuantity(Quantity.of(15, "% DM")); // "15.00 % DM"
formatQuantity(Quantity.of(15, "%")); // "15.00 %" — % preserved, not 0.15
formatQuantity(Quantity.of(10, "m").divide(Quantity.of(2, "m"))); // "5" — pure dimensionless has no symbol
formatQuantity(Quantity.of(Infinity, "kg")); // "Infinity kg"
```

_Dimensionless:_ `%`/`‰`/`ppm`/`ppb`/`ppt` keep their symbols; a purely
mathematical `m/m` formats as a number without unit.

---

### `serializeUnit()` / `serializeQuantity()` / `deserialize*()`

Explicit, versioned, deterministic JSON for persistence. No `JSON.stringify`
of class internals.

```ts
// v1 schema (deterministic key order: version, type, ...)
type SerializedUnit = { version: 1; type: "unit"; expression: string };
type SerializedQuantity = { version: 1; type: "quantity"; value: number | string; unit: string };

function serializeUnit(unit: Unit): SerializedUnit; // expression = unit.symbol (+ basis)
function deserializeUnit(data: unknown, registry?: UnitRegistry): Unit;
function serializeQuantity(q: Quantity): SerializedQuantity;
function deserializeQuantity(data: unknown, registry?: UnitRegistry): Quantity;
// Legacy {value, unit} without version/type is still accepted for backward compat
```

Special numbers are encoded as strings to survive JSON: `NaN`→`"NaN"`,
`Infinity`→`"Infinity"`, `-Infinity`→`"-Infinity"`, `-0`→`"-0"` (decoded with
`Object.is`). Custom units are serialized as their expression string;
deserialization requires the receiving registry to have the same definition
(throws `UnsupportedUnitError` otherwise — no executable code is ever
reconstructed).

```ts
const q = Quantity.of(12, "% DM");
const json = serializeQuantity(q); // {version:1,type:"quantity",value:12,unit:"% DM"}
JSON.stringify(json); // deterministic: version,type,value,unit in order
deserializeQuantity(json).value; // 12 — round-trip preserves value+unit

// Special numbers
serializeQuantity(Quantity.of(NaN, "kg")).value; // "NaN"
deserializeQuantity({ version: 1, type: "quantity", value: "Infinity", unit: "kg" }).value; // Infinity

// Prototype-pollution safe: {"__proto__":...} is rejected
```

Validation is strict (plain object, required fields, types, version===1,
`type` correct, `unit` non-empty parseable, numeric `value` finite or allowed
string). Unknown versions throw `InvalidUnitError`/`UnitEngineError`.

---

### Immutability & Numerical Policy

- **Prefix / Unit / Quantity are frozen immutable.** `makeUnit`/`Quantity.of` return `Object.freeze` values; `a.add(b)` / `a.scale(2)` / `a.negate()` never mutate `a`. Registry operations never mutate existing definitions.
- **Values are IEEE-754.** `NaN`/`Infinity` propagate (not coerced to `0`); `-0` is zero, not negative. `isZero` is `value===0`, `isPositive` is `>0`, `isNegative` is `<0`. `equals` normalizes to base units with an epsilon; use `approximatelyEquals` to convey tolerance intent.
- **Dimension safety:** every arithmetic/comparison validates dimensions first. `1 kg + 1 m` and `1 kg < 1 m` throw `UnitMismatchError`; `1 kg → m` throws `ImpossibleConversionError`. Never compare raw `value` across dimensions.
- **Quantities allow negatives** generically — `-5 °C` is valid; domain layers may add their own constraints later.

### Type guards (trust boundaries, cross-realm safe)

Structural, not solely `instanceof`, so plain objects from other realms/JSON are
validated correctly; prototype keys `__proto__`/`constructor`/`prototype` are
rejected.

```ts
function isQuantity(value: unknown): value is Quantity; // instanceof + {value:number, unit:{symbol,dimension}}
function isUnit(value: unknown): value is Unit;
function isDimension(value: unknown): value is DimensionVector; // plain object, integer exponents, valid ids
function isRatioUnit(unit: Unit): boolean; // isDimensionless(unit.dimension)
function isSameDimension(a: DimensionVector, b: DimensionVector): boolean;
function isMoneyQuantity(q: Quantity): boolean; // pure Currency dimension only
function isSerializedQuantity(value: unknown): boolean; // {version:1,type:"quantity",value,unit} or legacy {value,unit}
function isSerializedUnit(value: unknown): boolean; // {version:1,type:"unit",expression}
```

```ts
if (isQuantity(payload)) {
  /* safe to call .to(), .multiply(), etc. */
}
```

Security at boundaries: `isQuantity`/`isUnit`/`isDimension`/`isSerialized*` are for
JSON/API/plugin inputs; internal hot paths use direct property access after
validation.

---

### Testing utilities

```ts
function assertQuantityClose(
  actual: Quantity,
  expected: Quantity,
  epsilon?: number,
  message?: string,
): void;
function approxEqual(a: number, b: number, epsilon?: number): boolean;
```

```ts
import { assertQuantityClose, Quantity } from "@vetwo/units";

assertQuantityClose(result, Quantity.of(1200, "g/day"), 1e-6);
```

---

### Errors

All errors extend `UnitEngineError`, so you can catch broadly or narrowly.

```ts
class UnitEngineError extends Error {}

class UnitMismatchError extends UnitEngineError {} // add/subtract/compare, different dimensions
class UnsupportedUnitError extends UnitEngineError {} // unknown unit symbol
class DimensionError extends UnitEngineError {} // wrong dimension for the operation
class ConversionError extends UnitEngineError {} // conversion failed (e.g. basis clash)
class ImpossibleConversionError extends UnitEngineError {} // no shared dimension
class InvalidDimensionError extends UnitEngineError {} // bad dimension id/exponent
class InvalidUnitError extends UnitEngineError {} // bad unit definition
class DivisionByZeroError extends UnitEngineError {} // quantity divide by zero
class InvalidUnitExpressionError extends UnitEngineError {} // malformed "kg//s", "/kg", ""
class PrefixRegistrationError extends UnitEngineError {} // duplicate prefix
class RuleNotFoundError extends UnitEngineError {} // unregistered CalculationRuleRegistry key
```

```ts
try {
  Quantity.of(1, "kg").add(Quantity.of(1, "Mcal"));
} catch (e) {
  if (e instanceof UnitMismatchError) {
    // handle: "Unit mismatch: cannot combine "kg" with "Mcal" (different dimensions)."
  }
}
```

---

## Extending the engine for a new domain

`@vetwo/units` was designed so a brand-new scientific/financial domain can
be added without ever touching this package's source:

1. **Register any new atomic units** you need via `defaultUnitRegistry.registerAtomic()`.
2. **Register your domain's formulas** via `defaultCalculationRuleRegistry.register()`.
3. **Wrap both in your own package** (e.g. `@vetwo/nutrition-units`, or a
   `@you/chemistry-units`) that exposes a friendly facade — the way
   `NutritionMath` and `CoefficientResolver` do in `@vetwo/nutrition-units`.

This package should never contain nutrition, chemistry, or finance-specific
code — if you find yourself wanting to add that here, it belongs in a
domain package instead.

For the explicit, conflict-checked workflow (manifests, scoped registries,
namespaces, atomic apply), see [docs/extension-guide.md](docs/extension-guide.md).
New applications should prefer `createExtensionScope()` + `applyExtension()`
over mutating the process-wide defaults.

---

## Interoperability & extension APIs

- **Exchange:** `toInterchange()` / `fromInterchange()` move Quantity,
  Measurement, series, datasets, formula results and reference-data
  registries as plain versioned data (`schemaVersion: 1`); unknown fields
  follow an explicit `reject` / `preserve` / `ignore` policy.
- **Migration:** `migrateSerialized(data, migrations, targetVersion, kind)`
  chains host-registered version steps; gaps and cycles throw
  `MigrationError` instead of reinterpreting old bytes.
- **Ambiguity:** `resolveAmbiguous("ton", { sources, strategy })` with
  `strict` / `standard` / `permissive` policies, plus `ns:symbol`
  namespaces and explicit external mappings (`importUnitName`,
  `validateImportMapping`).
- **Canonical form:** `canonicalizeUnitText("m·s^-1")` and
  `canonicalIdentity(unit)` give display-independent keys (`N` ≡ `kg·m/s²`).
- **Output:** `formatWithPreset(value, "canonical" | "symbolic" | "human" |
"compact" | "machine" | "system-preferred")` — presentation only.
- **Comparison:** `compareQuantities(a, b, "exact" | "absolute" |
"relative" | "combined", tolerance)`; dimension mismatches always throw.
- **Diagnostics:** `explainConversion` / `explainFormula` return inputs,
  dimensions, steps, outputs and structured warnings; `resolveStrictness`
  maps `strict` / `standard` / `permissive` to concrete engine options
  (dimensional safety has no off-switch).
- **Stability:** public API stability policy, migration rules and
  anti-patterns live in [docs/migration.md](docs/migration.md) and
  [docs/anti-patterns.md](docs/anti-patterns.md); start with
  [docs/getting-started.md](docs/getting-started.md).

---

## Design principles

- **No magic numbers outside one file.** Every raw conversion constant
  lives in a single, documented internal file; nowhere else in this
  package (or any consuming application) should contain a bare conversion
  factor.
- **Single Responsibility per module** — parsing, registry, math,
  formatting, and serialization are each isolated.
- **Open/Closed** — new units and new domain rules are added by
  _registering_, never by editing internals.
- **Zero domain knowledge** — this package is safe to reuse in any
  scientific or financial context.

## Requirements

- TypeScript ^5.x
- No runtime dependencies

## License

MIT
