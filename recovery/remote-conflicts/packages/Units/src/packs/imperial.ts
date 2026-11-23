/**
 * packs/imperial.ts
 * -----------------------------------------------------------------------
 * Imperial unit pack (data only, no side effects).
 *
 * Importing this module does NOT mutate any registry. Apply explicitly:
 *
 *   import { IMPERIAL_PACK } from "@vetwo/units";
 *   const registry = createRegistry({ packs: [IMPERIAL_PACK] });
 *
 * Standards: International Yard and Pound Agreement (1959) for length/mass;
 * UK Weights and Measures Act for imperial volume. All factors below are
 * exact definitional values with derivation comments.
 *
 * Shared 1959 definitions (yard, mile, ounce, mph, knot, psi, lbf) are
 * exported individually so the US customary pack reuses the identical
 * objects instead of duplicating semantics. Applying both imperial and
 * US packs to ONE registry throws on shared symbols by design — use
 * separate registries or explicit system context instead.
 * -----------------------------------------------------------------------
 */
import { defineDimension, Dim } from "../dimension.js";
import type { AtomicUnitDef } from "../units/atomic-units.js";
import type { UnitPack } from "../unit-system.js";

// Exact: 1 lb = 0.45359237 kg (1959 agreement); 1 oz = 1/16 lb (exact power-of-two step)
const POUND_PER_KG = 0.45359237;
const OUNCE_PER_KG = POUND_PER_KG / 16;

// Exact SI definitions (shared 1959 agreement)
const YARD_PER_M = 0.9144;
const MILE_PER_M = 1609.344;

// Exact: 1 lbf = 4.4482216152605 N; engine base time is the day (1 s = 1/86400 day),
// so 1 lbf = 4.4482216152605 × 86400² kg·m/day²
const POUND_FORCE_NEWTONS = 4.4482216152605;
const DAY_SECONDS = 86400;
const LBF_PER_BASE = POUND_FORCE_NEWTONS * DAY_SECONDS * DAY_SECONDS;

// Exact: 1 in = 0.0254 m; 1 psi = 1 lbf/in²
const INCH_PER_M = 0.0254;
const PSI_PER_BASE = LBF_PER_BASE / (INCH_PER_M * INCH_PER_M);
// Exact: 1 ft = 0.3048 m; 1 psf = 1 lbf/ft²
const FOOT_PER_M = 0.3048;
const PSF_PER_BASE = LBF_PER_BASE / (FOOT_PER_M * FOOT_PER_M);

// Exact: 1 mph = 0.44704 m/s; per day base → × 86400
const MPH_PER_BASE = 0.44704 * DAY_SECONDS;
// Exact: 1 knot = 1 nmi/h = 1852 m/h = 1852 × 24 m/day
const KNOT_PER_BASE = 1852 * 24;

// Exact imperial gallon: 4.54609 L = 0.00454609 m³ (UK Weights and Measures Act)
const IMPERIAL_GALLON_PER_M3 = 0.00454609;

// Exact: 1 acre = 4046.8564224 m²
const ACRE_PER_M2 = 4046.8564224;

/** Shared 1959 length/mass definitions, reused verbatim by the US customary pack. */
export const yardDef: AtomicUnitDef = {
  symbol: "yd",
  dimension: Dim.Length,
  toBaseFactor: YARD_PER_M,
  label: "yard",
  metadata: { system: "Imperial", standard: "1959 agreement", category: "length" },
};

export const mileDef: AtomicUnitDef = {
  symbol: "mile",
  dimension: Dim.Length,
  toBaseFactor: MILE_PER_M,
  label: "mile",
  metadata: { system: "Imperial", standard: "1959 agreement", category: "length" },
};

export const ounceDef: AtomicUnitDef = {
  symbol: "oz",
  dimension: Dim.Mass,
  toBaseFactor: OUNCE_PER_KG,
  label: "ounce",
  metadata: { system: "Imperial", standard: "1959 agreement", category: "mass" },
};

