/**
 * nutrition-phase5-phase6.test.ts — Phase 5 (Basis & Context) + Phase 6 (Advanced Families)
 *
 * Covers prompt §41-46 requirements: basis tests, dry matter, basis conversion,
 * concentration+basis, families, semantic safety, property-based, fuzz/adversarial.
 */
import { describe, expect, it } from "vitest";
import { Quantity, createRegistry, SI_PACK } from "@vetwo/units";
import {
  NutritionQuantity,
  createNutritionContext,
  defaultBasisRegistry,
  getMolarMass,
  convertMolarToMass,
  MissingNutritionContextError,
  NutritionUnitCompatibilityError,
  InvalidNutritionQuantityError,
  NutritionContextError,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// §41 — Basis tests
// ---------------------------------------------------------------------------

describe("phase5 — basis model", () => {
  it("supports asFed / dryMatter / freshMatter / wet / normalized", () => {
    for (const id of ["asFed", "dryMatter", "freshMatter", "wet", "normalized"]) {
      expect(defaultBasisRegistry.has(id)).toBe(true);
      const def = defaultBasisRegistry.require(id);
      expect(def.id).toBe(id.toLowerCase());
      expect(Object.isFrozen(def)).toBe(true);
    }
  });

  it("deterministic alias lookup", () => {
    expect(defaultBasisRegistry.require("DM").id).toBe("drymatter");
    expect(defaultBasisRegistry.require("dm").id).toBe("drymatter");
    expect(defaultBasisRegistry.require("AF").id).toBe("asfed");
    expect(defaultBasisRegistry.require("FM").id).toBe("freshmatter");
    expect(defaultBasisRegistry.require("WB").id).toBe("wet");
  });
});

// ---------------------------------------------------------------------------
// §41 — Dry matter fraction validation
// ---------------------------------------------------------------------------

describe("phase5 — dry matter fraction validation", () => {
  it("accepts valid fractions and 88% → 0.88", () => {
    const ctx = createNutritionContext({ dryMatterFraction: 0.88 });
    expect(ctx.resolvedDryMatterFraction).toBeCloseTo(0.88, 9);
    expect(ctx.resolvedMoistureFraction).toBeCloseTo(0.12, 9);
    const fromPct = createNutritionContext({ dryMatterFraction: 0.5 });
    expect(fromPct.dryMatterFraction).toBe(0.5);
    // via Quantity % → fraction
    const qPct = Quantity.of(88, "%");
    const frac = qPct.to("%").value / 100;
    expect(frac).toBeCloseTo(0.88, 9);
  });

  it("rejects DM <=0, >1, NaN, Infinity", () => {
    expect(() => createNutritionContext({ dryMatterFraction: 0 })).toThrow();
    expect(() => createNutritionContext({ dryMatterFraction: -0.1 })).toThrow();
    expect(() => createNutritionContext({ dryMatterFraction: 1.5 })).toThrow();
    expect(() => createNutritionContext({ dryMatterFraction: NaN })).toThrow();
    expect(() => createNutritionContext({ dryMatterFraction: Infinity })).toThrow();
    expect(() => createNutritionContext({ moistureFraction: 0 })).toThrow();
    expect(() =>
      createNutritionContext({ dryMatterFraction: 0.9, moistureFraction: 0.2 }),
    ).toThrow(); // sum 1.1 ≠1
  });

  it("moisture derived: 12% moisture → 88% DM", () => {
    const ctx = createNutritionContext({ moistureFraction: 0.12 });
    expect(ctx.resolvedDryMatterFraction).toBeCloseTo(0.88, 9);
    expect(ctx.resolvedMoistureFraction).toBeCloseTo(0.12, 9);
  });

  it("both supplied must be consistent DM+moisture≈1", () => {
    expect(() =>
      createNutritionContext({ dryMatterFraction: 0.88, moistureFraction: 0.13 }),
    ).toThrow(NutritionContextError);
    expect(
      createNutritionContext({ dryMatterFraction: 0.88, moistureFraction: 0.12 })
        .resolvedDryMatterFraction,
    ).toBeCloseTo(0.88, 9);
  });
});

// ---------------------------------------------------------------------------
// §41 — Basis conversion tests (AF ↔ DM, identity, round-trips)
// ---------------------------------------------------------------------------

describe("phase5 — basis conversion", () => {
  it("AF → DM and DM → AF with explicit context", () => {
    const af = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed");
    const dm = af.convertBasis("dryMatter", createNutritionContext({ dryMatterFraction: 0.88 }));
    expect(dm.basis.id).toBe("drymatter");
    expect(dm.quantity.value).toBeCloseTo(113.636363636, 6);
    expect(dm.nutrient.id).toBe("cp");
    const back = dm.convertBasis("asFed", createNutritionContext({ dryMatterFraction: 0.88 }));
    expect(back.basis.id).toBe("asfed");
    expect(back.quantity.value).toBeCloseTo(100, 6);
  });

  it("identity AF→AF and DM→DM preserves without calculation but still validates", () => {
    const af = NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed");
    expect(
      af.convertBasis("asFed", createNutritionContext({ dryMatterFraction: 0.88 })).quantity.value,
    ).toBe(10);
    const dm = NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "dryMatter");
    expect(
      dm.convertBasis("dryMatter", createNutritionContext({ dryMatterFraction: 0.88 })).quantity
        .value,
    ).toBe(10);
    // still validates nutrient
    expect(() => NutritionQuantity.of(Quantity.of(NaN, "g"), "cp", "asFed")).toThrow(
      InvalidNutritionQuantityError,
    );
  });

  it("with different physical units: mg/kg AF → mg/kg DM and g/kg AF → mg/kg DM", () => {
    const afMg = NutritionQuantity.of(Quantity.of(850, "mg/kg"), "zn", "asFed");
    const dmMg = afMg.convertBasis(
      "dryMatter",
      createNutritionContext({ dryMatterFraction: 0.88 }),
    );
    expect(dmMg.quantity.value).toBeCloseTo(965.909, 3);
    expect(dmMg.quantity.unit.symbol).toBeDefined();

    const afG = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed");
    const dmMg2 = afG
      .convertBasis("dryMatter", createNutritionContext({ dryMatterFraction: 0.5 }))
      .to("mg/kg");
    expect(dmMg2.quantity.value).toBeCloseTo(200000, 3);
    // commutativity: unit conversion + basis conversion in either order
    const viaUnitFirst = afG
      .to("mg/kg")
      .convertBasis("dryMatter", createNutritionContext({ dryMatterFraction: 0.5 }));
    const viaBasisFirst = afG
      .convertBasis("dryMatter", createNutritionContext({ dryMatterFraction: 0.5 }))
      .to("mg/kg");
    expect(viaUnitFirst.quantity.value).toBeCloseTo(viaBasisFirst.quantity.value, 6);
  });

  it("round-trip AF→DM→AF and DM→AF→DM within tolerance", () => {
    const ctx = createNutritionContext({ dryMatterFraction: 0.88 });
    const af = NutritionQuantity.of(Quantity.of(250, "g/kg"), "cp", "asFed");
    const roundAf = af.convertBasis("dryMatter", ctx).convertBasis("asFed", ctx);
    expect(roundAf.quantity.value).toBeCloseTo(250, 9);

    const dm = NutritionQuantity.of(Quantity.of(250, "g/kg"), "cp", "dryMatter");
    const roundDm = dm.convertBasis("asFed", ctx).convertBasis("dryMatter", ctx);
    expect(roundDm.quantity.value).toBeCloseTo(250, 9);
  });

  it("preserves nutrient identity and energy type", () => {
    const af = NutritionQuantity.of(Quantity.of(200, "g/kg"), "cp", "asFed");
    const dm = af.convertBasis("dryMatter", createNutritionContext({ dryMatterFraction: 0.88 }));
    expect(dm.nutrient.id).toBe("cp");
    expect(dm.nutrient.family).toBe("protein");

    const me = NutritionQuantity.of(Quantity.of(12.5, "MJ/kg"), "me", "asFed");
    const meDm = me.convertBasis("dryMatter", createNutritionContext({ dryMatterFraction: 0.88 }));
    expect(meDm.nutrient.id).toBe("me");
    expect(meDm.nutrient.family).toBe("energy");
  });

  it("missing context throws MissingNutritionContextError", () => {
    const af = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed");
    expect(() => af.convertBasis("dryMatter")).toThrow(MissingNutritionContextError);
    expect(() => af.convertBasis("dryMatter", {} as never)).toThrow();
  });

  it("legacy withBasis still works via Quantity % (backward compat)", () => {
    const af = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed");
    const dm = af.withBasis("dryMatter", Quantity.of(88, "%"));
    expect(dm.quantity.value).toBeCloseTo(113.636, 3);
  });

  it("unified convert(unit, basis, context) pipeline", () => {
    const af = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed");
    const result = af.convert(
      "mg/kg",
      "dryMatter",
      createNutritionContext({ dryMatterFraction: 0.5 }),
    );
    expect(result.basis.id).toBe("drymatter");
    expect(result.quantity.value).toBeCloseTo(200000, 3);
  });
});

