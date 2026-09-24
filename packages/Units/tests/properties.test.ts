/**
 * properties.test.ts — Phase 30: invariant/property tests with a seeded
 * PRNG (deterministic). Covers fundamental algebraic invariants plus the
 * Phase 29 interop invariants (atomicity, determinism, round-trips).
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Measurement,
  UnitRegistry,
  createRegistry,
  SI_PACK,
  multiplyDim,
  divideDim,
  dimensionKey,
  DIMENSIONLESS,
  parseUnit,
  canonicalizeUnitText,
  serializeQuantity,
  deserializeQuantity,
  serializeMeasurement,
  deserializeMeasurement,
  serializeExpression,
  deserializeExpression,
  Expression,
  applyExtension,
  toInterchange,
  fromInterchange,
  migrateSerialized,
} from "../src/index.js";

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

describe("dimension algebra invariants", () => {
  it("multiplication is associative; identity behaves correctly", () => {
    const rand = mulberry32(7);
    const ids = ["M", "L", "T", "Temp", "I"];
    const randomDim = (): Record<string, number> => {
      const d: Record<string, number> = {};
      for (const id of ids) {
        const e = Math.floor(rand() * 5) - 2;
        if (e !== 0) d[id] = e;
      }
      return d;
    };
    for (let i = 0; i < 200; i++) {
      const a = randomDim();
      const b = randomDim();
      const c = randomDim();
      expect(dimensionKey(multiplyDim(multiplyDim(a, b), c))).toBe(
        dimensionKey(multiplyDim(a, multiplyDim(b, c))),
      );
      expect(dimensionKey(multiplyDim(a, DIMENSIONLESS))).toBe(dimensionKey(a));
      expect(dimensionKey(divideDim(multiplyDim(a, b), b))).toBe(dimensionKey(a));
    }
  });
});

describe("conversion round-trips", () => {
  it("compatible quantities remain compatible; to(to(x)) ≈ x", () => {
    const rand = mulberry32(11);
    const pairs: Array<[string, string]> = [
      ["m", "km"],
      ["kg", "g"],
      ["s", "min"],
      ["m/s", "km/h"],
    ];
    for (let i = 0; i < 100; i++) {
      const [a, b] = pairs[Math.floor(rand() * pairs.length)]!;
      const value = (rand() - 0.5) * 2000;
      const there = Quantity.of(value, a).to(b);
      const back = there.to(a);
      // Relative tolerance: absolute magnitudes vary wildly.
      const denom = Math.max(1, Math.abs(value));
      expect(Math.abs(back.value - value) / denom).toBeLessThan(1e-9);
    }
  });

  it("incompatible quantities always fail", () => {
    const rand = mulberry32(13);
    const units = ["m", "kg", "s", "A", "K"];
    for (let i = 0; i < 100; i++) {
      const a = units[Math.floor(rand() * units.length)]!;
      const b = units[Math.floor(rand() * units.length)]!;
      if (b === a) continue;
      expect(() => Quantity.of(1, a).to(b)).toThrow();
    }
  });
});

describe("canonicalization stability", () => {
  it("equivalent spellings share keys; keys are stable across runs", () => {
    const si = createRegistry({ packs: [SI_PACK] });
    const families = [
      ["m/s", "m·s^-1", "m*s^-1"],
      ["kg*m/s^2", "kg·m/s²"],
      ["N", "kg*m/s^2"],
    ];
    const keys = new Set<string>();
    for (const family of families) {
      const familyKeys = family.map((text) => canonicalizeUnitText(text, si).key);
      for (const k of familyKeys) {
        expect(k).toBe(familyKeys[0]);
        keys.add(k);
      }
    }
    // Named (N) and expanded (kg·m/s²) forms share one identity by design.
    expect(keys.size).toBe(2);
    expect(canonicalizeUnitText("N", si).key).toBe(canonicalizeUnitText("kg·m/s²", si).key);
  });
});

describe("serialization round-trips", () => {
  it("quantity/measurement/expression survive JSON round-trips", () => {
    const rand = mulberry32(17);
    for (let i = 0; i < 100; i++) {
      const value = Math.round((rand() - 0.5) * 1e6) / 1000;
      const unit = ["m", "kg", "s"][Math.floor(rand() * 3)]!;
      const q = Quantity.of(value, unit);
      expect(deserializeQuantity(JSON.parse(JSON.stringify(serializeQuantity(q))))).toEqual(q);
      const m = Measurement.of(q, Math.abs(value) * 0.01 + 0.001);
      const back = deserializeMeasurement(JSON.parse(JSON.stringify(serializeMeasurement(m))));
      expect(back.value).toEqual(m.value);
    }
    const expr = Expression.add(Expression.variable("x"), Expression.literal(1, "m"));
    expect(deserializeExpression(JSON.parse(JSON.stringify(serializeExpression(expr))))).toEqual(
      expr,
    );
  });
});

describe("extension atomicity invariant", () => {
  it("failed apply leaves every target bit-identical", () => {
    const units = new UnitRegistry();
    const before = units.snapshot();
    const beforeKeys = JSON.stringify(
      units
        .list()
        .map((u) => u.symbol)
        .sort(),
    );
    expect(() =>
      applyExtension(
        {
          id: "bad",
          version: "1.0.0",
          units: [
            { symbol: "okunit", dimension: { L: 1 }, toBaseFactor: 1, label: "ok" },
            { symbol: "", dimension: { L: 1 }, toBaseFactor: 1, label: "bad" },
          ],
        },
        { units },
      ),
    ).toThrow();
    expect(
      JSON.stringify(
        units
          .list()
          .map((u) => u.symbol)
          .sort(),
      ),
    ).toBe(beforeKeys);
    expect(units.version).toBe(before.version);
  });
});

describe("interchange determinism", () => {
  it("same value serializes byte-identically; migration is deterministic", () => {
    const q = Quantity.of(10, "kg");
    expect(JSON.stringify(toInterchange(q))).toBe(JSON.stringify(toInterchange(q)));
    const m = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
    const a = fromInterchange(JSON.parse(JSON.stringify(toInterchange(m))));
    const b = fromInterchange(JSON.parse(JSON.stringify(toInterchange(m))));
    expect(a).toEqual(b);
    const v1 = migrateSerialized(
      { version: 1, type: "quantity", value: 5, unit: "m" },
      [],
      1,
      "quantity",
    );
    expect(v1).toEqual({ version: 1, type: "quantity", value: 5, unit: "m" });
  });
});

describe("statistical invariants", () => {
  it("parseUnit rejects empty/blank input deterministically", () => {
    for (const bad of ["", "   ", "\t\n"]) {
      expect(() => parseUnit(bad)).toThrow();
    }
  });
});
