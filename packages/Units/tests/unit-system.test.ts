/**
 * tests/unit-system.test.ts — Phase 12: Unit Standards, Systems & Extensibility
 */
import { describe, expect, it } from "vitest";
import { UnitSystemRegistry, defaultUnitSystemRegistry, SI_SYSTEM } from "../src/unit-system.js";
import { UnitRegistry } from "../src/unit-registry.js";
import { makeUnit } from "../src/unit.js";
import { Dim } from "../src/dimension.js";
import { Quantity } from "../src/quantity.js";

// ---------------------------------------------------------------------------
// System registration
// ---------------------------------------------------------------------------

describe("UnitSystem registration", () => {
  it("registers and retrieves SI", () => {
    expect(defaultUnitSystemRegistry.hasSystem("si")).toBe(true);
    expect(defaultUnitSystemRegistry.getSystem("si")?.version).toBe("1.0.0");
  });

  it("duplicate system throws", () => {
    const reg = new UnitSystemRegistry();
    reg.registerSystem({ name: "test", version: "1.0.0", units: [] });
    expect(() => reg.registerSystem({ name: "test", version: "1.0.0", units: [] })).toThrow();
  });

  it("invalid name/version throws", () => {
    const reg = new UnitSystemRegistry();
    expect(() =>
      reg.registerSystem({ name: "", version: "1.0.0", units: [] } as unknown as Parameters<
        typeof reg.registerSystem
      >[0]),
    ).toThrow();
    expect(() =>
      reg.registerSystem({ name: "bad name", version: "1.0.0", units: [] } as unknown as Parameters<
        typeof reg.registerSystem
      >[0]),
    ).toThrow();
  });

  it("listSystems", () => {
    const reg = new UnitSystemRegistry();
    reg.registerSystem({ name: "a", version: "1.0.0", units: [] });
    reg.registerSystem({ name: "b", version: "1.0.0", units: [] });
    expect(
      reg
        .listSystems()
        .map((s) => s.name)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("system is frozen (immutability)", () => {
    const sys = defaultUnitSystemRegistry.getSystem("si")!;
    expect(Object.isFrozen(sys)).toBe(true);
    expect(Object.isFrozen(sys.units)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit pack
// ---------------------------------------------------------------------------

describe("UnitPack registration", () => {
  it("registers pack", () => {
    const reg = new UnitSystemRegistry();
    reg.registerPack({ name: "myPack", version: "1.0.0", units: [] });
    expect(reg.hasPack("myPack")).toBe(true);
  });
  it("duplicate pack throws", () => {
    const reg = new UnitSystemRegistry();
    reg.registerPack({ name: "p", version: "1.0.0", units: [] });
    expect(() => reg.registerPack({ name: "p", version: "1.0.0", units: [] })).toThrow();
  });
  it("pack immutability", () => {
    const reg = new UnitSystemRegistry();
    const pack = reg.registerPack({ name: "p2", version: "1.0.0", units: [] });
    expect(Object.isFrozen(pack)).toBe(true);
  });
  it("applyPackToRegistry adds units", () => {
    const reg = new UnitSystemRegistry();
    reg.registerPack({
      name: "demo",
      version: "1.0.0",
      units: [{ symbol: "myU", dimension: Dim.Mass, toBaseFactor: 2, label: "my" }],
    });
    const ur = new UnitRegistry([]);
    reg.applyPackToRegistry("demo", ur);
    expect(ur.has("myU")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Collisions & aliases
// ---------------------------------------------------------------------------

describe("System collisions", () => {
  it("alias collisions are caught at apply time via UnitRegistry", () => {
    const reg = new UnitSystemRegistry();
    reg.registerSystem({
      name: "s1",
      version: "1.0.0",
      units: [{ symbol: "dup", dimension: Dim.Mass, toBaseFactor: 1, label: "a" }],
    });
    const ur = new UnitRegistry([]);
    ur.register(makeUnit({ symbol: "dup", dimension: Dim.Length, toBaseFactor: 1 }));
    expect(() => reg.applySystemToRegistry("s1", ur)).toThrow();
  });
  it("same symbol, different meaning via explicit system context", () => {
    // ton: SI ton vs imperial ton (different factor)
    // SI ton: 1000 kg
    // Imperial ton: 907.18474 kg (we use 907.18474 as factor relative to kg base)
    const siTonFactor = 1000; // kg per ton (SI)
    const impTonFactor = 907.18474;
    const sysReg = new UnitSystemRegistry();
    sysReg.registerSystem({
      name: "siTon",
      version: "1.0.0",
      units: [{ symbol: "ton", dimension: Dim.Mass, toBaseFactor: siTonFactor, label: "SI ton" }],
    });
    sysReg.registerSystem({
      name: "impTon",
      version: "1.0.0",
      units: [
        { symbol: "ton", dimension: Dim.Mass, toBaseFactor: impTonFactor, label: "Imperial ton" },
      ],
    });
    const siTon = sysReg.resolveWithSystem("ton", "siTon");
    const impTon = sysReg.resolveWithSystem("ton", "impTon");
    expect(siTon.toBaseFactor).toBe(siTonFactor);
    expect(impTon.toBaseFactor).toBe(impTonFactor);
    // Not silently chosen by registration order
    expect(siTon.toBaseFactor).not.toBe(impTon.toBaseFactor);
  });
});

// ---------------------------------------------------------------------------
// Explicit system selection vs global mutable
// ---------------------------------------------------------------------------

describe("System context explicit", () => {
  it("resolveWithSystem does not mutate global registry", () => {
    const reg = new UnitSystemRegistry();
    reg.registerSystem({
      name: "custom",
      version: "1.0.0",
      units: [{ symbol: "foo", dimension: Dim.Length, toBaseFactor: 1, label: "foo" }],
    });
    const before = new UnitRegistry().has("foo");
    expect(before).toBe(false);
    reg.resolveWithSystem("foo", "custom");
    expect(new UnitRegistry().has("foo")).toBe(false); // still false, not polluted
  });
  it("concurrent safe: two systems can be used in parallel", async () => {
    const reg = new UnitSystemRegistry();
    reg.registerSystem({
      name: "a",
      version: "1.0.0",
      units: [{ symbol: "uA", dimension: Dim.Mass, toBaseFactor: 1, label: "a" }],
    });
    reg.registerSystem({
      name: "b",
      version: "1.0.0",
      units: [{ symbol: "uB", dimension: Dim.Mass, toBaseFactor: 2, label: "b" }],
    });
    const [a, b] = await Promise.all([
      Promise.resolve(reg.resolveWithSystem("uA", "a")),
      Promise.resolve(reg.resolveWithSystem("uB", "b")),
    ]);
    expect(a.toBaseFactor).toBe(1);
    expect(b.toBaseFactor).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Cross-system conversion (same dimension)
// ---------------------------------------------------------------------------

describe("Cross-system conversion", () => {
  it("1 kg ↔ lb via ATOMIC_UNITS (both in SI foundational)", () => {
    expect(Quantity.of(1, "kg").to("lb").to("kg").value).toBeCloseTo(1, 9);
  });
  it("kg → lb → kg round-trip preserves physical quantity", () => {
    const original = Quantity.of(5, "kg");
    const viaLb = original.to("lb");
    const back = viaLb.to("kg");
    expect(back.value).toBeCloseTo(original.value, 9);
  });
  it("system membership does not change dimension", () => {
    const siKg = defaultUnitSystemRegistry.resolveWithSystem("kg", "si");
    expect(siKg.dimension).toEqual(Dim.Mass);
    // Even if we had imperial lb in another system, its dimension is still Mass
    const lb = new UnitRegistry().has("lb") ? new UnitRegistry().resolve("lb") : null;
    if (lb) expect(lb.dimension).toEqual(Dim.Mass);
  });
});

// ---------------------------------------------------------------------------
// Preferred units (presentation only)
// ---------------------------------------------------------------------------

describe("Preferred units", () => {
  it("preferredUnits are metadata only", () => {
    const si = defaultUnitSystemRegistry.getSystem("si")!;
    expect(si.preferredUnits?.mass).toBe("kg");
    // Arithmetic does not auto-convert to preferred
    const q = Quantity.of(1000, "g");
    expect(q.value).toBe(1000); // not auto 1 kg
    expect(q.to("kg").value).toBe(1); // explicit only
  });
});

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

describe("System versioning", () => {
  it("version metadata present", () => {
    expect(SI_SYSTEM.version).toBe("1.0.0");
  });
  it("unknown system throws", () => {
    expect(() => defaultUnitSystemRegistry.resolveWithSystem("kg", "unknownSys")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Custom unit registration (via UnitRegistry, not system)
// ---------------------------------------------------------------------------

describe("Custom unit registration", () => {
  it("registerAtomic with symbol collision throws", () => {
    const reg = new UnitRegistry([]);
    reg.register(makeUnit({ symbol: "myU", dimension: Dim.Mass, toBaseFactor: 1 }));
    expect(() =>
      reg.register(makeUnit({ symbol: "myU", dimension: Dim.Mass, toBaseFactor: 2 })),
    ).toThrow();
  });
  it("custom unit via system pack", () => {
    const sysReg = new UnitSystemRegistry();
    sysReg.registerPack({
      name: "customPack",
      version: "1.0.0",
      units: [{ symbol: "myCustom", dimension: Dim.Length, toBaseFactor: 123, label: "my" }],
    });
    const ur = new UnitRegistry([]);
    sysReg.applyPackToRegistry("customPack", ur);
    expect(ur.resolve("myCustom").toBaseFactor).toBe(123);
  });
  it("immutability: registered units frozen", () => {
    const u = makeUnit({ symbol: "xU", dimension: Dim.Mass, toBaseFactor: 1 });
    const reg = new UnitRegistry([]);
    reg.register(u);
    expect(Object.isFrozen(reg.resolve("xU"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Security: packs are data, not code
// ---------------------------------------------------------------------------

describe("System security", () => {
  it("pack with __proto__ is rejected", () => {
    const reg = new UnitSystemRegistry();
    const malicious = JSON.parse('{"name":"bad","version":"1.0.0","units":[],"__proto__":{}}');
    expect(() =>
      reg.registerSystem(malicious as unknown as Parameters<typeof reg.registerSystem>[0]),
    ).toThrow();
  });
  it("unit with function factor is rejected", () => {
    const reg = new UnitSystemRegistry();
    const badUnit = {
      symbol: "bad",
      dimension: Dim.Mass,
      toBaseFactor: (() => 1) as unknown as number,
      label: "bad",
    } as unknown as Parameters<typeof reg.registerSystem>[0]["units"][number];
    expect(() =>
      reg.registerSystem({ name: "badSys", version: "1.0.0", units: [badUnit] }),
    ).toThrow();
  });
  it("prototype not polluted after malicious pack", () => {
    const before = ({} as Record<string, unknown>).__proto__;
    const reg = new UnitSystemRegistry();
    try {
      reg.registerPack(
        JSON.parse(
          '{"name":"p","version":"1.0.0","units":[{"symbol":"x","dimension":{},"toBaseFactor":1,"label":"x"}],"__proto__":{}}',
        ) as unknown as Parameters<typeof reg.registerPack>[0],
      );
    } catch {
      void 0;
    }
    expect(({} as Record<string, unknown>).__proto__).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Property: system conversion round-trip
// ---------------------------------------------------------------------------

describe("System property: kg → lb → kg", () => {
  it("preserves value within tolerance", () => {
    const q = Quantity.of(2.5, "kg");
    expect(q.to("lb").to("kg").value).toBeCloseTo(q.value, 9);
  });
});
