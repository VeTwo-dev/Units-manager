/**
 * tests/quantity-math.test.ts — Phase 19: Scientific Quantity Semantics &
 * Advanced Mathematical Operations.
 */
import { describe, expect, it } from "vitest";
import { Quantity, Dim } from "../src/index.js";
import {
  DimensionError,
  DivisionByZeroError,
  NumericalError,
  UnitMismatchError,
} from "../src/errors/index.js";

// ---------------------------------------------------------------------------
// Roots
// ---------------------------------------------------------------------------

describe("Quantity roots", () => {
  it("sqrt(9 m²) = 3 m", () => {
    const r = Quantity.of(9, "m^2").sqrt();
    expect(r.value).toBeCloseTo(3, 12);
    expect(r.dimension).toEqual(Dim.Length);
    expect(r.to("m").value).toBeCloseTo(3, 12);
  });

  it("sqrt respects prefixed units: sqrt(4 cm²) = 2 cm", () => {
    const r = Quantity.of(4, "cm^2").sqrt();
    expect(r.to("cm").value).toBeCloseTo(2, 9);
  });

  it("sqrt rejects non-exact dimensions (sqrt(m) throws DimensionError)", () => {
    expect(() => Quantity.of(9, "m").sqrt()).toThrow(DimensionError);
  });

  it("sqrt rejects negative values", () => {
    expect(() => Quantity.of(-4, "m^2").sqrt()).toThrow(NumericalError);
  });

  it("sqrt rejects affine units", () => {
    expect(() => Quantity.of(300, "K").sqrt()).toThrow();
    expect(() => Quantity.of(27, "°C").sqrt()).toThrow();
  });

  it("sqrt of dimensionless works", () => {
    const r = Quantity.of(0.25, "fraction").sqrt();
    expect(r.value).toBeCloseTo(0.5, 12);
    expect(r.isDimensionless()).toBe(true);
  });

  it("cbrt(27 m³) = 3 m and cbrt(-8 m³) = -2 m", () => {
    expect(Quantity.of(27, "m^3").cbrt().to("m").value).toBeCloseTo(3, 12);
    expect(Quantity.of(-8, "m^3").cbrt().to("m").value).toBeCloseTo(-2, 12);
  });

  it("cbrt rejects non-exact dimensions", () => {
    expect(() => Quantity.of(4, "m^2").cbrt()).toThrow(DimensionError);
  });

  it("roots do not mutate the receiver", () => {
    const q = Quantity.of(9, "m^2");
    q.sqrt();
    expect(q.value).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// Reciprocal, sign
// ---------------------------------------------------------------------------

describe("Quantity reciprocal and sign", () => {
  it("reciprocal(2 s) = 0.5 s⁻¹", () => {
    const r = Quantity.of(2, "s").reciprocal();
    expect(r.value).toBeCloseTo(0.5, 12);
    expect(r.dimension).toEqual({ T: -1 });
  });

  it("reciprocal of zero throws DivisionByZeroError", () => {
    expect(() => Quantity.of(0, "s").reciprocal()).toThrow(DivisionByZeroError);
  });

  it("reciprocal of affine throws", () => {
    expect(() => Quantity.of(10, "°C").reciprocal()).toThrow();
  });

  it("sign returns dimensionless -1/0/1", () => {
    expect(Quantity.of(-5, "kg").sign().value).toBe(-1);
    expect(Quantity.of(0, "kg").sign().value).toBe(0);
    expect(Quantity.of(7, "kg").sign().value).toBe(1);
    expect(Quantity.of(-5, "kg").sign().isDimensionless()).toBe(true);
  });

  it("reciprocal does not mutate", () => {
    const q = Quantity.of(2, "s");
    q.reciprocal();
    expect(q.value).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Clamp and modulo
// ---------------------------------------------------------------------------

describe("Quantity clamp and modulo", () => {
  it("clamps into range, keeping this unit", () => {
    expect(Quantity.of(5, "kg").clamp(Quantity.of(1, "kg"), Quantity.of(3, "kg")).value).toBe(3);
    expect(Quantity.of(0.5, "kg").clamp(Quantity.of(1, "kg"), Quantity.of(3, "kg")).value).toBe(1);
    const inside = Quantity.of(2, "kg").clamp(Quantity.of(1, "kg"), Quantity.of(3, "kg"));
    expect(inside.value).toBe(2);
    expect(inside.unit.symbol).toBe("kg");
  });

  it("clamp converts bounds and keeps this unit", () => {
    const r = Quantity.of(5, "kg").clamp(Quantity.of(500, "g"), Quantity.of(6000, "g"));
    expect(r.value).toBe(5);
    expect(r.unit.symbol).toBe("kg");
  });

  it("clamp rejects dimension mismatch and inverted bounds", () => {
    expect(() => Quantity.of(1, "kg").clamp(Quantity.of(1, "m"), Quantity.of(2, "m"))).toThrow(
      UnitMismatchError,
    );
    expect(() => Quantity.of(1, "kg").clamp(Quantity.of(3, "kg"), Quantity.of(1, "kg"))).toThrow(
      NumericalError,
    );
  });

  it("modulo follows truncated semantics: 10 m mod 3 m = 1 m", () => {
    const r = Quantity.of(10, "m").modulo(Quantity.of(3, "m"));
    expect(r.value).toBe(1);
    expect(r.unit.symbol).toBe("m");
  });

  it("modulo converts divisor and keeps this unit", () => {
    expect(Quantity.of(2500, "g").modulo(Quantity.of(1, "kg")).value).toBe(500);
  });

  it("modulo by zero throws; affine throws", () => {
    expect(() => Quantity.of(1, "m").modulo(Quantity.of(0, "m"))).toThrow(DivisionByZeroError);
    expect(() => Quantity.of(1, "m").modulo(Quantity.of(0, "°C"))).toThrow();
    expect(() => Quantity.of(10, "°C").modulo(Quantity.of(2, "K"))).toThrow();
  });

  it("negative dividend keeps sign (truncated, like %)", () => {
    expect(Quantity.of(-10, "m").modulo(Quantity.of(3, "m")).value).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// roundTo
// ---------------------------------------------------------------------------

describe("Quantity roundTo", () => {
  it("roundTo converts then rounds: 1.234 kg → 1234 g", () => {
    const r = Quantity.of(1.234, "kg").roundTo("g");
    expect(r.value).toBe(1234);
    expect(r.unit.symbol).toBe("g");
  });

  it("roundTo honors decimals and mode", () => {
    expect(Quantity.of(1.234, "kg").roundTo("kg", 2).value).toBe(1.23);
    expect(Quantity.of(1.235, "kg").roundTo("kg", 2, "half-even").value).toBe(1.24);
  });

  it("roundTo rejects incompatible dimensions", () => {
    expect(() => Quantity.of(1, "kg").roundTo("m")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Dimensionless transcendental functions
// ---------------------------------------------------------------------------

describe("Quantity transcendental functions", () => {
  it("sin/cos/tan on dimensionless (radians)", () => {
    expect(Quantity.of(0, "fraction").sin().value).toBeCloseTo(0, 12);
    expect(Quantity.of(0, "fraction").cos().value).toBeCloseTo(1, 12);
    expect(Quantity.of(Math.PI / 4, "fraction").tan().value).toBeCloseTo(1, 9);
    expect(Quantity.of(Math.PI, "fraction").sin().isDimensionless()).toBe(true);
  });

  it("exp/ln/log10 on dimensionless", () => {
    expect(Quantity.of(0, "fraction").exp().value).toBeCloseTo(1, 12);
    expect(Quantity.of(1, "fraction").exp().value).toBeCloseTo(Math.E, 12);
    expect(Quantity.of(Math.E, "fraction").ln().value).toBeCloseTo(1, 12);
    expect(Quantity.of(100, "fraction").log10().value).toBeCloseTo(2, 12);
  });

  it("rejects dimensional input with DimensionError", () => {
    expect(() => Quantity.of(5, "kg").exp()).toThrow(DimensionError);
    expect(() => Quantity.of(1, "m").sin()).toThrow(DimensionError);
    expect(() => Quantity.of(2, "s").ln()).toThrow(DimensionError);
  });

  it("ln/log10 reject non-positive values", () => {
    expect(() => Quantity.of(0, "fraction").ln()).toThrow(NumericalError);
    expect(() => Quantity.of(-1, "fraction").ln()).toThrow(NumericalError);
    expect(() => Quantity.of(NaN, "fraction").ln()).toThrow(NumericalError);
    expect(() => Quantity.of(0, "fraction").log10()).toThrow(NumericalError);
  });

  it("exp overflow follows the numerical policy", () => {
    // Default policy allows Infinity → IEEE result preserved, not hidden
    expect(Quantity.of(1000, "fraction").exp().value).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// Zero policy: zero is NOT dimension-polymorphic
// ---------------------------------------------------------------------------

describe("Quantity zero policy", () => {
  it("0 kg + 0 m throws (strict dimensional safety)", () => {
    expect(() => Quantity.of(0, "kg").add(Quantity.of(0, "m"))).toThrow(UnitMismatchError);
  });

  it("0 kg compared with 0 m is false, not throw, for equals", () => {
    expect(Quantity.of(0, "kg").equals(Quantity.of(0, "m"))).toBe(false);
  });

  it("a - a = 0 keeps the dimension", () => {
    const z = Quantity.of(5, "kg").subtract(Quantity.of(5, "kg"));
    expect(z.value).toBe(0);
    expect(z.dimension).toEqual(Dim.Mass);
  });

  it("q.scale(0) keeps the unit", () => {
    const z = Quantity.of(5, "m").scale(0);
    expect(z.value).toBe(0);
    expect(z.unit.symbol).toBe("m");
  });
});

// ---------------------------------------------------------------------------
// Result-unit policy
// ---------------------------------------------------------------------------

describe("Quantity result-unit policy", () => {
  it("add/subtract preserve the left operand unit", () => {
    expect(Quantity.of(1, "kg").add(Quantity.of(500, "g")).unit.symbol).toBe("kg");
    expect(Quantity.of(1, "kg").subtract(Quantity.of(500, "g")).unit.symbol).toBe("kg");
  });

  it("scale preserves the unit", () => {
    expect(Quantity.of(1, "kg").scale(2).unit.symbol).toBe("kg");
  });

  it("multiply/divide produce base-unit composites (computational units)", () => {
    const m = Quantity.of(2, "kg").multiply(Quantity.of(3, "m"));
    expect(m.toBase().value).toBe(6);
    const d = Quantity.of(6, "kg").divide(Quantity.of(2, "m"));
    expect(d.toBase().value).toBe(3);
  });

  it("presentation is the formatter's job, not arithmetic's", () => {
    const q = Quantity.of(1500, "g");
    expect(q.value).toBe(1500); // not auto-normalized to 1.5 kg
    expect(q.to("kg").value).toBe(1.5); // explicit normalization
  });
});

// ---------------------------------------------------------------------------
// Immutability of new operations
// ---------------------------------------------------------------------------

describe("Quantity new-operation immutability", () => {
  it("none of the new ops mutate the receiver", () => {
    const q = Quantity.of(9, "m^2");
    q.sqrt();
    q.reciprocal();
    q.sign();
    q.clamp(Quantity.of(1, "m^2"), Quantity.of(100, "m^2"));
    q.modulo(Quantity.of(4, "m^2"));
    q.roundTo("m^2");
    expect(q.value).toBe(9);
    expect(q.unit.symbol).toBe("m^2");
    // Transcendentals require dimensionless input — check separately.
    const d = Quantity.of(0.5, "fraction");
    d.sin();
    d.exp();
    expect(d.value).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Algebraic identities (property-style)
// ---------------------------------------------------------------------------

describe("Quantity algebraic identities", () => {
  it("a × 1 = a", () => {
    const a = Quantity.of(5, "kg");
    expect(a.multiply(Quantity.of(1, "fraction")).to("kg").value).toBeCloseTo(5, 12);
  });

  it("a / 1 = a", () => {
    const a = Quantity.of(5, "kg");
    expect(a.divide(Quantity.of(1, "fraction")).to("kg").value).toBeCloseTo(5, 12);
  });

  it("a × reciprocal(a) = 1 for nonzero a", () => {
    for (const v of [0.5, 2, 100, 0.001]) {
      const a = Quantity.of(v, "kg");
      const one = a.multiply(a.reciprocal());
      expect(one.isDimensionless()).toBe(true);
      expect(one.toBase().value).toBeCloseTo(1, 9);
    }
  });

  it("a + 0 = a (same unit zero)", () => {
    const a = Quantity.of(5, "kg");
    expect(a.add(Quantity.of(0, "kg")).value).toBe(5);
  });

  it("a - a = 0 with dimension preserved", () => {
    const z = Quantity.of(5, "m").subtract(Quantity.of(5, "m"));
    expect(z.value).toBe(0);
    expect(z.dimension).toEqual(Dim.Length);
  });

  it("pow round-trip via sqrt: sqrt(x^2) = |x|", () => {
    for (const v of [2, 0.5, 10]) {
      const r = Quantity.of(v, "m").pow(2).sqrt();
      expect(r.to("m").value).toBeCloseTo(Math.abs(v), 9);
    }
  });
});
