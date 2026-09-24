/**
 * nutrient-kind.ts — Nutrition semantic identity layer.
 *
 * Each nutrient (cp, ca, vitA…) is a SEMANTIC kind, not a dimension.
 * cp and ca both measure mass, but they are NOT interchangeable — dimension
 * equality must NOT imply nutrient equality. This module owns that
 * distinction. It mirrors the core QuantityKind pattern (data-only,
 * frozen, registry-isolated) but is nutrition-specific.
 */

import { UnitEngineError } from "@vetwo/units";
import { InvalidNutrientKindError } from "./errors.js";

// ---------------------------------------------------------------------------
// Kind definition
// ---------------------------------------------------------------------------

export interface NutrientKind {
  /** Stable canonical id — e.g. "cp", "vitamin-a". */
  readonly id: string;
  /** Human-readable name, e.g. "Crude Protein". */
  readonly name: string;
  /** Optional short symbol/code for display. */
  readonly symbol?: string;
  /** Aliases that resolve to this kind (case-insensitive). */
  readonly aliases?: readonly string[];
  /** High-level category: "macro-nutrient", "mineral", … */
  readonly category?: string;
  /** Semantic family grouping (proximate, mineral, vitamin, energy, fiber …). */
  readonly family?: string;
  /** Description for docs. */
  readonly description?: string;
  /**
   * Canonical reporting unit for CONTRIBUTIONS of this nutrient
   * (e.g. "g/day" for cp). Kept here so TargetUnitRegistry can be
   * derived from the kind registry without duplication.
   */
  readonly defaultUnit?: string;
  /** Optional chemical/form metadata (e.g. retinol vs beta-carotene). */
  readonly chemicalMetadata?: Readonly<Record<string, unknown>>;
  /** Optional deprecation notice. */
  readonly deprecated?: string;
  /** Declarative metadata only (no functions). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const KIND_ID_PATTERN = /^[a-z][a-zA-Z0-9_-]*$/;
const ALIAS_PATTERN = /^[a-zA-Z][a-zA-Z0-9._\-:]*$/;

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

export class NutrientKindRegistry {
  private readonly kinds = new Map<string, NutrientKind>();
  private readonly aliasToId = new Map<string, string>();

  constructor(seed: readonly NutrientKind[] = defaultSeedKinds()) {
    for (const kind of seed) this.register(kind);
  }

  register(kind: NutrientKind): void {
    if (!kind || typeof kind !== "object" || Array.isArray(kind)) {
      throw new InvalidNutrientKindError(
        String((kind as unknown as { id?: unknown })?.id ?? "unknown"),
        "kind must be a plain object",
      );
    }
    const record = kind as unknown as Record<string, unknown>;
    if (
      Object.prototype.hasOwnProperty.call(record, "__proto__") ||
      Object.prototype.hasOwnProperty.call(record, "constructor") ||
      Object.prototype.hasOwnProperty.call(record, "prototype")
    ) {
      throw new InvalidNutrientKindError(String(kind.id ?? "unknown"), "forbidden keys");
    }
    if (typeof kind.id !== "string" || !KIND_ID_PATTERN.test(kind.id)) {
      throw new InvalidNutrientKindError(String(kind.id), `id must match ${KIND_ID_PATTERN}`);
    }
    const lowerId = kind.id.toLowerCase();
    if (this.kinds.has(lowerId)) {
      throw new InvalidNutrientKindError(kind.id, "already registered");
    }
    if (typeof kind.name !== "string" || kind.name.trim().length === 0) {
      throw new InvalidNutrientKindError(kind.id, "needs a non-empty name");
    }
    if (
      kind.symbol !== undefined &&
      (typeof kind.symbol !== "string" || kind.symbol.trim().length === 0)
    ) {
      throw new InvalidNutrientKindError(kind.id, "symbol must be a non-empty string if provided");
    }
    if (kind.aliases !== undefined) {
      if (!Array.isArray(kind.aliases)) {
        throw new InvalidNutrientKindError(kind.id, "aliases must be an array of strings");
      }
      for (const alias of kind.aliases) {
        if (typeof alias !== "string" || !ALIAS_PATTERN.test(alias)) {
          throw new InvalidNutrientKindError(
            kind.id,
            `alias "${String(alias)}" must match ${ALIAS_PATTERN}`,
          );
        }
        const lowerAlias = alias.toLowerCase();
        if (this.aliasToId.has(lowerAlias) || this.kinds.has(lowerAlias)) {
          throw new InvalidNutrientKindError(
            kind.id,
            `alias "${alias}" collides with an existing kind or alias`,
          );
        }
      }
    }
    if (
      kind.defaultUnit !== undefined &&
      (typeof kind.defaultUnit !== "string" || kind.defaultUnit.trim().length === 0)
    ) {
      throw new InvalidNutrientKindError(
        kind.id,
        "defaultUnit must be a non-empty string if provided",
      );
    }
    assertDeclarative(kind.metadata, `Nutrient kind "${kind.id}"`);

    const frozen: NutrientKind = Object.freeze({
      ...kind,
      id: lowerId,
      aliases: kind.aliases ? Object.freeze([...kind.aliases]) : undefined,
      metadata: kind.metadata ? Object.freeze({ ...kind.metadata }) : undefined,
    });
    this.kinds.set(lowerId, frozen);
    if (frozen.aliases) {
      for (const alias of frozen.aliases) {
        this.aliasToId.set(alias.toLowerCase(), lowerId);
      }
    }
    // id itself is also an alias for symmetric lookup
    this.aliasToId.set(lowerId, lowerId);
  }

  has(id: string): boolean {
    if (typeof id !== "string") return false;
    return this.aliasToId.has(id.toLowerCase());
  }

  require(id: string): NutrientKind {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new InvalidNutrientKindError(String(id), "id must be a non-empty string");
    }
    const lower = id.toLowerCase();
    const canonical = this.aliasToId.get(lower);
    if (!canonical) throw new InvalidNutrientKindError(id, "unknown nutrient kind");
    const kind = this.kinds.get(canonical);
    if (!kind) throw new InvalidNutrientKindError(id, "unknown nutrient kind");
    return kind;
  }

  /** Resolve alias or id to canonical id; undefined if unknown. */
  resolve(id: string): string | undefined {
    if (typeof id !== "string") return undefined;
    return this.aliasToId.get(id.toLowerCase());
  }

