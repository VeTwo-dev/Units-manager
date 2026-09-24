/**
 * packs/us-customary.ts
 * -----------------------------------------------------------------------
 * US customary unit pack (data only, no side effects).
 *
 * Importing this module does NOT mutate any registry. Apply explicitly:
 *
 *   import { US_CUSTOMARY_PACK } from "@vetwo/units";
 *   const registry = createRegistry({ packs: [US_CUSTOMARY_PACK] });
 *
 * Length/mass/speed/force/pressure definitions shared with Imperial
 * (1959 agreement) are reused verbatim via import — no duplication.
 * US liquid volume differs from Imperial: 1 US gallon = 231 in³ exactly
 * = 0.003785411784 m³. The short ton (2000 lb) differs from the long ton.
 *
 * Collision policy: this pack shares symbols ("ton", "gal", "qt", "pt",
 * "floz", "yd", "mile", "oz", "mph", "knot", "psi", "lbf") with the
 * Imperial pack, so applying BOTH packs to one registry throws
 * UnitRegistrationError by design. Use separate registries or explicit
 * system context (resolveWithSystem) instead.
 * -----------------------------------------------------------------------
 */
import { defineDimension, Dim } from "../dimension.js";
import type { AtomicUnitDef } from "../units/atomic-units.js";
import type { UnitPack } from "../unit-system.js";
import { yardDef, mileDef, ounceDef, mphDef, knotDef, lbfDef, psiDef } from "./imperial.js";

// Exact: 1 US liquid gallon = 231 in³ = 231 × 0.0254³ m³ = 0.003785411784 m³
const US_GALLON_PER_M3 = 0.003785411784;

// Exact: 1 short ton = 2000 lb = 2000 × 0.45359237 kg
const SHORT_TON_PER_KG = 2000 * 0.45359237;

export const US_CUSTOMARY_PACK: UnitPack = Object.freeze({
  name: "us-customary",
  version: "1.0.0",
  displayName: "US customary units",
  description:
    "US customary mass/volume units plus shared 1959 length/speed/force/pressure " +
    "definitions reused from the Imperial pack. Self-contained: apply alone, " +
    "not combined with the Imperial pack in one registry.",
  units: Object.freeze([
    // Shared 1959 definitions (identical objects, no duplication)
    yardDef,
    mileDef,
    ounceDef,
    mphDef,
    knotDef,
    lbfDef,
    psiDef,
    // US-specific units
    {
      symbol: "ton",
      dimension: Dim.Mass,
      toBaseFactor: SHORT_TON_PER_KG, // 907.18474 kg — differs from Imperial long ton
      label: "short ton",
      metadata: { system: "US", category: "mass" },
    } as AtomicUnitDef,
    {
      symbol: "gal",
      dimension: defineDimension({ L: 3 }),
      toBaseFactor: US_GALLON_PER_M3,
      label: "US liquid gallon",
      metadata: { system: "US", category: "volume" },
    },
    {
      symbol: "qt",
      dimension: defineDimension({ L: 3 }),
      toBaseFactor: US_GALLON_PER_M3 / 4, // exact power-of-two step
      label: "US liquid quart",
      metadata: { system: "US", category: "volume" },
    },
    {
      symbol: "pt",
      dimension: defineDimension({ L: 3 }),
      toBaseFactor: US_GALLON_PER_M3 / 8, // exact power-of-two step
      label: "US liquid pint",
      metadata: { system: "US", category: "volume" },
    },
    {
      symbol: "cup",
      dimension: defineDimension({ L: 3 }),
      toBaseFactor: US_GALLON_PER_M3 / 16, // exact power-of-two step
      label: "US cup",
      metadata: { system: "US", category: "volume" },
    },
    {
      symbol: "floz",
      dimension: defineDimension({ L: 3 }),
      toBaseFactor: US_GALLON_PER_M3 / 128, // exact: 128 fl oz per US gallon
      label: "US fluid ounce",
      metadata: { system: "US", category: "volume" },
    },
  ]),
  aliases: Object.freeze({
    gallon: "gal",
    quart: "qt",
    pint: "pt",
  } as Record<string, string>),
  metadata: Object.freeze({
    standard: "US customary",
    source: "US gallon defined as 231 cubic inches (exact)",
  }),
});
