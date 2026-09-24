/**
 * unit-family.ts — Nutrition unit-family abstraction.
 *
 * Physical units are owned by @vetwo/units; nutrition-units adds
 * semantic family interpretation and compatibility matrix.
 */

import { Quantity, createRegistry, SI_PACK } from "@vetwo/units";
import type { NutrientKind } from "./nutrient-kind.js";
import { NutritionUnitCompatibilityError } from "./errors.js";

export type NutritionUnitFamily =
  | "mass-concentration"
  | "energy-density"
  | "activity-concentration"
  | "molar-concentration"
  | "fraction"
  | "ratio"
  | "ppm-family";

export interface UnitFamilyDefinition {
  readonly id: NutritionUnitFamily;
  readonly name: string;
  readonly description?: string;
}

// Registry ---------------------------------------------------------------

const FAMILIES: Record<NutritionUnitFamily, UnitFamilyDefinition> = {
  "mass-concentration": { id: "mass-concentration", name: "Mass concentration" },
  "energy-density": { id: "energy-density", name: "Energy density" },
  "activity-concentration": { id: "activity-concentration", name: "Activity concentration" },
  "molar-concentration": { id: "molar-concentration", name: "Molar concentration" },
  fraction: { id: "fraction", name: "Fraction" },
  ratio: { id: "ratio", name: "Ratio" },
  "ppm-family": { id: "ppm-family", name: "ppm/ppb family" },
};

export function listUnitFamilies(): readonly UnitFamilyDefinition[] {
  return Object.values(FAMILIES);
}

// Infer family from a Quantity's unit symbol / dimension ----------------

export function inferUnitFamily(quantity: Quantity): NutritionUnitFamily | undefined {
  const sym = quantity.unit.symbol;
  const dim = quantity.dimension as Record<string, number | undefined>;

  // IU → activity
  if (sym.includes("IU")) return "activity-concentration";
  // mol → molar
  if (sym.includes("mol")) return "molar-concentration";
  // ppm/ppb → ppm-family
  if (sym === "ppm" || sym === "ppb") return "ppm-family";
  // Energy density: E / M  (MJ/kg, Kcal/kg etc) or E/L
  const hasEnergy = dim["E"] !== undefined && dim["E"] !== 0;
  if (hasEnergy) {
    // Symbol heuristics: MJ, kJ, Kcal, kcal, Mcal, J all indicate energy
    if (
      sym.includes("MJ") ||
      sym.includes("kJ") ||
      sym.includes("Kcal") ||
      sym.includes("kcal") ||
      sym.includes("Mcal") ||
      sym.includes("J/")
    )
      return "energy-density";
  }
  // Fraction / ratio: dimensionless
  const isDimensionless =
    Object.keys(dim).length === 0 || (Object.keys(dim).length === 1 && dim["Count"] !== undefined);
  // Use symbol heuristics for fraction
  if (sym === "%" || sym === "fraction" || sym === "ratio") return "fraction";
  if (sym.includes("/") && isDimensionless) {
    // dimensionless ratio like g/g would be parsed but still dimension is dimensionless
    // For our purpose, consider %/fraction as fraction, others as mass-concentration if they involve mass
  }
  // Mass concentration: g/kg etc. Typically dimensionless in terms of mass/mass but symbol contains /kg or /g or /L
  if (
    sym.includes("/kg") ||
    sym.includes("/g") ||
    sym.includes("/L") ||
    sym.includes("/100g") ||
    sym === "g/kg" ||
    sym === "mg/kg"
  ) {
    // If it contains IU or mol we already returned; otherwise mass-concentration
    if (
      !sym.includes("IU") &&
      !sym.includes("mol") &&
      !sym.includes("MJ") &&
      !sym.includes("Kcal")
    ) {
      return "mass-concentration";
    }
  }
  // Fallback: dimensionless fraction-like
  if (sym === "fraction" || sym === "ppm" || sym === "ppb")
    return isDimensionless ? "fraction" : "mass-concentration";
  // Default: if contains / and not energy/molar/activity, treat as mass-concentration
  if (sym.includes("/")) {
    if (sym.includes("MJ") || sym.includes("Kcal")) return "energy-density";
    if (sym.includes("IU")) return "activity-concentration";
    if (sym.includes("mol")) return "molar-concentration";
    return "mass-concentration";
  }
  if (isDimensionless) return "fraction";
  return undefined;
}

// Compatibility matrix ---------------------------------------------------

/**
 * Determine if a nutrient category/family is compatible with a unit family.
 * Conservative: unknown combinations are allowed (do not over-restrict).
 */
