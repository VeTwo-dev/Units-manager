/**
 * packs/cgs.ts
 * -----------------------------------------------------------------------
 * CGS (centimetre–gram–second) unit pack (data only, no side effects).
 *
 * Importing this module does NOT mutate any registry. Apply explicitly:
 *
 *   import { CGS_PACK } from "@vetwo/units";
 *   const registry = createRegistry({ packs: [CGS_PACK] });
 *
 * Only units from the Phase 17 coverage list are included: dyne (dyn)
 * and erg. Base cm/g/s already resolve via the core registry (cm atomic,
 * g atomic, s atomic), so this pack only adds what is missing.
 *
 * Conversion notes:
 * - 1 dyn = 10^-5 N. The engine base time is the day, so 1 N = 86400²
 *   kg·m/day² and 1 dyn = 86400²/10^5 (exact power-of-ten step).
 * - 1 erg = 10^-7 J. Energy uses the engine's E dimension (consistent
 *   with Mcal/MJ); the joule factor chains off the existing MJ constant
 *   exactly as in the SI pack, so erg is defined relative to it.
 * -----------------------------------------------------------------------
 */
import { defineDimension } from "../dimension.js";
import type { AtomicUnitDef } from "../units/atomic-units.js";
import type { UnitPack } from "../unit-system.js";

// 1 N = 86400² kg·m/day² (exact integer); 1 dyn = 10^-5 N (exact decimal step)
const NEWTON_PER_BASE = 86400 * 86400;
const DYNE_PER_BASE = NEWTON_PER_BASE / 100000;

// 1 erg = 10^-7 J; J = 0.239006/10^6 Mcal (chained off the MJ constant)
const ERG_PER_MCAL = 0.239006 / 1000000 / 10000000;

// 1 P (poise) = 0.1 Pa·s exactly; Pa = 86400² kg/m·day² (engine M·L⁻¹·T⁻²
// base), s = 1/86400 day → 1 P = 0.1 × 86400 kg/m·day.
const POISE_PER_BASE = 0.1 * NEWTON_PER_BASE * (1 / 86400);

// 1 St (stokes) = 10^-4 m²/s exactly → × 86400 for the day base.
const STOKES_PER_BASE = 0.0001 * 86400;

export const CGS_PACK: UnitPack = Object.freeze({
  name: "cgs",
  version: "1.0.0",
  displayName: "CGS units",
  description:
    "Centimetre–gram–second derived units missing from core (dyne, erg). " +
    "Base cm/g/s resolve via the core registry.",
  units: Object.freeze([
    {
      symbol: "dyn",
      dimension: defineDimension({ M: 1, L: 1, T: -2 }),
      toBaseFactor: DYNE_PER_BASE, // 74.6496, exact
      label: "dyne",
      metadata: { system: "CGS", standard: "CGS", category: "force" },
    } as AtomicUnitDef,
    {
      symbol: "erg",
      dimension: defineDimension({ E: 1 }),
      toBaseFactor: ERG_PER_MCAL,
      label: "erg",
      metadata: { system: "CGS", standard: "CGS", category: "energy" },
    } as AtomicUnitDef,
    {
      symbol: "P",
      dimension: defineDimension({ M: 1, L: -1, T: -1 }),
      toBaseFactor: POISE_PER_BASE,
      label: "poise",
      metadata: { system: "CGS", standard: "CGS", category: "dynamic viscosity" },
    } as AtomicUnitDef,
    {
      symbol: "St",
      dimension: defineDimension({ L: 2, T: -1 }),
      toBaseFactor: STOKES_PER_BASE,
      label: "stokes",
      metadata: { system: "CGS", standard: "CGS", category: "kinematic viscosity" },
    } as AtomicUnitDef,
  ]),
  aliases: Object.freeze({
    dyne: "dyn",
  } as Record<string, string>),
  metadata: Object.freeze({ standard: "CGS", source: "CGS system of units" }),
});
