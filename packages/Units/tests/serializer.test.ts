/**
 * tests/serializer.test.ts — Phase 10: Serialization, Deserialization & Runtime Guards
 */
import { describe, expect, it } from "vitest";
import {
  serializeUnit,
  deserializeUnit,
  serializeQuantity,
  deserializeQuantity,
} from "../src/serializer.js";
import { parseUnit } from "../src/unit-parser.js";
import { Quantity } from "../src/quantity.js";
import { makeUnit } from "../src/unit.js";
import { Dim } from "../src/dimension.js";
import { UnitRegistry } from "../src/unit-registry.js";
import {
  isQuantity,
  isUnit,
  isDimension,
  isSerializedQuantity,
  isSerializedUnit,
} from "../src/guards.js";

// ---------------------------------------------------------------------------
// Unit serialization round-trip
// ---------------------------------------------------------------------------

describe("serializeUnit → deserializeUnit", () => {
  it("atomic kg", () => {
    const u = parseUnit("kg");
    const ser = serializeUnit(u);
    expect(ser.version).toBe(1);
    expect(ser.type).toBe("unit");
    expect(deserializeUnit(ser).symbol).toBe(u.symbol);
  });
  it("prefixed km", () => {
    const u = parseUnit("km");
    expect(deserializeUnit(serializeUnit(u)).toBaseFactor).toBe(u.toBaseFactor);
  });
  it("compound kg·m/s²", () => {
    const u = parseUnit("kg·m/s²");
    const ser = serializeUnit(u);
    const restored = deserializeUnit(ser);
    expect(restored.dimension).toEqual(u.dimension);
    expect(restored.toBaseFactor).toBeCloseTo(u.toBaseFactor, 9);
  });
  it("dimensionless %", () => {
    const u = parseUnit("%");
    expect(deserializeUnit(serializeUnit(u)).symbol).toBe("%");
  });
  it("ppm", () => {
    const u = parseUnit("ppm");
    expect(deserializeUnit(serializeUnit(u)).symbol).toBe("ppm");
  });
  it("custom registered unit", () => {
    const reg = new UnitRegistry([]);
    reg.register(
      makeUnit({ symbol: "myU", dimension: Dim.Mass, toBaseFactor: 42, label: "my unit" }),
    );
    const u = reg.resolve("myU");
    const ser = serializeUnit(u);
    expect(deserializeUnit(ser, reg).symbol).toBe("myU");
    // Without registry, should throw
    expect(() => deserializeUnit(ser)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Quantity serialization round-trip
// ---------------------------------------------------------------------------

describe("serializeQuantity → deserializeQuantity", () => {
  it("atomic kg", () => {
    const q = Quantity.of(12.5, "kg");
    const ser = serializeQuantity(q);
    expect(ser.version).toBe(1);
    expect(ser.type).toBe("quantity");
    const r = deserializeQuantity(ser);
    expect(r.value).toBe(q.value);
    expect(r.unit.symbol).toBe(q.unit.symbol);
  });
  it("prefixed km", () => {
    const q = Quantity.of(5, "km");
    expect(deserializeQuantity(serializeQuantity(q)).value).toBe(5);
  });
  it("compound Mcal/kg", () => {
    const q = Quantity.of(3.5, "Mcal/kg");
    const r = deserializeQuantity(serializeQuantity(q));
    expect(r.dimension).toEqual(q.dimension);
  });
  it("dimensionless %", () => {
    const q = Quantity.of(15, "%");
    expect(deserializeQuantity(serializeQuantity(q)).value).toBe(15);
  });
  it("ppm", () => {
    expect(deserializeQuantity(serializeQuantity(Quantity.of(250, "ppm"))).value).toBe(250);
  });
  it("custom unit quantity", () => {
    const reg = new UnitRegistry([]);
    reg.register(makeUnit({ symbol: "myU", dimension: Dim.Length, toBaseFactor: 1, label: "my" }));
    const q = Quantity.of(10, "myU", reg);
    const ser = serializeQuantity(q);
    expect(deserializeQuantity(ser, reg).value).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Version tests
// ---------------------------------------------------------------------------

describe("serialization version", () => {
  it("supported version 1", () => {
    expect(() =>
      deserializeQuantity({ version: 1, type: "quantity", value: 1, unit: "kg" }),
    ).not.toThrow();
    expect(() => deserializeUnit({ version: 1, type: "unit", expression: "kg" })).not.toThrow();
  });
  it("unsupported version throws", () => {
    expect(() =>
      deserializeQuantity({
        version: 99 as unknown as 1,
        type: "quantity",
        value: 1,
        unit: "kg",
      } as unknown as Parameters<typeof deserializeQuantity>[0]),
    ).toThrow();
    expect(() =>
      deserializeUnit({
        version: 99 as unknown as 1,
        type: "unit",
        expression: "kg",
      } as unknown as Parameters<typeof deserializeUnit>[0]),
    ).toThrow();
  });
  it("missing version throws", () => {
    expect(() =>
      deserializeQuantity({ type: "quantity", value: 1, unit: "kg" } as unknown as Parameters<
        typeof deserializeQuantity
      >[0]),
    ).toThrow();
    expect(() =>
      deserializeUnit({ type: "unit", expression: "kg" } as unknown as Parameters<
        typeof deserializeUnit
      >[0]),
    ).toThrow();
  });
  it("malformed version type throws", () => {
    expect(() =>
      deserializeQuantity({
        version: "1" as unknown as number,
        type: "quantity",
        value: 1,
        unit: "kg",
      } as unknown as Parameters<typeof deserializeQuantity>[0]),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Invalid data
// ---------------------------------------------------------------------------

describe("invalid serialized data", () => {
  it.each([null, undefined, [], {}, "string", 123] as const)("rejects %p", (v) => {
    expect(() =>
      deserializeQuantity(v as unknown as Parameters<typeof deserializeQuantity>[0]),
    ).toThrow();
    expect(() => deserializeUnit(v as unknown as Parameters<typeof deserializeUnit>[0])).toThrow();
  });
  it("missing fields", () => {
    expect(() =>
      deserializeQuantity({ version: 1, type: "quantity", value: 1 } as unknown as Parameters<
        typeof deserializeQuantity
      >[0]),
    ).toThrow();
    expect(() =>
      deserializeUnit({ version: 1, type: "unit" } as unknown as Parameters<
        typeof deserializeUnit
      >[0]),
    ).toThrow();
  });
  it("wrong types", () => {
    expect(() =>
      deserializeQuantity({
        version: 1,
        type: "quantity",
        value: "bad" as unknown as number,
        unit: "kg",
      } as unknown as Parameters<typeof deserializeQuantity>[0]),
    ).toThrow();
    expect(() =>
      deserializeQuantity({
        version: 1,
        type: "quantity",
        value: 1,
        unit: 123 as unknown as string,
      } as unknown as Parameters<typeof deserializeQuantity>[0]),
    ).toThrow();
  });
  it("invalid numbers", () => {
    expect(() =>
      deserializeQuantity({
        version: 1,
        type: "quantity",
        value: "not-a-number" as unknown as number,
        unit: "kg",
      } as unknown as Parameters<typeof deserializeQuantity>[0]),
    ).toThrow();
  });
  it("malformed unit expression", () => {
    expect(() =>
      deserializeQuantity({
        version: 1,
        type: "quantity",
        value: 1,
        unit: "kg//s",
      } as unknown as Parameters<typeof deserializeQuantity>[0]),
    ).toThrow();
    expect(() =>
      deserializeUnit({ version: 1, type: "unit", expression: "/kg" } as unknown as Parameters<
        typeof deserializeUnit
      >[0]),
    ).toThrow();
  });
  it("unknown serialization type", () => {
    expect(() =>
      deserializeQuantity({
        version: 1,
        type: "unknown" as unknown as string,
        value: 1,
        unit: "kg",
      } as unknown as Parameters<typeof deserializeQuantity>[0]),
    ).toThrow();
  });
  it("legacy shape without version still works", () => {
    const q = deserializeQuantity({ value: 12, unit: "kg" } as unknown as Parameters<
      typeof deserializeQuantity
    >[0]);
    expect(q.value).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Security: prototype pollution
// ---------------------------------------------------------------------------

describe("serialization security: prototype pollution", () => {
  it("rejects __proto__", () => {
    const payload = JSON.parse(
      '{"version":1,"type":"quantity","value":1,"unit":"kg","__proto__":{}}',
    );
    const before = ({} as Record<string, unknown>).__proto__;
    expect(() =>
      deserializeQuantity(payload as unknown as Parameters<typeof deserializeQuantity>[0]),
    ).toThrow();
    expect(({} as Record<string, unknown>).__proto__).toBe(before);
  });
  it("rejects constructor", () => {
    const payload = {
      version: 1,
      type: "quantity",
      value: 1,
      unit: "kg",
      constructor: {},
    } as unknown as Parameters<typeof deserializeQuantity>[0];
    expect(() => deserializeQuantity(payload)).toThrow();
  });
  it("rejects prototype", () => {
    const payload = {
      version: 1,
      type: "unit",
      expression: "kg",
      prototype: {},
    } as unknown as Parameters<typeof deserializeUnit>[0];
    expect(() => deserializeUnit(payload)).toThrow();
  });
  it("does not execute arbitrary code in unit expression", () => {
    expect(() =>
      deserializeUnit({ version: 1, type: "unit", expression: "eval(1)" } as unknown as Parameters<
        typeof deserializeUnit
      >[0]),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Runtime guards
// ---------------------------------------------------------------------------

describe("runtime guards", () => {
  it("isQuantity", () => {
    expect(isQuantity(Quantity.of(1, "kg"))).toBe(true);
    // Plain object with correct shape is considered quantity cross-realm
    expect(isQuantity({ value: 1, unit: parseUnit("kg") })).toBe(true);
    expect(isQuantity({ value: 1, unit: parseUnit("kg") } as unknown as Quantity)).toBe(true);
    expect(isQuantity({ value: "1", unit: parseUnit("kg") } as unknown as Quantity)).toBe(false);
    expect(isQuantity(null)).toBe(false);
    expect(isQuantity(undefined)).toBe(false);
    expect(isQuantity([])).toBe(false);
    expect(isQuantity(123)).toBe(false);
    expect(isQuantity("kg")).toBe(false);
  });
  it("isUnit", () => {
    expect(isUnit(parseUnit("kg"))).toBe(true);
    expect(
      isUnit({
        symbol: "kg",
        dimension: {},
        toBaseFactor: 1,
        conversion: { kind: "linear", scale: 1 },
      }),
    ).toBe(true);
    expect(isUnit(null)).toBe(false);
    expect(isUnit({})).toBe(false);
    expect(isUnit([])).toBe(false);
  });
  it("isDimension", () => {
    expect(isDimension({ M: 1 })).toBe(true);
    expect(isDimension({})).toBe(true);
    expect(isDimension({ M: 1.5 })).toBe(false);
    expect(isDimension(null)).toBe(false);
    expect(isDimension([])).toBe(false);
    expect(isDimension({ "bad id": 1 })).toBe(false);
  });
  it("isSerializedQuantity", () => {
    expect(isSerializedQuantity({ version: 1, type: "quantity", value: 1, unit: "kg" })).toBe(true);
    expect(isSerializedQuantity({ value: 1, unit: "kg" })).toBe(true); // legacy
    expect(isSerializedQuantity(null)).toBe(false);
    expect(isSerializedQuantity({ version: 1, type: "quantity", value: "bad", unit: "kg" })).toBe(
      false,
    );
  });
  it("isSerializedUnit", () => {
    expect(isSerializedUnit({ version: 1, type: "unit", expression: "kg" })).toBe(true);
    expect(isSerializedUnit({ version: 1, type: "quantity", value: 1, unit: "kg" })).toBe(false);
    expect(isSerializedUnit(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe("serialization immutability", () => {
  it("changing serialized object after deserialize does not mutate Quantity", () => {
    const q = Quantity.of(10, "kg");
    const ser = serializeQuantity(q);
    (ser as unknown as Record<string, unknown>).value = 999;
    const r = deserializeQuantity({ version: 1, type: "quantity", value: 10, unit: "kg" });
    expect(r.value).toBe(10);
  });
  it("Quantity remains immutable after serialize", () => {
    const q = Quantity.of(10, "kg");
    serializeQuantity(q);
    expect(q.value).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Property: round-trip preserves value
// ---------------------------------------------------------------------------

describe("property: serialize/deserialize preserves mathematical value", () => {
  it("Quantity round-trip", () => {
    const q = Quantity.of(3.14, "m/s");
    const r = deserializeQuantity(serializeQuantity(q));
    expect(r.value).toBeCloseTo(q.value, 9);
    expect(r.dimension).toEqual(q.dimension);
  });
  it("Unit round-trip", () => {
    const u = parseUnit("kg·m/s²");
    const r = deserializeUnit(serializeUnit(u));
    expect(r.dimension).toEqual(u.dimension);
    expect(r.toBaseFactor).toBeCloseTo(u.toBaseFactor, 9);
  });
  it("does not mutate source", () => {
    const q = Quantity.of(5, "kg");
    const before = JSON.stringify(q);
    serializeQuantity(q);
    expect(JSON.stringify(q)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Special numbers
// ---------------------------------------------------------------------------

describe("special numbers serialization", () => {
  it("NaN round-trip", () => {
    const q = Quantity.of(NaN, "kg");
    const ser = serializeQuantity(q);
    expect(ser.value).toBe("NaN");
    const r = deserializeQuantity(ser);
    expect(Number.isNaN(r.value)).toBe(true);
  });
  it("Infinity round-trip", () => {
    const q = Quantity.of(Infinity, "kg");
    expect(deserializeQuantity(serializeQuantity(q)).value).toBe(Infinity);
  });
  it("-Infinity round-trip", () => {
    const q = Quantity.of(-Infinity, "kg");
    expect(deserializeQuantity(serializeQuantity(q)).value).toBe(-Infinity);
  });
  it("-0 round-trip preserves sign", () => {
    const q = Quantity.of(-0, "kg");
    const ser = serializeQuantity(q);
    expect(ser.value).toBe("-0");
    const r = deserializeQuantity(ser);
    expect(Object.is(r.value, -0)).toBe(true);
  });
  it("rejects serialized string value not in allowed set", () => {
    expect(() =>
      deserializeQuantity({
        version: 1,
        type: "quantity",
        value: "bad",
        unit: "kg",
      } as unknown as Parameters<typeof deserializeQuantity>[0]),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Deterministic serialization
// ---------------------------------------------------------------------------

describe("deterministic serialization", () => {
  it("equivalent Quantities serialize identically", () => {
    const a = Quantity.of(10, "kg");
    const b = Quantity.of(10, "kg");
    expect(JSON.stringify(serializeQuantity(a))).toBe(JSON.stringify(serializeQuantity(b)));
  });
  it("key order is version,type,value,unit", () => {
    const ser = serializeQuantity(Quantity.of(1, "kg"));
    expect(Object.keys(ser).join(",")).toBe("version,type,value,unit");
  });
});

// ---------------------------------------------------------------------------
// Custom unit serialization policy
// ---------------------------------------------------------------------------

describe("custom unit serialization policy", () => {
  it("custom unit serialized as expression, requires registry to deserialize", () => {
    const reg = new UnitRegistry([]);
    reg.register(makeUnit({ symbol: "myU", dimension: Dim.Mass, toBaseFactor: 1, label: "my" }));
    const q = Quantity.of(10, "myU", reg);
    const ser = serializeQuantity(q);
    expect(ser.unit).toBe("myU");
    // Without registry, fails
    expect(() => deserializeQuantity(ser)).toThrow();
    // With registry, succeeds
    expect(deserializeQuantity(ser, reg).value).toBe(10);
  });
  it("does not serialize executable behavior", () => {
    const q = Quantity.of(10, "kg");
    const ser = serializeQuantity(q) as unknown as Record<string, unknown>;
    expect(ser).not.toHaveProperty("conversion");
    expect(ser).not.toHaveProperty("toBaseFactor");
  });
});
