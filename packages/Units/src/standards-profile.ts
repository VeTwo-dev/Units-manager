/**
 * standards-profile.ts — Phase 28: unit systems, standards profiles and
 * multi-system interoperability.
 *
 * Layering (nothing here replaces anything):
 * - `Unit` stays the physical representation; `UnitSystem` (unit-system.ts)
 *   stays the unit collection; `UnitRegistry` stays the resolver.
 * - `StandardsProfile` adds POLICY on top: preferred/allowed/deprecated
 *   units, symbol and formatting conventions, conversion policy and
 *   reference-data pins. Policy never changes identity.
 * - `ScientificContext` bundles {unitSystem, profile, referenceData,
 *   formatting} so call sites pass one object, not a dozen options.
 * - All conversion goes through the existing conversion engine
 *   (`Quantity.to` / `Measurement.to`); this module only SELECTS targets
 *   and validates policy. Affine, logarithmic and semantic-kind guards are
 *   enforced, never bypassed.
 *
 * Internal canonical representation is untouched: quantities store their
 * own unit; systems/profiles only affect display, normalization targets
 * and validation. No global mutable state — registries are instances.
 */
import { Quantity } from "./quantity.js";
import { Measurement } from "./measurement.js";
import type { Unit } from "./unit.js";
import { defaultUnitRegistry, type UnitRegistry } from "./unit-registry.js";
import {
  defaultUnitSystemRegistry,
  CGS_SYSTEM,
  IMPERIAL_SYSTEM,
  SI_SYSTEM,
  US_CUSTOMARY_SYSTEM,
  type UnitSystem,
  type UnitSystemRegistry,
} from "./unit-system.js";
import { defaultPrefixRegistry, type PrefixRegistry } from "./prefix.js";
import {
  dimensionKey,
  dimensionsEqual,
  defineDimension,
  type DimensionVector,
} from "./dimension.js";
import { parseUnit } from "./unit-parser.js";
import { formatQuantity, type FormatOptions } from "./formatter.js";
import { evaluateFormula, type Formula, type FormulaBindings } from "./formula.js";
import type { SemanticPolicy } from "./quantity-kind.js";
import {
  InvalidMeasurementError,
  UnitEngineError,
  UnsupportedTransformationError,
} from "./errors/index.js";
import { UnitSystemError } from "./unit-system.js";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export interface ProfileLimits {
  /** Maximum profiles per registry (default 64). */
  readonly maxProfiles?: number;
  /** Maximum preferred/allowed/deprecated entries per profile (default 4096). */
  readonly maxUnitsPerProfile?: number;
  /** Maximum import-mapping entries (default 1024). */
  readonly maxMappings?: number;
  /** Maximum `extends` chain depth (default 16). */
  readonly maxInheritanceDepth?: number;
  /** Maximum serialized JSON characters accepted (default 1048576). */
  readonly maxSerializedChars?: number;
}

const DEFAULT_LIMITS = Object.freeze({
  maxProfiles: 64,
  maxUnitsPerProfile: 4096,
  maxMappings: 1024,
  maxInheritanceDepth: 16,
  maxSerializedChars: 1048576,
});

function resolveLimits(limits?: ProfileLimits): {
  maxProfiles: number;
  maxUnitsPerProfile: number;
  maxMappings: number;
  maxInheritanceDepth: number;
  maxSerializedChars: number;
} {
  const r = {
    maxProfiles: limits?.maxProfiles ?? DEFAULT_LIMITS.maxProfiles,
    maxUnitsPerProfile: limits?.maxUnitsPerProfile ?? DEFAULT_LIMITS.maxUnitsPerProfile,
    maxMappings: limits?.maxMappings ?? DEFAULT_LIMITS.maxMappings,
    maxInheritanceDepth: limits?.maxInheritanceDepth ?? DEFAULT_LIMITS.maxInheritanceDepth,
    maxSerializedChars: limits?.maxSerializedChars ?? DEFAULT_LIMITS.maxSerializedChars,
  };
  for (const [k, v] of Object.entries(r)) {
    if (!Number.isInteger(v) || v < 1) {
      throw new UnitEngineError(`Profile limit ${k} must be a positive integer.`);
    }
  }
  return r;
}

function hasPollutionKeys(obj: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(obj, "__proto__") ||
    Object.prototype.hasOwnProperty.call(obj, "constructor") ||
    Object.prototype.hasOwnProperty.call(obj, "prototype")
  );
}

function assertPlainRecord(value: unknown, what: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new UnitSystemError(`${what} must be a plain object`);
  }
  if (hasPollutionKeys(value as Record<string, unknown>)) {
    throw new UnitSystemError(`${what} contains forbidden prototype keys`);
  }
}

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

function assertProfileId(id: string, what = "StandardsProfile id"): void {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new UnitSystemError(`${what} must match /^[A-Za-z][A-Za-z0-9_-]*$/`);
  }
}

// ---------------------------------------------------------------------------
// 28.4 StandardsProfile
// ---------------------------------------------------------------------------

export type UnitStatus = "preferred" | "accepted" | "deprecated" | "forbidden" | "unknown";

export interface SymbolConventions {
  /** Multiplication glyph for display (default "·"). */
  readonly multiplication?: string;
  /** Power rendering: superscript glyphs or caret (default "superscript"). */
  readonly power?: "superscript" | "caret";
}

export interface ProfileFormatting {
  readonly notation?: "standard" | "scientific" | "engineering";
  readonly decimals?: number;
  readonly ascii?: boolean;
  readonly showKind?: boolean;
}

export interface ConversionPolicy {
  /** Allow affine-unit conversions (default true — engine semantics apply). */
  readonly allowAffine?: boolean;
  /** Reject logarithmic/custom units even for display (default true). */
  readonly rejectNonlinear?: boolean;
  /** Semantic strictness applied on conversions (default "dimensional-only"). */
  readonly semanticPolicy?: SemanticPolicy;
}

