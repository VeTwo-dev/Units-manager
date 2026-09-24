/**
 * quantity.ts
 * -----------------------------------------------------------------------
 * Single responsibility: the Quantity value object — a NUMBER + a UNIT,
 * immutable, with dimensionally-safe arithmetic. This is the ONLY place
 * in the whole project (core or domain) where a numeric value should be
 * multiplied/divided/converted "by hand". Every other module operates on
 * Quantity instances and never touches `.value` directly except to read
 * a final normalized result.
 *
 * Conversion is delegated to the conversion-engine module for clean
 * separation of concerns and to support affine conversions (temperature).
 * -----------------------------------------------------------------------
 */
import {
  dimensionKey,
  isDimensionless,
  multiplyDim,
  divideDim,
  dimensionsEqual,
  powDim,
  rootDim,
} from "./dimension.js";
import {
  assertSemanticCompatible,
  assertSemanticConvertible,
  defaultQuantityKindRegistry,
  type SemanticPolicy,
} from "./quantity-kind.js";
import { parseUnit } from "./unit-parser.js";
import {
  DIMENSIONLESS_UNIT,
  isAbsoluteTemperatureUnit,
  isAffineUnit,
  makeUnit,
  type Unit,
} from "./unit.js";
import { defaultUnitRegistry, UnitRegistry } from "./unit-registry.js";
import {
  DimensionError,
  DivisionByZeroError,
  InvalidAffineOperationError,
  UnitMismatchError,
  ConversionError,
  ImpossibleConversionError,
} from "./errors/index.js";
import { convert, linearScaleOf, toBase } from "./conversion-engine.js";
import {
  approxEqual as approxEqualNumeric,
  assertValidQuantityValue,
  checkFiniteResult,
  NumericalError,
  roundValue,
  type ComparisonOptions,
  type RoundingMode,
} from "./numerical.js";

/** Optional per-call semantic policy for same-dimension Quantity arithmetic. */
export interface QuantityArithmeticOptions {
  readonly semanticPolicy?: SemanticPolicy;
}

/** Optional per-call semantic gating for Quantity.to(). */
export interface QuantityConvertOptions {
  readonly semanticPolicy?: SemanticPolicy;
  /** Caller context for kinds that require it (reference, standard, …). */
  readonly context?: unknown;
}

export class Quantity {
  readonly value: number;
  readonly unit: Unit;

  /** Dimension of this quantity's unit — shorthand for `unit.dimension`. */
  get dimension(): import("./dimension.js").DimensionVector {
    return this.unit.dimension;
  }

  /**
   * Semantic quantity kind id, if the unit claims one (Phase 22).
   * Sourced from `unit.metadata.kind` — registered pack data, never parsed
   * from display strings. `undefined` means "no semantic claim" (generic).
   */
  get kind(): string | undefined {
    return this.unit.metadata?.kind;
  }

  private constructor(value: number, unit: Unit) {
    assertValidQuantityValue(value);
    this.value = value;
    this.unit = unit;
    // Value-object immutability: readonly is compile-time only, so freeze
    // to block silent runtime corruption through aliases (a frozen Quantity
    // can be freely shared between Measurements, formulas and caches).
    Object.freeze(this);
  }

  // ---- Construction -----------------------------------------------------

  static of(
    value: number,
    unitSymbol: string | Unit,
    registry: UnitRegistry = defaultUnitRegistry,
  ): Quantity {
    assertValidQuantityValue(value);
    if (typeof unitSymbol === "string" && unitSymbol.trim().length === 0) {
      throw new NumericalError("Unit symbol must be a non-empty string");
    }
    const unit = typeof unitSymbol === "string" ? parseUnit(unitSymbol, registry) : unitSymbol;
    return new Quantity(value, unit);
  }

