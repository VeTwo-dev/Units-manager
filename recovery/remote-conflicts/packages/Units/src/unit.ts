/**
 * unit.ts
 * -----------------------------------------------------------------------
 * Single responsibility: the Unit value object. A Unit is either atomic
 * ("kg") or composite ("Mcal/kg"), always carries its resolved dimension
 * and its conversion definition to the base/canonical unit of that
 * dimension, plus optional metadata (basis tag, name, aliases).
 *
 * A Unit describes the MEASUREMENT SYSTEM; a Quantity describes a
 * NUMERIC VALUE + Unit. These concepts are strictly separate.
 *
 * Immutability: once constructed, every field is frozen. If you need a
 * modified unit, create a new one.
 * -----------------------------------------------------------------------
 */
import {
  DIMENSIONLESS,
  dimensionKey,
  dimensionsEqual,
  isDimensionless,
  type DimensionVector,
} from "./dimension.js";
import { InvalidUnitError } from "./errors/index.js";

export type Basis = "asFed" | "DM" | undefined;

// ---------------------------------------------------------------------------
// Conversion definition
// ---------------------------------------------------------------------------

/**
 * Describes how a unit's numerical value maps to/from the canonical base
 * representation of its dimension.
 *
 * - Linear:      base = value × scale           (offset === 0, the common case)
 * - Affine:      base = value × scale + offset  (e.g. temperature)
 * - Logarithmic: value = factor × log(value / reference) — DECLARED ONLY.
 *   The conversion engine rejects logarithmic units explicitly
 *   (UnsupportedTransformationError): dB/pH/Richter-style quantities need
 *   a reference/context model that `value × factor` cannot represent, and
 *   faking them as linear would be silently wrong. See docs.
 * - Custom:      `{ id }` names a caller-provided transformation. The core
 *   engine holds no handlers and rejects custom units explicitly; a host
 *   application may resolve the id through its own registry before calling
 *   the engine. Registration data stays declarative (no functions).
 *
 * The `kind` discriminant lets the conversion engine branch efficiently.
 */
export interface LinearConversion {
  readonly kind: "linear";
  readonly scale: number;
}

export interface AffineConversion {
  readonly kind: "affine";
  readonly scale: number;
  readonly offset: number;
}

/**
 * Logarithmic conversion declaration (extension point, Phase 21.27/21.29).
 * `value = factor × log10(level / reference)` (factor 10 for power-like,
 * 20 for field-like quantities). Declared here so packs stay declarative;
 * the engine rejects it explicitly until a reference-context model exists.
 */
export interface LogarithmicConversion {
  readonly kind: "logarithmic";
  /** Reference level the logarithm is taken against (must be finite, non-zero). */
  readonly reference: number;
  /** Multiplicative factor in front of the logarithm (10 or 20 by convention). */
  readonly factor: number;
}

/**
 * Custom conversion declaration (extension point, Phase 21.29).
 * `id` names a host-provided transformation; the core engine holds no
 * handlers and rejects custom units explicitly.
 */
export interface CustomConversion {
  readonly kind: "custom";
  /** Caller-defined transformation id (non-empty string, no code). */
  readonly id: string;
}

export type ConversionDef =
  LinearConversion | AffineConversion | LogarithmicConversion | CustomConversion;

/** Conversion kinds the engine can execute numerically. */
export type ExecutableConversionKind = "linear" | "affine";

// ---------------------------------------------------------------------------
// Unit metadata (clean extension point — no nutrition/domain concepts)
// ---------------------------------------------------------------------------

/**
 * Optional metadata attached to a Unit. Designed for future extensibility:
 * unit system, category, deprecation, prefixability, documentation.
 *
 * Do NOT add domain-specific metadata here.
 */
export interface UnitMetadata {
  /** Unit system (e.g. "SI", "CGS", "Imperial"). */
  readonly system?: string;
  /**
   * Standard the definition follows (e.g. "SI", "SI accepted").
   * Concise identifier only — never embedded standard text.
   */
  readonly standard?: string;
  /** Category (e.g. "mass", "time", "temperature"). */
  readonly category?: string;
  /**
   * Semantic quantity kind id (Phase 22, e.g. "angle", "activity").
   * References a kind registered in the QuantityKindRegistry — data only,
   * never behavior. Absent means "no semantic claim" (generic quantity).
   */
  readonly kind?: string;
  /** Whether this unit can accept SI/metric prefixes. */
  readonly prefixable?: boolean;
  /** Deprecation notice, if any. */
  readonly deprecated?: string;
  /** Free-form documentation string. */
  readonly docs?: string;
}