/** Shared speed/force/pressure definitions, identical in Imperial and US use. */
export const mphDef: AtomicUnitDef = {
  symbol: "mph",
  dimension: defineDimension({ L: 1, T: -1 }),
  toBaseFactor: MPH_PER_BASE,
  label: "mile per hour",
  metadata: { system: "Imperial", category: "speed" },
};

export const knotDef: AtomicUnitDef = {
  symbol: "knot",
  dimension: defineDimension({ L: 1, T: -1 }),
  toBaseFactor: KNOT_PER_BASE,
  label: "knot",
  metadata: { system: "Imperial", category: "speed" },
};

export const lbfDef: AtomicUnitDef = {
  symbol: "lbf",
  dimension: defineDimension({ M: 1, L: 1, T: -2 }),
  toBaseFactor: LBF_PER_BASE,
  label: "pound-force",
  metadata: { system: "Imperial", category: "force" },
};

export const psiDef: AtomicUnitDef = {
  symbol: "psi",
  dimension: defineDimension({ M: 1, L: -1, T: -2 }),
  toBaseFactor: PSI_PER_BASE,
  label: "pound per square inch",
  metadata: { system: "Imperial", category: "pressure" },
};

export const psfDef: AtomicUnitDef = {
  symbol: "psf",
  dimension: defineDimension({ M: 1, L: -1, T: -2 }),
  toBaseFactor: PSF_PER_BASE,
  label: "pound per square foot",
  metadata: { system: "Imperial", category: "pressure" },
};

/**
 * Imperial (long) ton: 2240 lb. NOTE: symbol "ton" differs from the US
 * short ton — applying both packs to one registry throws (by design).
 */
export const imperialTonDef: AtomicUnitDef = {
  symbol: "ton",
  dimension: Dim.Mass,
  toBaseFactor: 2240 * POUND_PER_KG, // 1016.0469088 kg
  label: "long ton",
  metadata: { system: "Imperial", category: "mass" },
};

export const IMPERIAL_PACK: UnitPack = Object.freeze({
  name: "imperial",
  version: "1.0.0",
  displayName: "Imperial units",
  description:
    "Imperial length/mass/volume/area/speed/force/pressure units. " +
    "Self-contained; shared 1959 definitions are exported for US reuse. " +
    "Do not combine with the US customary pack in one registry (shared symbols collide by design).",
  units: Object.freeze([
    yardDef,
    mileDef,
    ounceDef,
    imperialTonDef,
    {
      symbol: "acre",
      dimension: defineDimension({ L: 2 }),
      toBaseFactor: ACRE_PER_M2,
      label: "acre",
      metadata: { system: "Imperial", category: "area" },
    },
    {
      symbol: "gal",
      dimension: defineDimension({ L: 3 }),
      toBaseFactor: IMPERIAL_GALLON_PER_M3,
      label: "imperial gallon",
      metadata: { system: "Imperial", category: "volume" },
    },
    {
      symbol: "qt",
      dimension: defineDimension({ L: 3 }),
      toBaseFactor: IMPERIAL_GALLON_PER_M3 / 4, // exact power-of-two step
      label: "imperial quart",
      metadata: { system: "Imperial", category: "volume" },
    },
    {
      symbol: "pt",
      dimension: defineDimension({ L: 3 }),
      toBaseFactor: IMPERIAL_GALLON_PER_M3 / 8, // exact power-of-two step
      label: "imperial pint",
      metadata: { system: "Imperial", category: "volume" },
    },
    {
      symbol: "floz",
      dimension: defineDimension({ L: 3 }),
      toBaseFactor: IMPERIAL_GALLON_PER_M3 / 160, // exact: 160 fl oz per imperial gallon
      label: "imperial fluid ounce",
      metadata: { system: "Imperial", category: "volume" },
    },
    mphDef,
    knotDef,
    lbfDef,
    psiDef,
    psfDef,
  ]),
  aliases: Object.freeze({
    yard: "yd",
    ounce: "oz",
    gallon: "gal",
    quart: "qt",
    pint: "pt",
  } as Record<string, string>),
  metadata: Object.freeze({
    standard: "Imperial",
    source: "International Yard and Pound Agreement (1959); UK Weights and Measures Act",
  }),
});
