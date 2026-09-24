/**
 * prefix.ts
 * -----------------------------------------------------------------------
 * Single responsibility: the Prefix value object and its registry.
 *
 * A Prefix is a scale factor that modifies a prefixable Unit. For example
 * `k` (kilo, 10³) + `m` (meter) = `km` (kilometer). Prefixes never
 * change dimension, only the conversion scale.
 *
 * All 24 standard SI decimal prefixes (2022 revision) are seeded.
 * Resolution is lazy: `km`, `nm`, `µg` etc. are derived on demand rather
 * than pre-registered as distinct atomic units, but are cached after first
 * parse. Exactly one prefix per unit is allowed by default.
 *
 * Precedence: exact registry hits (atomic units like `kg`, `mm`) always
 * win over prefix-derived units. Prefix resolution is attempted only when
 * no exact unit symbol (or alias) exists in the UnitRegistry.
 * -----------------------------------------------------------------------
 */
import { UnitEngineError } from "./errors/index.js";

// ---------------------------------------------------------------------------
// Prefix interface
// ---------------------------------------------------------------------------

export interface Prefix {
  /** Canonical symbol, e.g. "k", "µ", "m", "da". */
  readonly symbol: string;
  /** Human-readable name, e.g. "kilo", "micro", "deca". */
  readonly name: string;
  /** Scale factor, e.g. 1e3 for kilo, 1e-6 for micro. */
  readonly factor: number;
  /** Alternative symbols, e.g. "u" for "µ". */
  readonly aliases: readonly string[];
  /** Optional free-form docs. */
  readonly docs?: string;
}

// ---------------------------------------------------------------------------
// Standard SI prefixes (24 prefixes, 2022 revision including ronna/quetta)
// ---------------------------------------------------------------------------

/** Internal helper to build frozen prefixes. */
function p(symbol: string, name: string, factor: number, aliases: readonly string[] = []): Prefix {
  return Object.freeze({ symbol, name, factor, aliases: Object.freeze([...aliases]) });
}

/** The 24 standard decimal SI prefixes. */
export const STANDARD_PREFIXES: readonly Prefix[] = Object.freeze([
  // >= 1
  p("Q", "quetta", 1e30),
  p("R", "ronna", 1e27),
  p("Y", "yotta", 1e24),
  p("Z", "zetta", 1e21),
  p("E", "exa", 1e18),
  p("P", "peta", 1e15),
  p("T", "tera", 1e12),
  p("G", "giga", 1e9),
  p("M", "mega", 1e6),
  p("k", "kilo", 1e3),
  p("h", "hecto", 1e2),
  p("da", "deca", 1e1),
  // < 1
  p("d", "deci", 1e-1),
  p("c", "centi", 1e-2),
  p("m", "milli", 1e-3),
  p("µ", "micro", 1e-6, ["u", "\u03BC"]), // µ (U+00B5) with aliases u and μ (U+03BC)
  p("n", "nano", 1e-9),
  p("p", "pico", 1e-12),
  p("f", "femto", 1e-15),
  p("a", "atto", 1e-18),
  p("z", "zepto", 1e-21),
  p("y", "yocto", 1e-24),
  p("r", "ronto", 1e-27),
  p("q", "quecto", 1e-30),
]);

/** Thrown when a prefix registration collides or is invalid. */
export class PrefixRegistrationError extends UnitEngineError {
  constructor(message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// PrefixRegistry
// ---------------------------------------------------------------------------

export class PrefixRegistry {
  private readonly prefixes = new Map<string, Prefix>();
  private readonly aliasIndex = new Map<string, string>();
  /** Sorted by symbol length descending for longest-match resolution. */
  private sortedPrefixes: readonly Prefix[] = [];

  constructor(seed: readonly Prefix[] = STANDARD_PREFIXES) {
    for (const prefix of seed) this.register(prefix);
  }

  /** Register a prefix. Throws on duplicate symbol/alias or invalid factor. */
  register(prefix: Prefix): Prefix {
    if (!prefix.symbol || typeof prefix.symbol !== "string" || prefix.symbol.trim().length === 0) {
      throw new PrefixRegistrationError("Prefix symbol must be a non-empty string");
    }
    if (!prefix.name || typeof prefix.name !== "string" || prefix.name.trim().length === 0) {
      throw new PrefixRegistrationError(`Prefix "${prefix.symbol}" name must be non-empty`);
    }
    if (!Number.isFinite(prefix.factor) || prefix.factor === 0) {
      throw new PrefixRegistrationError(
        `Prefix "${prefix.symbol}" factor must be a finite non-zero number, got ${prefix.factor}`,
      );
    }
    if (this.prefixes.has(prefix.symbol)) {
      throw new PrefixRegistrationError(
        `Prefix symbol "${prefix.symbol}" is already registered. Use a different symbol or unregister first.`,
      );
    }
    // Alias collision checks
    for (const alias of prefix.aliases) {
      const existing = this.aliasIndex.get(alias);
      if (existing !== undefined) {
        throw new PrefixRegistrationError(
          `Prefix alias "${alias}" is already registered for prefix "${existing}". Cannot use for "${prefix.symbol}".`,
        );
      }
      if (this.prefixes.has(alias)) {
        throw new PrefixRegistrationError(
          `Prefix alias "${alias}" is already a canonical prefix symbol. Cannot register as alias for "${prefix.symbol}".`,
        );
      }
    }

    // Freeze and store
    const frozen = Object.freeze({
      ...prefix,
      aliases: Object.freeze([...prefix.aliases]),
    });
    this.prefixes.set(frozen.symbol, frozen);
    for (const alias of frozen.aliases) this.aliasIndex.set(alias, frozen.symbol);
    this.rebuildSorted();
    return frozen;
  }

  /** Whether a prefix symbol or alias is registered. */
  has(symbol: string): boolean {
    return this.prefixes.has(symbol) || this.aliasIndex.has(symbol);
  }

  /** Get a prefix by canonical symbol or alias. Throws if not found. */
  get(symbol: string): Prefix {
    const direct = this.prefixes.get(symbol);
    if (direct) return direct;
    const canonical = this.aliasIndex.get(symbol);
    if (canonical) {
      const resolved = this.prefixes.get(canonical);
      if (resolved) return resolved;
    }
    throw new PrefixRegistrationError(`Unknown prefix "${symbol}"`);
  }

  /** Alias for `get()` that throws on unknown symbol. Kept for symmetry with UnitRegistry. */
  resolve(symbol: string): Prefix {
    return this.get(symbol);
  }

  /** All registered prefixes. */
  list(): readonly Prefix[] {
    return [...this.prefixes.values()];
  }

  /** Prefixes sorted longest-symbol-first (for deterministic longest-match). */
  listSortedByLength(): readonly Prefix[] {
    return this.sortedPrefixes;
  }

  get size(): number {
    return this.prefixes.size;
  }

  private rebuildSorted(): void {
    this.sortedPrefixes = Object.freeze(
      [...this.prefixes.values()].sort((a, b) => b.symbol.length - a.symbol.length),
    );
  }
}

/** Default process-wide prefix registry seeded with all 24 SI prefixes. */
export const defaultPrefixRegistry = new PrefixRegistry();
