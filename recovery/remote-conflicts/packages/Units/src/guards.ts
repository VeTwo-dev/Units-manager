/**
 * guards.ts — Single responsibility: runtime type guards for engine types.
 * Guards are strict at trust boundaries (JSON input, API payloads) and
 * lightweight internally. Cross-realm safe: plain objects from other realms
 * (iframe, worker, VM) are validated structurally, not solely via instanceof.
 */
import { Quantity } from "./quantity.js";
import type { Unit } from "./unit.js";
import { dimensionsEqual, isDimensionless, type DimensionVector } from "./dimension.js";

// ---------------------------------------------------------------------------
// Helpers: plain object / pollution checks (local, no deps)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOwnPollutionKeys(obj: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(obj, "__proto__") ||
    Object.prototype.hasOwnProperty.call(obj, "constructor") ||
    Object.prototype.hasOwnProperty.call(obj, "prototype")
  );
}

// Brand symbol for internal Quantity/Unit branding (not exposed mutably)
const QUANTITY_BRAND = Symbol.for("@vetwo/units/Quantity");

// ---------------------------------------------------------------------------
// isQuantity — cross-realm safe (instanceof + structural fallback)
// ---------------------------------------------------------------------------

export function isQuantity(value: unknown): value is Quantity {
  if (value instanceof Quantity) return true;
  // Cross-realm fallback: structural check for plain object with Quantity shape
  if (!isPlainObject(value as Record<string, unknown>)) return false;
  // Avoid prototype pollution keys
  if (hasOwnPollutionKeys(value as Record<string, unknown>)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.value === "number" &&
    typeof v.unit === "object" &&
    v.unit !== null &&
    typeof (v.unit as Record<string, unknown>).symbol === "string" &&
    typeof (v.unit as Record<string, unknown>).dimension === "object" &&
    // Brand check if present (optional, not required for cross-realm)
    (QUANTITY_BRAND in (value as object) || true)
  );
}

// ---------------------------------------------------------------------------
// isUnit — structural + brand
// ---------------------------------------------------------------------------

export function isUnit(value: unknown): value is Unit {
  if (value === null || typeof value !== "object") return false;
  // Use hasOwn to avoid prototype pollution
  const obj = value as Record<string, unknown>;
  if (hasOwnPollutionKeys(obj)) return false;
  return (
    typeof obj.symbol === "string" &&
    typeof obj.dimension === "object" &&
    obj.dimension !== null &&
    typeof obj.toBaseFactor === "number" &&
    typeof obj.conversion === "object" &&
    obj.conversion !== null &&
    typeof (obj.conversion as Record<string, unknown>).kind === "string" &&
    typeof (obj.conversion as Record<string, unknown>).scale === "number"
  );
}

// ---------------------------------------------------------------------------
// isDimension — validates DimensionVector shape (plain object, integer exponents)
// ---------------------------------------------------------------------------