export interface StandardsProfile {
  readonly id: string;
  readonly version: string;
  readonly displayName?: string;
  readonly description?: string;
  /** Name of a UnitSystem (resolved against a UnitSystemRegistry). */
  readonly unitSystem: string;
  /** Preferred display unit per canonical dimension key (e.g. {"M^1": "kg"}). */
  readonly preferredUnits?: Readonly<Record<string, string>>;
  /** Allowed unit symbols; absent means "not restricted". */
  readonly allowedUnits?: readonly string[];
  /** Deprecated symbols with reasons (units stay resolvable). */
  readonly deprecatedUnits?: Readonly<Record<string, string>>;
  readonly symbolConventions?: SymbolConventions;
  readonly formatting?: ProfileFormatting;
  readonly conversionPolicy?: ConversionPolicy;
  /** Pinned reference datasets: name → version (data only). */
  readonly referenceData?: Readonly<Record<string, string>>;
  /** Parent profile id for single inheritance (resolved at registration). */
  readonly extends?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// ProfileRegistry
// ---------------------------------------------------------------------------

export interface ProfileRegistryOptions {
  readonly limits?: ProfileLimits;
}

export interface ProfileRegistryOptions {
  readonly limits?: ProfileLimits;
}

export class ProfileRegistry {
  private readonly profiles = new Map<string, StandardsProfile>();
  private _version = 0;
  private readonly limits?: ProfileLimits;

  constructor(opts: ProfileRegistryOptions = {}) {
    if (opts.limits !== undefined) resolveLimits(opts.limits); // validate eagerly
    this.limits = opts.limits;
  }

  /** Generation counter for cache invalidation (mirrors UnitSystemRegistry). */
  get version(): number {
    return this._version;
  }

  /**
   * Register a profile. `extends` parents must already be registered, which
   * makes inheritance cycles structurally impossible (self-extend and
   * unknown parents throw). The stored profile is flattened (parent values
   * inherited, child wins) and frozen; `extends` is recorded, not followed
   * at read time.
   */
  register(profile: StandardsProfile): StandardsProfile {
    const limits = resolveLimits(this.limits);
    if (this.profiles.size >= limits.maxProfiles) {
      throw new UnitSystemError(`ProfileRegistry exceeds maxProfiles ${limits.maxProfiles}`);
    }
    assertPlainRecord(profile, "StandardsProfile");
    assertProfileId(profile.id);
    if (typeof profile.version !== "string" || profile.version.trim().length === 0) {
      throw new UnitSystemError(`StandardsProfile "${profile.id}" needs a non-empty version`);
    }
    if (this.profiles.has(profile.id)) {
      throw new UnitSystemError(`StandardsProfile "${profile.id}" is already registered`);
    }
    if (typeof profile.unitSystem !== "string" || profile.unitSystem.length === 0) {
      throw new UnitSystemError(`StandardsProfile "${profile.id}" needs a unitSystem name`);
    }
    let base: StandardsProfile | undefined;
    if (profile.extends !== undefined) {
      if (profile.extends === profile.id) {
        throw new UnitSystemError(`StandardsProfile "${profile.id}" cannot extend itself`);
      }
      base = this.profiles.get(profile.extends);
      if (!base) {
        throw new UnitSystemError(
          `StandardsProfile "${profile.id}" extends unknown profile "${profile.extends}" (register parents first)`,
        );
      }
    }
    const merged = base ? inheritProfile(base, profile, limits) : profile;
    validateProfileShape(merged, limits);
    const frozen = freezeProfile(merged);
    this.profiles.set(frozen.id, frozen);
    this._version++;
    return frozen;
  }

  unregister(id: string): StandardsProfile | undefined {
    const removed = this.profiles.get(id);
    if (removed === undefined) return undefined;
    // Dependents keep their flattened copies — unregister never cascades.
    this.profiles.delete(id);
    this._version++;
    return removed;
  }

  get(id: string): StandardsProfile {
    const p = this.profiles.get(id);
    if (!p) throw new UnitSystemError(`Unknown StandardsProfile "${id}"`);
    return p;
  }

  has(id: string): boolean {
    return this.profiles.has(id);
  }

