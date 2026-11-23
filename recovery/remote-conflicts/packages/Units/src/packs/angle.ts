/**
 * packs/angle.ts
 * -----------------------------------------------------------------------
 * Angle and solid-angle unit pack (data only, no side effects).
 *
 * Importing this module does NOT mutate any registry. Apply explicitly:
 *
 *   import { ANGLE_PACK } from "@vetwo/units";
 *   const registry = createRegistry({ packs: [ANGLE_PACK] });
 *
 * SI decision (21.9/21.10): angle is mathematically dimensionless, but
 * applications need angle-specific semantics — so every unit here carries
 * a semantic `kind` ("angle" / "solid-angle", see quantity-kind.ts) while
 * keeping the dimensionless dimension. Dimensional math stays correct
 * (rad + fraction is dimensionally legal); semantic-aware callers can
 * additionally require the kind (e.g. trig via requireKind("angle")).
 *
 * Factors (exact by definition):
 * - 1 revolution = 2π rad; 1° = π/180 rad; 1′ = 1°/60; 1″ = 1′/60.
 * - 1 sr is dimensionless 1 (solid angle).
 * -----------------------------------------------------------------------
 */
import { DIMENSIONLESS } from "../dimension.js";
import type { AtomicUnitDef } from "../units/atomic-units.js";
import type { UnitPack } from "../unit-system.js";

const DEG_PER_RAD = Math.PI / 180; // exact definitional relation
const ARCMIN_PER_RAD = DEG_PER_RAD / 60;
const ARCSEC_PER_RAD = ARCMIN_PER_RAD / 60;
const REV_PER_RAD = 2 * Math.PI;

export const ANGLE_PACK: UnitPack = Object.freeze({
  name: "angle",
  version: "1.0.0",
  displayName: "Angle and solid-angle units",
  description:
    "Plane-angle (rad, deg, arcmin, arcsec, rev) and solid-angle (sr) units. " +
    "Dimensionless per SI with explicit semantic kinds for opt-in safety.",
  units: Object.freeze([
    {
      symbol: "rad",
      dimension: DIMENSIONLESS,
      toBaseFactor: 1,
      label: "radian",
      metadata: { system: "SI", standard: "SI", category: "plane angle", kind: "angle" },
    } as AtomicUnitDef,
    {
      symbol: "deg",
      dimension: DIMENSIONLESS,
      toBaseFactor: DEG_PER_RAD,
      label: "degree",
      metadata: { system: "SI", standard: "SI accepted", category: "plane angle", kind: "angle" },
    } as AtomicUnitDef,
    {
      symbol: "arcmin",
      dimension: DIMENSIONLESS,
      toBaseFactor: ARCMIN_PER_RAD,
      label: "arcminute",
      metadata: { system: "general", category: "plane angle", kind: "angle" },
    } as AtomicUnitDef,
    {
      symbol: "arcsec",
      dimension: DIMENSIONLESS,
      toBaseFactor: ARCSEC_PER_RAD,
      label: "arcsecond",
      metadata: { system: "general", category: "plane angle", kind: "angle" },
    } as AtomicUnitDef,
    {
      symbol: "rev",
      dimension: DIMENSIONLESS,
      toBaseFactor: REV_PER_RAD,
      label: "revolution",
      metadata: { system: "general", category: "plane angle", kind: "angle" },
    } as AtomicUnitDef,
    {
      symbol: "sr",
      dimension: DIMENSIONLESS,
      toBaseFactor: 1,
      label: "steradian",
      metadata: {
        system: "SI",
        standard: "SI",
        category: "solid angle",
        kind: "solid-angle",
      },
    } as AtomicUnitDef,
  ]),
  aliases: Object.freeze({
    radian: "rad",
    degree: "deg",
    revolution: "rev",
    turn: "rev",
    steradian: "sr",
  } as Record<string, string>),
  metadata: Object.freeze({ standard: "SI", source: "SI Brochure (BIPM), 9th edition" }),
});
