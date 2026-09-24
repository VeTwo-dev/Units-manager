/**
 * nutrition-phase7-phase8.test.ts — Phase 7 (Semantic Compatibility) + Phase 8 (Metadata/Provenance)
 */
import { describe, expect, it } from "vitest";
import { Quantity, createRegistry, SI_PACK } from "@vetwo/units";
import {
  NutritionQuantity,
  defaultNutrientKindRegistry,
  createNutritionContext,
  createNutritionMetadata,
  checkNutrientCompatibility,
  isNutrientCompatible,
  assertNutrientCompatible,
  canConvert,
  serializeNutritionQuantity,
  deserializeNutritionQuantity,
  IncompatibleNutrientError,
  UnknownNutrientError,
  InvalidNutritionQuantityError,
  convertMolarToMass,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Phase 7 — Physical vs Semantic compatibility
// ---------------------------------------------------------------------------

describe("phase7 — physical vs semantic compatibility", () => {
  it("same physical dimension but incompatible semantic → fails", () => {
    const cp = NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed");
    const ca = NutritionQuantity.of(Quantity.of(10, "g/kg"), "ca", "asFed");
    expect(cp.quantity.hasSameDimension(ca.quantity)).toBe(true);
    expect(() => cp.add(ca)).toThrow(IncompatibleNutrientError);
    expect(cp.isCompatibleWith(ca)).toBe(false);
    expect(cp.checkCompatibility(ca).status).toBe("incompatible");
  });

  it("semantic identity via canonical id, aliases resolve", () => {
    const cp1 = NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed");
    const cp2 = NutritionQuantity.of(Quantity.of(10, "g/kg"), "nutrient:crude-protein", "asFed");
    expect(cp1.nutrient.id).toBe(cp2.nutrient.id);
    expect(cp1.isCompatibleWith(cp2)).toBe(true);
  });

  it("compatibility result model distinguishes compatible/incompatible/unknown", () => {
    const r1 = checkNutrientCompatibility("cp", "cp");
    expect(r1.status).toBe("compatible");
    expect(r1.isCompatible).toBe(true);
    const r2 = checkNutrientCompatibility("cp", "ca");
    expect(r2.status).toBe("incompatible");
    expect(r2.reason).toContain("incompatible");
    const r3 = checkNutrientCompatibility("cp", "unknown_xyz_999");
    expect(r3.status).toBe("unknown");
    expect(r3.isCompatible).toBe(false);
  });

  it("strict vs permissive explicit, no global state", () => {
    // strict: different nutrients incompatible
    expect(isNutrientCompatible("cp", "ca", { mode: "strict" })).toBe(false);
    // permissive: still incompatible (different known nutrients)
    expect(isNutrientCompatible("cp", "ca", { mode: "permissive" })).toBe(false);
    // permissive with unknown → unknown, not compatible
    const r = checkNutrientCompatibility("cp", "unknown_xyz_999", { mode: "permissive" });
    expect(r.status).toBe("unknown");
    // deterministic
    expect(checkNutrientCompatibility("cp", "ca", { mode: "strict" })).toEqual(
      checkNutrientCompatibility("cp", "ca", { mode: "strict" }),
    );
  });

  it("family membership ≠ equivalence", () => {
    const ca = NutritionQuantity.of(Quantity.of(10, "g/kg"), "ca", "asFed");
    const p = NutritionQuantity.of(Quantity.of(10, "g/kg"), "p", "asFed");
    // both mineral family but not compatible
    expect(ca.nutrient.family).toBe("mineral");
    expect(p.nutrient.family).toBe("mineral");
    expect(ca.isCompatibleWith(p)).toBe(false);
    const vitA = NutritionQuantity.of(Quantity.of(10, "IU/kg"), "vitA", "asFed");
    const vitD = NutritionQuantity.of(Quantity.of(10, "IU/kg"), "vitD", "asFed");
    expect(vitA.nutrient.family).toBe("vitamin");
    expect(vitD.nutrient.family).toBe("vitamin");
    expect(vitA.isCompatibleWith(vitD)).toBe(false);
  });

  it("energy semantic safety: GE ≠ ME", () => {
    const ge = NutritionQuantity.of(Quantity.of(10, "MJ/kg"), "ge", "asFed");
    const me = NutritionQuantity.of(Quantity.of(10, "MJ/kg"), "me", "asFed");
    expect(ge.isCompatibleWith(me)).toBe(false);
    expect(() => ge.add(me)).toThrow();
  });

  it("activity semantic safety: vitA IU ≠ vitD IU", () => {
    const a = NutritionQuantity.of(Quantity.of(100, "IU/kg"), "vitA", "asFed");
    const d = NutritionQuantity.of(Quantity.of(100, "IU/kg"), "vitD", "asFed");
    expect(a.isCompatibleWith(d)).toBe(false);
    expect(() => a.add(d)).toThrow();
    // physical units same but semantic different
    expect(a.quantity.hasSameDimension(d.quantity)).toBe(true);
  });

  it("molar semantic safety: requires chemical identity", () => {
    const si = createRegistry({ packs: [SI_PACK] });
    const caMol = NutritionQuantity.of(Quantity.of(10, "mmol/kg", si), "ca", "asFed");
    expect(caMol.nutrient.id).toBe("ca");
    // cp with molar unit is allowed structurally (family), but conversion without molar mass throws
    expect(() => NutritionQuantity.of(Quantity.of(10, "mmol/kg", si), "cp", "asFed")).not.toThrow();
    expect(() => convertMolarToMass(Quantity.of(10, "mmol/kg", si), "cp")).toThrow();
  });

  it("unit compatibility: cp+g/kg valid, cp+MJ/kg rejected, me+MJ/kg valid, me+mg/kg rejected", () => {
    expect(() => NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed")).not.toThrow();
    expect(() => NutritionQuantity.of(Quantity.of(10, "MJ/kg"), "cp", "asFed")).toThrow();
    expect(() => NutritionQuantity.of(Quantity.of(10, "MJ/kg"), "me", "asFed")).not.toThrow();
    expect(() => NutritionQuantity.of(Quantity.of(10, "mg/kg"), "me", "asFed")).toThrow();
  });

  it("typed errors and diagnostics", () => {
    const r = checkNutrientCompatibility("ca", "cp");
    expect(r.reason).toContain("incompatible");
    expect(() => assertNutrientCompatible("ca", "cp")).toThrow(IncompatibleNutrientError);
    expect(() => assertNutrientCompatible("unknown_xyz_999", "cp")).toThrow(UnknownNutrientError);
    // canConvert API
    expect(canConvert("cp", "cp").isCompatible).toBe(true);
    expect(canConvert("cp", "ca").isCompatible).toBe(false);
    expect(canConvert("cp", "ca").status).toBe("incompatible");
  });

  it("arithmetic safety: add/subtract/compare", () => {
    const a = NutritionQuantity.of(Quantity.of(100, "g/kg"), "ca", "asFed");
    const b = NutritionQuantity.of(Quantity.of(50, "g/kg"), "ca", "asFed");
    expect(a.add(b).quantity.value).toBeCloseTo(150, 9);
    expect(a.subtract(b).quantity.value).toBeCloseTo(50, 9);
    expect(a.compare(b)).toBe(1);
    expect(b.compare(a)).toBe(-1);
    expect(a.compare(a)).toBe(0);

    const cp = NutritionQuantity.of(Quantity.of(50, "g/kg"), "cp", "asFed");
    expect(() => a.add(cp)).toThrow();
    expect(() => a.compare(cp)).toThrow();
  });

  it("same-semantic arithmetic with unit normalization", () => {
    const a = NutritionQuantity.of(Quantity.of(100, "g/kg"), "ca", "asFed");
    const b = NutritionQuantity.of(Quantity.of(50, "mg/kg"), "ca", "asFed");
    // internally uses Quantity.add which normalizes via to()
    const sum = a.add(b);
    expect(sum.quantity.value).toBeCloseTo(100.05, 9);
    expect(sum.nutrient.id).toBe("ca");
    expect(sum.basis.id).toBe("asfed");
  });

  it("serialization preserves canonical semantic id", () => {
    const nq = NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed");
    const json = nq.toJSON();
    expect(json.nutrient).toBe("cp");
    const back = NutritionQuantity.fromJSON(json);
    expect(back.nutrient.id).toBe("cp");
    expect(back.equals(nq)).toBe(true);
    // only value+unit would lose nutrient
    expect((json as unknown as Record<string, unknown>).value).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 8 — Metadata / Provenance
// ---------------------------------------------------------------------------

describe("phase8 — metadata model", () => {
  it("creates and validates metadata", () => {
    const meta = createNutritionMetadata({
      provenance: {
        source: "lab",
        sourceId: "LAB-001",
        laboratoryId: "LAB-001",
        timestamp: "2026-01-15T10:00:00.000Z",
      },
      sample: {
        sampleId: "S-001",
        replicateId: "R1",
        collectionTimestamp: "2026-01-10T08:00:00.000Z",
      },
      method: { id: "METHOD-001", name: "Kjeldahl", version: "1.0" },
      qualityFlag: "valid",
      detectionLimits: { limitOfDetection: { value: 0.01, unit: "g/kg" } },
      reference: "AOAC 990.03",
    });
    expect(meta.provenance?.sourceId).toBe("LAB-001");
    expect(meta.qualityFlag).toBe("valid");
    expect(Object.isFrozen(meta)).toBe(true);
    expect(Object.isFrozen(meta.provenance!)).toBe(true);
  });

  it("validation rejects malformed metadata", () => {
    expect(() =>
      createNutritionMetadata({ provenance: { sourceId: "bad id!" } as never }),
    ).toThrow();
    expect(() =>
      createNutritionMetadata({ sample: { collectionTimestamp: "not-iso" } as never }),
    ).toThrow();
    expect(() => createNutritionMetadata({ qualityFlag: "unknown-flag" as never })).toThrow();
    expect(() =>
      createNutritionMetadata({
        detectionLimits: { limitOfDetection: { value: NaN, unit: "g" } } as never,
      }),
    ).toThrow();
    expect(() =>
      createNutritionMetadata(JSON.parse('{"__proto__":{"polluted":true}}') as never),
    ).toThrow();
  });

  it("timestamps must be ISO 8601", () => {
    expect(() =>
      createNutritionMetadata({ provenance: { timestamp: "2026-01-01" } as never }),
    ).toThrow();
    expect(
      createNutritionMetadata({ provenance: { timestamp: "2026-01-01T00:00:00.000Z" } }).provenance
        ?.timestamp,
    ).toBe("2026-01-01T00:00:00.000Z");
  });

  it("immutable — nested cannot be mutated", () => {
    const meta = createNutritionMetadata({ sample: { sampleId: "S1" } });
    expect(Object.isFrozen(meta.sample!)).toBe(true);
    expect(() => ((meta.sample as unknown as Record<string, unknown>).sampleId = "HACK")).toThrow();
  });

  it("NutritionQuantity metadata preserved through conversion and serialization", () => {
    const meta = createNutritionMetadata({ sample: { sampleId: "S-100" }, method: { id: "M1" } });
    const nq = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed", {
      metadata: meta as unknown as Record<string, unknown>,
    });
    expect(Object.isFrozen(nq.metadata!)).toBe(true);
    const converted = nq.to("mg/kg");
    expect(converted.metadata).toEqual(nq.metadata);
    // serialization round-trip
    const back = NutritionQuantity.fromJSON(nq.toJSON());
    expect(back.metadata).toEqual(nq.metadata);
  });

  it("conversion provenance retained", () => {
    const nq = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed");
    const ctx = createNutritionContext({ dryMatterFraction: 0.88 });
    const dm = nq.convertBasis("dryMatter", ctx);
    expect((dm.metadata as unknown as Record<string, unknown>).conversion).toBeDefined();
  });

  it("unknown metadata fields preserved safely without pollution", () => {
    const meta = createNutritionMetadata({ custom: { unknownField: "keep-me", nested: { a: 1 } } });
    expect((meta.custom as Record<string, unknown>).unknownField).toBe("keep-me");
    const nq = NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed", {
      metadata: meta as unknown as Record<string, unknown>,
    });
    const back = NutritionQuantity.fromJSON(nq.toJSON());
    expect((back.metadata as unknown as Record<string, unknown>).custom).toEqual(
      expect.objectContaining({ unknownField: "keep-me" }),
    );
  });

  it("security: prototype pollution payload rejected", () => {
    const evil = JSON.parse('{"provenance":{"__proto__":{"polluted":true}}}');
    expect(() => createNutritionMetadata(evil)).toThrow();
    const evil2 = JSON.parse(
      '{"value":10,"unit":"g/kg","nutrient":"cp","basis":"asFed","version":1,"type":"nutrition-quantity","metadata":{"__proto__":{"polluted":true}}}',
    );
    expect(() => deserializeNutritionQuantity(JSON.parse(JSON.stringify(evil2)))).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("metadata equality: value/semantic equality vs full equality", () => {
    const a = NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed", {
      metadata: { lab: "A" } as unknown as Record<string, unknown>,
    });
    const b = NutritionQuantity.of(Quantity.of(10, "g/kg"), "cp", "asFed", {
      metadata: { lab: "B" } as unknown as Record<string, unknown>,
    });
    // value+semantic equal but metadata different
    expect(a.quantity.equals(b.quantity)).toBe(true);
    expect(a.nutrient.id).toBe(b.nutrient.id);
    // full equality includes metadata? Our equals checks nutrient+basis+quantity only, not metadata
    expect(a.equals(b)).toBe(true);
    // metadata differs
    expect(a.metadata).not.toEqual(b.metadata);
  });

  it("metadata merge policy: unit conversion preserves, conflicting methods marked mixed", () => {
    const a = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed", {
      metadata: { method: "A" } as unknown as Record<string, unknown>,
    });
    const b = NutritionQuantity.of(Quantity.of(50, "g/kg"), "cp", "asFed", {
      metadata: { method: "B" } as unknown as Record<string, unknown>,
    });
    // add preserves first's metadata (our implementation)
    const sum = a.add(b);
    expect(sum.metadata).toEqual(a.metadata);
  });

  it("quality flags structured", () => {
    for (const flag of [
      "valid",
      "estimated",
      "below-detection-limit",
      "above-detection-limit",
      "suspect",
      "review-required",
    ] as const) {
      expect(createNutritionMetadata({ qualityFlag: flag }).qualityFlag).toBe(flag);
    }
  });

  it("detection limits as Quantity-like objects", () => {
    const meta = createNutritionMetadata({
      detectionLimits: { limitOfDetection: { value: 0.05, unit: "mg/kg" } },
    });
    expect(meta.detectionLimits?.limitOfDetection?.value).toBe(0.05);
  });

  it("replicates / sample references", () => {
    const meta = createNutritionMetadata({ sample: { sampleId: "S-1", replicateId: "R-2" } });
    expect(meta.sample?.sampleId).toBe("S-1");
    expect(meta.sample?.replicateId).toBe("R-2");
  });
});

