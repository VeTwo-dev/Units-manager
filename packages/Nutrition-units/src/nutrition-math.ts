/**
 * nutrition-math.ts
 * -----------------------------------------------------------------------
 * Single responsibility: the ONE public facade the rest of the feed
 * formulation application calls for nutrient math. No file outside this
 * package (and no file outside the unit-engine) should ever multiply,
 * divide, or convert a nutrient value manually.
 *
 *   NutritionMath.calculate(feedAmount, nutrientConcentration, "cp")
 *
 * replaces every hand-written:
 *   cp / 100 * kg
 *   ca / 100 * 1000
 *   mg / 1000
 * -----------------------------------------------------------------------
 */
import {
  Quantity,
  defaultCalculationRuleRegistry,
  type CalculationRuleRegistry,
} from "@vetwo/units";
import { NUTRIENT_CONTRIBUTION_RULE, DIET_COST_RULE } from "./nutrition-rules.js";
import {
  defaultTargetUnitRegistry,
  type TargetUnitRegistry,
  type NutrientKey,
} from "./target-unit-registry.js";

export class NutritionMath {
  constructor(
    private readonly rules: CalculationRuleRegistry = defaultCalculationRuleRegistry,
    private readonly targetUnits: TargetUnitRegistry = defaultTargetUnitRegistry,
  ) {}

  /**
   * Compute a nutrient's contribution from a feed inclusion amount and the
   * feed's nutrient concentration, automatically normalized to that
   * nutrient's canonical reporting unit (g/day, mg/day, IU/day, Mcal/day...).
   */
  calculate(
    feedIntake: Quantity,
    nutrientConcentration: Quantity,
    nutrientKey: NutrientKey,
  ): Quantity {
    const raw = this.rules.run(NUTRIENT_CONTRIBUTION_RULE, feedIntake, nutrientConcentration);
    const targetUnit = this.targetUnits.getTargetUnit(nutrientKey);
    return raw.to(targetUnit);
  }

  /** Diet cost contribution from one feed: intake × price/kg -> currency/day. */
  calculateCost(feedIntake: Quantity, pricePerKg: Quantity): Quantity {
    const raw = this.rules.run(DIET_COST_RULE, feedIntake, pricePerKg);
    return raw.to(this.targetUnits.getTargetUnit("cost"));
  }

  /** Sum several nutrient contributions of the same nutrient across feeds. */
  sum(contributions: Quantity[]): Quantity {
    if (contributions.length === 0) throw new Error("sum() requires at least one quantity");
    return contributions.reduce((acc, q) => acc.add(q));
  }
}

export const nutritionMath = new NutritionMath();