// ---------------------------------------------------------------------------
// Unit interface
// ---------------------------------------------------------------------------

export interface Unit {
  /** Canonical identity string (deterministic, stable). Defaults to symbol. */
  readonly id: string;
  /** Display symbol, e.g. "kg", "°C", "Mcal/day". */
  readonly symbol: string;
  /** Human-readable name, e.g. "kilogram", "degree Celsius". */
  readonly name: string;
  /** Alternative symbols that resolve to this same unit (e.g. "kilogram" → "kg"). */
  readonly aliases: readonly string[];
  /** The dimension this unit measures. */
  readonly dimension: DimensionVector;
  /**
   * Conversion definition: how to convert a value in this unit to the
   * canonical base value of its dimension.
   */
  readonly conversion: ConversionDef;
  /**
   * Backward-compatible shortcut: multiply a value in this unit by this
   * factor to get the base-unit value. Equals `conversion.scale` for
   * linear conversions. For affine conversions this is the scale factor
   * only — prefer using `conversion` directly. NaN for logarithmic/custom
   * conversions (no linear scale exists; the engine rejects them first).
   */
  readonly toBaseFactor: number;
  /** Optional reporting basis (dry-matter vs as-fed) — metadata only. */
  readonly basis?: Basis;
  /** Human-readable label, for formatting/reporting. */
  readonly label?: string;
  /** Optional extensible metadata. */
  readonly metadata?: UnitMetadata;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface MakeUnitOptions {
  readonly id?: string;
  readonly symbol: string;
  readonly name?: string;
  readonly aliases?: readonly string[];
  readonly dimension: DimensionVector;
  readonly conversion?: ConversionDef;
  readonly toBaseFactor?: number;
  readonly basis?: Basis;
  readonly label?: string;
  readonly metadata?: UnitMetadata;
}

/**
 * Build a frozen Unit. Infers `conversion` from `toBaseFactor` if not
 * provided (backward-compatible default). Infers `id` from `symbol` and
 * `name` from `label` if not provided.
 */
export function makeUnit(opts: MakeUnitOptions): Unit {
  if (!opts.symbol || typeof opts.symbol !== "string" || opts.symbol.trim().length === 0) {
    throw new InvalidUnitError("Unit symbol must be a non-empty string");
  }
  if (!opts.dimension || typeof opts.dimension !== "object") {
    throw new InvalidUnitError("Unit dimension is required");
  }
  const symbol = opts.symbol;
  const id = opts.id ?? symbol;
  const name = opts.name ?? opts.label ?? symbol;
  const aliases = Object.freeze([...(opts.aliases ?? [])]);

  // Determine conversion definition
  let conversion: ConversionDef;
  if (opts.conversion !== undefined) {
    validateConversionDef(opts.conversion);
    conversion = opts.conversion;
  } else if (opts.toBaseFactor !== undefined) {
    if (!Number.isFinite(opts.toBaseFactor) || opts.toBaseFactor === 0) {
      throw new InvalidUnitError(
        `toBaseFactor must be a finite non-zero number, got ${opts.toBaseFactor}`,
      );
    }
    conversion = { kind: "linear", scale: opts.toBaseFactor };
  } else {
    conversion = { kind: "linear", scale: 1 };
  }

  // Backward-compatible toBaseFactor: the scale component for
  // linear/affine conversions. Logarithmic/custom conversions have no
  // linear scale — NaN marks "not convertible by the numeric engine"
  // (every numeric path rejects such units explicitly before reading it).
  const toBaseFactor =
    conversion.kind === "linear" || conversion.kind === "affine" ? conversion.scale : NaN;

  return Object.freeze({
    id,
    symbol,
    name,
    aliases,
    dimension: opts.dimension,
    conversion: Object.freeze({ ...conversion } as ConversionDef),
    toBaseFactor,
    basis: opts.basis,
    label: opts.label,
    metadata: opts.metadata ? Object.freeze({ ...opts.metadata }) : undefined,
  });
}

function validateConversionDef(conv: ConversionDef): void {
  if (
    conv.kind !== "linear" &&
    conv.kind !== "affine" &&
    conv.kind !== "logarithmic" &&
    conv.kind !== "custom"
  ) {
    throw new InvalidUnitError(
      `Invalid conversion kind: ${(conv as unknown as { kind: string }).kind}`,
    );
  }
  if (conv.kind === "logarithmic") {
    if (!Number.isFinite(conv.reference) || conv.reference === 0) {
      throw new InvalidUnitError(
        `Logarithmic conversion reference must be a finite non-zero number, got ${conv.reference}`,
      );
    }
    if (!Number.isFinite(conv.factor) || conv.factor === 0) {
      throw new InvalidUnitError(
        `Logarithmic conversion factor must be a finite non-zero number, got ${conv.factor}`,
      );
    }
    return;
  }
  if (conv.kind === "custom") {
    if (typeof conv.id !== "string" || conv.id.trim().length === 0) {
      throw new InvalidUnitError("Custom conversion id must be a non-empty string");
    }
    return;
  }
  if (!Number.isFinite(conv.scale) || conv.scale === 0) {
    throw new InvalidUnitError(
      `Conversion scale must be a finite non-zero number, got ${conv.scale}`,
    );
  }
  if (conv.kind === "affine" && !Number.isFinite(conv.offset)) {
    throw new InvalidUnitError(`Conversion offset must be a finite number, got ${conv.offset}`);
  }
}

// ---------------------------------------------------------------------------
// Unit queries
// ---------------------------------------------------------------------------

/**
 * Two units are "the same unit" if their id + basis match.
 * Used for caching/equality in the registry and parser.
 */
export function unitKey(u: Unit): string {
  return u.basis ? `${u.id}|${u.basis}` : u.id;
}

/** Check if two units are the same unit (same id + basis). */
export function unitsEqual(a: Unit, b: Unit): boolean {
  return unitKey(a) === unitKey(b);
}

/** Check if two units are dimensionally compatible. */
export function unitsCompatible(a: Unit, b: Unit): boolean {
  return dimensionsEqual(a.dimension, b.dimension);
}

/**
 * Deterministic canonical semantic key for a unit: dimension + conversion
 * + basis. Equivalent units (same dimension, same scale/offset, same basis)
 * produce identical keys regardless of symbol, registry or process run —
 * suitable for Map keys, caches, snapshots and serialization comparisons.
 *
 * Note on floating point: scales render with shortest round-trip notation,
 * which is deterministic per IEEE-754. Units computed through different
 * arithmetic paths (e.g. a registered "N" vs parsed "kg·m/s²") agree
 * bitwise on this platform, but cross-path equivalence should still be
 * asserted with tolerance — the key is exact, not approximate.
 */
export function canonicalUnitKey(u: Unit): string {
  const c = u.conversion;
  const basis = u.basis ? `|${u.basis}` : "";
  if (c.kind === "logarithmic") {
    return `${dimensionKey(u.dimension)}|logarithmic:${c.reference}:${c.factor}${basis}`;
  }
  if (c.kind === "custom") {
    return `${dimensionKey(u.dimension)}|custom:${c.id}${basis}`;
  }
  const offset = c.kind === "affine" ? `+${c.offset}` : "";
  return `${dimensionKey(u.dimension)}|${c.kind}:${c.scale}${offset}${basis}`;
}

/**
 * Explicit deprecation check. Returns the deprecation notice when the unit
 * carries `metadata.deprecated`, otherwise undefined. This is the sanctioned
 * mechanism for flagging deprecated units — nothing warns automatically on
 * the hot path (no console noise during parse/convert/format).
 */
export function getDeprecationNotice(u: Unit): string | undefined {
  return u.metadata?.deprecated;
}

/**
 * Returns true if the conversion is affine (has a non-zero offset).
 * Affine units require special handling in conversion.
 */
export function isAffineUnit(u: Unit): boolean {
  return u.conversion.kind === "affine" && u.conversion.offset !== 0;
}

/**
 * Returns true if the unit is an absolute temperature (K, °C, °F, °R).
 * Absolute temperatures share zero at absolute zero and must not be
 * multiplied/divided/powered — only intervals (K with scale-only) are
 * meaningful for those operations. Checks both affine offset and
 * semantic kind metadata.
 */
export function isAbsoluteTemperatureUnit(u: Unit): boolean {
  return u.metadata?.kind === "temperature-absolute" || isAffineUnit(u);
}

/**
 * Returns true if the unit is dimensionless (mathematical identity,
 * not to be confused with semantic ratio/percentage). Determined
 * solely via its Dimension.
 */
export function isDimensionlessUnit(u: Unit): boolean {
  return isDimensionless(u.dimension);
}

/**
 * Canonical mathematical dimensionless unit (scale 1, symbol "1").
 * All dimensionless Quantities that are integer scale 1 can share this
 * identity; scaled dimensionless units like "%" (0.01) remain distinct
 * but share the same dimension. Avoids creating thousands of equivalent
 * dimensionless instances.
 */
export const DIMENSIONLESS_UNIT: Unit = makeUnit({
  symbol: "1",
  name: "dimensionless",
  dimension: DIMENSIONLESS,
  toBaseFactor: 1,
  label: "dimensionless",
});