  /**
   * Return a copy of this quantity with an explicit semantic kind (Phase 22).
   * The kind must be registered and its dimension must match this quantity —
   * e.g. a bare K interval can be marked "temperature-difference", but a kg
   * can never be marked "angle". Does not mutate.
   */
  withKind(kindId: string): Quantity {
    const def = defaultQuantityKindRegistry.require(kindId);
    if (!dimensionsEqual(def.dimension, this.dimension)) {
      throw new DimensionError(dimensionKey(def.dimension), dimensionKey(this.dimension));
    }
    return new Quantity(
      this.value,
      makeUnit({
        id: this.unit.id,
        symbol: this.unit.symbol,
        name: this.unit.name,
        aliases: [...this.unit.aliases],
        dimension: this.unit.dimension,
        conversion:
          this.unit.conversion.kind === "linear" || this.unit.conversion.kind === "affine"
            ? { ...this.unit.conversion }
            : this.unit.conversion,
        basis: this.unit.basis,
        label: this.unit.label,
        metadata: { ...this.unit.metadata, kind: kindId },
      }),
    );
  }

  /**
   * Assert this quantity is semantically compatible with `kindId` under the
   * policy (default semantic-aware) and return this for chaining — the
   * opt-in gate for kind-sensitive math, e.g.
   * `q.requireKind("angle").sin()`. Throws IncompatibleQuantityKindError.
   */
  requireKind(kindId: string, policy: SemanticPolicy = "semantic-aware"): Quantity {
    defaultQuantityKindRegistry.require(kindId);
    assertSemanticCompatible(this.kind, kindId, policy);
    return this;
  }

  // ---- Conversion ---------------------------------------------------------

  /** Value expressed in this quantity's dimension's canonical base unit. */
  toBase(): Quantity {
    const baseValue = toBase(this.value, this.unit);
    checkFiniteResult(baseValue, "Quantity.toBase");
    return new Quantity(baseValue, {
      ...this.unit,
      id: "base",
      symbol: "base",
      name: "base",
      aliases: [],
      conversion: { kind: "linear", scale: 1 },
      toBaseFactor: 1,
    });
  }

  /**
   * Convert to another unit of the SAME dimension. Throws if dimensions differ.
   * `opts.semanticPolicy` (default "dimensional-only") additionally gates the
   * conversion on semantic kinds; `opts.context` satisfies kinds that require
   * caller context. Legacy two-argument calls behave exactly as before.
   */
  to(
    targetUnitSymbol: string | Unit,
    registry: UnitRegistry = defaultUnitRegistry,
    opts: QuantityConvertOptions = {},
  ): Quantity {
    const target =
      typeof targetUnitSymbol === "string"
        ? parseUnit(targetUnitSymbol, registry)
        : targetUnitSymbol;

    if (!dimensionsEqual(this.unit.dimension, target.dimension)) {
      throw new ImpossibleConversionError(this.unit.symbol, target.symbol);
    }
    assertSemanticConvertible(this.kind, target.metadata?.kind, {
      policy: opts.semanticPolicy ?? "dimensional-only",
      context: opts.context,
    });
    if (this.unit.basis && target.basis && this.unit.basis !== target.basis) {
      // Basis mismatch (DM vs asFed) cannot be resolved by unit conversion alone —
      // it requires a dry-matter quantity and belongs to the domain layer.
      throw new ConversionError(
        this.unit.symbol,
        target.symbol,
        `basis mismatch ("${this.unit.basis}" vs "${target.basis}") — use a domain BasisConverter`,
      );
    }
    const newValue = convert(this.value, this.unit, target);
    checkFiniteResult(newValue, `Quantity.to(${target.symbol})`);
    return new Quantity(newValue, target);
  }

  // ---- Arithmetic (dimensionally safe) -------------------------------------

