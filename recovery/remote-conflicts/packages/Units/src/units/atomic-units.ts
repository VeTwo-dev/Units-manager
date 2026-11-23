/**
 * units/atomic-units.ts
 * -----------------------------------------------------------------------
 * Single responsibility: define the ATOMIC units the engine ships with,
 * and their conversion to the base/canonical unit of their dimension.
 *
 * RAW CONVERSION CONSTANTS may live ONLY in declarative unit-data files:
 * this file (core units) and `src/packs/*.ts` (SI/imperial/US/CGS packs).
 * Everywhere else those numbers would be "magic numbers" — here they are
 * the single source of truth per pack, named and documented with their
 * derivation. Pack files must never contain executable conversion logic.
 *
 * Adding a new atomic unit anywhere in the universe (physics, chemistry,
 * finance) means adding one line in the appropriate data file — nothing
 * else in the engine changes.
 *
 * All offsets are relative to the CANONICAL base unit of the dimension:
 *   Mass      → kg
 *   Time      → day
 *   Length    → m
 *   Energy    → Mcal
 *   Temperature → K
 *   Currency  → cur
 *   Count     → IU
 *   Ratio     → fraction
 * -----------------------------------------------------------------------
 */
import { defineDimension, Dim, type DimensionVector } from "../dimension.js";
import type { ConversionDef, UnitMetadata } from "../unit.js";

export interface AtomicUnitDef {
  /** Canonical symbol, e.g. "kg", "Mcal", "%", "°C". */
  symbol: string;
  dimension: DimensionVector;
  /**
   * Conversion to the dimension's canonical base unit.
   * - For linear: multiply value by this factor.
   * - For affine: use `conversion` field instead.
   */
  toBaseFactor: number;
  /** Human readable label, for formatting/reporting. */
  label: string;
  /** Optional conversion definition (for affine units like temperature). */
  conversion?: ConversionDef;
  /** Optional metadata (prefixability, system, docs, etc.). */
  metadata?: UnitMetadata;
}

const M = Dim.Mass;
const T = Dim.Time;
const L = Dim.Length;
const Temp = Dim.Temperature;
const E = Dim.Energy;
const C = Dim.Currency;
const N = Dim.Count;
const R = Dim.Dimensionless;

/**
 * Single source of truth for the power base factor: 1 W = 1 J/s, with
 * 1 J = 0.239006/1e6 Mcal and 1 s = 1/86400 day in base units. Every
 * E·T⁻¹-derived unit must compose from this, never assume factor 1.
 */
const WATT_PER_BASE = 0.239006 / 1e6 / (1 / (24 * 60 * 60));

/**
 * Base units per dimension (factor === 1):
 *   Mass         → kg          (canonical SI base, NOT prefixable)
 *                  g           (scalable mass unit, prefixable — see KILOGRAM NOTE below)
 *   Time         → day
 *   Length       → m           (prefixable)
 *   Temperature  → K
 *   Energy       → Mcal
 *   Currency     → cur (generic)
 *   Count        → IU
 *   Frequency    → Hz          (prefixable, dimension T⁻¹)
 *   Power        → W           (prefixable, dimension E·T⁻¹)
 *   Ratio        → fraction (1.0 = "100%")
 *
 * KILOGRAM SPECIAL CASE:
 * The SI kilogram is unique: its name already contains the "kilo" prefix
 * but it is the SI base unit. To avoid "kkg" etc., the registry marks
 * `kg` as NOT prefixable and `g` as prefixable. Prefixed mass units are
 * derived as prefix + `g` (e.g. `k` + `g` = `kg` with factor 1), but the
 * atomic `kg` takes precedence at lookup so there is no user-visible
 * duplication. Explicit prefixed atomics like `mg`, `µg` are kept for
 * backward compat but new combinations like `ng`, `pg` are generated
 * lazily via the prefix engine.
 */