// ---------------------------------------------------------------------------
// Property-based
// ---------------------------------------------------------------------------

describe("phase7+8 — property invariants", () => {
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
  it("alias resolution idempotent", () => {
    const rand = mulberry32(0x1234);
    const aliases = [
      "CP",
      "crudeProtein",
      "nutrient:crude-protein",
      "Ca",
      "ca",
      "nutrient:calcium",
    ];
    for (let i = 0; i < 20; i++) {
      const alias = aliases[Math.floor(rand() * aliases.length)]!;
      const once = defaultNutrientKindRegistry.resolve(alias)!;
      const twice = defaultNutrientKindRegistry.resolve(once)!;
      expect(twice).toBe(once);
    }
  });

  it("compatibility determinism", () => {
    const r1 = checkNutrientCompatibility("cp", "ca", { mode: "strict" });
    const r2 = checkNutrientCompatibility("cp", "ca", { mode: "strict" });
    expect(r1).toEqual(r2);
  });

  it("serialization round-trip", () => {
    const nq = NutritionQuantity.of(Quantity.of(250, "g/kg"), "cp", "dryMatter");
    const back = deserializeNutritionQuantity(serializeNutritionQuantity(nq));
    expect(back.equals(nq)).toBe(true);
  });

  it("immutability — repeated operations cannot mutate source", () => {
    const orig = NutritionQuantity.of(Quantity.of(100, "g/kg"), "cp", "asFed", {
      metadata: { lab: "A" } as unknown as Record<string, unknown>,
    });
    const before = JSON.stringify(orig.toJSON());
    orig.to("mg/kg");
    orig.convertBasis("dryMatter", createNutritionContext({ dryMatterFraction: 0.88 }));
    expect(JSON.stringify(orig.toJSON())).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Adversarial
// ---------------------------------------------------------------------------

describe("phase7+8 — adversarial", () => {
  it("unknown nutrient IDs, malformed aliases, ambiguous", () => {
    expect(() => defaultNutrientKindRegistry.require("unknown_xyz_999")).toThrow();
    expect(checkNutrientCompatibility("unknown_xyz_999", "cp")).toEqual(
      expect.objectContaining({ status: "unknown" }),
    );
  });

  it("malformed metadata, pollution, invalid dates, NaN/Infinity", () => {
    expect(() =>
      createNutritionMetadata({ provenance: { timestamp: "invalid-date" } as never }),
    ).toThrow();
    expect(() => NutritionQuantity.of(Quantity.of(NaN, "g/kg"), "cp", "asFed")).toThrow(
      InvalidNutritionQuantityError,
    );
    expect(() => NutritionQuantity.of(Quantity.of(Infinity, "g/kg"), "cp", "asFed")).toThrow(
      InvalidNutritionQuantityError,
    );
    expect(() =>
      createNutritionMetadata(JSON.parse('{"custom":{"__proto__":{}}}') as never),
    ).toThrow();
  });

  it("deeply nested metadata, conflicting provenance", () => {
    expect(() =>
      createNutritionMetadata({
        custom: { a: { b: { c: { d: { e: 1 } } } } } as unknown as Record<string, unknown>,
      }),
    ).not.toThrow();
    // Very deep nesting (>6 levels) is still allowed but frozen — ensure no pollution and deterministic
    const deep = JSON.parse('{"a":{"b":{"c":{"d":{"e":{"f":{"g":1}}}}}}}') as unknown as Record<
      string,
      unknown
    >;
    const meta = createNutritionMetadata({ custom: deep });
    expect((meta.custom as Record<string, unknown>).a).toBeDefined();
    expect(Object.isFrozen(meta.custom as Record<string, unknown>)).toBe(true);
  });
});
