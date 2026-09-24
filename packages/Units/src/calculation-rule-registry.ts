/**
 * calculation-rule-registry.ts
 * -----------------------------------------------------------------------
 * Single responsibility: a generic, keyed registry of DOMAIN calculation
 * rules layered on top of Quantity math.
 *
 * The core engine deliberately does NOT know what "crude protein" or
 * "molarity" or "present value" means. Those are domain concepts. A
 * domain package (nutrition-engine, chemistry-engine, finance-engine...)
 * registers named rules here; application code resolves rules by key
 * instead of hard-coding formulas inline.
 *
 * This is the "Formula Registry" / "Coefficient Resolver" extension point
 * requested in the spec, implemented generically so it is reusable outside
 * feed formulation.
 * -----------------------------------------------------------------------
 */
import type { Quantity } from "./quantity.js";
import { RuleNotFoundError } from "./errors/index.js";

export type CalculationRule = (...inputs: Quantity[]) => Quantity;

export class CalculationRuleRegistry {
  private rules = new Map<string, CalculationRule>();

  register(key: string, rule: CalculationRule): void {
    this.rules.set(key, rule);
  }

  has(key: string): boolean {
    return this.rules.has(key);
  }

  resolve(key: string): CalculationRule {
    const rule = this.rules.get(key);
    if (!rule) throw new RuleNotFoundError(key);
    return rule;
  }

  run(key: string, ...inputs: Quantity[]): Quantity {
    return this.resolve(key)(...inputs);
  }

  listKeys(): string[] {
    return [...this.rules.keys()];
  }
}

export const defaultCalculationRuleRegistry = new CalculationRuleRegistry();
