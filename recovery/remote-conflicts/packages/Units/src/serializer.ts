/**
 * serializer.ts — Single responsibility: (de)serialize Units and Quantities
 * to/from plain JSON-safe declarative data.
 *
 * Design:
 * - Explicit versioned schema (version:1), deterministic key order.
 * - No private fields, Maps, caches, prototypes, or functions are serialized.
 * - Unit is serialized as its canonical expression string (e.g. "kg", "kg·m/s²",
 *   "mg/kg", "%"), which is sufficient to reconstruct via UnitRegistry + PrefixRegistry.
 *   Custom units require the receiving registry to have the same definition;
 *   otherwise deserialization throws UnsupportedUnitError (policy 2).
 * - Quantity value special numbers (NaN/Infinity/-Infinity/-0) are encoded as
 *   strings to survive JSON, decoded on the other side.
 * - Validation is strict: shape, types, version, numeric values, unit strings
 *   are all checked. Prototype pollution keys (__proto__/constructor/prototype)
 *   are rejected before any object spread.
 * - Deterministic: equivalent objects serialize to byte-identical JSON when
 *   stringified with stable key order.
 * -----------------------------------------------------------------------
 */
import { Quantity } from "./quantity.js";
import type { Unit } from "./unit.js";
import { parseUnit } from "./unit-parser.js";
import { defaultUnitRegistry, type UnitRegistry } from "./unit-registry.js";
import { InvalidUnitError, UnitEngineError } from "./errors/index.js";

// ---------------------------------------------------------------------------
// Types — public serialization schema (v1)
// ---------------------------------------------------------------------------

export interface SerializedUnit {
  version: 1;
  type: "unit";
  expression: string;
}

export interface SerializedQuantity {
  version: 1;
  type: "quantity";
  value: number | string; // string for NaN/Infinity/-Infinity/-0
  unit: string; // unit expression string
  /**
   * Semantic kind id, present only when the quantity claims one (Phase 22).
   * Explicit field — never inferred from display strings. Must be registered
   * and dimension-compatible with the resolved unit on deserialization.
   */
  kind?: string;
}

/** Legacy shape without version/type, kept for backward compat. */
export interface LegacySerializedQuantity {
  value: number;
  unit: string;
}

// ---------------------------------------------------------------------------
// Special number encoding (deterministic, JSON-safe)
// ---------------------------------------------------------------------------

function encodeValue(v: number): number | string {
  if (Number.isNaN(v)) return "NaN";
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  if (Object.is(v, -0)) return "-0";
  return v;
}

function decodeValue(v: unknown): number {
  if (typeof v === "number") {
    return v;
  }
  if (typeof v === "string") {
    if (v === "NaN") return NaN;
    if (v === "Infinity") return Infinity;
    if (v === "-Infinity") return -Infinity;
    if (v === "-0") return -0;
    // Numeric string is not allowed — value must be number or special string
    throw new InvalidUnitError(
      `Serialized value string must be one of "NaN"/"Infinity"/"-Infinity"/"-0", got "${v}"`,
    );
  }
  throw new InvalidUnitError(`Serialized value must be number or string, got ${typeof v}`);
}

// ---------------------------------------------------------------------------
// Helpers: plain object checks, pollution guards
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasPollutionKeys(obj: Record<string, unknown>): boolean {
  // Use hasOwn to avoid prototype chain, check own properties only
  return (
    Object.prototype.hasOwnProperty.call(obj, "__proto__") ||
    Object.prototype.hasOwnProperty.call(obj, "constructor") ||
    Object.prototype.hasOwnProperty.call(obj, "prototype")
  );
}

// ---------------------------------------------------------------------------
// Unit serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a Unit to a versioned declarative form.
 * The expression is the unit's canonical symbol (e.g. "kg", "kg·m/s²").
 * Basis, if present, is appended as " DM" / " asFed" for backward compat.
 */
export function serializeUnit(unit: Unit): SerializedUnit {
  // Explicit key order for determinism: version, type, expression
  const expr = unit.basis ? `${unit.symbol} ${unit.basis}` : unit.symbol;
  return {
    version: 1,
    type: "unit",
    expression: expr,
  };
}

/**
 * Deserialize a Unit from its serialized form.
 * Validates shape, version, and that the expression can be resolved via registry.
 */
export function deserializeUnit(data: unknown, registry: UnitRegistry = defaultUnitRegistry): Unit {
  if (!isPlainObject(data)) {
    throw new InvalidUnitError(
      `Serialized unit must be a plain object, got ${data === null ? "null" : typeof data}`,
    );
  }
  if (hasPollutionKeys(data)) {
    throw new InvalidUnitError("Serialized unit contains forbidden prototype keys");
  }
  if (Array.isArray(data)) {
    throw new InvalidUnitError("Serialized unit must not be an array");
  }
  // Extract fields explicitly (no spread of untrusted data)
  const version = (data as Record<string, unknown>).version;
  const type = (data as Record<string, unknown>).type;
  const expression = (data as Record<string, unknown>).expression;

  if (version !== 1) {
    if (version === undefined) throw new InvalidUnitError("Serialized unit missing version");
    throw new InvalidUnitError(`Unsupported serialized unit version ${String(version)}`);
  }
  if (type !== "unit") {
    throw new InvalidUnitError(`Serialized unit has wrong type "${String(type)}"`);
  }
  if (typeof expression !== "string" || expression.trim().length === 0) {
    throw new InvalidUnitError("Serialized unit expression must be a non-empty string");
  }
  // Use parseUnit to resolve (handles prefixes, aliases, composites)
  return parseUnit(expression, registry);
}

