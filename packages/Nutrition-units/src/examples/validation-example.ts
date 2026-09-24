/**
 * examples/validation-example.ts
 * -----------------------------------------------------------------------
 * Demonstrates how the Validation Engine leans on Quantity's dimensional
 * safety instead of writing manual range checks against raw numbers of
 * unknown unit.
 * -----------------------------------------------------------------------
 */
import { Quantity, DimensionError } from "@vetwo/units";

export interface RangeCheckResult {
  ok: boolean;
  message?: string;
}

/**
 * Validates that `value` (any nutrient contribution) sits within
 * [min, max]. All three MUST share a dimension — Quantity.to() will throw
 * ImpossibleConversionError/DimensionError automatically if, say, someone
 * accidentally compares a Mcal/day requirement against a g/day value,
 * catching data-entry bugs at validation time instead of producing a
 * silently wrong diet.
 */
export function validateRange(value: Quantity, min: Quantity, max: Quantity): RangeCheckResult {
  if (!value.hasSameDimension(min) || !value.hasSameDimension(max)) {
    throw new DimensionError(min.unit.symbol, value.unit.symbol);
  }
  const v = value.toBase().value;
  const lo = min.toBase().value;
  const hi = max.toBase().value;
  if (v < lo)
    return { ok: false, message: `${value.toString()} is below minimum ${min.toString()}` };
  if (v > hi)
    return { ok: false, message: `${value.toString()} exceeds maximum ${max.toString()}` };
  return { ok: true };
}