  add(other: Quantity, opts: QuantityArithmeticOptions = {}): Quantity {
    this.assertSameDimension(other);
    assertSemanticCompatible(this.kind, other.kind, opts.semanticPolicy ?? "dimensional-only");
    // Affine safety: adding two absolute temperatures (with non-zero offset) is not meaningful
    if (isAffineUnit(this.unit) && isAffineUnit(other.unit)) {
      throw new InvalidAffineOperationError(
        `${this.unit.symbol} + ${other.unit.symbol}`,
        "adding two absolute temperatures is not physically meaningful; use temperature intervals",
      );
    }
    // Handle absolute + delta correctly: delta should be added in base without offset
    if (isAffineUnit(this.unit) && !isAffineUnit(other.unit)) {
      // this is absolute, other is delta (linear)
      const baseThis = toBase(this.value, this.unit);
      const baseOther = other.value * linearScaleOf(other.unit); // delta, no offset
      const resultBase = baseThis + baseOther;
      checkFiniteResult(resultBase, "Quantity.add");
      const resultValue =
        (resultBase - (this.unit.conversion as import("./unit.js").AffineConversion).offset) /
        linearScaleOf(this.unit);
      return new Quantity(resultValue, this.unit);
    }
    if (!isAffineUnit(this.unit) && isAffineUnit(other.unit)) {
      // this is delta, other is absolute: delta + absolute = absolute (commute)
      const baseOther = toBase(other.value, other.unit);
      const baseThis = this.value * linearScaleOf(this.unit);
      const resultBase = baseThis + baseOther;
      const resultValue =
        (resultBase - (other.unit.conversion as import("./unit.js").AffineConversion).offset) /
        linearScaleOf(other.unit);
      // Return in other's unit (absolute)
      return new Quantity(resultValue, other.unit);
    }
    const otherInThisUnit = other.to(this.unit);
    const result = this.value + otherInThisUnit.value;
    checkFiniteResult(result, "Quantity.add");
    return new Quantity(result, this.unit);
  }

  subtract(other: Quantity, opts: QuantityArithmeticOptions = {}): Quantity {
    this.assertSameDimension(other);
    assertSemanticCompatible(this.kind, other.kind, opts.semanticPolicy ?? "dimensional-only");
    // Affine: absolute - absolute = delta (linear)
    if (isAffineUnit(this.unit) && isAffineUnit(other.unit)) {
      const baseThis = toBase(this.value, this.unit);
      const baseOther = toBase(other.value, other.unit);
      const resultBase = baseThis - baseOther;
      checkFiniteResult(resultBase, "Quantity.subtract");
      // Return delta as linear temperature interval (use K as canonical delta)
      // For temperature, delta scale is 1 K =1, so we can return with a linear unit
      // For simplicity, return with this.unit's dimension but linear conversion
      // Create a delta unit: same dimension, linear scale 1, symbol "K" or generic
      // Use the first linear unit for this dimension if available, otherwise use this.unit with linear conversion
      if (this.unit.conversion.kind === "affine") {
        // Create delta unit as linear with same scale but offset 0.
        // Explicitly tagged "temperature-difference" (Phase 22): absolute
        // minus absolute is an interval, not an absolute temperature.
        const deltaUnit = makeUnit({
          symbol: "K",
          dimension: this.unit.dimension,
          conversion: { kind: "linear", scale: 1 },
          label: "kelvin delta",
          metadata: { system: "SI", kind: "temperature-difference" },
        });
        // resultBase is already delta in base units (K), so value = resultBase / 1
        return new Quantity(resultBase, deltaUnit);
      }
      return new Quantity(resultBase, this.unit);
    }
    // Absolute (affine) - delta (linear) = absolute
    if (isAffineUnit(this.unit) && !isAffineUnit(other.unit)) {
      const baseThis = toBase(this.value, this.unit);
      const baseOther = other.value * linearScaleOf(other.unit);
      const resultBase = baseThis - baseOther;
      const resultValue =
        (resultBase - (this.unit.conversion as import("./unit.js").AffineConversion).offset) /
        linearScaleOf(this.unit);
      return new Quantity(resultValue, this.unit);
    }
    // Delta (linear) - absolute (affine) = delta (e.g. K - °C)
    if (!isAffineUnit(this.unit) && isAffineUnit(other.unit)) {
      const baseThis = this.value * linearScaleOf(this.unit);
      const baseOther = toBase(other.value, other.unit);
      const resultBase = baseThis - baseOther;
      checkFiniteResult(resultBase, "Quantity.subtract");
      const deltaUnit = makeUnit({
        symbol: this.unit.symbol,
        dimension: this.unit.dimension,
        conversion: { kind: "linear", scale: linearScaleOf(this.unit) },
        label: `${this.unit.label} delta`,
        metadata: {
          system: ((this.unit.metadata as Record<string, unknown>)?.system as string) ?? "general",
          kind: "temperature-difference",
        },
      });
      return new Quantity(resultBase / linearScaleOf(this.unit), deltaUnit);
    }
    const otherInThisUnit = other.to(this.unit);
    const result = this.value - otherInThisUnit.value;
    checkFiniteResult(result, "Quantity.subtract");
    return new Quantity(result, this.unit);
  }

