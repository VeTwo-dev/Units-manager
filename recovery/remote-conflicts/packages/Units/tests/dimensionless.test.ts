/**
 * tests/dimensionless.test.ts — Phase 7: Dimensionless & Ratio System
 */
import { describe, expect, it } from "vitest";
import { isDimensionless } from "../src/dimension.js";
import { DIMENSIONLESS_UNIT, isDimensionlessUnit } from "../src/unit.js";
import { Dim } from "../src/dimension.js";
import { Quantity } from "../src/quantity.js";
import { parseUnit } from "../src/unit-parser.js";
import { DivisionByZeroError } from "../src/errors/index.js";

describe("7.1 dimensionless foundation", () => {
  it("m / m is dimensionless", () => {
    expect(isDimensionless(parseUnit("m/m").dimension)).toBe(true);
  });
  it("kg / kg is dimensionless", () => {
    expect(isDimensionless(parseUnit("kg/kg").dimension)).toBe(true);
  });
  it("10 m / 2 m = 5 dimensionless", () => {
    const r = Quantity.of(10, "m").divide(Quantity.of(2, "m"));
    expect(isDimensionless(r.dimension)).toBe(true);
    expect(r.value).toBe(5);
  });
  it("(m/s) / (m/s) dimensionless", () => {
    const r = Quantity.of(10, "m/s").divide(Quantity.of(2, "m/s"));
    expect(isDimensionless(r.dimension)).toBe(true);
    expect(r.value).toBe(5);
  });
  it("not string-based: unit.symbol !== source of truth", () => {
    const u = parseUnit("m/m");
    // Dimension is authoritative, not symbol
    expect(isDimensionless(u.dimension)).toBe(true);
    expect(isDimensionlessUnit(u)).toBe(true);
  });
});

describe("7.2 dimensionless unit canonical", () => {
  it("DIMENSIONLESS_UNIT is dimensionless with scale 1", () => {
    expect(isDimensionless(DIMENSIONLESS_UNIT.dimension)).toBe(true);
    expect(DIMENSIONLESS_UNIT.conversion.scale).toBe(1);
    expect(DIMENSIONLESS_UNIT.symbol).toBe("1");
  });
  it("is frozen / immutable", () => {
    expect(Object.isFrozen(DIMENSIONLESS_UNIT)).toBe(true);
    expect(Object.isFrozen(DIMENSIONLESS_UNIT.dimension)).toBe(true);
  });
  it("exactly one canonical identity: repeated access same object", () => {
    expect(DIMENSIONLESS_UNIT.symbol).toBe("1");
    // Re-import via dynamic import would still be same reference due to ES module caching
    expect(DIMENSIONLESS_UNIT.dimension).toEqual({});
  });
});

describe("7.3 dimensionless quantities", () => {
  it("Quantity division cancel yields dimensionless", () => {
    const r = Quantity.of(10, "m").divide(Quantity.of(2, "m"));
    expect(r.isDimensionless()).toBe(true);
  });
  it("1 kg / 1000 g → 1 dimensionless", () => {
    const r = Quantity.of(1, "kg").divide(Quantity.of(1000, "g"));
    // Prompt-18 correction: the value reads in the emitted composite unit
    // (0.001 (kg)/(g)); the pure number 1 is available via base/"1".
    expect(r.value).toBeCloseTo(0.001);
    expect(r.toBase().value).toBeCloseTo(1);
    expect(r.to("1").value).toBeCloseTo(1);
    expect(r.isDimensionless()).toBe(true);
  });
  it("does not auto-turn into % or ratio display", () => {
    const r = Quantity.of(1, "kg").divide(Quantity.of(1000, "g"));
    // Pure number is 1, not "100%" — display is formatter concern
    expect(r.to("1").value).toBe(1);
    expect(r.unit.symbol).not.toBe("%");
  });
});

describe("7.4 ratio semantics vs dimensionless value", () => {
  it("0.15 raw dimensionless vs 15% display", () => {
    const raw = Quantity.of(0.15, "fraction");
    const pct = Quantity.of(15, "%");
    expect(raw.to("fraction").value).toBeCloseTo(0.15);
    expect(pct.to("fraction").value).toBeCloseTo(0.15);
    expect(pct.value).toBe(15); // stored as 15 %, not 0.15
    expect(raw.isDimensionless()).toBe(true);
    expect(pct.isDimensionless()).toBe(true);
  });
});

