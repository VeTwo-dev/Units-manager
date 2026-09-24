/**
 * packs/scientific.ts
 * -----------------------------------------------------------------------
 * General scientific unit pack (data only, no side effects).
 *
 * Importing this module does NOT mutate any registry. Apply explicitly:
 *
 *   import { SCIENTIFIC_PACK } from "@vetwo/units";
 *   const registry = createRegistry({ packs: [SCIENTIFIC_PACK] });
 *
 * System-agnostic scientific units that belong to no single standard pack:
 * pressure (bar, atm, mmHg), energy (calorie, BTU), power (horsepower)
 * and time (week). Dimensions follow the engine model (E for energy,
 * M·L·T combinations for mechanical pressure); see the SI pack notes.
 *
 * All factors are exact definitional values with derivation comments.
 * -----------------------------------------------------------------------
 */
import { defineDimension, Dim } from "../dimension.js";
import type { AtomicUnitDef } from "../units/atomic-units.js";
import type { UnitPack } from "../unit-system.js";

// 1 N = 86400² kg·m/day² (engine day base); 1 bar = 10^5 Pa exactly
const NEWTON_PER_BASE = 86400 * 86400;
const BAR_PER_BASE = 100000 * NEWTON_PER_BASE;

// Exact: 1 atm = 101325 Pa
const ATM_PER_BASE = 101325 * NEWTON_PER_BASE;

// Exact: 1 mmHg = 133.322387415 Pa
const MMHG_PER_BASE = 133.322387415 * NEWTON_PER_BASE;

// Energy chains off the existing MJ constant via the SI joule definition:
// 1 cal (thermochemical) = 4.184 J exactly; 1 BTU (IT) = 1055.05585262 J.
const JOULE_PER_MCAL = 0.239006 / 1000000;
const CAL_PER_MCAL = 4.184 * JOULE_PER_MCAL;
const BTU_PER_MCAL = 1055.05585262 * JOULE_PER_MCAL;

// BTU variants (Phase 21.31 — never silently collapsed):
// - BTU_IT (default "BTU"): International Steam Table, 1055.05585262 J exact (ISO 31-4).
// - BTU_th (thermochemical): 1054.35 J exact.
// - BTU_mean: ≈ 1055.87 J (mean of 0–100 °C range; approximate by nature).
const BTU_TH_PER_MCAL = 1054.35 * JOULE_PER_MCAL;
const BTU_MEAN_PER_MCAL = 1055.87 * JOULE_PER_MCAL;

// Exact: 1 mechanical hp = 745.69987158227022 W (550 ft·lbf/s), rounded to
// 14 significant digits (double precision holds ~15-16; error ~1e-14 relative).
// Prompt-18 fix: horsepower factors compose from WATT_PER_BASE (1 W = 1 J/s
// in base units), NOT from factor-1 watts — the old scale silently meant
// Mcal/day, understating every hp→W conversion by ~48.4×.
const SECOND_PER_DAY = 1 / 86400; // engine day base
const WATT_PER_BASE = JOULE_PER_MCAL / SECOND_PER_DAY;
const HP_PER_WATT = 745.69987158227 * WATT_PER_BASE;

// Horsepower variants (Phase 21.31):
// - hp (default): mechanical/imperial, 745.69987158227 W.
// - hp_metric (PS): 75 kgf·m/s = 735.49875 W exact.
// - hp_electric: 746 W exact (conventional electrical rating).
const HP_METRIC_PER_WATT = 735.49875 * WATT_PER_BASE;
const HP_ELECTRIC_PER_WATT = 746 * WATT_PER_BASE;

// Exact: 1 kgf = 9.80665 N (standard gravity gn = 9.80665 m/s², exact by
// CGPM definition); engine N base is 86400² kg·m/day².
const KGF_PER_BASE = 9.80665 * NEWTON_PER_BASE;

// Exact by construction: 1 inHg = 25.4 mmHg (1 in = 25.4 mm exactly).
const INHG_PER_BASE = 25.4 * MMHG_PER_BASE;