const DIMENSION_ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export function isDimension(value: unknown): value is DimensionVector {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (hasOwnPollutionKeys(obj)) return false;
  // Empty object is valid dimensionless
  for (const key of Object.keys(obj)) {
    if (!DIMENSION_ID_RE.test(key)) return false;
    const v = obj[key];
    if (typeof v !== "number" || !Number.isInteger(v)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// isSerializedQuantity / isSerializedUnit — validate serialized shapes
// ---------------------------------------------------------------------------

export function isSerializedQuantity(value: unknown): boolean {
  if (!isPlainObject(value as Record<string, unknown>)) return false;
  const obj = value as Record<string, unknown>;
  if (hasOwnPollutionKeys(obj)) return false;
  // Legacy shape: { value: number, unit: string } without version/type
  if (obj.version === undefined && obj.type === undefined) {
    return typeof obj.value === "number" && typeof obj.unit === "string";
  }
  // Versioned shape: string values only allowed for special encodings
  const isValidValue =
    typeof obj.value === "number" ||
    (typeof obj.value === "string" && ["NaN", "Infinity", "-Infinity", "-0"].includes(obj.value));
  return (
    obj.version === 1 &&
    obj.type === "quantity" &&
    isValidValue &&
    typeof obj.unit === "string" &&
    (obj.unit as string).trim().length > 0
  );
}

export function isSerializedUnit(value: unknown): boolean {
  if (!isPlainObject(value as Record<string, unknown>)) return false;
  const obj = value as Record<string, unknown>;
  if (hasOwnPollutionKeys(obj)) return false;
  return (
    obj.version === 1 &&
    obj.type === "unit" &&
    typeof obj.expression === "string" &&
    (obj.expression as string).trim().length > 0
  );
}

// ---------------------------------------------------------------------------
// Existing helpers (kept, now using correct dimension check)
// ---------------------------------------------------------------------------

export function isRatioUnit(unit: Unit): boolean {
  return isDimensionless(unit.dimension);
}

export function isSameDimension(a: DimensionVector, b: DimensionVector): boolean {
  return dimensionsEqual(a, b);
}

export function isMoneyQuantity(q: Quantity): boolean {
  return (q.unit.dimension.C ?? 0) !== 0 && Object.keys(q.unit.dimension).length === 1;
}

// ---------------------------------------------------------------------------
// isExpression / isSerializedExpression — structural, cross-realm safe
// ---------------------------------------------------------------------------

const EXPRESSION_KINDS = new Set([
  "literal",
  "variable",
  "add",
  "subtract",
  "multiply",
  "divide",
  "power",
  "convert",
]);

/** Structural guard for Expression AST nodes (frozen or plain, any realm). */
export function isExpression(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (hasOwnPollutionKeys(obj)) return false;
  return typeof obj.kind === "string" && EXPRESSION_KINDS.has(obj.kind);
}

/** Structural guard for versioned serialized expressions. */
export function isSerializedExpression(value: unknown): boolean {
  if (!isPlainObject(value as Record<string, unknown>)) return false;
  const obj = value as Record<string, unknown>;
  if (hasOwnPollutionKeys(obj)) return false;
  return obj.version === 1 && obj.type === "expression" && obj.root !== undefined;
}

// ---------------------------------------------------------------------------
// isMeasurement / isSerializedMeasurement — structural, cross-realm safe
// ---------------------------------------------------------------------------

/**
 * Structural guard for Measurement instances. Accepts live instances
 * (duck-typed, so cross-realm copies pass) — validates value/uncertainty
 * shapes without trusting prototypes.
 */
export function isMeasurement(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (hasOwnPollutionKeys(obj)) return false;
  if (typeof obj.value !== "object" || obj.value === null) return false;
  if (typeof obj.uncertainty !== "object" || obj.uncertainty === null) return false;
  const v = obj.value as Record<string, unknown>;
  const u = obj.uncertainty as Record<string, unknown>;
  if (hasOwnPollutionKeys(v) || hasOwnPollutionKeys(u)) return false;
  return (
    typeof v.value === "number" &&
    typeof v.unit === "object" &&
    v.unit !== null &&
    typeof u.value === "number" &&
    typeof u.unit === "object" &&
    u.unit !== null
  );
}

/** Re-exported kind-id shape guard (canonical definition lives in quantity-kind.ts). */
export { isQuantityKindId } from "./quantity-kind.js";

/** Structural guard for versioned serialized measurements. */
export function isSerializedMeasurement(value: unknown): boolean {
  if (!isPlainObject(value as Record<string, unknown>)) return false;
  const obj = value as Record<string, unknown>;
  if (hasOwnPollutionKeys(obj)) return false;
  if (obj.version !== 1 || obj.type !== "measurement") return false;
  if (!isPlainObject(obj.value) || !isPlainObject(obj.uncertainty)) return false;
  if (
    hasOwnPollutionKeys(obj.value as Record<string, unknown>) ||
    hasOwnPollutionKeys(obj.uncertainty as Record<string, unknown>)
  ) {
    return false;
  }
  return true;
}