  /**
   * Multiply two quantities. The resulting dimension is computed
   * automatically via dimensional analysis — this single method is what
   * replaces every hand-written `cp/100 * kg`, `mg/kg * kg`, `Mcal/kg * kg`
   * etc. anywhere in the host application.
   * When given a plain number, delegates to `scale`.
   */
  multiply(other: Quantity | number): Quantity {
    if (typeof other === "number") return this.scale(other);
    if (isAffineUnit(this.unit) || isAffineUnit(other.unit)) {
      throw new InvalidAffineOperationError(
        `${this.unit.symbol} × ${other.unit.symbol}`,
        "multiplying affine temperatures is not physically meaningful",
      );
    }
    const resultDim = multiplyDim(this.unit.dimension, other.unit.dimension);
    // linearScaleOf (not raw toBaseFactor): logarithmic/custom units have no
    // linear scale and must fail explicitly instead of producing silent NaN.
    const thisScale = linearScaleOf(this.unit);
    const otherScale = linearScaleOf(other.unit);
    const resultScale = thisScale * otherScale;
    checkFiniteResult(resultScale, "Quantity.multiply scale");
    const resultBaseValue = this.value * thisScale * other.value * otherScale;
    checkFiniteResult(resultBaseValue, "Quantity.multiply");
    // Prompt-18 fix: value, symbol and scale must AGREE. The old code stored
    // the base-unit value with scale 1 under a composite symbol, so the
    // symbol lied about the scale: re-parsing it (serialization, canonical
    // identity, downstream consumers) silently corrupted the value
    // (e.g. 9 N·m round-tripped as 5e20 base). The value now reads in the
    // emitted composite unit; physics via to()/toBase() is unchanged.
    const resultValue = resultBaseValue / resultScale;
    checkFiniteResult(resultValue, "Quantity.multiply");
    const resultUnit = makeUnit({
      symbol: `(${this.unit.symbol})·(${other.unit.symbol})`,
      dimension: resultDim,
      toBaseFactor: resultScale,
    });
    return new Quantity(resultValue, resultUnit);
  }

  /**
   * Divide by a quantity or a scalar. For Quantity ÷ Quantity, dimensions
   * are divided via Dimension algebra; for scalar, the unit is preserved.
   * Throws DivisionByZeroError if divisor is zero.
   */
  divide(other: Quantity | number): Quantity {
    if (typeof other === "number") {
      if (other === 0)
        throw new DivisionByZeroError(`Cannot divide quantity "${this.toString()}" by scalar 0.`);
      if (isAffineUnit(this.unit)) {
        throw new InvalidAffineOperationError(
          `${this.unit.symbol} / ${other}`,
          "dividing affine temperature by scalar is ambiguous; use temperature intervals",
        );
      }
      return new Quantity(this.value / other, this.unit);
    }
    if (isAffineUnit(this.unit) || isAffineUnit(other.unit)) {
      throw new InvalidAffineOperationError(
        `${this.unit.symbol} / ${other.unit.symbol}`,
        "dividing affine temperatures is not physically meaningful",
      );
    }
    if (other.value === 0) {
      throw new DivisionByZeroError(
        `Cannot divide "${this.toString()}" by zero-valued quantity "${other.toString()}".`,
      );
    }
    const resultDim = divideDim(this.unit.dimension, other.unit.dimension);
    const thisScale = linearScaleOf(this.unit);
    const otherScale = linearScaleOf(other.unit);
    const resultScale = thisScale / otherScale;
    checkFiniteResult(resultScale, "Quantity.divide scale");
    const resultBaseValue = (this.value * thisScale) / (other.value * otherScale);
    checkFiniteResult(resultBaseValue, "Quantity.divide");
    // Prompt-18 fix: same value/symbol/scale agreement as multiply — the old
    // base-value-with-scale-1 convention silently corrupted symbol-based
    // round-trips (serialization, canonicalization). The pure number for
    // same-dimension ratios is available via toBase().value / to("1").value.
    const resultValue = resultBaseValue / resultScale;
    checkFiniteResult(resultValue, "Quantity.divide");
    const resultUnit = makeUnit({
      symbol: `(${this.unit.symbol})/(${other.unit.symbol})`,
      dimension: resultDim,
      toBaseFactor: resultScale,
    });
    return new Quantity(resultValue, resultUnit);
  }

