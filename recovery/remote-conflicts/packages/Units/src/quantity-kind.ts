/**
 * quantity-kind.ts
 * -----------------------------------------------------------------------
 * Single responsibility: the SEMANTIC quantity-kind layer (Phase 22).
 *
 *     Dimension = mathematical structure (kg·m/s² vs N — interchangeable)
 *     Kind      = scientific meaning    (Bq vs Hz — same T⁻¹, NOT interchangeable
 *                 to a semantic-aware caller; Gy vs Sv — same E·M⁻¹, distinct)
 *
 * The kind layer NEVER replaces dimensions: every dimensional check in the
 * engine runs exactly as before. Kinds are opt-in metadata carried on
 * `Unit.metadata.kind` (populated by the packs) and surfaced as
 * `Quantity.kind`. A basic user writes `Quantity.of(10, "kg")` and never
 * hears about kinds; advanced users opt into `semantic-aware` or
 * `strict-semantic` policies per call.
 *
 * Default policy is "dimensional-only" — existing behavior byte-for-byte.
 *
 * Design constraints:
 * - Registration is data only (no functions, no code execution); kinds are
 *   frozen; registries are isolated (no global mutable state beyond the
 *   default seed, which is append-only via register()).
 * - This module is Quantity-agnostic (no import of quantity.js) so the
 *   dependency arrow points one way (quantity → quantity-kind). No cycles.
 * -----------------------------------------------------------------------
 */
import { defineDimension, type DimensionVector } from "./dimension.js";
import {
  IncompatibleQuantityKindError,
  MissingSemanticContextError,
  UnitEngineError,
  UnsupportedSemanticConversionError,
} from "./errors/index.js";

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * Strictness of semantic checking:
 * - "dimensional-only": kinds ignored entirely (default, legacy behavior).
 * - "semantic-aware":   same kind, or either side unknown (no claim), or an
 *   explicitly registered compatibility — otherwise incompatible.
 * - "strict-semantic":   kinds must be identical (unknown === unknown counts
 *   as identical; unknown vs known is incompatible).
 */
export type SemanticPolicy = "dimensional-only" | "semantic-aware" | "strict-semantic";

const POLICY_PATTERN = /^(dimensional-only|semantic-aware|strict-semantic)$/;

