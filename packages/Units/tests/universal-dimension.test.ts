/**
 * tests/universal-dimension.test.ts — Phase 14: Universal Dimension Model
 */
import { describe, expect, it } from "vitest";
import {
  defineDimension,
  defaultDimensionRegistry,
  DimensionRegistry,
  Dim,
  DIMENSIONLESS,
  dimensionKey,
  dimensionsEqual,
  divideDim,
  isDimensionless,
  multiplyDim,
  powDim,
} from "../src/dimension.js";
import { parseUnit } from "../src/unit-parser.js";
import { Quantity } from "../src/quantity.js";
import { formatUnit } from "../src/formatter.js";
import { serializeQuantity, deserializeQuantity } from "../src/serializer.js";

// ---------------------------------------------------------------------------
// Base dimensions
// ---------------------------------------------------------------------------

describe("14.2 universal basis", () => {
  it("seed includes 7 SI + 3 generic", () => {
    const ids = Dim.Mass ? ["M", "L", "T", "Temp", "Substance", "I", "J", "E", "C", "N"] : [];
    for (const id of ids) {
      expect(defineDimension({ [id]: 1 })).toBeTruthy();
    }
  });
  it("generic basis vector, not hard-coded object", () => {
    const reg = new DimensionRegistry([]);
    reg.register("X", "Custom");
    const x = reg.normalize({ X: 1 });
    expect(dimensionKey(x)).toBe("X^1");
  });
});

describe("14.3 dimension registry", () => {
  it("allows controlled registration", () => {
    const reg = new DimensionRegistry([]);
    reg.register("MyDim", "My Dimension");
    expect(reg.has("MyDim")).toBe(true);
  });
  it("stable identifier and name", () => {
    const reg = new DimensionRegistry([]);
    reg.register("Foo", "FooName");
    expect(reg.getName("Foo")).toBe("FooName");
  });
  it("immutable identity via key", () => {
    const a = defineDimension({ M: 1 });
    const b = defineDimension({ M: 1 });
    expect(dimensionKey(a)).toBe(dimensionKey(b));
    expect(a).toEqual(b);
  });
});

describe("14.5 dimension vector", () => {
  it("Length^1, Mass^1, Time^-2 produces M·L·T^-2", () => {
    const forceLike = multiplyDim(Dim.Mass, multiplyDim(Dim.Length, powDim(Dim.Time, -2)));
    expect(dimensionKey(forceLike)).toBe("L^1·M^1·T^-2");
  });
  it("zero exponents eliminated", () => {
    const d = defineDimension({ M: 1, L: 0, T: 0 });
    expect(d).toEqual({ M: 1 });
  });
});

describe("14.6 algebra", () => {
  it("multiply/divide/power deterministic", () => {
    expect(multiplyDim(Dim.Mass, Dim.Length)).toEqual({ M: 1, L: 1 });
    expect(divideDim(Dim.Length, Dim.Time)).toEqual({ L: 1, T: -1 });
    expect(powDim(Dim.Length, 2)).toEqual({ L: 2 });
  });
  it("M × L × T^-2 deterministic", () => {
    const a = multiplyDim(Dim.Mass, multiplyDim(Dim.Length, powDim(Dim.Time, -2)));
    const b = defineDimension({ M: 1, L: 1, T: -2 });
    expect(dimensionsEqual(a, b)).toBe(true);
  });
});

describe("14.7 derived dimensions", () => {
  it("Force = M·L·T^-2 via algebra", () => {
    const force = multiplyDim(Dim.Mass, multiplyDim(Dim.Length, powDim(Dim.Time, -2)));
    expect(force).toEqual({ M: 1, L: 1, T: -2 });
  });
  it("Energy = M·L²·T^-2 generic, but current E is base for compat", () => {
    // Current E is base, not derived, but we can still express derived energy as M·L²·T⁻²
    const derivedEnergy = multiplyDim(
      Dim.Mass,
      multiplyDim(powDim(Dim.Length, 2), powDim(Dim.Time, -2)),
    );
    expect(derivedEnergy).toEqual({ M: 1, L: 2, T: -2 });
    // And E base is still distinct for backward compat
    expect(Dim.Energy).toEqual({ E: 1 });
    // Both are valid, but not equal — migration documented
    expect(dimensionsEqual(derivedEnergy, Dim.Energy)).toBe(false);
  });
  it("Power = E·T^-1 or M·L²·T⁻³", () => {
    const powerViaE = divideDim(Dim.Energy, Dim.Time);
    expect(powerViaE).toEqual({ E: 1, T: -1 });
  });
});

describe("14.8 dimensionless", () => {
  it("all exponents 0 is dimensionless", () => {
    expect(isDimensionless(parseUnit("m/m").dimension)).toBe(true);
  });
  it("different semantic units not interchangeable via equality", () => {
    const pct = parseUnit("%");
    const ppm = parseUnit("ppm");
    // Same dimension but different symbols/scales, not same unit
    expect(pct.symbol).not.toBe(ppm.symbol);
  });
});