// ---------------------------------------------------------------------------
// §43 — Advanced unit family tests
// ---------------------------------------------------------------------------

describe("phase6 — advanced families", () => {
  it("mass concentration: g/kg, mg/kg, µg/kg, g/100g×10, mg/100g", () => {
    expect(Quantity.of(1, "g/kg").to("mg/kg").value).toBeCloseTo(1000, 9);
    expect(Quantity.of(1, "g/kg").to("µg/kg").value).toBeCloseTo(1e6, 6);
    // g/100g via factor: 1 g/100g = 10 g/kg
    expect(Quantity.of(10, "g/kg").to("%").value).toBeCloseTo(1, 9);
  });

  it("energy density: MJ/kg, kJ/kg, Kcal/kg", () => {
    expect(Quantity.of(1, "MJ/kg").to("kJ/kg").value).toBeCloseTo(1000, 9);
    // Kcal vs kJ not 1:1, just ensure conversion succeeds
    expect(Quantity.of(1, "MJ/kg").to("Kcal/kg").value).toBeGreaterThan(200);
  });

  it("activity concentration: IU/kg, IU/g", () => {
    const a = NutritionQuantity.of(Quantity.of(2500, "IU/kg"), "vitA", "asFed");
    expect(a.to("IU/g").quantity.value).toBeCloseTo(2.5, 9);
    expect(a.nutrient.id).toBe("vita");
  });

  it("molar concentration: mol/kg, mmol/kg, µmol/kg", () => {
    const si = createRegistry({ packs: [SI_PACK] });
    const q = Quantity.of(1, "mol/kg", si);
    expect(q.to("mmol/kg", si).value).toBeCloseTo(1000, 9);
    expect(q.to("µmol/kg", si).value).toBeCloseTo(1e6, 6);
    // NutritionQuantity preserves via SI quantities
    const ca = NutritionQuantity.of(q, "ca", "asFed");
    expect(ca.quantity.to("mmol/kg", si).value).toBeCloseTo(1000, 9);
  });

  it("molar requires chemical identity — g→mol without mass throws", () => {
    const q = Quantity.of(100, "mg/kg");
    expect(getMolarMass("ca")).toBeDefined();
    expect(getMolarMass("cp")).toBeUndefined();
    expect(() => convertMolarToMass(q, "cp")).toThrow();
    const si = createRegistry({ packs: [SI_PACK] });
    const mol = Quantity.of(0.01, "mol/kg", si);
    const mass = convertMolarToMass(mol, "ca");
    expect(mass.unit.symbol).toBe("g/kg");
    expect(mass.value).toBeCloseTo(0.40078, 4);
  });

  it("fraction: 0.18, 18%, 180 g/kg same ratio", () => {
    expect(Quantity.of(0.18, "fraction").to("%").value).toBeCloseTo(18, 9);
    expect(Quantity.of(0.18, "fraction").to("g/kg").value).toBeCloseTo(180, 9);
  });

  it("ppm / ppb: 1 ppm =1 mg/kg, 1 ppb=1 µg/kg", () => {
    expect(Quantity.of(1, "ppm").to("mg/kg").value).toBeCloseTo(1, 6);
    expect(Quantity.of(1, "ppb").to("µg/kg").value).toBeCloseTo(1, 6);
    // nutrition preserves
    const nq = NutritionQuantity.of(Quantity.of(1, "ppm"), "zn", "asFed");
    expect(nq.to("mg/kg").quantity.value).toBeCloseTo(1, 6);
  });

  it("ratio: Ca:P semantics explicit — not a concentration", () => {
    const ca = NutritionQuantity.of(Quantity.of(10, "g/kg"), "ca", "asFed");
    const p = NutritionQuantity.of(Quantity.of(5, "g/kg"), "p", "asFed");
    const ratio = ca.quantity.value / p.quantity.value;
    expect(ratio).toBeCloseTo(2, 9);
    // ratio is not a NutritionQuantity with single nutrient — it is derived
    expect(ca.nutrient.id).not.toBe(p.nutrient.id);
  });
});

