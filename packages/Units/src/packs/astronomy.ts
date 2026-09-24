/**
 * packs/astronomy.ts
 * -----------------------------------------------------------------------
 * Astronomical distance unit pack (data only, no side effects).
 *
 * Importing this module does NOT mutate any registry. Apply explicitly:
 *
 *   import { ASTRONOMY_PACK } from "@vetwo/units";
 *   const registry = createRegistry({ packs: [ASTRONOMY_PACK] });
 *
 * Unit definitions and dimensions ONLY — no astronomical formulas in this
 * phase (21.24). Parsec is prefixable so kpc/Mpc derive via the engine.
 *
 * Factors (exact by resolution/definition):
 * - 1 AU = 149597870700 m exact (IAU 2012 Resolution B2).
 * - 1 Julian year = 365.25 days exactly (same convention as the core `yr`).
 * - 1 ly = c × Julian year with c = 299792458 m/s exact
 *        = 299792458 × 31557600 = 9460730472580800 m exact.
 * - 1 pc = 648000/π AU exactly (IAU 2015 Resolution B2), computed from the
 *   AU constant above — no second magic number.
 * -----------------------------------------------------------------------
 */
import { Dim } from "../dimension.js";
import type { AtomicUnitDef } from "../units/atomic-units.js";
import type { UnitPack } from "../unit-system.js";

// Exact: 1 AU = 149597870700 m (IAU 2012)
const AU_PER_M = 149597870700;

// Exact: c = 299792458 m/s; Julian year = 365.25 × 86400 s = 31557600 s
const LIGHT_YEAR_PER_M = 299792458 * 31557600;

// Exact: 1 pc = (648000/π) AU (IAU 2015) — derived, not re-typed
const PARSEC_PER_M = (648000 / Math.PI) * AU_PER_M;

export const ASTRONOMY_PACK: UnitPack = Object.freeze({
  name: "astronomy",
  version: "1.0.0",
  displayName: "Astronomical distance units",
  description:
    "Generic astronomical distances (AU, light-year, parsec). " +
    "Definitions and dimensions only — no formulas.",
  units: Object.freeze([
    {
      symbol: "AU",
      dimension: Dim.Length,
      toBaseFactor: AU_PER_M,
      label: "astronomical unit",
      metadata: { system: "astronomical", standard: "IAU 2012", category: "distance" },
    } as AtomicUnitDef,
    {
      symbol: "lyr",
      dimension: Dim.Length,
      toBaseFactor: LIGHT_YEAR_PER_M,
      label: "light-year",
      metadata: { system: "astronomical", category: "distance" },
    } as AtomicUnitDef,
    {
      symbol: "pc",
      dimension: Dim.Length,
      toBaseFactor: PARSEC_PER_M,
      label: "parsec",
      metadata: {
        prefixable: true,
        system: "astronomical",
        standard: "IAU 2015",
        category: "distance",
      },
    } as AtomicUnitDef,
  ]),
  aliases: Object.freeze({
    astronomicalunit: "AU",
    lightyear: "lyr",
    parsec: "pc",
  } as Record<string, string>),
  metadata: Object.freeze({
    standard: "IAU",
    source: "IAU 2012 Resolution B2 (AU); IAU 2015 Resolution B2 (pc)",
  }),
});
