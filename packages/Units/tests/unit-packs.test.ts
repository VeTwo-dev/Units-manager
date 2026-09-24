/**
 * tests/unit-packs.test.ts — Phase 17: Universal Unit Systems, Standards &
 * Scientific Data Packs. Per-pack: registration, parsing, conversion,
 * aliases, serialization, collisions, dimensions. Plus registry mechanics
 * (unregister, version, preferred, snapshot, createRegistry, validation).
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Dim,
  UnitRegistry,
  UnitSystemRegistry,
  defaultUnitSystemRegistry,
  SI_SYSTEM,
  SI_PACK,
  SI_DERIVED_PACK,
  IMPERIAL_PACK,
  US_CUSTOMARY_PACK,
  CGS_PACK,
  SCIENTIFIC_PACK,
  createRegistry,
  canonicalUnitKey,
  getDeprecationNotice,
  makeUnit,
  parseUnit,
  serializeQuantity,
  deserializeQuantity,
  serializeUnit,
  deserializeUnit,
  UnitRegistrationError,
} from "../src/index.js";
import { dimensionsEqual } from "../src/dimension.js";

// ---------------------------------------------------------------------------
// SI pack
// ---------------------------------------------------------------------------

describe("SI pack", () => {
  it("registers as a built-in pack definition", () => {
    expect(defaultUnitSystemRegistry.hasPack("si")).toBe(true);
    expect(defaultUnitSystemRegistry.getPack("si")?.version).toBe("1.0.0");
  });

  it("SI_SYSTEM extends core with pack units (additive, version unchanged)", () => {
    const symbols = new Set(SI_SYSTEM.units.map((u) => u.symbol));
    for (const s of ["A", "mol", "cd", "N", "Pa", "J", "tonne", "L", "V"]) {
      expect(symbols.has(s)).toBe(true);
    }
    expect(SI_SYSTEM.version).toBe("1.0.0");
  });

  it("SI derived pack is real (N, Pa, J, Wh)", () => {
    expect(defaultUnitSystemRegistry.hasPack("si-derived")).toBe(true);
    const symbols = new Set(
      (defaultUnitSystemRegistry.getPack("si-derived")?.units ?? []).map((u) => u.symbol),
    );
    for (const s of ["N", "Pa", "J", "Wh"]) expect(symbols.has(s)).toBe(true);
    // Exported pack object matches the registered definition
    expect(SI_DERIVED_PACK.units.map((u) => u.symbol)).toEqual(
      expect.arrayContaining(["N", "Pa", "J", "Wh"]),
    );
  });

  it("parses SI base extras with correct dimensions", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    expect(parseUnit("A", reg).dimension).toEqual(Dim.Current);
    expect(parseUnit("mol", reg).dimension).toEqual(Dim.Substance);
    expect(parseUnit("cd", reg).dimension).toEqual(Dim.LuminousIntensity);
    expect(parseUnit("lm", reg).dimension).toEqual(Dim.LuminousIntensity);
    expect(parseUnit("lx", reg).dimension).toEqual({ J: 1, L: -2 });
  });

  it("parses SI derived units with correct dimensions", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    expect(parseUnit("N", reg).dimension).toEqual({ M: 1, L: 1, T: -2 });
    expect(parseUnit("Pa", reg).dimension).toEqual({ M: 1, L: -1, T: -2 });
    expect(parseUnit("J", reg).dimension).toEqual(Dim.Energy);
    expect(parseUnit("Wh", reg).dimension).toEqual(Dim.Energy);
  });

  it("resolves SI aliases", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    expect(parseUnit("newton", reg).symbol).toBe("N");
    expect(parseUnit("pascal", reg).symbol).toBe("Pa");
    expect(parseUnit("joule", reg).symbol).toBe("J");
    expect(parseUnit("ampere", reg).symbol).toBe("A");
    expect(parseUnit("liter", reg).symbol).toBe("L");
    expect(parseUnit("litre", reg).symbol).toBe("L");
  });

  it("converts N ↔ lbf and Pa ↔ psi across packs", () => {
    const reg = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK] });
    expect(Quantity.of(1, "N", reg).to("lbf", reg).value).toBeCloseTo(0.224809, 6);
    expect(Quantity.of(1, "Pa", reg).to("psi", reg).value).toBeCloseTo(0.0001450377, 9);
  });

  it("converts J ↔ cal and Wh ↔ J", () => {
    const reg = createRegistry({ packs: [SI_PACK, SCIENTIFIC_PACK] });
    expect(Quantity.of(1, "cal", reg).to("J", reg).value).toBeCloseTo(4.184, 9);
    expect(Quantity.of(1, "Wh", reg).to("J", reg).value).toBeCloseTo(3600, 9);
    expect(Quantity.of(1, "kWh", reg).to("Wh", reg).value).toBeCloseTo(1000, 9);
  });

  it("serializes SI-pack quantities round-trip", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    const q = Quantity.of(10, "N", reg);
    const restored = deserializeQuantity(serializeQuantity(q), reg);
    expect(restored.value).toBeCloseTo(10, 12);
    expect(restored.dimension).toEqual(q.dimension);
    const u = deserializeUnit(serializeUnit(parseUnit("Pa", reg)), reg);
    expect(u.symbol).toBe("Pa");
  });

  it("canonical keys: N equals kg·m/s² (dimension + scale)", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    const n = parseUnit("N", reg);
    const composed = parseUnit("kg·m/s²", reg);
    expect(dimensionsEqual(n.dimension, composed.dimension)).toBe(true);
    expect(n.toBaseFactor).toBeCloseTo(composed.toBaseFactor, 6);
    expect(canonicalUnitKey(n)).toBe(canonicalUnitKey(composed));
  });
});

// ---------------------------------------------------------------------------
// Imperial pack
// ---------------------------------------------------------------------------

describe("Imperial pack", () => {
  it("registers as a built-in system and pack", () => {
    expect(defaultUnitSystemRegistry.hasSystem("imperial")).toBe(true);
    expect(defaultUnitSystemRegistry.hasPack("imperial")).toBe(true);
  });

  it("parses imperial units with correct dimensions", () => {
    const reg = createRegistry({ packs: [IMPERIAL_PACK] });
    expect(parseUnit("yd", reg).dimension).toEqual(Dim.Length);
    expect(parseUnit("mile", reg).dimension).toEqual(Dim.Length);
    expect(parseUnit("oz", reg).dimension).toEqual(Dim.Mass);
    expect(parseUnit("acre", reg).dimension).toEqual({ L: 2 });
    expect(parseUnit("gal", reg).dimension).toEqual({ L: 3 });
    expect(parseUnit("mph", reg).dimension).toEqual({ L: 1, T: -1 });
    expect(parseUnit("lbf", reg).dimension).toEqual({ M: 1, L: 1, T: -2 });
    expect(parseUnit("psi", reg).dimension).toEqual({ M: 1, L: -1, T: -2 });
  });

  it("converts imperial to SI bases", () => {
    const reg = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK] });
    expect(Quantity.of(1, "mile", reg).to("m", reg).value).toBeCloseTo(1609.344, 9);
    expect(Quantity.of(1, "yd", reg).to("m", reg).value).toBeCloseTo(0.9144, 12);
    expect(Quantity.of(1, "oz", reg).to("g", reg).value).toBeCloseTo(28.349523125, 9);
    expect(Quantity.of(1, "gal", reg).to("L", reg).value).toBeCloseTo(4.54609, 9);
    expect(Quantity.of(1, "acre", reg).to("m^2", reg).value).toBeCloseTo(4046.8564224, 6);
    expect(Quantity.of(1, "mph", reg).to("m/s", reg).value).toBeCloseTo(0.44704, 9);
    expect(Quantity.of(1, "knot", reg).to("m/s", reg).value).toBeCloseTo(1852 / 3600, 9);
  });

  it("resolves imperial aliases", () => {
    const reg = createRegistry({ packs: [IMPERIAL_PACK] });
    expect(parseUnit("yard", reg).symbol).toBe("yd");
    expect(parseUnit("gallon", reg).symbol).toBe("gal");
  });

  it("imperial ton is the long ton", () => {
    const reg = createRegistry({ packs: [IMPERIAL_PACK] });
    expect(Quantity.of(1, "ton", reg).to("kg", reg).value).toBeCloseTo(1016.0469088, 6);
  });
});

// ---------------------------------------------------------------------------
// US customary pack (+ shared definitions, collisions)
// ---------------------------------------------------------------------------

describe("US customary pack", () => {
  it("registers as a built-in system and pack", () => {
    expect(defaultUnitSystemRegistry.hasSystem("us-customary")).toBe(true);
    expect(defaultUnitSystemRegistry.hasPack("us-customary")).toBe(true);
  });

  it("reuses identical shared definitions (no duplication)", () => {
    const usYd = US_CUSTOMARY_PACK.units.find((u) => u.symbol === "yd");
    const impYd = IMPERIAL_PACK.units.find((u) => u.symbol === "yd");
    expect(usYd).toBe(impYd); // same object
  });

  it("US gallon differs from imperial gallon; short ton differs from long ton", () => {
    const us = createRegistry({ packs: [SI_PACK, US_CUSTOMARY_PACK] });
    const imp = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK] });
    expect(Quantity.of(1, "gal", us).to("L", us).value).toBeCloseTo(3.785411784, 9);
    expect(Quantity.of(1, "gal", imp).to("L", imp).value).toBeCloseTo(4.54609, 9);
    expect(Quantity.of(1, "ton", us).to("kg", us).value).toBeCloseTo(907.18474, 6);
    expect(Quantity.of(1, "ton", imp).to("kg", imp).value).toBeCloseTo(1016.0469088, 6);
  });

  it("US volume ladder is exact powers of two", () => {
    const us = createRegistry({ packs: [US_CUSTOMARY_PACK] });
    expect(Quantity.of(1, "gal", us).to("qt", us).value).toBe(4);
    expect(Quantity.of(1, "qt", us).to("pt", us).value).toBe(2);
    expect(Quantity.of(1, "pt", us).to("cup", us).value).toBe(2);
    expect(Quantity.of(1, "cup", us).to("floz", us).value).toBe(8);
    expect(Quantity.of(1, "gal", us).to("floz", us).value).toBe(128);
  });

  it("combining imperial + US packs in one registry throws (conflict policy)", () => {
    expect(() => createRegistry({ packs: [IMPERIAL_PACK, US_CUSTOMARY_PACK] })).toThrow(
      UnitRegistrationError,
    );
  });

  it("system context disambiguates shared symbols deterministically", () => {
    const impTon = defaultUnitSystemRegistry.resolveWithSystem("ton", "imperial");
    const usTon = defaultUnitSystemRegistry.resolveWithSystem("ton", "us-customary");
    expect(impTon.toBaseFactor).toBeCloseTo(1016.0469088, 6);
    expect(usTon.toBaseFactor).toBeCloseTo(907.18474, 6);
    expect(impTon.toBaseFactor).not.toBe(usTon.toBaseFactor);
  });
});

// ---------------------------------------------------------------------------
// CGS pack
// ---------------------------------------------------------------------------

describe("CGS pack", () => {
  it("registers as a built-in system and pack", () => {
    expect(defaultUnitSystemRegistry.hasSystem("cgs")).toBe(true);
    expect(defaultUnitSystemRegistry.hasPack("cgs")).toBe(true);
  });

  it("dyn and erg convert correctly", () => {
    const reg = createRegistry({ packs: [SI_PACK, CGS_PACK] });
    expect(Quantity.of(1, "dyn", reg).to("N", reg).value).toBeCloseTo(1e-5, 12);
    expect(Quantity.of(1, "erg", reg).to("J", reg).value).toBeCloseTo(1e-7, 12);
    expect(Quantity.of(1, "dyne", reg).to("dyn", reg).value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Scientific pack
// ---------------------------------------------------------------------------

describe("Scientific pack", () => {
  it("registers as a built-in pack", () => {
    expect(defaultUnitSystemRegistry.hasPack("scientific")).toBe(true);
  });

  it("bar/atm/mmHg conversions", () => {
    const reg = createRegistry({ packs: [SI_PACK, SCIENTIFIC_PACK] });
    expect(Quantity.of(1, "bar", reg).to("Pa", reg).value).toBeCloseTo(1e5, 6);
    expect(Quantity.of(1, "atm", reg).to("Pa", reg).value).toBeCloseTo(101325, 6);
    expect(Quantity.of(1, "mmHg", reg).to("Pa", reg).value).toBeCloseTo(133.322387415, 9);
    expect(Quantity.of(1, "atm", reg).to("bar", reg).value).toBeCloseTo(1.01325, 9);
  });

  it("cal/BTU/hp/week conversions", () => {
    const reg = createRegistry({ packs: [SI_PACK, SCIENTIFIC_PACK] });
    expect(Quantity.of(1, "cal", reg).to("J", reg).value).toBeCloseTo(4.184, 9);
    expect(Quantity.of(1, "BTU", reg).to("J", reg).value).toBeCloseTo(1055.05585262, 6);
    expect(Quantity.of(1, "hp", reg).to("W", reg).value).toBeCloseTo(745.6998715822702, 6);
    expect(Quantity.of(1, "week", reg).to("day", reg).value).toBe(7);
  });

  it("serializes scientific-pack quantities round-trip", () => {
    const reg = createRegistry({ packs: [SCIENTIFIC_PACK] });
    const q = Quantity.of(2, "atm", reg);
    const restored = deserializeQuantity(serializeQuantity(q), reg);
    expect(restored.value).toBe(2);
    expect(restored.dimension).toEqual(q.dimension);
  });
});

// ---------------------------------------------------------------------------
// Registry mechanics: unregister, version, preferred, snapshot, factory
// ---------------------------------------------------------------------------

describe("UnitSystemRegistry mechanics", () => {
  it("unregisterSystem/unregisterPack remove entries", () => {
    const reg = new UnitSystemRegistry();
    reg.registerSystem({ name: "s", version: "1.0.0", units: [] });
    reg.registerPack({ name: "p", version: "1.0.0", units: [] });
    expect(reg.unregisterSystem("s")?.name).toBe("s");
    expect(reg.unregisterPack("p")?.name).toBe("p");
    expect(reg.hasSystem("s")).toBe(false);
    expect(reg.hasPack("p")).toBe(false);
    expect(reg.unregisterSystem("missing")).toBeUndefined();
    expect(reg.unregisterPack("missing")).toBeUndefined();
  });

  it("version counter bumps on register/unregister", () => {
    const reg = new UnitSystemRegistry();
    const v0 = reg.version;
    reg.registerSystem({ name: "s", version: "1.0.0", units: [] });
    expect(reg.version).toBeGreaterThan(v0);
    reg.unregisterSystem("s");
    expect(reg.version).toBeGreaterThan(v0 + 0);
  });

  it("getPreferredUnit returns metadata, throws for unknown system", () => {
    expect(defaultUnitSystemRegistry.getPreferredUnit("si", "mass")).toBe("kg");
    expect(defaultUnitSystemRegistry.getPreferredUnit("si", "nope")).toBeUndefined();
    expect(() => defaultUnitSystemRegistry.getPreferredUnit("unknown", "mass")).toThrow();
  });

  it("createRegistry builds isolated registries", () => {
    const a = createRegistry({ packs: [SI_PACK] });
    const b = createRegistry({ packs: [SI_PACK] });
    expect(a.resolve("N").symbol).toBe("N");
    expect(b.resolve("N").symbol).toBe("N");
    // Isolation: mutating one does not affect the other
    a.unregister("N");
    expect(a.has("N")).toBe(false);
    expect(b.has("N")).toBe(true);
  });

  it("createRegistry with empty seed is truly minimal", () => {
    const reg = createRegistry({ seed: [], packs: [CGS_PACK] });
    expect(reg.has("dyn")).toBe(true);
    expect(reg.has("kg")).toBe(false);
  });

  it("createRegistry rejects malformed packs", () => {
    expect(() => createRegistry({ packs: [null as never] })).toThrow();
    expect(() =>
      createRegistry({
        packs: [
          {
            name: "bad",
            version: "1.0.0",
            units: [{ symbol: "", dimension: {}, toBaseFactor: 1, label: "x" }],
          } as never,
        ],
      }),
    ).toThrow();
  });
});

describe("UnitRegistry.snapshot", () => {
  it("snapshot is detached from later mutations", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    const snap = reg.snapshot();
    expect(snap.resolve("N").symbol).toBe("N");
    reg.unregister("N");
    expect(reg.has("N")).toBe(false);
    expect(snap.has("N")).toBe(true);
    expect(snap.resolve("N").symbol).toBe("N");
  });

  it("snapshot shares frozen unit objects", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    const snap = reg.snapshot();
    expect(snap.resolve("Pa")).toBe(reg.resolve("Pa"));
  });
});

// ---------------------------------------------------------------------------
// Pack validation & security
// ---------------------------------------------------------------------------

describe("Pack validation", () => {
  it("rejects duplicate unit symbols within a pack", () => {
    const reg = new UnitSystemRegistry();
    expect(() =>
      reg.registerPack({
        name: "dup",
        version: "1.0.0",
        units: [
          { symbol: "x", dimension: Dim.Mass, toBaseFactor: 1, label: "a" },
          { symbol: "x", dimension: Dim.Mass, toBaseFactor: 2, label: "b" },
        ],
      }),
    ).toThrow();
  });

  it("rejects dangling aliases (target outside the pack)", () => {
    const reg = new UnitSystemRegistry();
    expect(() =>
      reg.registerPack({
        name: "dangling",
        version: "1.0.0",
        units: [{ symbol: "x", dimension: Dim.Mass, toBaseFactor: 1, label: "a" }],
        aliases: { ghost: "missing" },
      }),
    ).toThrow();
  });

  it("rejects non-integer dimension exponents", () => {
    const reg = new UnitSystemRegistry();
    expect(() =>
      reg.registerPack({
        name: "badexp",
        version: "1.0.0",
        units: [{ symbol: "x", dimension: { M: 1.5 }, toBaseFactor: 1, label: "a" }],
      }),
    ).toThrow();
  });

  it("rejects function metadata (packs are data, not code)", () => {
    const reg = new UnitSystemRegistry();
    expect(() =>
      reg.registerPack({
        name: "fn",
        version: "1.0.0",
        units: [
          {
            symbol: "x",
            dimension: Dim.Mass,
            toBaseFactor: 1,
            label: "a",
            metadata: { run: (() => 1) as never },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects __proto__ in pack definitions", () => {
    const reg = new UnitSystemRegistry();
    const malicious = JSON.parse(
      '{"name":"evil","version":"1.0.0","units":[{"symbol":"x","dimension":{},"toBaseFactor":1,"label":"x"}],"__proto__":{}}',
    );
    const before = ({} as Record<string, unknown>).__proto__;
    expect(() => reg.registerPack(malicious)).toThrow();
    expect(({} as Record<string, unknown>).__proto__).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Deprecation helper
// ---------------------------------------------------------------------------

describe("Deprecation", () => {
  it("getDeprecationNotice returns notice or undefined, never warns", () => {
    const reg = new UnitRegistry([]);
    reg.register(
      makeUnit({
        symbol: "old",
        dimension: Dim.Mass,
        toBaseFactor: 1,
        metadata: { deprecated: "use kg instead" },
      }),
    );
    expect(getDeprecationNotice(reg.resolve("old"))).toBe("use kg instead");
    expect(getDeprecationNotice(parseUnit("kg"))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Property: cross-system round trips
// ---------------------------------------------------------------------------

describe("Pack property: round trips", () => {
  it("kg → lb → kg preserves value", () => {
    const q = Quantity.of(2.5, "kg");
    expect(q.to("lb").to("kg").value).toBeCloseTo(2.5, 9);
  });

  it("N → lbf → N preserves value", () => {
    const reg = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK] });
    const q = Quantity.of(100, "N", reg);
    expect(q.to("lbf", reg).to("N", reg).value).toBeCloseTo(100, 6);
  });

  it("J → BTU → J preserves value", () => {
    const reg = createRegistry({ packs: [SI_PACK, SCIENTIFIC_PACK] });
    const q = Quantity.of(5000, "J", reg);
    expect(q.to("BTU", reg).to("J", reg).value).toBeCloseTo(5000, 6);
  });

  it("Pa → psi → Pa preserves value", () => {
    const reg = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK] });
    const q = Quantity.of(101325, "Pa", reg);
    expect(q.to("psi", reg).to("Pa", reg).value).toBeCloseTo(101325, 3);
  });
});
