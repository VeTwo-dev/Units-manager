/**
 * unit-registry.ts
 * -----------------------------------------------------------------------
 * Single responsibility: hold the set of known units and act as the
 * single lookup point for the parser and conversion engine.
 *
 * Open/Closed: new domains (chemistry, physics, finance) register their
 * own units via `registry.register(...)` without ever touching this
 * class's source.
 *
 * Features:
 * - Register atomic units (from AtomicUnitDef) or full Unit objects
 * - Resolve aliases deterministically
 * - Prevent duplicate symbols and conflicting aliases
 * - Track canonical units per dimension
 * - Deterministic lookup order-independent of registration order
 * -----------------------------------------------------------------------
 */
import type { AtomicUnitDef } from "./units/atomic-units.js";
import { ATOMIC_UNITS } from "./units/atomic-units.js";
import { UnsupportedUnitError, UnitEngineError } from "./errors/index.js";
import { makeUnit, type Unit } from "./unit.js";
import { dimensionKey, type DimensionVector } from "./dimension.js";
import { defaultPrefixRegistry, type PrefixRegistry } from "./prefix.js";

/** Thrown when a unit symbol or alias collides with an existing registration. */
export class UnitRegistrationError extends UnitEngineError {
  constructor(message: string) {
    super(message);
  }
}

export class UnitRegistry {
  /** Primary symbol → Unit map. */
  private readonly units = new Map<string, Unit>();
  /** Alias → canonical symbol map (deterministic, no overwrites). */
  private readonly aliasIndex = new Map<string, string>();
  /** dimension-key → canonical Unit for that dimension. */
  private readonly canonicalUnits = new Map<string, Unit>();
  /** Cache for lazily generated prefixed units (symbol → Unit). */
  private readonly prefixedCache = new Map<string, Unit>();
  /**
   * Generation counter bumped on every register/unregister.
   * Caches keyed by registry content can invalidate when this changes.
   * Monotonic; never reset.
   */
  private _version = 0;

  constructor(
    seed: readonly AtomicUnitDef[] = ATOMIC_UNITS,
    private readonly prefixRegistry: PrefixRegistry = defaultPrefixRegistry,
  ) {
    for (const def of seed) this.registerAtomic(def);
  }

  /** Current generation of this registry (increments on register/unregister). */
  get version(): number {
    return this._version;
  }

  // ---- Registration -------------------------------------------------------

  /**
   * Register an atomic unit definition. Converts it to a full Unit and
   * stores it. Throws on collision with an existing symbol or alias.
   */
  registerAtomic(def: AtomicUnitDef, options?: { aliases?: string[] }): Unit {
    if (
      def !== null &&
      typeof def === "object" &&
      (Object.prototype.hasOwnProperty.call(def, "__proto__") ||
        Object.prototype.hasOwnProperty.call(def, "constructor") ||
        Object.prototype.hasOwnProperty.call(def, "prototype"))
    ) {
      throw new UnitRegistrationError("Unit definition contains forbidden prototype keys.");
    }
    const metadata = (def as unknown as { metadata?: unknown }).metadata;
    if (
      metadata !== null &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      (Object.prototype.hasOwnProperty.call(metadata, "__proto__") ||
        Object.prototype.hasOwnProperty.call(metadata, "constructor") ||
        Object.prototype.hasOwnProperty.call(metadata, "prototype"))
    ) {
      throw new UnitRegistrationError(
        "Unit definition metadata contains forbidden prototype keys.",
      );
    }
    const aliases = options?.aliases ?? (def as unknown as { aliases?: string[] }).aliases;
    const unit = makeUnit({
      symbol: def.symbol,
      name: def.label,
      dimension: def.dimension,
      conversion: def.conversion,
      toBaseFactor: def.toBaseFactor,
      label: def.label,
      aliases,
      metadata: def.metadata,
    });
    return this.register(unit);
  }

