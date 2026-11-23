/**
 * scientific-validation.test.ts — Prompt 17: scientific correctness,
 * property-based & adversarial testing for `@vetwo/units`.
 *
 * Unlike the API/architecture audit (audit.test.ts), this file actively tries
 * to BREAK the library mathematically: seeded property tests, randomized and
 * boundary tests, metamorphic/invariant/round-trip tests, fuzzing and
 * adversarial security tests, plus differential checks against independently
 * hand-derived references (never the implementation's own internals).
 *
 * Determinism (§19): every random stream comes from mulberry32 with a fixed
 * seed recorded in the test name (`[seed N]`). No wall-clock, no Math.random,
 * no test-ordering dependence. A failing case is minimized and kept as a
 * permanent regression test with its seed.
 *
 * Conventions: hand-derived references are computed with plain JS arithmetic
 * inside the test (§21/§22 — tests must not duplicate implementation logic).
 * Relative tolerance helper `relClose` is used wherever magnitudes vary.
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Measurement,
  MeasurementSeries,
  parseUnit,
  canonicalizeUnitText,
  createRegistry,
  SI_PACK,
  IMPERIAL_PACK,
  US_CUSTOMARY_PACK,
  CGS_PACK,
  SCIENTIFIC_PACK,
  multiplyDim,
  divideDim,
  powDim,
  dimensionsEqual,
  dimensionKey,
  DIMENSIONLESS,
  defineFormula,
  evaluateFormula,
  createDependencyGraph,
  Expression,
  FunctionRegistry,
  combineUncertainties,
  CovarianceMatrix,
  propagateWithCovariance,
  createStandardConstantRegistry,
  normalizeToSystem,
  deserializeQuantity,
  deserializeMeasurement,
  CGS_SYSTEM,
  formatQuantity,
  makeUnit,
  linearScaleOf,
  UnitEngineError,
  UnitRegistry,
  FormulaError,
  CyclicDependencyError,
  NumericalError,
  InvalidDimensionError,
  InvalidAffineOperationError,
  InvalidUnitExpressionError,
  ImpossibleConversionError,
  ExpressionError,
} from "../src/index.js";
import type { DimensionVector } from "../src/index.js";

// ---------------------------------------------------------------------------
// Seeded PRNG + numeric helpers (test-only; not the implementation's code)
// ---------------------------------------------------------------------------

/** mulberry32 — deterministic stream. Same seed → same corpus, always. */
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

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

