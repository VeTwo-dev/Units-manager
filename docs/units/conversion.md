# Conversion — Engine, Temperature, Registries & Packs

## The engine

```ts
quantity.to(target: string | Unit, registry?: UnitRegistry): Quantity
quantity.toBase(): Quantity
```

- `.to()` converts value + unit together and returns a new `Quantity`.
  Incompatible dimensions throw `ImpossibleConversionError`.
- `.toBase()` converts to base units (useful for hand-checked comparisons).
- Underneath: cached conversion plans (`getConversionPlan`,
  `convertWithPlan`) over linear (`scale`) and affine (`scale + offset`)
  conversions. Logarithmic/custom conversions are refused explicitly
  (`UnsupportedTransformationError`) — they need an explicit context model,
  never a silent factor.

```ts
Quantity.of(25, "kg").to("g"); // 25000 g
Quantity.of(15, "%").to("fraction"); // 0.15
Quantity.of(25, "°C").to("K"); // 298.15 K
```

## Temperature rules (must-read)

| Unit       | Kind                   | Behavior                                             |
| ---------- | ---------------------- | ---------------------------------------------------- |
| `K`        | linear (interval)      | Full arithmetic: `K+K`, `K×kg`, `K/2` all meaningful |
| `°C`, `°F` | affine (offset)        | `+K`/`−K` deltas OK; `+°C`, `×2`, `×kg` throw        |
| `°R`       | absolute, linear scale | Treated as absolute temperature                      |

Helpers: `isAffineUnit(u)` (has a non-zero offset) and
`isAbsoluteTemperatureUnit(u)` (affine **or** absolute-temperature metadata).
Arithmetic branches on `isAffineUnit`, so `K` composes freely while `°C`
stays offset-safe.

## Parsing units

```ts
parseUnit(text: string, registry?, opts?): Unit
```

Parses atomic (`kg`), prefixed (`mg`, `µm`), composite (`kg*m/s²`,
`(kg*m)/s^2`, `kg/m³`), and dimensionless (`m/m`, `%`) expressions with a
cache on hot paths. Malformed input throws typed errors
(`InvalidUnitExpressionError`); it never crashes or hangs. Strict mode is
available via options.

## Registries, systems, packs

```ts
import { createRegistry, SI_PACK, IMPERIAL_PACK, CGS_PACK } from "@vetwo/units";
const si = createRegistry({ packs: [SI_PACK] });
Quantity.of(1, "N", si).to("kg*m/s^2", si);
```

- `UnitRegistry` resolves symbols; `createRegistry({ packs })` builds scoped
  registries. Available packs: `SI_PACK` (+ base/derived/accepted splits),
  `IMPERIAL_PACK`, `US_CUSTOMARY_PACK`, `CGS_PACK`, `SCIENTIFIC_PACK`,
  `ANGLE_PACK`, `RADIATION_PACK`, `ASTRONOMY_PACK`, `INFORMATION_PACK`.
- Unit systems (`defaultUnitSystemRegistry`), standards profiles
  (`normalizeToSystem`, `selectUnitForMagnitude`, `formatWithContext`), and
  prefix registries (`defaultPrefixRegistry`) cover cross-system work.
- Basis tags (`unit.basis`) are generic metadata some domains use to scope
  units; the engine itself treats them opaquely.

## Practical rules

- DO convert with `.to()` and let packs supply the factors.
- DO pass an explicit registry when working outside the default set
  (imperial, scientific, angle units).
- DO NOT write `/100`, `*1000`, `+273.15` literals in application code.
- DO NOT convert temperatures by hand — offsets defeat naive factors.
- DO NOT assume a symbol exists: `parseUnit` throws `UnsupportedUnitError`
  for unknown units (e.g. there is no `currency` unit — economics extensions
  define their own, e.g. `cur`).