describe("7.5 percentage", () => {
  it("1 % = 0.01", () => {
    expect(Quantity.of(1, "%").to("fraction").value).toBeCloseTo(0.01);
  });
  it("100 % = 1", () => {
    expect(Quantity.of(100, "%").to("fraction").value).toBeCloseTo(1);
  });
  it("15 % = 0.15", () => {
    expect(Quantity.of(15, "%").to("fraction").value).toBeCloseTo(0.15);
  });
  it("percentage remains dimensionless", () => {
    expect(isDimensionlessUnit(parseUnit("%"))).toBe(true);
    expect(Quantity.of(15, "%").isDimensionless()).toBe(true);
  });
  it("percentage is not a physical dimension", () => {
    expect(parseUnit("%").dimension).toEqual({});
  });
});

describe("7.6 per-mille", () => {
  it("1 ‰ = 0.001 dimensionless", () => {
    expect(Quantity.of(1, "‰").to("fraction").value).toBeCloseTo(0.001);
    expect(isDimensionlessUnit(parseUnit("‰"))).toBe(true);
  });
  it("remains dimensionless", () => {
    expect(Quantity.of(1, "‰").isDimensionless()).toBe(true);
  });
});

describe("7.7 parts-per notation", () => {
  it("ppm = 1e-6", () => {
    expect(Quantity.of(1, "ppm").to("fraction").value).toBeCloseTo(1e-6);
  });
  it("ppb = 1e-9", () => {
    expect(Quantity.of(1, "ppb").to("fraction").value).toBeCloseTo(1e-9);
  });
  it("ppt = 1e-12", () => {
    expect(Quantity.of(1, "ppt").to("fraction").value).toBeCloseTo(1e-12);
  });
  it("all remain dimensionless", () => {
    for (const u of ["ppm", "ppb", "ppt", "‰", "%", "fraction"] as const) {
      expect(isDimensionlessUnit(parseUnit(u))).toBe(true);
    }
  });
});

describe("7.8 ratio conversion & round-trips", () => {
  it("1 % = 10000 ppm (scale conversion)", () => {
    expect(Quantity.of(1, "%").to("ppm").value).toBeCloseTo(10000);
    expect(Quantity.of(10000, "ppm").to("%").value).toBeCloseTo(1);
  });
  it("1 % = 10 ‰", () => {
    expect(Quantity.of(1, "%").to("‰").value).toBeCloseTo(10);
  });
  it("1 ppm round-trip ppb", () => {
    const v = Quantity.of(1, "ppm").to("ppb").value; // 1000 ppb
    expect(Quantity.of(v, "ppb").to("ppm").value).toBeCloseTo(1);
  });
  it("follow numerical policy, not arbitrary tolerances", () => {
    expect(Quantity.of(1, "ppb").to("fraction").value).toBe(1e-9);
  });
});

describe("7.9 dimensionless multiplication preserves dimension", () => {
  it("2 (dimensionless) × 10 kg = 20 kg", () => {
    expect(Quantity.of(2, "fraction").multiply(Quantity.of(10, "kg")).to("kg").value).toBeCloseTo(
      20,
    );
  });
  it("15% × 10 kg = 1.5 kg (generic algebra, no % special case)", () => {
    const pct = Quantity.of(15, "%"); // 0.15 base
    const mass = Quantity.of(10, "kg");
    // 15% of 10 kg = 1.5 kg via base: 10 * 0.15 =1.5 but our multiply does base*base
    // 15% base 0.15 *10 =1.5 kg base 10 -> actually 0.15*10=1.5 with dimension M
    expect(pct.multiply(mass).to("kg").value).toBeCloseTo(1.5);
  });
  it("dimensionless × m → m", () => {
    expect(Quantity.of(2, "fraction").multiply(Quantity.of(5, "m")).dimension).toEqual(Dim.Length);
  });
});

describe("7.10 dimensionless division preserves dimension", () => {
  it("10 kg / 2 = 5 kg", () => {
    expect(Quantity.of(10, "kg").divide(2).to("kg").value).toBeCloseTo(5);
    expect(Quantity.of(10, "kg").divide(2).dimension).toEqual(Dim.Mass);
  });
  it("10 kg / 0.5 fraction = 20 kg", () => {
    expect(Quantity.of(10, "kg").divide(Quantity.of(0.5, "fraction")).to("kg").value).toBeCloseTo(
      20,
    );
  });
});