export function isSemanticPolicy(value: unknown): value is SemanticPolicy {
  return typeof value === "string" && POLICY_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Kind definition
// ---------------------------------------------------------------------------

export interface QuantityKind {
  /** Stable id referenced by `Unit.metadata.kind` (e.g. "angle"). */
  readonly id: string;
  /** Human-readable name (e.g. "Plane angle"). */
  readonly name: string;
  /** The dimension quantities of this kind must have. */
  readonly dimension: DimensionVector;
  /** Documentation string (no behavior). */
  readonly description?: string;
  /**
   * Other kind ids explicitly treated as compatible (checked symmetrically:
   * listing on either side suffices). Empty/absent means none.
   */
  readonly compatibleKinds?: readonly string[];
  /**
   * When true, converting into/out of this kind requires caller context
   * (reference value, standard, …) — conversions without context fail
   * explicitly instead of guessing. No seed kind sets this; it exists for
   * host-defined kinds (e.g. a future decibel model).
   */
  readonly requiresContext?: boolean;
  /** Declarative metadata only (validated: no functions/symbols). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const KIND_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function assertDeclarative(value: unknown, owner: string, depth = 0): void {
  if (depth > 4) throw new UnitEngineError(`${owner} metadata is nested too deeply`);
  if (value === null || value === undefined) return;
  const t = typeof value;
  if (t === "function" || t === "symbol") {
    throw new UnitEngineError(`${owner} metadata must not contain executable values`);
  }
  if (t !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertDeclarative(item, owner, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(record, "__proto__") ||
    Object.prototype.hasOwnProperty.call(record, "constructor") ||
    Object.prototype.hasOwnProperty.call(record, "prototype")
  ) {
    throw new UnitEngineError(`${owner} metadata contains forbidden keys`);
  }
  for (const v of Object.values(record)) assertDeclarative(v, owner, depth + 1);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class QuantityKindRegistry {
  private readonly kinds = new Map<string, QuantityKind>();

  constructor(seed: readonly QuantityKind[] = defaultSeedKinds()) {
    for (const kind of seed) this.register(kind);
  }

  /** Register a kind (data only). Throws on bad ids, duplicates, pollution. */
  register(kind: QuantityKind): void {
    if (!kind || typeof kind !== "object" || Array.isArray(kind)) {
      throw new UnitEngineError("Quantity kind must be a plain object");
    }
    const record = kind as unknown as Record<string, unknown>;
    if (
      Object.prototype.hasOwnProperty.call(record, "__proto__") ||
      Object.prototype.hasOwnProperty.call(record, "constructor") ||
      Object.prototype.hasOwnProperty.call(record, "prototype")
    ) {
      throw new UnitEngineError("Quantity kind contains forbidden keys");
    }
    if (typeof kind.id !== "string" || !KIND_ID_PATTERN.test(kind.id)) {
      throw new UnitEngineError(
        `Quantity kind id must match /^[a-z][a-z0-9-]*$/, got "${String(kind.id)}"`,
      );
    }
    if (this.kinds.has(kind.id)) {
      throw new UnitEngineError(`Quantity kind "${kind.id}" is already registered`);
    }
    if (typeof kind.name !== "string" || kind.name.trim().length === 0) {
      throw new UnitEngineError(`Quantity kind "${kind.id}" needs a non-empty name`);
    }
    if (!kind.dimension || typeof kind.dimension !== "object" || Array.isArray(kind.dimension)) {
      throw new UnitEngineError(`Quantity kind "${kind.id}" needs a dimension vector`);
    }
    if (kind.compatibleKinds !== undefined) {
      if (
        !Array.isArray(kind.compatibleKinds) ||
        kind.compatibleKinds.some((c) => typeof c !== "string")
      ) {
        throw new UnitEngineError(
          `Quantity kind "${kind.id}" compatibleKinds must be an array of kind-id strings`,
        );
      }
      if (kind.compatibleKinds.includes(kind.id)) {
        throw new UnitEngineError(`Quantity kind "${kind.id}" cannot list itself as compatible`);
      }
    }
    assertDeclarative(kind.metadata, `Quantity kind "${kind.id}"`);
    this.kinds.set(
      kind.id,
      Object.freeze({
        ...kind,
        dimension: Object.freeze({ ...kind.dimension }),
        compatibleKinds:
          kind.compatibleKinds === undefined ? undefined : Object.freeze([...kind.compatibleKinds]),
      }),
    );
  }

  has(id: string): boolean {
    return this.kinds.has(id);
  }

  /** Look up a kind; throws UnitEngineError for unknown ids (fail explicitly). */
  require(id: string): QuantityKind {
    const kind = this.kinds.get(id);
    if (!kind) throw new UnitEngineError(`Unknown quantity kind "${id}"`);
    return kind;
  }

  list(): readonly QuantityKind[] {
    return [...this.kinds.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Immutable snapshot: a detached registry sharing the frozen entries.
   * Entries are never mutated in place, so sharing is safe; later
   * registrations on either side stay isolated (reproducibility).
   */
  snapshot(): QuantityKindRegistry {
    const snap = new QuantityKindRegistry([]);
    for (const [id, kind] of this.kinds) snap.kinds.set(id, kind);
    return snap;
  }
}

// ---------------------------------------------------------------------------
// Seed kinds (generic scientific semantics — no domain logic)
// ---------------------------------------------------------------------------

function defaultSeedKinds(): readonly QuantityKind[] {
  const dimensionless = defineDimension({});
  return [
    {
      id: "angle",
      name: "Plane angle",
      dimension: dimensionless,
      description: "Plane angle (rad, deg, rev). Dimensionless per SI; kind-gated for trig.",
    },
    {
      id: "solid-angle",
      name: "Solid angle",
      dimension: dimensionless,
      description: "Solid angle (sr). Dimensionless per SI; distinct kind from plane angle.",
    },
    {
      id: "frequency",
      name: "Frequency",
      dimension: defineDimension({ T: -1 }),
      description: "Periodic-event rate (Hz). Same dimension as activity, different kind.",
    },
    {
      id: "activity",
      name: "Radioactivity",
      dimension: defineDimension({ T: -1 }),
      description: "Nuclear decay rate (Bq, Ci). Same dimension as frequency, different kind.",
    },
    {
      id: "absorbed-dose",
      name: "Absorbed dose",
      dimension: defineDimension({ E: 1, M: -1 }),
      description: "Energy deposited per mass (Gy, rd). Same dimension vector as equivalent dose.",
    },
    {
      id: "equivalent-dose",
      name: "Equivalent dose",
      dimension: defineDimension({ E: 1, M: -1 }),
      description: "Biologically weighted dose (Sv, rem). Same dimension vector as absorbed dose.",
    },
    {
      id: "temperature-absolute",
      name: "Absolute temperature",
      dimension: defineDimension({ Temp: 1 }),
      description: "Thermodynamic temperature on an absolute scale (K, °C, °F, °R).",
    },
    {
      id: "temperature-difference",
      name: "Temperature difference",
      dimension: defineDimension({ Temp: 1 }),
      description:
        "Temperature interval (ΔK = Δ°C). Same dimension as absolute; intervals and absolutes must not mix silently.",
    },
    {
      id: "luminous-intensity",
      name: "Luminous intensity",
      dimension: defineDimension({ J: 1 }),
      description: "Photometric base quantity (cd).",
    },
    {
      id: "luminous-flux",
      name: "Luminous flux",
      dimension: defineDimension({ J: 1 }),
      description: "Photometric flux (lm = cd·sr). Same dimension as intensity, different kind.",
    },
    {
      id: "illuminance",
      name: "Illuminance",
      dimension: defineDimension({ J: 1, L: -2 }),
      description: "Flux per area (lx).",
    },
    {
      id: "information",
      name: "Digital information",
      dimension: defineDimension({ Info: 1 }),
      description: "Digital information (bit, byte). Dedicated dimension, not a pure ratio.",
    },
  ];
}

/** Shared seed registry (append-only; isolated registries via `new QuantityKindRegistry()`). */
export const defaultQuantityKindRegistry = new QuantityKindRegistry();

// ---------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------

/**
 * Are two kinds compatible under a policy? `undefined` means "no semantic
 * claim" (generic quantity). Dimensions are NOT checked here — the engine
 * always checks dimensions separately first.
 */
export function areKindsCompatible(
  a: string | undefined,
  b: string | undefined,
  policy: SemanticPolicy,
  registry: QuantityKindRegistry = defaultQuantityKindRegistry,
): boolean {
  if (!isSemanticPolicy(policy)) {
    throw new UnitEngineError(`Unknown semantic policy "${String(policy)}"`);
  }
  if (policy === "dimensional-only") return true;
  if (a === b) return true; // identical kinds — and unknown === unknown
  if (policy === "strict-semantic") return false;
  // semantic-aware from here: unknown sides carry no claim, so they pass;
  // known-different kinds need an explicit compatibility listing.
  if (a === undefined || b === undefined) return true;
  const aDef = registry.has(a) ? registry.require(a) : undefined;
  const bDef = registry.has(b) ? registry.require(b) : undefined;
  if (aDef?.compatibleKinds?.includes(b)) return true;
  if (bDef?.compatibleKinds?.includes(a)) return true;
  return false;
}

/** Throw IncompatibleQuantityKindError unless compatible under the policy. */
export function assertSemanticCompatible(
  a: string | undefined,
  b: string | undefined,
  policy: SemanticPolicy,
  registry: QuantityKindRegistry = defaultQuantityKindRegistry,
): void {
  if (!areKindsCompatible(a, b, policy, registry)) {
    throw new IncompatibleQuantityKindError(a, b, policy);
  }
}

export interface SemanticConversionOptions {
  readonly policy?: SemanticPolicy;
  /** Caller context for kinds with requiresContext (reference, standard, …). */
  readonly context?: unknown;
  readonly registry?: QuantityKindRegistry;
}

/**
 * Gate a conversion between two kinds (22.13): compatibility first, then
 * context. Throws UnsupportedSemanticConversionError when the kinds cannot
 * convert under the policy, MissingSemanticContextError when a participating
 * kind requires context and none was provided. No numeric conversion happens
 * here — the dimension engine still does the math.
 */
export function assertSemanticConvertible(
  fromKind: string | undefined,
  toKind: string | undefined,
  opts: SemanticConversionOptions = {},
): void {
  const policy = opts.policy ?? "semantic-aware";
  const registry = opts.registry ?? defaultQuantityKindRegistry;
  if (policy === "dimensional-only") return; // kinds ignored entirely (legacy behavior)
  if (!areKindsCompatible(fromKind, toKind, policy, registry)) {
    throw new UnsupportedSemanticConversionError(fromKind ?? "unknown", toKind ?? "unknown");
  }
  for (const kindId of [fromKind, toKind]) {
    if (kindId === undefined) continue;
    const def = registry.has(kindId) ? registry.require(kindId) : undefined;
    if (def?.requiresContext === true && opts.context === undefined) {
      throw new MissingSemanticContextError(kindId, "caller-provided reference/standard");
    }
  }
}

/** Shape guard for kind ids (string pattern only — membership via registry.has). */
export function isQuantityKindId(value: unknown): value is string {
  return typeof value === "string" && KIND_ID_PATTERN.test(value);
}
