/**
 * tests/unit.test.ts — Phase 3: Universal Unit Model tests
 */
import { describe, expect, it } from "vitest";
import {
  Dim,
  makeUnit,
  unitsEqual,
  unitKey,
  isAffineUnit,
  unitsCompatible,
  UnitRegistry,
  defaultUnitRegistry,
} from "../src/index.js";
import { UnitRegistrationError } from "../src/unit-registry.js";
import { parseUnit } from "../src/unit-parser.js";

// ---------------------------------------------------------------------------
// Unit construction
// ---------------------------------------------------------------------------

describe("Unit construction", () => {
  it("creates a frozen unit with required fields", () => {
    const u = makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 });
    expect(u.symbol).toBe("kg");
    expect(u.id).toBe("kg");
    expect(u.name).toBe("kg");
    expect(u.dimension).toBe(Dim.Mass);
    expect(u.toBaseFactor).toBe(1);
    expect(Object.isFrozen(u)).toBe(true);
  });

  it("infers conversion from toBaseFactor", () => {
    const u = makeUnit({ symbol: "g", dimension: Dim.Mass, toBaseFactor: 0.001 });
    expect(u.conversion).toEqual({ kind: "linear", scale: 0.001 });
  });

  it("uses explicit conversion when provided", () => {
    const u = makeUnit({
      symbol: "°C",
      dimension: Dim.Temperature,
      conversion: { kind: "affine", scale: 1, offset: 273.15 },
    });
    expect(u.conversion).toEqual({ kind: "affine", scale: 1, offset: 273.15 });
    expect(u.toBaseFactor).toBe(1);
  });

  it("defaults id to symbol and name to label", () => {
    const u = makeUnit({ symbol: "m", dimension: Dim.Length, toBaseFactor: 1, label: "meter" });
    expect(u.id).toBe("m");
    expect(u.name).toBe("meter");
  });

  it("uses explicit id and name when provided", () => {
    const u = makeUnit({
      id: "meter-canonical",
      symbol: "m",
      name: "meter",
      dimension: Dim.Length,
      toBaseFactor: 1,
    });
    expect(u.id).toBe("meter-canonical");
    expect(u.name).toBe("meter");
  });

  it("stores aliases as frozen array", () => {
    const u = makeUnit({
      symbol: "m",
      dimension: Dim.Length,
      toBaseFactor: 1,
      aliases: ["meter", "metre"],
    });
    expect(u.aliases).toEqual(["meter", "metre"]);
    expect(Object.isFrozen(u.aliases)).toBe(true);
  });

  it("stores metadata", () => {
    const u = makeUnit({
      symbol: "kg",
      dimension: Dim.Mass,
      toBaseFactor: 1,
      metadata: { system: "SI", category: "mass", docs: "kilogram" },
    });
    expect(u.metadata?.system).toBe("SI");
    expect(Object.isFrozen(u.metadata!)).toBe(true);
  });

  it("conversion is frozen", () => {
    const u = makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 });
    expect(Object.isFrozen(u.conversion)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit immutability
// ---------------------------------------------------------------------------

describe("Unit immutability", () => {
  it("cannot mutate symbol", () => {
    const u = makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 });
    expect(() => {
      (u as unknown as Record<string, unknown>).symbol = "g";
    }).toThrow();
    expect(u.symbol).toBe("kg");
  });

  it("cannot mutate dimension", () => {
    const u = makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 });
    expect(() => {
      (u as unknown as Record<string, unknown>).dimension = Dim.Length;
    }).toThrow();
    expect(u.dimension).toBe(Dim.Mass);
  });

  it("cannot mutate conversion", () => {
    const u = makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 });
    expect(() => {
      (u as unknown as Record<string, unknown>).conversion = { kind: "linear", scale: 2 };
    }).toThrow();
    expect(u.conversion.scale).toBe(1);
  });

  it("cannot push into aliases", () => {
    const u = makeUnit({
      symbol: "m",
      dimension: Dim.Length,
      toBaseFactor: 1,
      aliases: ["meter"],
    });
    expect(() => {
      (u.aliases as unknown as string[]).push("metre");
    }).toThrow();
  });

  it("creating a new unit from an existing one does not affect the original", () => {
    const original = makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 });
    const modified = makeUnit({ ...original, symbol: "kg2" });
    expect(original.symbol).toBe("kg");
    expect(modified.symbol).toBe("kg2");
  });
});

// ---------------------------------------------------------------------------
// Unit dimension association
// ---------------------------------------------------------------------------

