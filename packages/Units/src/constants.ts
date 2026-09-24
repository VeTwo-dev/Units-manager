/**
 * constants.ts
 * -----------------------------------------------------------------------
 * Single responsibility: SCIENTIFIC CONSTANTS + reference-data
 * infrastructure (Phase 26) — generic, versioned, reproducible.
 *
 * This module is about INFRASTRUCTURE, not an encyclopedic database: a
 * small set of justified built-ins plus the registry machinery domain
 * packages build on.
 *
 * Model (all generic, no domain knowledge):
 * - ScientificConstant: stable id + display symbol + aliases, a Quantity
 *   value, an optional ABSOLUTE uncertainty (same unit), an exactness flag,
 *   required source metadata, version + validity interval. Uncertainty
 *   reuses the Measurement model — Measurement.of / Measurement.exact —
 *   never a second uncertainty system.
 * - ConstantRegistry: registration (conflict-rejecting), deterministic
 *   lookup (id → symbol → alias, with optional namespace prefix),
 *   scoped child registries via an explicit parent chain, immutable
 *   snapshots, versioned data-only serialization.
 * - Versions are EXPLICIT everywhere: registries carry datasetVersion,
 *   constants carry version. Snapshots detach from parents so a computation
 *   pinned to a snapshot stays reproducible when newer data appears.
 *
 * Immutability: definitions and snapshots are frozen; registries never
 * mutate entries in place (snapshot copies the entry map).
 * -----------------------------------------------------------------------
 */
import { Quantity } from "./quantity.js";
import { Measurement } from "./measurement.js";
import { defaultUnitRegistry, type UnitRegistry } from "./unit-registry.js";
import { createRegistry } from "./unit-system.js";
import { SI_PACK } from "./packs/si.js";
import { UnitEngineError } from "./errors/index.js";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export interface ConstantRegistryLimits {
  /** Maximum constants per registry (default 1024). */
  readonly maxConstants?: number;
  /** Maximum aliases per constant (default 8). */
  readonly maxAliasesPerConstant?: number;
  /** Maximum metadata keys per constant (default 32). */
  readonly maxMetadataKeys?: number;
  /** Maximum metadata nesting depth (default 4). */
  readonly maxMetadataDepth?: number;
  /** Maximum serialized JSON characters accepted (default 1048576). */
  readonly maxSerializedChars?: number;
}

const DEFAULT_LIMITS = Object.freeze({
  maxConstants: 1024,
  maxAliasesPerConstant: 8,
  maxMetadataKeys: 32,
  maxMetadataDepth: 4,
  maxSerializedChars: 1048576,
});

