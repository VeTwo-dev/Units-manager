/**
 * interop.ts — Phase 29: advanced scientific interoperability,
 * extensibility and ecosystem infrastructure.
 *
 * Single responsibility: everything an EXTERNAL consumer or domain package
 * needs to integrate with the engine, without touching engine internals:
 * extension manifests, scoped registries, namespaces, ambiguity handling,
 * external mappings, interchange formats, migration, canonicalization,
 * format presets, precision policies, diagnostics and strictness policies.
 *
 * Layering rules (enforced by construction, verified by madge):
 * - This module imports leaf modules only. Nothing else in src/ imports
 *   this module — it is a pure consumer layer re-exported from index.ts.
 * - No numeric engine is duplicated: conversions run through Quantity.to,
 *   dimensions through dimension.js, parsing through unit-parser.js,
 *   formatting through formatter.js, formulas through formula.js.
 * - No network, no filesystem, no eval/Function. All data is validated
 *   before use; all failures are typed errors, never silent guesses.
 */
import { Quantity } from "./quantity.js";
import { Measurement, deserializeMeasurement, serializeMeasurement } from "./measurement.js";
import type { Unit } from "./unit.js";
import { defaultUnitRegistry, UnitRegistry } from "./unit-registry.js";
import {
  defaultUnitSystemRegistry,
  UnitSystemRegistry,
  type UnitPack,
  type UnitSystem,
} from "./unit-system.js";
import type { AtomicUnitDef } from "./units/atomic-units.js";
import { PrefixRegistry, type Prefix } from "./prefix.js";
import { QuantityKindRegistry, type QuantityKind, type SemanticPolicy } from "./quantity-kind.js";
import { FunctionRegistry, type ScientificFunction } from "./function-registry.js";
import {
  ConstantRegistry,
  deserializeConstantRegistry,
  type ScientificConstantDef,
} from "./constants.js";
import {
  normalizeMeasurementToSystem,
  normalizeToSystem,
  ProfileRegistry,
  importUnitName,
  type StandardsProfile,
} from "./standards-profile.js";
import { dimensionKey, dimensionsEqual, type DimensionVector } from "./dimension.js";
import { parseUnit } from "./unit-parser.js";

import { formatQuantity, type FormatOptions } from "./formatter.js";
import { deserializeQuantity, serializeQuantity } from "./serializer.js";
import { MeasurementDataset, MeasurementSeries } from "./statistics.js";
import { evaluateFormula, type Formula, type FormulaBindings } from "./formula.js";
import { inferExpressionDimension } from "./expression.js";
import type { ComparisonOptions } from "./numerical.js";
import {
  AmbiguousUnitError,
  ExtensionError,
  MigrationError,
  UnitEngineError,
} from "./errors/index.js";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export interface InteropLimits {
  /** Maximum entries per extension section (default 4096). */
  readonly maxExtensionEntries?: number;
  /** Maximum scoped sources consulted per resolution (default 64). */
  readonly maxSources?: number;
  /** Maximum interchange payload characters accepted (default 1048576). */
  readonly maxInterchangeChars?: number;
  /** Maximum observations accepted in interchange datasets (default 100000). */
  readonly maxInterchangeObservations?: number;
}

const DEFAULT_LIMITS = Object.freeze({
  maxExtensionEntries: 4096,
  maxSources: 64,
  maxInterchangeChars: 1048576,
  maxInterchangeObservations: 100000,
});