export const SCIENTIFIC_PACK: UnitPack = Object.freeze({
  name: "scientific",
  version: "1.0.0",
  displayName: "General scientific units",
  description:
    "System-agnostic pressure (bar, atm, mmHg), energy (cal, BTU), " +
    "power (hp) and time (week) units. No domain semantics.",
  units: Object.freeze([
    {
      symbol: "bar",
      dimension: defineDimension({ M: 1, L: -1, T: -2 }),
      toBaseFactor: BAR_PER_BASE,
      label: "bar",
      metadata: { prefixable: true, system: "general", category: "pressure" },
    } as AtomicUnitDef,
    {
      symbol: "atm",
      dimension: defineDimension({ M: 1, L: -1, T: -2 }),
      toBaseFactor: ATM_PER_BASE,
      label: "standard atmosphere",
      metadata: { system: "general", category: "pressure" },
    } as AtomicUnitDef,
    {
      symbol: "mmHg",
      dimension: defineDimension({ M: 1, L: -1, T: -2 }),
      toBaseFactor: MMHG_PER_BASE,
      label: "millimetre of mercury",
      metadata: { system: "general", category: "pressure" },
    } as AtomicUnitDef,
    {
      symbol: "inHg",
      dimension: defineDimension({ M: 1, L: -1, T: -2 }),
      toBaseFactor: INHG_PER_BASE,
      label: "inch of mercury",
      metadata: { system: "general", category: "pressure" },
    } as AtomicUnitDef,
    {
      symbol: "kgf",
      dimension: defineDimension({ M: 1, L: 1, T: -2 }),
      toBaseFactor: KGF_PER_BASE,
      label: "kilogram-force",
      metadata: { system: "general", category: "force" },
    } as AtomicUnitDef,
    {
      symbol: "cal",
      dimension: Dim.Energy,
      toBaseFactor: CAL_PER_MCAL,
      label: "calorie",
      metadata: { prefixable: true, system: "general", category: "energy" },
    } as AtomicUnitDef,
    {
      symbol: "BTU",
      dimension: Dim.Energy,
      toBaseFactor: BTU_PER_MCAL,
      label: "British thermal unit (International Steam Table)",
      metadata: { system: "general", category: "energy" },
    } as AtomicUnitDef,
    {
      symbol: "BTU_th",
      dimension: Dim.Energy,
      toBaseFactor: BTU_TH_PER_MCAL,
      label: "British thermal unit (thermochemical)",
      metadata: { system: "general", category: "energy" },
    } as AtomicUnitDef,
    {
      symbol: "BTU_mean",
      dimension: Dim.Energy,
      toBaseFactor: BTU_MEAN_PER_MCAL,
      label: "British thermal unit (mean, approximate)",
      metadata: { system: "general", category: "energy" },
    } as AtomicUnitDef,
    {
      symbol: "hp",
      dimension: defineDimension({ E: 1, T: -1 }),
      toBaseFactor: HP_PER_WATT,
      label: "horsepower (mechanical)",
      metadata: { system: "general", category: "power" },
    } as AtomicUnitDef,
    {
      symbol: "hp_metric",
      dimension: defineDimension({ E: 1, T: -1 }),
      toBaseFactor: HP_METRIC_PER_WATT,
      label: "metric horsepower (PS)",
      metadata: { system: "general", category: "power" },
    } as AtomicUnitDef,
    {
      symbol: "hp_electric",
      dimension: defineDimension({ E: 1, T: -1 }),
      toBaseFactor: HP_ELECTRIC_PER_WATT,
      label: "electric horsepower",
      metadata: { system: "general", category: "power" },
    } as AtomicUnitDef,
    {
      symbol: "week",
      dimension: Dim.Time,
      toBaseFactor: 7, // exact: 1 week = 7 days (engine time base)
      label: "week",
      metadata: { system: "general", category: "time" },
    } as AtomicUnitDef,
  ]),
  aliases: Object.freeze({
    atmosphere: "atm",
    calorie: "cal",
    BTU_IT: "BTU",
    horsepower: "hp",
  } as Record<string, string>),
  metadata: Object.freeze({
    standard: "general",
    source: "exact definitional values, see per-unit notes",
  }),
});