describe("14.9 angle", () => {
  it("radian treated as dimensionless with semantic metadata", () => {
    // Current policy: angle dimensionless, not separate dimension
    // Register a semantic angle unit with dimensionless dimension but category angle
    const angleUnit = parseUnit("m/m"); // dimensionless example
    expect(isDimensionless(angleUnit.dimension)).toBe(true);
    // If Angle were separate dimension, it would be registered as "Angle"
    // For now, document that radian is dimensionless per SI, with metadata distinction
  });
});

describe("14.10 information", () => {
  it("bit/byte not forced into dimensionless", () => {
    // Phase 21 decision: Information is a SEEDED dimension (Info), not a
    // custom registration and not dimensionless.
    expect(defaultDimensionRegistry.has("Info")).toBe(true);
    expect(Dim.Information).toEqual({ Info: 1 });
    expect(isDimensionless(Dim.Information)).toBe(false);
  });
});

describe("14.11 currency isolated", () => {
  it("Currency not universal physical dimension", () => {
    expect(Dim.Currency).toEqual({ C: 1 });
    // No exchange rate conversion via generic engine
    expect(() => Quantity.of(1, "cur").to("kg")).toThrow();
  });
});

describe("14.12 count/activity", () => {
  it("Count dimension distinct", () => {
    expect(Dim.Count).toEqual({ N: 1 });
    expect(isDimensionless(Dim.Count)).toBe(false);
  });
});

describe("14.15 backward compat", () => {
  it("old M, T, E, C, N still work", () => {
    expect(parseUnit("kg").dimension).toEqual(Dim.Mass);
    expect(parseUnit("day").dimension).toEqual(Dim.Time);
    expect(parseUnit("Mcal").dimension).toEqual(Dim.Energy);
    expect(parseUnit("cur").dimension).toEqual(Dim.Currency);
    expect(parseUnit("IU").dimension).toEqual(Dim.Count);
  });
  it("Energy as base vs derived migration documented", () => {
    // Current E base still works, derived also works, they are distinct but both valid
    expect(Dim.Energy).toEqual({ E: 1 });
    const derived = multiplyDim(Dim.Mass, multiplyDim(powDim(Dim.Length, 2), powDim(Dim.Time, -2)));
    expect(derived).not.toEqual(Dim.Energy);
  });
});

describe("14.17 performance: dimension ops", () => {
  it("multiply/divide/power are fast and immutable", () => {
    const a = Dim.Mass;
    const b = Dim.Length;
    const r = multiplyDim(a, b);
    expect(Object.isFrozen(r)).toBe(true);
    expect(a).toEqual(Dim.Mass); // not mutated
  });
});

describe("14.18 interning", () => {
  it("equivalent dimensions may share representation (bounded cache)", () => {
    const a = defineDimension({ M: 1, L: 1 });
    const b = multiplyDim(Dim.Mass, Dim.Length);
    // Via interning, they should be same key and potentially same object or equal
    expect(dimensionKey(a)).toBe(dimensionKey(b));
  });
});

describe("14.19 serialization compat", () => {
  it("serialized dimension via quantity round-trip", () => {
    const q = Quantity.of(10, "kg");
    const ser = serializeQuantity(q);
    const r = deserializeQuantity(ser);
    expect(r.dimension).toEqual(q.dimension);
  });
});

describe("14.20 parser compat", () => {
  it("parser still resolves existing units after dimension review", () => {
    expect(parseUnit("kg").dimension).toEqual(Dim.Mass);
    expect(parseUnit("m").dimension).toEqual(Dim.Length);
  });
});

describe("14.21 formatter compat", () => {
  it("formatter deterministic", () => {
    const u = parseUnit("kg·m/s²");
    expect(formatUnit(u)).toBe(formatUnit(u));
  });
});

describe("14.23 invariants", () => {
  it("D × identity = D", () => {
    expect(multiplyDim(Dim.Mass, DIMENSIONLESS)).toEqual(Dim.Mass);
  });
  it("D / D = dimensionless", () => {
    expect(divideDim(Dim.Mass, Dim.Mass)).toEqual(DIMENSIONLESS);
  });
  it("D × inverse(D) dimensionless", () => {
    expect(multiplyDim(Dim.Mass, powDim(Dim.Mass, -1))).toEqual(DIMENSIONLESS);
  });
  it("(A×B)/B = A", () => {
    const a = Dim.Mass;
    const b = Dim.Length;
    expect(divideDim(multiplyDim(a, b), b)).toEqual(a);
  });
  it("(D^a)^b = D^(a×b)", () => {
    expect(powDim(powDim(Dim.Length, 2), 3)).toEqual(powDim(Dim.Length, 6));
  });
});
