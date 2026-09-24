/**
 * nutrition-phase2.test.ts — Phase 2 validation for @vetwo/nutrition-units
 *
 * Covers: architecture (dependency direction), nutrient semantics, basis,
 * physical units delegation, semantic compatibility, serialization,
 * immutability, API surface, regression, property-based invariants.
 */
import { describe, expect, it } from "vitest";
import { Quantity, UnitEngineError } from "@vetwo/units";
import {
  NutrientKindRegistry,
  defaultNutrientKindRegistry,
  BasisRegistry,
  defaultBasisRegistry,
  NutritionQuantity,
  serializeNutritionQuantity,
  deserializeNutritionQuantity,
  TargetUnitRegistry,
  coefficientResolver,
  nutritionMath,
  // errors
  InvalidNutrientKindError,
  NutrientSemanticMismatchError,
  InvalidNutritionBasisError,
  InvalidNutritionQuantityError,
} from "../src/index.js";
import * as api from "../src/index.js";

// ---------------------------------------------------------------------------
// Architecture — dependency direction & no duplicated core engine
// ---------------------------------------------------------------------------

describe("architecture", () => {
  it("re-exports core Quantity without duplicating conversion logic", () => {
    // Physical conversion must still come from @vetwo/units
    expect(Quantity.of(1, "kg").to("g").value).toBe(1000);
    // NutritionQuantity delegates — no second engine
    const nq = NutritionQuantity.of(Quantity.of(15, "% DM"), "cp", "dryMatter");
    expect(nq.quantity.value).toBe(15);
  });

  it("no circular dependency — nutrition-units does not appear in core exports", async () => {
    const core = await import("@vetwo/units");
    const coreKeys = Object.keys(core);
    expect(coreKeys.join(",")).not.toContain("nutrition");
  });
});

// ---------------------------------------------------------------------------
// Nutrient semantics — registry
// ---------------------------------------------------------------------------

describe("nutrient-kind registry", () => {
  it("seed contains all known nutrients with stable ids", () => {
    expect(defaultNutrientKindRegistry.size).toBeGreaterThanOrEqual(34);
    for (const id of ["cp", "lys", "ca", "fe", "vitA", "de", "me", "cost"]) {
      expect(defaultNutrientKindRegistry.has(id)).toBe(true);
      expect(defaultNutrientKindRegistry.require(id).id).toBe(id.toLowerCase());
    }
  });

  it("aliases resolve deterministically", () => {
    expect(defaultNutrientKindRegistry.require("crudeProtein").id).toBe("cp");
    expect(defaultNutrientKindRegistry.require("CP").id).toBe("cp");
    expect(defaultNutrientKindRegistry.require("protein").id).toBe("cp");
    expect(defaultNutrientKindRegistry.require("Ca").id).toBe("ca");
  });

  it("collision detection — duplicate id or alias throws", () => {
    const reg = new NutrientKindRegistry([]);
    reg.register({ id: "testKind", name: "Test", aliases: ["aliasOne"] });
    expect(() => reg.register({ id: "testKind", name: "Dup" })).toThrow(InvalidNutrientKindError);
    expect(() => reg.register({ id: "other", name: "Other", aliases: ["aliasOne"] })).toThrow(
      InvalidNutrientKindError,
    );
    expect(() => reg.register({ id: "bad id", name: "Bad" })).toThrow(InvalidNutrientKindError);
    expect(() => reg.register({ id: "ok", name: "" })).toThrow(InvalidNutrientKindError);
  });

  it("forbidden keys and prototype pollution rejected", () => {
    const reg = new NutrientKindRegistry([]);
    const evil = JSON.parse('{"id":"evil","name":"Evil","metadata":{"__proto__":{}}}');
    expect(() => reg.register(evil)).toThrow(UnitEngineError);
  });

  it("snapshot is isolated", () => {
    const reg = new NutrientKindRegistry([]);
    reg.register({ id: "snapA", name: "Snap A" });
    const snap = reg.snapshot();
    reg.register({ id: "snapB", name: "Snap B" });
    expect(snap.has("snapB")).toBe(false);
    expect(reg.has("snapB")).toBe(true);
  });

  it("dimension equality does NOT imply nutrient equality", () => {
    const cp = NutritionQuantity.of(Quantity.of(100, "g"), "cp", "asFed");
    const ca = NutritionQuantity.of(Quantity.of(100, "g"), "ca", "asFed");
    // same physical dimension + unit, different semantic kind
    expect(cp.quantity.hasSameDimension(ca.quantity)).toBe(true);
    expect(cp.nutrient.id).not.toBe(ca.nutrient.id);
    expect(() => cp.add(ca)).toThrow(NutrientSemanticMismatchError);
  });
});

