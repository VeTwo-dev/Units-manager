/**
 * packs/si.ts
 * -----------------------------------------------------------------------
 * SI supplementary + derived unit pack (data only, no side effects).
 *
 * Importing this module does NOT mutate any registry. Apply explicitly:
 *
 *   import { SI_PACK } from "@vetwo/units";
 *   const registry = createRegistry({ packs: [SI_PACK] });
 *
 * Contents:
 * - SI base units missing from core: ampere (A), mole (mol), candela (cd)
 * - SI derived units with special names: lumen (lm), lux (lx),
 *   newton (N), pascal (Pa), joule (J), watt-hour (Wh)
 * - Units accepted for use with SI (BIPM): tonne (t), litre (L),
 *   nautical mile (nmi)
 *
 * Conversion model notes (no faking):
 * - Energy units (J, Wh) use the engine's E dimension, consistent with the
 *   existing Mcal/MJ/kJ units. Mechanical N/Pa use M·L·T combinations.
 * - Energy factors chain off the existing MJ constant (0.239006 Mcal/MJ):
 *   J = MJ/1e6, cal-relations exact (4.184), Wh = 3600·J. This keeps
 *   MJ↔J↔Wh round trips internally consistent.
 * - N/Pa factors are exact integers: 1 N = 1 kg·m/s² = 86400² kg·m/day²
 *   because the engine's canonical time base is the day (1 s = 1/86400 day).
 * -----------------------------------------------------------------------
 */
import { defineDimension, Dim } from "../dimension.js";
import { ATOMIC_UNITS } from "../units/atomic-units.js";
import type { AtomicUnitDef } from "../units/atomic-units.js";
import type { UnitPack } from "../unit-system.js";

/** Look up an existing atomic factor so derived packs stay consistent by construction. */
function atomicFactor(symbol: string): number {
  const def = ATOMIC_UNITS.find((d) => d.symbol === symbol);
  if (!def) throw new Error(`SI pack: expected atomic unit "${symbol}" in ATOMIC_UNITS`);
  return def.toBaseFactor;
}

const MJ_PER_MCAL = atomicFactor("MJ"); // 0.239006 Mcal per MJ (single source of truth)
const JOULE_PER_MCAL = MJ_PER_MCAL / 1e6; // 1 J = 10^-6 MJ, exact power-of-ten step
const SECOND_PER_DAY = atomicFactor("s"); // 1/86400 day per second
const NEWTON_PER_BASE = 1 / SECOND_PER_DAY ** 2; // 1 N = 1 kg·m/s² = 86400² kg·m/day² (exact integer)
// Prompt-18 fix: 1 W = 1 J/s compositionally in (Mcal, day) base units —
// NEVER factor 1 (that silently meant 1 Mcal/day ≈ 48.4 MW). Every electric
// unit below composes from WATT_PER_BASE, JOULE_PER_MCAL and SECOND_PER_DAY
// so cross-clique conversions (V ≡ J/(A·s), Ω ≡ V/A, …) hold by construction.
const WATT_PER_BASE = JOULE_PER_MCAL / SECOND_PER_DAY;
const VOLT_PER_BASE = WATT_PER_BASE; // 1 V = 1 W/A, A-base factor 1

/** Shared energy factor: 1 Wh = 3600 J, exact. */
const WATTHOUR_PER_MCAL = 3600 * JOULE_PER_MCAL;