  scale(factor: number): Quantity {
    if (typeof factor !== "number")
      throw new NumericalError(`Scale factor must be a number, got ${typeof factor}`);
    if (isAffineUnit(this.unit)) {
      throw new InvalidAffineOperationError(
        `${this.unit.symbol} * ${factor}`,
        "scaling affine temperature is ambiguous; use temperature intervals",
      );
    }
    const result = this.value * factor;
    checkFiniteResult(result, "Quantity.scale");
    return new Quantity(result, this.unit);
  }

  /** Return a new Quantity with negated value, same unit. Immutability: original unchanged. */
  negate(): Quantity {
    return new Quantity(-this.value, this.unit);
  }

  /** Return a new Quantity with absolute value, same unit. */
  abs(): Quantity {
    return new Quantity(Math.abs(this.value), this.unit);
  }

  // ---- Mathematical operations (generic) ------------------------------------

  /**
   * Raise this quantity to an integer power.
   * Dimension exponents are multiplied by the power; value is Math.pow.
   * Only integer powers are supported to keep dimension exponents integral.
   * pow(0) yields dimensionless 1 (for any non-zero base), pow(1) is identity.
   */
  pow(power: number): Quantity {
    if (!Number.isInteger(power)) {
      throw new NumericalError(`Quantity.pow() power must be an integer, got ${power}`);
    }
    // Absolute temperatures (K, °C, °F, °R) cannot be powered except 0/1
    if (isAbsoluteTemperatureUnit(this.unit) && power !== 0 && power !== 1) {
      throw new NumericalError(
        `Cannot raise absolute temperature "${this.unit.symbol}" to power ${power}`,
      );
    }
    if (power === 0) {
      // Any non-zero quantity to power 0 is dimensionless 1; 0^0 is 1 as well for quantity math
      return new Quantity(1, {
        id: "1",
        symbol: "1",
        name: "dimensionless",
        aliases: [],
        dimension: {} as import("./dimension.js").DimensionVector,
        conversion: { kind: "linear", scale: 1 },
        toBaseFactor: 1,
      } as Unit);
    }
    if (power === 1) return new Quantity(this.value, this.unit);
    // Check for overflow in value
    const newValue = Math.pow(this.value, power);
    checkFiniteResult(newValue, `Quantity.pow(${power})`);
    // Dimension: multiply exponents
    const newDim = powDim(this.dimension, power);
    const newScale = Math.pow(linearScaleOf(this.unit), power);
    checkFiniteResult(newScale, `Quantity.pow(${power}) scale`);
    // Parenthesize composite bases so the symbol re-parses to the same
    // dimension (m/s)^2, not m/(s^2). Atomic symbols pass through bare.
    const base = /[*·/×^()\s]/.test(this.unit.symbol) ? `(${this.unit.symbol})` : this.unit.symbol;
    const newUnit = makeUnit({
      symbol: `${base}^${power}`,
      dimension: newDim,
      toBaseFactor: newScale,
    });
    return new Quantity(newValue, newUnit);
  }

  /**
   * Return the smaller of this and other (by base value). Requires same dimension.
   */
  min(other: Quantity): Quantity {
    this.assertSameDimension(other);
    return this.toBase().value <= other.toBase().value
      ? new Quantity(this.value, this.unit)
      : new Quantity(other.value, other.unit);
  }