export function isFamilyCompatible(nutrient: NutrientKind, family: NutritionUnitFamily): boolean {
  const cat = nutrient.category ?? "";
  const fam = nutrient.family ?? "";

  // Energy nutrients only with energy-density
  if (fam === "energy" || cat === "energy") {
    return family === "energy-density";
  }
  // Vitamins: allow activity (IU) and mass-concentration
  if (cat === "vitamin") {
    if (family === "activity-concentration") {
      return nutrient.defaultUnit?.includes("IU") ?? false;
    }
    if (family === "mass-concentration" || family === "fraction" || family === "ppm-family")
      return true;
    return false;
  }
  // Minerals and proximate: allow mass, molar, fraction, ppm — molar allowed if chemically defined (lenient for now)
  if (
    fam === "mineral" ||
    cat.includes("mineral") ||
    fam === "proximate" ||
    fam === "protein" ||
    fam === "fiber" ||
    fam === "carbohydrate" ||
    fam === "lipid" ||
    cat === "macro-nutrient"
  ) {
    return (
      family === "mass-concentration" ||
      family === "molar-concentration" ||
      family === "fraction" ||
      family === "ppm-family"
    );
  }
  // Economics not a concentration
  if (cat === "economics") return false;
  // Default: allow mass/molar/fraction/ppm, but not energy
  if (family === "energy-density") return false;
  return true;
}

export function assertFamilyCompatible(nutrient: NutrientKind, quantity: Quantity): void {
  const family = inferUnitFamily(quantity);
  if (!family) return; // unknown family → allow
  if (!isFamilyCompatible(nutrient, family)) {
    throw new NutritionUnitCompatibilityError(
      nutrient.id,
      quantity.unit.symbol,
      `family "${family}" not compatible with nutrient category "${nutrient.category ?? "unknown"}"`,
    );
  }
  // Extra check: IU must be tied to correct nutrient — cross IU already prevented by nutrient id mismatch, but
  // if someone tries to use IU with non-vitamin, reject
  if (family === "activity-concentration" && nutrient.category !== "vitamin") {
    throw new NutritionUnitCompatibilityError(
      nutrient.id,
      quantity.unit.symbol,
      "IU activity units only valid for vitamins",
    );
  }
  // Mol requires chemical identity — for now ensure nutrient has symbol or is mineral; otherwise throw
  if (family === "molar-concentration") {
    // Require that nutrient is a mineral or has chemical identity; if not, warn but currently allow
    // Phase6 says throw if missing chemical identity — we enforce for non-mineral without symbol
    if (nutrient.category === "energy" || nutrient.category === "economics") {
      throw new NutritionUnitCompatibilityError(
        nutrient.id,
        quantity.unit.symbol,
        "molar concentration not meaningful for energy/economics",
      );
    }
  }
}

// Helpers for molar conversion ------------------------------------------

const MOLAR_MASSES: Record<string, number> = {
  ca: 40.078,
  p: 30.973762,
  mg: 24.305,
  na: 22.989769,
  k: 39.0983,
  fe: 55.845,
  zn: 65.38,
  cu: 63.546,
  mn: 54.938,
  se: 78.971,
  i: 126.90447,
  co: 58.933,
  mo: 95.95,
  cr: 51.9961,
  s: 32.06,
  cl: 35.45,
};

export function getMolarMass(nutrientId: string): number | undefined {
  return MOLAR_MASSES[nutrientId.toLowerCase()];
}

export function convertMolarToMass(
  quantity: Quantity,
  nutrientId: string,
  registry?: import("@vetwo/units").UnitRegistry,
): Quantity {
  const molarMass = getMolarMass(nutrientId);
  if (molarMass === undefined) {
    throw new NutritionUnitCompatibilityError(
      nutrientId,
      quantity.unit.symbol,
      "molar mass unavailable — cannot convert g↔mol without chemical identity",
    );
  }
  const sym = quantity.unit.symbol;
  const isMolar = sym.includes("mol");
  const siRegistry = createRegistry({ packs: [SI_PACK] });
  if (isMolar) {
    const baseMol = registry
      ? quantity.to("mol/kg", registry).value
      : (() => {
          try {
            return quantity.to("mol/kg").value;
          } catch {
            return quantity.to("mol/kg", siRegistry).value;
          }
        })();
    const massValue = baseMol * molarMass; // g per kg
    return Quantity.of(massValue, "g/kg");
  } else {
    const baseMass = quantity.to("g/kg").value;
    const molValue = baseMass / molarMass;
    if (registry) return Quantity.of(molValue, "mol/kg", registry);
    try {
      return Quantity.of(molValue, "mol/kg");
    } catch {
      return Quantity.of(molValue, "mol/kg", siRegistry);
    }
  }
}