  list(): readonly NutrientKind[] {
    return [...this.kinds.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  snapshot(): NutrientKindRegistry {
    const snap = new NutrientKindRegistry([]);
    for (const [id, kind] of this.kinds) snap.kinds.set(id, kind);
    for (const [alias, canonical] of this.aliasToId) snap.aliasToId.set(alias, canonical);
    return snap;
  }

  get size(): number {
    return this.kinds.size;
  }
}

// ---------------------------------------------------------------------------
// Seed kinds — mirrors the existing NutrientKey union
// ---------------------------------------------------------------------------

function defaultSeedKinds(): readonly NutrientKind[] {
  return [
    // ── Proximate / macro nutrients ──────────────────────────────────────────
    {
      id: "cp",
      name: "Crude Protein",
      aliases: ["crudeProtein", "protein", "nutrient:crude-protein", "nutrient:protein", "CP"],
      category: "macro-nutrient",
      family: "protein",
      description: "Crude protein",
      defaultUnit: "g/day",
      metadata: { group: "macro" },
    },
    {
      id: "trueProtein",
      name: "True Protein",
      aliases: ["TP", "nutrient:true-protein"],
      category: "macro-nutrient",
      family: "protein",
      description: "True protein (distinct from crude protein)",
      defaultUnit: "g/day",
    },
    {
      id: "lys",
      name: "Lysine",
      category: "macro-nutrient",
      family: "protein",
      description: "Lysine (amino acid)",
      defaultUnit: "g/day",
    },
    {
      id: "methionine",
      name: "Methionine",
      aliases: ["met", "nutrient:methionine"],
      category: "macro-nutrient",
      family: "protein",
      description: "Methionine",
      defaultUnit: "g/day",
    },
    {
      id: "metCys",
      name: "Methionine + Cystine",
      category: "macro-nutrient",
      family: "protein",
      description: "Met + Cys",
      defaultUnit: "g/day",
    },
    {
      id: "ee",
      name: "Ether Extract",
      aliases: ["fat", "totalFat", "nutrient:ether-extract", "nutrient:fat"],
      category: "macro-nutrient",
      family: "lipid",
      description: "Ether extract (crude fat)",
      defaultUnit: "g/day",
    },
    {
      id: "cf",
      name: "Crude Fiber",
      aliases: ["nutrient:crude-fiber", "CF"],
      category: "macro-nutrient",
      family: "fiber",
      description: "Crude fiber",
      defaultUnit: "g/day",
    },
    {
      id: "ndf",
      name: "Neutral Detergent Fiber",
      aliases: ["nutrient:ndf"],
      category: "macro-nutrient",
      family: "fiber",
      description: "NDF",
      defaultUnit: "g/day",
    },
    {
      id: "adf",
      name: "Acid Detergent Fiber",
      aliases: ["nutrient:adf"],
      category: "macro-nutrient",
      family: "fiber",
      description: "ADF",
      defaultUnit: "g/day",
    },
    {
      id: "lignin",
      name: "Lignin",
      aliases: ["ADL", "nutrient:lignin"],
      category: "macro-nutrient",
      family: "fiber",
      description: "Lignin",
      defaultUnit: "g/day",
    },
    {
      id: "ash",
      name: "Ash",
      category: "macro-nutrient",
      family: "proximate",
      description: "Ash",
      defaultUnit: "g/day",
    },
    {
      id: "starch",
      name: "Starch",
      category: "macro-nutrient",
      family: "carbohydrate",
      description: "Starch",
      defaultUnit: "g/day",
    },
    {
      id: "sugar",
      name: "Sugar",
      aliases: ["sugars", "nutrient:sugar"],
      category: "macro-nutrient",
      family: "carbohydrate",
      description: "Sugar",
      defaultUnit: "g/day",
    },
    {
      id: "totalCarbohydrates",
      name: "Total Carbohydrates",
      aliases: ["CHO", "carbohydrates", "nutrient:total-carbohydrates"],
      category: "macro-nutrient",
      family: "carbohydrate",
      description: "Total carbohydrates",
      defaultUnit: "g/day",
    },
    {
      id: "tdn",
      name: "Total Digestible Nutrients",
      category: "macro-nutrient",
      family: "proximate",
      description: "TDN",
      defaultUnit: "g/day",
    },
    {
      id: "dryMatter",
      name: "Dry Matter",
      aliases: ["DM", "nutrient:dry-matter"],
      category: "proximate",
      family: "proximate",
      description: "Dry matter content — distinct from basis context",
      defaultUnit: "%",
    },
    {
      id: "moisture",
      name: "Moisture",
      aliases: ["water", "nutrient:moisture"],
      category: "proximate",
      family: "proximate",
      description: "Moisture content",
      defaultUnit: "%",
    },
    // ── Minerals ───────────────────────────────────────────────────────────────
    {
      id: "ca",
      name: "Calcium",
      symbol: "Ca",
      aliases: ["nutrient:calcium", "Ca"],
      category: "macro-mineral",
      family: "mineral",
      description: "Calcium",
      defaultUnit: "g/day",
    },
    {
      id: "p",
      name: "Phosphorus",
      symbol: "P",
      aliases: ["nutrient:phosphorus"],
      category: "macro-mineral",
      family: "mineral",
      description: "Phosphorus",
      defaultUnit: "g/day",
    },
    {
      id: "availableP",
      name: "Available Phosphorus",
      category: "macro-mineral",
      family: "mineral",
      description: "Available P",
      defaultUnit: "g/day",
    },
    {
      id: "mg",
      name: "Magnesium",
      symbol: "Mg",
      aliases: ["nutrient:magnesium", "Mg"],
      category: "macro-mineral",
      family: "mineral",
      description: "Magnesium",
      defaultUnit: "g/day",
    },
    {
      id: "k",
      name: "Potassium",
      symbol: "K",
      aliases: ["nutrient:potassium"],
      category: "macro-mineral",
      family: "mineral",
      description: "Potassium",
      defaultUnit: "g/day",
    },
    {
      id: "na",
      name: "Sodium",
      symbol: "Na",
      aliases: ["nutrient:sodium"],
      category: "macro-mineral",
      family: "mineral",
      description: "Sodium",
      defaultUnit: "g/day",
    },
    {
      id: "cl",
      name: "Chlorine",
      symbol: "Cl",
      aliases: ["nutrient:chlorine", "chloride"],
      category: "macro-mineral",
      family: "mineral",
      description: "Chlorine",
      defaultUnit: "g/day",
    },
    {
      id: "s",
      name: "Sulfur",
      symbol: "S",
      aliases: ["nutrient:sulfur"],
      category: "macro-mineral",
      family: "mineral",
      description: "Sulfur",
      defaultUnit: "g/day",
    },
    // ── Trace minerals ─────────────────────────────────────────────────────────
    {
      id: "fe",
      name: "Iron",
      symbol: "Fe",
      aliases: ["nutrient:iron"],
      category: "trace-mineral",
      family: "mineral",
      description: "Iron",
      defaultUnit: "mg/day",
    },
    {
      id: "mn",
      name: "Manganese",
      symbol: "Mn",
      aliases: ["nutrient:manganese"],
      category: "trace-mineral",
      family: "mineral",
      description: "Manganese",
      defaultUnit: "mg/day",
    },
    {
      id: "cu",
      name: "Copper",
      symbol: "Cu",
      aliases: ["nutrient:copper"],
      category: "trace-mineral",
      family: "mineral",
      description: "Copper",
      defaultUnit: "mg/day",
    },
    {
      id: "zn",
      name: "Zinc",
      symbol: "Zn",
      aliases: ["nutrient:zinc"],
      category: "trace-mineral",
      family: "mineral",
      description: "Zinc",
      defaultUnit: "mg/day",
    },
    {
      id: "co",
      name: "Cobalt",
      symbol: "Co",
      aliases: ["nutrient:cobalt"],
      category: "trace-mineral",
      family: "mineral",
      description: "Cobalt",
      defaultUnit: "mg/day",
    },
    {
      id: "i",
      name: "Iodine",
      symbol: "I",
      aliases: ["nutrient:iodine"],
      category: "trace-mineral",
      family: "mineral",
      description: "Iodine",
      defaultUnit: "mg/day",
    },
    {
      id: "se",
      name: "Selenium",
      symbol: "Se",
      aliases: ["nutrient:selenium"],
      category: "trace-mineral",
      family: "mineral",
      description: "Selenium",
      defaultUnit: "mg/day",
    },
    {
      id: "mo",
      name: "Molybdenum",
      symbol: "Mo",
      aliases: ["nutrient:molybdenum"],
      category: "trace-mineral",
      family: "mineral",
      description: "Molybdenum",
      defaultUnit: "mg/day",
    },
    {
      id: "cr",
      name: "Chromium",
      symbol: "Cr",
      aliases: ["nutrient:chromium"],
      category: "trace-mineral",
      family: "mineral",
      description: "Chromium",
      defaultUnit: "mg/day",
    },
    // ── Vitamins ─────────────────────────────────────────────────────────────
    {
      id: "vitA",
      name: "Vitamin A",
      aliases: ["nutrient:vitamin-a"],
      category: "vitamin",
      family: "vitamin",
      description: "Vitamin A",
      defaultUnit: "IU/day",
      chemicalMetadata: { forms: ["retinol"] },
    },
    {
      id: "vitD",
      name: "Vitamin D",
      aliases: ["nutrient:vitamin-d"],
      category: "vitamin",
      family: "vitamin",
      description: "Vitamin D",
      defaultUnit: "IU/day",
      chemicalMetadata: { forms: ["cholecalciferol"] },
    },
    {
      id: "vitE",
      name: "Vitamin E",
      aliases: ["nutrient:vitamin-e"],
      category: "vitamin",
      family: "vitamin",
      description: "Vitamin E",
      defaultUnit: "IU/day",
      chemicalMetadata: { forms: ["alpha-tocopherol"] },
    },
    {
      id: "vitK",
      name: "Vitamin K",
      aliases: ["nutrient:vitamin-k"],
      category: "vitamin",
      family: "vitamin",
      description: "Vitamin K",
      defaultUnit: "IU/day",
    },
    {
      id: "vitC",
      name: "Vitamin C",
      aliases: ["nutrient:vitamin-c", "ascorbicAcid"],
      category: "vitamin",
      family: "vitamin",
      description: "Vitamin C (ascorbic acid)",
      defaultUnit: "mg/day",
    },
    {
      id: "vitB1",
      name: "Vitamin B1",
      aliases: ["thiamine", "nutrient:vitamin-b1", "nutrient:thiamine"],
      category: "vitamin",
      family: "vitamin",
      description: "Thiamine",
      defaultUnit: "mg/day",
    },
    {
      id: "vitB2",
      name: "Vitamin B2",
      aliases: ["riboflavin", "nutrient:vitamin-b2", "nutrient:riboflavin"],
      category: "vitamin",
      family: "vitamin",
      description: "Riboflavin",
      defaultUnit: "mg/day",
    },
    {
      id: "vitB3",
      name: "Vitamin B3",
      aliases: ["niacin", "nutrient:vitamin-b3", "nutrient:niacin"],
      category: "vitamin",
      family: "vitamin",
      description: "Niacin",
      defaultUnit: "mg/day",
    },
    {
      id: "vitB5",
      name: "Vitamin B5",
      aliases: ["pantothenicAcid", "nutrient:vitamin-b5"],
      category: "vitamin",
      family: "vitamin",
      description: "Pantothenic acid",
      defaultUnit: "mg/day",
    },
    {
      id: "vitB6",
      name: "Vitamin B6",
      aliases: ["pyridoxine", "nutrient:vitamin-b6", "nutrient:pyridoxine"],
      category: "vitamin",
      family: "vitamin",
      description: "Pyridoxine",
      defaultUnit: "mg/day",
    },
    {
      id: "vitB7",
      name: "Vitamin B7",
      aliases: ["biotin", "nutrient:vitamin-b7", "nutrient:biotin"],
      category: "vitamin",
      family: "vitamin",
      description: "Biotin",
      defaultUnit: "mg/day",
    },
    {
      id: "vitB9",
      name: "Vitamin B9",
      aliases: ["folate", "folicAcid", "nutrient:vitamin-b9", "nutrient:folate"],
      category: "vitamin",
      family: "vitamin",
      description: "Folate",
      defaultUnit: "mg/day",
    },
    {
      id: "vitB12",
      name: "Vitamin B12",
      aliases: ["cobalamin", "nutrient:vitamin-b12", "nutrient:cobalamin"],
      category: "vitamin",
      family: "vitamin",
      description: "Cobalamin",
      defaultUnit: "mg/day",
    },
    // ── Energy semantics ─────────────────────────────────────────────────────
    {
      id: "ge",
      name: "Gross Energy",
      aliases: ["nutrient:gross-energy"],
      category: "energy",
      family: "energy",
      description: "Gross energy",
      defaultUnit: "Mcal/day",
    },
    {
      id: "de",
      name: "Digestible Energy",
      aliases: ["nutrient:digestible-energy"],
      category: "energy",
      family: "energy",
      description: "DE",
      defaultUnit: "Mcal/day",
    },
    {
      id: "me",
      name: "Metabolizable Energy",
      aliases: ["nutrient:metabolizable-energy"],
      category: "energy",
      family: "energy",
      description: "ME",
      defaultUnit: "Kcal/day",
    },
    {
      id: "nel",
      name: "Net Energy for Lactation",
      aliases: ["nutrient:nel"],
      category: "energy",
      family: "energy",
      description: "NE_L",
      defaultUnit: "Mcal/day",
    },
    {
      id: "nem",
      name: "Net Energy for Maintenance",
      aliases: ["nutrient:nem"],
      category: "energy",
      family: "energy",
      description: "NE_M",
      defaultUnit: "Mcal/day",
    },
    {
      id: "neg",
      name: "Net Energy for Gain",
      aliases: ["nutrient:neg"],
      category: "energy",
      family: "energy",
      description: "NE_G",
      defaultUnit: "Mcal/day",
    },
    // economics
    {
      id: "cost",
      name: "Cost",
      category: "economics",
      description: "Feed cost",
      defaultUnit: "cur/day",
    },
  ];
}

export const defaultNutrientKindRegistry = new NutrientKindRegistry();

/** Shape guard for nutrient kind ids. */
export function isNutrientKindId(value: unknown): value is string {
  return typeof value === "string" && KIND_ID_PATTERN.test(value);
}