  /**
   * Return the larger of this and other (by base value). Requires same dimension.
   */
  max(other: Quantity): Quantity {
    this.assertSameDimension(other);
    return this.toBase().value >= other.toBase().value
      ? new Quantity(this.value, this.unit)
      : new Quantity(other.value, other.unit);
  }

  /**
   * Round the numeric value to `decimals` decimal places, preserving unit.
   * Does not mutate. Uses the specified rounding mode (default half-up).
   */
  round(decimals: number, mode: RoundingMode = "half-up"): Quantity {
    const rounded = roundValue(this.value, decimals, mode);
    checkFiniteResult(rounded, `Quantity.round(${decimals})`);
    return new Quantity(rounded, this.unit);
  }

  /**
   * Convert to the target unit, then round. Conversion and rounding stay
   * separate concepts — this is explicit composition, e.g.
   * `Quantity.of(1.234, "kg").roundTo("g")` → `1234 g`.
   */
  roundTo(
    targetUnitSymbol: string | Unit,
    decimals = 0,
    mode: RoundingMode = "half-up",
    registry: UnitRegistry = defaultUnitRegistry,
  ): Quantity {
    return this.to(targetUnitSymbol, registry).round(decimals, mode);
  }

  // ---- Roots, reciprocal, sign (dimension-validated) --------------------------

  private root(degree: 2 | 3, name: "sqrt" | "cbrt"): Quantity {
    if (isAbsoluteTemperatureUnit(this.unit)) {
      throw new InvalidAffineOperationError(
        `${name}(${this.unit.symbol})`,
        "roots of absolute temperatures are not physically meaningful; use temperature intervals",
      );
    }
    // Throws DimensionError unless every exponent is exactly divisible.
    // Fractional dimensions are rejected rather than silently truncated.
    const newDim = rootDim(this.dimension, degree);
    const baseValue = this.value * linearScaleOf(this.unit);
    if (degree === 2 && baseValue < 0) {
      throw new NumericalError(
        `sqrt of negative value ${baseValue} is not a real quantity; use cbrt for odd roots of negatives`,
      );
    }
    const newValue = degree === 2 ? Math.sqrt(baseValue) : Math.cbrt(baseValue);
    checkFiniteResult(newValue, `Quantity.${name}`);
    // Known limitation (Prompt-18): the sqrt()/cbrt() display symbol cannot
    // re-parse (no root syntax in the grammar), so root results keep the
    // base-unit value with scale 1 and fail LOUDLY (typed parse error) on
    // symbol-based round-trips — never silent corruption. Conversions via
    // to()/toBase() are exact.
    const newUnit = makeUnit({
      symbol: `${name}(${this.unit.symbol})`,
      dimension: newDim,
      toBaseFactor: 1,
    });
    return new Quantity(newValue, newUnit);
  }

  /**
   * Square root: sqrt(9 m²) = 3 m. Requires all dimension exponents even
   * (DimensionError otherwise), a non-negative value (NumericalError
   * otherwise), and rejects affine units.
   */
  sqrt(): Quantity {
    return this.root(2, "sqrt");
  }

  /**
   * Cube root: cbrt(27 m³) = 3 m, cbrt(-8 m³) = -2 m. Requires all
   * dimension exponents divisible by 3 (DimensionError otherwise).
   */
  cbrt(): Quantity {
    return this.root(3, "cbrt");
  }

  /**
   * Reciprocal: 1/x with inverted dimension. reciprocal(2 s) = 0.5 s⁻¹.
   * The result keeps the inverted original unit (not a base composite),
   * so the value reads naturally: 1/2 s → 0.5 s⁻¹. Zero values throw
   * DivisionByZeroError; affine units throw.
   */
  reciprocal(): Quantity {
    if (isAffineUnit(this.unit)) {
      throw new InvalidAffineOperationError(
        `1/(${this.unit.symbol})`,
        "reciprocal of absolute temperature is not physically meaningful; use temperature intervals",
      );
    }
    if (this.value === 0) {
      throw new DivisionByZeroError(
        `Cannot take reciprocal of zero-valued quantity "${this.toString()}".`,
      );
    }
    const newValue = 1 / this.value;
    checkFiniteResult(newValue, "Quantity.reciprocal");
    const newDim = powDim(this.dimension, -1);
    const newUnit = makeUnit({
      symbol: `(${this.unit.symbol})⁻¹`,
      dimension: newDim,
      toBaseFactor: 1 / linearScaleOf(this.unit),
    });
    return new Quantity(newValue, newUnit);
  }

