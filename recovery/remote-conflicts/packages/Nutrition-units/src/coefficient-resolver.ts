/**
 * coefficient-resolver.ts
 * -----------------------------------------------------------------------
 * Single responsibility: strip units away entirely and hand the LP Solver
 * PLAIN NUMBERS it can put straight into its constraint matrix.
 *
 * This is the hard boundary requested in the spec: "The LP Solver MUST
 * NEVER know anything about units." Everything upstream of this class
 * deals in Quantity objects; everything downstream (HiGHS) deals in
 * `number`.
 * -----------------------------------------------------------------------
 */
import { Quantity } from "@vetwo/units";
import { NutritionMath, nutritionMath } from "./nutrition-math.js";
import type { NutrientKey } from "./target-unit-registry.js";

export class CoefficientResolver {
  constructor(private readonly math: NutritionMath = nutritionMath) {}

  /**
   * Per-unit-of-decision-variable coefficient for a constraint row.
   * e.g. "how many grams of CP does 1 kg of this feed contribute" —
   * exactly what a HiGHS constraint coefficient needs.
   */
  getCoefficient(
    feedUnitIntake: Quantity,
    nutrientConcentration: Quantity,
    nutrientKey: NutrientKey,
  ): number {
    const contribution = this.math.calculate(feedUnitIntake, nutrientConcentration, nutrientKey);
    if (!Number.isFinite(contribution.value)) {
      throw new Error(
        `CoefficientResolver.getCoefficient produced non-finite value ${contribution.value}`,
      );
    }
    return contribution.value;
  }

  /** Objective-function coefficient (cost per unit of decision variable). */
  getCostCoefficient(feedUnitIntake: Quantity, pricePerKg: Quantity): number {
    const v = this.math.calculateCost(feedUnitIntake, pricePerKg).value;
    if (!Number.isFinite(v))
      throw new Error(`CoefficientResolver.getCostCoefficient produced non-finite value ${v}`);
    return v;
  }

  /** Plain numeric bound, normalized to a target unit (e.g. a max-inclusion kg/day bound). */
  getBound(quantity: Quantity, targetUnit: string): number {
    const v = quantity.to(targetUnit).value;
    if (!Number.isFinite(v))
      throw new Error(`CoefficientResolver.getBound produced non-finite value ${v}`);
    return v;
  }
}

export const coefficientResolver = new CoefficientResolver();
