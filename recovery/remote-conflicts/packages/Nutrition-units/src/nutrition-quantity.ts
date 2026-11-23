/**
 * nutrition-quantity.ts — The nutrition-specific quantity abstraction.
 *
 *   NutritionQuantity = Quantity (physical) + NutrientKind (semantic) + Basis (context)
 *
 * Composition over inheritance: the underlying physical value is ALWAYS a
 * certified `Quantity` from @vetwo/units. No conversion algorithm is
 * duplicated; all unit math delegates to the core.
 */

import { Quantity, type Unit } from "@vetwo/units";
import { defaultBasisRegistry, type BasisRegistry, type BasisDefinition } from "./basis.js";
import {
  defaultNutrientKindRegistry,
  type NutrientKind,
  type NutrientKindRegistry,
} from "./nutrient-kind.js";
import {
  InvalidNutritionQuantityError,
  InvalidNutritionBasisError,
  MissingNutritionContextError,
  UnsupportedBasisConversionError,
  NutritionUnitCompatibilityError,
  IncompatibleNutrientError,
} from "./errors.js";
import {
  checkNutrientCompatibility,
  type SemanticMode,
  type CompatibilityResult,
} from "./semantic-compatibility.js";
import {
  createNutritionContext,
  resolveDryMatterFraction,
  type NutritionContext,
} from "./nutrition-context.js";
import { assertFamilyCompatible } from "./unit-family.js";

// ---------------------------------------------------------------------------
// NutritionQuantity
// ---------------------------------------------------------------------------

export interface NutritionQuantityOptions {
  readonly basisRegistry?: BasisRegistry;
  readonly kindRegistry?: NutrientKindRegistry;
}

export class NutritionQuantity {
  /** Physical value — always a core Quantity. */
  readonly quantity: Quantity;
  /** Semantic nutrient identity — independent of dimension. */
  readonly nutrient: NutrientKind;
  /** Composition context/basis. */
  readonly basis: BasisDefinition;
  /** Optional free-form metadata (frozen). */
  readonly metadata?: Readonly<Record<string, unknown>>;

  private constructor(
    quantity: Quantity,
    nutrient: NutrientKind,
    basis: BasisDefinition,
    metadata?: Readonly<Record<string, unknown>>,
  ) {
    this.quantity = quantity;
    this.nutrient = nutrient;
    this.basis = basis;
    if (metadata !== undefined) {
      this.metadata = Object.freeze({ ...metadata });
    }
    Object.freeze(this);
  }

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  static of(
    quantity: Quantity,
    nutrientId: string,
    basisId: string = "asFed",
    opts: NutritionQuantityOptions & { metadata?: Readonly<Record<string, unknown>> } = {},
  ): NutritionQuantity {
    if (!(quantity instanceof Quantity)) {
      throw new InvalidNutritionQuantityError(
        `quantity must be a Quantity, got ${typeof quantity}`,
      );
    }
    if (!Number.isFinite(quantity.value)) {
      throw new InvalidNutritionQuantityError(
        `quantity value must be finite, got ${String(quantity.value)}`,
      );
    }
    const kindRegistry = opts.kindRegistry ?? defaultNutrientKindRegistry;
    const basisRegistry = opts.basisRegistry ?? defaultBasisRegistry;
    const nutrient = kindRegistry.require(nutrientId);
    const basis = basisRegistry.require(basisId);
    // Validate that basis aligns with Quantity.unit.basis if present
    validateBasisMatchesUnit(basis, quantity.unit);
    // Semantic family validation — conservative, allows unknown families
    try {
      assertFamilyCompatible(nutrient, quantity);
    } catch (e) {
      if (e instanceof NutritionUnitCompatibilityError) throw e;
      // otherwise rethrow
      throw e;
    }
    if (opts.metadata !== undefined) {
      if (
        typeof opts.metadata !== "object" ||
        opts.metadata === null ||
        Array.isArray(opts.metadata)
      ) {
        throw new InvalidNutritionQuantityError("metadata must be a plain object if provided");
      }
      const metaRecord = opts.metadata as Record<string, unknown>;
      if (
        Object.prototype.hasOwnProperty.call(metaRecord, "__proto__") ||
        Object.prototype.hasOwnProperty.call(metaRecord, "constructor") ||
        Object.prototype.hasOwnProperty.call(metaRecord, "prototype")
      ) {
        throw new InvalidNutritionQuantityError("forbidden keys in metadata");
      }
    }
    return new NutritionQuantity(quantity, nutrient, basis, opts.metadata);
  }

