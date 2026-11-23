/**
 * nutrition-rules.ts
 * -----------------------------------------------------------------------
 * Single responsibility: register nutrition-specific calculation rules
 * into the generic CalculationRuleRegistry from unit-engine.
 *
 * Notice these rules do NOT contain manual division/multiplication by
 * magic numbers (no "/100", no "*1000"). They simply call `Quantity`
 * dimensional-analysis operations and then normalize the result to the
 * nutrient's registered reporting unit. All the "% means /100" or
 * "mg/kg means ppm" knowledge already lives once, inside the core engine's
 * unit-parser/atomic-units — this file only expresses NUTRITION business
 * meaning: "a nutrient contribution = feed intake × nutrient concentration,
 * reported in this nutrient's canonical unit".
 * -----------------------------------------------------------------------
 */
import {
  Quantity,
  defaultCalculationRuleRegistry,
  type CalculationRuleRegistry,
} from "@vetwo/units";
import { defaultTargetUnitRegistry, type TargetUnitRegistry } from "./target-unit-registry.js";

export const NUTRIENT_CONTRIBUTION_RULE = "nutrition.nutrientContribution";
export const DIET_COST_RULE = "nutrition.dietCost";

export function registerNutritionRules(
  registry: CalculationRuleRegistry = defaultCalculationRuleRegistry,
  _targetUnits: TargetUnitRegistry = defaultTargetUnitRegistry,
): void {
  /**
   * inputs: [feedIntake: Quantity (mass or mass/day), nutrientConcentration: Quantity]
   * This single generic rule covers CP%, Ca%, mg/kg trace minerals,
   * Mcal/kg energy, IU/kg vitamins — because Quantity.multiply() already
   * performs correct dimensional analysis for every one of those cases.
   */
  registry.register(NUTRIENT_CONTRIBUTION_RULE, (...inputs: Quantity[]) => {
    const feedIntake = inputs[0];
    const nutrientConcentration = inputs[1];
    if (!feedIntake || !nutrientConcentration) {
      throw new Error(
        `${NUTRIENT_CONTRIBUTION_RULE} expects [feedIntake, nutrientConcentration], received ${inputs.length} input(s)`,
      );
    }
    return feedIntake.multiply(nutrientConcentration);
  });

  /** inputs: [feedIntake, pricePerKg] -> cost/day */
  registry.register(DIET_COST_RULE, (...inputs: Quantity[]) => {
    const feedIntake = inputs[0];
    const pricePerKg = inputs[1];
    if (!feedIntake || !pricePerKg) {
      throw new Error(
        `${DIET_COST_RULE} expects [feedIntake, pricePerKg], received ${inputs.length} input(s)`,
      );
    }
    return feedIntake.multiply(pricePerKg);
  });
}