describe("Unit dimension", () => {
  it("kg has Mass dimension", () => {
    const u = parseUnit("kg");
    expect(u.dimension).toEqual(Dim.Mass);
  });

  it("m has Length dimension", () => {
    const u = parseUnit("m");
    expect(u.dimension).toEqual(Dim.Length);
  });

  it("s has Time dimension", () => {
    const u = parseUnit("s");
    expect(u.dimension).toEqual(Dim.Time);
  });

  it("K has Temperature dimension", () => {
    const u = parseUnit("K");
    expect(u.dimension).toEqual(Dim.Temperature);
  });

  it("derived unit m/s has Length/Time", () => {
    const mUnit = parseUnit("m");
    const sUnit = parseUnit("s");
    expect(mUnit.dimension).toEqual(Dim.Length);
    expect(sUnit.dimension).toEqual(Dim.Time);
  });

  it("uses generic Dimension system (no hard-coded dimension check)", () => {
    const customDim = makeUnit({ symbol: "custom", dimension: Dim.Energy, toBaseFactor: 1 });
    expect(customDim.dimension).toEqual(Dim.Energy);
  });
});

// ---------------------------------------------------------------------------
// Unit identity vs symbol vs name vs aliases
// ---------------------------------------------------------------------------

describe("Unit identity", () => {
  it("unitKey uses id, not symbol for identity", () => {
    const a = makeUnit({ id: "meter", symbol: "m", dimension: Dim.Length, toBaseFactor: 1 });
    const b = makeUnit({ id: "meter", symbol: "meter", dimension: Dim.Length, toBaseFactor: 1 });
    expect(unitKey(a)).toBe(unitKey(b));
  });

  it("unitsEqual checks id + basis", () => {
    const a = makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 });
    const b = makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 });
    expect(unitsEqual(a, b)).toBe(true);
  });

  it("unitsEqual fails when basis differs", () => {
    const a = makeUnit({
      symbol: "%",
      dimension: Dim.Dimensionless,
      toBaseFactor: 0.01,
      basis: "DM",
    });
    const b = makeUnit({
      symbol: "%",
      dimension: Dim.Dimensionless,
      toBaseFactor: 0.01,
      basis: "asFed",
    });
    expect(unitsEqual(a, b)).toBe(false);
  });

  it("unitsEqual fails when id differs", () => {
    const a = makeUnit({ id: "a", symbol: "m", dimension: Dim.Length, toBaseFactor: 1 });
    const b = makeUnit({ id: "b", symbol: "m", dimension: Dim.Length, toBaseFactor: 1 });
    expect(unitsEqual(a, b)).toBe(false);
  });

  it("unitsCompatible checks dimension equality", () => {
    const kg = parseUnit("kg");
    const g = parseUnit("g");
    const m = parseUnit("m");
    expect(unitsCompatible(kg, g)).toBe(true);
    expect(unitsCompatible(kg, m)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Alias system
// ---------------------------------------------------------------------------

describe("Unit aliases", () => {
  it("resolves alias to canonical unit", () => {
    const registry = new UnitRegistry([]);
    registry.register(
      makeUnit({
        symbol: "m",
        dimension: Dim.Length,
        toBaseFactor: 1,
        aliases: ["meter", "metre"],
        label: "meter",
      }),
    );
    const viaAlias = registry.resolve("meter");
    const viaCanonical = registry.resolve("m");
    expect(viaAlias.symbol).toBe("m");
    expect(viaAlias).toBe(viaCanonical); // same object
  });

  it("parseUnit resolves aliases through registry", () => {
    const registry = new UnitRegistry([]);
    registry.register(
      makeUnit({
        symbol: "kg",
        dimension: Dim.Mass,
        toBaseFactor: 1,
        aliases: ["kilogram"],
        label: "kilogram",
      }),
    );
    const u = parseUnit("kilogram", registry);
    expect(u.symbol).toBe("kg");
  });

  it("alias system is deterministic", () => {
    const registry = new UnitRegistry([]);
    registry.register(
      makeUnit({ symbol: "m", dimension: Dim.Length, toBaseFactor: 1, aliases: ["meter"] }),
    );
    expect(registry.resolve("meter").symbol).toBe("m");
    expect(registry.resolve("meter").symbol).toBe("m");
    expect(registry.resolve("m").symbol).toBe("m");
  });

  it("distinguishes canonical symbols from aliases via aliasIndex", () => {
    const registry = new UnitRegistry([]);
    registry.register(
      makeUnit({ symbol: "m", dimension: Dim.Length, toBaseFactor: 1, aliases: ["meter"] }),
    );
    expect(registry.has("m")).toBe(true);
    expect(registry.has("meter")).toBe(true);
    expect(registry.hasSymbol("m")).toBe(true);
    expect(registry.hasSymbol("meter")).toBe(false);
  });

  it("does not duplicate Unit objects for aliases", () => {
    const registry = new UnitRegistry([]);
    const unit = makeUnit({
      symbol: "m",
      dimension: Dim.Length,
      toBaseFactor: 1,
      aliases: ["meter"],
    });
    registry.register(unit);
    const a = registry.resolve("m");
    const b = registry.resolve("meter");
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Registry lookup
// ---------------------------------------------------------------------------

describe("UnitRegistry lookup", () => {
  it("resolves canonical units", () => {
    expect(defaultUnitRegistry.resolve("kg").symbol).toBe("kg");
    expect(defaultUnitRegistry.resolve("m").symbol).toBe("m");
    expect(defaultUnitRegistry.resolve("K").symbol).toBe("K");
  });

  it("resolves derived units via parseUnit", () => {
    const u = parseUnit("g/day");
    expect(u.symbol).toBe("g/day");
  });

  it("retrieves canonical unit per dimension", () => {
    const massCanonical = defaultUnitRegistry.getCanonicalUnit(Dim.Mass);
    expect(massCanonical?.symbol).toBe("kg");
    const lengthCanonical = defaultUnitRegistry.getCanonicalUnit(Dim.Length);
    expect(lengthCanonical?.symbol).toBe("m");
    const tempCanonical = defaultUnitRegistry.getCanonicalUnit(Dim.Temperature);
    expect(tempCanonical?.symbol).toBe("K");
  });

  it("checking existence via has()", () => {
    expect(defaultUnitRegistry.has("kg")).toBe(true);
    expect(defaultUnitRegistry.has("nonexistent-xyz")).toBe(false);
  });

  it("list returns all units", () => {
    const registry = new UnitRegistry([]);
    registry.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 }));
    registry.register(makeUnit({ symbol: "m", dimension: Dim.Length, toBaseFactor: 1 }));
    expect(registry.list()).toHaveLength(2);
    expect(registry.size).toBe(2);
  });

  it("deterministic lookup independent of insertion order", () => {
    const r1 = new UnitRegistry([]);
    r1.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 }));
    r1.register(makeUnit({ symbol: "g", dimension: Dim.Mass, toBaseFactor: 0.001 }));
    const r2 = new UnitRegistry([]);
    r2.register(makeUnit({ symbol: "g", dimension: Dim.Mass, toBaseFactor: 0.001 }));
    r2.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 }));
    expect(r1.resolve("kg").toBaseFactor).toBe(r2.resolve("kg").toBaseFactor);
    expect(r1.resolve("g").toBaseFactor).toBe(r2.resolve("g").toBaseFactor);
  });
});