  /**
   * Sign of the value as a dimensionless quantity: -1, 0, 1 (or NaN).
   * sign(-5 kg) = -1. The receiver keeps its unit; the result does not.
   */
  sign(): Quantity {
    return new Quantity(Math.sign(this.value), DIMENSIONLESS_UNIT);
  }

  /**
   * Clamp the value into [min, max]. All three quantities must share a
   * dimension (UnitMismatchError otherwise); min must not exceed max
   * (NumericalError). The result keeps this unit (deterministic policy).
   */
  clamp(min: Quantity, max: Quantity): Quantity {
    this.assertSameDimension(min);
    this.assertSameDimension(max);
    if (min.toBase().value > max.toBase().value) {
      throw new NumericalError(
        `clamp min (${min.toString()}) must not exceed max (${max.toString()})`,
      );
    }
    if (this.lessThan(min)) return min.to(this.unit);
    if (this.greaterThan(max)) return max.to(this.unit);
    return new Quantity(this.value, this.unit);
  }

  /**
   * Truncated remainder (JavaScript `%` semantics: sign follows the
   * dividend). Dimensions must match; the result keeps this unit.
   * `10 m mod 3 m` = `1 m`. Zero divisors throw DivisionByZeroError.
   */
  modulo(other: Quantity): Quantity {
    this.assertSameDimension(other);
    if (isAffineUnit(this.unit) || isAffineUnit(other.unit)) {
      throw new InvalidAffineOperationError(
        `${this.unit.symbol} % ${other.unit.symbol}`,
        "modulo on affine units is ambiguous; use temperature intervals",
      );
    }
    const divisor = other.to(this.unit);
    if (divisor.value === 0) {
      throw new DivisionByZeroError(
        `Cannot take "${this.toString()}" modulo zero-valued quantity "${other.toString()}".`,
      );
    }
    const result = this.value % divisor.value;
    checkFiniteResult(result, "Quantity.modulo");
    return new Quantity(result, this.unit);
  }

  // ---- Dimensionless transcendental functions ---------------------------------
  //
  // These require dimensionless input (radians convention for trig, matching
  // the Phase 14 decision that angle is dimensionless). exp(5 kg) and friends
  // throw DimensionError — JavaScript Math acceptance is not a license.

  private requireDimensionless(_op: string): void {
    if (!isDimensionless(this.dimension)) {
      throw new DimensionError("dimensionless", this.unit.symbol);
    }
  }

  private dimensionlessResult(op: string, value: number): Quantity {
    checkFiniteResult(value, `Quantity.${op}`);
    return new Quantity(value, DIMENSIONLESS_UNIT);
  }

  /** Sine of a dimensionless value (radians convention). */
  sin(): Quantity {
    this.requireDimensionless("sin");
    return this.dimensionlessResult("sin", Math.sin(this.value));
  }

  /** Cosine of a dimensionless value (radians convention). */
  cos(): Quantity {
    this.requireDimensionless("cos");
    return this.dimensionlessResult("cos", Math.cos(this.value));
  }

  /**
   * Tangent of a dimensionless value (radians convention). Near asymptotes
   * the IEEE-754 result (possibly ±Infinity) follows the numerical policy.
   */
  tan(): Quantity {
    this.requireDimensionless("tan");
    return this.dimensionlessResult("tan", Math.tan(this.value));
  }

  /** Exponential e^x; x must be dimensionless. Overflow follows the numerical policy. */
  exp(): Quantity {
    this.requireDimensionless("exp");
    return this.dimensionlessResult("exp", Math.exp(this.value));
  }

  /** Natural logarithm; requires a dimensionless positive value. */
  ln(): Quantity {
    this.requireDimensionless("ln");
    if (!(this.value > 0)) {
      throw new NumericalError(
        `ln requires a positive value, got ${String(this.value)} (NaN, zero and negatives are outside the real domain)`,
      );
    }
    return this.dimensionlessResult("ln", Math.log(this.value));
  }