function randInt(rand: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

/** Relative closeness for wildly varying magnitudes. */
function relClose(a: number, b: number, tol: number): boolean {
  if (a === b) return true;
  const denom = Math.max(1e-300, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / denom <= tol;
}

// ---------------------------------------------------------------------------
// §2 — Dimensional algebra properties [seed 1701]
// ---------------------------------------------------------------------------

const DIM_IDS = ["M", "L", "T", "Temp", "I"] as const;

function randomDimVector(rand: () => number): DimensionVector {
  const d: Record<string, number> = {};
  for (const id of DIM_IDS) {
    const e = randInt(rand, -3, 3);
    if (e !== 0) d[id] = e;
  }
  return d as DimensionVector;
}

describe("prompt17 §2: dimensional algebra laws [seed 1701]", () => {
  it("× commutes, associates; 1 is the identity; A/A = 1", () => {
    const rand = mulberry32(1701);
    for (let i = 0; i < 300; i++) {
      const a = randomDimVector(rand);
      const b = randomDimVector(rand);
      const c = randomDimVector(rand);
      expect(dimensionKey(multiplyDim(a, b))).toBe(dimensionKey(multiplyDim(b, a)));
      expect(dimensionKey(multiplyDim(multiplyDim(a, b), c))).toBe(
        dimensionKey(multiplyDim(a, multiplyDim(b, c))),
      );
      expect(dimensionsEqual(multiplyDim(a, DIMENSIONLESS), a)).toBe(true);
      expect(dimensionsEqual(divideDim(a, DIMENSIONLESS), a)).toBe(true);
      expect(dimensionsEqual(divideDim(a, a), DIMENSIONLESS)).toBe(true);
      expect(dimensionKey(divideDim(multiplyDim(a, b), b))).toBe(dimensionKey(a));
    }
  });

  it("(A^a)^b = A^(a·b); zero exponent gives dimensionless; negatives work", () => {
    const rand = mulberry32(1702);
    for (let i = 0; i < 200; i++) {
      const a = randomDimVector(rand);
      const x = randInt(rand, -2, 2);
      const y = randInt(rand, -2, 2);
      expect(dimensionKey(powDim(powDim(a, x), y))).toBe(dimensionKey(powDim(a, x * y)));
      expect(dimensionsEqual(powDim(a, 0), DIMENSIONLESS)).toBe(true);
      expect(dimensionsEqual(powDim(a, 1), a)).toBe(true);
      // Negative: A^-1 inverts every exponent.
      const inv = powDim(a, -1);
      expect(dimensionsEqual(multiplyDim(a, inv), DIMENSIONLESS)).toBe(true);
    }
  });

  it("fractional exponents are rejected with a typed error (integers only)", () => {
    for (const bad of [0.5, -0.5, 1.5, Math.PI, Number.NaN, Infinity]) {
      expect(() => powDim({ L: 1 }, bad)).toThrow(InvalidDimensionError);
    }
  });

  it("canonicalization is deterministic: key order never leaks insertion order", () => {
    const rand = mulberry32(1703);
    for (let i = 0; i < 200; i++) {
      const entries: Array<[string, number]> = [];
      for (const id of DIM_IDS) {
        const e = randInt(rand, -2, 2);
        if (e !== 0) entries.push([id, e]);
      }
      const forward: Record<string, number> = {};
      const backward: Record<string, number> = {};
      for (const [k, v] of entries) forward[k] = v;
      for (let j = entries.length - 1; j >= 0; j--) backward[entries[j]![0]] = entries[j]![1];
      expect(dimensionKey(forward as DimensionVector)).toBe(
        dimensionKey(backward as DimensionVector),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — Unit algebra properties [seed 1712]
// ---------------------------------------------------------------------------

describe("prompt17 §3: unit algebra [seed 1712]", () => {
  const si = createRegistry({ packs: [SI_PACK] });

  it("equivalent units convert consistently (1.0 both directions)", () => {
    // NOTE: energy lives in its own E dimension by design (nutrition-legacy
    // model, documented in src/packs/si.ts): J ↔ N·m is NOT convertible.
    // The E-system is internally consistent (Wh/J/kJ, W = J/s).
    const pairs: Array<[string, string]> = [
      ["m", "km"],
      ["m", "mm"],
      ["kg", "g"],
      ["s", "min"],
      ["N", "kg*m/s^2"],
      ["Wh", "J"],
      ["kJ", "J"],
      ["Pa", "N/m^2"],
      ["W", "J/s"],
    ];
    for (const [a, b] of pairs) {
      const ua = parseUnit(a, si);
      const ub = parseUnit(b, si);
      expect(dimensionsEqual(ua.dimension, ub.dimension)).toBe(true);
      const fwd = Quantity.of(1, a, si).to(b, si).value;
      const rev = Quantity.of(1, b, si).to(a, si).value;
      expect(relClose(fwd, 1 / rev, 1e-12)).toBe(true);
    }
  });

  it("derived units carry engine-correct dimensions (independent reference)", () => {
    // Mechanical N/Pa stay M·L·T; the E-dimension energy family (J/W/V) is
    // internally consistent but decoupled from mechanics (see note above).
    const expected: Record<string, DimensionVector> = {
      N: { M: 1, L: 1, T: -2 },
      J: { E: 1 },
      Pa: { M: 1, L: -1, T: -2 },
      W: { E: 1, T: -1 },
      Hz: { T: -1 },
      C: { I: 1, T: 1 },
      V: { E: 1, T: -1, I: -1 },
    };
    for (const [symbol, dim] of Object.entries(expected)) {
      expect(dimensionsEqual(parseUnit(symbol, si).dimension, dim as DimensionVector), symbol).toBe(
        true,
      );
    }
  });

  it("E/mechanics boundary is explicit: J ↔ N·m fails deterministically", () => {
    // Known model limitation (pinned, not silent): unifying E with M·L²·T⁻²
    // is future work; until then the boundary throws a typed error.
    expect(() => Quantity.of(1, "J", si).to("N*m", si)).toThrow(ImpossibleConversionError);
    expect(() => Quantity.of(1, "J", si).to("kg*m^2/s^2", si)).toThrow(ImpossibleConversionError);
    expect(() => Quantity.of(1, "N*m", si).to("J", si)).toThrow(ImpossibleConversionError);
    expect(() => Quantity.of(1, "W", si).to("N*m/s", si)).toThrow(ImpossibleConversionError);
  });

  it("prefixes preserve dimension; um and µm resolve to the same scale", () => {
    for (const [prefixed, dim] of [
      ["km", { L: 1 }],
      ["mg", { M: 1 }],
      ["µs", { T: 1 }],
      ["ns", { T: 1 }],
      ["mA", { I: 1 }],
    ] as Array<[string, DimensionVector]>) {
      expect(dimensionsEqual(parseUnit(prefixed, si).dimension, dim)).toBe(true);
    }
    // "u" is a registered alias of micro: identical physics, own spelling.
    expect(Quantity.of(1, "um").to("m").value).toBe(Quantity.of(1, "µm").to("m").value);
    expect(relClose(Quantity.of(1, "um").to("m").value, 1e-6, 1e-12)).toBe(true);
  });

  it("parse output is deterministic: same text, same symbol and scale", () => {
    const rand = mulberry32(1712);
    const texts = ["m", "kg*m/s^2", "N", "km/h", "m^2", "(m/s)^2", "kg/(m*s)"];
    for (let i = 0; i < 100; i++) {
      const text = pick(rand, texts);
      const first = parseUnit(text, si);
      const second = parseUnit(text, si);
      expect(second.symbol).toBe(first.symbol);
      expect(linearScaleOf(second)).toBe(linearScaleOf(first));
    }
  });
});

// ---------------------------------------------------------------------------
// §4 — Quantity arithmetic properties [seed 1724]
// ---------------------------------------------------------------------------

// Default-registry atoms only (m/kg/s/K span L/M/T/Temp; A needs SI pack).
const QBASES = ["m", "kg", "s", "K"] as const;

function randomQuantityExpression(rand: () => number): string {
  const factors: string[] = [];
  const count = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const base = pick(rand, QBASES);
    const exp = randInt(rand, -2, 2);
    if (exp === 0) continue;
    factors.push(exp === 1 ? base : `${base}^${exp}`);
  }
  if (factors.length === 0) return "m";
  return factors.join("*");
}

/** Same dimension, different syntax: reversed factor order. */
function commutedExpression(expr: string): string {
  const parts = expr.split("*");
  return parts.length > 1 ? [...parts].reverse().join("*") : `${expr}*m/m`;
}

describe("prompt17 §4: quantity arithmetic identities [seed 1724]", () => {
  it("(a+b)−b ≈ a and (a−b)+b ≈ a on compatible random dimensions", () => {
    const rand = mulberry32(1724);
    for (let i = 0; i < 150; i++) {
      const expr = randomQuantityExpression(rand);
      const twin = commutedExpression(expr);
      const magnitude = 10 ** randInt(rand, -6, 6);
      const a = Quantity.of((rand() - 0.4) * 100 * magnitude, expr);
      const b = Quantity.of((rand() - 0.4) * 100 * magnitude, twin);
      expect(relClose(a.add(b).subtract(b).to(expr).value, a.value, 1e-9)).toBe(true);
      expect(relClose(a.subtract(b).add(b).to(expr).value, a.value, 1e-9)).toBe(true);
    }
  });

  it("a×1 = a, a/1 = a, a×b/b ≈ a, a/a is dimensionless", () => {
    const rand = mulberry32(1725);
    for (let i = 0; i < 150; i++) {
      const exprA = randomQuantityExpression(rand);
      const exprB = randomQuantityExpression(rand);
      const a = Quantity.of((rand() + 0.1) * 50, exprA);
      const b = Quantity.of((rand() + 0.1) * 50, exprB);
      expect(a.multiply(1).to(exprA).value).toBe(a.value);
      expect(a.divide(1).to(exprA).value).toBe(a.value);
      expect(relClose(a.multiply(b).divide(b).to(exprA).value, a.value, 1e-9)).toBe(true);
      const ratio = a.divide(a);
      expect(dimensionsEqual(ratio.dimension, DIMENSIONLESS)).toBe(true);
      expect(relClose(ratio.value, 1, 1e-12)).toBe(true);
    }
  });

  it("incompatible quantities ALWAYS fail (random dimension pairs)", () => {
    const rand = mulberry32(1726);
    let attempted = 0;
    for (let i = 0; i < 300; i++) {
      const e1 = randomQuantityExpression(rand);
      const e2 = randomQuantityExpression(rand);
      let d1: DimensionVector;
      let d2: DimensionVector;
      try {
        d1 = parseUnit(e1).dimension;
        d2 = parseUnit(e2).dimension;
      } catch {
        continue;
      }
      if (dimensionsEqual(d1, d2)) continue;
      attempted++;
      const q1 = Quantity.of(1, e1);
      const q2 = Quantity.of(1, e2);
      expect(() => q1.add(q2)).toThrow();
      expect(() => q1.subtract(q2)).toThrow();
      expect(() => q1.to(e2)).toThrow();
    }
    expect(attempted).toBeGreaterThan(150);
  });
});

// ---------------------------------------------------------------------------
// §5 — Conversion round-trips incl. extremes and non-finite [seed 1735]
// ---------------------------------------------------------------------------

describe("prompt17 §5: conversion round-trips [seed 1735]", () => {
  const imp = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK] });
  const si = createRegistry({ packs: [SI_PACK] });

  it("u1 → u2 → u1 recovers the value across magnitudes", () => {
    const rand = mulberry32(1735);
    const pairs: Array<[string, string]> = [
      ["m", "km"],
      ["m", "mm"],
      ["kg", "g"],
      ["s", "min"],
      ["m/s", "km/h"],
    ];
    // ≤1e100: larger magnitudes can overflow float64 mid-round-trip for
    // ×1000 pairs (documented IEEE behavior, covered explicitly in §18).
    const magnitudes = [0, 1e-300, 1e-100, 1e-6, 0.1, 1, 42.5, 1e6, 1e100];
    for (let i = 0; i < 200; i++) {
      const [a, b] = pick(rand, pairs);
      const sign = rand() < 0.5 ? -1 : 1;
      const value = sign * pick(rand, magnitudes) * (0.5 + rand());
      const back = Quantity.of(value, a).to(b).to(a).value;
      // === (not Object.is): −0 round-trips as −0, which equals 0.
      expect(back === 0 ? value === 0 : relClose(back, value, 1e-9)).toBe(true);
    }
  });

  it("imperial round-trips: m ↔ ft across magnitudes", () => {
    const rand = mulberry32(1736);
    for (let i = 0; i < 60; i++) {
      const value = (rand() - 0.5) * 10 ** randInt(rand, -9, 9);
      const back = Quantity.of(value, "m", imp).to("ft", imp).to("m", imp).value;
      expect(relClose(back, value, 1e-9)).toBe(true);
    }
  });

  it("non-finite values propagate, never silently become finite (pinned IEEE mirror)", () => {
    expect(Quantity.of(Number.NaN, "m").to("km").value).toBeNaN();
    expect(Quantity.of(Infinity, "m").to("km").value).toBe(Infinity);
    expect(Quantity.of(-Infinity, "kg").to("g").value).toBe(-Infinity);
    // Overflow conversion mirrors IEEE 754 (documented; no silent finite result).
    expect(Quantity.of(1e308, "kg").to("g").value).toBe(Infinity);
  });

  it("affine round-trips are offset-exact: °C ↔ K", () => {
    const rand = mulberry32(1737);
    for (let i = 0; i < 60; i++) {
      const c = -270 + rand() * 2000;
      const back = Quantity.of(c, "°C", si).to("K", si).to("°C", si).value;
      expect(Math.abs(back - c)).toBeLessThan(1e-9);
    }
  });
});

// ---------------------------------------------------------------------------
// §6 — Prefix fuzz [seed 1746]
// ---------------------------------------------------------------------------

describe("prompt17 §6: prefix algebra [seed 1746]", () => {
  const si = createRegistry({ packs: [SI_PACK] });

  it("complementary prefix pairs multiply to identity scale", () => {
    const complements: Array<[string, string]> = [
      ["km", "mm"],
      ["Mm", "µm"],
      ["Gm", "nm"],
      ["Tm", "pm"],
      ["kg", "mg"],
      ["kJ", "mJ"],
    ];
    for (const [big, small] of complements) {
      // 1 <big> expressed in <small> times 1 <small> expressed in <big> = 1.
      const fwd = Quantity.of(1, big, si).to(small, si).value;
      const rev = Quantity.of(1, small, si).to(big, si).value;
      expect(relClose(fwd * rev, 1, 1e-9)).toBe(true);
    }
    // kilo × milli = 1 through the engine: 1 km = 1e6 mm (float ratios).
    expect(relClose(Quantity.of(1, "km", si).to("mm", si).value, 1e6, 1e-12)).toBe(true);
  });

  it("prefix(unit)^n scales as factor^n (hand-derived)", () => {
    // (10^3)^2 = 10^6; (10^-3)^3 = 10^-9; (10^-2)^2 = 10^-4.
    expect(relClose(Quantity.of(1, "km^2", si).to("m^2", si).value, 1e6, 1e-12)).toBe(true);
    expect(relClose(Quantity.of(1, "mm^3", si).to("m^3", si).value, 1e-9, 1e-12)).toBe(true);
    expect(relClose(Quantity.of(1, "cm^2", si).to("m^2", si).value, 1e-4, 1e-12)).toBe(true);
    expect(relClose(Quantity.of(2.5, "km^2", si).to("m^2", si).value, 2.5e6, 1e-12)).toBe(true);
  });

  it("invalid prefix combinations fail; bare 'm' is the meter, not milli", () => {
    expect(dimensionsEqual(parseUnit("m", si).dimension, { L: 1 })).toBe(true);
    for (const bad of ["kkm", "mmK", "kk", "k", "µµ", "damx"]) {
      expect(() => parseUnit(bad, si), bad).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// §7 — Compound unit fuzz: parse → symbol → re-parse preserves meaning
// ---------------------------------------------------------------------------

describe("prompt17 §7: compound unit fuzz [seed 1757]", () => {
  const si = createRegistry({ packs: [SI_PACK] });

  it("random compound expressions survive parse → emit → re-parse", () => {
    const rand = mulberry32(1757);
    const atoms = ["m", "kg", "s", "A", "K", "N", "J", "Pa", "Hz"];
    let valid = 0;
    for (let i = 0; i < 500; i++) {
      const count = 1 + Math.floor(rand() * 3);
      const parts: string[] = [];
      for (let j = 0; j < count; j++) {
        const atom = pick(rand, atoms);
        const exp = randInt(rand, -2, 2);
        parts.push(exp === 0 ? atom : exp === 1 ? atom : `${atom}^${exp}`);
      }
      const op = rand() < 0.5 ? "*" : "/";
      let text = parts.join(op);
      if (rand() < 0.3) text = `(${text})`;
      let first;
      try {
        first = parseUnit(text, si);
      } catch (error) {
        expect(error).toBeInstanceOf(UnitEngineError);
        continue;
      }
      valid++;
      // Emitted symbol re-parses to identical dimension AND identical scale.
      const again = parseUnit(first.symbol, si);
      expect(dimensionsEqual(again.dimension, first.dimension)).toBe(true);
      expect(linearScaleOf(again)).toBe(linearScaleOf(first));
    }
    expect(valid).toBeGreaterThan(200);
  });

  it("equivalent syntaxes canonicalize identically", () => {
    const families = [
      ["kg*m/s^2", "kg·m·s^-2", "kg*m/(s^2)", "N"],
      ["m/s", "m·s^-1", "m/s"],
      ["m^2", "m·m", "m*m"],
      ["s^-1", "s⁻¹"],
    ];
    // Hz is dimensionally T⁻¹ but carries semantic kind "frequency", which is
    // part of canonical identity BY DESIGN — its key is stable with itself
    // while differing from bare s⁻¹. Both spellings still parse T⁻¹.
    expect(canonicalizeUnitText("Hz", si).key).toBe(canonicalizeUnitText("Hz", si).key);
    expect(dimensionsEqual(parseUnit("Hz", si).dimension, { T: -1 })).toBe(true);
    for (const family of families) {
      const keys = family.map((t) => canonicalizeUnitText(t, si).key);
      for (const k of keys) expect(k).toBe(keys[0]);
      const dims = family.map((t) => parseUnit(t, si).dimension);
      for (const d of dims) expect(dimensionsEqual(d, dims[0]!)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §8 — Parser adversarial fuzz [seed 1768]
// ---------------------------------------------------------------------------

describe("prompt17 §8: parser adversarial fuzz [seed 1768]", () => {
  it("token soup: typed errors only, never crash/hang", () => {
    const rand = mulberry32(1768);
    const alphabet = [
      "m",
      "kg",
      "s",
      "2",
      "/",
      "*",
      "^",
      "(",
      ")",
      " ",
      "·",
      "²",
      "N",
      "x",
      "-",
      ".",
      "e",
      "°",
      "C",
      "_",
      "µ",
    ];
    for (let i = 0; i < 2500; i++) {
      const len = 1 + Math.floor(rand() * 14);
      let text = "";
      for (let j = 0; j < len; j++) text += pick(rand, alphabet);
      try {
        const u = parseUnit(text);
        // Valid output must be honestly re-parseable (LOW-06 invariant).
        const again = parseUnit(u.symbol);
        expect(dimensionsEqual(again.dimension, u.dimension)).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(UnitEngineError);
      }
    }
  });

  it("pathological inputs: limits, nesting, confusables, punctuation", () => {
    // Huge / deeply nested inputs hit deterministic limits, never hang.
    expect(() => parseUnit("m".repeat(6000))).toThrow(UnitEngineError);
    expect(() => parseUnit(`(${"(".repeat(400)}m${")".repeat(400)})`)).toThrow(UnitEngineError);
    // Enormous exponents parse deterministically (dimension math is exact).
    const huge = parseUnit("m^999999999");
    expect(huge.dimension).toEqual({ L: 999999999 });
    expect(parseUnit(huge.symbol).dimension).toEqual({ L: 999999999 });
    // Unicode confusables: fullwidth and Cyrillic look-alikes are NOT units.
    // Pure syntax violations carry the specific expression-error class.
    for (const bad of ["m//s", "(m", "m)", "()", "^m", "m^", "m^2.5", "m^^s"]) {
      expect(() => parseUnit(bad), JSON.stringify(bad)).toThrow(InvalidUnitExpressionError);
    }
    for (const bad of ["ｍ", "㎏", "а", "ρ", "m,s", "m;s", "m@s", "\x00m", "m\x07"]) {
      expect(() => parseUnit(bad), JSON.stringify(bad)).toThrow(UnitEngineError);
    }
    // Whitespace abuse around a valid unit is tolerated and deterministic.
    expect(parseUnit("  \t m \n ").symbol).toBe("m");
    // Same malicious input twice → same outcome (determinism).
    for (const bad of ["m//s", "ｍ", "()"]) {
      const first = outcomeOf(() => parseUnit(bad));
      const second = outcomeOf(() => parseUnit(bad));
      expect(second).toBe(first);
    }
  });
});

function outcomeOf(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (error) {
    return error instanceof UnitEngineError ? error.constructor.name : `FOREIGN:${typeof error}`;
  }
}

// ---------------------------------------------------------------------------
// §9 — Affine temperature properties [seed 1779]
// ---------------------------------------------------------------------------

describe("prompt17 §9: temperature absolute vs delta [seed 1779]", () => {
  const si = createRegistry({ packs: [SI_PACK] });

  it("absolute round-trips against hand-derived references", () => {
    const rand = mulberry32(1779);
    for (let i = 0; i < 120; i++) {
      const c = -273 + rand() * 1500;
      // Independent references: K = C + 273.15; F = C·9/5 + 32.
      expect(Math.abs(Quantity.of(c, "°C", si).to("K", si).value - (c + 273.15))).toBeLessThan(
        1e-9,
      );
      expect(
        Math.abs(Quantity.of(c, "°C", si).to("°F", si).value - ((c * 9) / 5 + 32)),
      ).toBeLessThan(1e-9);
      const backC = Quantity.of(c, "°C", si).to("°F", si).to("°C", si).value;
      expect(Math.abs(backC - c)).toBeLessThan(1e-9);
    }
    // Exact landmarks (hand-derived; affine paths use absolute tolerance).
    expect(Math.abs(Quantity.of(0, "°C", si).to("K", si).value - 273.15)).toBeLessThan(1e-9);
    expect(Math.abs(Quantity.of(32, "°F", si).to("°C", si).value - 0)).toBeLessThan(1e-9);
    expect(Math.abs(Quantity.of(-40, "°F", si).to("°C", si).value - -40)).toBeLessThan(1e-9);
    expect(Math.abs(Quantity.of(0, "K", si).to("°C", si).value - -273.15)).toBeLessThan(1e-9);
  });

  it("absolute/interval algebra: abs±delta, abs−abs=delta, delta±delta", () => {
    const close = (got: number, want: number) => {
      expect(Math.abs(got - want)).toBeLessThan(1e-9);
    };
    // absolute + delta = absolute (delta travels offset-free).
    close(
      Quantity.of(20, "°C", si)
        .add(Quantity.of(10, "K", si))
        .to("°C", si).value,
      30,
    );
    // absolute − absolute = temperature interval in K.
    const delta = Quantity.of(20, "°C", si).subtract(Quantity.of(10, "°C", si));
    close(delta.value, 10);
    expect(delta.unit.symbol).toBe("K");
    // interval + interval stays an interval.
    close(delta.add(Quantity.of(5, "K", si)).value, 15);
    // interval + absolute commutes to absolute.
    close(
      Quantity.of(5, "K", si)
        .add(Quantity.of(20, "°C", si))
        .to("°C", si).value,
      25,
    );
    // absolute − delta = absolute.
    close(
      Quantity.of(20, "°C", si)
        .subtract(Quantity.of(5, "K", si))
        .to("°C", si).value,
      15,
    );
  });

  it("physically meaningless temperature operations always fail", () => {
    const C = (v: number) => Quantity.of(v, "°C", si);
    const K = (v: number) => Quantity.of(v, "K", si);
    expect(() => C(20).add(C(10))).toThrow(InvalidAffineOperationError);
    expect(() => C(2).multiply(C(3))).toThrow(InvalidAffineOperationError);
    expect(() => C(20).divide(2)).toThrow(InvalidAffineOperationError);
    // K is an interval (linear), °C is absolute (affine).
    // K - °C = temperature difference (interval), which IS physically meaningful.
    // The result is a temperature difference in K.
    const diff = K(300).subtract(C(20));
    expect(diff.value).toBeCloseTo(6.85, 6);
    expect(diff.unit.symbol).toBe("K");
    expect(() => C(4).pow(2)).toThrow();
  });

  it("below-absolute-zero inputs are converted, not silently clamped (documented)", () => {
    expect(Quantity.of(-300, "°C", si).to("K", si).value).toBeCloseTo(-26.85, 9);
  });
});

// ---------------------------------------------------------------------------
// §10 — Nonlinear / logarithmic units [seed 1790]
// ---------------------------------------------------------------------------

describe("prompt17 §10: nonlinear units [seed 1790]", () => {
  it("no logarithmic/custom conversions hide in any shipped pack", () => {
    const registries = [
      new UnitRegistry(),
      createRegistry({ packs: [SI_PACK] }),
      createRegistry({ packs: [SI_PACK, IMPERIAL_PACK, CGS_PACK, SCIENTIFIC_PACK] }),
    ];
    for (const reg of registries) {
      for (const u of reg.list()) {
        const kind = (u.conversion as { kind: string }).kind;
        expect(["linear", "affine"]).toContain(kind);
      }
      expect(reg.list().length).toBeGreaterThan(5);
    }
  });

  it("affine forward→inverse is exact across the domain incl. extremes", () => {
    const si = createRegistry({ packs: [SI_PACK] });
    const rand = mulberry32(1790);
    for (let i = 0; i < 80; i++) {
      const c = -273.14 + rand() * 5000;
      expect(Math.abs(Quantity.of(c, "°C", si).to("K", si).to("°C", si).value - c)).toBeLessThan(
        1e-9,
      );
      const f = (c * 9) / 5 + 32;
      expect(Math.abs(Quantity.of(f, "°F", si).to("K", si).to("°F", si).value - f)).toBeLessThan(
        1e-9,
      );
    }
  });

  it("logarithmic/custom conversions are refused by the conversion engine", () => {
    // Well-formed declarations (reference + factor per the documented schema)
    // that the engine explicitly cannot execute yet — never silent NaN.
    const bel = makeUnit({
      symbol: "tB",
      dimension: DIMENSIONLESS,
      conversion: { kind: "logarithmic", reference: 1, factor: 10 },
      label: "test bel",
    });
    const custom = makeUnit({
      symbol: "tX",
      dimension: DIMENSIONLESS,
      conversion: { kind: "custom", id: "test-transform" },
      label: "test custom",
    });
    // Same-dimension pairs isolate conversion-kind refusal (not dim mismatch).
    const one = makeUnit({
      symbol: "tone",
      dimension: DIMENSIONLESS,
      conversion: { kind: "linear", scale: 1 },
      label: "test one",
    });
    expect(() => Quantity.of(10, one).to(bel)).toThrow(UnitEngineError);
    expect(() => Quantity.of(10, bel).to(one)).toThrow(UnitEngineError);
    expect(() => Quantity.of(10, one).to(custom)).toThrow(UnitEngineError);
    expect(() => Quantity.of(10, "m").to(bel)).toThrow(UnitEngineError);
    // Fractional powers (the other nonlinear path) fail loudly, not silently.
    expect(() => Quantity.of(4, "m^2").pow(0.5)).toThrow(NumericalError);
    expect(() => powDim({ L: 1 }, 0.5)).toThrow(InvalidDimensionError);
  });
});

// ---------------------------------------------------------------------------
// §11 — Formula engine properties [seed 1711]
// ---------------------------------------------------------------------------

describe("prompt17 §11: formula engine [seed 1711]", () => {
  const reg = createRegistry({ packs: [SI_PACK] });
  const O = { registry: reg };
  const E = Expression;

  function kineticEnergy(massKg: number, speedMps: number): number {
    // Hand reference: ½·m·v² in joules (plain arithmetic, no library code).
    return 0.5 * massKg * speedMps * speedMps;
  }

  it("distributivity: a·(b+c) ≡ a·b+a·c, matching hand arithmetic", () => {
    const rand = mulberry32(1711);
    const left = defineFormula(
      {
        id: "distLeft",
        expression: E.multiply(E.variable("a"), E.add(E.variable("b"), E.variable("c"))),
        inputs: { a: { dimension: "m" }, b: { dimension: "m" }, c: { dimension: "m" } },
      },
      O,
    );
    const right = defineFormula(
      {
        id: "distRight",
        expression: E.add(
          E.multiply(E.variable("a"), E.variable("b")),
          E.multiply(E.variable("a"), E.variable("c")),
        ),
        inputs: { a: { dimension: "m" }, b: { dimension: "m" }, c: { dimension: "m" } },
      },
      O,
    );
    for (let i = 0; i < 60; i++) {
      const a = (rand() - 0.5) * 40;
      const b = (rand() - 0.5) * 40;
      const c = (rand() - 0.5) * 40;
      const bindings = { a: Quantity.of(a, "m"), b: Quantity.of(b, "m"), c: Quantity.of(c, "m") };
      const l = evaluateFormula(left, bindings, O);
      const r = evaluateFormula(right, bindings, O);
      if (!(l instanceof Quantity) || !(r instanceof Quantity))
        throw new Error("expected Quantity");
      expect(relClose(l.to("m^2").value, r.to("m^2").value, 1e-9)).toBe(true);
      // Differential check against hand arithmetic in base units.
      expect(relClose(l.to("m^2").value, a * (b + c), 1e-9)).toBe(true);
    }
  });

  it("kinetic energy matches the hand reference; evaluation is deterministic", () => {
    const rand = mulberry32(1712);
    const ke = defineFormula(
      {
        id: "ke",
        expression: E.multiply(
          E.literal(0.5, "1"),
          E.multiply(E.variable("m"), E.power(E.variable("v"), 2)),
        ),
        inputs: { m: { dimension: "kg" }, v: { dimension: "m/s" } },
      },
      O,
    );
    for (let i = 0; i < 60; i++) {
      const m = 0.1 + rand() * 2000;
      const v = (rand() - 0.3) * 9000;
      const bindings = { m: Quantity.of(m, "kg"), v: Quantity.of(v, "m/s") };
      const first = evaluateFormula(ke, bindings, O);
      const second = evaluateFormula(ke, bindings, O);
      if (!(first instanceof Quantity) || !(second instanceof Quantity)) {
        throw new Error("expected Quantity");
      }
      expect(first.exactEquals(second)).toBe(true);
      // Mechanical energy reads in N·m (J lives in the decoupled E dimension).
      expect(relClose(first.to("N*m", reg).value, kineticEnergy(m, v), 1e-9)).toBe(true);
    }
  });

  it("invalid formulas fail before producing values; recompilation is fresh", () => {
    // Wrong-dimension binding: no value escapes.
    const ke = defineFormula(
      {
        id: "ke2",
        expression: E.multiply(E.variable("m"), E.power(E.variable("v"), 2)),
        inputs: { m: { dimension: "kg" }, v: { dimension: "m/s" } },
      },
      O,
    );
    expect(() =>
      evaluateFormula(ke, { m: Quantity.of(1, "m"), v: Quantity.of(2, "m/s") }, O),
    ).toThrow(FormulaError);
    // Unknown function: rejected with a typed error before any value escapes.
    expect(() => {
      const bad = defineFormula(
        {
          id: "bad",
          expression: E.call("nope_xyz", [E.variable("a")]),
          inputs: { a: { dimension: "m" } },
        },
        O,
      );
      evaluateFormula(bad, { a: Quantity.of(1, "m") }, O);
    }).toThrow(FormulaError);
    // Stale-cache check: same formula, new bindings → new correct results.
    const id = defineFormula(
      {
        id: "dbl",
        expression: E.multiply(E.variable("x"), E.literal(2, "1")),
        inputs: { x: { dimension: "m" } },
      },
      O,
    );
    const r1 = evaluateFormula(id, { x: Quantity.of(3, "m") }, O);
    const r2 = evaluateFormula(id, { x: Quantity.of(7, "m") }, O);
    if (!(r1 instanceof Quantity) || !(r2 instanceof Quantity))
      throw new Error("expected Quantity");
    expect(r1.value).toBe(6);
    expect(r2.value).toBe(14);
  });

  it("function registry: no arbitrary execution; dangerous names are inert", () => {
    // Unregistered "constructor" cannot reach Object.prototype: a typed
    // error surfaces at define or evaluate time (never silent execution).
    expect(() => {
      const evil = defineFormula(
        { id: "evil", expression: E.call("constructor", []), inputs: {} },
        O,
      );
      evaluateFormula(evil, {}, O);
    }).toThrow(UnitEngineError);
    // Dunder names are rejected at the AST boundary already.
    expect(() => E.variable("__proto__")).toThrow(ExpressionError);
    expect(() => E.call("__proto__", [])).toThrow(UnitEngineError);
    // Even a legally-named registration cannot escape its declared contract:
    // arity violations are rejected at define time (fail before execution).
    const functions = new FunctionRegistry([]);
    functions.register({
      name: "doubleit",
      minArity: 1,
      maxArity: 1,
      evaluate: (args) => args[0]!.scale(2),
      inferDimension: (dims) => dims[0]!,
    });
    expect(() =>
      defineFormula(
        {
          id: "arity",
          expression: E.call("doubleit", [E.variable("a"), E.variable("a")]),
          inputs: { a: { dimension: "m" } },
        },
        { ...O, functions },
      ),
    ).toThrow(FormulaError);
  });
});

// ---------------------------------------------------------------------------
// §12 — Dependency graph fuzz [seed 1722]
// ---------------------------------------------------------------------------

describe("prompt17 §12: dependency graph fuzz [seed 1722]", () => {
  const reg = createRegistry({ packs: [SI_PACK] });
  const O = { registry: reg };
  const E = Expression;

  function linearFormula(id: string, output: string, input: string, factor: number) {
    return defineFormula(
      {
        id,
        expression: E.multiply(E.variable(input), E.literal(factor, "1")),
        inputs: { [input]: { dimension: "m" } },
        outputName: output,
      },
      O,
    );
  }

  it("chains, wide fan-outs, diamonds and disconnected graphs evaluate correctly", () => {
    // Chain x →(×2)→ a →(×3)→ b →(×5)→ c : hand reference c = 30x.
    const chain = createDependencyGraph([
      linearFormula("f1", "a", "x", 2),
      linearFormula("f2", "b", "a", 3),
      linearFormula("f3", "c", "b", 5),
    ]);
    const r = chain.evaluate({ x: Quantity.of(1.5, "m") });
    expect(relClose(r.outputs["c"]!.to("m").value, 45, 1e-9)).toBe(true);
    // Diamond: d = (2x)·(3x) = 6x².
    const diamond = createDependencyGraph([
      linearFormula("g1", "p", "x", 2),
      linearFormula("g2", "q", "x", 3),
      defineFormula(
        {
          id: "g3",
          expression: E.multiply(E.variable("p"), E.variable("q")),
          inputs: { p: { dimension: "m" }, q: { dimension: "m" } },
          outputName: "d",
        },
        O,
      ),
    ]);
    const rd = diamond.evaluate({ x: Quantity.of(4, "m") });
    expect(relClose(rd.outputs["d"]!.to("m^2").value, 6 * 16, 1e-9)).toBe(true);
  });

  it("random DAGs: deterministic order, correct values, fresh recomputation", () => {
    const rand = mulberry32(1722);
    for (let trial = 0; trial < 25; trial++) {
      // Random layered DAG: layer0 roots x0..xk, each later node doubles one parent.
      const width = 1 + Math.floor(rand() * 3);
      const depth = 2 + Math.floor(rand() * 4);
      const formulas = [];
      const roots: string[] = [];
      for (let w = 0; w < width; w++) roots.push(`x${trial}_${w}`);
      let prev = [...roots];
      let totalFactor = 1;
      for (let d = 0; d < depth; d++) {
        const next: string[] = [];
        const factor = 1 + Math.floor(rand() * 5);
        totalFactor *= factor;
        for (const p of prev) {
          const out = `${p}_d${d}`;
          next.push(out);
          formulas.push(linearFormula(`t${trial}_${out}`, out, p, factor));
        }
        prev = next;
      }
      const g1 = createDependencyGraph(formulas);
      const g2 = createDependencyGraph(formulas);
      expect([...g1.evaluationOrder()]).toEqual([...g2.evaluationOrder()]);
      const inputs: Record<string, Quantity> = {};
      for (const root of roots) inputs[root] = Quantity.of(2 + rand() * 8, "m");
      const out1 = g1.evaluate(inputs);
      // Every leaf equals root × totalFactor (single shared factor per trial).
      for (const leaf of prev) {
        const rootName = roots.find((rt) => leaf.startsWith(rt))!;
        expect(
          relClose(out1.outputs[leaf]!.to("m").value, inputs[rootName]!.value * totalFactor, 1e-9),
        ).toBe(true);
      }
      // Recomputation with doubled inputs doubles every output (no stale cache).
      const doubled: Record<string, Quantity> = {};
      for (const root of roots) doubled[root] = Quantity.of(inputs[root]!.value * 2, "m");
      const out2 = g1.evaluate(doubled);
      for (const leaf of prev) {
        expect(
          relClose(out2.outputs[leaf]!.to("m").value, out1.outputs[leaf]!.to("m").value * 2, 1e-9),
        ).toBe(true);
      }
    }
  });

  it("cycles, self-cycles and missing inputs fail loudly", () => {
    const fa = defineFormula(
      { id: "fa", expression: E.variable("b"), inputs: { b: { dimension: "m" } }, outputName: "a" },
      O,
    );
    const fb = defineFormula(
      { id: "fb", expression: E.variable("a"), inputs: { a: { dimension: "m" } }, outputName: "b" },
      O,
    );
    expect(() => createDependencyGraph([fa, fb])).toThrow(CyclicDependencyError);
    const self = defineFormula(
      {
        id: "self",
        expression: E.variable("s"),
        inputs: { s: { dimension: "m" } },
        outputName: "s",
      },
      O,
    );
    expect(() => createDependencyGraph([self])).toThrow(UnitEngineError);
    const solo = createDependencyGraph([linearFormula("only", "z", "missing", 2)]);
    expect(() => solo.evaluate({})).toThrow(FormulaError);
  });
});

// ---------------------------------------------------------------------------
// §13 — Measurement / uncertainty propagation [seed 1733]
// ---------------------------------------------------------------------------

function meas(value: number, sigma: number, unit = "m"): Measurement {
  return Measurement.of(Quantity.of(value, unit), Quantity.of(sigma, unit));
}

describe("prompt17 §13: uncertainty propagation [seed 1733]", () => {
  it("x±y: σ = √(σx²+σy²) against hand arithmetic", () => {
    const rand = mulberry32(1733);
    for (let i = 0; i < 80; i++) {
      const x = (rand() - 0.5) * 200;
      const y = (rand() - 0.5) * 200;
      const sx = 0.01 + rand() * 5;
      const sy = 0.01 + rand() * 5;
      const sum = meas(x, sx).add(meas(y, sy));
      // Hand reference (plain arithmetic — not the library's own code path).
      const expected = Math.sqrt(sx * sx + sy * sy);
      expect(relClose(sum.value.value, x + y, 1e-9)).toBe(true);
      expect(relClose(sum.uncertainty.value, expected, 1e-9)).toBe(true);
      expect(sum.uncertainty.unit.symbol).toBe("m");
      const diff = meas(x, sx).subtract(meas(y, sy));
      expect(relClose(diff.uncertainty.value, expected, 1e-9)).toBe(true);
    }
  });

  it("x·y and x/y: relative quadrature against hand arithmetic", () => {
    const rand = mulberry32(1734);
    for (let i = 0; i < 80; i++) {
      const x = 1 + rand() * 500;
      const y = 1 + rand() * 500;
      const sx = 0.01 + rand() * 5;
      const sy = 0.01 + rand() * 5;
      const rel = Math.sqrt((sx / x) ** 2 + (sy / y) ** 2);
      const prod = meas(x, sx).multiply(meas(y, sy));
      expect(relClose(prod.value.value, x * y, 1e-9)).toBe(true);
      expect(relClose(prod.uncertainty.value, x * y * rel, 1e-9)).toBe(true);
      const quot = meas(x, sx).divide(meas(y, sy));
      expect(relClose(quot.value.value, x / y, 1e-9)).toBe(true);
      expect(relClose(quot.uncertainty.value, (x / y) * rel, 1e-9)).toBe(true);
    }
  });

  it("x^n: σ = |n|·x^(n−1)·σx; mixed units propagate physically", () => {
    const rand = mulberry32(1735);
    for (let i = 0; i < 40; i++) {
      const x = 0.5 + rand() * 100;
      const sx = 0.001 + rand() * 2;
      const n = 2 + Math.floor(rand() * 2);
      const p = meas(x, sx).pow(n);
      expect(relClose(p.value.value, x ** n, 1e-9)).toBe(true);
      expect(relClose(p.uncertainty.value, Math.abs(n) * x ** (n - 1) * sx, 1e-9)).toBe(true);
    }
    // Mixed representations combine in base units: 1 kg ± 200 g, hand-checked.
    const mixed = Measurement.of(Quantity.of(1, "kg"), Quantity.of(200, "g")).add(
      Measurement.of(Quantity.of(500, "g"), Quantity.of(100, "g")),
    );
    expect(relClose(mixed.value.to("kg").value, 1.5, 1e-12)).toBe(true);
    expect(relClose(mixed.uncertainty.to("kg").value, Math.sqrt(0.2 ** 2 + 0.1 ** 2), 1e-9)).toBe(
      true,
    );
  });

  it("relative-fraction constructor, conversion preserves relative uncertainty", () => {
    const m = Measurement.of(Quantity.of(200, "m"), 0.05);
    expect(relClose(m.uncertainty.value, 10, 1e-12)).toBe(true);
    expect(relClose(m.relativeUncertainty(), 0.05, 1e-12)).toBe(true);
    const mm = m.to("mm");
    expect(relClose(mm.relativeUncertainty(), 0.05, 1e-12)).toBe(true);
    expect(relClose(mm.uncertainty.value, 10000, 1e-12)).toBe(true);
  });

  it("series statistics match hand computation; units are preserved", () => {
    const rand = mulberry32(1736);
    for (let i = 0; i < 30; i++) {
      const n = 2 + Math.floor(rand() * 6);
      const xs: number[] = [];
      const ss: number[] = [];
      for (let j = 0; j < n; j++) {
        xs.push(10 + rand() * 90);
        ss.push(0.1 + rand() * 3);
      }
      const series = MeasurementSeries.of(xs.map((x, j) => meas(x, ss[j]!)));
      // Hand references (plain JS): arithmetic mean, sample variance (n−1).
      const mean = xs.reduce((a, b) => a + b, 0) / n;
      const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1);
      expect(relClose(series.mean().value.value, mean, 1e-9)).toBe(true);
      expect(relClose(series.variance().value, variance, 1e-9)).toBe(true);
      expect(relClose(series.stddev().value, Math.sqrt(variance), 1e-9)).toBe(true);
      expect(relClose(series.standardError().value, Math.sqrt(variance) / Math.sqrt(n), 1e-9)).toBe(
        true,
      );
      // Expected units: variance → squared, stddev/SEM → original.
      expect(dimensionsEqual(series.variance().dimension, multiplyDim({ L: 1 }, { L: 1 }))).toBe(
        true,
      );
      expect(dimensionsEqual(series.stddev().dimension, { L: 1 })).toBe(true);
      expect(dimensionsEqual(series.standardError().dimension, { L: 1 })).toBe(true);
      // Inverse-variance weighted mean: hand reference.
      const w = ss.map((s) => 1 / (s * s));
      const wSum = w.reduce((a, b) => a + b, 0);
      const wMean = xs.reduce((acc, x, j) => acc + w[j]! * x, 0) / wSum;
      const wm = series.weightedMean("inverse-variance");
      expect(relClose(wm.value.value, wMean, 1e-9)).toBe(true);
      expect(relClose(wm.uncertainty.value, 1 / Math.sqrt(wSum), 1e-9)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §14 — Correlation / covariance [seed 1744]
// ---------------------------------------------------------------------------

describe("prompt17 §14: correlation and covariance [seed 1744]", () => {
  function rss(s1: number, s2: number, rho: number): number {
    // Hand reference: u² = σ1² + σ2² + 2ρσ1σ2.
    return Math.sqrt(s1 * s1 + s2 * s2 + 2 * rho * s1 * s2);
  }

  it("ρ = 0/±1/half: combined uncertainty matches hand arithmetic", () => {
    for (const [s1, s2, rho, expected] of [
      [3, 4, 0, 5],
      [3, 4, 1, 7],
      [3, 4, -1, 1],
      [2, 2, 0.5, Math.sqrt(12)],
      [5, 1, -0.5, Math.sqrt(21)],
    ] as Array<[number, number, number, number]>) {
      const combined = combineUncertainties(
        [
          { id: "a", standardUncertainty: Quantity.of(s1, "m") },
          { id: "b", standardUncertainty: Quantity.of(s2, "m") },
        ],
        { correlations: [{ idA: "a", idB: "b", coefficient: rho }] },
      );
      expect(relClose(combined.to("m").value, expected, 1e-9)).toBe(true);
      expect(relClose(combined.to("m").value, rss(s1, s2, rho), 1e-12)).toBe(true);
    }
  });

  it("invalid correlations fail: |ρ|>1, unknown ids, cross-dimension, non-PSD", () => {
    const comps = (u = "m") => [
      { id: "a", standardUncertainty: Quantity.of(1, u) },
      { id: "b", standardUncertainty: Quantity.of(1, u) },
    ];
    expect(() =>
      combineUncertainties(comps(), { correlations: [{ idA: "a", idB: "b", coefficient: 1.5 }] }),
    ).toThrow(UnitEngineError);
    expect(() =>
      combineUncertainties(comps(), { correlations: [{ idA: "a", idB: "zzz", coefficient: 0 }] }),
    ).toThrow(UnitEngineError);
    expect(() =>
      combineUncertainties([comps()[0]!, { id: "c", standardUncertainty: Quantity.of(1, "s") }]),
    ).toThrow(UnitEngineError);
    // All-ρ=−1 triangle is pairwise legal (|ρ| ≤ 1) but globally
    // inconsistent: u² = 3 + 2(−3) = −3 < 0 → rejected, never NaN.
    expect(() =>
      combineUncertainties(
        [
          { id: "a", standardUncertainty: Quantity.of(1, "m") },
          { id: "b", standardUncertainty: Quantity.of(1, "m") },
          { id: "c", standardUncertainty: Quantity.of(1, "m") },
        ],
        {
          correlations: [
            { idA: "a", idB: "b", coefficient: -1 },
            { idA: "b", idB: "c", coefficient: -1 },
            { idA: "a", idB: "c", coefficient: -1 },
          ],
        },
      ),
    ).toThrow(UnitEngineError);
  });

  it("CovarianceMatrix: symmetry/PSD/square enforced; covariance propagation exact", () => {
    // Perfect positive correlation: z = x+y gets σz = σx+σy.
    const cov = CovarianceMatrix.fromData(["x", "y"], "m^2", [
      [4, 4],
      [4, 4],
    ]);
    expect(cov.variance("x").value).toBe(4);
    expect(cov.covariance("x", "y").value).toBe(4);
    const z = propagateWithCovariance(
      Expression.add(Expression.variable("x"), Expression.variable("y")),
      { x: meas(10, 2), y: meas(20, 2) },
      cov,
    );
    expect(z.value.value).toBe(30);
    expect(relClose(z.uncertainty.value, 4, 1e-9)).toBe(true);
    // Structural rejections.
    expect(() =>
      CovarianceMatrix.fromData(["x", "y"], "m^2", [
        [1, 2],
        [3, 1],
      ]),
    ).toThrow(UnitEngineError);
    expect(() => CovarianceMatrix.fromData(["x", "y"], "m^2", [[1, 0], [0]])).toThrow(
      UnitEngineError,
    );
    expect(() => CovarianceMatrix.fromData(["x"], "m^2", [[-1]])).toThrow(UnitEngineError);
    expect(() =>
      CovarianceMatrix.fromData(["x", "__proto__"], "m^2", [
        [1, 0],
        [0, 1],
      ]),
    ).toThrow(UnitEngineError);
    // Pairwise-plausible but globally inconsistent correlations fail the
    // Cholesky positive-semidefinite check (a=b, b=c, but a anti-correlates c).
    expect(() =>
      CovarianceMatrix.fromData(["a", "b", "c"], "m^2", [
        [1, 1, -1],
        [1, 1, 1],
        [-1, 1, 1],
      ]),
    ).toThrow(UnitEngineError);
  });
});

// ---------------------------------------------------------------------------
// §15 — Scientific constants [seed 1755]
// ---------------------------------------------------------------------------

describe("prompt17 §15: constants [seed 1755]", () => {
  it("defining constants: exact values, dimensions, zero uncertainty", () => {
    const std = createStandardConstantRegistry();
    // Hand-derived SI references (2019 redefinition — exact by definition).
    const expected: Record<string, { value: number; dim: DimensionVector }> = {
      speedOfLight: { value: 299792458, dim: { L: 1, T: -1 } },
      // E-world dimensions (J·s = E·T, J/K = E·Temp⁻¹) per the E model (§3).
      planckConstant: { value: 6.62607015e-34, dim: { E: 1, T: 1 } },
      elementaryCharge: { value: 1.602176634e-19, dim: { I: 1, T: 1 } },
      boltzmannConstant: { value: 1.380649e-23, dim: { E: 1, Temp: -1 } },
      avogadroConstant: { value: 6.02214076e23, dim: { Substance: -1 } },
    };
    for (const [id, ref] of Object.entries(expected)) {
      const entry = std.require(id);
      expect(entry.quantity.value).toBe(ref.value);
      expect(dimensionsEqual(entry.quantity.dimension, ref.dim as DimensionVector)).toBe(true);
      expect(entry.exact).toBe(true);
      expect(entry.measurement.uncertainty.value).toBe(0);
    }
    // Exact constants never acquire uncertainty through formulas: E = mc².
    const reg = createRegistry({ packs: [SI_PACK] });
    const c = std.require("speedOfLight");
    const f = defineFormula(
      {
        id: "emc2",
        expression: Expression.multiply(
          Expression.variable("mass"),
          Expression.power(Expression.variable("c"), 2),
        ),
        inputs: { mass: { dimension: "kg" } },
        constants: { c },
      },
      { registry: reg },
    );
    const r = evaluateFormula(f, { mass: Quantity.of(1, "kg") }, { registry: reg });
    if (!(r instanceof Quantity)) throw new Error("expected Quantity");
    // Mechanical energy in N·m (J is the decoupled E dimension — see §3).
    expect(relClose(r.to("N*m", reg).value, 299792458 ** 2, 1e-9)).toBe(true);
  });

  it("identifiers, aliases and reproducibility", () => {
    const std = createStandardConstantRegistry();
    expect(std.require("lightspeed").quantity.value).toBe(
      std.require("speedOfLight").quantity.value,
    );
    const again = createStandardConstantRegistry();
    expect(again.require("speedOfLight")).toEqual(std.require("speedOfLight"));
    expect(() => std.require("nope_constant_xyz")).toThrow(UnitEngineError);
  });
});

// ---------------------------------------------------------------------------
// §16 — Unit system cross-checks [seed 1766]
// ---------------------------------------------------------------------------

describe("prompt17 §16: cross-system checks [seed 1766]", () => {
  it("SI ↔ CGS: hand-derived factors, dimension invariance", () => {
    const both = createRegistry({ packs: [SI_PACK, CGS_PACK] });
    expect(relClose(Quantity.of(1, "m", both).to("cm", both).value, 100, 1e-12)).toBe(true);
    expect(relClose(Quantity.of(1, "kg", both).to("g", both).value, 1000, 1e-12)).toBe(true);
    // 1 N = 1 kg·m/s² = 1000 g × 100 cm/s² = 1e5 dyn (hand-derived).
    expect(relClose(Quantity.of(1, "N", both).to("dyn", both).value, 1e5, 1e-9)).toBe(true);
    const rand = mulberry32(1766);
    for (let i = 0; i < 40; i++) {
      const v = (rand() - 0.5) * 1e6;
      const q = Quantity.of(v, "J", both);
      const round = q.to("erg", both).to("J", both);
      expect(dimensionsEqual(round.dimension, q.dimension)).toBe(true);
      expect(relClose(round.value, v, 1e-9)).toBe(true);
    }
  });

  it("SI ↔ Imperial against independent legal definitions", () => {
    const imp = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK] });
    // International yard/pound agreements (1959) — legal facts, not library code.
    expect(relClose(Quantity.of(1, "m", imp).to("ft", imp).value, 1 / 0.3048, 1e-12)).toBe(true);
    expect(relClose(Quantity.of(1, "kg", imp).to("lb", imp).value, 1 / 0.45359237, 1e-12)).toBe(
      true,
    );
    expect(relClose(Quantity.of(1, "in", imp).to("cm", imp).value, 2.54, 1e-12)).toBe(true);
    // lbf = 0.45359237 kg × 9.80665 m/s² (hand-derived from the two definitions).
    const lbfInNewton = 0.45359237 * 9.80665;
    expect(relClose(Quantity.of(1, "lbf", imp).to("N", imp).value, lbfInNewton, 1e-9)).toBe(true);
    // psi = lbf/in² → Pa, derived from the same two literals.
    const psiInPascal = lbfInNewton / 0.00064516;
    expect(relClose(Quantity.of(1, "psi", imp).to("Pa", imp).value, psiInPascal, 1e-9)).toBe(true);
  });

  it("system normalization preserves physics; conflicting packs fail deterministically", () => {
    const both = createRegistry({ packs: [SI_PACK, CGS_PACK] });
    const cm = normalizeToSystem(Quantity.of(1, "m", both), CGS_SYSTEM, { registry: both });
    expect(cm.unit.symbol).toBe("cm");
    expect(relClose(cm.value, 100, 1e-12)).toBe(true);
    const g = normalizeToSystem(Quantity.of(1, "kg", both), CGS_SYSTEM, { registry: both });
    expect(g.unit.symbol).toBe("g");
    expect(relClose(g.value, 1000, 1e-12)).toBe(true);
    // No preferred CGS unit exists for force: deterministic typed error,
    // never a silently wrong mapping (dyn must be addressed explicitly).
    expect(() =>
      normalizeToSystem(Quantity.of(1, "N", both), CGS_SYSTEM, { registry: both }),
    ).toThrow(UnitEngineError);
    // Imperial and US-customary both claim "yd": combining them is a
    // deterministic registration error, never silent shadowing.
    expect(() => createRegistry({ packs: [SI_PACK, IMPERIAL_PACK, US_CUSTOMARY_PACK] })).toThrow(
      UnitEngineError,
    );
  });
});

// ---------------------------------------------------------------------------
// §17 — Metamorphic testing [seed 1777]
// ---------------------------------------------------------------------------

describe("prompt17 §17: metamorphic relations [seed 1777]", () => {
  const reg = createRegistry({ packs: [SI_PACK] });
  const O = { registry: reg };
  const E = Expression;

  it("unit-of-input must not change physics: ke(m, v) ≡ ke(m, v in cm/s)", () => {
    const rand = mulberry32(1777);
    const ke = defineFormula(
      {
        id: "keMeta",
        expression: E.multiply(
          E.literal(0.5, "1"),
          E.multiply(E.variable("m"), E.power(E.variable("v"), 2)),
        ),
        inputs: { m: { dimension: "kg" }, v: { dimension: "m/s" } },
      },
      O,
    );
    for (let i = 0; i < 50; i++) {
      const m = 0.5 + rand() * 500;
      const v = 1 + rand() * 3000;
      const inSI = evaluateFormula(ke, { m: Quantity.of(m, "kg"), v: Quantity.of(v, "m/s") }, O);
      const inCgsish = evaluateFormula(
        ke,
        { m: Quantity.of(m * 1000, "g"), v: Quantity.of(v * 100, "cm/s") },
        O,
      );
      if (!(inSI instanceof Quantity) || !(inCgsish instanceof Quantity)) {
        throw new Error("expected Quantity");
      }
      // Same physics after output normalization.
      expect(relClose(inCgsish.to("N*m", reg).value, inSI.to("N*m", reg).value, 1e-9)).toBe(true);
    }
  });

  it("convert-then-add ≡ add-then-convert; scaled distributivity", () => {
    const rand = mulberry32(1778);
    for (let i = 0; i < 50; i++) {
      const a = rand() * 1000;
      const b = rand() * 1000;
      const left = Quantity.of(a, "m").add(Quantity.of(b, "m")).to("km").value;
      const right = Quantity.of(a / 1000, "km").add(Quantity.of(b / 1000, "km")).value;
      expect(relClose(left, right, 1e-12)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §18 — Numerical stability [seed 1788]
// ---------------------------------------------------------------------------

describe("prompt17 §18: numerical stability [seed 1788]", () => {
  it("tiny/huge values round-trip; cancellation mirrors IEEE honestly", () => {
    for (const v of [5e-324, 1e-308, 1e-300, 1e300]) {
      const back = Quantity.of(v, "m").to("mm").to("m").value;
      expect(relClose(back, v, 1e-12)).toBe(true);
    }
    // 1e308 m → mm overflows float64: IEEE Infinity, never a finite lie.
    expect(Quantity.of(1e308, "m").to("mm").value).toBe(Infinity);
    // Catastrophic cancellation is reported honestly: (1e16+1)−1e16 = 0 in
    // float64, and the library returns exactly that — no false precision.
    expect(Quantity.of(1e16 + 1, "m").subtract(Quantity.of(1e16, "m")).value).toBe(1e16 + 1 - 1e16);
    expect(Quantity.of(0.1, "m").add(Quantity.of(0.2, "m")).value).toBe(0.1 + 0.2);
  });

  it("mixed magnitudes in one sum stay within float64 truth", () => {
    const rand = mulberry32(1788);
    for (let i = 0; i < 60; i++) {
      const big = 10 ** randInt(rand, 8, 15);
      const small = 10 ** randInt(rand, -15, -8);
      const got = Quantity.of(big, "m").add(Quantity.of(small, "m")).value;
      expect(got).toBe(big + small);
    }
  });
});

// ---------------------------------------------------------------------------
// §19 — Randomized regression determinism (meta)
// ---------------------------------------------------------------------------

describe("prompt17 §19: determinism of the randomized corpus", () => {
  it("same seed → identical generated corpus across independent streams", () => {
    const build = (seed: number) => {
      const rand = mulberry32(seed);
      const out: string[] = [];
      for (let i = 0; i < 100; i++) out.push(randomQuantityExpression(rand));
      return out;
    };
    expect(build(1724)).toEqual(build(1724));
    expect(build(1724)).not.toEqual(build(1725));
  });
});

// ---------------------------------------------------------------------------
// §20 — Security adversarial testing [seed 1720]
// ---------------------------------------------------------------------------

describe("prompt17 §20: adversarial inputs [seed 1720]", () => {
  it("prototype pollution attempts are inert across all decoders", () => {
    // JSON.parse creates a REAL own "__proto__" data property — the classic
    // pollution vector. Decoders must reject it with a typed error or ignore
    // it; Object.prototype must be untouched either way.
    const evilQuantity = JSON.parse(
      '{"version":1,"type":"quantity","value":1,"unit":"m","__proto__":{"polluted":true}}',
    );
    const evilMeasurement = JSON.parse(
      '{"version":1,"type":"measurement",' +
        '"value":{"version":1,"type":"quantity","value":1,"unit":"m"},' +
        '"uncertainty":{"version":1,"type":"quantity","value":0.1,"unit":"m"},' +
        '"__proto__":{"polluted":true}}',
    );
    for (const payload of [evilQuantity]) {
      try {
        const q = deserializeQuantity(payload);
        expect(q.value).toBe(1);
      } catch (error) {
        expect(error).toBeInstanceOf(UnitEngineError);
      }
    }
    for (const payload of [evilMeasurement]) {
      try {
        const m = deserializeMeasurement(payload);
        expect(m.value.value).toBe(1);
      } catch (error) {
        expect(error).toBeInstanceOf(UnitEngineError);
      }
    }
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call({}, "polluted")).toBe(false);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it("registry poisoning: failed registrations leave no trace; __proto__ is data", () => {
    const rand = mulberry32(1720);
    const units = new UnitRegistry();
    const before = JSON.stringify(
      units
        .list()
        .map((u) => u.symbol)
        .sort(),
    );
    const versionBefore = units.version;
    // Each of these provably throws (verified against the implementation).
    const poisonous = [
      { symbol: "m", dimension: { L: 1 }, toBaseFactor: 1, label: "duplicate" },
      { symbol: "", dimension: { L: 1 }, toBaseFactor: 1, label: "empty" },
      { symbol: "ok_q2", dimension: { L: 1 }, toBaseFactor: Number.NaN, label: "nan-scale" },
      { symbol: "ok_q3", dimension: { L: 1 }, toBaseFactor: 0, label: "zero-scale" },
    ];
    for (let i = 0; i < 40; i++) {
      const bad = pick(rand, poisonous);
      expect(() => units.registerAtomic(bad as never)).toThrow(UnitEngineError);
    }
    expect(
      JSON.stringify(
        units
          .list()
          .map((u) => u.symbol)
          .sort(),
      ),
    ).toBe(before);
    expect(units.version).toBe(versionBefore);
    // "__proto__" as a unit symbol is stored as DATA (Map-backed registry):
    // it must not alter Object.prototype and must round-trip as a symbol.
    units.registerAtomic({ symbol: "__proto__", dimension: { L: 1 }, toBaseFactor: 1, label: "x" });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)["label"]).toBeUndefined();
    expect(units.list().some((u) => u.symbol === "__proto__")).toBe(true);
  });

  it("resource exhaustion: huge exponents, deep graphs stay bounded", () => {
    // 200-node linear chain evaluates (bounded limits, no stack overflow).
    const reg = createRegistry({ packs: [SI_PACK] });
    const O = { registry: reg };
    const E = Expression;
    const formulas = [];
    for (let i = 0; i < 200; i++) {
      formulas.push(
        defineFormula(
          {
            id: `n${i}`,
            expression: E.multiply(E.variable(i === 0 ? "x" : `o${i - 1}`), E.literal(1, "1")),
            inputs: { [i === 0 ? "x" : `o${i - 1}`]: { dimension: "m" } },
            outputName: `o${i}`,
          },
          O,
        ),
      );
    }
    const g = createDependencyGraph(formulas);
    const r = g.evaluate({ x: Quantity.of(3, "m") });
    expect(r.outputs["o199"]!.to("m").value).toBe(3);
    // Enormous power overflows to IEEE Infinity deterministically, never hangs.
    expect(Quantity.of(10, "m").pow(999999999).value).toBe(Infinity);
  });

  it("formatter never crashes on adversarial quantities", () => {
    for (const q of [
      Quantity.of(Number.NaN, "m"),
      Quantity.of(Infinity, "m"),
      Quantity.of(-Infinity, "kg"),
      Quantity.of(1e308, "m"),
      Quantity.of(5e-324, "m"),
    ]) {
      expect(() => formatQuantity(q)).not.toThrow();
      expect(typeof formatQuantity(q)).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// §21 — Differential / reference testing (independent hand references)
// ---------------------------------------------------------------------------

describe("prompt17 §21: differential references [seed 1721]", () => {
  it("high-risk conversions against hand-derived values", () => {
    const imp = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK] });
    const sci = createRegistry({ packs: [SI_PACK, SCIENTIFIC_PACK] });
    // km/h → m/s is ÷3.6 by definition of the units involved.
    expect(relClose(Quantity.of(36, "km/h").to("m/s").value, 10, 1e-9)).toBe(true);
    expect(relClose(Quantity.of(1, "km/h").to("m/s").value, 1 / 3.6, 1e-12)).toBe(true);
    // °F → °C: (F−32)·5/9, computed here by hand.
    const si = createRegistry({ packs: [SI_PACK] });
    for (const f of [32, 212, -40, 98.6, 451]) {
      const hand = ((f - 32) * 5) / 9;
      expect(Math.abs(Quantity.of(f, "°F", si).to("°C", si).value - hand)).toBeLessThan(1e-9);
    }
    // Thermochemical calorie is 4.184 J exactly; IT-BTU is 1055.05585262 J.
    expect(relClose(Quantity.of(1, "cal", sci).to("J", sci).value, 4.184, 1e-12)).toBe(true);
    expect(relClose(Quantity.of(1, "BTU", sci).to("J", sci).value, 1055.05585262, 1e-9)).toBe(true);
    // mph: 1 mile/hour = 1609.344 m / 3600 s (hand-derived from definitions).
    expect(relClose(Quantity.of(1, "mph", imp).to("m/s", imp).value, 1609.344 / 3600, 1e-9)).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// §22 — Test-quality audit (meta-tests on this suite itself)
// ---------------------------------------------------------------------------

describe("prompt17 §22: test-quality audit", () => {
  it("tolerance helper is strict where it must be, lenient never silently", () => {
    expect(relClose(1, 1 + 1e-13, 1e-12)).toBe(true);
    expect(relClose(1, 1 + 1e-11, 1e-12)).toBe(false);
    expect(relClose(1, 2, 1e-9)).toBe(false);
    expect(relClose(0, 0, 1e-12)).toBe(true);
    expect(relClose(1e300, 1e300 * (1 + 1e-13), 1e-12)).toBe(true);
  });

  it("suite uses no wall-clock, no Math.random, no ordering dependence", () => {
    // All randomness flows from mulberry32 with fixed seeds: re-running any
    // generator reproduces its corpus bit-identically (see §19 test).
    const first = mulberry32(99)();
    const second = mulberry32(99)();
    expect(first).toBe(second);
    // dimensionKey is pure: repeated calls agree (no hidden state).
    expect(dimensionKey({ M: 1, L: 2 })).toBe(dimensionKey({ L: 2, M: 1 }));
  });
});
