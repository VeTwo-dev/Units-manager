/**
 * dimension.ts
 * -----------------------------------------------------------------------
 * Single responsibility: represent and algebraically combine PHYSICAL
 * DIMENSIONS as exponent vectors over an extensible set of named base
 * dimensions. This is the same technique used in engineering unit
 * libraries (e.g. Boost.Units, Pint, F#'s units-of-measure).
 *
 * The algebra is fully generic: it operates on (dimension-id, exponent)
 * pairs and never branches on particular ids such as "mass" or "energy".
 * Base dimensions are registered in a DimensionRegistry; the seed
 * registry ships the SI-style physical dimensions plus the generic
 * engine dimensions (Energy, Currency, Count) required by the current
 * public unit system. New base dimensions can be added at runtime by any
 * consumer without modifying this file.
 *
 * Exponents are INTEGERS ONLY — see docs/DIMENSION_SPEC.md §8 for the
 * rationale. All vectors are immutable and frozen; every operation
 * returns a new frozen value.
 *
 * Phase 14 — Universal Dimension Model:
 * - Base dimensions are configurable via DimensionRegistry, not hard-coded.
 *   Seed includes 7 SI bases (M,L,T,Temp,Substance,I,J) plus 4 generic
 *   (E,C,N,Info — Info added in Phase 21 for digital information).
 *   Further bases (e.g. Angle) can be registered via
 *   `new DimensionRegistry().register("X", "Xyz")`.
 * - Energy (E) is intentionally kept as a base dimension for backward
 *   compat, even though scientifically Energy = M·L²·T⁻². Changing it would
 *   be a breaking scientific change; migration path is documented in
 *   docs/DIMENSION_SPEC.md §14.15. Future derived dimensions (Force,
 *   Power, Pressure) are expressed as combinations, not new bases.
 * - Angle: treated as dimensionless (SI) with semantic metadata
 *   (`unit.metadata.category="angle"`), not a separate dimension, to preserve
 *   dimensional correctness while allowing practical distinction from pure
 *   ratios. Alternative is to register "Angle" as base via registry if needed.
 * - Information: explicit base dimension `Info` (Phase 21 decision — see
 *   21.26): digital information (bit/byte) is neither Count nor
 *   dimensionless. Decimal vs binary prefixes stay distinct at the unit
 *   level; the dimension only separates information from pure ratios.
 * - Currency (C) and Count (N) are isolated semantic categories, not
 *   universal physical dimensions; exchange rates are contextual, not
 *   dimensional conversions.
 * - Performance: dimensionKey is cached via interning; multiply/divide reuse
 *   frozen vectors; interning is bounded (see internDimension).
 * -----------------------------------------------------------------------
 */
import { DimensionError, InvalidDimensionError } from "./errors/index.js";

/** A dimension id is a registry-validated identifier (e.g. "M", "L", "Temp"). */
export type DimensionId = string;

/**
 * A sparse vector of integer exponents keyed by dimension id.
 * Zero exponents are never stored; the empty object is the dimensionless vector.
 */
export type DimensionVector = Readonly<Record<DimensionId, number>>;

export const DIMENSIONLESS: DimensionVector = Object.freeze({});

const DIMENSION_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------------------
// Dimension registry
// ---------------------------------------------------------------------------

export interface RegisteredDimension {
  readonly id: DimensionId;
  readonly name: string;
}

/**
 * Holds the set of known BASE dimensions and validates dimension ids.
 * This is deliberately NOT a unit registry: units and conversions are a
 * separate concept (see unit-registry.ts).
 */
export class DimensionRegistry {
  private readonly defs = new Map<DimensionId, string>();

  /**
   * A new registry inherits the standard seed dimensions so custom
   * registries EXTEND the known set; pass an explicit seed (possibly
   * empty) to build a fully isolated one.
   */
  constructor(seed: readonly RegisteredDimension[] = defaultDimensionRegistry.list()) {
    for (const def of seed) this.register(def.id, def.name);
  }