export const SI_BASE_EXTRA_UNITS: readonly AtomicUnitDef[] = Object.freeze([
  {
    symbol: "A",
    dimension: Dim.Current,
    toBaseFactor: 1,
    label: "ampere",
    metadata: { prefixable: true, system: "SI", standard: "SI", category: "electric current" },
  },
  {
    symbol: "mol",
    dimension: Dim.Substance,
    toBaseFactor: 1,
    label: "mole",
    metadata: { prefixable: true, system: "SI", standard: "SI", category: "amount of substance" },
  },
  {
    symbol: "cd",
    dimension: Dim.LuminousIntensity,
    toBaseFactor: 1,
    label: "candela",
    metadata: {
      system: "SI",
      standard: "SI",
      category: "luminous intensity",
      kind: "luminous-intensity",
    },
  },
  {
    symbol: "lm",
    dimension: Dim.LuminousIntensity,
    toBaseFactor: 1, // 1 lm = 1 cd·sr; steradian is dimensionless, so factor 1
    label: "lumen",
    metadata: {
      system: "SI",
      standard: "SI",
      category: "luminous flux",
      kind: "luminous-flux",
    },
  },
  {
    symbol: "lx",
    dimension: defineDimension({ J: 1, L: -2 }),
    toBaseFactor: 1, // 1 lx = 1 lm/m²; base length is m, so factor 1
    label: "lux",
    metadata: { system: "SI", standard: "SI", category: "illuminance", kind: "illuminance" },
  },
]);

export const SI_DERIVED_UNITS: readonly AtomicUnitDef[] = Object.freeze([
  {
    symbol: "N",
    dimension: defineDimension({ M: 1, L: 1, T: -2 }),
    toBaseFactor: NEWTON_PER_BASE, // 7464960000, exact integer
    label: "newton",
    metadata: { prefixable: true, system: "SI", standard: "SI", category: "force" },
  },
  {
    symbol: "Pa",
    dimension: defineDimension({ M: 1, L: -1, T: -2 }),
    toBaseFactor: NEWTON_PER_BASE, // 1 Pa = 1 N/m²; base length is m, so same factor
    label: "pascal",
    metadata: { prefixable: true, system: "SI", standard: "SI", category: "pressure" },
  },
  {
    symbol: "J",
    dimension: Dim.Energy,
    toBaseFactor: JOULE_PER_MCAL,
    label: "joule",
    metadata: { prefixable: true, system: "SI", standard: "SI", category: "energy" },
  },
  {
    symbol: "Wh",
    dimension: Dim.Energy,
    toBaseFactor: WATTHOUR_PER_MCAL,
    label: "watt-hour",
    metadata: { prefixable: true, system: "SI", standard: "SI", category: "energy" },
  },
  // ---- Electric units -------------------------------------------------
  // With A as the I-base (factor 1); every factor below composes from
  // WATT_PER_BASE, JOULE_PER_MCAL and SECOND_PER_DAY so that
  // V ≡ J/(A·s), Ω ≡ V/A, S ≡ A/V, F ≡ C/V, Wb ≡ V·s hold by construction.
  {
    symbol: "V",
    dimension: defineDimension({ E: 1, T: -1, I: -1 }),
    toBaseFactor: VOLT_PER_BASE, // 1 V = 1 W/A; A-base factor 1
    label: "volt",
    metadata: { prefixable: true, system: "SI", standard: "SI", category: "voltage" },
  },
  {
    symbol: "Ω",
    dimension: defineDimension({ E: 1, T: -1, I: -2 }),
    toBaseFactor: VOLT_PER_BASE, // 1 Ω = 1 V/A; A-base factor 1
    label: "ohm",
    metadata: { prefixable: true, system: "SI", standard: "SI", category: "resistance" },
  },
  {
    symbol: "C",
    dimension: defineDimension({ I: 1, T: 1 }),
    toBaseFactor: SECOND_PER_DAY, // 1 C = 1 A·s = 1/86400 A·day
    label: "coulomb",
    metadata: { prefixable: true, system: "SI", standard: "SI", category: "charge" },
  },
  {
    symbol: "F",
    dimension: defineDimension({ E: -1, T: 2, I: 2 }),
    toBaseFactor: SECOND_PER_DAY / VOLT_PER_BASE, // 1 F = 1 C/V
    label: "farad",
    metadata: { prefixable: true, system: "SI", standard: "SI", category: "capacitance" },
  },
  {
    symbol: "Wb",
    dimension: defineDimension({ E: 1, I: -1 }),
    toBaseFactor: VOLT_PER_BASE * SECOND_PER_DAY, // 1 Wb = 1 V·s
    label: "weber",
    metadata: { prefixable: true, system: "SI", standard: "SI", category: "magnetic flux" },
  },
  {
    symbol: "T",
    dimension: defineDimension({ E: 1, I: -1, L: -2 }),
    toBaseFactor: VOLT_PER_BASE * SECOND_PER_DAY, // 1 T = 1 Wb/m²; base length m
    label: "tesla",
    metadata: { prefixable: true, system: "SI", standard: "SI", category: "magnetic flux density" },
  },
  {
    symbol: "H",
    dimension: defineDimension({ E: 1, I: -2 }),
    toBaseFactor: VOLT_PER_BASE * SECOND_PER_DAY, // 1 H = 1 Wb/A; A-base factor 1
    label: "henry",
    metadata: { prefixable: true, system: "SI", standard: "SI", category: "inductance" },
  },
  {
    symbol: "S",
    dimension: defineDimension({ E: -1, T: 1, I: 2 }),
    toBaseFactor: 1 / VOLT_PER_BASE, // 1 S = 1 A/V; A-base factor 1
    label: "siemens",
    metadata: { prefixable: true, system: "SI", standard: "SI", category: "conductance" },
  },
]);

