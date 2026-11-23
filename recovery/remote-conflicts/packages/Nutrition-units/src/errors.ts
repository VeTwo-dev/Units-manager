/**
 * errors.ts — Nutrition-units-specific error taxonomy.
 *
 * Re-uses core UnitEngineError as base so callers can catch either
 * generically or specifically. Only nutrition-semantic problems get
 * new classes; generic unit/dimension problems re-use the core errors.
 */

import { UnitEngineError } from "@vetwo/units";

export class NutritionError extends UnitEngineError {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidNutrientKindError extends NutritionError {
  constructor(id: string, detail?: string) {
    super(`Invalid nutrient kind "${id}"${detail ? `: ${detail}` : ""}`);
  }
}

export class NutrientSemanticMismatchError extends NutritionError {
  constructor(a: string, b: string, detail?: string) {
    super(`Nutrient semantic mismatch: "${a}" vs "${b}"${detail ? ` — ${detail}` : ""}`);
  }
}

export class IncompatibleNutrientError extends NutrientSemanticMismatchError {
  constructor(a: string, b: string, detail?: string) {
    super(a, b, detail ?? "incompatible nutrient semantics");
  }
}

export class UnknownNutrientError extends NutritionError {
  constructor(id: string, detail?: string) {
    super(`Unknown nutrient "${id}"${detail ? `: ${detail}` : ""}`);
  }
}

export class AmbiguousNutrientError extends NutritionError {
  constructor(id: string, detail?: string) {
    super(`Ambiguous nutrient "${id}"${detail ? `: ${detail}` : ""}`);
  }
}

export class UnsupportedSemanticConversionError extends NutritionError {
  constructor(from: string, to: string, detail?: string) {
    super(`Unsupported semantic conversion "${from}" → "${to}"${detail ? `: ${detail}` : ""}`);
  }
}

export class InvalidNutritionBasisError extends NutritionError {
  constructor(basis: string, detail?: string) {
    super(`Invalid nutrition basis "${basis}"${detail ? `: ${detail}` : ""}`);
  }
}

export class NutritionContextError extends NutritionError {
  constructor(message: string) {
    super(message);
  }
}

export class MissingNutritionContextError extends InvalidNutritionBasisError {
  constructor(basis: string, detail?: string) {
    super(basis, detail ?? "dryMatterFraction or moistureFraction required");
  }
}

export class InvalidNutritionContextError extends NutritionContextError {
  constructor(message: string) {
    super(message);
  }
}

export class UnsupportedBasisConversionError extends NutritionError {
  constructor(from: string, to: string, detail?: string) {
    super(`Unsupported basis conversion "${from}" → "${to}"${detail ? `: ${detail}` : ""}`);
  }
}

export class UnsupportedUnitFamilyError extends NutritionError {
  constructor(family: string, detail?: string) {
    super(`Unsupported unit family "${family}"${detail ? `: ${detail}` : ""}`);
  }
}

export class MissingChemicalIdentityError extends NutritionError {
  constructor(nutrientId: string, detail?: string) {
    super(
      `Missing chemical identity for "${nutrientId}"${detail ? ": molar mass unavailable" : ""}`,
    );
  }
}

export class NutritionUnitCompatibilityError extends NutritionError {
  constructor(nutrientId: string, unitSymbol: string, detail?: string) {
    super(
      `Nutrient "${nutrientId}" is not compatible with unit "${unitSymbol}"${detail ? `: ${detail}` : ""}`,
    );
  }
}

export class InvalidNutritionQuantityError extends NutritionError {
  constructor(message: string) {
    super(message);
  }
}

export class DuplicateMeasurementError extends NutritionError {
  constructor(nutrientId: string, detail?: string) {
    super(`Duplicate measurement for "${nutrientId}"${detail ? `: ${detail}` : ""}`);
  }
}

export class MeasurementNotFoundError extends NutritionError {
  constructor(nutrientId: string, detail?: string) {
    super(`Measurement not found for "${nutrientId}"${detail ? `: ${detail}` : ""}`);
  }
}

export class AmbiguousMeasurementError extends NutritionError {
  constructor(nutrientId: string, detail?: string) {
    super(`Ambiguous measurement for "${nutrientId}"${detail ? `: ${detail}` : ""}`);
  }
}

export class InvalidSeriesError extends NutritionError {
  constructor(message: string) {
    super(message);
  }
}

export class CollectionConversionError extends NutritionError {
  constructor(nutrientId: string, detail?: string) {
    super(`Collection conversion failed for "${nutrientId}"${detail ? `: ${detail}` : ""}`);
  }
}