  /**
   * Register a fully resolved Unit. Throws on collision with an existing
   * symbol or alias. Returns the registered unit.
   */
  register(unit: Unit): Unit {
    const symbol = unit.symbol;
    const existing = this.units.get(symbol);
    if (existing !== undefined) {
      throw new UnitRegistrationError(
        `Unit "${symbol}" is already registered. Use a different symbol or unregister first.`,
      );
    }

    // Check alias collisions
    for (const alias of unit.aliases) {
      const existingAlias = this.aliasIndex.get(alias);
      if (existingAlias !== undefined && existingAlias !== symbol) {
        throw new UnitRegistrationError(
          `Alias "${alias}" is already registered for unit "${existingAlias}". ` +
            `Cannot register it for "${symbol}".`,
        );
      }
      const existingUnit = this.units.get(alias);
      if (existingUnit !== undefined) {
        throw new UnitRegistrationError(
          `Symbol "${alias}" is already registered as a unit. ` +
            `Cannot use it as an alias for "${symbol}".`,
        );
      }
    }

    // Register primary symbol
    this.units.set(symbol, unit);

    // Register aliases
    for (const alias of unit.aliases) {
      this.aliasIndex.set(alias, symbol);
    }

    // Track canonical unit per dimension (first registered wins)
    const dimKey = dimensionKey(unit.dimension);
    if (!this.canonicalUnits.has(dimKey)) {
      this.canonicalUnits.set(dimKey, unit);
    }

    // Invalidate derived-unit cache (a new symbol may shadow a prefix derivation)
    this.prefixedCache.clear();
    this._version++;
    return unit;
  }

  /**
   * Unregister a unit by symbol. Removes it and its aliases from all
   * indices. Returns the removed unit, or undefined if not found.
   */
  unregister(symbol: string): Unit | undefined {
    const unit = this.units.get(symbol);
    if (unit === undefined) return undefined;

    this.units.delete(symbol);
    for (const alias of unit.aliases) {
      this.aliasIndex.delete(alias);
    }
    // Invalidate derived-unit cache (removed symbol may have been a prefix base)
    this.prefixedCache.clear();
    this._version++;

    // Rebuild canonical if we removed the canonical unit for this dimension
    const dimKey = dimensionKey(unit.dimension);
    if (this.canonicalUnits.get(dimKey)?.symbol === symbol) {
      this.canonicalUnits.delete(dimKey);
      // Find next registered unit for this dimension
      for (const u of this.units.values()) {
        if (dimensionKey(u.dimension) === dimKey) {
          this.canonicalUnits.set(dimKey, u);
          break;
        }
      }
    }

    return unit;
  }

  // ---- Lookup --------------------------------------------------------------

  /** Check if a symbol or alias is registered (including prefix-derivable). */
  has(symbol: string): boolean {
    if (this.units.has(symbol) || this.aliasIndex.has(symbol)) return true;
    // Also consider prefix-derivable units as having a definition
    return this.tryResolvePrefixed(symbol) !== undefined;
  }

  /** @deprecated Use has() instead. Kept for backward compatibility. */
  hasAtomic(symbol: string): boolean {
    return this.has(symbol);
  }

  /** Check if a canonical symbol (not alias) is registered. */
  hasSymbol(symbol: string): boolean {
    return this.units.has(symbol);
  }

  /**
   * Resolve a symbol or alias to its Unit. If the input is an alias,
   * resolves to the canonical unit. Falls back to prefix-derived units
   * (e.g. "nm" = "n" + "m") when no exact hit exists. Throws
   * UnsupportedUnitError if not found.
   *
   * Precedence: exact symbol > alias > prefix-derived. At most one
   * prefix is applied; "kmm" (multiple prefixes) is rejected.
   */
  resolve(symbol: string): Unit {
    // 1. Exact symbol hit
    const direct = this.units.get(symbol);
    if (direct !== undefined) return direct;

    // 2. Alias hit
    const canonicalSymbol = this.aliasIndex.get(symbol);
    if (canonicalSymbol !== undefined) {
      const resolved = this.units.get(canonicalSymbol);
      if (resolved !== undefined) return resolved;
    }

    // 3. Cached prefixed derivation
    const cached = this.prefixedCache.get(symbol);
    if (cached !== undefined) return cached;

    // 4. Try prefix-derived unit (lazy generation)
    const prefixed = this.tryResolvePrefixed(symbol);
    if (prefixed !== undefined) {
      this.prefixedCache.set(symbol, prefixed);
      return prefixed;
    }

    throw new UnsupportedUnitError(symbol);
  }