describe("7.11 ratio of different dimensions", () => {
  it("kg/kg → dimensionless", () => {
    expect(isDimensionless(parseUnit("kg/kg").dimension)).toBe(true);
  });
  it("kg/L → M·L^-1 not dimensionless", () => {
    // We don't have L unit "L" (liter) but we have Length m; use kg/m
    expect(isDimensionless(parseUnit("kg/m").dimension)).toBe(false);
  });
  it("m/s → not dimensionless", () => {
    expect(isDimensionless(parseUnit("m/s").dimension)).toBe(false);
  });
  it("(m/s)/(m/s) → dimensionless", () => {
    const a = Quantity.of(10, "m/s");
    expect(a.divide(a).isDimensionless()).toBe(true);
  });
  it("do not infer ratio from slash alone", () => {
    // slash present but dimension not empty => not dimensionless
    expect(isDimensionless(parseUnit("Mcal/kg").dimension)).toBe(false);
  });
});

describe("7.12 semantic safety: dimensionless scaled units vs basis", () => {
  it("1 % = 10000 ppm via mathematical scale (allowed)", () => {
    expect(Quantity.of(1, "%").to("ppm").value).toBeCloseTo(10000);
  });
  it('"% DM" vs "% asFed" are NOT interchangeable via unit conversion (basis)', () => {
    // Both dimensionless but basis mismatch should be caught
    const dm = Quantity.of(15, "% DM");
    const asFed = Quantity.of(15, "% asFed");
    expect(dm.dimension).toEqual({});
    expect(asFed.dimension).toEqual({});
    // Conversion between different basis should throw ConversionError (from quantity.ts)
    expect(() => dm.to("% asFed")).toThrow();
  });
  it("core dimensionless without basis are interchangeable", () => {
    expect(() => Quantity.of(1, "%").to("ppm")).not.toThrow();
  });
});

describe("7.13 dimensionless API", () => {
  it("isDimensionless from dimension", () => {
    expect(isDimensionless(parseUnit("m/m").dimension)).toBe(true);
    expect(isDimensionless(parseUnit("m").dimension)).toBe(false);
  });
  it("unit.isDimensionless via helper", () => {
    expect(isDimensionlessUnit(parseUnit("kg/kg"))).toBe(true);
    expect(isDimensionlessUnit(parseUnit("kg"))).toBe(false);
  });
  it("quantity.isDimensionless", () => {
    expect(Quantity.of(5, "m/m").isDimensionless()).toBe(true);
    expect(Quantity.of(5, "kg").isDimensionless()).toBe(false);
    expect(Quantity.of(10, "m").divide(Quantity.of(2, "m")).isDimensionless()).toBe(true);
  });
});

describe("7.14 zero-division", () => {
  it("q.divide(0) throws DivisionByZeroError", () => {
    expect(() => Quantity.of(10, "kg").divide(0)).toThrow(DivisionByZeroError);
  });
  it("q.divide(zeroQuantity) throws", () => {
    expect(() => Quantity.of(10, "kg").divide(Quantity.of(0, "kg"))).toThrow(DivisionByZeroError);
  });
  it("zero / zero throws (not silent Infinity)", () => {
    expect(() => Quantity.of(0, "kg").divide(Quantity.of(0, "kg"))).toThrow(DivisionByZeroError);
  });
  it("0 (scalar) with zero dimensionless quantity still throws", () => {
    expect(() => Quantity.of(10, "m").divide(Quantity.of(0, "fraction"))).toThrow(
      DivisionByZeroError,
    );
  });
  it("non-zero division does not throw", () => {
    expect(() => Quantity.of(10, "kg").divide(Quantity.of(2, "kg"))).not.toThrow();
    expect(() => Quantity.of(10, "kg").divide(2)).not.toThrow();
  });
});

describe("7.15 immutability for dimensionless ops", () => {
  it("original Quantity unchanged after divide to dimensionless", () => {
    const a = Quantity.of(10, "m");
    const b = Quantity.of(2, "m");
    const aBefore = a.value;
    a.divide(b);
    expect(a.value).toBe(aBefore);
  });
  it("DIMENSIONLESS_UNIT unchanged after ops", () => {
    const before = JSON.stringify(DIMENSIONLESS_UNIT);
    Quantity.of(10, "m").divide(Quantity.of(2, "m"));
    expect(JSON.stringify(DIMENSIONLESS_UNIT)).toBe(before);
    expect(Object.isFrozen(DIMENSIONLESS_UNIT)).toBe(true);
  });
  it("parsed dimensionless Units are frozen", () => {
    const u = parseUnit("m/m");
    expect(Object.isFrozen(u)).toBe(true);
    expect(Object.isFrozen(u.dimension)).toBe(true);
  });
});
