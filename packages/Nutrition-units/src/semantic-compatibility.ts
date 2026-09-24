/**
 * semantic-compatibility.ts — Phase 7: explicit semantic compatibility model.
 *
 * Physical compatibility is handled by @vetwo/units.
 * Nutrition semantic compatibility is handled here.
 * A conversion is allowed only when BOTH layers permit it.
 */

import { defaultNutrientKindRegistry, type NutrientKindRegistry } from "./nutrient-kind.js";
import {
  IncompatibleNutrientError,
  UnknownNutrientError,
  AmbiguousNutrientError,
  UnsupportedSemanticConversionError,
} from "./errors.js";

export type SemanticMode = "strict" | "permissive";
export type CompatibilityStatus = "compatible" | "incompatible" | "unknown" | "ambiguous";

export interface CompatibilityResult {
  readonly status: CompatibilityStatus;
  readonly mode: SemanticMode;
  readonly nutrientA: string;
  readonly nutrientB: string;
  readonly reason?: string;
  readonly isCompatible: boolean;
}

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

function resolveNutrient(
  id: string,
  registry: NutrientKindRegistry,
): { found: boolean; canonical?: string; ambiguous?: boolean } {
  if (!id || typeof id !== "string") return { found: false };
  const lower = normalizeId(id);
  if (registry.has(lower)) {
    const canonical = registry.resolve(lower);
    return { found: true, canonical };
  }
  return { found: false };
}

export function checkNutrientCompatibility(
  a: string,
  b: string,
  opts: { mode?: SemanticMode; registry?: NutrientKindRegistry } = {},
): CompatibilityResult {
  const mode = opts.mode ?? "strict";
  const registry = opts.registry ?? defaultNutrientKindRegistry;
  const nutrientA = a ?? "";
  const nutrientB = b ?? "";

  // Unknown handling
  const resA = resolveNutrient(nutrientA, registry);
  const resB = resolveNutrient(nutrientB, registry);

  const unknownA = !resA.found;
  const unknownB = !resB.found;

  if (mode === "permissive" && (unknownA || unknownB)) {
    return {
      status: "unknown",
      mode,
      nutrientA,
      nutrientB,
      reason:
        unknownA && unknownB
          ? "both nutrients unknown"
          : unknownA
            ? `unknown nutrient "${nutrientA}"`
            : `unknown nutrient "${nutrientB}"`,
      isCompatible: false,
    };
  }

  if (unknownA || unknownB) {
    return {
      status: "unknown",
      mode,
      nutrientA,
      nutrientB,
      reason: unknownA ? `unknown nutrient "${nutrientA}"` : `unknown nutrient "${nutrientB}"`,
      isCompatible: false,
    };
  }

  // Both known — check canonical equality (alias-aware)
  const canonicalA = resA.canonical!;
  const canonicalB = resB.canonical!;

  if (canonicalA === canonicalB) {
    return {
      status: "compatible",
      mode,
      nutrientA,
      nutrientB,
      reason: `same canonical nutrient "${canonicalA}"`,
      isCompatible: true,
    };
  }

  // Different nutrients — check family membership is NOT equivalence
  const kindA = registry.require(nutrientA);
  const kindB = registry.require(nutrientB);
  const sameFamily = kindA.family && kindB.family && kindA.family === kindB.family;
  const reason = sameFamily
    ? `different nutrients "${canonicalA}" vs "${canonicalB}" (same family "${kindA.family}" but not interchangeable)`
    : `incompatible nutrients "${canonicalA}" vs "${canonicalB}"`;

  return {
    status: "incompatible",
    mode,
    nutrientA,
    nutrientB,
    reason,
    isCompatible: false,
  };
}

export function isNutrientCompatible(
  a: string,
  b: string,
  opts: { mode?: SemanticMode; registry?: NutrientKindRegistry } = {},
): boolean {
  return checkNutrientCompatibility(a, b, opts).isCompatible;
}

export function assertNutrientCompatible(
  a: string,
  b: string,
  opts: { mode?: SemanticMode; registry?: NutrientKindRegistry } = {},
): void {
  const result = checkNutrientCompatibility(a, b, opts);
  if (!result.isCompatible) {
    if (result.status === "unknown")
      throw new UnknownNutrientError(result.nutrientA, result.reason);
    if (result.status === "ambiguous")
      throw new AmbiguousNutrientError(result.nutrientA, result.reason);
    throw new IncompatibleNutrientError(result.nutrientA, result.nutrientB, result.reason);
  }
}

export function assertSemanticCompatibility(
  a: string,
  b: string,
  opts: { mode?: SemanticMode; registry?: NutrientKindRegistry } = {},
): void {
  assertNutrientCompatible(a, b, opts);
}

// Convenience for unit+semantic combined check

export function canConvert(
  fromNutrient: string,
  toNutrient: string,
  opts: { mode?: SemanticMode; registry?: NutrientKindRegistry } = {},
): CompatibilityResult {
  return checkNutrientCompatibility(fromNutrient, toNutrient, opts);
}

export function assertCanConvert(
  fromNutrient: string,
  toNutrient: string,
  opts: { mode?: SemanticMode; registry?: NutrientKindRegistry } = {},
): void {
  const result = canConvert(fromNutrient, toNutrient, opts);
  if (!result.isCompatible) {
    throw new UnsupportedSemanticConversionError(fromNutrient, toNutrient, result.reason);
  }
}
