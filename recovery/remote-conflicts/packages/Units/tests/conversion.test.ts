/**
 * tests/conversion.test.ts — Phase 4: Universal Conversion Engine tests
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  makeUnit,
  Dim,
  UnitRegistry,
  UnsupportedUnitError,
  ImpossibleConversionError,
  ConversionError,
} from "../src/index.js";
import {
  convert,
  toBase,
  fromBase,
  areConvertible,
  getConversionPlan,
} from "../src/conversion-engine.js";
import { parseUnit } from "../src/unit-parser.js";

// Helpers
const EPS = 1e-9;
function close(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

// ---------------------------------------------------------------------------
// Same-unit optimization
// ---------------------------------------------------------------------------

describe("Conversion: same-unit optimization", () => {
  it("convert(x, A, A) returns x without transformation", () => {
    const kg = parseUnit("kg");
    expect(convert(42, kg, kg)).toBe(42);
    expect(convert(0, kg, kg)).toBe(0);
    expect(convert(-5, kg, kg)).toBe(-5);
  });

  it("Quantity.to same unit returns same value", () => {
    const q = Quantity.of(123, "kg");
    expect(q.to("kg").value).toBe(123);
  });

  it("preserves -0, NaN semantics for same-unit", () => {
    const kg = parseUnit("kg");
    expect(Object.is(convert(-0, kg, kg), -0)).toBe(true);
    expect(Number.isNaN(convert(NaN, kg, kg))).toBe(true);
    expect(convert(Infinity, kg, kg)).toBe(Infinity);
    expect(convert(-Infinity, kg, kg)).toBe(-Infinity);
  });
});

// ---------------------------------------------------------------------------
// Linear conversion
// ---------------------------------------------------------------------------

describe("Conversion: linear", () => {
  it("kg → g", () => {
    const kg = parseUnit("kg");
    const g = parseUnit("g");
    expect(close(convert(1, kg, g), 1000)).toBe(true);
    expect(close(convert(1, g, kg), 0.001)).toBe(true);
  });

  it("m → cm", () => {
    const m = parseUnit("m");
    const cm = parseUnit("cm");
    expect(close(convert(1, m, cm), 100)).toBe(true);
    expect(close(convert(100, cm, m), 1)).toBe(true);
  });

  it("day → hour", () => {
    const day = parseUnit("day");
    const hour = parseUnit("hour");
    expect(close(convert(1, day, hour), 24)).toBe(true);
    expect(close(convert(24, hour, day), 1)).toBe(true);
  });

  it("Mcal → Kcal and MJ", () => {
    const mcal = parseUnit("Mcal");
    const kcal = parseUnit("Kcal");
    const mj = parseUnit("MJ");
    expect(close(convert(1, mcal, kcal), 1000)).toBe(true);
    expect(close(convert(1, kcal, mcal), 0.001)).toBe(true);
    // Mcal → MJ: 1 / 0.239006
    expect(close(convert(1, mcal, mj), 1 / 0.239006, 1e-6)).toBe(true);
  });

  it("inverse conversion is exact within tolerance", () => {
    const kg = parseUnit("kg");
    const lb = parseUnit("lb");
    const original = 42.5;
    const converted = convert(original, kg, lb);
    const back = convert(converted, lb, kg);
    expect(close(back, original, 1e-9)).toBe(true);
  });

  it("base-unit path: g → kg via canonical base", () => {
    const g = parseUnit("g");
    const mg = parseUnit("mg");
    // g → base (kg) → mg
    expect(close(convert(1, g, mg), 1000)).toBe(true);
  });

  it("Quantity.to linear conversions", () => {
    expect(close(Quantity.of(1, "kg").to("g").value, 1000)).toBe(true);
    expect(close(Quantity.of(100, "cm").to("m").value, 1)).toBe(true);
    expect(close(Quantity.of(1, "day").to("hour").value, 24)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dimension validation
// ---------------------------------------------------------------------------

describe("Conversion: dimension validation", () => {
  it("rejects kg → m (Mass vs Length)", () => {
    const kg = parseUnit("kg");
    const m = parseUnit("m");
    expect(() => convert(1, kg, m)).toThrow(ImpossibleConversionError);
  });

  it("rejects Mcal → kg", () => {
    const mcal = parseUnit("Mcal");
    const kg = parseUnit("kg");
    expect(() => convert(1, mcal, kg)).toThrow(ImpossibleConversionError);
  });

  it("rejects incompatible Quantity.to", () => {
    expect(() => Quantity.of(1, "kg").to("m")).toThrow(ImpossibleConversionError);
    expect(() => Quantity.of(1, "Mcal").to("kg")).toThrow(ImpossibleConversionError);
  });

  it("validates before computing (no meaningless conversion)", () => {
    // Should throw before any numerical work
    const kg = parseUnit("kg");
    const s = parseUnit("s");
    expect(() => convert(NaN, kg, s)).toThrow(ImpossibleConversionError);
  });

  it("areConvertible returns false for incompatible dimensions", () => {
    expect(areConvertible(parseUnit("kg"), parseUnit("m"))).toBe(false);
    expect(areConvertible(parseUnit("kg"), parseUnit("g"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Affine conversion (temperature)
// ---------------------------------------------------------------------------

describe("Conversion: affine (temperature)", () => {
  it("0 °C = 273.15 K", () => {
    expect(close(convert(0, parseUnit("°C"), parseUnit("K")), 273.15)).toBe(true);
  });

  it("100 °C = 373.15 K", () => {
    expect(close(convert(100, parseUnit("°C"), parseUnit("K")), 373.15)).toBe(true);
  });

  it("0 K = -273.15 °C", () => {
    expect(close(convert(273.15, parseUnit("K"), parseUnit("°C")), 0)).toBe(true);
  });

  it("373.15 K = 100 °C", () => {
    expect(close(convert(373.15, parseUnit("K"), parseUnit("°C")), 100)).toBe(true);
  });

  it("32 °F = 273.15 K", () => {
    expect(close(convert(32, parseUnit("°F"), parseUnit("K")), 273.15, 1e-9)).toBe(true);
  });

  it("212 °F = 373.15 K", () => {
    expect(close(convert(212, parseUnit("°F"), parseUnit("K")), 373.15, 1e-9)).toBe(true);
  });

  it("0 °F ≈ 255.372222 K", () => {
    expect(close(convert(0, parseUnit("°F"), parseUnit("K")), 255.37222222222223, 1e-9)).toBe(true);
  });

  it("273.15 K = 32 °F", () => {
    expect(close(convert(273.15, parseUnit("K"), parseUnit("°F")), 32, 1e-9)).toBe(true);
  });

  it("373.15 K = 212 °F", () => {
    expect(close(convert(373.15, parseUnit("K"), parseUnit("°F")), 212, 1e-9)).toBe(true);
  });

  it("0 °C = 32 °F", () => {
    expect(close(convert(0, parseUnit("°C"), parseUnit("°F")), 32, 1e-9)).toBe(true);
  });

  it("100 °C = 212 °F", () => {
    expect(close(convert(100, parseUnit("°C"), parseUnit("°F")), 212, 1e-9)).toBe(true);
  });

  it("-40 °C = -40 °F", () => {
    expect(close(convert(-40, parseUnit("°C"), parseUnit("°F")), -40, 1e-9)).toBe(true);
  });

  it("Quantity.to with temperature", () => {
    expect(close(Quantity.of(0, "°C").to("K").value, 273.15)).toBe(true);
    expect(close(Quantity.of(212, "°F").to("K").value, 373.15, 1e-6)).toBe(true);
    expect(close(Quantity.of(100, "°C").to("°F").value, 212, 1e-6)).toBe(true);
  });

  it("toBase and fromBase are inverses", () => {
    const units = [parseUnit("K"), parseUnit("°C"), parseUnit("°F")];
    for (const u of units) {
      for (const v of [0, 100, -40, 273.15, 373.15]) {
        const base = toBase(v, u);
        const back = fromBase(base, u);
        expect(close(back, v, 1e-9)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe("Conversion: round-trip", () => {
  it("kg → g → kg", () => {
    const kg = parseUnit("kg");
    const g = parseUnit("g");
    for (const v of [0, 1, 0.001, 1000, 1e6, -5]) {
      expect(close(convert(convert(v, kg, g), g, kg), v, 1e-9)).toBe(true);
    }
  });

  it("m → cm → m", () => {
    const m = parseUnit("m");
    const cm = parseUnit("cm");
    for (const v of [0, 1, 0.01, 100, 1e6, -5]) {
      expect(close(convert(convert(v, m, cm), cm, m), v, 1e-9)).toBe(true);
    }
  });

  it("°C → K → °C", () => {
    const c = parseUnit("°C");
    const k = parseUnit("K");
    for (const v of [0, 100, -273.15, -40, 37]) {
      expect(close(convert(convert(v, c, k), k, c), v, 1e-9)).toBe(true);
    }
  });

  it("°F → K → °F", () => {
    const f = parseUnit("°F");
    const k = parseUnit("K");
    for (const v of [0, 32, 212, -40, 98.6]) {
      expect(close(convert(convert(v, f, k), k, f), v, 1e-9)).toBe(true);
    }
  });

  it("°C → °F → °C", () => {
    const c = parseUnit("°C");
    const f = parseUnit("°F");
    for (const v of [0, 100, -40, 37]) {
      expect(close(convert(convert(v, c, f), f, c), v, 1e-9)).toBe(true);
    }
  });

  it("Quantity round-trip via to()", () => {
    const q = Quantity.of(1.5, "kg");
    expect(close(q.to("g").to("kg").value, 1.5, 1e-9)).toBe(true);
    const t = Quantity.of(25, "°C");
    expect(close(t.to("K").to("°C").value, 25, 1e-9)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Numerical safety
// ---------------------------------------------------------------------------

describe("Conversion: numerical safety", () => {
  it("zero converts deterministically", () => {
    expect(convert(0, parseUnit("kg"), parseUnit("g"))).toBe(0);
    expect(close(convert(0, parseUnit("°C"), parseUnit("K")), 273.15)).toBe(true);
  });

  it("negative values where mathematically valid (mass, length linear)", () => {
    expect(close(convert(-1, parseUnit("kg"), parseUnit("g")), -1000)).toBe(true);
    expect(close(convert(-1, parseUnit("m"), parseUnit("cm")), -100)).toBe(true);
  });

  it("very small values", () => {
    expect(close(convert(1e-12, parseUnit("kg"), parseUnit("g")), 1e-9, 1e-18)).toBe(true);
    expect(close(convert(1e-9, parseUnit("m"), parseUnit("mm")), 1e-6, 1e-15)).toBe(true);
  });

  it("large values", () => {
    expect(close(convert(1e9, parseUnit("g"), parseUnit("kg")), 1e6)).toBe(true);
    expect(close(convert(1e6, parseUnit("m"), parseUnit("km")), 1000)).toBe(true);
  });

  it("NaN propagates through linear conversion", () => {
    const result = convert(NaN, parseUnit("kg"), parseUnit("g"));
    expect(Number.isNaN(result)).toBe(true);
  });

  it("Infinity propagates through linear conversion", () => {
    expect(convert(Infinity, parseUnit("kg"), parseUnit("g"))).toBe(Infinity);
    expect(convert(-Infinity, parseUnit("kg"), parseUnit("g"))).toBe(-Infinity);
  });

  it("does not silently normalize invalid numbers", () => {
    const kg = parseUnit("kg");
    const g = parseUnit("g");
    // NaN input should give NaN output, not 0 or some default
    expect(Number.isNaN(convert(NaN, kg, g))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("Conversion: determinism", () => {
  it("same inputs always produce same outputs", () => {
    const kg = parseUnit("kg");
    const g = parseUnit("g");
    const results = Array.from({ length: 10 }, () => convert(1.23456789, kg, g));
    expect(new Set(results).size).toBe(1);
  });

  it("temperature conversion is deterministic", () => {
    const c = parseUnit("°C");
    const k = parseUnit("K");
    const results = Array.from({ length: 10 }, () => convert(25, c, k));
    expect(new Set(results).size).toBe(1);
  });

  it("does not depend on registry insertion order", () => {
    const r1 = new UnitRegistry([]);
    r1.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 }));
    r1.register(makeUnit({ symbol: "g", dimension: Dim.Mass, toBaseFactor: 0.001 }));
    const r2 = new UnitRegistry([]);
    r2.register(makeUnit({ symbol: "g", dimension: Dim.Mass, toBaseFactor: 0.001 }));
    r2.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 }));
    // Both registries produce same parsed units for linear derived units
    const kg1 = r1.resolve("kg");
    const g1 = r1.resolve("g");
    const kg2 = r2.resolve("kg");
    const g2 = r2.resolve("g");
    expect(convert(1, kg1, g1)).toBe(convert(1, kg2, g2));
  });
});

// ---------------------------------------------------------------------------
// Conversion errors
// ---------------------------------------------------------------------------

describe("Conversion: errors", () => {
  it("throws UnsupportedUnitError for unknown unit via parseUnit", () => {
    expect(() => parseUnit("unknown_xyz")).toThrow(UnsupportedUnitError);
  });

  it("throws ImpossibleConversionError for incompatible dimensions", () => {
    expect(() => convert(1, parseUnit("kg"), parseUnit("m"))).toThrow(ImpossibleConversionError);
  });

  it("error contains source and target symbols", () => {
    try {
      convert(1, parseUnit("kg"), parseUnit("m"));
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ImpossibleConversionError);
      expect((e as Error).message).toContain("kg");
      expect((e as Error).message).toContain("m");
    }
  });

  it("Quantity.to with incompatible dimensions throws ImpossibleConversionError", () => {
    expect(() => Quantity.of(1, "kg").to("Mcal")).toThrow(ImpossibleConversionError);
  });

  it("Quantity with basis mismatch throws ConversionError", () => {
    // Only throws when BOTH have a basis and they differ; "% DM" → "%" (undefined) is allowed
    expect(() => Quantity.of(15, "% DM").to("%")).not.toThrow();
    // But "% DM" → "% asFed" should throw
    expect(() => Quantity.of(15, "% DM").to("% asFed")).toThrow(ConversionError);
    expect(() => Quantity.of(15, "% asFed").to("% DM")).toThrow(ConversionError);
  });

  it("does not leak internal details in error messages", () => {
    try {
      convert(1, parseUnit("kg"), parseUnit("m"));
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("toBase");
      expect(msg).not.toContain("fromBase");
    }
  });
});

// ---------------------------------------------------------------------------
// Base-unit helpers
// ---------------------------------------------------------------------------

describe("Conversion: toBase / fromBase", () => {
  it("toBase for linear unit is value × scale", () => {
    expect(toBase(2, parseUnit("kg"))).toBe(2);
    expect(close(toBase(1, parseUnit("g")), 0.001)).toBe(true);
    expect(close(toBase(100, parseUnit("cm")), 1)).toBe(true);
  });

  it("toBase for affine unit is value × scale + offset", () => {
    expect(close(toBase(0, parseUnit("°C")), 273.15)).toBe(true);
    expect(close(toBase(32, parseUnit("°F")), 273.15, 1e-9)).toBe(true);
  });

  it("fromBase is inverse of toBase", () => {
    for (const sym of ["kg", "g", "m", "cm", "K", "°C", "°F"]) {
      const u = parseUnit(sym);
      for (const v of [0, 1, -1, 100, -273.15]) {
        const base = toBase(v, u);
        const back = fromBase(base, u);
        expect(close(back, v, 1e-9)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Derived units via Quantity
// ---------------------------------------------------------------------------

describe("Conversion: derived / composite units", () => {
  it("g/day → kg/day conversion preserves dimension", () => {
    const q = Quantity.of(1000, "g/day");
    const kgDay = q.to("kg/day");
    expect(close(kgDay.value, 1)).toBe(true);
  });

  it("Mcal/kg conversions work generically", () => {
    // Test dimensionless ratio conversions as derived-unit sanity
    expect(close(Quantity.of(1, "%").to("fraction").value, 0.01)).toBe(true);
    expect(close(Quantity.of(1, "fraction").to("%").value, 100)).toBe(true);
  });

  it("supports length conversions among all atomic length units", () => {
    expect(close(Quantity.of(1, "m").to("cm").value, 100)).toBe(true);
    expect(close(Quantity.of(1, "m").to("mm").value, 1000)).toBe(true);
    expect(close(Quantity.of(1, "km").to("m").value, 1000)).toBe(true);
    expect(close(Quantity.of(1, "ft").to("m").value, 0.3048)).toBe(true);
    expect(close(Quantity.of(12, "in").to("ft").value, 1)).toBe(true);
  });

  it("supports time conversions", () => {
    expect(close(Quantity.of(1, "day").to("hour").value, 24)).toBe(true);
    expect(close(Quantity.of(60, "min").to("hour").value, 1)).toBe(true);
    expect(close(Quantity.of(3600, "s").to("hour").value, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property-based: linear round-trip invariance
// ---------------------------------------------------------------------------

describe("Conversion: property-based", () => {
  function makeRng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 0xffffffff;
    };
  }

  const rng = makeRng(0xbeef);
  const testValues = Array.from({ length: 50 }, () => (rng() - 0.5) * 2000);

  it("convert(x, A, A) = x for random values", () => {
    const kg = parseUnit("kg");
    for (const x of testValues) {
      expect(convert(x, kg, kg)).toBe(x);
    }
  });

  it("convert(convert(x, A, B), B, A) ≈ x for linear units", () => {
    const g = parseUnit("g");
    const kg = parseUnit("kg");
    for (const x of testValues) {
      const roundTrip = convert(convert(x, kg, g), g, kg);
      expect(close(roundTrip, x, 1e-9)).toBe(true);
    }
  });

  it("Quantity round-trip for linear units", () => {
    for (const x of testValues) {
      const q = Quantity.of(x, "kg");
      expect(close(q.to("g").to("kg").value, x, 1e-9)).toBe(true);
    }
  });

  it("convert is monotonic for linear units", () => {
    const kg = parseUnit("kg");
    const g = parseUnit("g");
    const values = [-100, -1, 0, 1, 100].map((v) => convert(v, kg, g));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]! > values[i - 1]!).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Security: no eval, no prototype pollution, no mutation
// ---------------------------------------------------------------------------

describe("Conversion: security", () => {
  it("does not use eval and does not mutate registry during conversion", () => {
    const registry = new UnitRegistry([]);
    registry.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 }));
    registry.register(makeUnit({ symbol: "g", dimension: Dim.Mass, toBaseFactor: 0.001 }));
    const snapshot = registry.size;
    const kg = registry.resolve("kg");
    const g = registry.resolve("g");
    convert(1, kg, g);
    convert(1000, g, kg);
    expect(registry.size).toBe(snapshot);
  });

  it("does not allow prototype pollution via unit symbol", () => {
    expect(() => parseUnit("__proto__")).toThrow(UnsupportedUnitError);
    // Ensure Object.prototype not polluted
    expect(({} as Record<string, unknown>).__proto__).toBe(Object.prototype);
  });

  it("conversion engine does not execute arbitrary functions from Unit", () => {
    // Units are frozen — cannot be polluted and conversion only reads .conversion
    const evil = makeUnit({
      symbol: "evil",
      dimension: Dim.Mass,
      toBaseFactor: 1,
    });
    expect(Object.isFrozen(evil)).toBe(true);
    expect(() => {
      (evil as unknown as Record<string, unknown>).evilFn = () => {
        throw new Error("should not be called");
      };
    }).toThrow();
    const kg = parseUnit("kg");
    // Should convert normally
    expect(close(convert(1, kg, evil), 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 16: plan cache identity hardening + registry-version scoping
// ---------------------------------------------------------------------------

describe("Conversion: plan cache correctness", () => {
  it("same id but different scales still converts (no false identity)", () => {
    const a = makeUnit({ id: "shared", symbol: "a", dimension: Dim.Mass, toBaseFactor: 1 });
    const b = makeUnit({ id: "shared", symbol: "b", dimension: Dim.Mass, toBaseFactor: 1000 });
    // Must NOT take the identity fast path: 1 a-unit = 0.001 b-units
    expect(convert(1, a, b)).toBeCloseTo(0.001, 12);
    const plan = getConversionPlan(a, b);
    expect(plan.sameUnit).toBe(false);
  });

  it("identical units hit the identity plan", () => {
    const kg = parseUnit("kg");
    expect(getConversionPlan(kg, kg).sameUnit).toBe(true);
    expect(convert(42, kg, kg)).toBe(42);
  });

  it("registry version scopes cached plans", () => {
    const kg = parseUnit("kg");
    const g = parseUnit("g");
    const p1 = getConversionPlan(kg, g, 1);
    const p2 = getConversionPlan(kg, g, 1);
    expect(p1).toBe(p2); // same version → cache hit
    const p3 = getConversionPlan(kg, g, 2);
    expect(p3).not.toBe(p1); // different version → fresh plan, same math
    expect(convert(1, kg, g)).toBeCloseTo(1000, 12);
  });
});