  /** Convenience: create from raw value + unit string + nutrient + basis. */
  static from(
    value: number,
    unitSymbol: string,
    nutrientId: string,
    basisId: string = "asFed",
    opts: NutritionQuantityOptions & { metadata?: Readonly<Record<string, unknown>> } = {},
  ): NutritionQuantity {
    return NutritionQuantity.of(Quantity.of(value, unitSymbol), nutrientId, basisId, opts);
  }

  // -----------------------------------------------------------------------
  // Conversion — physical via Quantity, semantic preserved
  // -----------------------------------------------------------------------

  /** Convert physical unit (same nutrient + basis preserved). */
  to(targetUnit: string | Unit): NutritionQuantity {
    const converted = this.quantity.to(targetUnit as string);
    // basis stays the same semantic basis; unitBasis tag on the new unit
    // must still align (e.g. asFed stays bare, DM stays DM-tagged if present)
    validateBasisMatchesUnit(this.basis, converted.unit);
    return new NutritionQuantity(converted, this.nutrient, this.basis, this.metadata);
  }

  /** Change basis context (requires DM% — delegates to BasisConverter logic). */
  withBasis(
    targetBasisId: string,
    dryMatterPercent?: Quantity,
    opts: NutritionQuantityOptions = {},
  ): NutritionQuantity {
    if (dryMatterPercent !== undefined) {
      // Legacy API: withBasis(target, Quantity%)
      return this.convertBasis(
        targetBasisId,
        { dryMatterFraction: dryMatterPercent.to("%").value / 100 },
        opts,
      );
    }
    throw new MissingNutritionContextError(targetBasisId);
  }

  /**
   * Explicit basis conversion via NutritionContext.
   * Preserves nutrient identity and validates context explicitly.
   */
  convertBasis(
    targetBasisId: string,
    context?: NutritionContext | { dryMatterFraction?: number; moistureFraction?: number },
    opts: NutritionQuantityOptions & { metadata?: Readonly<Record<string, unknown>> } = {},
  ): NutritionQuantity {
    const basisRegistry = opts.basisRegistry ?? defaultBasisRegistry;
    const targetBasis = basisRegistry.require(targetBasisId);
    if (this.basis.id === targetBasis.id) return this;
    if (
      !context ||
      (context.dryMatterFraction === undefined &&
        (context as NutritionContext).resolvedDryMatterFraction === undefined &&
        (context as { moistureFraction?: number }).moistureFraction === undefined)
    ) {
      throw new MissingNutritionContextError(targetBasisId);
    }
    // Normalize context: accept plain object or already frozen NutritionContext
    const ctx =
      (context as NutritionContext).resolvedDryMatterFraction !== undefined
        ? (context as NutritionContext)
        : createNutritionContext(context as never);
    const dmFraction = resolveDryMatterFraction(ctx);
    let newQuantity: Quantity;
    const from = this.basis.id;
    const to = targetBasis.id;

    // Supported conversions: asFed ↔ dryMatter, plus freshMatter/wet/normalized via DM logic
    const isDryLike = (id: string) => id === "drymatter";
    const isAsFedLike = (id: string) =>
      id === "asfed" || id === "freshmatter" || id === "wet" || id === "normalized";

    if (isDryLike(from) && isAsFedLike(to)) {
      newQuantity = this.quantity.scale(dmFraction);
      const targetSymbol = stripBasisTag(this.quantity.unit.symbol, this.basis);
      try {
        newQuantity = newQuantity.to(targetSymbol || this.quantity.unit.symbol);
      } catch {
        throw new UnsupportedBasisConversionError(
          from,
          to,
          `target unit "${targetSymbol}" not parseable`,
        );
      }
    } else if (isAsFedLike(from) && isDryLike(to)) {
      if (dmFraction === 0) throw new InvalidNutritionBasisError(targetBasisId, "dry matter is 0%");
      newQuantity = this.quantity.scale(1 / dmFraction);
      const targetSymbol = `${stripBasisTag(this.quantity.unit.symbol, this.basis)} DM`.trim();
      try {
        newQuantity = newQuantity.to(targetSymbol);
      } catch {
        throw new UnsupportedBasisConversionError(
          from,
          to,
          `target unit "${targetSymbol}" not parseable`,
        );
      }
    } else if (isAsFedLike(from) && isAsFedLike(to)) {
      // e.g., freshMatter → wet without DM change — identity if same family, else still needs DM? For now treat as no-op
      newQuantity = this.quantity;
    } else {
      throw new UnsupportedBasisConversionError(
        from,
        to,
        "only asFed/fresh/wet ↔ dryMatter supported",
      );
    }

    // Attach conversion traceability in metadata
    const traceMeta = {
      ...(this.metadata ?? {}),
      ...(opts.metadata ?? {}),
      conversion: {
        sourceBasis: this.basis.id,
        targetBasis: targetBasis.id,
        dryMatterFraction: dmFraction,
        conversionType: "basis-conversion",
      },
    };

    return new NutritionQuantity(newQuantity, this.nutrient, targetBasis, Object.freeze(traceMeta));
  }