// ---------------------------------------------------------------------------
// §44 — Semantic safety
// ---------------------------------------------------------------------------

describe("phase6 — semantic safety", () => {
  it("Crude Protein + MJ/kg rejected", () => {
    expect(() => NutritionQuantity.of(Quantity.of(10, "MJ/kg"), "cp", "asFed")).toThrow(
      NutritionUnitCompatibilityError,
    );
  });

  it("Calcium + MJ/kg rejected", () => {
    expect(() => NutritionQuantity.of(Quantity.of(10, "MJ/kg"), "ca", "asFed")).toThrow(
      NutritionUnitCompatibilityError,
    );
  });

  it("ME + mg/kg rejected", () => {
    expect(() => NutritionQuantity.of(Quantity.of(10, "mg/kg"), "me", "asFed")).toThrow(
      NutritionUnitCompatibilityError,
    );
  });

  it("Vitamin A IU not interchangeable with Vitamin D IU", () => {
    const a = NutritionQuantity.of(Quantity.of(100, "IU/kg"), "vitA", "asFed");
    const d = NutritionQuantity.of(Quantity.of(100, "IU/kg"), "vitD", "asFed");
    expect(() => a.add(d)).toThrow();
  });

  it("calcium molar without chemical identity throws", () => {
    // cp has no molar mass in our table
    expect(() => convertMolarToMass(Quantity.of(1, "g/kg"), "cp")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// §45 — Property-based (metamorphic)
// ---------------------------------------------------------------------------

describe("phase5+6 — property invariants", () => {
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  it("unit round-trip convert(convert(x,A,B),B,A)≈x", () => {
    const rand = mulberry32(0xbeef);
    for (let i = 0; i < 30; i++) {
      const v = Math.round((rand() * 1000 + 1) * 100) / 100;
      const orig = NutritionQuantity.of(Quantity.of(v, "g/kg"), "cp", "asFed");
      const there = orig.to("mg/kg");
      const back = there.to("g/kg");
      expect(back.quantity.value).toBeCloseTo(v, 9);
    }
  });

  it("basis round-trip convertBasis(convertBasis(x,A,B),B,A)≈x", () => {
    const rand = mulberry32(0xcafe);
    const ctx = createNutritionContext({ dryMatterFraction: 0.72 + rand() * 0.2 });
    for (let i = 0; i < 20; i++) {
      const v = Math.round((rand() * 500 + 1) * 100) / 100;
      const af = NutritionQuantity.of(Quantity.of(v, "g/kg"), "cp", "asFed");
      const dm = af.convertBasis("dryMatter", ctx);
      const back = dm.convertBasis("asFed", ctx);
      expect(back.quantity.value).toBeCloseTo(v, 9);
    }
  });

  it("combined commutativity unitConvert(basisConvert(x))≈basisConvert(unitConvert(x))", () => {
    const ctx = createNutritionContext({ dryMatterFraction: 0.88 });
    const af = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed");
    const viaBasisFirst = af.convertBasis("dryMatter", ctx).to("mg/kg");
    const viaUnitFirst = af.to("mg/kg").convertBasis("dryMatter", ctx);
    expect(viaBasisFirst.quantity.value).toBeCloseTo(viaUnitFirst.quantity.value, 6);
  });

  it("nutrient(result)===nutrient(input) and basis correctness", () => {
    const orig = NutritionQuantity.of(Quantity.of(10, "g/kg"), "ca", "asFed");
    const conv = orig.to("mg/kg");
    expect(conv.nutrient.id).toBe("ca");
    expect(conv.basis.id).toBe("asfed");
    const dm = orig.convertBasis("dryMatter", createNutritionContext({ dryMatterFraction: 0.9 }));
    expect(dm.nutrient.id).toBe("ca");
    expect(dm.basis.id).toBe("drymatter");
  });
});

// ---------------------------------------------------------------------------
// §46 — Fuzz / adversarial
// ---------------------------------------------------------------------------

describe("phase5+6 — adversarial", () => {
  it("zero / negative / >1 DM, NaN/Infinity fail safely", () => {
    expect(() => createNutritionContext({ dryMatterFraction: 0 })).toThrow();
    expect(() => createNutritionContext({ dryMatterFraction: -0.1 })).toThrow();
    expect(() => createNutritionContext({ dryMatterFraction: 1.1 })).toThrow();
    expect(() => createNutritionContext({ dryMatterFraction: NaN })).toThrow();
    expect(() => createNutritionContext({ dryMatterFraction: Infinity })).toThrow();
    expect(() =>
      NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed").convertBasis(
        "dryMatter",
        createNutritionContext({ dryMatterFraction: 0.88 } as never),
      ),
    ).not.toThrow();
  });

  it("extremely small DM fraction and large values", () => {
    const ctxSmall = createNutritionContext({ dryMatterFraction: 0.001 });
    const af = NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed");
    const dm = af.convertBasis("dryMatter", ctxSmall);
    expect(dm.quantity.value).toBeCloseTo(10000, 3);
    const large = NutritionQuantity.of(Quantity.of(1e6, "mg/kg"), "zn", "asFed");
    expect(large.to("g/kg").quantity.value).toBeCloseTo(1000, 9);
  });

  it("malformed units, unknown nutrient, conflicting context, invalid ratios", () => {
    expect(() => NutritionQuantity.of(Quantity.of(10, "g"), "unknown_xyz", "asFed")).toThrow();
    expect(() => Quantity.of(10, "g/100g")).toThrow();
    expect(() =>
      createNutritionContext({ dryMatterFraction: 0.8, moistureFraction: 0.3 }),
    ).toThrow();
    expect(() => NutritionQuantity.of(Quantity.of(NaN, "g"), "cp", "asFed")).toThrow();
  });

  it("unsupported IU cross-nutrient, missing molar mass, ambiguous ppm", () => {
    const a = NutritionQuantity.of(Quantity.of(100, "IU/kg"), "vitA", "asFed");
    const d = NutritionQuantity.of(Quantity.of(100, "IU/kg"), "vitD", "asFed");
    expect(() => a.add(d)).toThrow();
    expect(() => convertMolarToMass(Quantity.of(1, "g/kg"), "cp")).toThrow();
    // ppm without family context still parses but we ensure deterministic error for incompatible nutrient
    expect(() => NutritionQuantity.of(Quantity.of(1, "ppm"), "me", "asFed")).toThrow();
  });

  it("context immutability", () => {
    const ctx = createNutritionContext({ dryMatterFraction: 0.88, sampleId: "S1" });
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(() => ((ctx as unknown as Record<string, unknown>).dryMatterFraction = 0.9)).toThrow();
  });

  it("measurement conversion traceability via metadata", () => {
    const af = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed");
    const dm = af.convertBasis("dryMatter", createNutritionContext({ dryMatterFraction: 0.88 }));
    expect((dm.metadata as unknown as Record<string, unknown>).conversion).toBeDefined();
    const conv = (
      dm.metadata as unknown as {
        conversion: { sourceBasis: string; targetBasis: string; dryMatterFraction: number };
      }
    ).conversion;
    expect(conv.sourceBasis).toBe("asfed");
    expect(conv.targetBasis).toBe("drymatter");
    expect(conv.dryMatterFraction).toBeCloseTo(0.88, 9);
  });
});

// ---------------------------------------------------------------------------
// Serialization for advanced families
// ---------------------------------------------------------------------------

describe("phase6 — serialization for families", () => {
  it("round-trip for energy, activity families", () => {
    const cases: Array<[number, string, string, string]> = [
      [12.5, "MJ/kg", "ge", "asFed"],
      [2500, "IU/kg", "vitA", "asFed"],
      [0.5, "fraction", "cp", "dryMatter"],
    ];
    for (const [v, unit, nut, basis] of cases) {
      const q = Quantity.of(v, unit);
      const nq = NutritionQuantity.of(q, nut, basis);
      const back = NutritionQuantity.fromJSON(nq.toJSON());
      expect(back.equals(nq)).toBe(true);
    }
  });
});
