/**
 * interop.ts — Phase 11: interoperability, canonical serialization, migration, external IDs, tabular mapping.
 *
 * Core domain → Canonical Serialization Model → Adapter → External Format
 * No DB, HTTP, CSV deps — just mapping primitives.
 */

import { Measurement, Quantity } from "@vetwo/units";
import { defaultNutrientKindRegistry } from "./nutrient-kind.js";
import { defaultBasisRegistry } from "./basis.js";
import {
  NutritionMeasurement,
  deserializeNutritionMeasurement,
  serializeNutritionMeasurement,
} from "./nutrition-measurement.js";
import {
  InvalidNutritionQuantityError,
  NutritionContextError,
  UnknownNutrientError,
} from "./errors.js";

// ---------------------------------------------------------------------------
// Canonical representation & deterministic serialization
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 1;

/**
 * Canonical JSON stringify with stable key ordering and deterministic numeric formatting.
 * - Object keys sorted lexicographically
 * - Arrays preserve semantic order
 * - Numbers serialized with consistent representation (no locale)
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return String(value); // preserve NaN/Infinity as string for determinism check
      return value;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalizeValue(obj[key]);
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// External identifiers (namespace-aware, immutable, validated)
// ---------------------------------------------------------------------------

const NAMESPACE_RE = /^[a-z][a-z0-9._-]{1,31}$/;
const EXTERNAL_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

export interface ExternalNutrientIdentifier {
  readonly namespace: string;
  readonly id: string;
}

export interface ExternalUnitIdentifier {
  readonly namespace: string;
  readonly id: string;
  readonly symbol?: string;
}

function validateNamespace(ns: string, field: string): void {
  if (!NAMESPACE_RE.test(ns))
    throw new NutritionContextError(`${field} must match ${NAMESPACE_RE}, got "${ns}"`);
}
function validateExternalId(id: string, field: string): void {
  if (!EXTERNAL_ID_RE.test(id))
    throw new NutritionContextError(`${field} must match ${EXTERNAL_ID_RE}, got "${id}"`);
}

export function createExternalNutrientIdentifier(
  namespace: string,
  id: string,
): ExternalNutrientIdentifier {
  validateNamespace(namespace, "namespace");
  validateExternalId(id, "id");
  return Object.freeze({ namespace, id });
}

export function createExternalUnitIdentifier(
  namespace: string,
  id: string,
  symbol?: string,
): ExternalUnitIdentifier {
  validateNamespace(namespace, "namespace");
  validateExternalId(id, "id");
  if (symbol !== undefined && (typeof symbol !== "string" || symbol.trim().length === 0)) {
    throw new NutritionContextError("symbol must be non-empty string if provided");
  }
  return Object.freeze({ namespace, id, ...(symbol ? { symbol } : {}) });
}

// Simple external → canonical mapping (explicit, deterministic, no heuristics)
const externalNutrientMap = new Map<string, string>(); // "namespace:id" → canonical nutrient id

export function registerExternalNutrientMapping(
  external: ExternalNutrientIdentifier,
  canonicalId: string,
): void {
  const key = `${external.namespace}:${external.id}`;
  if (externalNutrientMap.has(key))
    throw new NutritionContextError(`external nutrient mapping already exists for "${key}"`);
  // Validate canonical exists
  defaultNutrientKindRegistry.require(canonicalId);
  externalNutrientMap.set(key, canonicalId.toLowerCase());
}

export function resolveExternalNutrient(external: ExternalNutrientIdentifier): string | undefined {
  return externalNutrientMap.get(`${external.namespace}:${external.id}`);
}

export function clearExternalNutrientMappings(): void {
  externalNutrientMap.clear();
}

// ---------------------------------------------------------------------------
// Schema versioning & migration
// ---------------------------------------------------------------------------

export type MigrationFunction = (data: unknown) => unknown;

const migrations = new Map<string, MigrationFunction>();

export function registerMigration(
  fromVersion: number,
  toVersion: number,
  fn: MigrationFunction,
): void {
  const key = `${fromVersion}->${toVersion}`;
  if (migrations.has(key))
    throw new NutritionContextError(`migration already registered for ${key}`);
  migrations.set(key, fn);
}

export function migrateSerializedNutritionMeasurement(
  data: unknown,
  fromVersion: number,
  toVersion: number,
): unknown {
  if (fromVersion === toVersion) return data;
  const key = `${fromVersion}->${toVersion}`;
  const fn = migrations.get(key);
  if (!fn) throw new NutritionContextError(`no migration registered for ${key}`);
  return fn(data);
}

// Default migration: v0 (legacy without basis/context) → v1 (add defaults)
registerMigration(0, 1, (data: unknown) => {
  const r = data as Record<string, unknown>;
  if (!r || typeof r !== "object" || Array.isArray(r))
    throw new NutritionContextError("invalid v0 data for migration");
  // v0 had {value, unit, nutrient} without basis/context
  return {
    version: 1,
    type: "nutrition-measurement",
    schemaVersion: 1,
    measurement: r.measurement ?? {
      version: 1,
      type: "measurement",
      value: r.value,
      uncertainty: { version: 1, type: "quantity", value: 0, unit: r.unit as string },
      method: "linearized",
    },
    nutrient: r.nutrient ?? r.nutrientId ?? "unknown",
    basis: r.basis ?? "asFed",
    context: r.context,
    metadata: r.metadata,
  };
});

// ---------------------------------------------------------------------------
// Canonical nutrition measurement serialization (with schemaVersion)
// ---------------------------------------------------------------------------

export interface CanonicalNutritionMeasurement {
  readonly schemaVersion: number;
  readonly nutrient: string; // canonical id
  readonly measurement: {
    value: number;
    unit: string;
    uncertainty?: { value: number; unit: string };
  };
  readonly basis: string;
  readonly context?: unknown;
  readonly metadata?: unknown;
}

export function serializeNutritionMeasurementCanonical(
  nm: NutritionMeasurement,
): Record<string, unknown> {
  const base = serializeNutritionMeasurement(nm) as unknown as Record<string, unknown>;
  return Object.freeze({ schemaVersion: SCHEMA_VERSION, ...base });
}

export function toCanonicalJson(nm: NutritionMeasurement): string {
  const data = serializeNutritionMeasurement(nm) as unknown as Record<string, unknown>;
  const canonical = { schemaVersion: SCHEMA_VERSION, ...data };
  return canonicalJsonStringify(canonical);
}

export function fromCanonicalJson(json: string): NutritionMeasurement {
  const data = JSON.parse(json) as Record<string, unknown>;
  // Support both schemaVersion and version
  const version = (data.schemaVersion as number) ?? (data.version as number) ?? 1;
  if (version !== SCHEMA_VERSION) {
    // Try migration
    const migrated = migrateSerializedNutritionMeasurement(data, version, SCHEMA_VERSION);
    return deserializeNutritionMeasurement(migrated as never);
  }
  // If canonical has schemaVersion wrapper, unwrap to inner measurement
  if (
    data.schemaVersion !== undefined &&
    data.measurement &&
    (data as unknown as { measurement: unknown }).measurement
  ) {
    // It's already our canonical shape, but deserialize expects version/type/measurement/nutrient/basis
    // Our serializeNutritionMeasurement already produces that, so we can directly deserialize the original data without schemaVersion wrapper
    const inner = { ...data };
    delete (inner as Record<string, unknown>).schemaVersion;
    return deserializeNutritionMeasurement(inner as never);
  }
  return deserializeNutritionMeasurement(data as never);
}

// ---------------------------------------------------------------------------
// Unknown handling (explicit)
// ---------------------------------------------------------------------------

export type UnknownNutrientHandling = "fail" | "external";

export function handleUnknownNutrient(
  external: ExternalNutrientIdentifier,
  mode: UnknownNutrientHandling = "fail",
): string | ExternalNutrientIdentifier {
  const resolved = resolveExternalNutrient(external);
  if (resolved) return resolved;
  if (mode === "external") return external; // explicitly keep as external identity
  throw new UnknownNutrientError(
    `${external.namespace}:${external.id}`,
    "unknown external nutrient",
  );
}

// ---------------------------------------------------------------------------
// Tabular mapping primitives
// ---------------------------------------------------------------------------

export interface TabularFieldMapping {
  /** External column/field name */
  readonly externalField: string;
  /** Canonical field name (value, unit, nutrient, basis, sample, timestamp) */
  readonly canonicalField:
    "value" | "unit" | "nutrient" | "basis" | "sample" | "timestamp" | "uncertainty" | "metadata";
  /** Optional transform */
  readonly transform?: (value: unknown) => unknown;
}