  /**
   * Unified conversion pipeline: physical unit conversion + optional basis conversion.
   * Validates nutrient semantic, basis/context, unit family before delegating.
   */
  convert(
    targetUnit: string | Unit,
    targetBasisId?: string,
    context?: NutritionContext,
  ): NutritionQuantity {
    if (targetBasisId && targetBasisId !== this.basis.id) {
      if (!context) throw new MissingNutritionContextError(targetBasisId);
      const basisConverted = this.convertBasis(targetBasisId, context);
      return targetUnit ? basisConverted.to(targetUnit) : basisConverted;
    }
    return targetUnit ? this.to(targetUnit) : this;
  }

  // -----------------------------------------------------------------------
  // Semantic compatibility — explicit modes, no global state
  // -----------------------------------------------------------------------

  checkCompatibility(
    other: NutritionQuantity,
    opts: { mode?: SemanticMode } = {},
  ): CompatibilityResult {
    return checkNutrientCompatibility(this.nutrient.id, other.nutrient.id, {
      mode: opts.mode ?? "strict",
    });
  }

  isCompatibleWith(other: NutritionQuantity, opts: { mode?: SemanticMode } = {}): boolean {
    return this.checkCompatibility(other, opts).isCompatible;
  }

  canConvertTo(targetNutrientId: string, opts: { mode?: SemanticMode } = {}): CompatibilityResult {
    return checkNutrientCompatibility(this.nutrient.id, targetNutrientId, {
      mode: opts.mode ?? "strict",
    });
  }

  // -----------------------------------------------------------------------
  // Arithmetic — semantic-aware (strict by default, permissive explicitly)
  // -----------------------------------------------------------------------

  add(other: NutritionQuantity, opts: { mode?: SemanticMode } = {}): NutritionQuantity {
    assertSameNutrientAndBasis(this, other, "add", opts.mode);
    const result = this.quantity.add(other.quantity);
    return new NutritionQuantity(result, this.nutrient, this.basis, this.metadata);
  }

  subtract(other: NutritionQuantity, opts: { mode?: SemanticMode } = {}): NutritionQuantity {
    assertSameNutrientAndBasis(this, other, "subtract", opts.mode);
    const result = this.quantity.subtract(other.quantity);
    return new NutritionQuantity(result, this.nutrient, this.basis, this.metadata);
  }