// ---------------------------------------------------------------------------
// Quantity serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a Quantity to a versioned declarative form.
 * `value` is encoded for special numbers (NaN/Infinity/-Infinity/-0).
 */
export function serializeQuantity(q: Quantity): SerializedQuantity {
  // Explicit ordering: version, type, value, unit, kind?
  const encoded = encodeValue(q.value);
  const unitStr = q.unit.basis ? `${q.unit.symbol} ${q.unit.basis}` : q.unit.symbol;
  const out: SerializedQuantity = {
    version: 1,
    type: "quantity",
    value: encoded,
    unit: unitStr,
  };
  if (q.kind !== undefined) (out as unknown as Record<string, unknown>).kind = q.kind;
  return out;
}

/** Legacy helper: serialize to old {value, unit} shape (for migration). */
export function serializeQuantityLegacy(q: Quantity): LegacySerializedQuantity {
  return {
    value: q.value,
    unit: q.unit.basis ? `${q.unit.symbol} ${q.unit.basis}` : q.unit.symbol,
  };
}

/**
 * Deserialize a Quantity from its serialized form.
 * Accepts both new versioned shape and legacy {value, unit} for backward compat.
 * Validates shape, version, types, and unit resolution.
 */
export function deserializeQuantity(
  data: unknown,
  registry: UnitRegistry = defaultUnitRegistry,
): Quantity {
  if (!isPlainObject(data)) {
    throw new InvalidUnitError(
      `Serialized quantity must be a plain object, got ${data === null ? "null" : typeof data}`,
    );
  }
  if (hasPollutionKeys(data as Record<string, unknown>)) {
    throw new InvalidUnitError("Serialized quantity contains forbidden prototype keys");
  }
  if (Array.isArray(data)) {
    throw new InvalidUnitError("Serialized quantity must not be an array");
  }

  const raw = data as Record<string, unknown>;

  // Legacy path: no version/type, just {value, unit}
  if (raw.version === undefined && raw.type === undefined) {
    const legacyValue = raw.value;
    const legacyUnit = raw.unit;
    if (typeof legacyValue !== "number") {
      throw new InvalidUnitError(
        `Legacy serialized quantity value must be number, got ${typeof legacyValue}`,
      );
    }
    if (typeof legacyUnit !== "string" || legacyUnit.trim().length === 0) {
      throw new InvalidUnitError("Legacy serialized quantity unit must be non-empty string");
    }
    if (!Number.isFinite(legacyValue) && !Number.isNaN(legacyValue)) {
      // Legacy allowed Infinity? It would be number Infinity in JSON? JSON can't have Infinity, but JS object could.
      // We allow it but it would have been serialized as number Infinity, which JSON.stringify would turn to null.
      // For backward compat, allow it as is.
    }
    return Quantity.of(legacyValue, legacyUnit, registry);
  }

  // Versioned path
  const version = raw.version;
  const type = raw.type;
  const valueRaw = raw.value;
  const unitRaw = raw.unit;

  if (version !== 1) {
    if (version === undefined) throw new InvalidUnitError("Serialized quantity missing version");
    throw new InvalidUnitError(`Unsupported serialized quantity version ${String(version)}`);
  }
  if (type !== "quantity") {
    throw new InvalidUnitError(`Serialized quantity has wrong type "${String(type)}"`);
  }
  if (typeof unitRaw !== "string" || unitRaw.trim().length === 0) {
    throw new InvalidUnitError("Serialized quantity unit must be a non-empty string");
  }
  // value can be number or special string
  if (typeof valueRaw !== "number" && typeof valueRaw !== "string") {
    throw new InvalidUnitError(
      `Serialized quantity value must be number or string, got ${typeof valueRaw}`,
    );
  }
  // Validate string value is only allowed special encodings
  if (typeof valueRaw === "string" && !["NaN", "Infinity", "-Infinity", "-0"].includes(valueRaw)) {
    throw new InvalidUnitError(
      `Serialized quantity value string must be NaN/Infinity/-Infinity/-0, got "${valueRaw}"`,
    );
  }

  const decoded = decodeValue(valueRaw);
  // Validate decoded is a valid number (NaN/Infinity allowed per policy, but must be number type)
  if (typeof decoded !== "number") {
    throw new InvalidUnitError("Decoded quantity value is not a number");
  }

  const quantity = Quantity.of(decoded, unitRaw, registry);
  // Optional semantic kind: explicit field only, validated against the
  // registry and the resolved unit's dimension (never inferred from text).
  const kindRaw = raw.kind;
  if (kindRaw === undefined) return quantity;
  if (typeof kindRaw !== "string" || kindRaw.trim().length === 0) {
    throw new InvalidUnitError("Serialized quantity kind must be a non-empty string");
  }
  return quantity.withKind(kindRaw);
}

// ---------------------------------------------------------------------------
// Extra typed error for serialization version mismatch (subclass)
// ---------------------------------------------------------------------------

export class SerializationError extends UnitEngineError {
  constructor(message: string) {
    super(message);
  }
}