export const ATOMIC_UNITS: readonly AtomicUnitDef[] = Object.freeze([
  // ---- Mass ---------------------------------------------------------
  // kg is the canonical base for Mass but NOT prefixable (avoids kkg, mkg, etc.)
  { symbol: "kg", dimension: M, toBaseFactor: 1, label: "kilogram" },
  // g is the scalable mass unit: prefix + g yields all prefixed masses
  {
    symbol: "g",
    dimension: M,
    toBaseFactor: 0.001,
    label: "gram",
    metadata: { prefixable: true, system: "SI" },
  },
  { symbol: "mg", dimension: M, toBaseFactor: 0.000001, label: "milligram" },
  // µg with ASCII aliases for the micro symbol
  { symbol: "µg", dimension: M, toBaseFactor: 0.000000001, label: "microgram" },
  { symbol: "lb", dimension: M, toBaseFactor: 0.45359237, label: "pound" },

  // ---- Time -----------------------------------------------------------
  // Only `s` is prefixable (so ms, µs, ns work); day/hour/min/yr are not.
  // `yr` is the JULIAN year (365.25 days exactly, IAU/NIST conventional
  // value for astronomical calculations) — an explicitly documented
  // approximation of the civil calendar year, NOT a fixed calendar month/
  // year. There is deliberately no `month` unit: civil months are not a
  // fixed duration and faking one as linear would be silently wrong.
  { symbol: "day", dimension: T, toBaseFactor: 1, label: "day" },
  {
    symbol: "hour",
    dimension: T,
    toBaseFactor: 1 / 24,
    label: "hour",
    metadata: { system: "SI" },
    // Alias "h" for hour per SI convention; exact alias wins over hecto prefix "h" for standalone
    ...({ aliases: ["h"] } as unknown as Record<string, unknown>),
  } as AtomicUnitDef,
  { symbol: "min", dimension: T, toBaseFactor: 1 / (24 * 60), label: "minute" },
  {
    symbol: "s",
    dimension: T,
    toBaseFactor: 1 / (24 * 60 * 60),
    label: "second",
    metadata: { prefixable: true, system: "SI" },
  },
  {
    symbol: "yr",
    dimension: T,
    toBaseFactor: 365.25, // exact: Julian year = 365.25 days (see note above)
    label: "Julian year",
    metadata: {
      system: "general",
      category: "time",
      docs: "Julian year approximation (365.25 d exactly); not a civil-calendar year",
    },
  },

  // ---- Length ----------------------------------------------------------
  // `m` is prefixable so km, cm, mm, µm, nm, etc. are derivable; ft/in are not
  {
    symbol: "m",
    dimension: L,
    toBaseFactor: 1,
    label: "meter",
    metadata: { prefixable: true, system: "SI" },
  },
  { symbol: "cm", dimension: L, toBaseFactor: 0.01, label: "centimeter" },
  { symbol: "mm", dimension: L, toBaseFactor: 0.001, label: "millimeter" },
  { symbol: "km", dimension: L, toBaseFactor: 1000, label: "kilometer" },
  { symbol: "ft", dimension: L, toBaseFactor: 0.3048, label: "foot" },
  { symbol: "in", dimension: L, toBaseFactor: 0.0254, label: "inch" },

  // ---- Frequency -------------------------------------------------------
  // T⁻¹ — prefixable so kHz, MHz, GHz, etc. are derivable.
  // Phase 21.30 audit correction: 1 Hz = 1/s = 86400/day (the engine time
  // base is the day, so the factor is 86400, NOT 1 — previously 1, which
  // meant "one per day"). Consistent with C = A·s = 1/86400 A·day, so
  // A/C algebra now yields Hz correctly (1 A / 1 C = 86400/day = 1 Hz).
  {
    symbol: "Hz",
    dimension: defineDimension({ T: -1 }),
    toBaseFactor: 86400,
    label: "hertz",
    metadata: { prefixable: true, system: "SI", kind: "frequency" },
  },

  // ---- Power -----------------------------------------------------------
  // E·T⁻¹ — prefixable so W, kW, mW, MW, etc. are derivable.
  // Prompt-18 fix: 1 W = 1 J/s compositionally = (0.239006/1e6 Mcal) /
  // (1/86400 day) in base units. The old factor 1 silently meant "1 Mcal/day"
  // (≈48.4 MW), breaking every cross-clique conversion (V, Ω, W·h, …).
  {
    symbol: "W",
    dimension: defineDimension({ E: 1, T: -1 }),
    toBaseFactor: WATT_PER_BASE,
    label: "watt",
    metadata: { prefixable: true, system: "SI" },
  },

  // ---- Temperature -----------------------------------------------------
  // All offsets are relative to K (the canonical base).
  //   K  = °C + 273.15        → scale: 1,    offset: 273.15
  //   °F = (K - 255.37222...) × 9/5 + 32
  //   K  = (°F - 32) × 5/9 + 273.15  → scale: 5/9, offset: 255.37222...
  //   °R = K × 9/5            → scale: 5/9, offset: 0 (Rankine is LINEAR:
  //   absolute zero is 0 °R, so no offset; intervals and absolutes share
  //   the scale, unlike °C/°F)
  //
  // Semantic kinds (Phase 22): absolute scales carry
  // kind "temperature-absolute". K doubles as the interval unit — a bare
  // K quantity defaults to absolute; use .withKind("temperature-difference")
  // for explicit intervals.
  {
    symbol: "K",
    dimension: Temp,
    toBaseFactor: 1,
    label: "kelvin",
    conversion: { kind: "linear", scale: 1 },
    metadata: { system: "SI", kind: "temperature-absolute" },
  },
  {
    symbol: "°C",
    dimension: Temp,
    toBaseFactor: 1,
    label: "degree Celsius",
    conversion: { kind: "affine", scale: 1, offset: 273.15 },
    metadata: { system: "SI", kind: "temperature-absolute" },
  },
  {
    symbol: "°F",
    dimension: Temp,
    toBaseFactor: 5 / 9,
    label: "degree Fahrenheit",
    conversion: { kind: "affine", scale: 5 / 9, offset: 255.37222222222223 },
    metadata: { system: "general", kind: "temperature-absolute" },
  },
  {
    symbol: "°R",
    dimension: Temp,
    toBaseFactor: 5 / 9, // exact: 1 °R = 5/9 K (absolute zero is 0 °R)
    label: "degree Rankine",
    conversion: { kind: "linear", scale: 5 / 9 },
    metadata: { system: "general", kind: "temperature-absolute" },
  },

  // ---- Energy ---------------------------------------------------------
  { symbol: "Mcal", dimension: E, toBaseFactor: 1, label: "megacalorie" },
  { symbol: "Kcal", dimension: E, toBaseFactor: 0.001, label: "kilocalorie" },
  { symbol: "MJ", dimension: E, toBaseFactor: 0.239006, label: "megajoule" },
  { symbol: "kJ", dimension: E, toBaseFactor: 0.239006 / 1000, label: "kilojoule" },

  // ---- Currency (generic — real symbol resolved by the host app) ------
  { symbol: "cur", dimension: C, toBaseFactor: 1, label: "currency unit" },

  // ---- Count / biological activity ------------------------------------
  { symbol: "IU", dimension: N, toBaseFactor: 1, label: "international unit" },

  // ---- Dimensionless ratios (%, ppm, fraction) -------------------------
  { symbol: "fraction", dimension: R, toBaseFactor: 1, label: "fraction" },
  { symbol: "%", dimension: R, toBaseFactor: 0.01, label: "percent" },
  { symbol: "‰", dimension: R, toBaseFactor: 0.001, label: "per mille" },
  { symbol: "ppm", dimension: R, toBaseFactor: 0.000001, label: "parts per million" },
  { symbol: "ppb", dimension: R, toBaseFactor: 0.000000001, label: "parts per billion" },
  { symbol: "ppt", dimension: R, toBaseFactor: 0.000000000001, label: "parts per trillion" },
]);