  /** Scale by a dimensionless factor (preserves semantics). */
  scale(factor: number): NutritionQuantity {
    if (!Number.isFinite(factor)) {
      throw new InvalidNutritionQuantityError(`scale factor must be finite, got ${String(factor)}`);
    }
    return new NutritionQuantity(
      this.quantity.scale(factor),
      this.nutrient,
      this.basis,
      this.metadata,
    );
  }

  /** Comparison safety — respects semantic identity. */
  compare(other: NutritionQuantity, opts: { mode?: SemanticMode } = {}): number {
    assertSameNutrientAndBasis(this, other, "compare", opts.mode);
    // Use core Quantity comparison via base values
    const a = this.quantity.toBase().value;
    const b = other.quantity.toBase().value;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  // -----------------------------------------------------------------------
  // Comparison
  // -----------------------------------------------------------------------

  equals(other: NutritionQuantity, epsilon?: number): boolean {
    if (!(other instanceof NutritionQuantity)) return false;
    if (this.nutrient.id !== other.nutrient.id) return false;
    if (this.basis.id !== other.basis.id) return false;
    return this.quantity.equals(other.quantity, epsilon);
  }

  exactEquals(other: NutritionQuantity): boolean {
    if (!(other instanceof NutritionQuantity)) return false;
    if (this.nutrient.id !== other.nutrient.id) return false;
    if (this.basis.id !== other.basis.id) return false;
    return this.quantity.exactEquals(other.quantity);
  }

  // -----------------------------------------------------------------------
  // Formatting / serialization helpers
  // -----------------------------------------------------------------------

  toString(): string {
    const basisSuffix = this.basis.unitBasis ? ` ${this.basis.unitBasis}` : "";
    // quantity unit already may include basis tag; avoid duplication
    const qStr = this.quantity.toString();
    const needsBasis = this.basis.unitBasis && !qStr.includes(this.basis.unitBasis);
    return `${qStr}${needsBasis ? basisSuffix : ""} [${this.nutrient.id}]`;
  }

  toJSON(): SerializedNutritionQuantity {
    return serializeNutritionQuantity(this);
  }

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  static fromJSON(data: unknown, opts: NutritionQuantityOptions = {}): NutritionQuantity {
    return deserializeNutritionQuantity(data, opts);
  }
}

// ---------------------------------------------------------------------------
// Serialization (deterministic, versioned)
// ---------------------------------------------------------------------------

export interface SerializedNutritionQuantity {
  readonly version: 1;
  readonly type: "nutrition-quantity";
  readonly quantity: { value: number; unit: string };
  readonly nutrient: string;
  readonly basis: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function serializeNutritionQuantity(nq: NutritionQuantity): SerializedNutritionQuantity {
  if (!(nq instanceof NutritionQuantity)) {
    throw new InvalidNutritionQuantityError(
      "serializeNutritionQuantity expects a NutritionQuantity",
    );
  }
  const unitStr = nq.quantity.unit.basis
    ? `${nq.quantity.unit.symbol} ${nq.quantity.unit.basis}`
    : nq.quantity.unit.symbol;
  const result: SerializedNutritionQuantity = {
    version: 1,
    type: "nutrition-quantity",
    quantity: { value: nq.quantity.value, unit: unitStr },
    nutrient: nq.nutrient.id,
    basis: nq.basis.id,
  };
  if (nq.metadata !== undefined) {
    return { ...result, metadata: nq.metadata };
  }
  return result;
}

export function deserializeNutritionQuantity(
  data: unknown,
  opts: NutritionQuantityOptions = {},
): NutritionQuantity {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new InvalidNutritionQuantityError("serialized nutrition quantity must be a plain object");
  }
  const record = data as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(record, "__proto__") ||
    Object.prototype.hasOwnProperty.call(record, "constructor") ||
    Object.prototype.hasOwnProperty.call(record, "prototype")
  ) {
    throw new InvalidNutritionQuantityError("forbidden keys in serialized data");
  }
  if (record.version !== 1)
    throw new InvalidNutritionQuantityError(`unsupported version ${String(record.version)}`);
  if (record.type !== "nutrition-quantity")
    throw new InvalidNutritionQuantityError(`invalid type ${String(record.type)}`);
  const q = record.quantity as { value?: unknown; unit?: unknown } | undefined;
  if (
    !q ||
    typeof q.value !== "number" ||
    !Number.isFinite(q.value) ||
    typeof q.unit !== "string"
  ) {
    throw new InvalidNutritionQuantityError("invalid quantity field in serialized data");
  }
  if (typeof record.nutrient !== "string" || typeof record.basis !== "string") {
    throw new InvalidNutritionQuantityError("nutrient and basis must be strings");
  }
  const kindRegistry = opts.kindRegistry ?? defaultNutrientKindRegistry;
  const basisRegistry = opts.basisRegistry ?? defaultBasisRegistry;
  // Validate nutrient + basis exist
  kindRegistry.require(record.nutrient);
  basisRegistry.require(record.basis);
  // Validate metadata if present
  if (record.metadata !== undefined) {
    if (
      typeof record.metadata !== "object" ||
      record.metadata === null ||
      Array.isArray(record.metadata)
    ) {
      throw new InvalidNutritionQuantityError("metadata must be a plain object if provided");
    }
    const metaRecord = record.metadata as Record<string, unknown>;
    if (
      Object.prototype.hasOwnProperty.call(metaRecord, "__proto__") ||
      Object.prototype.hasOwnProperty.call(metaRecord, "constructor") ||
      Object.prototype.hasOwnProperty.call(metaRecord, "prototype")
    ) {
      throw new InvalidNutritionQuantityError("forbidden keys in metadata");
    }
  }
  const quantity = Quantity.of(q.value, q.unit);
  return NutritionQuantity.of(quantity, record.nutrient, record.basis, {
    kindRegistry,
    basisRegistry,
    metadata: record.metadata as Readonly<Record<string, unknown>> | undefined,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateBasisMatchesUnit(basis: BasisDefinition, unit: Unit): void {
  const expectedTag = basis.unitBasis;
  const actualTag = unit.basis;
  // Basis is semantic metadata separate from the unit's optional tag.
  // If the unit carries a basis tag, it must agree with the declared basis.
  // A bare unit (no tag) is accepted for any basis — the semantic context
  // is carried by NutritionQuantity.basis, not forced into the unit string.
  if (actualTag !== undefined && expectedTag !== undefined && actualTag !== expectedTag) {
    throw new InvalidNutritionBasisError(
      basis.id,
      `quantity unit basis "${actualTag}" does not match NutritionQuantity basis "${basis.id}" (expected "${expectedTag}")`,
    );
  }
  if (actualTag !== undefined && expectedTag === undefined) {
    throw new InvalidNutritionBasisError(
      basis.id,
      `quantity carries basis "${actualTag}" but NutritionQuantity basis is "${basis.id}"`,
    );
  }
}

function stripBasisTag(symbol: string, basis: BasisDefinition): string {
  if (!basis.unitBasis) return symbol;
  const suffix = ` ${basis.unitBasis}`;
  if (symbol.endsWith(suffix)) return symbol.slice(0, -suffix.length);
  return symbol;
}

function assertSameNutrientAndBasis(
  a: NutritionQuantity,
  b: NutritionQuantity,
  op: string,
  mode: SemanticMode = "strict",
): void {
  const result = checkNutrientCompatibility(a.nutrient.id, b.nutrient.id, { mode });
  if (!result.isCompatible) {
    throw new IncompatibleNutrientError(
      a.nutrient.id,
      b.nutrient.id,
      `${op} requires same nutrient kind — ${result.reason}`,
    );
  }
  if (a.basis.id !== b.basis.id) {
    throw new InvalidNutritionBasisError(
      b.basis.id,
      `${op} requires same basis (got "${a.basis.id}" vs "${b.basis.id}")`,
    );
  }
}
