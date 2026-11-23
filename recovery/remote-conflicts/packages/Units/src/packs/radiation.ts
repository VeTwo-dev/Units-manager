/**
 * packs/radiation.ts
 * -----------------------------------------------------------------------
 * Radioactivity and radiation-dose unit pack (data only, no side effects).
 *
 * Importing this module does NOT mutate any registry. Apply explicitly:
 *
 *   import { RADIATION_PACK } from "@vetwo/units";
 *   const registry = createRegistry({ packs: [RADIATION_PACK] });
 *
 * Semantic-safety design (21.16 — never casually equated):
 * - Activity (Bq, Ci, dimension T⁻¹) is NOT ordinary frequency: both share
 *   the T⁻¹ dimension, but kinds "activity" vs "frequency" keep them
 *   distinguishable to semantic-aware callers.
 * - Absorbed dose (Gy, rd — dimension E·M⁻¹) and equivalent dose (Sv, rem —
 *   SAME dimension vector) are semantically distinct kinds. Dimensional
 *   math alone cannot tell them apart; the kind layer can.
 *
 * Symbol note: the legacy absorbed-dose unit "rad" collides with the
 * radian ("rad", far more common in formula contexts), so it is registered
 * here as "rd" with alias "rad_dose". This is documented, not silent.
 *
 * Factors:
 * - 1 Ci = 3.7×10¹⁰ Bq exact (conventional definition).
 * - 1 Gy = 1 J/kg; engine energy base is Mcal, mass base is kg, so the
 *   factor chains off the existing J/Mcal constant (single source of truth
 *   via the same 0.239006/10^6 ratio used by the SI pack).
 * - 1 rd (dose-rad) = 0.01 Gy exact; 1 rem = 0.01 Sv exact.
 * - Time factors use the engine day base (1 s = 1/86400 day).
 * -----------------------------------------------------------------------
 */
import { defineDimension } from "../dimension.js";
import { ATOMIC_UNITS } from "../units/atomic-units.js";
import type { AtomicUnitDef } from "../units/atomic-units.js";
import type { UnitPack } from "../unit-system.js";

const SECOND_PER_DAY = (() => {
  const def = ATOMIC_UNITS.find((d) => d.symbol === "s");
  if (!def) throw new Error('RADIATION pack: expected atomic unit "s" in ATOMIC_UNITS');
  return def.toBaseFactor;
})();

// 1 Bq = 1 decay/s = 86400 decays/day (engine T base is the day)
const BQ_PER_BASE = 1 / SECOND_PER_DAY;
// 1 Ci = 3.7e10 Bq exact
const CI_PER_BASE = 3.7e10 * BQ_PER_BASE;

// 1 Gy = 1 J/kg; J = 0.239006/10^6 Mcal (chained off the MJ constant)
const JOULE_PER_MCAL = 0.239006 / 1000000;
const GY_PER_BASE = JOULE_PER_MCAL;
// Dose dimension: energy per mass
const DOSE_DIM = defineDimension({ E: 1, M: -1 });

export const RADIATION_PACK: UnitPack = Object.freeze({
  name: "radiation",
  version: "1.0.0",
  displayName: "Radioactivity and radiation-dose units",
  description:
    "Activity (Bq, Ci) and dose (Gy, rd, Sv, rem) units with explicit " +
    "semantic kinds. No medical dosimetry logic — units and dimensions only.",
  units: Object.freeze([
    {
      symbol: "Bq",
      dimension: defineDimension({ T: -1 }),
      toBaseFactor: BQ_PER_BASE,
      label: "becquerel",
      metadata: {
        prefixable: true,
        system: "SI",
        standard: "SI",
        category: "activity",
        kind: "activity",
      },
    } as AtomicUnitDef,
    {
      symbol: "Ci",
      dimension: defineDimension({ T: -1 }),
      toBaseFactor: CI_PER_BASE,
      label: "curie",
      metadata: { system: "general", category: "activity", kind: "activity" },
    } as AtomicUnitDef,
    {
      symbol: "Gy",
      dimension: DOSE_DIM,
      toBaseFactor: GY_PER_BASE,
      label: "gray",
      metadata: {
        prefixable: true,
        system: "SI",
        standard: "SI",
        category: "absorbed dose",
        kind: "absorbed-dose",
      },
    } as AtomicUnitDef,
    {
      symbol: "rd",
      dimension: DOSE_DIM,
      toBaseFactor: GY_PER_BASE / 100, // exact: 1 rd = 0.01 Gy
      label: "rad (radiation absorbed dose)",
      metadata: { system: "general", category: "absorbed dose", kind: "absorbed-dose" },
    } as AtomicUnitDef,
    {
      symbol: "Sv",
      dimension: DOSE_DIM,
      toBaseFactor: GY_PER_BASE, // same scale as Gy, DIFFERENT kind
      label: "sievert",
      metadata: {
        prefixable: true,
        system: "SI",
        standard: "SI",
        category: "equivalent dose",
        kind: "equivalent-dose",
      },
    } as AtomicUnitDef,
    {
      symbol: "rem",
      dimension: DOSE_DIM,
      toBaseFactor: GY_PER_BASE / 100, // exact: 1 rem = 0.01 Sv
      label: "rem",
      metadata: { system: "general", category: "equivalent dose", kind: "equivalent-dose" },
    } as AtomicUnitDef,
  ]),
  aliases: Object.freeze({
    becquerel: "Bq",
    curie: "Ci",
    gray: "Gy",
    rad_dose: "rd",
    sievert: "Sv",
  } as Record<string, string>),
  metadata: Object.freeze({
    standard: "SI + conventional",
    source: "SI Brochure (Bq, Gy, Sv); 1 Ci = 3.7e10 Bq exact (conventional)",
  }),
});