export interface TabularRowMapping {
  readonly fields: readonly TabularFieldMapping[];
  /** How to handle unknown nutrient: fail or external */
  readonly unknownNutrientHandling?: UnknownNutrientHandling;
  /** Strict mode: unknown fields → error */
  readonly strict?: boolean;
}

export function mapTabularRowToNutritionMeasurement(
  row: Record<string, unknown>,
  mapping: TabularRowMapping,
): NutritionMeasurement {
  if (!row || typeof row !== "object" || Array.isArray(row))
    throw new InvalidNutritionQuantityError("row must be plain object");
  if (mapping.strict) {
    const allowed = new Set(mapping.fields.map((f) => f.externalField));
    for (const key of Object.keys(row)) {
      if (!allowed.has(key))
        throw new InvalidNutritionQuantityError(`unknown field "${key}" in strict mode`);
    }
  }
  // Prototype pollution guard
  if (
    Object.prototype.hasOwnProperty.call(row, "__proto__") ||
    Object.prototype.hasOwnProperty.call(row, "constructor") ||
    Object.prototype.hasOwnProperty.call(row, "prototype")
  ) {
    throw new InvalidNutritionQuantityError("row contains forbidden keys");
  }

  const canonical: Record<string, unknown> = {};
  for (const f of mapping.fields) {
    let val = row[f.externalField];
    if (f.transform) val = f.transform(val);
    canonical[f.canonicalField] = val;
  }

  const value = canonical.value;
  const unit = canonical.unit;
  const nutrient = canonical.nutrient;
  const basis = (canonical.basis as string) ?? "asFed";

  if (typeof value !== "number" || !Number.isFinite(value))
    throw new InvalidNutritionQuantityError(`value must be finite number, got ${String(value)}`);
  if (typeof unit !== "string" || (unit as string).trim().length === 0)
    throw new InvalidNutritionQuantityError(`unit must be non-empty string, got ${String(unit)}`);
  if (typeof nutrient !== "string" || (nutrient as string).trim().length === 0)
    throw new InvalidNutritionQuantityError(
      `nutrient must be non-empty string, got ${String(nutrient)}`,
    );

  // Resolve nutrient via registry or external mapping
  let canonicalNutrient: string;
  try {
    canonicalNutrient = defaultNutrientKindRegistry.require(nutrient as string).id;
  } catch {
    // Try external mapping if nutrient looks like namespace:id
    if ((nutrient as string).includes(":")) {
      const [ns, id] = (nutrient as string).split(":");
      const ext = { namespace: ns!, id: id! } as ExternalNutrientIdentifier;
      const resolved = resolveExternalNutrient(ext);
      if (resolved) canonicalNutrient = resolved;
      else if (mapping.unknownNutrientHandling === "external")
        canonicalNutrient = nutrient as string;
      else throw new UnknownNutrientError(nutrient as string);
    } else {
      throw new UnknownNutrientError(nutrient as string);
    }
  }

  // Validate basis
  try {
    defaultBasisRegistry.require(basis as string);
  } catch {
    throw new InvalidNutritionQuantityError(`invalid basis "${String(basis)}"`);
  }

  const uncertainty = canonical.uncertainty as unknown;
  let measurement: Measurement;
  if (uncertainty !== undefined) {
    if (
      typeof uncertainty !== "number" ||
      !Number.isFinite(uncertainty) ||
      (uncertainty as number) < 0
    ) {
      throw new InvalidNutritionQuantityError(
        `uncertainty must be finite ≥0, got ${String(uncertainty)}`,
      );
    }
    measurement = Measurement.of(
      Quantity.of(value as number, unit as string),
      uncertainty as number,
    );
  } else {
    measurement = Measurement.exact(Quantity.of(value as number, unit as string));
  }

  return NutritionMeasurement.of(measurement, canonicalNutrient, basis as string);
}