  /**
   * Attempt to resolve a symbol as prefix + baseUnit.
   * Only one prefix is applied; base unit must be explicitly registered
   * and marked as prefixable in its metadata, and must not be affine.
   * Returns undefined if no prefix match is valid.
   */
  private tryResolvePrefixed(symbol: string): Unit | undefined {
    // Sort prefixes longest-first so "da" beats "d"
    for (const prefix of this.prefixRegistry.listSortedByLength()) {
      // Check symbol starts with prefix symbol or its alias
      const possiblePrefixes = [prefix.symbol, ...prefix.aliases];
      for (const pSym of possiblePrefixes) {
        if (pSym.length === 0 || pSym.length >= symbol.length) continue;
        if (!symbol.startsWith(pSym)) continue;
        const remainder = symbol.slice(pSym.length);
        if (remainder.length === 0) continue;

        // Remainder must be an exact registered unit (no recursion for multi-prefix)
        const base =
          this.units.get(remainder) ??
          (() => {
            const aliasTarget = this.aliasIndex.get(remainder);
            return aliasTarget ? this.units.get(aliasTarget) : undefined;
          })();
        if (!base) continue;

        // Base must be prefixable and linear (e.g. kg, °C are not;
        // logarithmic/custom units cannot take prefixes either)
        if (base.metadata?.prefixable !== true) continue;
        if (base.conversion.kind !== "linear") continue;

        // Compute new scale: prefix.factor * base.scale
        const newScale = prefix.factor * base.conversion.scale;
        if (!Number.isFinite(newScale) || newScale === 0) continue;

        // Avoid collision: if exact symbol already exists as unit, it would have been found above
        // But also check that this prefix-derived symbol doesn't collide with an existing unit symbol
        // (it doesn't, because if it did, exact hit at top would have returned it)

        // Semantic kind propagates through prefixes (kHz stays frequency,
        // MPa stays generic): scaling never changes what a unit MEANS.
        const derivedMetadata: Record<string, string> = {
          system: base.metadata?.system ?? "SI",
          docs: `Derived: ${prefix.symbol} + ${base.symbol}`,
        };
        if (base.metadata?.kind !== undefined) derivedMetadata.kind = base.metadata.kind;
        if (base.metadata?.category !== undefined)
          derivedMetadata.category = base.metadata.category;
        return makeUnit({
          symbol,
          name: `${prefix.name}${base.name.toLowerCase()}`,
          dimension: base.dimension,
          conversion: { kind: "linear", scale: newScale },
          label: `${prefix.name}${base.label ?? base.name}`.toLowerCase(),
          metadata: derivedMetadata,
        });
      }
    }
    return undefined;
  }

  /**
   * Get a unit by its canonical symbol (no alias resolution).
   * Throws UnsupportedUnitError if not found.
   */
  get(symbol: string): Unit {
    const unit = this.units.get(symbol);
    if (!unit) throw new UnsupportedUnitError(symbol);
    return unit;
  }

  /** @deprecated Use resolve() instead. Kept for backward compatibility. */
  getAtomic(symbol: string): Unit {
    return this.resolve(symbol);
  }

  /**
   * Get the canonical/base unit for a given dimension.
   * The canonical unit is the first unit registered for that dimension.
   */
  getCanonicalUnit(dimension: DimensionVector): Unit | undefined {
    return this.canonicalUnits.get(dimensionKey(dimension));
  }

  /**
   * Get all registered units as an array.
   */
  list(): readonly Unit[] {
    return [...this.units.values()];
  }

  /** @deprecated Use list() instead. Kept for backward compatibility. */
  listAtomics(): readonly Unit[] {
    return this.list();
  }

  /**
   * Get the number of registered units.
   */
  get size(): number {
    return this.units.size;
  }

  /**
   * Point-in-time copy of this registry: a new, detached UnitRegistry
   * holding the same (immutable, shared by reference) Unit objects.
   * Later register/unregister calls on either registry do not affect the
   * other. Useful for reproducibility, serialization workflows and tests.
   * Treat the snapshot as read-only by convention.
   */
  snapshot(): UnitRegistry {
    const copy = new UnitRegistry([], this.prefixRegistry);
    for (const unit of this.units.values()) {
      copy.register(unit);
    }
    return copy;
  }
}

/**
 * Default process-wide registry. Consumers needing isolation (e.g. tests,
 * multi-tenant configs) can `new UnitRegistry()` their own instance instead.
 */
export const defaultUnitRegistry = new UnitRegistry();
