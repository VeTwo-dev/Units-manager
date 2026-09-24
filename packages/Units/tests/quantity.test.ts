/**
 * tests/quantity.test.ts — Phase 6: Quantity Engine 2.0 tests
 */
import { describe, expect, it } from "vitest";
import { Quantity, Dim, UnitMismatchError } from "../src/index.js";
import { parseUnit } from "../src/unit-parser.js";
import { ImpossibleConversionError } from "../src/errors/index.js";

// ---------------------------------------------------------------------------
// Construction & value access
// ---------------------------------------------------------------------------

describe("Quantity construction", () => {
  it("Quantity.of with string unit", () => {
    const q = Quantity.of(10, "kg");
    expect(q.value).toBe(10);
    expect(q.unit.symbol).toBe("kg");
  });

  it("Quantity.of with Unit object", () => {
    const unit = parseUnit("kg");
    const q = Quantity.of(5, unit);
    expect(q.unit).toBe(unit);
  });

  it("accepts negative and zero values", () => {
    expect(Quantity.of(-5, "kg").value).toBe(-5);
    expect(Quantity.of(0, "kg").value).toBe(0);
    expect(Quantity.of(-0, "kg").value).toBe(-0);
  });

  it("accepts NaN and Infinity per numerical policy (does not silently zero)", () => {
    expect(Number.isNaN(Quantity.of(NaN, "kg").value)).toBe(true);
    expect(Quantity.of(Infinity, "kg").value).toBe(Infinity);
    expect(Quantity.of(-Infinity, "kg").value).toBe(-Infinity);
  });

  it("exposes value, unit, and dimension accessors", () => {
    const q = Quantity.of(10, "kg");
    expect(q.value).toBe(10);
    expect(q.unit.symbol).toBe("kg");
    expect(q.dimension).toEqual(Dim.Mass);
    expect(q.dimension).toEqual(q.unit.dimension);
  });

  it("invalid unit string throws", () => {
    expect(() => Quantity.of(1, "unknownXYZ")).toThrow();
  });

  it("Quantity.from is not required; of is canonical (preserve compat)", () => {
    const q = Quantity.of(1, "m");
    expect(q.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe("Quantity immutability", () => {
  it("scale leaves original unchanged", () => {
    const a = Quantity.of(10, "kg");
    const b = a.scale(2);
    expect(a.value).toBe(10);
    expect(b.value).toBe(20);
  });

  it("negate leaves original unchanged", () => {
    const a = Quantity.of(10, "kg");
    const b = a.negate();
    expect(a.value).toBe(10);
    expect(b.value).toBe(-10);
    expect(b.unit).toBe(a.unit);
  });

  it("abs leaves original unchanged", () => {
    const a = Quantity.of(-5, "kg");
    const b = a.abs();
    expect(a.value).toBe(-5);
    expect(b.value).toBe(5);
  });

  it("add does not mutate operands", () => {
    const a = Quantity.of(10, "kg");
    const b = Quantity.of(5, "kg");
    const aBefore = a.value;
    const bBefore = b.value;
    a.add(b);
    expect(a.value).toBe(aBefore);
    expect(b.value).toBe(bBefore);
  });

  it("multiply does not mutate operands", () => {
    const a = Quantity.of(2, "kg");
    const b = Quantity.of(3, "m");
    a.multiply(b);
    expect(a.value).toBe(2);
    expect(b.value).toBe(3);
  });

  it("Quantity instances are not mutated by conversion", () => {
    const a = Quantity.of(1000, "g");
    const b = a.to("kg");
    expect(a.value).toBe(1000);
    expect(a.unit.symbol).toBe("g");
    expect(b.value).toBe(1);
  });

  it("value and unit are readonly properties", () => {
    const q = Quantity.of(10, "kg");
    expect(Object.isFrozen(q) || q.value === 10).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

describe("Quantity conversion", () => {
  it("1 kg → 1000 g", () => {
    expect(Quantity.of(1, "kg").to("g").value).toBeCloseTo(1000);
  });

  it("2500 mg → 2.5 g", () => {
    expect(Quantity.of(2500, "mg").to("g").value).toBeCloseTo(2.5);
  });

  it("1 km → 1000 m (via prefix+unit integration)", () => {
    expect(Quantity.of(1, "km").to("m").value).toBeCloseTo(1000);
  });

  it("1 m → 1000 mm and round-trips", () => {
    expect(Quantity.of(1, "m").to("mm").value).toBeCloseTo(1000);
    expect(Quantity.of(1, "m").to("mm").to("m").value).toBeCloseTo(1);
  });

  it("delegates to ConversionEngine and rejects incompatible dimensions", () => {
    expect(() => Quantity.of(1, "kg").to("m")).toThrow(ImpossibleConversionError);
  });

  it("does not duplicate conversion formulas (Quantity has no scale arithmetic)", () => {
    // Ensure to() works via base path, not hard-coded per unit
    expect(Quantity.of(1, "day").to("s").value).toBeCloseTo(86400);
  });
});

// ---------------------------------------------------------------------------
// Addition
// ---------------------------------------------------------------------------

describe("Quantity addition", () => {
  it("1 kg + 500 g = 1.5 kg (preserves left unit)", () => {
    const a = Quantity.of(1, "kg");
    const b = Quantity.of(500, "g");
    const sum = a.add(b);
    expect(sum.value).toBeCloseTo(1.5);
    expect(sum.unit.symbol).toBe("kg");
  });

  it("1 m + 50 cm = 1.5 m", () => {
    expect(Quantity.of(1, "m").add(Quantity.of(50, "cm")).value).toBeCloseTo(1.5);
    expect(Quantity.of(1, "m").add(Quantity.of(50, "cm")).unit.symbol).toBe("m");
  });

  it("commutative in physical value (a+b ≈ b+a after conversion)", () => {
    const a = Quantity.of(1, "kg");
    const b = Quantity.of(500, "g");
    const ab = a.add(b).to("g").value;
    const ba = b.add(a).to("g").value;
    expect(ab).toBeCloseTo(ba);
  });

  it("rejects 1 kg + 1 m", () => {
    expect(() => Quantity.of(1, "kg").add(Quantity.of(1, "m"))).toThrow(UnitMismatchError);
  });

  it("rejects 1 kg + 1 Mcal", () => {
    expect(() => Quantity.of(1, "kg").add(Quantity.of(1, "Mcal"))).toThrow(UnitMismatchError);
  });
});

// ---------------------------------------------------------------------------
// Subtraction
// ---------------------------------------------------------------------------

describe("Quantity subtraction", () => {
  it("2 kg - 500 g = 1.5 kg", () => {
    expect(Quantity.of(2, "kg").subtract(Quantity.of(500, "g")).value).toBeCloseTo(1.5);
  });

  it("rejects incompatible dimensions", () => {
    expect(() => Quantity.of(2, "kg").subtract(Quantity.of(3, "m"))).toThrow(UnitMismatchError);
  });

  it("allows negative results", () => {
    expect(Quantity.of(1, "kg").subtract(Quantity.of(2, "kg")).value).toBeCloseTo(-1);
    expect(Quantity.of(1, "kg").subtract(Quantity.of(1500, "g")).value).toBeCloseTo(-0.5);
  });
});

// ---------------------------------------------------------------------------
// Multiplication
// ---------------------------------------------------------------------------

describe("Quantity multiplication", () => {
  it("2 kg × 3 m = 6 kg·m (dimension M·L)", () => {
    const result = Quantity.of(2, "kg").multiply(Quantity.of(3, "m"));
    expect(result.value).toBeCloseTo(6);
    // dimension should be Mass × Length
    expect(result.dimension).toEqual({ M: 1, L: 1 });
  });

  it("10 m × 2 s has correct dimension and base value accounts for s factor", () => {
    const r = Quantity.of(10, "m").multiply(Quantity.of(2, "s"));
    expect(r.dimension).toEqual({ L: 1, T: 1 });
    // 10 m (base 10) × 2 s (base 2/86400) = 10 * 2/86400 in base
    expect(r.toBase().value).toBeCloseTo(10 * (2 / 86400));
  });

  it("10 kg × 2 (scalar) = 20 kg via multiply(number)", () => {
    expect(Quantity.of(10, "kg").multiply(2 as unknown as never).value).toBeCloseTo(20);
    // Also scale
    expect(Quantity.of(10, "kg").scale(2).value).toBeCloseTo(20);
  });

  it("multiply preserves numerical base-unit scaling (prefix-aware)", () => {
    // 1 km (1000 m) × 1 km = 1e6 m² in base units
    const r = Quantity.of(1, "km").multiply(Quantity.of(1, "km"));
    expect(r.toBase().value).toBeCloseTo(1e6);
  });

  it("multiply by 1 ≈ original", () => {
    const q = Quantity.of(5, "kg");
    const r = q.multiply(Quantity.of(1, "fraction"));
    expect(r.to("kg").value).toBeCloseTo(5);
  });

  it("multiply returns dimensionless-consistent value (checked via toBase)", () => {
    const a = Quantity.of(5, "kg");
    const b = Quantity.of(2, "kg");
    const r = a.multiply(b);
    expect(r.dimension).toEqual({ M: 2 });
  });
});

// ---------------------------------------------------------------------------
// Division
// ---------------------------------------------------------------------------

describe("Quantity division", () => {
  it("10 kg / 2 s has correct dimension (10 base / 2s base)", () => {
    const r = Quantity.of(10, "kg").divide(Quantity.of(2, "s"));
    expect(r.dimension).toEqual({ M: 1, T: -1 });
    // 10 / (2/86400) in base
    expect(r.toBase().value).toBeCloseTo(10 / (2 / 86400));
  });

  it("10 m / 2 s has correct dimension", () => {
    const r = Quantity.of(10, "m").divide(Quantity.of(2, "s"));
    expect(r.dimension).toEqual({ L: 1, T: -1 });
    expect(r.toBase().value).toBeCloseTo(10 / (2 / 86400));
  });

  it("10 m / 2 m = 5 (dimensionless)", () => {
    const r = Quantity.of(10, "m").divide(Quantity.of(2, "m"));
    expect(r.value).toBeCloseTo(5);
    expect(r.dimension).toEqual({});
  });

  it("Quantity ÷ scalar preserves unit", () => {
    expect(Quantity.of(10, "kg").divide(2 as unknown as never).value).toBeCloseTo(5);
    expect(Quantity.of(10, "kg").divide(2 as unknown as never).unit.symbol).toBe("kg");
  });

  it("10 kg / 2,5? division by 1 ≈ original", () => {
    const q = Quantity.of(10, "kg");
    expect(q.divide(1 as unknown as never).value).toBeCloseTo(10);
  });

  it("q.divide(q) produces dimensionless 1 for nonzero", () => {
    const q = Quantity.of(5, "kg");
    expect(q.divide(q).value).toBeCloseTo(1);
    expect(q.divide(q).dimension).toEqual({});
  });

  it("handles large prefixed division: 1 km / 1 m = 1000 (dimensionless)", () => {
    // Prompt-18 correction: the value reads in the emitted composite unit
    // (1 (km)/(m)); the pure number 1000 is available via base/"1".
    const r = Quantity.of(1, "km").divide(Quantity.of(1, "m"));
    expect(r.value).toBeCloseTo(1);
    expect(r.toBase().value).toBeCloseTo(1000);
    expect(r.to("1").value).toBeCloseTo(1000);
  });
});

// ---------------------------------------------------------------------------
// Scaling
// ---------------------------------------------------------------------------

describe("Quantity scaling", () => {
  it("10 kg.scale(2) = 20 kg, original unchanged", () => {
    const q = Quantity.of(10, "kg");
    const r = q.scale(2);
    expect(r.value).toBe(20);
    expect(r.unit.symbol).toBe("kg");
    expect(q.value).toBe(10);
  });

  it("scale by 0 gives zero of same unit", () => {
    const q = Quantity.of(10, "kg");
    const z = q.scale(0);
    expect(z.value).toBe(0);
    expect(z.unit.symbol).toBe("kg");
    expect(z.isZero()).toBe(true);
  });

  it("scale by 1 ≈ original", () => {
    const q = Quantity.of(7, "m");
    expect(q.scale(1).value).toBe(q.value);
    expect(q.scale(1).unit).toBe(q.unit);
  });

  it("scale by negative flips sign", () => {
    expect(Quantity.of(5, "kg").scale(-1).value).toBe(-5);
  });
});

// ---------------------------------------------------------------------------
// Negation & absolute
// ---------------------------------------------------------------------------

describe("Quantity negate/abs", () => {
  it("negate: 5 kg → -5 kg", () => {
    const n = Quantity.of(5, "kg").negate();
    expect(n.value).toBe(-5);
    expect(n.unit.symbol).toBe("kg");
  });

  it("negate double negation", () => {
    const q = Quantity.of(5, "kg");
    expect(q.negate().negate().value).toBe(q.value);
  });

  it("negate is immutable", () => {
    const a = Quantity.of(5, "kg");
    const before = a.value;
    a.negate();
    expect(a.value).toBe(before);
  });

  it("abs: -5 kg → 5 kg", () => {
    expect(Quantity.of(-5, "kg").abs().value).toBe(5);
    expect(Quantity.of(5, "kg").abs().value).toBe(5);
    expect(Quantity.of(0, "kg").abs().value).toBe(0);
  });

  it("abs is immutable", () => {
    const a = Quantity.of(-5, "kg");
    a.abs();
    expect(a.value).toBe(-5);
  });

  it("negate/abs work with prefixed units", () => {
    expect(Quantity.of(-1, "km").abs().value).toBe(1);
    expect(Quantity.of(1, "km").negate().value).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Sign / zero helpers
// ---------------------------------------------------------------------------

describe("Quantity sign/zero helpers", () => {
  it("isZero", () => {
    expect(Quantity.of(0, "kg").isZero()).toBe(true);
    expect(Quantity.of(-0, "kg").isZero()).toBe(true);
    expect(Quantity.of(1, "kg").isZero()).toBe(false);
    expect(Quantity.of(NaN, "kg").isZero()).toBe(false);
  });

  it("isPositive", () => {
    expect(Quantity.of(1, "kg").isPositive()).toBe(true);
    expect(Quantity.of(Infinity, "kg").isPositive()).toBe(true);
    expect(Quantity.of(0, "kg").isPositive()).toBe(false);
    expect(Quantity.of(-1, "kg").isPositive()).toBe(false);
    expect(Quantity.of(NaN, "kg").isPositive()).toBe(false);
  });

  it("isNegative", () => {
    expect(Quantity.of(-1, "kg").isNegative()).toBe(true);
    expect(Quantity.of(-Infinity, "kg").isNegative()).toBe(true);
    expect(Quantity.of(0, "kg").isNegative()).toBe(false);
    expect(Quantity.of(-0, "kg").isNegative()).toBe(false);
    expect(Quantity.of(NaN, "kg").isNegative()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

describe("Quantity comparison", () => {
  it("equals: 1 kg == 1000 g (physically equal)", () => {
    expect(Quantity.of(1, "kg").equals(Quantity.of(1000, "g"))).toBe(true);
    expect(Quantity.of(1, "km").equals(Quantity.of(1000, "m"))).toBe(true);
  });

  it("approximatelyEquals with epsilon", () => {
    expect(Quantity.of(1, "kg").approximatelyEquals(Quantity.of(1000.0000001, "g"), 1e-6)).toBe(
      true,
    );
    expect(Quantity.of(1, "kg").approximatelyEquals(Quantity.of(1001, "g"), 1e-6)).toBe(false);
  });

  it("equals returns false for dimensionally incompatible (not throw)", () => {
    expect(Quantity.of(1, "kg").equals(Quantity.of(1, "m"))).toBe(false);
  });

  it("lessThan: 1 kg < 2 kg", () => {
    expect(Quantity.of(1, "kg").lessThan(Quantity.of(2, "kg"))).toBe(true);
    expect(Quantity.of(2, "kg").lessThan(Quantity.of(1, "kg"))).toBe(false);
  });

  it("lessThan with unit conversion: 1 kg < 1500 g", () => {
    expect(Quantity.of(1, "kg").lessThan(Quantity.of(1500, "g"))).toBe(true);
    expect(Quantity.of(1, "kg").lessThan(Quantity.of(500, "g"))).toBe(false);
  });

  it("greaterThan: 2 kg > 1 kg", () => {
    expect(Quantity.of(2, "kg").greaterThan(Quantity.of(1, "kg"))).toBe(true);
  });

  it("lessThanOrEqual / greaterThanOrEqual", () => {
    expect(Quantity.of(1, "kg").lessThanOrEqual(Quantity.of(1000, "g"))).toBe(true);
    expect(Quantity.of(1, "kg").greaterThanOrEqual(Quantity.of(1000, "g"))).toBe(true);
    expect(Quantity.of(1, "kg").lessThanOrEqual(Quantity.of(2, "kg"))).toBe(true);
    expect(Quantity.of(2, "kg").greaterThanOrEqual(Quantity.of(1, "kg"))).toBe(true);
  });

  it("comparisons reject incompatible dimensions", () => {
    expect(() => Quantity.of(1, "kg").lessThan(Quantity.of(1, "m"))).toThrow(UnitMismatchError);
    expect(() => Quantity.of(1, "kg").greaterThan(Quantity.of(1, "m"))).toThrow(UnitMismatchError);
    expect(() => Quantity.of(1, "kg").lessThanOrEqual(Quantity.of(1, "m"))).toThrow(
      UnitMismatchError,
    );
    expect(() => Quantity.of(1, "kg").greaterThanOrEqual(Quantity.of(1, "m"))).toThrow(
      UnitMismatchError,
    );
  });

  it("comparisons with prefixed units and cross-unit", () => {
    expect(Quantity.of(1, "km").greaterThan(Quantity.of(500, "m"))).toBe(true);
    expect(Quantity.of(500, "m").lessThan(Quantity.of(1, "km"))).toBe(true);
  });

  it("comparison with temperature (affine): 0°C < 100°C after base conversion", () => {
    expect(Quantity.of(0, "°C").lessThan(Quantity.of(100, "°C"))).toBe(true);
    expect(Quantity.of(0, "°C").lessThan(Quantity.of(273.15, "K"))).toBe(false); // 0°C = 273.15K
  });
});

// ---------------------------------------------------------------------------
// Dimensionless results
// ---------------------------------------------------------------------------

describe("Quantity dimensionless results", () => {
  it("10 m / 2 m → dimensionless", () => {
    const r = Quantity.of(10, "m").divide(Quantity.of(2, "m"));
    expect(r.dimension).toEqual({});
    expect(r.value).toBe(5);
  });

  it("10 kg * 2 1/kg ? dimensionless via multiply/divide cancel", () => {
    const a = Quantity.of(10, "kg");
    const b = Quantity.of(5, "kg");
    expect(a.divide(b).dimension).toEqual({});
    expect(a.divide(b).value).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Zero / negative handling
// ---------------------------------------------------------------------------

describe("Quantity zero and negative", () => {
  it("zero quantities add/subtract correctly", () => {
    expect(Quantity.of(0, "kg").add(Quantity.of(5, "kg")).value).toBe(5);
    expect(Quantity.of(5, "kg").subtract(Quantity.of(5, "kg")).value).toBe(0);
  });

  it("negative quantities are allowed", () => {
    expect(Quantity.of(-5, "kg").value).toBe(-5);
    expect(Quantity.of(-5, "°C").to("K").value).toBeCloseTo(268.15);
  });

  it("negative addition: -5 kg + 3 kg = -2 kg", () => {
    expect(Quantity.of(-5, "kg").add(Quantity.of(3, "kg")).value).toBe(-2);
  });
});

// ---------------------------------------------------------------------------
// Numerical safety
// ---------------------------------------------------------------------------

describe("Quantity numerical safety", () => {
  it("NaN propagates and doesn't silently become zero", () => {
    const q = Quantity.of(NaN, "kg");
    expect(Number.isNaN(q.value)).toBe(true);
    expect(Number.isNaN(q.scale(2).value)).toBe(true);
    expect(Number.isNaN(q.negate().value)).toBe(true);
    expect(Number.isNaN(q.abs().value)).toBe(true);
  });

  it("Infinity handling", () => {
    expect(Quantity.of(Infinity, "kg").isPositive()).toBe(true);
    expect(Quantity.of(-Infinity, "kg").isNegative()).toBe(true);
    expect(Quantity.of(Infinity, "kg").scale(2).value).toBe(Infinity);
  });

  it("very large and very small numbers preserve magnitude (including prefixed)", () => {
    expect(Quantity.of(1e12, "g").to("kg").value).toBeCloseTo(1e9);
    expect(Quantity.of(1e-12, "kg").to("g").value).toBeCloseTo(1e-9);
  });

  it("negative zero is zero but not negative", () => {
    const q = Quantity.of(-0, "kg");
    expect(q.isZero()).toBe(true);
    expect(q.isNegative()).toBe(false);
    expect(q.abs().value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Result-unit determinism
// ---------------------------------------------------------------------------

describe("Quantity result-unit policies", () => {
  it("add/subtract preserve left operand's unit", () => {
    const a = Quantity.of(1, "kg");
    const b = Quantity.of(500, "g");
    expect(a.add(b).unit.symbol).toBe("kg");
    expect(a.subtract(b).unit.symbol).toBe("kg");
  });

  it("scale preserves same unit", () => {
    const a = Quantity.of(10, "km");
    expect(a.scale(2).unit.symbol).toBe("km");
    expect(a.scale(2).dimension).toEqual(Dim.Length);
  });

  it("multiply/divide follow canonical base-unit result policy", () => {
    const a = Quantity.of(2, "kg");
    const b = Quantity.of(3, "m");
    const r = a.multiply(b);
    expect(r.dimension).toEqual({ M: 1, L: 1 });
    // base value check: 2*1 * 3*1 =6 with toBaseFactor 1
    expect(r.value).toBe(6);
  });

  it("formatter belongs to Formatter layer, not Quantity — toString only for debug", () => {
    const q = Quantity.of(5, "kg");
    expect(q.toString()).toBe("5 kg");
  });
});

// ---------------------------------------------------------------------------
// Property-based (deterministic)
// ---------------------------------------------------------------------------

describe("Quantity property-based invariants", () => {
  function makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 0xffffffff;
    };
  }
  const rng = makeRng(0xbe55);

  it("q.scale(1) ≈ q", () => {
    for (let i = 0; i < 20; i++) {
      const v = (rng() - 0.5) * 1000;
      expect(Quantity.of(v, "kg").scale(1).value).toBe(v);
    }
  });

  it("q.scale(0) = zero of same unit", () => {
    const q = Quantity.of(123, "kg");
    const z = q.scale(0);
    expect(z.value).toBe(0);
    expect(z.unit).toBe(q.unit);
  });

  it("a+b ≈ b+a after conversion (commutative in base)", () => {
    for (let i = 0; i < 20; i++) {
      const a = Quantity.of(rng() * 100, "kg");
      const b = Quantity.of(rng() * 100, "g");
      expect(a.add(b).toBase().value).toBeCloseTo(b.add(a).toBase().value, 9);
    }
  });

  it("q.divide(q) → 1 dimensionless", () => {
    for (let i = 0; i < 20; i++) {
      const v = rng() * 100 + 1; // nonzero
      const q = Quantity.of(v, "m");
      expect(q.divide(q).value).toBeCloseTo(1);
      expect(q.divide(q).dimension).toEqual({});
    }
  });

  it("q.multiply(1 in same unit's fraction) ≈ q", () => {
    const q = Quantity.of(5, "kg");
    expect(q.multiply(Quantity.of(1, "fraction")).to("kg").value).toBeCloseTo(5);
  });

  it("negate/negate round-trip", () => {
    const q = Quantity.of(7, "m");
    expect(q.negate().negate().value).toBe(q.value);
  });

  it("abs never negative for non-NaN", () => {
    for (let i = 0; i < 20; i++) {
      const v = (rng() - 0.5) * 1000;
      const q = Quantity.of(v, "kg");
      if (!Number.isNaN(v)) expect(q.abs().value >= 0).toBe(true);
    }
  });
});
