/**
 * target-unit-registry.ts
 * -----------------------------------------------------------------------
 * Single responsibility: map a NUTRIENT KEY (business concept, e.g. "cp",
 * "ca", "vitA") to the unit its calculated CONTRIBUTION should be reported
 * in. This is pure domain configuration data — zero calculation logic —
 * kept separate so nutritionists/product owners can change reporting
 * units without touching any math (SRP + Open/Closed).
 * -----------------------------------------------------------------------
 */
export type NutrientKey =
  | "cp"
  | "trueProtein"
  | "lys"
  | "methionine"
  | "metCys"
  | "ee"
  | "cf"
  | "ndf"
  | "adf"
  | "lignin"
  | "ash"
  | "starch"
  | "sugar"
  | "totalCarbohydrates"
  | "tdn"
  | "dryMatter"
  | "moisture"
  | "ca"
  | "p"
  | "availableP"
  | "mg"
  | "k"
  | "na"
  | "cl"
  | "s"
  | "fe"
  | "mn"
  | "cu"
  | "zn"
  | "co"
  | "i"
  | "se"
  | "mo"
  | "cr"
  | "vitA"
  | "vitD"
  | "vitE"
  | "vitK"
  | "vitC"
  | "vitB1"
  | "vitB2"
  | "vitB3"
  | "vitB5"
  | "vitB6"
  | "vitB7"
  | "vitB9"
  | "vitB12"
  | "ge"
  | "de"
  | "me"
  | "nel"
  | "nem"
  | "neg"
  | "cost";

const TARGET_UNITS: Record<NutrientKey, string> = {
  // macro / proximate nutrients contributed as grams/day (or % for dryMatter/moisture)
  cp: "g/day",
  trueProtein: "g/day",
  lys: "g/day",
  methionine: "g/day",
  metCys: "g/day",
  ee: "g/day",
  cf: "g/day",
  ndf: "g/day",
  adf: "g/day",
  lignin: "g/day",
  ash: "g/day",
  starch: "g/day",
  sugar: "g/day",
  totalCarbohydrates: "g/day",
  tdn: "g/day",
  dryMatter: "%",
  moisture: "%",

  // macro minerals as grams/day
  ca: "g/day",
  p: "g/day",
  availableP: "g/day",
  mg: "g/day",
  k: "g/day",
  na: "g/day",
  cl: "g/day",
  s: "g/day",

  // trace minerals as milligrams/day
  fe: "mg/day",
  mn: "mg/day",
  cu: "mg/day",
  zn: "mg/day",
  co: "mg/day",
  i: "mg/day",
  se: "mg/day",
  mo: "mg/day",
  cr: "mg/day",

  // vitamins — fat-soluble as IU/day, water-soluble as mg/day
  vitA: "IU/day",
  vitD: "IU/day",
  vitE: "IU/day",
  vitK: "IU/day",
  vitC: "mg/day",
  vitB1: "mg/day",
  vitB2: "mg/day",
  vitB3: "mg/day",
  vitB5: "mg/day",
  vitB6: "mg/day",
  vitB7: "mg/day",
  vitB9: "mg/day",
  vitB12: "mg/day",

  // energy
  ge: "Mcal/day",
  de: "Mcal/day",
  me: "Kcal/day",
  nel: "Mcal/day",
  nem: "Mcal/day",
  neg: "Mcal/day",

  // economics
  cost: "cur/day",
};

export class TargetUnitRegistry {
  private overrides = new Map<string, string>();

  getTargetUnit(nutrientKey: NutrientKey): string {
    return this.overrides.get(nutrientKey) ?? TARGET_UNITS[nutrientKey];
  }

  /** Allow a host app to override reporting units without forking the table. */
  override(nutrientKey: NutrientKey, unitSymbol: string): void {
    this.overrides.set(nutrientKey, unitSymbol);
  }
}

export const defaultTargetUnitRegistry = new TargetUnitRegistry();