// ---------------------------------------------------------------------------
// Registration safety
// ---------------------------------------------------------------------------

describe("UnitRegistry registration safety", () => {
  it("rejects duplicate canonical symbols", () => {
    const registry = new UnitRegistry([]);
    registry.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 }));
    expect(() =>
      registry.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 0.5 })),
    ).toThrow(UnitRegistrationError);
  });

  it("rejects conflicting aliases (alias already used as canonical symbol)", () => {
    const registry = new UnitRegistry([]);
    registry.register(makeUnit({ symbol: "m", dimension: Dim.Length, toBaseFactor: 1 }));
    expect(() =>
      registry.register(
        makeUnit({ symbol: "km", dimension: Dim.Length, toBaseFactor: 1000, aliases: ["m"] }),
      ),
    ).toThrow(UnitRegistrationError);
  });

  it("rejects conflicting aliases (alias already registered for another unit)", () => {
    const registry = new UnitRegistry([]);
    registry.register(
      makeUnit({ symbol: "m", dimension: Dim.Length, toBaseFactor: 1, aliases: ["meter"] }),
    );
    expect(() =>
      registry.register(
        makeUnit({ symbol: "km", dimension: Dim.Length, toBaseFactor: 1000, aliases: ["meter"] }),
      ),
    ).toThrow(UnitRegistrationError);
  });

  it("rejects invalid dimensions (via makeUnit validation)", () => {
    expect(() => makeUnit({ symbol: "", dimension: Dim.Mass, toBaseFactor: 1 })).toThrow();
    expect(() =>
      makeUnit({ symbol: "x", dimension: null as unknown as typeof Dim.Mass, toBaseFactor: 1 }),
    ).toThrow();
  });

  it("rejects invalid conversion definitions (scale 0)", () => {
    expect(() =>
      makeUnit({ symbol: "bad", dimension: Dim.Mass, conversion: { kind: "linear", scale: 0 } }),
    ).toThrow();
  });

  it("rejects invalid conversion definitions (scale NaN)", () => {
    expect(() =>
      makeUnit({ symbol: "bad", dimension: Dim.Mass, conversion: { kind: "linear", scale: NaN } }),
    ).toThrow();
  });

  it("rejects invalid conversion definitions (scale Infinity)", () => {
    expect(() =>
      makeUnit({
        symbol: "bad",
        dimension: Dim.Mass,
        conversion: { kind: "linear", scale: Infinity },
      }),
    ).toThrow();
  });

  it("rejects invalid affine offset NaN", () => {
    expect(() =>
      makeUnit({
        symbol: "bad",
        dimension: Dim.Temperature,
        conversion: { kind: "affine", scale: 1, offset: NaN },
      }),
    ).toThrow();
  });

  it("does not silently overwrite an existing unit", () => {
    const registry = new UnitRegistry([]);
    registry.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 }));
    const original = registry.resolve("kg");
    expect(() =>
      registry.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 2 })),
    ).toThrow();
    expect(registry.resolve("kg")).toBe(original);
  });

  it("unregistering allows re-registration", () => {
    const registry = new UnitRegistry([]);
    registry.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 }));
    registry.unregister("kg");
    expect(() =>
      registry.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 2 })),
    ).not.toThrow();
    expect(registry.resolve("kg").toBaseFactor).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Unit equality & metadata