  list(): readonly StandardsProfile[] {
    return [...this.profiles.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /**
   * Immutable snapshot: a detached registry sharing the frozen profiles.
   * Later registrations on either side stay isolated (reproducibility).
   */
  snapshot(): ProfileRegistry {
    const snap = new ProfileRegistry({ limits: this.limits });
    for (const [id, profile] of this.profiles) snap.profiles.set(id, profile);
    snap._version = this._version;
    return snap;
  }

  serialize(): SerializedProfileRegistry {
    return Object.freeze({
      version: 1 as const,
      type: "profile-registry" as const,
      profiles: Object.freeze(this.list().map(serializeProfile)),
    });
  }

  static deserialize(data: unknown, opts: ProfileRegistryOptions = {}): ProfileRegistry {
    const limits = resolveLimits(opts.limits);
    if (typeof data === "string") {
      if (data.length > limits.maxSerializedChars) {
        throw new UnitSystemError(
          `Serialized profile registry exceeds maxSerializedChars ${limits.maxSerializedChars}`,
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        throw new UnitSystemError("Malformed serialized profile registry: invalid JSON");
      }
      return ProfileRegistry.deserialize(parsed, opts);
    }
    assertPlainRecord(data, "Serialized profile registry");
    if (data.version !== 1) {
      if (data.version === undefined)
        throw new UnitSystemError("Serialized profile registry missing version");
      throw new UnitSystemError(`Unsupported profile registry version ${String(data.version)}`);
    }
    if (data.type !== "profile-registry") {
      throw new UnitSystemError(
        `Serialized profile registry has wrong type "${String(data.type)}"`,
      );
    }
    if (!Array.isArray(data.profiles)) {
      throw new UnitSystemError("Serialized profile registry needs a profiles array");
    }
    if (data.profiles.length > limits.maxProfiles) {
      throw new UnitSystemError(
        `Serialized profile registry has too many profiles (max ${limits.maxProfiles})`,
      );
    }
    const registry = new ProfileRegistry(opts);
    // Order-independent: deferred entries retry until parents appear.
    // Serialized order is alphabetical, so children routinely precede
    // parents — a single pass would spuriously reject them.
    const pending = [...(data.profiles as unknown[])];
    let previous = pending.length + 1;
    while (pending.length > 0 && pending.length < previous) {
      previous = pending.length;
      for (let i = pending.length - 1; i >= 0; i--) {
        try {
          registry.register(deserializeProfile(pending[i], limits));
          pending.splice(i, 1);
        } catch (error) {
          if (
            !(error instanceof UnitSystemError) ||
            !/extends unknown profile/.test(error.message)
          ) {
            throw error;
          }
          // Defer: parent may arrive later in the array.
        }
      }
    }
    if (pending.length > 0) {
      // Genuinely unresolvable (unknown parent or dependency cycle).
      registry.register(deserializeProfile(pending[0], limits));
    }
    return registry;
  }
}

/** Merge parent → child (child wins; sets union; depth-bounded by construction). */
function inheritProfile(
  base: StandardsProfile,
  child: StandardsProfile,
  limits: ReturnType<typeof resolveLimits>,
): StandardsProfile {
  void limits;
  const union = (a?: readonly string[], b?: readonly string[]): readonly string[] | undefined => {
    if (a === undefined) return b;
    if (b === undefined) return a;
    return [...new Set([...a, ...b])].sort();
  };
  return {
    ...base,
    ...child,
    preferredUnits: { ...(base.preferredUnits ?? {}), ...(child.preferredUnits ?? {}) },
    deprecatedUnits: { ...(base.deprecatedUnits ?? {}), ...(child.deprecatedUnits ?? {}) },
    allowedUnits: union(base.allowedUnits, child.allowedUnits),
    symbolConventions: { ...(base.symbolConventions ?? {}), ...(child.symbolConventions ?? {}) },
    formatting: { ...(base.formatting ?? {}), ...(child.formatting ?? {}) },
    conversionPolicy: { ...(base.conversionPolicy ?? {}), ...(child.conversionPolicy ?? {}) },
    referenceData: { ...(base.referenceData ?? {}), ...(child.referenceData ?? {}) },
    metadata: { ...(base.metadata ?? {}), ...(child.metadata ?? {}) },
  };
}

function countEntries(profile: StandardsProfile): number {
  return (
    Object.keys(profile.preferredUnits ?? {}).length +
    (profile.allowedUnits?.length ?? 0) +
    Object.keys(profile.deprecatedUnits ?? {}).length
  );
}

function validateProfileShape(
  profile: StandardsProfile,
  limits: ReturnType<typeof resolveLimits>,
): void {
  if (countEntries(profile) > limits.maxUnitsPerProfile) {
    throw new UnitSystemError(
      `StandardsProfile "${profile.id}" has too many unit entries (max ${limits.maxUnitsPerProfile})`,
    );
  }
  for (const [key, symbol] of Object.entries(profile.preferredUnits ?? {})) {
    if (typeof key !== "string" || typeof symbol !== "string" || symbol.length === 0) {
      throw new UnitSystemError(
        `StandardsProfile "${profile.id}" has a malformed preferredUnits entry`,
      );
    }
  }
  if (profile.allowedUnits !== undefined) {
    if (!Array.isArray(profile.allowedUnits)) {
      throw new UnitSystemError(`StandardsProfile "${profile.id}" allowedUnits must be an array`);
    }
    const seen = new Set<string>();
    for (const symbol of profile.allowedUnits) {
      if (typeof symbol !== "string" || symbol.length === 0) {
        throw new UnitSystemError(
          `StandardsProfile "${profile.id}" allowedUnits must be symbol strings`,
        );
      }
      if (seen.has(symbol)) {
        throw new UnitSystemError(
          `StandardsProfile "${profile.id}" allowedUnits lists "${symbol}" twice`,
        );
      }
      seen.add(symbol);
    }
  }
  if (profile.deprecatedUnits !== undefined) {
    assertPlainRecord(profile.deprecatedUnits, `StandardsProfile "${profile.id}" deprecatedUnits`);
    for (const [symbol, reason] of Object.entries(profile.deprecatedUnits)) {
      if (typeof reason !== "string" || reason.length === 0) {
        throw new UnitSystemError(
          `StandardsProfile "${profile.id}" deprecatedUnits["${symbol}"] needs a reason string`,
        );
      }
    }
  }
  if (
    profile.symbolConventions?.power !== undefined &&
    profile.symbolConventions.power !== "superscript" &&
    profile.symbolConventions.power !== "caret"
  ) {
    throw new UnitSystemError(
      `StandardsProfile "${profile.id}" symbolConventions.power must be "superscript" or "caret"`,
    );
  }
  if (
    profile.formatting?.notation !== undefined &&
    !["standard", "scientific", "engineering"].includes(profile.formatting.notation)
  ) {
    throw new UnitSystemError(`StandardsProfile "${profile.id}" formatting.notation is unknown`);
  }
  if (
    profile.formatting?.decimals !== undefined &&
    (!Number.isInteger(profile.formatting.decimals) || profile.formatting.decimals < 0)
  ) {
    throw new UnitSystemError(
      `StandardsProfile "${profile.id}" formatting.decimals must be a non-negative integer`,
    );
  }
  if (profile.referenceData !== undefined) {
    assertPlainRecord(profile.referenceData, `StandardsProfile "${profile.id}" referenceData`);
    for (const [name, version] of Object.entries(profile.referenceData)) {
      if (typeof version !== "string" || version.length === 0) {
        throw new UnitSystemError(
          `StandardsProfile "${profile.id}" referenceData["${name}"] needs a version string`,
        );
      }
    }
  }
  if (profile.metadata !== undefined) {
    assertPlainRecord(profile.metadata, `StandardsProfile "${profile.id}" metadata`);
  }
}

function freezeProfile(profile: StandardsProfile): StandardsProfile {
  return Object.freeze({
    ...profile,
    preferredUnits: profile.preferredUnits
      ? Object.freeze({ ...profile.preferredUnits })
      : undefined,
    allowedUnits: profile.allowedUnits ? Object.freeze([...profile.allowedUnits]) : undefined,
    deprecatedUnits: profile.deprecatedUnits
      ? Object.freeze({ ...profile.deprecatedUnits })
      : undefined,
    symbolConventions: profile.symbolConventions
      ? Object.freeze({ ...profile.symbolConventions })
      : undefined,
    formatting: profile.formatting ? Object.freeze({ ...profile.formatting }) : undefined,
    conversionPolicy: profile.conversionPolicy
      ? Object.freeze({ ...profile.conversionPolicy })
      : undefined,
    referenceData: profile.referenceData ? Object.freeze({ ...profile.referenceData }) : undefined,
    metadata: profile.metadata ? Object.freeze({ ...profile.metadata }) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Profile serialization
// ---------------------------------------------------------------------------

export interface SerializedStandardsProfile {
  readonly version: 1;
  readonly type: "standards-profile";
  readonly id: string;
  readonly profileVersion: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly unitSystem: string;
  readonly preferredUnits?: Readonly<Record<string, string>>;
  readonly allowedUnits?: readonly string[];
  readonly deprecatedUnits?: Readonly<Record<string, string>>;
  readonly symbolConventions?: SymbolConventions;
  readonly formatting?: ProfileFormatting;
  readonly conversionPolicy?: ConversionPolicy;
  readonly referenceData?: Readonly<Record<string, string>>;
  readonly extends?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SerializedProfileRegistry {
  readonly version: 1;
  readonly type: "profile-registry";
  readonly profiles: readonly SerializedStandardsProfile[];
}

export function serializeProfile(profile: StandardsProfile): SerializedStandardsProfile {
  return Object.freeze({
    version: 1 as const,
    type: "standards-profile" as const,
    id: profile.id,
    profileVersion: profile.version,
    ...(profile.displayName !== undefined ? { displayName: profile.displayName } : {}),
    ...(profile.description !== undefined ? { description: profile.description } : {}),
    unitSystem: profile.unitSystem,
    ...(profile.preferredUnits !== undefined ? { preferredUnits: profile.preferredUnits } : {}),
    ...(profile.allowedUnits !== undefined ? { allowedUnits: profile.allowedUnits } : {}),
    ...(profile.deprecatedUnits !== undefined ? { deprecatedUnits: profile.deprecatedUnits } : {}),
    ...(profile.symbolConventions !== undefined
      ? { symbolConventions: profile.symbolConventions }
      : {}),
    ...(profile.formatting !== undefined ? { formatting: profile.formatting } : {}),
    ...(profile.conversionPolicy !== undefined
      ? { conversionPolicy: profile.conversionPolicy }
      : {}),
    ...(profile.referenceData !== undefined ? { referenceData: profile.referenceData } : {}),
    ...(profile.extends !== undefined ? { extends: profile.extends } : {}),
    ...(profile.metadata !== undefined ? { metadata: profile.metadata } : {}),
  });
}

export function deserializeProfile(data: unknown, limits?: ProfileLimits): StandardsProfile {
  const resolved = resolveLimits(limits);
  void resolved;
  assertPlainRecord(data, "Serialized standards profile");
  if (data.version !== 1) {
    if (data.version === undefined)
      throw new UnitSystemError("Serialized standards profile missing version");
    throw new UnitSystemError(`Unsupported standards profile version ${String(data.version)}`);
  }
  if (data.type !== "standards-profile") {
    throw new UnitSystemError(`Serialized profile has wrong type "${String(data.type)}"`);
  }
  if (typeof data.id !== "string") throw new UnitSystemError("Serialized profile missing id");
  if (typeof data.profileVersion !== "string")
    throw new UnitSystemError("Serialized profile missing profileVersion");
  if (typeof data.unitSystem !== "string")
    throw new UnitSystemError("Serialized profile missing unitSystem");
  const profile: StandardsProfile = {
    id: data.id,
    version: data.profileVersion,
    ...(typeof data.displayName === "string" ? { displayName: data.displayName } : {}),
    ...(typeof data.description === "string" ? { description: data.description } : {}),
    unitSystem: data.unitSystem,
    ...(isStringRecord(data.preferredUnits) ? { preferredUnits: data.preferredUnits } : {}),
    ...(Array.isArray(data.allowedUnits)
      ? { allowedUnits: [...(data.allowedUnits as string[])] }
      : {}),
    ...(isStringRecord(data.deprecatedUnits) ? { deprecatedUnits: data.deprecatedUnits } : {}),
    ...(isRecord(data.symbolConventions)
      ? { symbolConventions: data.symbolConventions as SymbolConventions }
      : {}),
    ...(isRecord(data.formatting) ? { formatting: data.formatting as ProfileFormatting } : {}),
    ...(isRecord(data.conversionPolicy)
      ? { conversionPolicy: data.conversionPolicy as ConversionPolicy }
      : {}),
    ...(isStringRecord(data.referenceData) ? { referenceData: data.referenceData } : {}),
    ...(typeof data.extends === "string" ? { extends: data.extends } : {}),
    ...(isRecord(data.metadata) ? { metadata: data.metadata as Record<string, unknown> } : {}),
  };
  // Shape validation happens at registration; validate eagerly here too so
  // malformed payloads fail even without a registry round-trip.
  validateProfileShape(profile, resolveLimits(limits));
  return profile;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    isRecord(v) && !hasPollutionKeys(v) && Object.values(v).every((x) => typeof x === "string")
  );
}

// ---------------------------------------------------------------------------
// 28.2 Base-unit mapping, preferred units, availability
// ---------------------------------------------------------------------------

/** Dimension key → UnitSystem preferredUnits category for single-base dimensions. */
const BASE_DIMENSION_CATEGORIES: Readonly<Record<string, string>> = Object.freeze({
  "M^1": "mass",
  "L^1": "length",
  "T^1": "time",
  "Temp^1": "temperature",
  "E^1": "energy",
  "I^1": "electric current",
  "Substance^1": "amount of substance",
  "J^1": "luminous intensity",
  "N^1": "count",
  "C^1": "currency",
});

export interface UnitResolutionOptions {
  readonly systems?: UnitSystemRegistry;
  readonly registry?: UnitRegistry;
}

/**
 * Preferred display symbol for a dimension: profile mapping first, then the
 * system's category preference for single-base dimensions. Composite
 * dimensions need an explicit profile entry — guessing across systems
 * would be silently wrong. Returns undefined when nothing claims it.
 */
export function preferredUnitForDimension(
  dim: DimensionVector,
  system: UnitSystem,
  profile?: StandardsProfile,
  systems?: UnitSystemRegistry,
): string | undefined {
  const key = dimensionKey(dim);
  const fromProfile = profile?.preferredUnits?.[key];
  if (fromProfile !== undefined) return fromProfile;
  const category = BASE_DIMENSION_CATEGORIES[key];
  if (category === undefined) return undefined;
  if (profile?.preferredUnits?.[category] !== undefined) {
    // Profiles may also key single-base preferences by category name.
    return profile.preferredUnits[category];
  }
  void systems;
  return system.preferredUnits?.[category];
}

/** Is `unit` usable under the profile? Absent allow-list means unrestricted. */
export function isAllowed(unitSymbol: string, profile: StandardsProfile): boolean {
  if (profile.allowedUnits === undefined) return true;
  return profile.allowedUnits.includes(unitSymbol);
}

/** Policy status of a symbol under a profile (identity never changes). */
export function unitStatus(unitSymbol: string, profile: StandardsProfile): UnitStatus {
  if (profile.deprecatedUnits?.[unitSymbol] !== undefined) return "deprecated";
  if (profile.allowedUnits !== undefined && !profile.allowedUnits.includes(unitSymbol)) {
    return "forbidden";
  }
  return "accepted";
}

// ---------------------------------------------------------------------------
// 28.8–28.15 Conversion, normalization, affine/logarithmic guards
// ---------------------------------------------------------------------------

export interface NormalizeOptions extends UnitResolutionOptions {
  /** Semantic strictness for kind validation (default "dimensional-only"). */
  readonly semanticPolicy?: SemanticPolicy;
}

/**
 * Convert a quantity to its system's preferred unit for its dimension.
 * Conversion itself runs through Quantity.to (affine-safe, kind-aware);
 * this function only SELECTS the target. Temperature-difference quantities
 * normalize to K (Δ1 °C = Δ1 K); logarithmic/custom units are rejected
 * explicitly — a profile never silently linearizes them.
 */
export function normalizeToSystem(
  q: Quantity,
  system: UnitSystem,
  opts: NormalizeOptions & { profile?: StandardsProfile } = {},
): Quantity {
  const registry = opts.registry ?? defaultUnitRegistry;
  const kind = q.unit.conversion.kind;
  if (kind === "logarithmic" || kind === "custom") {
    throw new UnsupportedTransformationError(
      `"${q.unit.symbol}" (${kind} conversion)`,
      "system normalization preserves special conversion models; no linear target applies",
    );
  }
  const policy = opts.profile?.conversionPolicy;
  if (policy?.allowAffine === false && kind === "affine") {
    throw new UnsupportedTransformationError(
      `"${q.unit.symbol}" (affine conversion)`,
      `profile "${opts.profile?.id}" forbids affine conversions`,
    );
  }
  // Delta semantics survive normalization: intervals land on kelvin.
  if (q.kind === "temperature-difference") {
    return q.to("K", registry, {
      semanticPolicy: opts.semanticPolicy ?? policy?.semanticPolicy ?? "dimensional-only",
    });
  }
  const key = dimensionKey(q.dimension);
  const preferred =
    opts.profile?.preferredUnits?.[key] ??
    preferredUnitForDimension(q.dimension, system, opts.profile, opts.systems);
  if (preferred === undefined) {
    throw new UnitSystemError(
      `No preferred unit for dimension "${key}" in system "${system.name}"` +
        (opts.profile ? ` (profile "${opts.profile.id}")` : "") +
        " — add an explicit profile mapping",
    );
  }
  return q.to(preferred, registry, {
    semanticPolicy: opts.semanticPolicy ?? policy?.semanticPolicy ?? "dimensional-only",
  });
}

/**
 * Normalize a measurement, converting value AND uncertainty together.
 * Measurement.to already converts uncertainty scale-only (affine-safe);
 * target selection reuses normalizeToSystem on the nominal value.
 */
export function normalizeMeasurementToSystem(
  m: Measurement,
  system: UnitSystem,
  opts: NormalizeOptions & { profile?: StandardsProfile } = {},
): Measurement {
  if (!(m instanceof Measurement)) {
    throw new InvalidMeasurementError("normalizeMeasurementToSystem needs a Measurement");
  }
  const target = normalizeToSystem(m.value, system, opts);
  return m.to(target.unit.symbol, opts.registry ?? defaultUnitRegistry);
}

// ---------------------------------------------------------------------------
// 28.10–28.12 Automatic prefix selection (display only)
// ---------------------------------------------------------------------------

export interface PrefixSelectionOptions {
  readonly registry?: UnitRegistry;
  readonly prefixes?: PrefixRegistry;
  /** "engineering" snaps exponents to multiples of 3; "si" picks closest. */
  readonly policy?: "engineering" | "si";
}

/**
 * Deterministic magnitude-based prefix choice. Returns an equivalent
 * Quantity in the selected prefixed unit; the numeric value is converted,
 * never altered. Units that cannot take the prefix (dimension mismatch on
 * re-parse, e.g. m+"in"→"min") are skipped; if nothing parses, the input
 * is returned unchanged.
 */
export function selectUnitForMagnitude(q: Quantity, opts: PrefixSelectionOptions = {}): Quantity {
  const registry = opts.registry ?? defaultUnitRegistry;
  const prefixes = opts.prefixes ?? defaultPrefixRegistry;
  const policy = opts.policy ?? "engineering";
  const v = q.value;
  if (!Number.isFinite(v) || v === 0) return q;
  const exp = Math.floor(Math.log10(Math.abs(v)));
  const sorted = [...prefixes.list()].sort((a, b) => b.factor - a.factor);
  const base = q.unit.symbol;
  // Candidates carry their engineering on-target flag: only on-target
  // prefixes return immediately; everything else competes on closeness.
  // (A fallback list must never early-return — that picked quetta for 5 m.)
  const candidates: Array<{ symbol: string; onTarget: boolean }> = [];
  if (policy === "engineering") {
    const targetExp = Math.floor(exp / 3) * 3;
    for (const p of sorted) {
      const pExp = Math.round(Math.log10(p.factor));
      if (pExp === targetExp) candidates.push({ symbol: p.symbol + base, onTarget: true });
    }
    // Fall back to plain SI closeness when no engineering prefix matches.
    if (candidates.length === 0) {
      for (const p of sorted) candidates.push({ symbol: p.symbol + base, onTarget: false });
    }
  } else {
    for (const p of sorted) candidates.push({ symbol: p.symbol + base, onTarget: false });
  }
  // Deterministic ranking: (1) keep the input unit when its magnitude
  // already reads well ([1, 1000): 5 m stays m); (2) otherwise the largest
  // prefix keeping the scaled value ≥ 1 (1500 m → km, 0.5 m → dm);
  // (3) otherwise the smallest prefix (1e-9 m → nm). An engineering
  // on-target match (exponent multiple of 3) wins immediately.
  const magnitude = Math.abs(v);
  if (magnitude >= 1 && magnitude < 1000) return q;
  let up: { parsed: Unit; scaled: number } | undefined;
  let down: { parsed: Unit; scaled: number } | undefined;
  for (const { symbol, onTarget } of candidates) {
    let parsed: Unit;
    try {
      parsed = parseUnit(symbol, registry);
    } catch {
      continue; // not a real unit (e.g. "min" for m+"in") — skip
    }
    if (!dimensionsEqual(parsed.dimension, q.dimension)) continue;
    let scaled: number;
    try {
      scaled = q.to(parsed).value;
    } catch {
      continue;
    }
    if (!Number.isFinite(scaled)) continue;
    if (onTarget) return Quantity.of(scaled, parsed);
    // Candidates iterate largest-factor-first, so the first scaled ≥ 1 is
    // the largest such prefix; `down` ends as the smallest parseable.
    if (up === undefined && Math.abs(scaled) >= 1) up = { parsed, scaled };
    down = { parsed, scaled };
  }
  void policy;
  const winner = up ?? down;
  if (winner !== undefined) {
    try {
      return q.to(winner.parsed);
    } catch {
      return q;
    }
  }
  return q;
}

// ---------------------------------------------------------------------------
// 28.23–28.28 ScientificContext, interop, formula/measurement integration
// ---------------------------------------------------------------------------

export interface ScientificContext {
  /** UnitSystem name (resolved against systems registry). */
  readonly unitSystem?: string;
  /** StandardsProfile id (resolved against the profile registry). */
  readonly profile?: string;
  /** Pinned reference datasets: name → version (data only). */
  readonly referenceData?: Readonly<Record<string, string>>;
  /** Formatting policy applied on display. */
  readonly formatting?: ProfileFormatting;
  readonly systems?: UnitSystemRegistry;
  readonly profiles?: ProfileRegistry;
  readonly registry?: UnitRegistry;
}

export interface ResolvedContext {
  readonly system: UnitSystem | undefined;
  readonly profile: StandardsProfile | undefined;
  readonly registry: UnitRegistry;
}

export function resolveContext(ctx: ScientificContext = {}): ResolvedContext {
  const systems = ctx.systems ?? defaultUnitSystemRegistry;
  const registry = ctx.registry ?? defaultUnitRegistry;
  let system: UnitSystem | undefined;
  if (ctx.unitSystem !== undefined) {
    const found = systems.getSystem(ctx.unitSystem);
    if (!found) throw new UnitSystemError(`Unknown UnitSystem "${ctx.unitSystem}" in context`);
    system = found;
  }
  let profile: StandardsProfile | undefined;
  if (ctx.profile !== undefined) {
    if (!ctx.profiles) {
      throw new UnitSystemError(
        `Context references profile "${ctx.profile}" but provides no profile registry`,
      );
    }
    profile = ctx.profiles.get(ctx.profile);
    if (system === undefined && profile.unitSystem) {
      const found = systems.getSystem(profile.unitSystem);
      if (!found) {
        throw new UnitSystemError(
          `Profile "${profile.id}" references unknown UnitSystem "${profile.unitSystem}"`,
        );
      }
      system = found;
    }
  } else if (system !== undefined && ctx.profiles !== undefined) {
    // Adopt the system's profile when it is unambiguous (exactly one
    // registered profile claims the system). Ambiguity fails explicitly
    // rather than guessing — pass `profile` to disambiguate.
    const claimants = ctx.profiles.list().filter((p) => p.unitSystem === system!.name);
    if (claimants.length === 1) profile = claimants[0];
  }
  if (ctx.referenceData !== undefined) {
    assertPlainRecord(ctx.referenceData, "ScientificContext referenceData");
  }
  return { system, profile, registry };
}

/** Convert between systems via preferred units (engine does the math). */
export function convertBetweenSystems(
  q: Quantity,
  targetSystem: string,
  opts: NormalizeOptions & { profile?: StandardsProfile } = {},
): Quantity {
  const systems = opts.systems ?? defaultUnitSystemRegistry;
  const system = systems.getSystem(targetSystem);
  if (!system) throw new UnitSystemError(`Unknown UnitSystem "${targetSystem}"`);
  return normalizeToSystem(q, system, opts);
}

/**
 * Evaluate a formula, then present the result in the context's preferred
 * unit for its dimension. The Formula Engine never learns about systems;
 * conversion and formatting happen here, at the boundary.
 */
export function evaluateInContext(
  formula: Formula,
  bindings: FormulaBindings,
  ctx: ScientificContext = {},
  opts: NormalizeOptions = {},
): { result: Quantity | Measurement; system?: string; unit: string } {
  const resolved = resolveContext(ctx);
  const raw = evaluateFormula(formula, bindings, { registry: resolved.registry });
  if (
    raw !== null &&
    typeof raw === "object" &&
    "result" in (raw as unknown as Record<string, unknown>)
  ) {
    throw new InvalidMeasurementError("evaluateInContext does not support trace mode");
  }
  const result = raw as Quantity | Measurement;
  const nominal = result instanceof Measurement ? result.value : (result as Quantity);
  if (resolved.system === undefined) {
    return { result, system: undefined, unit: nominal.unit.symbol };
  }
  const profile = resolved.profile;
  const converted =
    result instanceof Measurement
      ? normalizeMeasurementToSystem(result, resolved.system, {
          ...opts,
          profile,
          registry: resolved.registry,
        })
      : normalizeToSystem(nominal, resolved.system, {
          ...opts,
          profile,
          registry: resolved.registry,
        });
  const unit =
    converted instanceof Measurement ? converted.value.unit.symbol : converted.unit.symbol;
  return { result: converted, system: resolved.system.name, unit };
}

/** Display a measurement as "v ± u unit" under a context (original untouched). */
export function displayMeasurement(
  m: Measurement,
  ctx: ScientificContext = {},
  opts: NormalizeOptions & { format?: FormatOptions } = {},
): string {
  if (!(m instanceof Measurement)) {
    throw new InvalidMeasurementError("displayMeasurement needs a Measurement");
  }
  const resolved = resolveContext(ctx);
  const shown =
    resolved.system === undefined
      ? m
      : normalizeMeasurementToSystem(m, resolved.system, {
          profile: resolved.profile,
          registry: resolved.registry,
          ...opts,
        });
  const formatting: FormatOptions = {
    ...(resolved.profile?.formatting ?? {}),
    ...(ctx.formatting ?? {}),
    ...(opts.format ?? {}),
  };
  if (resolved.profile?.symbolConventions?.multiplication !== undefined) {
    formatting.multiplicationSymbol = resolved.profile.symbolConventions.multiplication;
  }
  if (resolved.profile?.symbolConventions?.power === "caret") {
    formatting.ascii = true;
  }
  const value = formatQuantity(shown.value, formatting);
  const unc = formatQuantity(shown.uncertainty, { ...formatting, showKind: false });
  // Strip the unit suffix from the uncertainty rendering ("0.5 kg" → "0.5").
  const unitSuffix = ` ${shown.uncertainty.unit.symbol}`;
  const uncValue = unc.endsWith(unitSuffix) ? unc.slice(0, -unitSuffix.length) : unc;
  return `${value} ± ${uncValue} ${shown.value.unit.symbol}`;
}

/** Format a quantity under a context (preferred unit + profile formatting). */
export function formatWithContext(
  q: Quantity,
  ctx: ScientificContext = {},
  opts: NormalizeOptions & { format?: FormatOptions } = {},
): string {
  const resolved = resolveContext(ctx);
  const shown =
    resolved.system === undefined
      ? q
      : normalizeToSystem(q, resolved.system, {
          profile: resolved.profile,
          registry: resolved.registry,
          ...opts,
        });
  const formatting: FormatOptions = {
    ...(resolved.profile?.formatting ?? {}),
    ...(ctx.formatting ?? {}),
    ...(opts.format ?? {}),
  };
  if (resolved.profile?.symbolConventions?.multiplication !== undefined) {
    formatting.multiplicationSymbol = resolved.profile.symbolConventions.multiplication;
  }
  if (resolved.profile?.symbolConventions?.power === "caret") {
    formatting.ascii = true;
  }
  return formatQuantity(shown, formatting);
}

// ---------------------------------------------------------------------------
// 28.24 Import / export mapping for external unit names
// ---------------------------------------------------------------------------

export interface ImportMappingOptions {
  readonly registry?: UnitRegistry;
  readonly limits?: ProfileLimits;
}

/**
 * Map external unit names/symbols ("kg/m3", "lb/ft^3") to engine units via
 * an explicit, validated mapping. Unknown names throw; mappings resolve
 * eagerly so typos fail fast. Ambiguous shorthand is the caller's
 * responsibility to disambiguate in the mapping itself.
 */
export function importUnitName(
  name: string,
  mapping: Readonly<Record<string, string>>,
  opts: ImportMappingOptions = {},
): Unit {
  const limits = resolveLimits(opts.limits);
  if (typeof name !== "string" || name.length === 0) {
    throw new UnitSystemError("importUnitName needs a non-empty external name");
  }
  assertPlainRecord(mapping, "import mapping");
  const keys = Object.keys(mapping);
  if (keys.length > limits.maxMappings) {
    throw new UnitSystemError(`Import mapping has too many entries (max ${limits.maxMappings})`);
  }
  if (!Object.prototype.hasOwnProperty.call(mapping, name)) {
    throw new UnitSystemError(`No import mapping for external unit "${name}"`);
  }
  const target = mapping[name]!;
  const registry = opts.registry ?? defaultUnitRegistry;
  try {
    return parseUnit(target, registry);
  } catch (error) {
    throw new UnitSystemError(
      `Import mapping for "${name}" targets unresolvable unit "${target}" (${(error as Error).message})`,
    );
  }
}

/** Validate a whole mapping up front (fail fast on the first bad target). */
export function validateImportMapping(
  mapping: Readonly<Record<string, string>>,
  opts: ImportMappingOptions = {},
): readonly string[] {
  assertPlainRecord(mapping, "import mapping");
  const limits = resolveLimits(opts.limits);
  if (Object.keys(mapping).length > limits.maxMappings) {
    throw new UnitSystemError(`Import mapping has too many entries (max ${limits.maxMappings})`);
  }
  const registry = opts.registry ?? defaultUnitRegistry;
  const ok: string[] = [];
  for (const [external, target] of Object.entries(mapping)) {
    try {
      parseUnit(target, registry);
    } catch (error) {
      throw new UnitSystemError(
        `Import mapping for "${external}" targets unresolvable unit "${target}" (${(error as Error).message})`,
      );
    }
    ok.push(external);
  }
  return Object.freeze(ok.sort());
}

// ---------------------------------------------------------------------------
// Built-in profiles (conservative; mechanism over data)
// ---------------------------------------------------------------------------

function systemSymbols(system: UnitSystem): string[] {
  const symbols = new Set<string>();
  for (const u of system.units) symbols.add(u.symbol);
  if (system.aliases) {
    for (const target of Object.values(system.aliases)) symbols.add(target);
  }
  return [...symbols].sort();
}

function buildProfile(
  id: string,
  version: string,
  displayName: string,
  description: string,
  unitSystem: string,
  system: UnitSystem,
  preferredUnits: Record<string, string>,
): StandardsProfile {
  return Object.freeze({
    id,
    version,
    displayName,
    description,
    unitSystem,
    preferredUnits: Object.freeze({ ...preferredUnits }),
    allowedUnits: Object.freeze(systemSymbols(system)),
    deprecatedUnits: Object.freeze({}),
    symbolConventions: Object.freeze({ multiplication: "·", power: "superscript" as const }),
    formatting: Object.freeze({ notation: "standard" as const, decimals: 2 }),
    conversionPolicy: Object.freeze({ allowAffine: true, rejectNonlinear: true }),
    referenceData: Object.freeze({}),
    metadata: Object.freeze({ standard: displayName }),
  });
}

/** Canonical dimension key helper (single source for composite map keys). */
function dk(dim: Record<string, number>): string {
  return dimensionKey(defineDimension(dim));
}

const FORCE = { M: 1, L: 1, T: -2 };
const PRESSURE = { M: 1, L: -1, T: -2 };
const POWER = { E: 1, T: -1 };
const FREQUENCY = { T: -1 };

/** SI standards profile (preferred units keyed by canonical dimension key). */
export const SI_PROFILE: StandardsProfile = buildProfile(
  "si",
  "1.0.0",
  "SI",
  "SI base and derived units with SI formatting conventions.",
  "si",
  SI_SYSTEM,
  {
    "M^1": "kg",
    "L^1": "m",
    "T^1": "s",
    "Temp^1": "K",
    "E^1": "J",
    "I^1": "A",
    "Substance^1": "mol",
    "J^1": "cd",
    "N^1": "IU",
    "C^1": "cur",
    [dk(FORCE)]: "N",
    [dk(PRESSURE)]: "Pa",
    [dk(POWER)]: "W",
    [dk(FREQUENCY)]: "Hz",
  },
);

/** CGS standards profile. */
export const CGS_PROFILE: StandardsProfile = buildProfile(
  "cgs",
  "1.0.0",
  "CGS",
  "Centimetre–gram–second units.",
  "cgs",
  CGS_SYSTEM,
  {
    "M^1": "g",
    "L^1": "cm",
    "T^1": "s",
    "E^1": "erg",
    "Temp^1": "K",
    [dk(FORCE)]: "dyn",
    [dk(FREQUENCY)]: "Hz",
  },
);

/** Imperial standards profile. */
export const IMPERIAL_PROFILE: StandardsProfile = buildProfile(
  "imperial",
  "1.0.0",
  "Imperial",
  "Imperial customary units (UK).",
  "imperial",
  IMPERIAL_SYSTEM,
  {
    "M^1": "lb",
    "L^1": "ft",
    "T^1": "s",
    "Temp^1": "°F",
    [dk(FORCE)]: "lbf",
    [dk(PRESSURE)]: "psi",
    [dk(FREQUENCY)]: "Hz",
  },
);

/** US customary standards profile. */
export const US_CUSTOMARY_PROFILE: StandardsProfile = buildProfile(
  "us-customary",
  "1.0.0",
  "US customary",
  "US customary units.",
  "us-customary",
  US_CUSTOMARY_SYSTEM,
  {
    "M^1": "lb",
    "L^1": "ft",
    "T^1": "s",
    "Temp^1": "°F",
    "L^3": "gal",
    [dk(FORCE)]: "lbf",
    [dk(PRESSURE)]: "psi",
    [dk(FREQUENCY)]: "Hz",
  },
);

/** Register the four standard profiles (idempotent helper). */
export function registerStandardProfiles(
  registry: ProfileRegistry,
  profiles: readonly StandardsProfile[] = [
    SI_PROFILE,
    CGS_PROFILE,
    IMPERIAL_PROFILE,
    US_CUSTOMARY_PROFILE,
  ],
): readonly StandardsProfile[] {
  const out: StandardsProfile[] = [];
  for (const p of profiles) {
    if (registry.has(p.id)) {
      out.push(registry.get(p.id));
      continue;
    }
    out.push(registry.register(p));
  }
  return Object.freeze(out);
}
