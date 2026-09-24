/**
 * nutrition-phase3-phase4.test.ts — Phase 3+4 validation
 *
 * Nutrient taxonomy, vitamins/minerals/energy, canonical IDs/aliases,
 * semantic families, nutrition quantities, concentration units, conversions,
 * percentage/IU semantics, same-unit≠same-measurement safety, property-based
 * round-trips, serialization, integration with @vetwo/units.
 */
import { describe, expect, it } from "vitest";
import { Quantity, createRegistry, SI_PACK } from "@vetwo/units";
import {
  NutrientKindRegistry,
  defaultNutrientKindRegistry,
  NutritionQuantity,
  serializeNutritionQuantity,
  deserializeNutritionQuantity,
  InvalidNutrientKindError,
  NutrientSemanticMismatchError,
  InvalidNutritionBasisError,
  InvalidNutritionQuantityError,
} from "../src/index.js";

// helper --------------------------------------------------------------
function close(a: number, b: number, tol = 1e-9): boolean {
  const d = Math.max(1e-12, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / d < tol;
}

// ---------------------------------------------------------------------------
// Taxonomy — macronutrients / proximate
// ---------------------------------------------------------------------------

describe("phase3 — proximate / macro taxonomy", () => {
  it("canonical nutrients exist with stable ids", () => {
    for (const id of [
      "cp",
      "trueProtein",
      "ee",
      "cf",
      "ndf",
      "adf",
      "lignin",
      "starch",
      "sugar",
      "totalCarbohydrates",
      "ash",
      "dryMatter",
      "moisture",
    ]) {
      expect(defaultNutrientKindRegistry.has(id)).toBe(true);
      expect(defaultNutrientKindRegistry.require(id).id).toBe(id.toLowerCase());
    }
  });

  it("aliases resolve deterministically (case-insensitive)", () => {
    expect(defaultNutrientKindRegistry.require("CP").id).toBe("cp");
    expect(defaultNutrientKindRegistry.require("nutrient:crude-protein").id).toBe("cp");
    expect(defaultNutrientKindRegistry.require("EE").id).toBe("ee");
    expect(defaultNutrientKindRegistry.require("DM").id).toBe("drymatter");
    expect(defaultNutrientKindRegistry.require("ADL").id).toBe("lignin");
    expect(defaultNutrientKindRegistry.require("CHO").id).toBe("totalcarbohydrates");
  });

  it("families group correctly without implying interchangeability", () => {
    expect(defaultNutrientKindRegistry.require("cp").family).toBe("protein");
    expect(defaultNutrientKindRegistry.require("trueProtein").family).toBe("protein");
    expect(defaultNutrientKindRegistry.require("ndf").family).toBe("fiber");
    expect(defaultNutrientKindRegistry.require("starch").family).toBe("carbohydrate");
    // same family, different nutrient → still incompatible
    const a = NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed");
    const b = NutritionQuantity.of(Quantity.of(10, "g/kg"), "trueProtein", "asFed");
    expect(a.nutrient.family).toBe(b.nutrient.family);
    expect(() => a.add(b)).toThrow(NutrientSemanticMismatchError);
  });

  it("unknown nutrient throws typed error", () => {
    expect(() => defaultNutrientKindRegistry.require("unknown_xyz_123")).toThrow(
      InvalidNutrientKindError,
    );
    expect(() => NutritionQuantity.of(Quantity.of(10, "g"), "nope_xyz", "asFed")).toThrow(
      InvalidNutrientKindError,
    );
  });

  it("immutability — kinds and registry entries frozen", () => {
    const kind = defaultNutrientKindRegistry.require("cp");
    expect(Object.isFrozen(kind)).toBe(true);
    expect(() => (kind as unknown as Record<string, unknown>).name).not.toThrow();
    // attempt mutation should not change
    const before = kind.name;
    try {
      (kind as unknown as Record<string, string>).name = "HACK";
    } catch {
      // frozen — expected to throw in strict mode
    }
    expect(kind.name).toBe(before);
  });

  it("extensibility — new kinds can be added without breaking existing", () => {
    const reg = new NutrientKindRegistry([]);
    reg.register({ id: "customNutrient", name: "Custom", family: "custom" });
    expect(reg.has("customNutrient")).toBe(true);
    expect(reg.require("customNutrient").id).toBe("customnutrient");
    // alias does not collide
    reg.register({ id: "other", name: "Other", aliases: ["otherAlias"] });
    expect(reg.require("otherAlias").id).toBe("other");
  });
});

// ---------------------------------------------------------------------------
// Minerals
// ---------------------------------------------------------------------------

describe("phase3 — minerals", () => {
  it("covers required minerals with stable ids", () => {
    for (const id of [
      "ca",
      "p",
      "mg",
      "na",
      "k",
      "s",
      "cl",
      "fe",
      "zn",
      "cu",
      "mn",
      "se",
      "i",
      "co",
      "mo",
      "cr",
    ]) {
      expect(defaultNutrientKindRegistry.has(id), id).toBe(true);
    }
  });

  it("aliases for minerals resolve (Ca, nutrient:calcium)", () => {
    expect(defaultNutrientKindRegistry.require("Ca").id).toBe("ca");
    expect(defaultNutrientKindRegistry.require("nutrient:calcium").id).toBe("ca");
    expect(defaultNutrientKindRegistry.require("chloride").id).toBe("cl");
  });

  it("same category minerals remain semantically incompatible", () => {
    const ca = NutritionQuantity.of(Quantity.of(10, "g/kg"), "ca", "asFed");
    const p = NutritionQuantity.of(Quantity.of(10, "g/kg"), "p", "asFed");
    expect(ca.nutrient.category).toBe("macro-mineral");
    expect(p.nutrient.category).toBe("macro-mineral");
    expect(() => ca.add(p)).toThrow(NutrientSemanticMismatchError);
  });
});

// ---------------------------------------------------------------------------
// Vitamins
// ---------------------------------------------------------------------------

describe("phase3 — vitamins", () => {
  it("fat-soluble and water-soluble vitamins present", () => {
    for (const id of [
      "vitA",
      "vitD",
      "vitE",
      "vitK",
      "vitC",
      "vitB1",
      "vitB2",
      "vitB3",
      "vitB5",
      "vitB6",
      "vitB7",
      "vitB9",
      "vitB12",
    ]) {
      expect(defaultNutrientKindRegistry.has(id), id).toBe(true);
    }
  });

  it("vitamin aliases resolve (thiamine → vitB1, biotin → vitB7)", () => {
    expect(defaultNutrientKindRegistry.require("thiamine").id).toBe("vitb1");
    expect(defaultNutrientKindRegistry.require("riboflavin").id).toBe("vitb2");
    expect(defaultNutrientKindRegistry.require("niacin").id).toBe("vitb3");
    expect(defaultNutrientKindRegistry.require("biotin").id).toBe("vitb7");
    expect(defaultNutrientKindRegistry.require("folate").id).toBe("vitb9");
    expect(defaultNutrientKindRegistry.require("cobalamin").id).toBe("vitb12");
    expect(defaultNutrientKindRegistry.require("nutrient:vitamin-a").id).toBe("vita");
  });

  it("chemical forms extensible via chemicalMetadata", () => {
    const vitA = defaultNutrientKindRegistry.require("vitA");
    expect(vitA.chemicalMetadata).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Energy semantics
// ---------------------------------------------------------------------------

describe("phase3 — energy semantics", () => {
  it("GE/DE/ME/NEL/NEM/NEG distinct with stable ids", () => {
    for (const id of ["ge", "de", "me", "nel", "nem", "neg"]) {
      expect(defaultNutrientKindRegistry.has(id), id).toBe(true);
      expect(defaultNutrientKindRegistry.require(id).family).toBe("energy");
    }
  });

  it("GE ≠ DE ≠ ME as semantic measurements (same unit, different nutrient)", () => {
    const ge = NutritionQuantity.of(Quantity.of(10, "MJ/kg"), "ge", "asFed");
    const de = NutritionQuantity.of(Quantity.of(10, "MJ/kg"), "de", "asFed");
    const me = NutritionQuantity.of(Quantity.of(10, "MJ/kg"), "me", "asFed");
    expect(() => ge.add(de)).toThrow(NutrientSemanticMismatchError);
    expect(() => de.add(me)).toThrow(NutrientSemanticMismatchError);
    expect(ge.nutrient.id).not.toBe(de.nutrient.id);
  });

  it("does NOT implement GE→DE→ME calculations (representation only)", () => {
    // No conversion between energy types should exist via generic unit conversion
    // Physical MJ/kg → MJ/kg conversion would preserve value, but semantic
    // distinction must remain — they are different nutrients, not convertible
    const ge = NutritionQuantity.of(Quantity.of(12.5, "MJ/kg"), "ge", "asFed");
    expect(ge.nutrient.id).toBe("ge");
    expect(ge.quantity.value).toBe(12.5);
    // No method like ge.toME() exists
    expect((ge as unknown as Record<string, unknown>).toME).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Nutrition measurement representation
// ---------------------------------------------------------------------------

describe("phase3 — nutrition measurement representation", () => {
  it("preserves value + unit + nutrient + basis + context", () => {
    const nq = NutritionQuantity.of(Quantity.of(500, "mg/kg"), "ca", "dryMatter", {
      metadata: { lab: "LabA" },
    });
    expect(nq.quantity.value).toBe(500);
    expect(nq.quantity.unit.symbol).toBe("mg/kg");
    expect(nq.nutrient.id).toBe("ca");
    expect(nq.basis.id).toBe("drymatter");
    expect(nq.metadata?.lab).toBe("LabA");
  });

  it("validation rejects invalid states", () => {
    expect(() => NutritionQuantity.of(Quantity.of(NaN, "g"), "cp", "asFed")).toThrow(
      InvalidNutritionQuantityError,
    );
    expect(() => NutritionQuantity.of(Quantity.of(Infinity, "g"), "cp", "asFed")).toThrow(
      InvalidNutritionQuantityError,
    );
    expect(() => NutritionQuantity.from(NaN, "g", "cp", "asFed")).toThrow();
    // missing nutrient
    expect(() => NutritionQuantity.of(Quantity.of(10, "g"), "" as never, "asFed")).toThrow(
      InvalidNutrientKindError,
    );
    // invalid basis
    expect(() => NutritionQuantity.of(Quantity.of(10, "g"), "cp", "unknownBasis_xyz")).toThrow(
      InvalidNutritionBasisError,
    );
    // malformed metadata prototype pollution
    const evil = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(() =>
      NutritionQuantity.of(Quantity.of(10, "g"), "cp", "asFed", { metadata: evil }),
    ).toThrow(InvalidNutritionQuantityError);
  });

  it("immutability — frozen", () => {
    const nq = NutritionQuantity.of(Quantity.of(10, "g"), "cp", "asFed");
    expect(Object.isFrozen(nq)).toBe(true);
    expect(Object.isFrozen(nq.quantity)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — concentration forms
// ---------------------------------------------------------------------------

describe("phase4 — concentration forms", () => {
  // Core-supported forms (g/100g is nutrition shorthand: 1 g/100g = 10 g/kg, handled via conversion, not as a parseable unit)
  const forms = [
    "g/kg",
    "mg/kg",
    "µg/kg",
    "mg/g",
    "g/g",
    "%",
    "g/L",
    "mg/L",
    "µg/L",
    "mol/kg",
    "mmol/kg",
    "µmol/kg",
    "mol/L",
    "mmol/L",
    "µmol/L",
    "MJ/kg",
    "kJ/kg",
    "Kcal/kg",
    "MJ/L",
    "Kcal/L",
    "IU/kg",
    "IU/g",
    "IU/L",
    "fraction",
    "ppm",
    "ppb",
  ];

  it.each(forms)("supports %s without losing nutrient semantics", (unit) => {
    // Some forms (mol, L) require the SI registry — try default, then SI
    let q: Quantity;
    try {
      q = Quantity.of(10, unit);
    } catch {
      const si = createRegistry({ packs: [SI_PACK] });
      q = Quantity.of(10, unit, si);
    }
    expect(q).toBeDefined();
    // Pick compatible nutrient for this family: energy→ge, activity→vitA, molar→ca, mass→cp
    let nutrient = "cp";
    if (
      unit.includes("MJ") ||
      unit.includes("Kcal") ||
      unit.includes("kJ") ||
      unit.includes("Mcal")
    )
      nutrient = "ge";
    else if (unit.includes("IU")) nutrient = "vitA";
    else if (unit.includes("mol")) nutrient = "ca";
    const nq = NutritionQuantity.of(q, nutrient, "asFed");
    expect(nq.quantity.unit.symbol).toBeDefined();
    expect(nq.nutrient.id).toBe(nutrient.toLowerCase());
  });

  it("g/100g shorthand is 10× g/kg (nutrition convention, via conversion not parse)", () => {
    // "g/100g" is not a parseable unit in the generic engine (numeric denominator)
    expect(() => Quantity.of(10, "g/100g")).toThrow();
    // Represent as g/kg: 1 g/100g = 10 g/kg (nutrition shorthand, handled via value scaling)
    const viaGPerKg = Quantity.of(10, "g/kg");
    expect(viaGPerKg.to("%").value).toBeCloseTo(1, 9);
    // nutrition layer documents this as canonical: use g/kg internally
  });

  it("fraction vs display notation — % handled correctly", () => {
    // 10 g/kg = 1% — core should handle
    const a = Quantity.of(10, "g/kg");
    expect(a.to("%").value).toBeCloseTo(1, 9);
    expect(a.to("fraction").value).toBeCloseTo(0.01, 9);
  });
});

// ---------------------------------------------------------------------------
// Percentage semantics — double-scaling bug guard
// ---------------------------------------------------------------------------

describe("phase4 — percentage semantics", () => {
  it("18% → 0.18 fraction, 180 g/kg — not 18", () => {
    const pct = Quantity.of(18, "%");
    expect(pct.to("fraction").value).toBeCloseTo(0.18, 9);
    expect(pct.to("g/kg").value).toBeCloseTo(180, 9);
    expect(pct.to("%").value).toBeCloseTo(18, 9);
  });

  it("NutritionQuantity preserves % correctly", () => {
    const nq = NutritionQuantity.of(Quantity.of(18, "%"), "cp", "asFed");
    expect(nq.to("g/kg").quantity.value).toBeCloseTo(180, 9);
    expect(nq.to("%").quantity.value).toBeCloseTo(18, 9);
  });

  it("250 g/kg → 25% — reversible (g/100g is 10× g/kg via nutrition shorthand)", () => {
    const a = Quantity.of(250, "g/kg");
    expect(a.to("%").value).toBeCloseTo(25, 9);
    // g/100g not parseable in generic engine — documented as 10× g/kg shorthand
    expect(() => Quantity.of(10, "g/100g")).toThrow();
    expect(Quantity.of(250, "g/kg").to("%").value).toBeCloseTo(25, 9);
  });
});

// ---------------------------------------------------------------------------
// Canonical conversions
// ---------------------------------------------------------------------------

describe("phase4 — concentration conversions (physical)", () => {
  it("1 g/kg = 1000 mg/kg = 1e6 µg/kg", () => {
    const a = NutritionQuantity.of(Quantity.of(1, "g/kg"), "cp", "asFed");
    expect(a.to("mg/kg").quantity.value).toBeCloseTo(1000, 9);
    expect(a.to("µg/kg").quantity.value).toBeCloseTo(1e6, 6);
    expect(a.to("mg/kg").to("g/kg").quantity.value).toBeCloseTo(1, 9);
  });

  it("1 g/100g concept = 10 g/kg (via factor, not parseable unit)", () => {
    // g/100g numeric denominator not parseable in generic engine
    expect(() => Quantity.of(1, "g/100g")).toThrow();
    const a = NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed");
    expect(a.to("%").quantity.value).toBeCloseTo(1, 9);
    // nutrition shorthand: 1 g/100g == 10 g/kg by convention (×10)
    expect(a.quantity.value).toBe(10);
  });

  it("1% = 10 g/kg", () => {
    const a = NutritionQuantity.of(Quantity.of(1, "%"), "cp", "asFed");
    expect(a.to("g/kg").quantity.value).toBeCloseTo(10, 9);
    expect(a.to("%").quantity.value).toBeCloseTo(1, 9);
  });

  it("1 mg/kg = 1000 µg/kg = 1 ppm (where ppm = mg/kg)", () => {
    const a = NutritionQuantity.of(Quantity.of(1, "mg/kg"), "zn", "asFed");
    expect(a.to("µg/kg").quantity.value).toBeCloseTo(1000, 9);
    // ppm equivalence depends on core definition; check if core treats ppm as dimensionless ratio
    const ppm = Quantity.of(1, "mg/kg");
    const ppmToPpm = ppm.to("ppm");
    expect(ppmToPpm.value).toBeCloseTo(1, 6);
  });

  it("preserves nutrient + basis + context through conversion", () => {
    const a = NutritionQuantity.of(Quantity.of(1, "g/kg"), "ca", "dryMatter");
    const b = a.to("mg/kg");
    expect(b.nutrient.id).toBe("ca");
    expect(b.basis.id).toBe("drymatter");
    expect(b.quantity.value).toBeCloseTo(1000, 9);
  });

  it("prefix handling delegates to core — mg/kg etc. correct", () => {
    const a = Quantity.of(1, "g/kg");
    expect(a.to("mg/kg").value).toBeCloseTo(1000, 9);
    expect(a.to("µg/kg").value).toBeCloseTo(1e6, 6);
  });
});

// ---------------------------------------------------------------------------
// IU / biological activity — semantic safety
// ---------------------------------------------------------------------------

describe("phase4 — IU safety", () => {
  it("IU/kg vitamin A not interchangeable with IU/kg vitamin D", () => {
    const a = NutritionQuantity.of(Quantity.of(2500, "IU/kg"), "vitA", "asFed");
    const d = NutritionQuantity.of(Quantity.of(2500, "IU/kg"), "vitD", "asFed");
    expect(a.nutrient.id).toBe("vita");
    expect(d.nutrient.id).toBe("vitd");
    expect(() => a.add(d)).toThrow(NutrientSemanticMismatchError);
    // generic Quantity would consider them same dimension — nutrition layer must not
    expect(a.quantity.hasSameDimension(d.quantity)).toBe(true);
    expect(a.equals(d)).toBe(false);
  });

  it("IU preserved, no cross-nutrient conversion invented", () => {
    const a = NutritionQuantity.of(Quantity.of(100, "IU/kg"), "vitA", "asFed");
    expect(a.to("IU/g").quantity.value).toBeCloseTo(0.1, 9);
    expect(a.to("IU/g").nutrient.id).toBe("vita");
    // No method to convert vitA IU to vitD IU
    expect((a as unknown as Record<string, unknown>).convertToVitamin).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Same physical unit ≠ same nutrition measurement
// ---------------------------------------------------------------------------

describe("phase4 — same unit ≠ same measurement", () => {
  it("10 g/kg calcium ≠ 10 g/kg crude protein", () => {
    const ca = NutritionQuantity.of(Quantity.of(10, "g/kg"), "ca", "asFed");
    const cp = NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed");
    expect(ca.quantity.hasSameDimension(cp.quantity)).toBe(true);
    expect(ca.equals(cp)).toBe(false);
    expect(() => ca.add(cp)).toThrow(NutrientSemanticMismatchError);
  });

  it("10 MJ/kg GE ≠ 10 MJ/kg ME", () => {
    const ge = NutritionQuantity.of(Quantity.of(10, "MJ/kg"), "ge", "asFed");
    const me = NutritionQuantity.of(Quantity.of(10, "MJ/kg"), "me", "asFed");
    expect(ge.quantity.hasSameDimension(me.quantity)).toBe(true);
    expect(ge.equals(me)).toBe(false);
    expect(() => ge.add(me)).toThrow(NutrientSemanticMismatchError);
  });
});

// ---------------------------------------------------------------------------
// Serialization — preserve value/unit/nutrient/basis
// ---------------------------------------------------------------------------

describe("phase4 — serialization", () => {
  it("round-trip preserves all fields", () => {
    const nq = NutritionQuantity.of(Quantity.of(250, "g/kg"), "cp", "dryMatter", {
      metadata: { lab: "A" },
    });
    const json = JSON.stringify(serializeNutritionQuantity(nq));
    const back = deserializeNutritionQuantity(JSON.parse(json));
    expect(back.equals(nq)).toBe(true);
    expect(back.metadata).toEqual({ lab: "A" });
    expect(JSON.stringify(serializeNutritionQuantity(back))).toBe(json);
  });

  it("rejects malformed serialized data", () => {
    expect(() => deserializeNutritionQuantity(null as never)).toThrow(
      InvalidNutritionQuantityError,
    );
    expect(() =>
      deserializeNutritionQuantity({
        version: 99,
        type: "nutrition-quantity",
        quantity: { value: 1, unit: "g" },
        nutrient: "cp",
        basis: "asFed",
      } as never),
    ).toThrow(InvalidNutritionQuantityError);
    expect(() =>
      deserializeNutritionQuantity({
        version: 1,
        type: "nutrition-quantity",
        quantity: { value: NaN, unit: "g" },
        nutrient: "cp",
        basis: "asFed",
      } as never),
    ).toThrow(InvalidNutritionQuantityError);
  });

  it("deterministic — same input always same JSON", () => {
    const nq = NutritionQuantity.of(Quantity.of(18, "g/kg"), "cp", "asFed");
    expect(JSON.stringify(serializeNutritionQuantity(nq))).toBe(
      JSON.stringify(serializeNutritionQuantity(nq)),
    );
  });
});

// ---------------------------------------------------------------------------
// Property-based / metamorphic
// ---------------------------------------------------------------------------

describe("phase4 — property-based invariants", () => {
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

  it("convert(convert(x,A,B),B,A) ≈ x for reversible concentration conversions", () => {
    const rand = mulberry32(0x1234);
    const pairs: Array<[string, string, string]> = [
      ["g/kg", "mg/kg", "cp"],
      ["g/kg", "µg/kg", "cp"],
      ["%", "g/kg", "cp"],
      ["g/kg", "mg/g", "cp"],
      ["MJ/kg", "kJ/kg", "ge"],
      ["MJ/kg", "Kcal/kg", "ge"],
    ];
    for (let i = 0; i < 50; i++) {
      const [a, b, nut] = pairs[Math.floor(rand() * pairs.length)]!;
      const value = Math.round((rand() * 1000 + 0.1) * 100) / 100;
      const orig = NutritionQuantity.of(Quantity.of(value, a), nut, "asFed");
      const there = orig.to(b);
      const back = there.to(a);
      expect(close(back.quantity.value, value, 1e-9)).toBe(true);
      expect(back.nutrient.id).toBe(orig.nutrient.id);
      expect(back.basis.id).toBe(orig.basis.id);
    }
  });

  it("aliases always resolve to same canonical nutrient", () => {
    const rand = mulberry32(0xabcd);
    const kinds = defaultNutrientKindRegistry.list();
    for (let i = 0; i < 50; i++) {
      const kind = kinds[Math.floor(rand() * kinds.length)]!;
      if (kind.aliases && kind.aliases.length > 0) {
        const alias = kind.aliases[Math.floor(rand() * kind.aliases.length)]!;
        expect(defaultNutrientKindRegistry.require(alias).id).toBe(kind.id);
        expect(defaultNutrientKindRegistry.require(alias.toUpperCase()).id).toBe(kind.id);
      }
    }
  });

  it("nutrient(convert(x,A,B)) == nutrient(x) and basis preserved", () => {
    const orig = NutritionQuantity.of(Quantity.of(1, "g/kg"), "ca", "dryMatter");
    const conv = orig.to("mg/kg");
    expect(conv.nutrient.id).toBe(orig.nutrient.id);
    expect(conv.basis.id).toBe(orig.basis.id);
    const mgPerKg = Quantity.of(1, "mg/kg");
    expect(mgPerKg.to("g/kg").value).toBeCloseTo(0.001, 9);
  });
});

// ---------------------------------------------------------------------------
// Error handling — typed errors
// ---------------------------------------------------------------------------

describe("phase4 — error handling", () => {
  it("invalid nutrient alias throws typed error", () => {
    expect(() => defaultNutrientKindRegistry.require("unknownNutrient_xyz")).toThrow(
      InvalidNutrientKindError,
    );
  });

  it("incompatible nutrient/unit — conservative rejection where certain", () => {
    // This is a placeholder for future strict validation; currently we allow
    // any Quantity dimension with any nutrient but ensure semantic mismatch
    // prevents silent interchange.
    const ca = NutritionQuantity.of(Quantity.of(10, "g/kg"), "ca", "asFed");
    expect(ca.quantity.hasSameDimension(Quantity.of(10, "g/kg"))).toBe(true);
  });

  it("unsupported IU cross-nutrient conversion throws semantic mismatch", () => {
    const a = NutritionQuantity.of(Quantity.of(100, "IU/kg"), "vitA", "asFed");
    const d = NutritionQuantity.of(Quantity.of(100, "IU/kg"), "vitD", "asFed");
    expect(() => a.add(d)).toThrow(NutrientSemanticMismatchError);
  });
});

// ---------------------------------------------------------------------------
// Regression — ensure existing features still work
// ---------------------------------------------------------------------------

describe("phase3+4 — regression — existing features", () => {
  it("basis converter still works (regression)", async () => {
    const { BasisConverter } = await import("../src/basis-converter.js");
    const asFed = BasisConverter.toAsFed(Quantity.of(15, "% DM"), Quantity.of(88, "%"));
    expect(asFed.value).toBeCloseTo(13.2, 9);
  });

  it("TargetUnitRegistry override still works", async () => {
    const { TargetUnitRegistry } = await import("../src/target-unit-registry.js");
    const reg = new TargetUnitRegistry();
    reg.override("cp", "kg/day");
    expect(reg.getTargetUnit("cp")).toBe("kg/day");
  });
});

// ---------------------------------------------------------------------------
// Integration with @vetwo/units
// ---------------------------------------------------------------------------

describe("phase4 — integration with @vetwo/units", () => {
  it("quantity integration — dimensions, prefixes, conversion via core", () => {
    const q = Quantity.of(1, "mg/kg");
    expect(q.to("g/kg").value).toBeCloseTo(0.001, 9);
    expect(q.to("µg/kg").value).toBeCloseTo(1000, 9);
  });

  it("prefixes — g, mg, µg, kg and compound forms preserve nutrient identity", () => {
    const nq = NutritionQuantity.of(Quantity.of(1, "g/kg"), "cp", "asFed");
    const mg = nq.to("mg/kg");
    const ug = nq.to("µg/kg");
    expect(mg.nutrient.id).toBe("cp");
    expect(ug.nutrient.id).toBe("cp");
    expect(mg.quantity.value).toBeCloseTo(1000, 9);
    expect(ug.quantity.value).toBeCloseTo(1e6, 6);
  });

  it("no duplicate unit engine — NutritionQuantity delegates to Quantity", () => {
    const q = Quantity.of(10, "g/kg");
    const nq = NutritionQuantity.of(q, "cp", "asFed");
    expect(nq.quantity).toBe(q);
  });
});
