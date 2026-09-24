/**
 * unit-system.ts — UnitSystem, UnitPack, and registry for extensible
 * standards-aware unit ecosystems. No domain logic; purely data/config.
 */

import { UnitEngineError } from "./errors/index.js";
import type { AtomicUnitDef } from "./units/atomic-units.js";
import { ATOMIC_UNITS } from "./units/atomic-units.js";
import { UnitRegistry } from "./unit-registry.js";
import type { Prefix, PrefixRegistry } from "./prefix.js";
import { SI_PACK, SI_DERIVED_UNITS } from "./packs/si.js";
import { IMPERIAL_PACK } from "./packs/imperial.js";
import { US_CUSTOMARY_PACK } from "./packs/us-customary.js";
import { CGS_PACK } from "./packs/cgs.js";
import { SCIENTIFIC_PACK } from "./packs/scientific.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnitSystem {
  readonly name: string;
  readonly version: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly units: readonly AtomicUnitDef[];
  readonly aliases?: Readonly<Record<string, string>>;
  readonly preferredUnits?: Readonly<Record<string, string>>; // e.g. { "length": "m", "mass": "kg" }
  readonly prefixes?: readonly Prefix[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface UnitPack {
  readonly name: string;
  readonly version: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly units: readonly AtomicUnitDef[];
  readonly aliases?: Readonly<Record<string, string>>;
  readonly prefixes?: readonly Prefix[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class UnitSystemError extends UnitEngineError {
  constructor(message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function assertValidName(name: string, kind: string): void {
  if (!name || typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
    throw new UnitSystemError(
      `${kind} name must be a valid identifier (e.g. "si", "imperial"), got "${String(name)}"`,
    );
  }
}

function assertValidVersion(version: string): void {
  if (!version || typeof version !== "string" || version.trim().length === 0) {
    throw new UnitSystemError(`Version must be a non-empty string, got "${String(version)}"`);
  }
}

function hasPollutionKeys(obj: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(obj, "__proto__") ||
    Object.prototype.hasOwnProperty.call(obj, "constructor") ||
    Object.prototype.hasOwnProperty.call(obj, "prototype")
  );
}

const DIMENSION_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Structural dimension check (plain object, valid ids, integer exponents). No registry coupling. */
function assertValidDimensionVector(dim: unknown, owner: string): void {
  if (!dim || typeof dim !== "object" || Array.isArray(dim)) {
    throw new UnitSystemError(`${owner} has an invalid dimension (must be a plain object)`);
  }
  const record = dim as Record<string, unknown>;
  if (hasPollutionKeys(record)) {
    throw new UnitSystemError(`${owner} dimension contains forbidden keys`);
  }
  for (const [id, exp] of Object.entries(record)) {
    if (!DIMENSION_ID_PATTERN.test(id)) {
      throw new UnitSystemError(`${owner} has invalid dimension id "${id}"`);
    }
    if (typeof exp !== "number" || !Number.isInteger(exp)) {
      throw new UnitSystemError(`${owner} has non-integer exponent for "${id}"`);
    }
  }
}

/** Conversion definitions must be declarative (no functions) with finite scale/offset. */
function assertValidConversionDef(conversion: unknown, owner: string): void {
  if (conversion === undefined) return;
  if (!conversion || typeof conversion !== "object" || Array.isArray(conversion)) {
    throw new UnitSystemError(`${owner} has an invalid conversion definition`);
  }
  const conv = conversion as Record<string, unknown>;
  if (hasPollutionKeys(conv)) {
    throw new UnitSystemError(`${owner} conversion contains forbidden keys`);
  }
  if (
    conv.kind !== "linear" &&
    conv.kind !== "affine" &&
    conv.kind !== "logarithmic" &&
    conv.kind !== "custom"
  ) {
    throw new UnitSystemError(`${owner} has unknown conversion kind "${String(conv.kind)}"`);
  }
  if (conv.kind === "logarithmic") {
    if (
      typeof conv.reference !== "number" ||
      !Number.isFinite(conv.reference) ||
      conv.reference === 0
    ) {
      throw new UnitSystemError(
        `${owner} logarithmic conversion needs a finite non-zero reference`,
      );
    }
    if (typeof conv.factor !== "number" || !Number.isFinite(conv.factor) || conv.factor === 0) {
      throw new UnitSystemError(`${owner} logarithmic conversion needs a finite non-zero factor`);
    }
    return;
  }
  if (conv.kind === "custom") {
    if (typeof conv.id !== "string" || conv.id.trim().length === 0) {
      throw new UnitSystemError(`${owner} custom conversion needs a non-empty id`);
    }
    return;
  }
  if (typeof conv.scale !== "number" || !Number.isFinite(conv.scale) || conv.scale === 0) {
    throw new UnitSystemError(`${owner} has invalid conversion scale`);
  }
  if (conv.kind === "affine" && typeof conv.offset !== "number") {
    throw new UnitSystemError(`${owner} affine conversion needs a numeric offset`);
  }
  if (conv.kind === "affine" && !Number.isFinite(conv.offset as number)) {
    throw new UnitSystemError(`${owner} affine conversion needs a finite offset`);
  }
}

/**
 * Metadata must be declarative data only — no functions, symbols or prototype
 * tricks. Packs are configuration, never executable behavior.
 */
function assertDeclarativeMetadata(value: unknown, owner: string, depth = 0): void {
  if (depth > 4) throw new UnitSystemError(`${owner} metadata is nested too deeply`);
  if (value === null || value === undefined) return;
  const t = typeof value;
  if (t === "function" || t === "symbol") {
    throw new UnitSystemError(`${owner} metadata must not contain executable values`);
  }
  if (t !== "object") return; // primitives (string/number/boolean) are fine
  if (Array.isArray(value)) {
    for (const item of value) assertDeclarativeMetadata(item, owner, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (hasPollutionKeys(record)) {
    throw new UnitSystemError(`${owner} metadata contains forbidden keys`);
  }
  for (const v of Object.values(record)) assertDeclarativeMetadata(v, owner, depth + 1);
}

/** Full unit-definition validation shared by system and pack registration. */
function assertValidUnitDef(def: AtomicUnitDef, owner: string): void {
  if (!def || typeof def !== "object" || Array.isArray(def)) {
    throw new UnitSystemError(`${owner} has an invalid unit definition`);
  }
  if (hasPollutionKeys(def as unknown as Record<string, unknown>)) {
    throw new UnitSystemError(`${owner} unit contains forbidden keys`);
  }
  if (!def.symbol || typeof def.symbol !== "string") {
    throw new UnitSystemError(`${owner} has invalid unit symbol`);
  }
  if (typeof def.label !== "string" || def.label.trim().length === 0) {
    throw new UnitSystemError(`${owner} unit "${def.symbol}" needs a non-empty label`);
  }
  assertValidDimensionVector(def.dimension, `${owner} unit "${def.symbol}"`);
  assertValidConversionDef(
    (def as { conversion?: unknown }).conversion,
    `${owner} unit "${def.symbol}"`,
  );
  if (
    typeof def.toBaseFactor !== "number" ||
    !Number.isFinite(def.toBaseFactor) ||
    def.toBaseFactor === 0
  ) {
    throw new UnitSystemError(`${owner} unit "${def.symbol}" has invalid factor`);
  }
  if (def.metadata !== undefined) {
    assertDeclarativeMetadata(def.metadata, `${owner} unit "${def.symbol}" metadata`);
  }
}

/**
 * Validate an alias map: plain object, non-empty string keys/values, no
 * pollution keys, and every target must be defined in the same pack/system
 * (self-contained; cross-references to other packs are rejected explicitly
 * rather than silently dangling).
 */
function assertValidAliases(
  aliases: Readonly<Record<string, string>> | undefined,
  unitSymbols: ReadonlySet<string>,
  owner: string,
): void {
  if (aliases === undefined) return;
  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) {
    throw new UnitSystemError(`${owner} aliases must be a plain object`);
  }
  const record = aliases as Record<string, unknown>;
  if (hasPollutionKeys(record)) {
    throw new UnitSystemError(`${owner} aliases contain forbidden keys`);
  }
  for (const [alias, target] of Object.entries(record)) {
    if (typeof alias !== "string" || alias.trim().length === 0) {
      throw new UnitSystemError(`${owner} has an invalid alias key`);
    }
    if (typeof target !== "string" || target.trim().length === 0) {
      throw new UnitSystemError(`${owner} alias "${alias}" has an invalid target`);
    }
    if (!unitSymbols.has(target)) {
      throw new UnitSystemError(
        `${owner} alias "${alias}" targets unknown unit "${target}" (aliases must reference units in the same pack)`,
      );
    }
  }
}

/** Group alias map by target symbol for registration. */
function groupAliasesByTarget(
  aliases: Readonly<Record<string, string>> | undefined,
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  if (!aliases) return grouped;
  for (const [alias, target] of Object.entries(aliases)) {
    const list = grouped.get(target) ?? [];
    list.push(alias);
    grouped.set(target, list);
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// UnitSystemRegistry
// ---------------------------------------------------------------------------

export class UnitSystemRegistry {
  private readonly systems = new Map<string, UnitSystem>();
  private readonly packs = new Map<string, UnitPack>();
  /**
   * Generation counter bumped on every register/unregister.
   * Caches keyed by registry content can invalidate when this changes.
   * Monotonic; never reset.
   */
  private _version = 0;

  /** Current generation of this registry (increments on register/unregister). */
  get version(): number {
    return this._version;
  }

  // ---- Systems ----------------------------------------------------------

  registerSystem(system: UnitSystem): UnitSystem {
    assertValidName(system.name, "UnitSystem");
    assertValidVersion(system.version);
    if (!Array.isArray(system.units))
      throw new UnitSystemError(`UnitSystem "${system.name}" units must be an array`);
    if (hasPollutionKeys(system as unknown as Record<string, unknown>)) {
      throw new UnitSystemError(`UnitSystem "${system.name}" contains forbidden keys`);
    }
    if (this.systems.has(system.name)) {
      throw new UnitSystemError(`UnitSystem "${system.name}" is already registered`);
    }
    const symbols = new Set(system.units.map((u) => u?.symbol));
    for (const u of system.units) {
      assertValidUnitDef(u, `UnitSystem "${system.name}"`);
    }
    if (symbols.size !== system.units.length) {
      throw new UnitSystemError(`UnitSystem "${system.name}" contains duplicate unit symbols`);
    }
    assertValidAliases(system.aliases, symbols, `UnitSystem "${system.name}"`);
    if (system.metadata !== undefined) {
      assertDeclarativeMetadata(system.metadata, `UnitSystem "${system.name}" metadata`);
    }
    const frozen: UnitSystem = Object.freeze({
      ...system,
      units: Object.freeze([...system.units]),
      aliases: system.aliases ? Object.freeze({ ...system.aliases }) : undefined,
      preferredUnits: system.preferredUnits
        ? Object.freeze({ ...system.preferredUnits })
        : undefined,
      prefixes: system.prefixes ? Object.freeze([...system.prefixes]) : undefined,
      metadata: system.metadata ? Object.freeze({ ...system.metadata }) : undefined,
    });
    this.systems.set(frozen.name, frozen);
    this._version++;
    return frozen;
  }

  /**
   * Remove a system by name. Returns the removed system, or undefined if
   * absent. Only affects this registry instance — built-in systems on other
   * instances are untouched.
   */
  unregisterSystem(name: string): UnitSystem | undefined {
    const removed = this.systems.get(name);
    if (removed === undefined) return undefined;
    this.systems.delete(name);
    this._version++;
    return removed;
  }

  getSystem(name: string): UnitSystem | undefined {
    return this.systems.get(name);
  }

  hasSystem(name: string): boolean {
    return this.systems.has(name);
  }

  listSystems(): readonly UnitSystem[] {
    return [...this.systems.values()];
  }

  /**
   * Preferred display unit for a semantic category (e.g. "mass" → "kg").
   * Presentation metadata only — never used for arithmetic. Throws for
   * unknown systems; returns undefined when the system defines no
   * preference for the category.
   */
  getPreferredUnit(systemName: string, category: string): string | undefined {
    const system = this.getSystem(systemName);
    if (!system) throw new UnitSystemError(`Unknown UnitSystem "${systemName}"`);
    return system.preferredUnits?.[category];
  }

  // ---- Packs ------------------------------------------------------------

  registerPack(pack: UnitPack): UnitPack {
    assertValidName(pack.name, "UnitPack");
    assertValidVersion(pack.version);
    if (!Array.isArray(pack.units))
      throw new UnitSystemError(`UnitPack "${pack.name}" units must be an array`);
    if (hasPollutionKeys(pack as unknown as Record<string, unknown>)) {
      throw new UnitSystemError(`UnitPack "${pack.name}" contains forbidden keys`);
    }
    if (this.packs.has(pack.name)) {
      throw new UnitSystemError(`UnitPack "${pack.name}" is already registered`);
    }
    const symbols = new Set(pack.units.map((u) => u?.symbol));
    for (const u of pack.units) {
      assertValidUnitDef(u, `UnitPack "${pack.name}"`);
    }
    if (symbols.size !== pack.units.length) {
      throw new UnitSystemError(`UnitPack "${pack.name}" contains duplicate unit symbols`);
    }
    assertValidAliases(pack.aliases, symbols, `UnitPack "${pack.name}"`);
    if (pack.metadata !== undefined) {
      assertDeclarativeMetadata(pack.metadata, `UnitPack "${pack.name}" metadata`);
    }
    const frozen: UnitPack = Object.freeze({
      ...pack,
      units: Object.freeze([...pack.units]),
      aliases: pack.aliases ? Object.freeze({ ...pack.aliases }) : undefined,
      prefixes: pack.prefixes ? Object.freeze([...pack.prefixes]) : undefined,
      metadata: pack.metadata ? Object.freeze({ ...pack.metadata }) : undefined,
    });
    this.packs.set(frozen.name, frozen);
    this._version++;
    return frozen;
  }

  /**
   * Remove a pack by name. Returns the removed pack, or undefined if absent.
   */
  unregisterPack(name: string): UnitPack | undefined {
    const removed = this.packs.get(name);
    if (removed === undefined) return undefined;
    this.packs.delete(name);
    this._version++;
    return removed;
  }

  getPack(name: string): UnitPack | undefined {
    return this.packs.get(name);
  }

  hasPack(name: string): boolean {
    return this.packs.has(name);
  }

  listPacks(): readonly UnitPack[] {
    return [...this.packs.values()];
  }

  // ---- Application ------------------------------------------------------

  /**
   * Apply a system's units (plus its aliases) to a registry. Does not mutate
   * global state; caller provides an explicit registry. Useful for
   * `new UnitRegistry([])` + system. Symbol/alias collisions throw
   * (fail fast — see conflict policy in docs).
   */
  applySystemToRegistry(systemName: string, registry: UnitRegistry): void {
    const system = this.getSystem(systemName);
    if (!system) throw new UnitSystemError(`Unknown UnitSystem "${systemName}"`);
    applyDefs(registry, system.units, system.aliases);
  }

  /**
   * Apply a pack's units (plus its aliases) to a registry.
   */
  applyPackToRegistry(packName: string, registry: UnitRegistry): void {
    const pack = this.getPack(packName);
    if (!pack) throw new UnitSystemError(`Unknown UnitPack "${packName}"`);
    applyDefs(registry, pack.units, pack.aliases);
  }

  /**
   * Resolve a unit symbol with explicit system context without mutating global registries.
   * Creates a temporary registry seeded with that system's units plus defaults, then resolves.
   * Prefer this over global mutable current system.
   */
  resolveWithSystem(
    symbol: string,
    systemName: string,
    fallbackRegistry: UnitRegistry = new UnitRegistry(ATOMIC_UNITS),
  ): import("./unit.js").Unit {
    const system = this.getSystem(systemName);
    if (!system) throw new UnitSystemError(`Unknown UnitSystem "${systemName}"`);
    const temp = new UnitRegistry([]);
    // Seed with system's units first, then fallback's units where not colliding (system wins)
    applyDefsLenient(temp, system.units, system.aliases);
    for (const u of fallbackRegistry.list()) {
      if (!temp.has(u.symbol)) {
        try {
          temp.register(u);
        } catch {
          // ignore collisions — system wins
        }
      }
    }
    return temp.resolve(symbol);
  }
}

/**
 * Register definitions with their grouped aliases. Throws on the first
 * symbol/alias collision (fail fast — never silently overwrite).
 */
function applyDefs(
  registry: UnitRegistry,
  units: readonly AtomicUnitDef[],
  aliases: Readonly<Record<string, string>> | undefined,
): void {
  const grouped = groupAliasesByTarget(aliases);
  for (const def of units) {
    // registerAtomic throws on collision with existing symbols/aliases
    registry.registerAtomic(def, { aliases: grouped.get(def.symbol) });
  }
}

/** Lenient variant used by resolveWithSystem: skip intra-system duplicates. */
function applyDefsLenient(
  registry: UnitRegistry,
  units: readonly AtomicUnitDef[],
  aliases: Readonly<Record<string, string>> | undefined,
): void {
  const grouped = groupAliasesByTarget(aliases);
  for (const def of units) {
    try {
      registry.registerAtomic(def, { aliases: grouped.get(def.symbol) });
    } catch {
      // collision with system internal duplicates — skip (already validated)
    }
  }
}

export const defaultUnitSystemRegistry = new UnitSystemRegistry();

// ---------------------------------------------------------------------------
// Standard SI system (foundational, not exhaustive)
// ---------------------------------------------------------------------------

/**
 * Foundational SI system: core ATOMIC_UNITS plus the SI pack (base extras,
 * derived units with special names, BIPM-accepted units).
 *
 * Additive-only change vs the original foundational set: every previously
 * resolvable symbol resolves identically. Version stays "1.0.0" because no
 * existing factor, symbol meaning, dimension or identity changed.
 *
 * SI base units: m (L), kg (M), s (T), K (Temp), A (I), mol (Substance),
 * cd (J). Generic engine dimensions E/C/N remain as before (see Phase 14).
 */
export const SI_SYSTEM: UnitSystem = Object.freeze({
  name: "si",
  version: "1.0.0",
  displayName: "SI (International System of Units)",
  description:
    "SI base units (m, kg, s, A, K, mol, cd), derived units with special " +
    "names (lm, lx, N, Pa, J, Wh) and BIPM-accepted units (tonne, litre, " +
    "nautical mile). Energy units use the engine E dimension (see SI pack notes).",
  units: Object.freeze([...ATOMIC_UNITS, ...SI_PACK.units]),
  aliases: SI_PACK.aliases,
  preferredUnits: Object.freeze({
    mass: "kg",
    length: "m",
    time: "s",
    temperature: "K",
    energy: "Mcal",
    currency: "cur",
    count: "IU",
  }),
  metadata: Object.freeze({ standard: "SI", scope: "foundational" }),
});

/** Imperial system entry (units from the Imperial pack). */
export const IMPERIAL_SYSTEM: UnitSystem = Object.freeze({
  name: "imperial",
  version: "1.0.0",
  displayName: "Imperial units",
  description:
    "Imperial length/mass/volume/area/speed/force/pressure units. " +
    "Long ton and imperial gallon differ from US definitions — see collision policy.",
  units: IMPERIAL_PACK.units,
  aliases: IMPERIAL_PACK.aliases,
  preferredUnits: Object.freeze({ mass: "lb", length: "ft" }),
  metadata: Object.freeze({ standard: "Imperial", scope: "customary" }),
});

/** US customary system entry (units from the US customary pack). */
export const US_CUSTOMARY_SYSTEM: UnitSystem = Object.freeze({
  name: "us-customary",
  version: "1.0.0",
  displayName: "US customary units",
  description:
    "US customary mass/volume units plus shared 1959 definitions. " +
    "Short ton and US gallon differ from Imperial definitions.",
  units: US_CUSTOMARY_PACK.units,
  aliases: US_CUSTOMARY_PACK.aliases,
  preferredUnits: Object.freeze({ mass: "lb", length: "ft", volume: "gal" }),
  metadata: Object.freeze({ standard: "US customary", scope: "customary" }),
});

/** CGS system entry (units from the CGS pack). */
export const CGS_SYSTEM: UnitSystem = Object.freeze({
  name: "cgs",
  version: "1.0.0",
  displayName: "CGS units",
  description: "Centimetre–gram–second derived units (dyne, erg); base cm/g/s resolve via core.",
  units: CGS_PACK.units,
  aliases: CGS_PACK.aliases,
  preferredUnits: Object.freeze({ mass: "g", length: "cm", time: "s" }),
  metadata: Object.freeze({ standard: "CGS", scope: "cgs" }),
});

/**
 * SI derived-units pack entry: N, Pa, J, Wh with correct universal
 * dimensions (no faking). Usable standalone via
 * `createRegistry({ packs: [SI_DERIVED_PACK] })`.
 */
export const SI_DERIVED_PACK: UnitPack = Object.freeze({
  name: "si-derived",
  version: "1.0.0",
  displayName: "SI derived units",
  description:
    "SI derived units with special names (newton, pascal, joule, watt-hour) " +
    "with correct dimensions (M·L·T⁻², M·L⁻¹·T⁻², E).",
  units: SI_DERIVED_UNITS,
  aliases: Object.freeze({
    newton: "N",
    pascal: "Pa",
    joule: "J",
  } as Record<string, string>),
  metadata: Object.freeze({ standard: "SI", scope: "derived" }),
});

// Auto-register built-in systems/packs as *definitions* (metadata only).
// This never registers units into any UnitRegistry, so default parse
// behavior is unchanged. Idempotent for hot reload.
for (const entry of [SI_SYSTEM, IMPERIAL_SYSTEM, US_CUSTOMARY_SYSTEM, CGS_SYSTEM] as const) {
  try {
    defaultUnitSystemRegistry.registerSystem(entry);
  } catch {
    // already registered in case of hot reload
  }
}
for (const entry of [
  SI_PACK,
  SI_DERIVED_PACK,
  IMPERIAL_PACK,
  US_CUSTOMARY_PACK,
  CGS_PACK,
  SCIENTIFIC_PACK,
] as const) {
  try {
    defaultUnitSystemRegistry.registerPack(entry);
  } catch {
    // already registered in case of hot reload
  }
}

// ---------------------------------------------------------------------------
// Explicit registry factory (isolated, no global mutation)
// ---------------------------------------------------------------------------

export interface CreateRegistryOptions {
  /**
   * Base seed definitions. Defaults to the core ATOMIC_UNITS so packs
   * layer onto the standard set (e.g. mile→m conversions work). Pass an
   * explicit empty array for a truly minimal registry.
   */
  readonly seed?: readonly AtomicUnitDef[];
  /**
   * Unit packs to apply, in order. Later packs win only if they do not
   * collide — any symbol/alias collision throws (fail fast).
   */
  readonly packs?: readonly UnitPack[];
  /** Additional standalone unit definitions. */
  readonly units?: readonly AtomicUnitDef[];
  /** Custom prefix registry (defaults to the standard 24 SI prefixes). */
  readonly prefixRegistry?: PrefixRegistry;
}

/**
 * Create an isolated UnitRegistry with explicit packs.
 *
 *   import { SI_PACK, IMPERIAL_PACK, createRegistry } from "@vetwo/units";
 *   const registry = createRegistry({ packs: [SI_PACK] });
 *   Quantity.of(10, "N", registry);
 *
 * Deterministic, testable and concurrency-friendly: no global state is
 * touched. Tree-shakeable: importing one pack does not pull other packs
 * into the bundle (each pack module is side-effect free).
 */
export function createRegistry(options: CreateRegistryOptions = {}): UnitRegistry {
  const registry = new UnitRegistry(options.seed ?? ATOMIC_UNITS, options.prefixRegistry);
  for (const pack of options.packs ?? []) {
    if (!pack || typeof pack !== "object" || Array.isArray(pack)) {
      throw new UnitSystemError("createRegistry packs must be UnitPack objects");
    }
    if (hasPollutionKeys(pack as unknown as Record<string, unknown>)) {
      throw new UnitSystemError("createRegistry pack contains forbidden keys");
    }
    // Re-validate on the way in (cheap, fail fast at the boundary)
    const symbols = new Set((pack.units ?? []).map((u) => u?.symbol));
    for (const u of pack.units ?? []) {
      assertValidUnitDef(u, `pack "${pack.name}"`);
    }
    if (symbols.size !== (pack.units ?? []).length) {
      throw new UnitSystemError(`pack "${pack.name}" contains duplicate unit symbols`);
    }
    assertValidAliases(pack.aliases, symbols, `pack "${pack.name}"`);
    applyDefs(registry, pack.units ?? [], pack.aliases);
  }
  for (const def of options.units ?? []) {
    registry.registerAtomic(def);
  }
  return registry;
}