function resolveLimits(limits?: InteropLimits): {
  maxExtensionEntries: number;
  maxSources: number;
  maxInterchangeChars: number;
  maxInterchangeObservations: number;
} {
  const r = {
    maxExtensionEntries: limits?.maxExtensionEntries ?? DEFAULT_LIMITS.maxExtensionEntries,
    maxSources: limits?.maxSources ?? DEFAULT_LIMITS.maxSources,
    maxInterchangeChars: limits?.maxInterchangeChars ?? DEFAULT_LIMITS.maxInterchangeChars,
    maxInterchangeObservations:
      limits?.maxInterchangeObservations ?? DEFAULT_LIMITS.maxInterchangeObservations,
  };
  for (const [k, v] of Object.entries(r)) {
    if (!Number.isInteger(v) || v < 1) {
      throw new UnitEngineError(`Interop limit ${k} must be a positive integer.`);
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
    throw new ExtensionError(`${what} must be a plain object`);
  }
  if (hasPollutionKeys(value as Record<string, unknown>)) {
    throw new ExtensionError(`${what} contains forbidden prototype keys`);
  }
}

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const NAMESPACE_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

// ---------------------------------------------------------------------------
// 29.2–29.8 Extensions: manifests, scopes, compatibility, conflicts
// ---------------------------------------------------------------------------

/**
 * Declarative extension manifest. Everything is data: unit/prefix/kind/
 * function/constant/system/profile definitions a domain package or
 * application contributes. Applied only through applyExtension — never by
 * mutating shared registries directly.
 */
export interface ExtensionManifest {
  readonly id: string;
  readonly version: string;
  readonly description?: string;
  /** Minimum compatible @vetwo/units version, e.g. ">=0.0.2". */
  readonly requiresUnits?: string;
  readonly units?: readonly AtomicUnitDef[];
  readonly prefixes?: readonly Prefix[];
  readonly kinds?: readonly QuantityKind[];
  readonly functions?: readonly ScientificFunction[];
  readonly constants?: readonly ScientificConstantDef[];
  readonly systems?: readonly UnitSystem[];
  readonly packs?: readonly UnitPack[];
  readonly profiles?: readonly StandardsProfile[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Registries an extension applies to. Any subset may be provided. */
export interface ExtensionTargets {
  readonly units?: UnitRegistry;
  readonly prefixes?: PrefixRegistry;
  readonly kinds?: QuantityKindRegistry;
  readonly functions?: FunctionRegistry;
  readonly constants?: ConstantRegistry;
  readonly systems?: UnitSystemRegistry;
  readonly profiles?: ProfileRegistry;
}

export interface ExtensionConflict {
  /** What collided: symbol, alias, identifier, dimension, factor, kind, version. */
  readonly kind: "symbol" | "alias" | "identifier" | "dimension" | "factor" | "kind" | "version";
  /** The colliding name. */
  readonly name: string;
  /** Human-readable detail (existing vs incoming). */
  readonly detail: string;
}

/** Current package version, used for requiresUnits checks. */
export const ENGINE_VERSION = "0.0.2";

function assertManifestShape(
  manifest: ExtensionManifest,
  limits: ReturnType<typeof resolveLimits>,
): void {
  assertPlainRecord(manifest, "ExtensionManifest");
  if (typeof manifest.id !== "string" || !ID_RE.test(manifest.id)) {
    throw new ExtensionError(`Extension id must match /^[A-Za-z][A-Za-z0-9_-]*$/`);
  }
  if (typeof manifest.version !== "string" || manifest.version.trim().length === 0) {
    throw new ExtensionError(`Extension "${manifest.id}" needs a non-empty version`);
  }
  if (manifest.requiresUnits !== undefined) {
    checkRequiresUnits(manifest.requiresUnits, manifest.id);
  }
  const sections = [
    "units",
    "prefixes",
    "kinds",
    "functions",
    "constants",
    "systems",
    "packs",
    "profiles",
  ] as const;
  for (const section of sections) {
    const entries = manifest[section];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) {
      throw new ExtensionError(`Extension "${manifest.id}" section "${section}" must be an array`);
    }
    if (entries.length > limits.maxExtensionEntries) {
      throw new ExtensionError(
        `Extension "${manifest.id}" section "${section}" exceeds maxExtensionEntries ${limits.maxExtensionEntries}`,
      );
    }
  }
  if (manifest.metadata !== undefined) {
    assertPlainRecord(manifest.metadata, `Extension "${manifest.id}" metadata`);
  }
}

/**
 * Validate a minimal semver-ish requirement against ENGINE_VERSION.
 * Supported: ">=X", ">X", "=X"/"X", "^X" (compatible: same major, >= minor),
 * "~X" (same major.minor, >= patch). Anything else throws ExtensionError.
 */
export function checkRequiresUnits(range: string, extensionId = "<unknown>"): void {
  if (typeof range !== "string" || range.trim().length === 0) {
    throw new ExtensionError(`Extension "${extensionId}" requiresUnits must be a non-empty string`);
  }
  const m = /^(>=|>|=|\^|~)?\s*(\d+)\.(\d+)\.(\d+)\s*$/.exec(range.trim());
  if (!m) {
    throw new ExtensionError(
      `Extension "${extensionId}" has an unsupported requiresUnits range "${range}" ` +
        `(supported: ">=X.Y.Z", ">X.Y.Z", "=X.Y.Z", "^X.Y.Z", "~X.Y.Z")`,
    );
  }
  const op = m[1] ?? "=";
  const want = [Number(m[2]), Number(m[3]), Number(m[4])] as const;
  const have = ENGINE_VERSION.split(".").map(Number) as [number, number, number];
  const cmp = (): number => {
    for (let i = 0; i < 3; i++) {
      if (have[i]! !== want[i]!) return have[i]! < want[i]! ? -1 : 1;
    }
    return 0;
  };
  const c = cmp();
  const ok =
    op === ">="
      ? c >= 0
      : op === ">"
        ? c > 0
        : op === "="
          ? c === 0
          : op === "^"
            ? have[0] === want[0] && c >= 0
            : have[0] === want[0] && have[1] === want[1] && c >= 0;
  if (!ok) {
    throw new ExtensionError(
      `Extension "${extensionId}" requires @vetwo/units "${range}" but engine is ${ENGINE_VERSION}`,
    );
  }
}

/** Normalize an unknown aliases field to a string array (empty when absent). */
function asStringArray(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

/**
 * Dry-run conflict detection: report every collision applying the manifest
 * would cause, without mutating anything. Empty array means clean.
 * Compares symbol, alias, identifier, dimension, conversion factor and kind.
 */
export function validateExtension(
  manifest: ExtensionManifest,
  targets: ExtensionTargets = {},
  opts: { limits?: InteropLimits } = {},
): ExtensionConflict[] {
  const limits = resolveLimits(opts.limits);
  assertManifestShape(manifest, limits);
  const conflicts: ExtensionConflict[] = [];
  const units = targets.units;
  if (units !== undefined && manifest.units !== undefined) {
    for (const def of manifest.units) {
      if (def === null || typeof def !== "object" || typeof def.symbol !== "string") {
        conflicts.push({
          kind: "identifier",
          name: String((def as { symbol?: unknown })?.symbol),
          detail: "malformed unit definition",
        });
        continue;
      }
      const existing = tryResolveSymbol(units, def.symbol);
      if (existing !== undefined) {
        const sameDim = dimensionsEqual(existing.dimension, def.dimension);
        const sameScale = existing.toBaseFactor === def.toBaseFactor;
        const sameKind =
          (existing.metadata?.kind ?? undefined) === (def.metadata?.kind ?? undefined);
        if (!sameDim) {
          conflicts.push({
            kind: "dimension",
            name: def.symbol,
            detail: `existing dimension ${dimensionKey(existing.dimension)} vs incoming ${dimensionKey(def.dimension)}`,
          });
        } else if (!sameScale) {
          conflicts.push({
            kind: "factor",
            name: def.symbol,
            detail: `existing scale ${existing.toBaseFactor} vs incoming ${def.toBaseFactor}`,
          });
        } else if (!sameKind) {
          conflicts.push({
            kind: "kind",
            name: def.symbol,
            detail: `existing kind vs incoming kind differ (same dimension and scale)`,
          });
        } else {
          conflicts.push({
            kind: "symbol",
            name: def.symbol,
            detail: "symbol already registered identically",
          });
        }
      }
      // Aliases collide exactly like symbols (registerAtomic throws on both).
      const aliases = Array.isArray((def as { aliases?: unknown }).aliases)
        ? ((def as { aliases?: unknown }).aliases as unknown[])
        : [];
      for (const alias of aliases) {
        if (typeof alias !== "string") continue;
        if (alias !== def.symbol && tryResolveSymbol(units, alias) !== undefined) {
          conflicts.push({
            kind: "alias",
            name: alias,
            detail: `alias collides (unit "${def.symbol}")`,
          });
        }
      }
    }
  }
  if (targets.prefixes !== undefined && manifest.prefixes !== undefined) {
    const existing = new Map<string, string>();
    for (const p of targets.prefixes.list()) {
      existing.set(p.symbol, `prefix "${p.symbol}"`);
      for (const a of p.aliases ?? []) existing.set(a, `alias of "${p.symbol}"`);
    }
    for (const prefix of manifest.prefixes) {
      if (prefix === null || typeof prefix !== "object" || Array.isArray(prefix)) {
        conflicts.push({ kind: "identifier", name: "?", detail: "malformed prefix definition" });
        continue;
      }
      const symbol = (prefix as { symbol?: unknown }).symbol;
      if (typeof symbol !== "string" || symbol.length === 0) {
        conflicts.push({ kind: "identifier", name: "?", detail: "malformed prefix definition" });
        continue;
      }
      if (existing.has(symbol)) {
        conflicts.push({
          kind: "symbol",
          name: symbol,
          detail: `prefix collides with ${existing.get(symbol)}`,
        });
      }
      for (const alias of asStringArray((prefix as { aliases?: unknown }).aliases)) {
        if (existing.has(alias)) {
          conflicts.push({
            kind: "alias",
            name: alias,
            detail: `alias collides with ${existing.get(alias)} (prefix "${symbol}")`,
          });
        }
      }
    }
  }
  if (targets.kinds !== undefined && manifest.kinds !== undefined) {
    for (const kind of manifest.kinds) {
      if (
        kind === null ||
        typeof kind !== "object" ||
        typeof (kind as { id?: unknown }).id !== "string"
      ) {
        conflicts.push({ kind: "identifier", name: "?", detail: "malformed kind definition" });
        continue;
      }
      if (targets.kinds.has(kind.id)) {
        conflicts.push({ kind: "identifier", name: kind.id, detail: "kind id already registered" });
      }
    }
  }
  if (targets.functions !== undefined && manifest.functions !== undefined) {
    for (const fn of manifest.functions) {
      const name = (fn as { name?: unknown })?.name;
      if (typeof name !== "string") {
        conflicts.push({ kind: "identifier", name: "?", detail: "malformed function definition" });
        continue;
      }
      if (targets.functions.has(name)) {
        conflicts.push({ kind: "identifier", name, detail: "function name already registered" });
      }
      for (const alias of asStringArray((fn as { aliases?: unknown }).aliases)) {
        if (typeof alias === "string" && targets.functions.has(alias)) {
          conflicts.push({
            kind: "alias",
            name: alias,
            detail: `alias collides (function "${name}")`,
          });
        }
      }
    }
  }
  if (targets.constants !== undefined && manifest.constants !== undefined) {
    for (const def of manifest.constants) {
      const id = (def as { id?: unknown })?.id;
      const symbol = (def as { symbol?: unknown })?.symbol;
      if (typeof id !== "string") {
        conflicts.push({ kind: "identifier", name: "?", detail: "malformed constant definition" });
        continue;
      }
      if (targets.constants.has(id)) {
        conflicts.push({ kind: "identifier", name: id, detail: "constant id already registered" });
      }
      if (typeof symbol === "string" && symbol !== id && targets.constants.has(symbol)) {
        conflicts.push({
          kind: "symbol",
          name: symbol,
          detail: `constant symbol collides (id "${id}")`,
        });
      }
      for (const alias of asStringArray((def as { aliases?: unknown }).aliases)) {
        if (typeof alias === "string" && targets.constants.has(alias)) {
          conflicts.push({
            kind: "alias",
            name: alias,
            detail: `alias collides (constant "${id}")`,
          });
        }
      }
    }
  }
  if (targets.systems !== undefined) {
    for (const system of [
      ...(manifest.systems ?? []),
      ...((manifest.packs ?? []) as readonly UnitSystem[]),
    ]) {
      const name = (system as { name?: unknown })?.name;
      if (typeof name !== "string") {
        conflicts.push({
          kind: "identifier",
          name: "?",
          detail: "malformed system/pack definition",
        });
        continue;
      }
      if (targets.systems.hasSystem(name) || targets.systems.hasPack(name)) {
        conflicts.push({ kind: "identifier", name, detail: "system/pack name already registered" });
      }
    }
  }
  // Intra-manifest duplicates: neither entry is registered yet, so the
  // target checks above cannot see them — but the sequential trial apply
  // would fail halfway. Report them here for a complete dry run.
  const seenIds = new Set<string>();
  const checkInternal = (section: string, id: unknown): void => {
    if (typeof id !== "string") return;
    const key = `${section}::${id}`;
    if (seenIds.has(key)) {
      conflicts.push({
        kind: "identifier",
        name: id,
        detail: `duplicate id within manifest section "${section}"`,
      });
    } else {
      seenIds.add(key);
    }
  };
  for (const def of manifest.units ?? []) {
    checkInternal("units", (def as { symbol?: unknown })?.symbol);
  }
  for (const kind of manifest.kinds ?? []) {
    checkInternal("kinds", (kind as { id?: unknown })?.id);
  }
  for (const fn of manifest.functions ?? []) {
    checkInternal("functions", (fn as { name?: unknown })?.name);
  }
  for (const def of manifest.constants ?? []) {
    checkInternal("constants", (def as { id?: unknown })?.id);
  }
  for (const profile of manifest.profiles ?? []) {
    checkInternal("profiles", (profile as { id?: unknown })?.id);
  }
  if (targets.profiles !== undefined && manifest.profiles !== undefined) {
    for (const profile of manifest.profiles) {
      const id = (profile as { id?: unknown })?.id;
      if (typeof id !== "string") {
        conflicts.push({ kind: "identifier", name: "?", detail: "malformed profile definition" });
        continue;
      }
      if (targets.profiles.has(id)) {
        conflicts.push({ kind: "identifier", name: id, detail: "profile id already registered" });
      }
    }
  }
  return conflicts;
}

function tryResolveSymbol(registry: UnitRegistry, symbol: string): Unit | undefined {
  try {
    return registry.resolve(symbol);
  } catch {
    return undefined;
  }
}

export interface AppliedExtension {
  readonly id: string;
  readonly version: string;
  readonly applied: Readonly<{
    units: number;
    prefixes: number;
    kinds: number;
    functions: number;
    constants: number;
    systems: number;
    packs: number;
    profiles: number;
  }>;
}

/**
 * Apply an extension atomically: validate everything first (dry-run
 * conflicts + per-entry validators), then apply to trial snapshots, and
 * only then to the real targets. Any failure leaves all targets
 * untouched — never a partially updated registry.
 */
export function applyExtension(
  manifest: ExtensionManifest,
  targets: ExtensionTargets,
  opts: { limits?: InteropLimits } = {},
): AppliedExtension {
  const limits = resolveLimits(opts.limits);
  const conflicts = validateExtension(manifest, targets, { limits });
  if (conflicts.length > 0) {
    const first = conflicts[0]!;
    throw new ExtensionError(
      `Extension "${manifest.id}" has ${conflicts.length} conflict(s); first: [${first.kind}] "${first.name}": ${first.detail}`,
    );
  }
  // Trial pass on detached snapshots: catches validator rejections that
  // dry-run comparison cannot (malformed factors, bad dimensions, …).
  const trialUnits = targets.units ? trialUnitRegistry(targets.units) : undefined;
  try {
    if (trialUnits !== undefined) {
      for (const def of manifest.units ?? []) trialUnits.registerAtomic(def);
      // Prefixes have no standalone registry in this engine version: they
      // attach at UnitRegistry construction. Trial-apply validates shape.
      for (const prefix of manifest.prefixes ?? []) assertPrefixShape(prefix, manifest.id);
    }
    if (targets.prefixes !== undefined) {
      const trial = new PrefixRegistry(targets.prefixes.list());
      for (const prefix of manifest.prefixes ?? []) trial.register(prefix);
    }
    if (targets.kinds !== undefined) {
      const trial = targets.kinds.snapshot();
      for (const kind of manifest.kinds ?? []) trial.register(kind);
    }
    if (targets.functions !== undefined) {
      const trial = targets.functions.snapshot();
      for (const fn of manifest.functions ?? []) trial.register(fn);
    }
    if (targets.constants !== undefined) {
      const trial = snapshotConstants(targets.constants);
      for (const def of manifest.constants ?? []) trial.register(def);
    }
    if (targets.systems !== undefined) {
      // True trial-apply on a detached copy: full registry validators run,
      // so malformed systems/packs fail here — never mid-apply.
      const trial = snapshotSystems(targets.systems);
      for (const system of manifest.systems ?? []) trial.registerSystem(system);
      for (const pack of manifest.packs ?? []) trial.registerPack(pack);
    }
    if (targets.profiles !== undefined) {
      const trial = targets.profiles.snapshot();
      for (const profile of manifest.profiles ?? []) trial.register(profile);
    }
  } catch (error) {
    throw new ExtensionError(
      `Extension "${manifest.id}" failed validation: ${(error as Error).message}`,
    );
  }
  // Real pass — validation above guarantees success barring races; each
  // step still throws naturally on violation (fail-fast, no silent writes).
  let units = 0;
  if (targets.units !== undefined) {
    for (const def of manifest.units ?? []) {
      targets.units.registerAtomic(def);
      units++;
    }
  }
  let prefixes = 0;
  if (targets.prefixes !== undefined) {
    for (const prefix of manifest.prefixes ?? []) {
      targets.prefixes.register(prefix);
      prefixes++;
    }
  }
  let kinds = 0;
  if (targets.kinds !== undefined) {
    for (const kind of manifest.kinds ?? []) {
      targets.kinds.register(kind);
      kinds++;
    }
  }
  let functions = 0;
  if (targets.functions !== undefined) {
    for (const fn of manifest.functions ?? []) {
      targets.functions.register(fn);
      functions++;
    }
  }
  let constants = 0;
  if (targets.constants !== undefined) {
    for (const def of manifest.constants ?? []) {
      targets.constants.register(def);
      constants++;
    }
  }
  let systems = 0;
  let packs = 0;
  if (targets.systems !== undefined) {
    for (const system of manifest.systems ?? []) {
      targets.systems.registerSystem(system);
      systems++;
    }
    for (const pack of manifest.packs ?? []) {
      targets.systems.registerPack(pack);
      packs++;
    }
  }
  let profiles = 0;
  if (targets.profiles !== undefined) {
    for (const profile of manifest.profiles ?? []) {
      targets.profiles.register(profile);
      profiles++;
    }
  }
  return Object.freeze({
    id: manifest.id,
    version: manifest.version,
    applied: Object.freeze({
      units,
      prefixes,
      kinds,
      functions,
      constants,
      systems,
      packs,
      profiles,
    }),
  });
}

function trialUnitRegistry(source: UnitRegistry): UnitRegistry {
  // snapshot() detaches; trial writes land on the copy only.
  return source.snapshot();
}

function assertPrefixShape(prefix: unknown, extensionId: string): void {
  if (prefix === null || typeof prefix !== "object" || Array.isArray(prefix)) {
    throw new ExtensionError(`Extension "${extensionId}" prefix must be a plain object`);
  }
  const p = prefix as Record<string, unknown>;
  if (typeof p.symbol !== "string" || p.symbol.length === 0) {
    throw new ExtensionError(`Extension "${extensionId}" prefix needs a symbol`);
  }
  if (typeof p.factor !== "number" || !Number.isFinite(p.factor) || p.factor <= 0) {
    throw new ExtensionError(
      `Extension "${extensionId}" prefix "${p.symbol}" needs a finite positive factor`,
    );
  }
}

function snapshotConstants(registry: ConstantRegistry): ConstantRegistry {
  return registry.snapshot();
}

// ---------------------------------------------------------------------------
// 29.3 Scoped registries: create, compose, snapshot
// ---------------------------------------------------------------------------

/** A coherent bundle of registries forming one isolation scope. */
export interface ExtensionScope {
  readonly units: UnitRegistry;
  readonly kinds: QuantityKindRegistry;
  readonly functions: FunctionRegistry;
  readonly constants: ConstantRegistry;
  readonly systems: UnitSystemRegistry;
  readonly profiles: ProfileRegistry;
}

/**
 * Create an isolated scope: fresh registries seeded with engine defaults
 * (atomic units + seed kinds/functions), sharing no mutable state with the
 * process defaults. Pass explicit seeds to build minimal scopes.
 */
export function createExtensionScope(
  opts: {
    units?: UnitRegistry;
    kinds?: QuantityKindRegistry;
    functions?: FunctionRegistry;
    constants?: ConstantRegistry;
    systems?: UnitSystemRegistry;
    profiles?: ProfileRegistry;
  } = {},
): ExtensionScope {
  return Object.freeze({
    units: opts.units ?? new UnitRegistry(),
    kinds: opts.kinds ?? new QuantityKindRegistry(),
    functions: opts.functions ?? new FunctionRegistry(),
    constants: opts.constants ?? new ConstantRegistry(),
    systems: opts.systems ?? new UnitSystemRegistry(),
    profiles: opts.profiles ?? new ProfileRegistry(),
  });
}

/** Snapshot every registry in a scope (detached, reproducible). */
export function snapshotScope(scope: ExtensionScope): ExtensionScope {
  return Object.freeze({
    units: scope.units.snapshot(),
    kinds: scope.kinds.snapshot(),
    functions: scope.functions.snapshot(),
    constants: scope.constants.snapshot(),
    systems: snapshotSystems(scope.systems),
    profiles: scope.profiles.snapshot(),
  });
}

function snapshotSystems(registry: UnitSystemRegistry): UnitSystemRegistry {
  // UnitSystemRegistry has no snapshot(); rebuild deterministically from
  // its sorted listings (systems then packs — packs may reference nothing
  // order-sensitive since collisions throw identically either way).
  const Ctor = registry.constructor as new () => UnitSystemRegistry;
  const copy: UnitSystemRegistry = new Ctor();
  for (const system of [...registry.listSystems()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    try {
      copy.registerSystem(system);
    } catch {
      // Already present (e.g. shared defaults) — deterministic skip.
    }
  }
  const packs = (registry as unknown as { listPacks?: () => Array<{ name: string }> }).listPacks;
  if (typeof packs === "function") {
    for (const pack of [...packs.call(registry)].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      try {
        copy.registerPack(pack as never);
      } catch {
        // Already present — deterministic skip.
      }
    }
  }
  return copy;
}

// ---------------------------------------------------------------------------
// 29.9–29.10 Namespaces and ambiguity
// ---------------------------------------------------------------------------

export interface ParsedNamespace {
  readonly namespace: string | undefined;
  readonly symbol: string;
}

/** Split "ns:symbol" into namespace + symbol (no registry access). */
export function parseNamespacedSymbol(input: string): ParsedNamespace {
  if (typeof input !== "string" || input.length === 0) {
    throw new AmbiguousUnitError(input, []);
  }
  const idx = input.indexOf(":");
  if (idx < 0) return { namespace: undefined, symbol: input };
  const namespace = input.slice(0, idx);
  const symbol = input.slice(idx + 1);
  if (!NAMESPACE_RE.test(namespace) || symbol.length === 0) {
    throw new ExtensionError(
      `Malformed namespaced symbol "${input}" (expected "namespace:symbol")`,
    );
  }
  return { namespace, symbol };
}

export interface AmbiguityCandidate {
  readonly namespace: string;
  readonly symbol: string;
  readonly dimension: string;
  readonly scale: number;
}

export interface AmbiguityReport {
  readonly input: string;
  readonly candidates: readonly AmbiguityCandidate[];
  readonly resolution: "none" | "unique" | "ambiguous";
  readonly resolved?: AmbiguityCandidate;
}

/** One named unit source consulted during ambiguity resolution. */
export interface AmbiguitySource {
  readonly namespace: string;
  readonly registry: UnitRegistry;
}

export type AmbiguityStrategy = "strict" | "standard" | "permissive";

/**
 * Resolve a symbol across scoped sources without guessing unsafely:
 * - explicit "ns:symbol" selects one source (unknown namespace throws),
 * - zero matches throws UnsupportedUnitError-style UnitEngineError,
 * - one match resolves,
 * - several matches: strict → AmbiguousUnitError; standard → resolve only
 *   when all candidates are physically identical (same dimension+scale),
 *   else AmbiguousUnitError; permissive → first by sorted namespace
 *   (deterministic, documented as a guess).
 * An explicit `system` hint keeps only candidates whose symbol the named
 * system defines (membership test on the system's units/aliases).
 */
export function resolveAmbiguous(
  input: string,
  opts: {
    sources: readonly AmbiguitySource[];
    namespace?: string;
    system?: string;
    systems?: UnitSystemRegistry;
    strategy?: AmbiguityStrategy;
    limits?: InteropLimits;
  },
): AmbiguityReport {
  const limits = resolveLimits(opts.limits);
  if (!Array.isArray(opts.sources) || opts.sources.length === 0) {
    throw new ExtensionError("resolveAmbiguous needs at least one source");
  }
  if (opts.sources.length > limits.maxSources) {
    throw new ExtensionError(`Too many ambiguity sources (max ${limits.maxSources})`);
  }
  const strategy = opts.strategy ?? "standard";
  if (strategy !== "strict" && strategy !== "standard" && strategy !== "permissive") {
    throw new ExtensionError(`Unknown ambiguity strategy "${strategy}"`);
  }
  const parsed = parseNamespacedSymbol(input);
  const effectiveNamespace = opts.namespace ?? parsed.namespace;
  const wanted = parsed.symbol;
  const candidates: AmbiguityCandidate[] = [];
  const seen = new Set<string>();
  const ordered = [...opts.sources].sort((a, b) => (a.namespace < b.namespace ? -1 : 1));
  // Validate all sources up front (fail fast, even for filtered namespaces).
  for (const source of ordered) {
    if (typeof source.namespace !== "string" || !(source.registry instanceof UnitRegistry)) {
      throw new ExtensionError("Ambiguity sources need {namespace, registry: UnitRegistry}");
    }
  }
  // The system hint is source-independent: resolve it once, not per source.
  const systemOk =
    opts.system === undefined ? null : systemKnowsSymbol(opts.system, wanted, opts.systems);
  for (const source of ordered) {
    if (effectiveNamespace !== undefined && source.namespace !== effectiveNamespace) continue;
    const unit = tryResolveSymbol(source.registry, wanted);
    if (unit === undefined) continue;
    if (systemOk === false) continue;
    const key = `${source.namespace}::${unit.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      namespace: source.namespace,
      symbol: unit.symbol,
      dimension: dimensionKey(unit.dimension),
      scale: unit.toBaseFactor,
    });
  }
  if (candidates.length === 0) {
    throw new UnitEngineError(
      `Unknown unit "${input}" in ${ordered.length} source(s)${effectiveNamespace ? ` (namespace "${effectiveNamespace}")` : ""}.`,
    );
  }
  if (candidates.length === 1) {
    return {
      input,
      candidates: Object.freeze(candidates),
      resolution: "unique",
      resolved: candidates[0],
    };
  }
  if (strategy === "strict") {
    throw new AmbiguousUnitError(
      input,
      candidates.map((c) => `${c.namespace}:${c.symbol}`),
    );
  }
  const first = candidates[0]!;
  const identical = candidates.every(
    (c) => c.dimension === first.dimension && c.scale === first.scale,
  );
  if (identical) {
    return { input, candidates: Object.freeze(candidates), resolution: "unique", resolved: first };
  }
  if (strategy === "standard") {
    throw new AmbiguousUnitError(
      input,
      candidates.map((c) => `${c.namespace}:${c.symbol}`),
    );
  }
  return { input, candidates: Object.freeze(candidates), resolution: "ambiguous", resolved: first };
}

function systemKnowsSymbol(
  systemName: string,
  symbol: string,
  systems?: UnitSystemRegistry,
): boolean {
  const registry = systems ?? defaultUnitSystemRegistry;
  const system = registry.getSystem(systemName);
  if (!system) throw new UnitEngineError(`Unknown unit system "${systemName}"`);
  if (system.units.some((u) => u.symbol === symbol)) return true;
  const aliases = system.aliases ?? {};
  return Object.prototype.hasOwnProperty.call(aliases, symbol);
}

// ---------------------------------------------------------------------------
// 29.11 External mappings across scopes (reuses standards-profile validators)
// ---------------------------------------------------------------------------

export interface ExternalMappingOptions {
  readonly registry?: UnitRegistry;
  readonly limits?: InteropLimits;
}

/**
 * Resolve an external name through an explicit mapping, trying scoped
 * registries in order. Mapping values are engine unit expressions resolved
 * in the matching scope's registry. Unknown names, unresolvable targets
 * and ambiguous multi-scope hits (different physics) throw explicitly.
 */
export function mapExternalUnit(
  name: string,
  mapping: Readonly<Record<string, string>>,
  scopes: readonly { namespace: string; registry: UnitRegistry }[],
  opts: ExternalMappingOptions = {},
): { namespace: string; unit: Unit } {
  const limits = resolveLimits(opts.limits);
  if (typeof name !== "string" || name.length === 0) {
    throw new ExtensionError("mapExternalUnit needs a non-empty external name");
  }
  assertPlainRecord(mapping, "external mapping");
  if (Object.keys(mapping).length > limits.maxExtensionEntries) {
    throw new ExtensionError(
      `External mapping exceeds maxExtensionEntries ${limits.maxExtensionEntries}`,
    );
  }
  if (!Object.prototype.hasOwnProperty.call(mapping, name)) {
    throw new ExtensionError(`No external mapping for "${name}"`);
  }
  // Reuse the validated single-registry mapper per scope for identical
  // validation semantics (fail fast on bad targets).
  const hits: Array<{ namespace: string; unit: Unit }> = [];
  let lastError: unknown;
  const ordered = [...scopes].sort((a, b) => (a.namespace < b.namespace ? -1 : 1));
  for (const scope of ordered) {
    try {
      const unit = importUnitName(name, mapping, { registry: scope.registry });
      hits.push({ namespace: scope.namespace, unit });
    } catch (error) {
      lastError = error;
    }
  }
  if (hits.length === 0) {
    throw new ExtensionError(
      `External unit "${name}" resolves in no scope (${(lastError as Error)?.message ?? "unknown reason"})`,
    );
  }
  const first = hits[0]!;
  const consistent = hits.every(
    (h) =>
      dimensionsEqual(h.unit.dimension, first.unit.dimension) &&
      h.unit.toBaseFactor === first.unit.toBaseFactor,
  );
  if (!consistent) {
    throw new AmbiguousUnitError(
      name,
      hits.map((h) => `${h.namespace}:${h.unit.symbol}`),
    );
  }
  return first;
}

// ---------------------------------------------------------------------------
// 29.12/29.13/29.15/29.16/29.17 Interchange formats
// ---------------------------------------------------------------------------

/** Current interchange schema version. */
export const INTERCHANGE_SCHEMA_VERSION = 1;

export type InterchangeKind =
  | "quantity"
  | "measurement"
  | "measurement-series"
  | "measurement-dataset"
  | "formula-result"
  | "reference-data";

/**
 * Unknown-field policy. Only two policies exist by design: decoded engine
 * values (Quantity, Measurement, …) cannot carry unknown fields, so a
 * "preserve" mode would silently drop data while claiming otherwise.
 * Carriers that must retain extension fields should keep the envelope
 * itself (whose `extensions` member round-trips verbatim).
 */
export type UnknownFieldPolicy = "reject" | "ignore";

export interface InterchangeEnvelope {
  readonly schemaVersion: 1;
  readonly kind: InterchangeKind;
  readonly payload: unknown;
  /** Producer-supplied extension fields (data only, never executed). */
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface InterchangeOptions {
  readonly registry?: UnitRegistry;
  readonly limits?: InteropLimits;
  /** How to handle unknown structural fields (default "reject"). */
  readonly unknownFields?: UnknownFieldPolicy;
}

function checkUnknownFields(
  payload: Record<string, unknown>,
  known: readonly string[],
  policy: UnknownFieldPolicy,
  what: string,
): void {
  const unknown = Object.keys(payload).filter((k) => !known.includes(k));
  if (unknown.length === 0) return;
  if (policy === "reject") {
    throw new ExtensionError(`${what} has unknown field(s): ${unknown.sort().join(", ")}`);
  }
  // "ignore": drop silently (documented).
}

/**
 * Convert engine values to plain-data interchange envelopes. Accepts
 * Quantity, Measurement, MeasurementSeries, MeasurementDataset, formula
 * results (Quantity|Measurement) and serialized constant registries.
 * Consumers never see the internal object graph — only frozen plain data.
 * Optional producer `extensions` travel verbatim (validated data only).
 */
export function toInterchange(
  value: unknown,
  opts: { extensions?: Readonly<Record<string, unknown>> } = {},
): InterchangeEnvelope {
  const extensions = opts.extensions === undefined ? undefined : freezeExtensions(opts.extensions);
  if (value instanceof Quantity) {
    return freezeEnvelope("quantity", serializeQuantity(value), extensions);
  }
  if (value instanceof Measurement) {
    return freezeEnvelope("measurement", serializeMeasurement(value), extensions);
  }
  if (value instanceof MeasurementSeries) {
    return freezeEnvelope("measurement-series", value.serialize(), extensions);
  }
  if (value instanceof MeasurementDataset) {
    return freezeEnvelope("measurement-dataset", value.serialize(), extensions);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.type === "constant-registry") {
      return freezeEnvelope("reference-data", value, extensions);
    }
  }
  throw new ExtensionError(
    "toInterchange supports Quantity, Measurement, MeasurementSeries, MeasurementDataset and serialized constant registries only",
  );
}

function freezeExtensions(
  extensions: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  assertPlainRecord(extensions, "Interchange extensions");
  // Object-literal __proto__ sets the prototype instead of an own key, so
  // the pollution-key check above cannot see it — require a plain prototype.
  if (Object.getPrototypeOf(extensions) !== Object.prototype) {
    throw new ExtensionError("Interchange extensions must be plain objects");
  }
  return Object.freeze({ ...extensions });
}

function freezeEnvelope(
  kind: InterchangeKind,
  payload: unknown,
  extensions: Readonly<Record<string, unknown>> | undefined,
): InterchangeEnvelope {
  return Object.freeze({
    schemaVersion: INTERCHANGE_SCHEMA_VERSION,
    kind,
    payload,
    ...(extensions !== undefined ? { extensions } : {}),
  });
}

const INTERCHANGE_KNOWN_TOP_LEVEL = ["schemaVersion", "kind", "payload", "extensions"] as const;

/**
 * Reconstruct validated engine values from interchange envelopes.
 * Data-only: objects are rebuilt through trusted constructors/factories —
 * embedded functions, class instances or prototypes are rejected.
 */
export function fromInterchange(
  data: unknown,
  opts: InterchangeOptions = {},
): Quantity | Measurement | MeasurementSeries | MeasurementDataset | unknown {
  const limits = resolveLimits(opts.limits);
  const policy = opts.unknownFields ?? "reject";
  if (typeof data === "string") {
    if (data.length > limits.maxInterchangeChars) {
      throw new ExtensionError(
        `Interchange payload exceeds maxInterchangeChars ${limits.maxInterchangeChars}`,
      );
    }
    try {
      data = JSON.parse(data);
    } catch {
      throw new ExtensionError("Malformed interchange envelope: invalid JSON");
    }
  }
  assertPlainRecord(data, "Interchange envelope");
  if (data.schemaVersion !== INTERCHANGE_SCHEMA_VERSION) {
    if (data.schemaVersion === undefined) {
      throw new ExtensionError("Interchange envelope missing schemaVersion");
    }
    throw new ExtensionError(
      `Unsupported interchange schemaVersion ${String(data.schemaVersion)} (engine supports ${INTERCHANGE_SCHEMA_VERSION}; see migrateSerialized)`,
    );
  }
  if (typeof data.kind !== "string") {
    throw new ExtensionError("Interchange envelope missing kind");
  }
  // Unknown top-level fields follow the policy. Note the envelope's own
  // `extensions` member is a KNOWN field, so producer extensions always
  // survive the trip as envelope data even under "reject".
  checkUnknownFields(
    Object.fromEntries(
      Object.entries(data).filter(
        ([k]) =>
          !INTERCHANGE_KNOWN_TOP_LEVEL.includes(k as (typeof INTERCHANGE_KNOWN_TOP_LEVEL)[number]),
      ),
    ),
    [],
    policy,
    "Interchange envelope",
  );
  const registry = opts.registry ?? defaultUnitRegistry;
  // Observation caps flow into series/dataset decoders so interchange-level
  // limits are enforced, not merely declared.
  const datasetLimits = { maxObservations: limits.maxInterchangeObservations };
  switch (data.kind as InterchangeKind) {
    case "quantity":
      return deserializeQuantity(data.payload, registry);
    case "measurement":
      return deserializeMeasurement(data.payload, registry);
    case "measurement-series":
      return MeasurementSeries.deserialize(data.payload, { registry, limits: datasetLimits });
    case "measurement-dataset": {
      return MeasurementDataset.deserialize(data.payload, { registry, limits: datasetLimits });
    }
    case "formula-result":
      // Formula results are Quantity|Measurement payloads tagged at export.
      return fromInterchange(
        {
          schemaVersion: 1,
          kind: (data.payload as Record<string, unknown>).resultKind,
          payload: (data.payload as Record<string, unknown>).result,
        },
        opts,
      );
    case "reference-data":
      // Reuse the constants deserializer (validates registry data fully).
      return deserializeConstantRegistryRef(data.payload, registry);
    default:
      throw new ExtensionError(`Unknown interchange kind "${String(data.kind)}"`);
  }
}

function deserializeConstantRegistryRef(payload: unknown, registry: UnitRegistry): unknown {
  return deserializeConstantRegistry(payload, { units: registry });
}

// ---------------------------------------------------------------------------
// 29.14 Migration infrastructure
// ---------------------------------------------------------------------------

/** One version step for a serialized kind. Host-registered code, never serialized. */
export interface Migration {
  readonly kind: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(data: unknown): unknown;
}

/**
 * Migrate serialized data toward a target version by chaining registered
 * migrations. Each step validates shape minimally (plain object with
 * matching version/type or kind) and never executes embedded content.
 * Unknown versions and missing steps throw MigrationError — old values are
 * never silently reinterpreted.
 */
export function migrateSerialized(
  data: unknown,
  migrations: readonly Migration[],
  targetVersion: number,
  kind?: string,
): unknown {
  if (!Array.isArray(migrations)) {
    throw new MigrationError("migrateSerialized needs an array of migrations");
  }
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new MigrationError("migrateSerialized target version must be a positive integer");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new MigrationError("migrateSerialized needs a serialized object");
  }
  const record = data as Record<string, unknown>;
  if (hasPollutionKeys(record)) {
    throw new MigrationError("Cannot migrate data with forbidden prototype keys");
  }
  let current = data;
  let guard = 0;
  for (;;) {
    const version = (current as Record<string, unknown>).version;
    if (version === targetVersion) return current;
    if (typeof version !== "number" || !Number.isInteger(version)) {
      throw new MigrationError("Migrated data must carry an integer version at every step");
    }
    if (++guard > 64) {
      throw new MigrationError("Migration chain exceeds 64 steps (possible cycle)");
    }
    const step = migrations.find(
      (m) =>
        m.kind ===
          (kind ??
            (current as Record<string, unknown>).type ??
            (current as Record<string, unknown>).kind) && m.fromVersion === version,
    );
    if (!step) {
      throw new MigrationError(
        `No migration from version ${String(version)} to ${targetVersion}${kind ? ` for "${kind}"` : ""}`,
      );
    }
    if (typeof step.migrate !== "function") {
      throw new MigrationError("Migration entry needs a migrate function");
    }
    current = step.migrate(current);
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      throw new MigrationError("Migration step must return a plain object");
    }
    if (hasPollutionKeys(current as Record<string, unknown>)) {
      throw new MigrationError("Migration step produced forbidden prototype keys");
    }
  }
}

// ---------------------------------------------------------------------------
// 29.18–29.20 Parser interop, canonicalization, format presets
// ---------------------------------------------------------------------------

export interface CanonicalIdentity {
  /** Stable key covering dimension + scale + kind (display-independent). */
  readonly key: string;
  /** Canonical dimension key. */
  readonly dimension: string;
  /** Scale to canonical base units. */
  readonly scale: number;
  /** Unit symbol that produced it (provenance, not identity). */
  readonly symbol: string;
}

/**
 * Render a scale for identity keys, immune to float dust: "kg·m·s⁻²"
 * (multiplied by 1/86400) and "kg*m/s^2" (divided by 86400²) are the same
 * physics but differ by 1 ulp in binary floating point. Rounding to 12
 * significant digits unifies them; genuinely different unit scales are never
 * within 1e-12 relative of each other. The numeric `scale` field keeps full
 * precision — only the string key is dust-tolerant.
 */
export function canonicalScaleKey(scale: number): string {
  if (!Number.isFinite(scale)) return String(scale);
  if (scale === 0) return "0";
  return String(Number(scale.toPrecision(12)));
}

/**
 * Stable canonical identity for a unit: dimension key + base scale +
 * semantic kind. Named and expanded forms (N vs kg·m/s² vs kg·m·s⁻²) share
 * it; display preference is never part of identity.
 */
export function canonicalIdentity(unit: Unit): CanonicalIdentity {
  if (unit === null || typeof unit !== "object") {
    throw new UnitEngineError("canonicalIdentity needs a Unit");
  }
  return Object.freeze({
    key: `${dimensionKey(unit.dimension)}|${canonicalScaleKey(unit.toBaseFactor)}|${unit.metadata?.kind ?? ""}`,
    dimension: dimensionKey(unit.dimension),
    scale: unit.toBaseFactor,
    symbol: unit.symbol,
  });
}

/**
 * Parse equivalent textual spellings to one canonical identity:
 * "m/s", "m·s^-1", "kg*m/s^2", "kg m s^-2" (space juxtaposition is
 * treated as multiplication) all resolve identically. Whitespace between
 * factors means multiply; anything else throws via the core parser.
 */
export function canonicalizeUnitText(
  input: string,
  registry: UnitRegistry = defaultUnitRegistry,
): CanonicalIdentity {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new UnitEngineError("canonicalizeUnitText needs a non-empty string");
  }
  // Normalize juxtaposition: "kg m s^-2" → "kg*m*s^-2". The core parser
  // owns operator semantics; this only makes implicit multiplication
  // explicit, then delegates. A "/" anywhere disables juxtaposition
  // handling to avoid precedence ambiguity ("a/b c" stays an error).
  let text = input.trim();
  if (!text.includes("/") && /\s/.test(text)) {
    text = text.split(/\s+/).join("*");
  }
  const unit = parseUnit(text, registry);
  return canonicalIdentity(unit);
}

export type FormatPreset =
  "canonical" | "symbolic" | "human" | "compact" | "machine" | "system-preferred";

export interface FormatPresetOptions {
  readonly registry?: UnitRegistry;
  /** Required for "system-preferred": resolves the system + profile. */
  readonly systems?: UnitSystemRegistry;
  readonly profiles?: ProfileRegistry;
  readonly system?: string;
  readonly profile?: string;
  readonly format?: FormatOptions;
  readonly limits?: InteropLimits;
}

/**
 * Named output modes mapping onto existing formatter options (no new
 * rendering engine). Physical identity never depends on the preset.
 * - canonical: deterministic ascii symbols (stable across locales)
 * - symbolic: unicode superscripts, middle dot
 * - human: spaced, kind shown
 * - compact: ascii, no spaces, caret powers
 * - machine: ascii, full precision via significantFigures: 17
 * - system-preferred: convert to the profile's preferred unit, then human
 */
export function formatWithPreset(
  value: Quantity | Measurement,
  preset: FormatPreset,
  opts: FormatPresetOptions = {},
): string {
  const base: FormatOptions = { ...(opts.format ?? {}) };
  switch (preset) {
    case "canonical": {
      if (value instanceof Measurement) {
        return `${formatQuantity(value.value, { ...base, ascii: true })} ± ${formatQuantity(value.uncertainty, { ...base, ascii: true })}`;
      }
      return formatQuantity(value, { ...base, ascii: true });
    }
    case "symbolic":
      return formatValue(value, { ...base, ascii: false, superscript: true });
    case "human":
      return formatValue(value, { ...base, showKind: true, spacing: " " });
    case "compact":
      return formatValue(value, {
        ...base,
        ascii: true,
        spacing: "",
        multiplicationSymbol: "*",
      });
    case "machine":
      return formatValue(value, { ...base, ascii: true, significantFigures: 17 });
    case "system-preferred": {
      if (opts.system === undefined) {
        throw new ExtensionError('Format preset "system-preferred" needs opts.system');
      }
      // Reuse the standards-profile machinery (no duplicate logic).
      return formatViaProfile(value, opts);
    }
    default:
      throw new ExtensionError(`Unknown format preset "${preset}"`);
  }
}

function formatValue(value: Quantity | Measurement, opts: FormatOptions): string {
  if (value instanceof Measurement) {
    return `${formatQuantity(value.value, opts)} ± ${formatQuantity(value.uncertainty, opts)}`;
  }
  return formatQuantity(value, opts);
}

function formatViaProfile(value: Quantity | Measurement, opts: FormatPresetOptions): string {
  const systems = opts.systems ?? defaultUnitSystemRegistry;
  const system = systems.getSystem(opts.system!);
  if (!system) throw new ExtensionError(`Unknown unit system "${opts.system}"`);
  const registry = opts.registry ?? defaultUnitRegistry;
  // Profiles optionally refine the target (composite-dimension mappings);
  // without one, system category preferences apply to base dimensions.
  // A same-named profile is a convenience default, never a requirement.
  const profileId = opts.profile ?? system.name;
  const profile =
    opts.profiles !== undefined && opts.profiles.has(profileId)
      ? opts.profiles.get(profileId)
      : undefined;
  const converted =
    value instanceof Measurement
      ? normalizeMeasurementToSystem(value, system, { profile, registry })
      : normalizeToSystem(value, system, { profile, registry });
  return formatValue(converted, { ascii: true, ...(opts.format ?? {}) });
}

// ---------------------------------------------------------------------------
// 29.21–29.23 Precision and comparison policies
// ---------------------------------------------------------------------------

export interface PrecisionPolicy {
  /** Significant figures for display (presentation only). */
  readonly significantFigures?: number;
  /** Fixed decimals for display (presentation only). */
  readonly decimals?: number;
  /** Numeric notation for display. */
  readonly notation?: "standard" | "scientific" | "engineering";
  /** Tolerance used by approximate comparison. */
  readonly tolerance?: ComparisonOptions | number;
}

export type ComparisonMode = "exact" | "absolute" | "relative" | "combined";

/**
 * Scientifically explicit comparison. Dimension mismatch always throws
 * (no policy bypasses dimensional safety). Modes:
 * - exact: deterministic Object.is on base-unit values (like exactEquals).
 * - absolute: |a−b| ≤ absTol. - relative: |a−b| ≤ relTol·max(|a|,|b|) (zero-safe: falls back to absTol).
 * - combined: |a−b| ≤ max(absTol, relTol·max(|a|,|b|)).
 */
export function compareQuantities(
  a: Quantity,
  b: Quantity,
  mode: ComparisonMode = "combined",
  tolerance: ComparisonOptions | number = {},
): boolean {
  if (!(a instanceof Quantity) || !(b instanceof Quantity)) {
    throw new UnitEngineError("compareQuantities needs two Quantity values");
  }
  if (!dimensionsEqual(a.dimension, b.dimension)) {
    throw new UnitEngineError(
      `Cannot compare "${a.unit.symbol}" with "${b.unit.symbol}" (different dimensions).`,
    );
  }
  const av = a.toBase().value;
  const bv = b.toBase().value;
  if (mode === "exact") return Object.is(av, bv);
  const opts: ComparisonOptions =
    typeof tolerance === "number" ? { epsilon: tolerance } : tolerance;
  const absTol = opts.absoluteTolerance ?? opts.epsilon ?? 1e-12;
  const relTol = opts.relativeTolerance ?? 1e-9;
  if (!(absTol >= 0) || !(relTol >= 0)) {
    throw new UnitEngineError("Comparison tolerances must be ≥ 0");
  }
  const diff = Math.abs(av - bv);
  if (mode === "absolute") return diff <= absTol;
  const scale = Math.max(Math.abs(av), Math.abs(bv));
  if (mode === "relative") return scale === 0 ? diff <= absTol : diff <= relTol * scale;
  return diff <= Math.max(absTol, relTol * scale);
}

/** equals() vs approximatelyEquals(), stated plainly for API clarity. */
export function quantitiesEqual(a: Quantity, b: Quantity): boolean {
  if (!(a instanceof Quantity) || !(b instanceof Quantity)) {
    throw new UnitEngineError("quantitiesEqual needs two Quantity values");
  }
  return compareQuantities(a, b, "exact");
}

export function quantitiesApproximatelyEqual(
  a: Quantity,
  b: Quantity,
  tolerance: ComparisonOptions | number = {},
): boolean {
  return compareQuantities(a, b, "combined", tolerance);
}

// ---------------------------------------------------------------------------
// 29.24–29.27 Diagnostics: warnings, explainability, strictness
// ---------------------------------------------------------------------------

export type WarningSeverity = "info" | "warn";
export type WarningCode =
  | "deprecated-unit"
  | "ambiguous-unit"
  | "implicit-conversion"
  | "precision-loss"
  | "unsupported-uncertainty"
  | "profile-mismatch"
  | "approximate-conversion";

export interface ScientificWarning {
  readonly code: WarningCode;
  readonly severity: WarningSeverity;
  readonly message: string;
}

export type StrictnessPolicy = "strict" | "standard" | "permissive";

export interface ResolvedStrictness {
  readonly policy: StrictnessPolicy;
  /** Unit-parser strict flag. */
  readonly parserStrict: boolean;
  /** Semantic policy applied to kind checks. */
  readonly semanticPolicy: SemanticPolicy;
  readonly allowDeprecated: boolean;
  readonly allowAmbiguous: boolean;
}

/**
 * Map strictness to concrete engine options. Permissive NEVER disables
 * dimensional safety — there is simply no flag for that, by construction.
 * strict: parser strict, kinds strict-semantic, deprecated/ambiguity rejected.
 * standard: normal safe behavior. permissive: documented compat behavior
 * (deprecated allowed with warning, ambiguous resolved deterministically).
 */
export function resolveStrictness(policy: StrictnessPolicy = "standard"): ResolvedStrictness {
  if (policy !== "strict" && policy !== "standard" && policy !== "permissive") {
    throw new UnitEngineError(`Unknown strictness policy "${policy}"`);
  }
  if (policy === "strict") {
    return {
      policy,
      parserStrict: true,
      semanticPolicy: "strict-semantic",
      allowDeprecated: false,
      allowAmbiguous: false,
    };
  }
  if (policy === "permissive") {
    return {
      policy,
      parserStrict: false,
      semanticPolicy: "dimensional-only",
      allowDeprecated: true,
      allowAmbiguous: true,
    };
  }
  return {
    policy,
    parserStrict: false,
    semanticPolicy: "semantic-aware",
    allowDeprecated: true,
    allowAmbiguous: false,
  };
}

export interface ConversionStep {
  readonly from: string;
  readonly to: string;
  readonly factor: number;
}

export interface ExplainResult {
  readonly inputs: Readonly<Record<string, string>>;
  readonly dimension: string;
  readonly conversionSteps: readonly ConversionStep[];
  readonly formula?: string;
  readonly output: string;
  readonly warnings: readonly ScientificWarning[];
}

/**
 * Explain a unit conversion: normalized inputs, dimensional analysis,
 * conversion steps and warnings. Optional diagnostics — the fast path
 * (Quantity.to) is untouched.
 */
export function explainConversion(
  q: Quantity,
  targetUnit: string,
  opts: { registry?: UnitRegistry; strictness?: StrictnessPolicy } = {},
): ExplainResult {
  if (!(q instanceof Quantity)) {
    throw new UnitEngineError("explainConversion needs a Quantity");
  }
  const registry = opts.registry ?? defaultUnitRegistry;
  const strictness = resolveStrictness(opts.strictness ?? "standard");
  const target = parseUnit(targetUnit, registry, { strict: strictness.parserStrict });
  // Factor as "value of 1 source-unit in target" (avoids 0/0 for zero
  // quantities; for affine units this includes the offset by definition).
  let factor: number;
  try {
    factor = Quantity.of(1, q.unit.symbol, registry).to(target).value;
  } catch {
    factor = NaN;
  }
  const warnings: ScientificWarning[] = [];
  if (targetUnit !== q.unit.symbol) {
    warnings.push({
      code: "implicit-conversion",
      severity: "info",
      message: `Converted "${q.unit.symbol}" to "${targetUnit}" for display; stored value unchanged.`,
    });
  }
  if (!Number.isFinite(factor)) {
    warnings.push({
      code: "approximate-conversion",
      severity: "warn",
      message: "Conversion factor is non-finite; result may not be meaningful.",
    });
  }
  return Object.freeze({
    inputs: Object.freeze({ value: `${q.value} ${q.unit.symbol}` }),
    dimension: dimensionKey(q.dimension),
    conversionSteps: Object.freeze([{ from: q.unit.symbol, to: target.symbol, factor }]),
    output: `${q.to(target).value} ${target.symbol}`,
    warnings: Object.freeze(warnings),
  });
}

/**
 * Explain a formula evaluation: normalized inputs, dimensional analysis,
 * output and warnings. Wraps the existing trace + dimension inference —
 * no second evaluator. Strictness comes from the formula definition
 * itself; there is no per-explanation override by design.
 */
export function explainFormula(
  formula: Formula,
  bindings: FormulaBindings,
  opts: { registry?: UnitRegistry } = {},
): ExplainResult {
  const registry = opts.registry ?? defaultUnitRegistry;
  const inputs: Record<string, string> = {};
  for (const [name, binding] of Object.entries(bindings)) {
    if (binding instanceof Quantity) inputs[name] = `${binding.value} ${binding.unit.symbol}`;
    else if (binding instanceof Measurement) {
      inputs[name] =
        `${binding.value.value} ± ${binding.uncertainty.value} ${binding.value.unit.symbol}`;
    } else {
      inputs[name] = String(binding);
    }
  }
  const varDims: Record<string, DimensionVector> = {};
  for (const [name, binding] of Object.entries(bindings)) {
    if (binding instanceof Quantity) varDims[name] = binding.dimension;
    else if (binding instanceof Measurement) varDims[name] = binding.dimension;
  }
  const analysis = inferExpressionDimension(formula.expression, varDims, { registry });
  const result = evaluateFormula(formula, bindings, { registry });
  const output =
    result instanceof Measurement
      ? `${result.value.value} ± ${result.uncertainty.value} ${result.value.unit.symbol}`
      : result instanceof Quantity
        ? `${result.value} ${result.unit.symbol}`
        : JSON.stringify(result);
  const warnings: ScientificWarning[] = [];
  if (formula.outputUnit !== undefined) {
    warnings.push({
      code: "implicit-conversion",
      severity: "info",
      message: `Result converted to declared output unit "${formula.outputUnit}".`,
    });
  }
  return Object.freeze({
    inputs: Object.freeze(inputs),
    dimension: dimensionKey(analysis),
    conversionSteps: Object.freeze([]),
    formula: formula.id,
    output,
    warnings: Object.freeze(warnings),
  });
}

// ---------------------------------------------------------------------------
// 29.28 Function metadata helpers (registry hardening support)
// ---------------------------------------------------------------------------

/**
 * Validate a function name or alias against registry + pattern rules.
 * Used by extension manifests before registration.
 */
export function assertValidFunctionName(name: string, owner: string): void {
  if (typeof name !== "string" || !/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new ExtensionError(`${owner} function name must match /^[a-z][a-z0-9_]*$/`);
  }
}

// ---------------------------------------------------------------------------
// 29.30–29.31 Reference data interop + external standard references
// ---------------------------------------------------------------------------

/** Pointer to an external standard (identifier + edition, offline data only). */
export interface StandardReference {
  /** Stable identifier, e.g. "BIPM-SI-BROCHURE". */
  readonly identifier: string;
  /** Edition/version, e.g. "9th edition". */
  readonly edition?: string;
  /** Source metadata, e.g. publisher or URL-as-text (never fetched). */
  readonly source?: string;
  /** Effective date (ISO 8601) if available. */
  readonly effectiveDate?: string;
}

/** Validate a StandardReference (data only — the engine never fetches it). */
export function assertValidStandardReference(ref: StandardReference, owner: string): void {
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)) {
    throw new ExtensionError(`${owner} standard reference must be a plain object`);
  }
  if (hasPollutionKeys(ref as unknown as Record<string, unknown>)) {
    throw new ExtensionError(`${owner} standard reference contains forbidden keys`);
  }
  if (typeof ref.identifier !== "string" || ref.identifier.trim().length === 0) {
    throw new ExtensionError(`${owner} standard reference needs a non-empty identifier`);
  }
  if (ref.edition !== undefined && typeof ref.edition !== "string") {
    throw new ExtensionError(`${owner} standard reference edition must be a string`);
  }
  if (ref.source !== undefined && typeof ref.source !== "string") {
    throw new ExtensionError(`${owner} standard reference source must be a string`);
  }
  if (ref.effectiveDate !== undefined) {
    if (typeof ref.effectiveDate !== "string" || Number.isNaN(Date.parse(ref.effectiveDate))) {
      throw new ExtensionError(`${owner} standard reference effectiveDate must be ISO 8601`);
    }
  }
}

/**
 * Attach a validated standard reference to a metadata record, returning a
 * frozen copy. The original object is never mutated.
 */
export function attachStandardRef(
  metadata: Readonly<Record<string, unknown>> | undefined,
  ref: StandardReference,
  owner: string,
): Readonly<Record<string, unknown>> {
  assertValidStandardReference(ref, owner);
  const base = metadata ?? {};
  assertPlainRecord(base, `${owner} metadata`);
  return Object.freeze({ ...base, standardRef: Object.freeze({ ...ref }) });
}
