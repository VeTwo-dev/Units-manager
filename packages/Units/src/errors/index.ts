/**
 * errors/index.ts
 * -----------------------------------------------------------------------
 * Single responsibility: a small, precise error taxonomy so that callers
 * (validation engine, report generator, UI) can catch exactly the failure
 * mode they care about instead of parsing error strings.
 * -----------------------------------------------------------------------
 */

export class UnitEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when two quantities of different dimensions are added/subtracted/compared. */
export class UnitMismatchError extends UnitEngineError {
  constructor(a: string, b: string) {
    super(`Unit mismatch: cannot combine "${a}" with "${b}" (different dimensions).`);
  }
}

/** Thrown when a unit symbol is not registered and cannot be parsed/composed. */
export class UnsupportedUnitError extends UnitEngineError {
  constructor(symbol: string) {
    super(`Unsupported or unknown unit: "${symbol}".`);
  }
}

/** Thrown when an operation requires a specific dimension and receives another. */
export class DimensionError extends UnitEngineError {
  constructor(expected: string, actual: string) {
    super(`Dimension error: expected "${expected}", got "${actual}".`);
  }
}

/** Thrown when a conversion factor cannot be resolved between two known units. */
export class ConversionError extends UnitEngineError {
  constructor(from: string, to: string, reason?: string) {
    super(`Cannot convert "${from}" -> "${to}"${reason ? `: ${reason}` : ""}.`);
  }
}

/** Thrown when a conversion is dimensionally impossible (e.g. kg -> Mcal directly). */
export class ImpossibleConversionError extends UnitEngineError {
  constructor(from: string, to: string) {
    super(
      `Impossible conversion: "${from}" and "${to}" do not share a dimension and no ` +
        `calculation rule bridges them.`,
    );
  }
}

/** Thrown when a domain calculation rule is requested but not registered. */
export class RuleNotFoundError extends UnitEngineError {
  constructor(ruleKey: string) {
    super(`No calculation rule registered for "${ruleKey}".`);
  }
}

/** Thrown when a dimension vector is malformed, uses an unregistered dimension id, or has a non-integer exponent. */
export class InvalidDimensionError extends UnitEngineError {
  constructor(reason: string) {
    super(`Invalid dimension: ${reason}.`);
  }
}

/** Thrown when a unit definition is invalid (bad symbol, bad conversion, etc.). */
export class InvalidUnitError extends UnitEngineError {
  constructor(reason: string) {
    super(`Invalid unit: ${reason}.`);
  }
}

/** Thrown when a measurement is invalid (negative/NaN uncertainty, dimension mismatch, bad confidence level, etc.). */
export class InvalidMeasurementError extends UnitEngineError {
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when attempting to divide a quantity by zero. */
export class DivisionByZeroError extends UnitEngineError {
  constructor(message?: string) {
    super(
      message ?? "Division by zero: cannot divide a quantity by zero or a zero-valued quantity.",
    );
  }
}

/**
 * Maximum characters of attacker-controlled input echoed into an error message.
 * The full input stays available on `.expression`; only the human-readable
 * message is truncated.
 */
export const MAX_ERROR_INPUT_ECHO = 200;

/** Thrown when a unit expression cannot be parsed (malformed syntax, empty input, etc.). */
export class InvalidUnitExpressionError extends UnitEngineError {
  readonly expression: string;
  readonly position?: number;

  constructor(expression: string, reason: string, position?: number) {
    const shown =
      expression.length > MAX_ERROR_INPUT_ECHO
        ? `${expression.slice(0, MAX_ERROR_INPUT_ECHO)}…`
        : expression;
    super(
      `Invalid unit expression "${shown}"${position !== undefined ? ` at position ${position}` : ""}: ${reason}.`,
    );
    this.expression = expression;
    this.position = position;
  }
}

/** Thrown when an affine operation is mathematically invalid (e.g. adding two absolute temperatures). */
export class InvalidAffineOperationError extends UnitEngineError {
  constructor(operation: string, reason: string) {
    super(`Invalid affine operation "${operation}": ${reason}.`);
  }
}

/** Thrown when a transformation is not supported (e.g. non-linear conversion not yet implemented). */
export class UnsupportedTransformationError extends UnitEngineError {
  constructor(transformation: string, reason?: string) {
    super(`Unsupported transformation "${transformation}"${reason ? `: ${reason}` : ""}.`);
  }
}

/** Thrown for formula definition/validation/evaluation failures (carries formula id + context). */
export class FormulaError extends UnitEngineError {
  constructor(formulaId: string, detail: string) {
    super(`Formula "${formulaId}": ${detail}.`);
  }
}

/** Thrown when a dependency graph contains a dependency cycle (carries the cycle path). */
export class CyclicDependencyError extends UnitEngineError {
  constructor(cyclePath: readonly string[]) {
    super(`Cyclic dependency detected: ${cyclePath.join(" -> ")}.`);
  }
}

/** Thrown for generic expression-engine failures (invalid structure, bad operation, arity mismatch, etc.). */
export class ExpressionError extends UnitEngineError {
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when an expression references a variable with no binding in the evaluation context. */
export class UnknownVariableError extends UnitEngineError {
  readonly variable: string;
  constructor(variable: string) {
    super(`Unknown variable "${variable}": no Quantity binding in the evaluation context.`);
    this.variable = variable;
  }
}

/** Thrown when an expression exceeds configured safety limits (depth, node count, input size). */
export class ExpressionLimitError extends UnitEngineError {
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when two semantic quantity kinds are not compatible under the active policy. */
export class IncompatibleQuantityKindError extends UnitEngineError {
  constructor(a: string | undefined, b: string | undefined, policy: string) {
    super(
      `Incompatible quantity kinds "${a ?? "unknown"}" and "${b ?? "unknown"}" ` +
        `under semantic policy "${policy}".`,
    );
  }
}

/** Thrown when a semantic conversion needs reference/standard context that was not provided. */
export class MissingSemanticContextError extends UnitEngineError {
  constructor(kind: string, what: string) {
    super(
      `Semantic conversion of kind "${kind}" requires explicit context (${what}), ` +
        `which was not provided.`,
    );
  }
}

/** Thrown when no semantic conversion exists between two kinds (even with context). */
export class UnsupportedSemanticConversionError extends UnitEngineError {
  constructor(from: string, to: string) {
    super(`No semantic conversion from kind "${from}" to kind "${to}".`);
  }
}

/** Thrown when a quantity's semantic meaning is ambiguous and a decision is required. */
export class AmbiguousSemanticError extends UnitEngineError {
  constructor(detail: string) {
    super(`Ambiguous semantic meaning: ${detail}.`);
  }
}

/** Thrown when a unit symbol resolves to multiple incompatible definitions. */
export class AmbiguousUnitError extends UnitEngineError {
  constructor(symbol: string, candidates: readonly string[]) {
    super(
      `Ambiguous unit "${symbol}": ${candidates.length} incompatible definitions ` +
        `(${candidates.slice(0, 8).join(", ")}${candidates.length > 8 ? ", …" : ""}). ` +
        `Disambiguate with an explicit namespace (ns:symbol), unit system, profile, or variant.`,
    );
  }
}

/** Thrown for extension manifest validation and application failures. */
export class ExtensionError extends UnitEngineError {
  constructor(detail: string) {
    super(`Extension error: ${detail}.`);
  }
}

/** Thrown for serialized-schema migration failures. */
export class MigrationError extends UnitEngineError {
  constructor(detail: string) {
    super(`Migration error: ${detail}.`);
  }
}
