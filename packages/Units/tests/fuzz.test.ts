/**
 * fuzz.test.ts — Phase 30: deterministic fuzz testing (seeded PRNG, no
 * randomness). Fuzzes the unit parser, serialized-input decoders and
 * registry definitions. Goals: no crashes, no hangs, no infinite loops —
 * only typed errors; valid outputs must be stable under re-parsing.
 */
import { describe, expect, it } from "vitest";
import {
  UnitRegistry,
  parseUnit,
  canonicalizeUnitText,
  deserializeQuantity,
  deserializeMeasurement,
  ProfileRegistry,
  fromInterchange,
  ConstantRegistry,
  UnitEngineError,
} from "../src/index.js";

/** Deterministic PRNG (mulberry32). Same seed → same sequence, always. */
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

describe("parser fuzz (seeded)", () => {
  it("never crashes or hangs on token soup; valid parses are canonical-stable", () => {
    const rand = mulberry32(0x29a);
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
    ];
    let valid = 0;
    for (let i = 0; i < 3000; i++) {
      const len = 1 + Math.floor(rand() * 12);
      let text = "";
      for (let j = 0; j < len; j++) text += pick(rand, alphabet);
      let unit;
      try {
        unit = parseUnit(text);
      } catch (error) {
        // Typed errors only — never TypeError/RangeError/stack overflow.
        expect(error).toBeInstanceOf(UnitEngineError);
        continue;
      }
      valid++;
      // Canonical stability: re-parsing the canonical symbol is identical.
      const again = parseUnit(unit.symbol);
      expect(again.symbol).toBe(unit.symbol);
      expect(JSON.stringify(again.dimension)).toBe(JSON.stringify(unit.dimension));
    }
    // Sanity: the soup must contain both valid and invalid inputs.
    expect(valid).toBeGreaterThan(50);
    expect(valid).toBeLessThan(3000);
  });

  it("canonicalizeUnitText agrees with parseUnit on valid inputs", () => {
    const rand = mulberry32(0x51f);
    const units = ["m", "kg", "s", "N", "J", "m/s", "kg*m", "m^2", "s^-1"];
    for (let i = 0; i < 200; i++) {
      const text = pick(rand, units);
      let expected: string | undefined;
      try {
        expected = parseUnit(text).symbol;
      } catch {
        continue;
      }
      // canonicalizeUnitText must not throw on anything parseUnit accepts.
      const identity = canonicalizeUnitText(text);
      expect(identity.symbol).toBe(expected);
    }
  });
});

describe("serialized-input fuzz (seeded)", () => {
  /** Random JSON mutations: delete keys, swap types, nest deeply. */
  function mutate(rand: () => number, value: unknown, depth: number): unknown {
    if (depth > 4 || rand() < 0.3) {
      return pick(rand, [null, 42, "x", true, [], {}, Number.NaN] as const);
    }
    if (Array.isArray(value)) {
      const copy = [...value];
      if (copy.length > 0 && rand() < 0.5) copy.splice(Math.floor(rand() * copy.length), 1);
      if (rand() < 0.3) copy.push(mutate(rand, {}, depth + 1));
      return copy;
    }
    if (value !== null && typeof value === "object") {
      const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
      const keys = Object.keys(copy);
      if (keys.length > 0 && rand() < 0.5) delete copy[pick(rand, keys)!];
      if (rand() < 0.3) copy[`fuzz${Math.floor(rand() * 100)}`] = mutate(rand, {}, depth + 1);
      if (rand() < 0.2) copy["__proto__"] = {};
      return copy;
    }
    return value;
  }

  const validQuantity = { version: 1, type: "quantity", value: 10, unit: "kg" };
  const validMeasurement = {
    version: 1,
    type: "measurement",
    value: { version: 1, type: "quantity", value: 10, unit: "kg" },
    uncertainty: { version: 1, type: "quantity", value: 0.2, unit: "kg" },
  };

  it("quantity/measurement decoders reject mutations with typed errors", () => {
    const rand = mulberry32(0xbeef);
    for (let i = 0; i < 500; i++) {
      const q = mutate(rand, validQuantity, 0);
      try {
        deserializeQuantity(q);
      } catch (error) {
        expect(error).toBeInstanceOf(UnitEngineError);
      }
      const m = mutate(rand, validMeasurement, 0);
      try {
        deserializeMeasurement(m);
      } catch (error) {
        expect(error).toBeInstanceOf(UnitEngineError);
      }
    }
    // Unmutated originals still decode.
    expect(deserializeQuantity(validQuantity).value).toBe(10);
    expect(deserializeMeasurement(validMeasurement).value.value).toBe(10);
  });

  it("interchange and profile decoders reject mutations with typed errors", () => {
    const rand = mulberry32(0x1234);
    const envelope = {
      schemaVersion: 1,
      kind: "quantity",
      payload: { ...validQuantity },
    };
    for (let i = 0; i < 200; i++) {
      try {
        fromInterchange(mutate(rand, envelope, 0));
      } catch (error) {
        expect(error).toBeInstanceOf(UnitEngineError);
      }
    }
    const profile = {
      version: 1,
      type: "standards-profile",
      id: "fuzz",
      profileVersion: "1",
      unitSystem: "si",
      preferredUnits: { "M^1": "kg" },
    };
    for (let i = 0; i < 200; i++) {
      try {
        ProfileRegistry.deserialize({
          version: 1,
          type: "profile-registry",
          profiles: [mutate(rand, profile, 0)],
        });
      } catch (error) {
        expect(error).toBeInstanceOf(UnitEngineError);
      }
    }
  });
});

describe("registry-definition fuzz (seeded)", () => {
  it("unit registry rejects malformed definitions with typed errors", () => {
    const rand = mulberry32(0x77aa);
    const symbols = ["qx", "qy", "m", "", "a b", "__proto__"];
    const dims = [{ L: 1 }, { M: 1 }, "nope", null, { L: 1.5 }, { __proto__: 1 }];
    for (let i = 0; i < 500; i++) {
      const def = {
        symbol: pick(rand, symbols),
        dimension: pick(rand, dims),
        toBaseFactor: pick(rand, [1, 0, -1, Number.NaN, Infinity, "x"]),
        label: "fuzz",
      };
      try {
        new UnitRegistry().registerAtomic(def as never);
      } catch (error) {
        expect(error).toBeInstanceOf(UnitEngineError);
      }
    }
  });

  it("constant registry rejects malformed definitions with typed errors", () => {
    const rand = mulberry32(0x99cc);
    let rejected = 0;
    for (let i = 0; i < 300; i++) {
      const def = {
        id: pick(rand, ["ok", "", "bad id", "__proto__"]),
        symbol: pick(rand, ["q", ""]),
        value: pick(rand, [1, Number.NaN, Infinity, "x"]),
        unit: pick(rand, ["m", "nope_xyz", ""]),
        exact: pick(rand, [true, false, "yes"]),
        source: pick(rand, ["s", ""]),
      };
      try {
        new ConstantRegistry().register(def as never);
      } catch (error) {
        expect(error).toBeInstanceOf(UnitEngineError);
        rejected++;
      }
    }
    // Most random combos are invalid; the valid one ("ok"/"q"/1/"m"/bool/"s")
    // registers fine.
    expect(rejected).toBeGreaterThan(200);
    const reg = new ConstantRegistry();
    reg.register({ id: "ok", symbol: "q", value: 1, unit: "m", exact: true, source: "s" });
    expect(reg.require("ok").quantity.value).toBe(1);
  });
});
