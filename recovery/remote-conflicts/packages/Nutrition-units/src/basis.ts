/**
 * basis.ts — Explicit nutrition basis/context model.
 *
 * A basis answers "under what composition context is this expressed?".
 * It is SEMANTIC metadata — never a physical dimension, never encoded
 * into the core Dimension vector. The engine's Unit.basis is the low-level
 * transport; this module is the nutrition-level vocabulary and validation.
 */

import { InvalidNutritionBasisError, NutritionError } from "./errors.js";

export interface BasisDefinition {
  /** Stable id, e.g. "asFed", "dryMatter". */
  readonly id: string;
  /** Canonical display name. */
  readonly name: string;
  /** Aliases that resolve to this basis (case-insensitive). */
  readonly aliases?: readonly string[];
  /** Description. */
  readonly description?: string;
  /** Unit-level basis tag this maps to (core Unit.basis), if any. */
  readonly unitBasis?: string;
  /** Declarative metadata only. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type BasisId = string;

const BASIS_ID_PATTERN = /^[a-z][a-zA-Z0-9_-]*$/;
const ALIAS_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]*$/;

function assertDeclarative(value: unknown, owner: string, depth = 0): void {
  if (depth > 4) throw new NutritionError(`${owner} metadata is nested too deeply`);
  if (value === null || value === undefined) return;
  const t = typeof value;
  if (t === "function" || t === "symbol")
    throw new NutritionError(`${owner} metadata must not contain executable values`);
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
    throw new NutritionError(`${owner} metadata contains forbidden keys`);
  }
  for (const v of Object.values(record)) assertDeclarative(v, owner, depth + 1);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class BasisRegistry {
  private readonly bases = new Map<string, BasisDefinition>();
  private readonly aliasToId = new Map<string, string>();

  constructor(seed: readonly BasisDefinition[] = defaultSeedBases()) {
    for (const basis of seed) this.register(basis);
  }

  register(def: BasisDefinition): void {
    if (!def || typeof def !== "object" || Array.isArray(def)) {
      throw new InvalidNutritionBasisError(
        String((def as unknown as { id?: unknown })?.id ?? "unknown"),
        "basis must be a plain object",
      );
    }
    const record = def as unknown as Record<string, unknown>;
    if (
      Object.prototype.hasOwnProperty.call(record, "__proto__") ||
      Object.prototype.hasOwnProperty.call(record, "constructor") ||
      Object.prototype.hasOwnProperty.call(record, "prototype")
    ) {
      throw new InvalidNutritionBasisError(String(def.id ?? "unknown"), "forbidden keys");
    }
    if (typeof def.id !== "string" || !BASIS_ID_PATTERN.test(def.id)) {
      throw new InvalidNutritionBasisError(String(def.id), `id must match ${BASIS_ID_PATTERN}`);
    }
    const lowerId = def.id.toLowerCase();
    if (this.bases.has(lowerId)) {
      throw new InvalidNutritionBasisError(def.id, "already registered");
    }
    if (typeof def.name !== "string" || def.name.trim().length === 0) {
      throw new InvalidNutritionBasisError(def.id, "needs a non-empty name");
    }
    if (def.aliases !== undefined) {
      if (!Array.isArray(def.aliases))
        throw new InvalidNutritionBasisError(def.id, "aliases must be an array");
      for (const alias of def.aliases) {
        if (typeof alias !== "string" || !ALIAS_PATTERN.test(alias)) {
          throw new InvalidNutritionBasisError(def.id, `alias "${String(alias)}" invalid`);
        }
        const lowerAlias = alias.toLowerCase();
        if (this.aliasToId.has(lowerAlias) || this.bases.has(lowerAlias)) {
          throw new InvalidNutritionBasisError(def.id, `alias "${alias}" collides`);
        }
      }
    }
    if (def.unitBasis !== undefined && typeof def.unitBasis !== "string") {
      throw new InvalidNutritionBasisError(def.id, "unitBasis must be a string if provided");
    }
    assertDeclarative(def.metadata, `Basis "${def.id}"`);

    const frozen: BasisDefinition = Object.freeze({
      ...def,
      id: lowerId,
      aliases: def.aliases ? Object.freeze([...def.aliases]) : undefined,
      metadata: def.metadata ? Object.freeze({ ...def.metadata }) : undefined,
    });
    this.bases.set(lowerId, frozen);
    this.aliasToId.set(lowerId, lowerId);
    if (frozen.aliases) {
      for (const alias of frozen.aliases) this.aliasToId.set(alias.toLowerCase(), lowerId);
    }
    // also map unitBasis tag if provided
    if (frozen.unitBasis) {
      const lowerUnitBasis = frozen.unitBasis.toLowerCase();
      if (!this.aliasToId.has(lowerUnitBasis)) this.aliasToId.set(lowerUnitBasis, lowerId);
    }
  }

  has(id: string): boolean {
    if (typeof id !== "string") return false;
    return this.aliasToId.has(id.toLowerCase());
  }

  require(id: string): BasisDefinition {
    if (typeof id !== "string" || id.trim().length === 0)
      throw new InvalidNutritionBasisError(String(id), "id must be non-empty");
    const canonical = this.aliasToId.get(id.toLowerCase());
    if (!canonical) throw new InvalidNutritionBasisError(id, "unknown basis");
    const def = this.bases.get(canonical);
    if (!def) throw new InvalidNutritionBasisError(id, "unknown basis");
    return def;
  }

  resolve(id: string): string | undefined {
    if (typeof id !== "string") return undefined;
    return this.aliasToId.get(id.toLowerCase());
  }

  list(): readonly BasisDefinition[] {
    return [...this.bases.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  snapshot(): BasisRegistry {
    const snap = new BasisRegistry([]);
    for (const [id, def] of this.bases) snap.bases.set(id, def);
    for (const [alias, canonical] of this.aliasToId) snap.aliasToId.set(alias, canonical);
    return snap;
  }

  get size(): number {
    return this.bases.size;
  }
}

function defaultSeedBases(): readonly BasisDefinition[] {
  return [
    {
      id: "asFed",
      name: "As-fed",
      aliases: ["as-fed", "as_fed", "af", "fresh"],
      description: "Composition relative to total weight including moisture",
      unitBasis: undefined, // as-fed = no tag (bare unit)
    },
    {
      id: "dryMatter",
      name: "Dry Matter",
      aliases: ["DM", "dry-matter", "dry_matter", "dm", "dry"],
      description: "Composition relative to dry weight (moisture removed)",
      unitBasis: "DM",
    },
    {
      id: "freshMatter",
      name: "Fresh Matter",
      aliases: ["FM", "fresh-matter"],
      description: "Fresh weight basis",
      unitBasis: "FM",
    },
    {
      id: "wet",
      name: "Wet Basis",
      aliases: ["WB", "wet-basis"],
      description: "Wet basis (alternative to as-fed)",
      unitBasis: "WB",
    },
    {
      id: "normalized",
      name: "Normalized",
      aliases: ["norm", "normalized-basis"],
      description: "Normalized basis (e.g., 88% DM reference)",
      unitBasis: undefined,
    },
  ];
}

export const defaultBasisRegistry = new BasisRegistry();

export function isBasisId(value: unknown): value is string {
  return typeof value === "string" && BASIS_ID_PATTERN.test(value);
}