export const SI_ACCEPTED_UNITS: readonly AtomicUnitDef[] = Object.freeze([
  {
    symbol: "tonne",
    dimension: Dim.Mass,
    toBaseFactor: 1000, // exact: 1 t = 1000 kg
    label: "tonne",
    metadata: { system: "SI", standard: "SI accepted", category: "mass" },
  },
  {
    symbol: "L",
    dimension: defineDimension({ L: 3 }),
    toBaseFactor: 0.001, // exact: 1 L = 10^-3 m³
    label: "litre",
    metadata: { prefixable: true, system: "SI", standard: "SI accepted", category: "volume" },
  },
  {
    symbol: "nmi",
    dimension: Dim.Length,
    toBaseFactor: 1852, // exact: 1 nmi = 1852 m (international agreement)
    label: "nautical mile",
    metadata: { system: "SI", standard: "SI accepted", category: "length" },
  },
  {
    symbol: "ha",
    dimension: defineDimension({ L: 2 }),
    toBaseFactor: 10000, // exact: 1 ha = 10^4 m² (accepted for use with SI)
    label: "hectare",
    metadata: { system: "SI", standard: "SI accepted", category: "area" },
  },
]);

/**
 * Full SI pack: base extras + derived + accepted units.
 * Versioned; changing any factor/symbol/dimension is a breaking change.
 */
export const SI_PACK: UnitPack = Object.freeze({
  name: "si",
  version: "1.0.0",
  displayName: "SI supplementary, derived and accepted units",
  description:
    "SI base units missing from core (A, mol, cd), derived units with special names " +
    "(lm, lx, N, Pa, J, Wh, V, Ω, C, F, Wb, T, H, S) and BIPM-accepted units " +
    "(tonne, litre, nautical mile, hectare). " +
    "Apply explicitly via createRegistry({ packs: [SI_PACK] }).",
  units: Object.freeze([...SI_BASE_EXTRA_UNITS, ...SI_DERIVED_UNITS, ...SI_ACCEPTED_UNITS]),
  aliases: Object.freeze({
    ampere: "A",
    mole: "mol",
    candela: "cd",
    lumen: "lm",
    lux: "lx",
    newton: "N",
    pascal: "Pa",
    joule: "J",
    volt: "V",
    ohm: "Ω",
    coulomb: "C",
    farad: "F",
    weber: "Wb",
    tesla: "T",
    henry: "H",
    siemens: "S",
    litre: "L",
    liter: "L",
    nauticalmile: "nmi",
    hectare: "ha",
  } as Record<string, string>),
  metadata: Object.freeze({ standard: "SI", source: "SI Brochure (BIPM), 9th edition" }),
});