// ---------------------------------------------------------------------------
// Basis — explicit semantic context
// ---------------------------------------------------------------------------

describe("basis registry", () => {
  it("seed bases resolve with aliases", () => {
    expect(defaultBasisRegistry.require("DM").id).toBe("drymatter");
    expect(defaultBasisRegistry.require("dryMatter").id).toBe("drymatter");
    expect(defaultBasisRegistry.require("asFed").id).toBe("asfed");
    expect(defaultBasisRegistry.require("as-fed").id).toBe("asfed");
    expect(defaultBasisRegistry.require("FM").id).toBe("freshmatter");
  });

  it("unknown basis throws typed error", () => {
    expect(() => defaultBasisRegistry.require("unknownBasis_xyz")).toThrow(
      InvalidNutritionBasisError,
    );
  });

  it("basis is semantic metadata, not a dimension", () => {
    const asFed = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed");
    const dm = NutritionQuantity.of(Quantity.of(100, "g/kg DM"), "cp", "dryMatter");
    expect(asFed.quantity.hasSameDimension(dm.quantity)).toBe(true);
    // same nutrient, different basis must not silently mix
    expect(() => asFed.add(dm)).toThrow(InvalidNutritionBasisError);
    // basis metadata is on NutritionQuantity, not dimension
    expect(asFed.basis.id).toBe("asfed");
    expect(dm.basis.id).toBe("drymatter");
  });

  it("100 g/kg vs 100 g/kg DM vs 100 g/kg as-fed are distinct", () => {
    const a = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed");
    const b = NutritionQuantity.of(Quantity.of(100, "g/kg DM"), "cp", "dryMatter");
    expect(a.basis.id).not.toBe(b.basis.id);
    expect(a.quantity.unit.basis).toBeUndefined();
    expect(b.quantity.unit.basis).toBe("DM");
  });

  it("withBasis converts asFed ↔ dryMatter via DM%", () => {
    const dm = NutritionQuantity.of(Quantity.of(100, "g/kg DM"), "cp", "dryMatter");
    const asFed = dm.withBasis("asFed", Quantity.of(88, "%"));
    expect(asFed.basis.id).toBe("asfed");
    expect(asFed.quantity.value).toBeCloseTo(88, 9);
    const back = asFed.withBasis("dryMatter", Quantity.of(88, "%"));
    expect(back.basis.id).toBe("drymatter");
    expect(back.quantity.value).toBeCloseTo(100, 9);
  });

  it("withBasis requires DM% and rejects 0%", () => {
    const dm = NutritionQuantity.of(Quantity.of(10, "% DM"), "cp", "dryMatter");
    expect(() => dm.withBasis("asFed")).toThrow(InvalidNutritionBasisError);
    const af = NutritionQuantity.of(Quantity.of(10, "%"), "cp", "asFed");
    expect(() => af.withBasis("dryMatter", Quantity.of(0, "%"))).toThrow(
      InvalidNutritionBasisError,
    );
  });

  it("snapshot isolation", () => {
    const reg = new BasisRegistry([]);
    reg.register({ id: "customBasis", name: "Custom" });
    const snap = reg.snapshot();
    reg.register({ id: "anotherBasis", name: "Another" });
    expect(snap.has("anotherBasis")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Physical units — delegated to @vetwo/units
// ---------------------------------------------------------------------------

describe("physical units delegated", () => {
  it("delegates kg↔g, J↔kJ, etc. entirely to core", () => {
    const nq = NutritionQuantity.from(1, "kg", "cp", "asFed");
    expect(nq.to("g").quantity.value).toBe(1000);
    expect(nq.quantity.to("g").value).toBe(1000);
  });

  it("nutrient concentration via NutritionQuantity preserves dimension", () => {
    const intake = Quantity.of(10, "kg/day");
    const conc = Quantity.of(12, "%");
    const result = nutritionMath.calculate(intake, conc, "cp");
    expect(result.to("g/day").value).toBeCloseTo(1200, 6);
  });
});

// ---------------------------------------------------------------------------
// Semantic compatibility
// ---------------------------------------------------------------------------

describe("semantic compatibility", () => {
  it("add/subtract require same nutrient and same basis", () => {
    const a = NutritionQuantity.of(Quantity.of(100, "g"), "cp", "asFed");
    const b = NutritionQuantity.of(Quantity.of(50, "g"), "cp", "asFed");
    expect(a.add(b).quantity.value).toBe(150);
    expect(a.subtract(b).quantity.value).toBe(50);

    const diffNutrient = NutritionQuantity.of(Quantity.of(50, "g"), "ca", "asFed");
    expect(() => a.add(diffNutrient)).toThrow(NutrientSemanticMismatchError);

    const diffBasis = NutritionQuantity.of(Quantity.of(50, "g DM"), "cp", "dryMatter");
    expect(() => a.add(diffBasis)).toThrow(InvalidNutritionBasisError);
  });

  it("scale preserves semantics", () => {
    const a = NutritionQuantity.of(Quantity.of(100, "g"), "cp", "asFed");
    expect(a.scale(2).quantity.value).toBe(200);
    expect(a.scale(2).nutrient.id).toBe("cp");
  });

  it("equals / exactEquals consider nutrient + basis + quantity", () => {
    const a = NutritionQuantity.of(Quantity.of(100, "g"), "cp", "asFed");
    const b = NutritionQuantity.of(Quantity.of(100, "g"), "cp", "asFed");
    const diffNutrient = NutritionQuantity.of(Quantity.of(100, "g"), "ca", "asFed");
    expect(a.equals(b)).toBe(true);
    expect(a.exactEquals(b)).toBe(true);
    expect(a.equals(diffNutrient)).toBe(false);
  });

  it("invalid quantity construction throws typed errors", () => {
    expect(() => NutritionQuantity.of(null as never, "cp", "asFed")).toThrow(
      InvalidNutritionQuantityError,
    );
    expect(() =>
      NutritionQuantity.of(Quantity.of(10, "g"), "unknownNutrient_xyz", "asFed"),
    ).toThrow(InvalidNutrientKindError);
    expect(() => NutritionQuantity.of(Quantity.of(10, "g"), "cp", "unknownBasis_xyz")).toThrow(
      InvalidNutritionBasisError,
    );
    // tagged mismatch: DM tag with asFed basis → throw
    expect(() => NutritionQuantity.of(Quantity.of(10, "g DM"), "cp", "asFed")).toThrow(
      InvalidNutritionBasisError,
    );
    // bare unit with dryMatter basis is allowed (basis is semantic, not forced into unit tag)
    expect(() => NutritionQuantity.of(Quantity.of(10, "g"), "cp", "dryMatter")).not.toThrow();
    // mismatched tags: DM unit vs freshMatter basis → throw
    expect(() => NutritionQuantity.of(Quantity.of(10, "g DM"), "cp", "freshMatter")).toThrow(
      InvalidNutritionBasisError,
    );
  });
});

// ---------------------------------------------------------------------------
// Serialization — deterministic round-trips
// ---------------------------------------------------------------------------

describe("serialization", () => {
  it("round-trip preserves physical quantity + nutrient + basis + metadata", () => {
    const nq = NutritionQuantity.of(Quantity.of(100, "g/kg DM"), "cp", "dryMatter", {
      metadata: { source: "lab" },
    });
    const serialized = serializeNutritionQuantity(nq);
    expect(serialized.version).toBe(1);
    expect(serialized.nutrient).toBe("cp");
    expect(serialized.basis).toBe("drymatter");
    const back = deserializeNutritionQuantity(serialized);
    expect(back.equals(nq)).toBe(true);
    expect(back.metadata).toEqual({ source: "lab" });
    // JSON string deterministic
    expect(JSON.stringify(serializeNutritionQuantity(back))).toBe(JSON.stringify(serialized));
  });

  it("rejects malformed / unknown schema version / pollution", () => {
    expect(() => deserializeNutritionQuantity(null)).toThrow(InvalidNutritionQuantityError);
    expect(() =>
      deserializeNutritionQuantity({
        version: 99,
        type: "nutrition-quantity",
        quantity: { value: 1, unit: "g" },
        nutrient: "cp",
        basis: "asFed",
      }),
    ).toThrow(InvalidNutritionQuantityError);
    expect(() =>
      deserializeNutritionQuantity({
        version: 1,
        type: "nutrition-quantity",
        quantity: { value: "bad", unit: "g" },
        nutrient: "cp",
        basis: "asFed",
      }),
    ).toThrow(InvalidNutritionQuantityError);
    expect(() =>
      deserializeNutritionQuantity({
        version: 1,
        type: "nutrition-quantity",
        quantity: { value: 1, unit: "g" },
        nutrient: "unknown_xyz",
        basis: "asFed",
      }),
    ).toThrow(InvalidNutrientKindError);
    expect(() =>
      deserializeNutritionQuantity(
        JSON.parse(
          '{"version":1,"type":"nutrition-quantity","quantity":{"value":1,"unit":"g"},"nutrient":"cp","basis":"asFed","__proto__":{"polluted":true}}',
        ),
      ),
    ).toThrow(InvalidNutritionQuantityError);
  });

  it("toJSON / fromJSON helpers", () => {
    const nq = NutritionQuantity.from(50, "mg/kg", "fe", "asFed");
    const back = NutritionQuantity.fromJSON(nq.toJSON());
    expect(back.equals(nq)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe("immutability", () => {
  it("NutritionQuantity is frozen", () => {
    const nq = NutritionQuantity.of(Quantity.of(10, "g"), "cp", "asFed");
    expect(Object.isFrozen(nq)).toBe(true);
    expect(Object.isFrozen(nq.nutrient)).toBe(true);
    expect(Object.isFrozen(nq.basis)).toBe(true);
  });

  it("registries are immutable snapshots (entries frozen)", () => {
    const kind = defaultNutrientKindRegistry.require("cp");
    expect(Object.isFrozen(kind)).toBe(true);
    const basis = defaultBasisRegistry.require("dryMatter");
    expect(Object.isFrozen(basis)).toBe(true);
  });

  it("TargetUnitRegistry override does not corrupt defaults for others", () => {
    const reg = new TargetUnitRegistry();
    const before = reg.getTargetUnit("cp");
    reg.override("cp", "kg/day");
    expect(reg.getTargetUnit("cp")).toBe("kg/day");
    expect(new TargetUnitRegistry().getTargetUnit("cp")).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// API surface — exports
// ---------------------------------------------------------------------------

describe("public API surface", () => {
  it("exports expected nutrition symbols", () => {
    for (const required of [
      "NutritionQuantity",
      "NutrientKindRegistry",
      "BasisRegistry",
      "NutritionMath",
      "BasisConverter",
      "TargetUnitRegistry",
      "FeedSchemaLoader",
    ]) {
      expect(api, `missing export: ${required}`).toHaveProperty(required);
    }
  });

  it("no nutrition logic leaks into dimensionless generic", () => {
    // Generic Quantity still works without nutrient concepts
    expect(Quantity.of(5, "m").to("cm").value).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Property-based (seeded) — alias equivalence, round-trips, determinism
// ---------------------------------------------------------------------------

describe("property-based invariants (seeded)", () => {
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("alias equivalence: every alias resolves to same canonical id", () => {
    const rand = mulberry32(42);
    const kinds = defaultNutrientKindRegistry.list();
    for (let i = 0; i < 100; i++) {
      const kind = kinds[Math.floor(rand() * kinds.length)]!;
      if (kind.aliases && kind.aliases.length > 0) {
        const alias = kind.aliases[Math.floor(rand() * kind.aliases.length)]!;
        expect(defaultNutrientKindRegistry.require(alias).id).toBe(kind.id);
        expect(defaultNutrientKindRegistry.require(alias.toUpperCase()).id).toBe(kind.id);
      }
    }
  });

  it("serialization round-trip for random nutrition quantities", () => {
    const rand = mulberry32(99);
    const nutrients = defaultNutrientKindRegistry
      .list()
      .filter((k) => k.category !== "economics")
      .map((k) => k.id);
    const bases = defaultBasisRegistry.list().map((b) => b.id);
    const massUnits = ["g/kg", "mg/kg", "g", "mg", "%"];
    const energyUnits = ["Mcal/kg", "MJ/kg", "Kcal/kg"];
    const iuUnits = ["IU/kg", "IU/g"];
    for (let i = 0; i < 100; i++) {
      const nut = nutrients[Math.floor(rand() * nutrients.length)]!;
      const basis = bases[Math.floor(rand() * bases.length)]!;
      const kind = defaultNutrientKindRegistry.require(nut);
      let unitPool: string[];
      if (kind.category === "energy") unitPool = energyUnits;
      else if (kind.category === "vitamin" && (kind.defaultUnit?.includes("IU") ?? false))
        unitPool = iuUnits;
      else unitPool = massUnits;
      const unit = unitPool[Math.floor(rand() * unitPool.length)]!;
      const basisDef = defaultBasisRegistry.require(basis);
      const unitWithBasis = basisDef.unitBasis ? `${unit} ${basisDef.unitBasis}` : unit;
      let q: Quantity;
      try {
        q = Quantity.of(Math.round(rand() * 10000) / 100, unitWithBasis);
      } catch {
        continue;
      }
      const nq = NutritionQuantity.of(q, nut, basis);
      const back = deserializeNutritionQuantity(serializeNutritionQuantity(nq));
      expect(back.equals(nq)).toBe(true);
    }
  });

  it("basis conversion is deterministic", () => {
    const nq = NutritionQuantity.of(Quantity.of(100, "g/kg DM"), "cp", "dryMatter");
    const a = nq.withBasis("asFed", Quantity.of(88, "%"));
    const b = nq.withBasis("asFed", Quantity.of(88, "%"));
    expect(a.equals(b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression — old valid behavior still holds
// ---------------------------------------------------------------------------

describe("backward compatibility — existing nutrition-math still works", () => {
  it("NutritionMath.calculate still delegates to core Quantity.multiply", () => {
    const result = nutritionMath.calculate(Quantity.of(10, "kg/day"), Quantity.of(12, "%"), "cp");
    expect(result.to("g/day").value).toBeCloseTo(1200, 6);
  });

  it("BasisConverter still works via Unit.basis tag", async () => {
    const { BasisConverter } = await import("../src/basis-converter.js");
    const asFed = BasisConverter.toAsFed(Quantity.of(15, "% DM"), Quantity.of(88, "%"));
    expect(asFed.value).toBeCloseTo(13.2, 9);
  });

  it("coefficientResolver still strips to plain numbers", () => {
    expect(
      coefficientResolver.getCoefficient(Quantity.of(10, "kg/day"), Quantity.of(12, "%"), "cp"),
    ).toBeCloseTo(1200, 6);
  });
});