function resolveLimits(limits?: ConstantRegistryLimits): {
  maxConstants: number;
  maxAliasesPerConstant: number;
  maxMetadataKeys: number;
  maxMetadataDepth: number;
  maxSerializedChars: number;
} {
  const r = {
    maxConstants: limits?.maxConstants ?? DEFAULT_LIMITS.maxConstants,
    maxAliasesPerConstant: limits?.maxAliasesPerConstant ?? DEFAULT_LIMITS.maxAliasesPerConstant,
    maxMetadataKeys: limits?.maxMetadataKeys ?? DEFAULT_LIMITS.maxMetadataKeys,
    maxMetadataDepth: limits?.maxMetadataDepth ?? DEFAULT_LIMITS.maxMetadataDepth,
    maxSerializedChars: limits?.maxSerializedChars ?? DEFAULT_LIMITS.maxSerializedChars,
  };
  for (const [k, v] of Object.entries(r)) {
    if (!Number.isInteger(v) || v < 1) {
      throw new UnitEngineError(`Constant registry limit ${k} must be a positive integer.`);
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Validation helpers (local, no shared mutable state)
// ---------------------------------------------------------------------------

const ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const NAMESPACE_RE = /^[a-z][a-z0-9_-]*$/;

function assertValidId(id: string, what: string): void {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new UnitEngineError(`${what} must match /^[A-Za-z][A-Za-z0-9_]*$/, got "${String(id)}"`);
  }
}

function assertValidNamespace(namespace: string): void {
  if (typeof namespace !== "string" || !NAMESPACE_RE.test(namespace)) {
    throw new UnitEngineError(
      `Constant registry namespace must match /^[a-z][a-z0-9_-]*$/, got "${String(namespace)}"`,
    );
  }
}

function hasPollutionKeys(obj: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(obj, "__proto__") ||
    Object.prototype.hasOwnProperty.call(obj, "constructor") ||
    Object.prototype.hasOwnProperty.call(obj, "prototype")
  );
}

function assertDeclarativeMetadata(
  value: unknown,
  owner: string,
  maxKeys: number,
  maxDepth: number,
  depth = 0,
): void {
  if (depth > maxDepth) {
    throw new UnitEngineError(`${owner} metadata is nested too deeply (max ${maxDepth})`);
  }
  if (value === null || value === undefined) return;
  const t = typeof value;
  if (t === "function" || t === "symbol") {
    throw new UnitEngineError(`${owner} metadata must not contain executable values`);
  }
  if (t !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertDeclarativeMetadata(item, owner, maxKeys, maxDepth, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (hasPollutionKeys(record)) {
    throw new UnitEngineError(`${owner} metadata contains forbidden keys`);
  }
  const keys = Object.keys(record);
  if (keys.length > maxKeys) {
    throw new UnitEngineError(`${owner} metadata has too many keys (max ${maxKeys})`);
  }
  for (const v of Object.values(record)) {
    assertDeclarativeMetadata(v, owner, maxKeys, maxDepth, depth + 1);
  }
}

function assertIsoDate(value: string, owner: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new UnitEngineError(`${owner} must be an ISO 8601 date string, got "${String(value)}"`);
  }
}

// ---------------------------------------------------------------------------
// Constant definition (input) and ScientificConstant (stored, frozen)
// ---------------------------------------------------------------------------

/** Provenance for a constant: who published it, where, which revision. */
export interface ConstantProvenance {
  readonly organization?: string;
  readonly publication?: string;
  readonly revision?: string;
  readonly url?: string;
  readonly retrieved?: string;
}

/** Input shape for ConstantRegistry.register(). */
export interface ScientificConstantDef {
  /** Stable identifier, e.g. "speedOfLight". Never the display symbol alone. */
  readonly id: string;
  /** Display symbol, e.g. "c". */
  readonly symbol: string;
  /** Additional names resolving to the same identity, e.g. ["lightspeed"]. */
  readonly aliases?: readonly string[];
  /** Nominal numeric value. */
  readonly value: number;
  /** Unit expression string, resolved via the registry's unit registry. */
  readonly unit: string;
  /**
   * ABSOLUTE uncertainty in the same unit (omitted for exact constants).
   * Must be finite and ≥ 0. Relative uncertainties are NOT accepted here —
   * convert to absolute explicitly so stored data is unambiguous.
   */
  readonly uncertainty?: number;
  /** True when the value is exact under its standard (no uncertainty). */
  readonly exact: boolean;
  /** Human description. */
  readonly description?: string;
  /** REQUIRED source, e.g. "SI Brochure (BIPM), 9th edition". */
  readonly source: string;
  /** Reference note, e.g. "SI defining constant (2019 redefinition)". */
  readonly reference?: string;
  /** Constant version (default 1). Bumped when the value changes. */
  readonly version?: number;
  /** Validity interval (ISO 8601); both optional but ordered when present. */
  readonly validFrom?: string;
  readonly validTo?: string;
  /** Provenance (organization/publication/revision). */
  readonly provenance?: ConstantProvenance;
  /** Declarative metadata only (no functions). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** A registered, frozen scientific constant with resolved Quantity/Measurement. */
export interface ScientificConstant {
  readonly id: string;
  readonly symbol: string;
  readonly aliases: readonly string[];
  readonly quantity: Quantity;
  /** Measurement view: exact constants use Measurement.exact (u = 0). */
  readonly measurement: Measurement;
  readonly exact: boolean;
  readonly description?: string;
  readonly source: string;
  readonly reference?: string;
  readonly version: number;
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly provenance?: ConstantProvenance;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Namespace of the owning registry (if any). */
  readonly namespace?: string;
}

// ---------------------------------------------------------------------------
// ConstantRegistry
// ---------------------------------------------------------------------------

export interface ConstantRegistryOptions {
  /** Human name for diagnostics (default "constants"). */
  readonly name?: string;
  /** Namespace qualifying lookups as "namespace:name" (optional). */
  readonly namespace?: string;
  /** REQUIRED dataset version string, e.g. "SI-2019" or "CODATA-2018". */
  readonly datasetVersion?: string;
  /** Parent scope for resolution fallback (explicit shadowing chain). */
  readonly parent?: ConstantRegistry;
  /** Unit registry for resolving constant unit strings. */
  readonly units?: UnitRegistry;
  readonly limits?: ConstantRegistryLimits;
}

export class ConstantRegistry {
  private readonly entries = new Map<string, ScientificConstant>();
  /** Every name (id, symbol, alias) → id, for deterministic lookup. */
  private readonly names = new Map<string, string>();
  private readonly registryName: string;
  private readonly registryNamespace?: string;
  private readonly registryDatasetVersion: string;
  private readonly parent?: ConstantRegistry;
  private readonly unitRegistry: UnitRegistry;
  private readonly limits: ReturnType<typeof resolveLimits>;

  constructor(options: ConstantRegistryOptions = {}) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new UnitEngineError("ConstantRegistry options must be a plain object");
    }
    const { name = "constants", namespace, datasetVersion = "1", parent, units, limits } = options;
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new UnitEngineError("ConstantRegistry name must be a non-empty string");
    }
    if (namespace !== undefined) assertValidNamespace(namespace);
    if (typeof datasetVersion !== "string" || datasetVersion.trim().length === 0) {
      throw new UnitEngineError("ConstantRegistry datasetVersion must be a non-empty string");
    }
    if (parent !== undefined && !(parent instanceof ConstantRegistry)) {
      throw new UnitEngineError("ConstantRegistry parent must be a ConstantRegistry");
    }
    this.registryName = name;
    this.registryNamespace = namespace;
    this.registryDatasetVersion = datasetVersion;
    this.parent = parent;
    this.unitRegistry = units ?? defaultUnitRegistry;
    this.limits = resolveLimits(limits);
  }

  get name(): string {
    return this.registryName;
  }

  get namespace(): string | undefined {
    return this.registryNamespace;
  }

  get datasetVersion(): string {
    return this.registryDatasetVersion;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Register a constant. Rejects duplicate ids, duplicate symbols/aliases
   * (no silent choice, ever), unresolvable units, dimension-mismatched
   * uncertainty, and exact constants carrying uncertainty.
   */
  register(def: ScientificConstantDef): ScientificConstant {
    if (def === null || typeof def !== "object" || Array.isArray(def)) {
      throw new UnitEngineError("Constant definition must be a plain object");
    }
    if (hasPollutionKeys(def as unknown as Record<string, unknown>)) {
      throw new UnitEngineError("Constant definition contains forbidden keys");
    }
    if (this.entries.size >= this.limits.maxConstants) {
      throw new UnitEngineError(
        `Constant registry "${this.registryName}" exceeds maxConstants ${this.limits.maxConstants}`,
      );
    }
    assertValidId(def.id, "Constant id");
    if (this.entries.has(def.id)) {
      throw new UnitEngineError(
        `Constant registry "${this.registryName}" already has id "${def.id}"`,
      );
    }
    if (typeof def.symbol !== "string" || def.symbol.trim().length === 0) {
      throw new UnitEngineError(`Constant "${def.id}" needs a non-empty symbol`);
    }
    const aliases = def.aliases ?? [];
    if (!Array.isArray(aliases)) {
      throw new UnitEngineError(`Constant "${def.id}" aliases must be an array`);
    }
    if (aliases.length > this.limits.maxAliasesPerConstant) {
      throw new UnitEngineError(
        `Constant "${def.id}" has too many aliases (max ${this.limits.maxAliasesPerConstant})`,
      );
    }
    for (const alias of aliases) {
      assertValidId(alias, `Constant "${def.id}" alias`);
    }
    // Name collisions (id, symbol, aliases) fail fast — never silent choice.
    for (const name of [def.id, def.symbol, ...aliases]) {
      if (this.names.has(name)) {
        throw new UnitEngineError(
          `Constant registry "${this.registryName}" name conflict: "${name}" already resolves to "${this.names.get(name)}"`,
        );
      }
    }
    if (typeof def.value !== "number" || !Number.isFinite(def.value)) {
      throw new UnitEngineError(`Constant "${def.id}" value must be a finite number`);
    }
    if (typeof def.unit !== "string" || def.unit.trim().length === 0) {
      throw new UnitEngineError(`Constant "${def.id}" needs a non-empty unit`);
    }
    let quantity: Quantity;
    try {
      quantity = Quantity.of(def.value, def.unit, this.unitRegistry);
    } catch (error) {
      throw new UnitEngineError(
        `Constant "${def.id}" has unresolvable unit "${def.unit}" (${(error as Error).message})`,
      );
    }
    let measurement: Measurement;
    if (def.exact !== true && def.exact !== false) {
      throw new UnitEngineError(`Constant "${def.id}" exact must be a boolean`);
    }
    if (def.uncertainty !== undefined) {
      if (
        typeof def.uncertainty !== "number" ||
        !Number.isFinite(def.uncertainty) ||
        def.uncertainty < 0
      ) {
        throw new UnitEngineError(`Constant "${def.id}" uncertainty must be a finite number ≥ 0`);
      }
      if (def.exact) {
        throw new UnitEngineError(`Constant "${def.id}" is exact but carries uncertainty`);
      }
      try {
        measurement = Measurement.of(
          quantity,
          Quantity.of(def.uncertainty, def.unit, this.unitRegistry),
        );
      } catch (error) {
        throw new UnitEngineError(
          `Constant "${def.id}" has invalid uncertainty (${(error as Error).message})`,
        );
      }
    } else {
      measurement = Measurement.exact(quantity);
      if (!def.exact) {
        throw new UnitEngineError(
          `Constant "${def.id}" is not exact but carries no uncertainty; use exact: true or supply uncertainty`,
        );
      }
    }
    if (typeof def.source !== "string" || def.source.trim().length === 0) {
      throw new UnitEngineError(`Constant "${def.id}" needs a non-empty source`);
    }
    const version = def.version ?? 1;
    if (!Number.isInteger(version) || version < 1) {
      throw new UnitEngineError(`Constant "${def.id}" version must be a positive integer`);
    }
    if (def.validFrom !== undefined) assertIsoDate(def.validFrom, `Constant "${def.id}" validFrom`);
    if (def.validTo !== undefined) assertIsoDate(def.validTo, `Constant "${def.id}" validTo`);
    if (def.validFrom !== undefined && def.validTo !== undefined && def.validFrom > def.validTo) {
      throw new UnitEngineError(`Constant "${def.id}" validFrom must not exceed validTo`);
    }
    if (def.provenance !== undefined) {
      if (
        def.provenance === null ||
        typeof def.provenance !== "object" ||
        Array.isArray(def.provenance)
      ) {
        throw new UnitEngineError(`Constant "${def.id}" provenance must be a plain object`);
      }
      if (hasPollutionKeys(def.provenance as unknown as Record<string, unknown>)) {
        throw new UnitEngineError(`Constant "${def.id}" provenance contains forbidden keys`);
      }
    }
    assertDeclarativeMetadata(
      def.metadata,
      `Constant "${def.id}"`,
      this.limits.maxMetadataKeys,
      this.limits.maxMetadataDepth,
    );

    const stored: ScientificConstant = Object.freeze({
      id: def.id,
      symbol: def.symbol,
      aliases: Object.freeze([...aliases]),
      quantity,
      measurement,
      exact: def.exact,
      description: def.description,
      source: def.source,
      reference: def.reference,
      version,
      validFrom: def.validFrom,
      validTo: def.validTo,
      provenance: def.provenance ? Object.freeze({ ...def.provenance }) : undefined,
      metadata: def.metadata ? Object.freeze({ ...def.metadata }) : undefined,
      namespace: this.registryNamespace,
    });
    this.entries.set(def.id, stored);
    this.names.set(def.id, def.id);
    this.names.set(def.symbol, def.id);
    for (const alias of aliases) this.names.set(alias, def.id);
    return stored;
  }

  has(name: string): boolean {
    if (typeof name !== "string") return false;
    const colon = name.indexOf(":");
    if (colon >= 0) {
      const ns = name.slice(0, colon);
      const bare = name.slice(colon + 1);
      if (ns !== this.registryNamespace) return false;
      return this.names.has(bare);
    }
    if (this.names.has(name)) return true;
    return this.parent?.has(name) ?? false;
  }

  /**
   * Resolve by id, symbol, or alias — deterministically (id wins only in
   * the sense that registration forbids any two names colliding at all).
   * "namespace:name" must match this registry's namespace. Falls back to
   * the parent scope (documented shadowing: own entries win).
   */
  require(name: string): ScientificConstant {
    if (typeof name !== "string" || name.length === 0) {
      throw new UnitEngineError(`Constant lookup needs a non-empty name`);
    }
    const colon = name.indexOf(":");
    if (colon >= 0) {
      const ns = name.slice(0, colon);
      const bare = name.slice(colon + 1);
      if (ns !== this.registryNamespace) {
        throw new UnitEngineError(
          `Constant "${name}" namespace "${ns}" does not match registry namespace "${this.registryNamespace ?? "none"}"`,
        );
      }
      const id = this.names.get(bare);
      if (id === undefined) {
        throw new UnitEngineError(`Unknown constant "${name}" in registry "${this.registryName}"`);
      }
      return this.entries.get(id)!;
    }
    const id = this.names.get(name);
    if (id !== undefined) return this.entries.get(id)!;
    if (this.parent !== undefined) return this.parent.require(name);
    throw new UnitEngineError(`Unknown constant "${name}" in registry "${this.registryName}"`);
  }

  /** Sorted constants (by id) for deterministic iteration/serialization. */
  list(): readonly ScientificConstant[] {
    return [...this.entries.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * Immutable snapshot: a detached registry with copied entries and NO
   * parent. Computations pinned to a snapshot stay reproducible when the
   * live registry (or its parents) later change.
   */
  snapshot(name?: string): ConstantRegistry {
    const snap = new ConstantRegistry({
      name: name ?? `${this.registryName}@snapshot`,
      namespace: this.registryNamespace,
      datasetVersion: this.registryDatasetVersion,
      units: this.unitRegistry,
      limits: this.limits,
    });
    for (const entry of this.list()) {
      snap.entries.set(entry.id, entry);
      snap.names.set(entry.id, entry.id);
      snap.names.set(entry.symbol, entry.id);
      for (const alias of entry.aliases) snap.names.set(alias, entry.id);
    }
    return snap;
  }
}

// ---------------------------------------------------------------------------
// Serialization (versioned, deterministic, data-only)
// ---------------------------------------------------------------------------

export interface SerializedScientificConstant {
  readonly version: 1;
  readonly type: "scientific-constant";
  readonly id: string;
  readonly symbol: string;
  readonly aliases: readonly string[];
  readonly value: number | string;
  readonly unit: string;
  readonly uncertainty?: number | string;
  readonly exact: boolean;
  readonly description?: string;
  readonly source: string;
  readonly reference?: string;
  readonly constVersion: number;
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly provenance?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SerializedConstantRegistry {
  readonly version: 1;
  readonly type: "constant-registry";
  readonly name: string;
  readonly namespace?: string;
  readonly datasetVersion: string;
  readonly constants: readonly SerializedScientificConstant[];
}

function encodeConstantNumber(v: number): number | string {
  if (Number.isNaN(v)) return "NaN";
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  if (Object.is(v, -0)) return "-0";
  return v;
}

function decodeConstantNumber(v: unknown, what: string): number {
  if (typeof v === "number") return v;
  if (v === "NaN") return NaN;
  if (v === "Infinity") return Infinity;
  if (v === "-Infinity") return -Infinity;
  if (v === "-0") return -0;
  throw new UnitEngineError(`${what} must be a number or special encoding`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function serializeConstant(c: ScientificConstant): SerializedScientificConstant {
  if (c === null || typeof c !== "object" || Array.isArray(c)) {
    throw new UnitEngineError("Can only serialize ScientificConstant objects");
  }
  return Object.freeze({
    version: 1 as const,
    type: "scientific-constant" as const,
    id: c.id,
    symbol: c.symbol,
    aliases: Object.freeze([...c.aliases]),
    value: encodeConstantNumber(c.quantity.value),
    unit: c.quantity.unit.symbol,
    uncertainty: c.exact ? undefined : encodeConstantNumber(c.measurement.uncertainty.value),
    exact: c.exact,
    description: c.description,
    source: c.source,
    reference: c.reference,
    constVersion: c.version,
    validFrom: c.validFrom,
    validTo: c.validTo,
    provenance: c.provenance
      ? Object.freeze({ ...(c.provenance as Record<string, unknown>) })
      : undefined,
    metadata: c.metadata ? Object.freeze({ ...c.metadata }) : undefined,
  });
}

export function serializeConstantRegistry(registry: ConstantRegistry): SerializedConstantRegistry {
  if (!(registry instanceof ConstantRegistry)) {
    throw new UnitEngineError("Can only serialize ConstantRegistry instances");
  }
  return Object.freeze({
    version: 1 as const,
    type: "constant-registry" as const,
    name: registry.name,
    namespace: registry.namespace,
    datasetVersion: registry.datasetVersion,
    constants: Object.freeze(registry.list().map(serializeConstant)),
  });
}

export interface DeserializeConstantRegistryOptions {
  /** Unit registry for resolving constant units. */
  readonly units?: UnitRegistry;
  readonly limits?: ConstantRegistryLimits;
  readonly name?: string;
  readonly namespace?: string;
  readonly datasetVersion?: string;
}

export function deserializeConstantRegistry(
  data: unknown,
  opts: DeserializeConstantRegistryOptions = {},
): ConstantRegistry {
  if (typeof data === "string") {
    const limits = resolveLimits(opts.limits);
    if (data.length > limits.maxSerializedChars) {
      throw new UnitEngineError(
        `Serialized constant registry exceeds maxSerializedChars ${limits.maxSerializedChars}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new UnitEngineError("Malformed serialized constant registry: invalid JSON");
    }
    return deserializeConstantRegistry(parsed, opts);
  }
  if (!isPlainRecord(data)) {
    throw new UnitEngineError("Serialized constant registry must be a plain object");
  }
  if (hasPollutionKeys(data)) {
    throw new UnitEngineError("Serialized constant registry contains forbidden keys");
  }
  if (data.version !== 1) {
    if (data.version === undefined)
      throw new UnitEngineError("Serialized constant registry missing version");
    throw new UnitEngineError(`Unsupported constant registry version ${String(data.version)}`);
  }
  if (data.type !== "constant-registry") {
    throw new UnitEngineError(`Serialized constant registry has wrong type "${String(data.type)}"`);
  }
  if (!Array.isArray(data.constants)) {
    throw new UnitEngineError("Serialized constant registry constants must be an array");
  }
  const registry = new ConstantRegistry({
    name:
      typeof opts.name === "string"
        ? opts.name
        : typeof data.name === "string"
          ? data.name
          : "constants",
    namespace: opts.namespace ?? (typeof data.namespace === "string" ? data.namespace : undefined),
    datasetVersion:
      opts.datasetVersion ?? (typeof data.datasetVersion === "string" ? data.datasetVersion : "1"),
    units: opts.units,
    limits: opts.limits,
  });
  for (const entry of data.constants) {
    if (!isPlainRecord(entry)) {
      throw new UnitEngineError("Serialized constant must be a plain object");
    }
    if (hasPollutionKeys(entry)) {
      throw new UnitEngineError("Serialized constant contains forbidden keys");
    }
    if (entry.version !== 1 || entry.type !== "scientific-constant") {
      throw new UnitEngineError("Malformed serialized scientific constant (version/type)");
    }
    if (typeof entry.id !== "string" || typeof entry.symbol !== "string") {
      throw new UnitEngineError("Serialized scientific constant needs id and symbol strings");
    }
    if (typeof entry.unit !== "string") {
      throw new UnitEngineError("Serialized scientific constant needs a unit string");
    }
    if (typeof entry.source !== "string") {
      throw new UnitEngineError("Serialized scientific constant needs a source string");
    }
    if (entry.exact !== true && entry.exact !== false) {
      throw new UnitEngineError("Serialized scientific constant needs an exact boolean");
    }
    const aliases = entry.aliases ?? [];
    if (!Array.isArray(aliases) || aliases.some((a) => typeof a !== "string")) {
      throw new UnitEngineError("Serialized scientific constant aliases must be strings");
    }
    registry.register({
      id: entry.id,
      symbol: entry.symbol,
      aliases,
      value: decodeConstantNumber(entry.value, `Constant "${entry.id}" value`),
      unit: entry.unit,
      uncertainty:
        entry.uncertainty === undefined
          ? undefined
          : decodeConstantNumber(entry.uncertainty, `Constant "${entry.id}" uncertainty`),
      exact: entry.exact,
      description: typeof entry.description === "string" ? entry.description : undefined,
      source: entry.source,
      reference: typeof entry.reference === "string" ? entry.reference : undefined,
      version: typeof entry.constVersion === "number" ? entry.constVersion : 1,
      validFrom: typeof entry.validFrom === "string" ? entry.validFrom : undefined,
      validTo: typeof entry.validTo === "string" ? entry.validTo : undefined,
      provenance: isPlainRecord(entry.provenance)
        ? (entry.provenance as ConstantProvenance)
        : undefined,
      metadata: isPlainRecord(entry.metadata) ? entry.metadata : undefined,
    });
  }
  return registry;
}

// ---------------------------------------------------------------------------
// Reproducibility helper
// ---------------------------------------------------------------------------

export interface ConstantUsageRecord {
  readonly id: string;
  readonly symbol: string;
  readonly value: number;
  readonly unit: string;
  readonly version: number;
  readonly source: string;
  readonly datasetVersion: string;
}

/** Record exactly which constant value/version/unit/source a computation used. */
export function recordConstantUsage(
  c: ScientificConstant,
  datasetVersion: string,
): ConstantUsageRecord {
  return Object.freeze({
    id: c.id,
    symbol: c.symbol,
    value: c.quantity.value,
    unit: c.quantity.unit.symbol,
    version: c.version,
    source: c.source,
    datasetVersion,
  });
}

// ---------------------------------------------------------------------------
// Built-in constants (conservative, justified, SI 2019)
// ---------------------------------------------------------------------------

/**
 * Minimal built-in dataset. Every value is exact under SI 2019 (defining
 * constants) or conventionally exact (standard gravity), except Newtonian
 * gravitation which carries its CODATA 2018 uncertainty to exercise the
 * uncertain-constant path. Sources are cited per constant.
 */
export const SI_PHYSICS_CONSTANT_DEFS: readonly ScientificConstantDef[] = Object.freeze([
  {
    id: "speedOfLight",
    symbol: "c",
    aliases: ["lightspeed"],
    value: 299792458,
    unit: "m/s",
    exact: true,
    description: "Speed of light in vacuum",
    source: "SI Brochure (BIPM), 9th edition",
    reference: "SI defining constant (2019 redefinition)",
    version: 1,
  },
  {
    id: "planckConstant",
    symbol: "h",
    value: 6.62607015e-34,
    unit: "J*s",
    exact: true,
    description: "Planck constant",
    source: "SI Brochure (BIPM), 9th edition",
    reference: "SI defining constant (2019 redefinition)",
    version: 1,
  },
  {
    id: "elementaryCharge",
    symbol: "e",
    value: 1.602176634e-19,
    unit: "C",
    exact: true,
    description: "Elementary charge",
    source: "SI Brochure (BIPM), 9th edition",
    reference: "SI defining constant (2019 redefinition)",
    version: 1,
  },
  {
    id: "avogadroConstant",
    symbol: "NA",
    value: 6.02214076e23,
    unit: "mol^-1",
    exact: true,
    description: "Avogadro constant",
    source: "SI Brochure (BIPM), 9th edition",
    reference: "SI defining constant (2019 redefinition)",
    version: 1,
  },
  {
    id: "boltzmannConstant",
    symbol: "kB",
    value: 1.380649e-23,
    unit: "J/K",
    exact: true,
    description: "Boltzmann constant",
    source: "SI Brochure (BIPM), 9th edition",
    reference: "SI defining constant (2019 redefinition)",
    version: 1,
  },
  {
    id: "standardGravity",
    symbol: "g0",
    value: 9.80665,
    unit: "m/s^2",
    exact: true,
    description: "Standard acceleration of gravity",
    source: "CGPM, 3rd meeting (1901); conventional exact value",
    reference: "Conventional exact value gn = 9.80665 m/s²",
    version: 1,
  },
  {
    id: "newtonianGravitation",
    symbol: "G",
    value: 6.6743e-11,
    unit: "m^3/(kg*s^2)",
    uncertainty: 0.00015e-11,
    exact: false,
    description: "Newtonian constant of gravitation",
    source: "CODATA 2018 recommended values (Tiesinga et al., RMP 2021)",
    reference: "CODATA 2018: 6.67430(15)e-11 m³·kg⁻¹·s⁻²",
    version: 1,
    provenance: {
      organization: "CODATA Task Group",
      publication: "RMP 93, 025010 (2021)",
      revision: "2018",
    },
  },
]);

export interface StandardConstantRegistryOptions {
  /** Unit registry for resolving constant units (defaults to SI-backed). */
  readonly units?: UnitRegistry;
  readonly name?: string;
  readonly namespace?: string;
  readonly datasetVersion?: string;
  readonly limits?: ConstantRegistryLimits;
}

/**
 * Build the standard registry with the built-in dataset. The default unit
 * registry is SI-backed (atomic + SI pack) so J, C, mol resolve.
 */
export function createStandardConstantRegistry(
  opts: StandardConstantRegistryOptions = {},
): ConstantRegistry {
  const units = opts.units ?? createRegistry({ packs: [SI_PACK] });
  const registry = new ConstantRegistry({
    name: opts.name ?? "si-physics",
    namespace: opts.namespace,
    datasetVersion: opts.datasetVersion ?? "SI-2019+CODATA-2018",
    units,
    limits: opts.limits,
  });
  for (const def of SI_PHYSICS_CONSTANT_DEFS) {
    registry.register(def);
  }
  return registry;
}