// ---------------------------------------------------------------------------

describe("Unit equality and metadata", () => {
  it("isAffineUnit detects affine units", () => {
    const k = parseUnit("K");
    const c = parseUnit("°C");
    const f = parseUnit("°F");
    expect(isAffineUnit(k)).toBe(false);
    expect(isAffineUnit(c)).toBe(true);
    expect(isAffineUnit(f)).toBe(true);
  });

  it("isAffineUnit returns false for linear units", () => {
    const kg = parseUnit("kg");
    const m = parseUnit("m");
    expect(isAffineUnit(kg)).toBe(false);
    expect(isAffineUnit(m)).toBe(false);
  });

  it("metadata is accessible and extensible", () => {
    const u = makeUnit({
      symbol: "kg",
      dimension: Dim.Mass,
      toBaseFactor: 1,
      metadata: { system: "SI", docs: "kilogram" },
    });
    expect(u.metadata?.system).toBe("SI");
    expect(u.metadata?.docs).toBe("kilogram");
  });

  it("unit registry does not mutate Unit objects", () => {
    const registry = new UnitRegistry([]);
    const unit = makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 });
    const frozenSnapshot = JSON.stringify(unit);
    registry.register(unit);
    expect(JSON.stringify(unit)).toBe(frozenSnapshot);
    registry.resolve("kg");
    expect(JSON.stringify(unit)).toBe(frozenSnapshot);
  });

  it("parseUnit returns frozen units", () => {
    const u = parseUnit("kg");
    expect(Object.isFrozen(u)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Conversion definition validation
// ---------------------------------------------------------------------------

describe("Conversion definition validation", () => {
  it("linear conversion has correct shape", () => {
    const u = makeUnit({ symbol: "g", dimension: Dim.Mass, toBaseFactor: 0.001 });
    expect(u.conversion.kind).toBe("linear");
    expect(u.conversion.scale).toBe(0.001);
  });

  it("affine conversion has correct shape", () => {
    const u = makeUnit({
      symbol: "°C",
      dimension: Dim.Temperature,
      conversion: { kind: "affine", scale: 1, offset: 273.15 },
    });
    expect(u.conversion.kind).toBe("affine");
    if (u.conversion.kind === "affine") {
      expect(u.conversion.offset).toBe(273.15);
    }
  });

  it("rejects invalid kind", () => {
    expect(() =>
      makeUnit({
        symbol: "bad",
        dimension: Dim.Mass,
        conversion: { kind: "log" as unknown as "linear", scale: 1 },
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: old UnitRegistry API
// ---------------------------------------------------------------------------

describe("Backward compatibility", () => {
  it("hasAtomic still works as alias to has", () => {
    const registry = new UnitRegistry([]);
    registry.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 }));
    expect(registry.hasAtomic("kg")).toBe(true);
    expect(registry.hasAtomic("missing")).toBe(false);
  });

  it("getAtomic still works as alias to resolve", () => {
    const registry = new UnitRegistry([]);
    registry.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 }));
    expect(registry.getAtomic("kg").symbol).toBe("kg");
  });

  it("listAtomics still works as alias to list", () => {
    const registry = new UnitRegistry([]);
    registry.register(makeUnit({ symbol: "kg", dimension: Dim.Mass, toBaseFactor: 1 }));
    expect(registry.listAtomics()).toHaveLength(1);
  });

  it("toBaseFactor remains accessible for linear units", () => {
    const kg = parseUnit("kg");
    const g = parseUnit("g");
    expect(kg.toBaseFactor).toBe(1);
    expect(g.toBaseFactor).toBe(0.001);
  });
});
