/**
 * tests/numerical.test.ts — Phase 11: Numerical Precision & Mathematical Operations
 */
import { describe, expect, it } from "vitest";
import { Quantity } from "../src/quantity.js";
import { Dim, multiplyDim } from "../src/dimension.js";
import {
  approxEqual,
  classifyNumber,
  NumericalError,
  getNumericalPolicy,
  setNumericalPolicy,
  resetNumericalPolicy,
} from "../src/numerical.js";
import { DivisionByZeroError } from "../src/errors/index.js";

describe("11.1-11.3 number validation and finite values", () => {
  it("classifyNumber distinguishes kinds", () => {
    expect(classifyNumber(1)).toBe("finite");
    expect(classifyNumber(NaN)).toBe("nan");
    expect(classifyNumber(Infinity)).toBe("infinity");
    expect(classifyNumber(-Infinity)).toBe("neg-infinity");
    expect(classifyNumber(-0)).toBe("neg-zero");
    expect(classifyNumber("10" as unknown as number)).toBe("non-number");
  });

  it("Quantity.of rejects string value", () => {
    expect(() => Quantity.of("10" as unknown as number, "kg")).toThrow(NumericalError);
  });

  it("Quantity.of with NaN/Infinity allowed by default (permissive policy)", () => {
    expect(() => Quantity.of(NaN, "kg")).not.toThrow();
    expect(() => Quantity.of(Infinity, "kg")).not.toThrow();
  });

  it("finite-only policy rejects NaN/Infinity when enforced", () => {
    setNumericalPolicy({ requireFinite: true, allowNaN: false, allowInfinity: false });
    expect(() => Quantity.of(NaN, "kg")).toThrow(NumericalError);
    expect(() => Quantity.of(Infinity, "kg")).toThrow(NumericalError);
    resetNumericalPolicy();
  });

  it("get/set/reset policy", () => {
    const orig = getNumericalPolicy();
    setNumericalPolicy({ defaultAbsoluteTolerance: 1e-6 });
    expect(getNumericalPolicy().defaultAbsoluteTolerance).toBe(1e-6);
    resetNumericalPolicy();
    expect(getNumericalPolicy().defaultAbsoluteTolerance).toBe(orig.defaultAbsoluteTolerance);
  });
});

describe("11.4 division by zero", () => {
  it("Quantity.divide(0) throws DivisionByZeroError", () => {
    expect(() => Quantity.of(10, "kg").divide(0)).toThrow(DivisionByZeroError);
  });
  it("Quantity.divide(zeroQuantity) throws", () => {
    expect(() => Quantity.of(10, "kg").divide(Quantity.of(0, "kg"))).toThrow(DivisionByZeroError);
  });
  it("0/0 throws", () => {
    expect(() => Quantity.of(0, "kg").divide(Quantity.of(0, "kg"))).toThrow(DivisionByZeroError);
  });
});

describe("11.5-11.6 approximate vs exact equality", () => {
  it("exactEquals distinguishes, approximatelyEquals uses tolerance", () => {
    const a = Quantity.of(1, "kg");
    const b = Quantity.of(1000, "g");
    expect(a.exactEquals(b)).toBe(true); // both base 1
    expect(a.equals(b)).toBe(true);
    expect(a.approximatelyEquals(b, { absoluteTolerance: 1e-12 })).toBe(true);
  });

  it("approx with absolute and relative", () => {
    expect(approxEqual(1.0, 1.0000000005, { absoluteTolerance: 1e-9 })).toBe(true);
    expect(approxEqual(1000, 1000.001, { relativeTolerance: 1e-6 })).toBe(true);
    expect(approxEqual(1, 2, { absoluteTolerance: 0.5 })).toBe(false);
  });

  it("NaN never approx equals", () => {
    expect(approxEqual(NaN, NaN, {})).toBe(false);
  });

  it("Infinity exact only", () => {
    expect(approxEqual(Infinity, Infinity, {})).toBe(true);
    expect(approxEqual(Infinity, 1e308, {})).toBe(false);
  });
});

describe("11.7 conversion accuracy preserves precision", () => {
  it("value × factor not rounded", () => {
    // 1 kg = 1000 g, factor 1000, value 1.23456789 should preserve
    const q = Quantity.of(1.23456789, "kg");
    expect(q.to("g").value).toBeCloseTo(1234.56789, 9);
  });
});

describe("11.9 scale factor safety extreme prefixes", () => {
  it("1e30 via quetta", () => {
    const q = Quantity.of(1, "Qm");
    expect(q.to("m").value).toBe(1e30);
  });
  it("1e-30 via quecto", () => {
    expect(Quantity.of(1, "qm").to("m").value).toBeCloseTo(1e-30, 32);
  });
  it("very large multiplication stays finite", () => {
    const a = Quantity.of(1e15, "kg");
    const b = Quantity.of(1e15, "kg");
    // This would be 1e30 kg², scale 1, value 1e30, still finite
    const c = a.multiply(b);
    expect(c.value).toBe(1e30);
  });
});