  /** Register a base dimension id (e.g. "L" / "Length"). Throws on collisions or bad ids. */
  register(id: DimensionId, name: string): void {
    assertValidDimensionId(id);
    const existing = this.defs.get(id);
    if (existing !== undefined) {
      throw new InvalidDimensionError(
        `dimension id "${id}" is already registered as "${existing}"`,
      );
    }
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new InvalidDimensionError("dimension name must be a non-empty string");
    }
    this.defs.set(id, name.trim());
  }

  has(id: DimensionId): boolean {
    return this.defs.has(id);
  }

  getName(id: DimensionId): string {
    return this.defs.get(id) ?? "";
  }

  list(): readonly RegisteredDimension[] {
    return [...this.defs.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Validate an exponent map against the registry; returns normalized frozen copy (interned). */
  normalize(vector: Record<string, number>): DimensionVector {
    const result: Record<string, number> = {};
    for (const id of Object.keys(vector)) {
      assertValidDimensionId(id);
      if (!this.defs.has(id)) {
        throw new InvalidDimensionError(`unregistered dimension id "${id}"`);
      }
      const exp: number | undefined = vector[id];
      if (!Number.isInteger(exp)) {
        throw new InvalidDimensionError(
          `exponent for "${id}" must be an integer, got ${String(exp)}`,
        );
      }
      if (exp !== 0) result[id] = exp as number;
    }
    const frozen = Object.freeze(result);
    return internDimension(frozen);
  }
}

function assertValidDimensionId(id: DimensionId): void {
  if (typeof id !== "string" || !DIMENSION_ID_PATTERN.test(id)) {
    throw new InvalidDimensionError(
      `"${String(id)}" is not a valid dimension id (expected /^[A-Za-z][A-Za-z0-9_]*$/)`,
    );
  }
}

/**
 * Seed registry shipped with the package:
 * - seven SI-style physical base dimensions, plus
 * - four generic engine dimensions (Energy, Currency, Count, Information)
 *   that the current public unit system requires. These are semantic
 *   categories, documented as such — they are ordinary components to
 *   the algebra.
 */
export const defaultDimensionRegistry = new DimensionRegistry([]);

function seed(registry: DimensionRegistry, id: DimensionId, name: string): void {
  registry.register(id, name);
}

seed(defaultDimensionRegistry, "M", "Mass");
seed(defaultDimensionRegistry, "L", "Length");
seed(defaultDimensionRegistry, "T", "Time");
seed(defaultDimensionRegistry, "Temp", "Temperature");
seed(defaultDimensionRegistry, "Substance", "Amount of substance");
seed(defaultDimensionRegistry, "I", "Electric current");
seed(defaultDimensionRegistry, "J", "Luminous intensity");
seed(defaultDimensionRegistry, "E", "Energy");
seed(defaultDimensionRegistry, "C", "Currency");
seed(defaultDimensionRegistry, "N", "Count / biological activity");
seed(defaultDimensionRegistry, "Info", "Information");

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Build a validated, frozen DimensionVector from a raw record.
 * Zero exponents are dropped; ids must be registered; exponents must be integers.
 */
export function defineDimension(vector: Record<string, number>): DimensionVector {
  return defaultDimensionRegistry.normalize(vector);
}

// ---------------------------------------------------------------------------
// Canonical representation & queries
// ---------------------------------------------------------------------------

/**
 * Deterministic, order-independent canonical key ("1" when dimensionless).
 * Suitable for equality checks, Map keys, caching and interning.
 */
export function dimensionKey(dim: DimensionVector): string {
  const keys = Object.keys(dim).sort();
  if (keys.length === 0) return "1";
  let key = "";
  for (const k of keys) key += `${k}^${dim[k]}·`;
  return key.slice(0, -1);
}

export function isDimensionless(dim: DimensionVector): boolean {
  return dimensionKey(dim) === "1";
}

export function dimensionsEqual(a: DimensionVector, b: DimensionVector): boolean {
  return dimensionKey(a) === dimensionKey(b);
}

// ---------------------------------------------------------------------------
// Interning (bounded, deterministic, no mutable leak)
// ---------------------------------------------------------------------------

const dimensionInternCache = new Map<string, DimensionVector>();
const MAX_INTERN = 1000;

function internDimension(dim: DimensionVector): DimensionVector {
  const key = dimensionKey(dim);
  const cached = dimensionInternCache.get(key);
  if (cached) return cached;
  if (dimensionInternCache.size >= MAX_INTERN) {
    const first = dimensionInternCache.keys().next().value as string | undefined;
    if (first) dimensionInternCache.delete(first);
  }
  dimensionInternCache.set(key, dim);
  return dim;
}

// Seed dimensionless interning
dimensionInternCache.set("1", DIMENSIONLESS);

// ---------------------------------------------------------------------------
// Algebra
// ---------------------------------------------------------------------------

/** A × B — add corresponding exponents. Returns a new frozen vector; inputs are never mutated. */
export function multiplyDim(a: DimensionVector, b: DimensionVector): DimensionVector {
  const result: Record<string, number> = { ...a };
  for (const k of Object.keys(b)) {
    const exp = (result[k] ?? 0) + (b[k] ?? 0);
    if (exp === 0) delete result[k];
    else result[k] = exp;
  }
  return internDimension(Object.freeze(result));
}

/** A / B — subtract corresponding exponents. Returns a new frozen vector; inputs are never mutated. */
export function divideDim(a: DimensionVector, b: DimensionVector): DimensionVector {
  const result: Record<string, number> = { ...a };
  for (const k of Object.keys(b)) {
    const exp = (result[k] ?? 0) - (b[k] ?? 0);
    if (exp === 0) delete result[k];
    else result[k] = exp;
  }
  return internDimension(Object.freeze(result));
}

/**
 * A^n — scale every exponent by the integer power n.
 * pow(A, 0) is the dimensionless vector; negative n inverts the vector.
 */
export function powDim(a: DimensionVector, power: number): DimensionVector {
  if (!Number.isInteger(power)) {
    throw new InvalidDimensionError(`power must be an integer, got ${power}`);
  }
  if (power === 0) return DIMENSIONLESS;
  const result: Record<string, number> = {};
  for (const k of Object.keys(a)) {
    const exp = (a[k] ?? 0) * power;
    if (exp !== 0) result[k] = exp;
  }
  return internDimension(Object.freeze(result));
}

/**
 * The n-th root of A — valid only when EVERY exponent is exactly divisible
 * by n (e.g. sqrt(L²) → L). Non-exact roots are rejected rather than
 * silently producing mathematically misleading dimensions.
 */
export function rootDim(a: DimensionVector, degree: number): DimensionVector {
  if (!Number.isInteger(degree) || degree <= 0) {
    throw new InvalidDimensionError(`root degree must be a positive integer, got ${degree}`);
  }
  const result: Record<string, number> = {};
  for (const k of Object.keys(a)) {
    const exp = a[k] ?? 0;
    if (exp % degree !== 0) {
      throw new DimensionError(dimensionKey(DIMENSIONLESS), `${dimensionKey(a)}^(1/${degree})`);
    }
    result[k] = exp / degree;
  }
  return internDimension(Object.freeze(result));
}

// ---------------------------------------------------------------------------
// Seeded convenience vectors (aliases over the generic algebra)
// ---------------------------------------------------------------------------

/**
 * Named base-dimension vectors. These are thin aliases over defineDimension()
 * — adding a new one is one line; nothing in the algebra knows they exist.
 */
function seededDim(id: DimensionId): DimensionVector {
  return defaultDimensionRegistry.normalize({ [id]: 1 });
}

export const Dim = Object.freeze({
  Dimensionless: DIMENSIONLESS,
  Mass: seededDim("M"),
  Length: seededDim("L"),
  Time: seededDim("T"),
  Temperature: seededDim("Temp"),
  Substance: seededDim("Substance"),
  Current: seededDim("I"),
  LuminousIntensity: seededDim("J"),
  Energy: seededDim("E"),
  Currency: seededDim("C"),
  Count: seededDim("N"),
  Information: seededDim("Info"),
});