  /** Base-10 logarithm; requires a dimensionless positive value. */
  log10(): Quantity {
    this.requireDimensionless("log10");
    if (!(this.value > 0)) {
      throw new NumericalError(
        `log10 requires a positive value, got ${String(this.value)} (NaN, zero and negatives are outside the real domain)`,
      );
    }
    return this.dimensionlessResult("log10", Math.log10(this.value));
  }

  // ---- Predicates -----------------------------------------------------------

  /** Whether the value is zero (including −0; NaN is not zero). */
  isZero(): boolean {
    return this.value === 0;
  }

  /** Whether the value is strictly positive (> 0; Infinity is positive, NaN is not). */
  isPositive(): boolean {
    return this.value > 0;
  }

  /** Whether the value is strictly negative (< 0; −Infinity is negative, NaN and −0 are not negative). */
  isNegative(): boolean {
    return this.value < 0;
  }

  /** Whether this quantity is dimensionless (all dimension exponents zero). */
  isDimensionless(): boolean {
    return isDimensionless(this.dimension);
  }

  // ---- Comparison / introspection -------------------------------------------

  /**
   * Exact equality (no tolerance): same dimension and Object.is(value, other.value) after
   * normalizing to base units. Distinguish -0 vs 0 if policy preserves.
   */
  exactEquals(other: Quantity): boolean {
    if (!dimensionsEqual(this.unit.dimension, other.unit.dimension)) return false;
    return Object.is(this.toBase().value, other.toBase().value);
  }

  /**
   * Approximate equality with configurable tolerances.
   * Uses central numerical policy: |a-b| <= max(absTol, relTol * max(|a|,|b|)).
   * Legacy signature `equals(other, epsilon)` is supported: if second arg is number, it is treated as epsilon (absolute).
   */
  equals(other: Quantity, epsilon: number | ComparisonOptions = 1e-9): boolean {
    if (!dimensionsEqual(this.unit.dimension, other.unit.dimension)) return false;
    const opts: ComparisonOptions = typeof epsilon === "number" ? { epsilon } : epsilon;
    return approxEqualNumeric(this.toBase().value, other.toBase().value, opts);
  }

  /** Explicit alias for `equals` with tolerance — conveys intent that tolerance is expected. */
  approximatelyEquals(other: Quantity, epsilon: number | ComparisonOptions = 1e-9): boolean {
    return this.equals(other, epsilon as number);
  }

  hasSameDimension(other: Quantity): boolean {
    return dimensionsEqual(this.unit.dimension, other.unit.dimension);
  }

  /** Whether `this < other` (dimension match required). Compares via base units. */
  lessThan(other: Quantity): boolean {
    this.assertSameDimension(other);
    return this.toBase().value < other.toBase().value;
  }

  /** Whether `this <= other` (dimension match required). */
  lessThanOrEqual(other: Quantity): boolean {
    this.assertSameDimension(other);
    return this.toBase().value <= other.toBase().value;
  }

  /** Whether `this > other` (dimension match required). */
  greaterThan(other: Quantity): boolean {
    this.assertSameDimension(other);
    return this.toBase().value > other.toBase().value;
  }

  /** Whether `this >= other` (dimension match required). */
  greaterThanOrEqual(other: Quantity): boolean {
    this.assertSameDimension(other);
    return this.toBase().value >= other.toBase().value;
  }

  private assertSameDimension(other: Quantity): void {
    if (!dimensionsEqual(this.unit.dimension, other.unit.dimension)) {
      throw new UnitMismatchError(this.unit.symbol, other.unit.symbol);
    }
  }

  toString(): string {
    return `${this.value} ${this.unit.symbol}${this.unit.basis ? ` ${this.unit.basis}` : ""}`;
  }
}

/** Convenience factory — sugar for `Quantity.of(value, unit)`. */
export function Q(value: number, unit: string | Unit, registry?: UnitRegistry): Quantity {
  return Quantity.of(value, unit, registry);
}
