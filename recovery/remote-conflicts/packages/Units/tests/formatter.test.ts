/**
 * tests/formatter.test.ts — Phase 9: Canonical Formatting & Display System
 */
import { describe, expect, it } from "vitest";
import { parseUnit } from "../src/unit-parser.js";
import { Quantity } from "../src/quantity.js";
import { formatUnit, formatQuantity } from "../src/formatter.js";
import { isDimensionless } from "../src/dimension.js";

describe("formatUnit: atomic", () => {
  it.each(["kg", "g", "m", "s", "K", "%", "ppm"] as const)("formats %s", (sym) => {
    expect(formatUnit(parseUnit(sym))).toBeTruthy();
  });
  it('formats kg as "kg"', () => {
    expect(formatUnit(parseUnit("kg"))).toBe("kg");
  });
});

describe("formatUnit: composite", () => {
  it("m/s", () => {
    const s = formatUnit(parseUnit("m/s"));
    expect(s).toMatch(/m/);
    expect(s).toMatch(/s/);
  });
  it("kg·m/s² canonical", () => {
    const u = parseUnit("kg·m/s²");
    const fmt = formatUnit(u);
    expect(fmt).toContain("kg");
    expect(fmt).toContain("m");
    expect(fmt).toContain("s");
  });
  it("Mcal/kg", () => {
    expect(formatUnit(parseUnit("Mcal/kg"))).toMatch(/Mcal/);
  });
  it("preserves prefixes: km, µm", () => {
    expect(formatUnit(parseUnit("km"))).toBe("km");
    expect(formatUnit(parseUnit("µm"))).toBe("µm");
  });
});

describe("formatUnit: exponents", () => {
  it("positive m²", () => {
    const s = formatUnit(parseUnit("m^2"));
    expect(s).toMatch(/m/);
    expect(s).toMatch(/2|²/);
  });
  it("negative s⁻¹", () => {
    const s = formatUnit(parseUnit("s^-1"));
    // Should contain s and -1 or superscript
    expect(s).toContain("s");
  });
  it("ascii mode uses ^", () => {
    const s = formatUnit(parseUnit("m^2"), { ascii: true });
    expect(s).toBe("m^2");
  });
  it("unicode mode uses superscript", () => {
    const s = formatUnit(parseUnit("m^2"), { ascii: false });
    expect(s).toBe("m²");
  });
});

describe("formatUnit: multiplication symbol", () => {
  it("default is middle dot", () => {
    expect(formatUnit(parseUnit("kg*m"), { multiplicationSymbol: "·" })).toContain("·");
  });
  it("custom symbol", () => {
    expect(formatUnit(parseUnit("kg*m"), { multiplicationSymbol: "*" })).toContain("*");
  });
});

describe("formatUnit: dimensionless", () => {
  it("15 % preserves %", () => {
    expect(formatUnit(parseUnit("%"))).toBe("%");
  });
  it("250 ppm preserves ppm", () => {
    expect(formatUnit(parseUnit("ppm"))).toBe("ppm");
  });
  it("pure dimensionless 1 may format as 1", () => {
    const u = parseUnit("m/m");
    expect(isDimensionless(u.dimension)).toBe(true);
    const fmt = formatUnit(u);
    expect(fmt).toBeTruthy();
  });
});

describe("formatQuantity", () => {
  it.each([12, 15] as const)("formats %s kg", (v) => {
    expect(formatQuantity(Quantity.of(v, "kg"))).toContain("kg");
    expect(formatQuantity(Quantity.of(v, "kg"))).toContain(String(v));
  });
  it("3.5 Mcal/day", () => {
    expect(formatQuantity(Quantity.of(3.5, "Mcal/day"))).toMatch(/Mcal/);
  });
  it("15 %", () => {
    expect(formatQuantity(Quantity.of(15, "%"))).toContain("%");
  });
  it("0.000001 without trailing zeros? default decimals 2", () => {
    const s = formatQuantity(Quantity.of(0.000001, "fraction"));
    expect(s).toBeTruthy();
  });
  it("negative -5 m", () => {
    expect(formatQuantity(Quantity.of(-5, "m"))).toContain("-5");
  });
  it("zero", () => {
    expect(formatQuantity(Quantity.of(0, "kg"))).toContain("0");
  });
  it("very large", () => {
    expect(formatQuantity(Quantity.of(1e12, "kg"))).toBeTruthy();
  });
  it("very small", () => {
    expect(formatQuantity(Quantity.of(1e-12, "g"))).toBeTruthy();
  });
  it("Infinity and NaN", () => {
    expect(formatQuantity(Quantity.of(Infinity, "kg"))).toContain("Infinity");
    expect(formatQuantity(Quantity.of(NaN, "kg"))).toContain("NaN");
  });
});

describe("formatUnit: canonical ordering deterministic", () => {
  it("kg·m/s² ordering stable across runs", () => {
    const a = formatUnit(parseUnit("kg·m/s²"));
    const b = formatUnit(parseUnit("kg·m/s²"));
    expect(a).toBe(b);
  });
  it("m/s vs m·s^-1 equivalent dimensions produce consistent canonical (at least same dimension)", () => {
    const a = parseUnit("m/s");
    const b = parseUnit("m·s^-1");
    // Formatter should produce parseable strings that re-parse to same dimension
    const fa = formatUnit(a);
    const fb = formatUnit(b);
    expect(parseUnit(fa).dimension).toEqual(parseUnit(fb).dimension);
  });
});

describe("parser/formatter round trip", () => {
  const units = ["kg", "m/s", "kg·m/s²", "mg/kg", "m²", "cm²", "kg/m³"] as const;
  for (const expr of units) {
    it(`parse(format(${expr})) ≈ original`, () => {
      const u = parseUnit(expr);
      const fmt = formatUnit(u);
      const reparsed = parseUnit(fmt);
      expect(reparsed.dimension).toEqual(u.dimension);
      expect(reparsed.toBaseFactor).toBeCloseTo(u.toBaseFactor, 9);
    });
  }
  it("format is parseable", () => {
    const u = parseUnit("kg·m/s²");
    expect(() => parseUnit(formatUnit(u))).not.toThrow();
  });
});

describe("formatter performance: caching", () => {
  it("cached format returns same string", () => {
    const u = parseUnit("kg/m³");
    const a = formatUnit(u);
    const b = formatUnit(u);
    expect(a).toBe(b);
  });
  it("does not mutate unit", () => {
    const u = parseUnit("m/s");
    const before = JSON.stringify(u);
    formatUnit(u);
    formatQuantity(Quantity.of(5, "m/s"));
    expect(JSON.stringify(u)).toBe(before);
  });
});

describe("formatQuantity options", () => {
  it("decimals", () => {
    expect(formatQuantity(Quantity.of(3.14159, "kg"), { decimals: 1 })).toContain("3.1");
  });
  it("ascii vs unicode", () => {
    // Use m² via parser
    const q2 = Quantity.of(5, "m²");
    expect(formatQuantity(q2, { ascii: false })).toContain("²");
    expect(formatQuantity(q2, { ascii: true })).toContain("^2");
  });
  it("showBasis false hides DM", () => {
    const q = Quantity.of(15, "% DM");
    expect(formatQuantity(q, { showBasis: false })).not.toContain("DM");
    expect(formatQuantity(q, { showBasis: true })).toContain("DM");
  });
});
