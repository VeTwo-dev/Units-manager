/**
 * testing.ts — Single responsibility: assertion helpers for unit tests of
 * any package built on top of the engine.
 */
import type { Quantity } from "./quantity.js";

export function assertQuantityClose(
  actual: Quantity,
  expected: Quantity,
  epsilon = 1e-6,
  message?: string,
): void {
  if (!actual.equals(expected, epsilon)) {
    throw new Error(
      message ??
        `Expected ${expected.toString()} but got ${actual.toString()} (epsilon=${epsilon})`,
    );
  }
}

export function approxEqual(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) <= epsilon;
}