describe("11.10 overflow policy", () => {
  it("overflow to Infinity throws if not allowed", () => {
    setNumericalPolicy({ allowInfinity: false });
    expect(() => Quantity.of(1e308, "kg").scale(1e10)).toThrow(NumericalError);
    resetNumericalPolicy();
  });
  it("Infinity allowed by default does not throw for 1e308*10", () => {
    // Default allows Infinity, so 1e308 *10 = Infinity is allowed (no throw) — but our check will allow it
    expect(() => Quantity.of(1e308, "kg").scale(10)).not.toThrow();
  });
});

describe("11.12-11.13 rounding", () => {
  it("round half-up", () => {
    expect(Quantity.of(1.5, "kg").round(0, "half-up").value).toBe(2);
    expect(Quantity.of(-1.5, "kg").round(0, "half-up").value).toBe(-2);
  });
  it("round half-even", () => {
    expect(Quantity.of(2.5, "kg").round(0, "half-even").value).toBe(2);
    expect(Quantity.of(3.5, "kg").round(0, "half-even").value).toBe(4);
  });
  it("floor/ceil/trunc", () => {
    expect(Quantity.of(1.9, "kg").round(0, "floor").value).toBe(1);
    expect(Quantity.of(1.1, "kg").round(0, "ceil").value).toBe(2);
    expect(Quantity.of(-1.9, "kg").round(0, "trunc").value).toBe(-1);
  });
  it("does not mutate", () => {
    const q = Quantity.of(1.5, "kg");
    const r = q.round(0);
    expect(q.value).toBe(1.5);
    expect(r.value).toBe(2);
  });
  it("non-integer decimals throws", () => {
    expect(() => Quantity.of(1, "kg").round(1.5 as unknown as number)).toThrow(NumericalError);
  });
});

describe("11.16 power", () => {
  it("4 m pow 2 = 16 m²", () => {
    const r = Quantity.of(4, "m").pow(2);
    expect(r.value).toBe(16);
    expect(r.dimension).toEqual({ L: 2 });
  });
  it("4 m pow -1 = 0.25 m⁻¹", () => {
    const r = Quantity.of(4, "m").pow(-1);
    expect(r.value).toBeCloseTo(0.25);
    expect(r.dimension).toEqual({ L: -1 });
  });
  it("pow 0 = dimensionless 1", () => {
    const r = Quantity.of(5, "kg").pow(0);
    expect(r.value).toBe(1);
    expect(r.isDimensionless()).toBe(true);
  });
  it("pow 1 = identity", () => {
    const q = Quantity.of(5, "kg");
    expect(q.pow(1).value).toBe(q.value);
  });
  it("non-integer power throws", () => {
    expect(() => Quantity.of(4, "m").pow(1.5)).toThrow(NumericalError);
  });
  it("affine pow throws except 0/1", () => {
    expect(() => Quantity.of(10, "°C").pow(2)).toThrow(NumericalError);
    expect(() => Quantity.of(10, "°C").pow(0)).not.toThrow();
  });
});

describe("11.15 min/max", () => {
  it("min/max", () => {
    const a = Quantity.of(1, "kg");
    const b = Quantity.of(1500, "g");
    expect(a.min(b).value).toBe(1); // 1 kg =1000g <1500g, so a is min
    expect(a.max(b).value).toBe(1500);
  });
});

describe("11.18 dimension algebra audit", () => {
  it("M^1 × M^-1 dimensionless no zero exponents", () => {
    const m = Dim.Mass;
    const inv = { M: -1 } as unknown as typeof m;
    const r = multiplyDim(m, inv);
    expect(r).toEqual({});
    expect(Object.keys(r).length).toBe(0);
  });
});

describe("11.19 mathematical invariants", () => {
  it("q.scale(1) ≈ q", () => {
    const q = Quantity.of(5, "kg");
    expect(q.scale(1).equals(q)).toBe(true);
  });
  it("q.scale(0)=zero", () => {
    expect(Quantity.of(5, "kg").scale(0).isZero()).toBe(true);
  });
  it("negate twice = original", () => {
    const q = Quantity.of(5, "kg");
    expect(q.negate().negate().value).toBe(q.value);
  });
  it("abs twice = abs", () => {
    expect(Quantity.of(-5, "kg").abs().abs().value).toBe(5);
  });
  it("a+b ≈ b+a", () => {
    const a = Quantity.of(1, "kg");
    const b = Quantity.of(500, "g");
    expect(a.add(b).equals(b.add(a))).toBe(true);
  });
  it("a*b ≈ b*a", () => {
    const a = Quantity.of(2, "kg");
    const b = Quantity.of(3, "m");
    expect(a.multiply(b).toBase().value).toBeCloseTo(b.multiply(a).toBase().value, 9);
  });
  it("q/q dimensionless 1", () => {
    expect(Quantity.of(5, "kg").divide(Quantity.of(5, "kg")).value).toBe(1);
    expect(Quantity.of(5, "kg").divide(Quantity.of(5, "kg")).isDimensionless()).toBe(true);
  });
  it("pow identity", () => {
    const q = Quantity.of(4, "m");
    expect(q.pow(1).value).toBe(4);
    expect(q.pow(0).value).toBe(1);
  });
});
