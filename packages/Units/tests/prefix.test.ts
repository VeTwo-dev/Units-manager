/**
 * tests/prefix.test.ts — Phase 5: Prefix Engine tests
 */
import { describe, expect, it } from "vitest";
import { PrefixRegistry, defaultPrefixRegistry, STANDARD_PREFIXES } from "../src/prefix.js";
import { PrefixRegistrationError } from "../src/prefix.js";
import { UnitRegistry, defaultUnitRegistry } from "../src/unit-registry.js";
import { parseUnit } from "../src/unit-parser.js";
import { Quantity } from "../src/quantity.js";
import { Dim } from "../src/dimension.js";
import { makeUnit } from "../src/unit.js";
import { UnsupportedUnitError } from "../src/errors/index.js";

// ---------------------------------------------------------------------------
// Canonical symbols and scales
// ---------------------------------------------------------------------------

describe("Standard prefixes", () => {
  it("contains 24 prefixes", () => {
    expect(STANDARD_PREFIXES).toHaveLength(24);
  });

  it("has correct symbols and factors", () => {
    const bySymbol = new Map(STANDARD_PREFIXES.map((p) => [p.symbol, p]));
    expect(bySymbol.get("Q")?.factor).toBe(1e30);
    expect(bySymbol.get("R")?.factor).toBe(1e27);
    expect(bySymbol.get("Y")?.factor).toBe(1e24);
    expect(bySymbol.get("Z")?.factor).toBe(1e21);
    expect(bySymbol.get("E")?.factor).toBe(1e18);
    expect(bySymbol.get("P")?.factor).toBe(1e15);
    expect(bySymbol.get("T")?.factor).toBe(1e12);
    expect(bySymbol.get("G")?.factor).toBe(1e9);
    expect(bySymbol.get("M")?.factor).toBe(1e6);
    expect(bySymbol.get("k")?.factor).toBe(1e3);
    expect(bySymbol.get("h")?.factor).toBe(1e2);
    expect(bySymbol.get("da")?.factor).toBe(1e1);
    expect(bySymbol.get("d")?.factor).toBe(1e-1);
    expect(bySymbol.get("c")?.factor).toBe(1e-2);
    expect(bySymbol.get("m")?.factor).toBe(1e-3);
    expect(bySymbol.get("µ")?.factor).toBe(1e-6);
    expect(bySymbol.get("n")?.factor).toBe(1e-9);
    expect(bySymbol.get("p")?.factor).toBe(1e-12);
    expect(bySymbol.get("f")?.factor).toBe(1e-15);
    expect(bySymbol.get("a")?.factor).toBe(1e-18);
    expect(bySymbol.get("z")?.factor).toBe(1e-21);
    expect(bySymbol.get("y")?.factor).toBe(1e-24);
    expect(bySymbol.get("r")?.factor).toBe(1e-27);
    expect(bySymbol.get("q")?.factor).toBe(1e-30);
  });

  it("has micro as µ with aliases u and μ", () => {
    const micro = STANDARD_PREFIXES.find((p) => p.symbol === "µ")!;
    expect(micro.name).toBe("micro");
    expect(micro.aliases).toContain("u");
    expect(micro.aliases).toContain("\u03BC");
  });

  it("all prefixes are frozen", () => {
    for (const p of STANDARD_PREFIXES) {
      expect(Object.isFrozen(p)).toBe(true);
      expect(Object.isFrozen(p.aliases)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// PrefixRegistry lookups
// ---------------------------------------------------------------------------

describe("PrefixRegistry", () => {
  it("resolves canonical symbol", () => {
    expect(defaultPrefixRegistry.get("k").name).toBe("kilo");
    expect(defaultPrefixRegistry.get("µ").name).toBe("micro");
  });

  it("resolves alias u for micro", () => {
    expect(defaultPrefixRegistry.get("u").symbol).toBe("µ");
    expect(defaultPrefixRegistry.get("u").factor).toBe(1e-6);
  });

  it("resolves alias μ (Greek mu) for micro", () => {
    expect(defaultPrefixRegistry.get("\u03BC").symbol).toBe("µ");
  });

  it("has() checks canonical and alias", () => {
    expect(defaultPrefixRegistry.has("k")).toBe(true);
    expect(defaultPrefixRegistry.has("u")).toBe(true);
    expect(defaultPrefixRegistry.has("unknown")).toBe(false);
  });

  it("throws on unknown prefix", () => {
    expect(() => defaultPrefixRegistry.get("unknown")).toThrow(PrefixRegistrationError);
  });

  it("lists all prefixes", () => {
    expect(defaultPrefixRegistry.list()).toHaveLength(24);
  });

  it("sorted by length has da first", () => {
    const sorted = defaultPrefixRegistry.listSortedByLength();
    expect(sorted[0]?.symbol).toBe("da");
    expect(sorted[0]?.symbol.length).toBe(2);
  });

  it("is deterministic regardless of insertion order in isolated registry", () => {
    const r = new PrefixRegistry([]);
    r.register({ symbol: "k", name: "kilo", factor: 1e3, aliases: [] });
    r.register({ symbol: "m", name: "milli", factor: 1e-3, aliases: [] });
    expect(r.get("k").factor).toBe(1e3);
  });
});

// ---------------------------------------------------------------------------
// Duplicate / invalid registration
// ---------------------------------------------------------------------------

describe("PrefixRegistry registration safety", () => {
  it("rejects duplicate canonical symbol", () => {
    const r = new PrefixRegistry([]);
    r.register({ symbol: "k", name: "kilo", factor: 1e3, aliases: [] });
    expect(() => r.register({ symbol: "k", name: "kilo2", factor: 1e3, aliases: [] })).toThrow(
      PrefixRegistrationError,
    );
  });

  it("rejects alias that collides with existing symbol", () => {
    const r = new PrefixRegistry([]);
    r.register({ symbol: "k", name: "kilo", factor: 1e3, aliases: [] });
    expect(() => r.register({ symbol: "M", name: "mega", factor: 1e6, aliases: ["k"] })).toThrow(
      PrefixRegistrationError,
    );
  });

  it("rejects alias that collides with existing alias", () => {
    const r = new PrefixRegistry([]);
    r.register({ symbol: "µ", name: "micro", factor: 1e-6, aliases: ["u"] });
    expect(() =>
      r.register({ symbol: "u2", name: "micro2", factor: 1e-6, aliases: ["u"] }),
    ).toThrow(PrefixRegistrationError);
  });

  it("rejects invalid prefixes (empty, zero factor, NaN, Infinity)", () => {
    const r = new PrefixRegistry([]);
    expect(() => r.register({ symbol: "", name: "bad", factor: 1e3, aliases: [] })).toThrow(
      PrefixRegistrationError,
    );
    expect(() => r.register({ symbol: "x", name: "", factor: 1e3, aliases: [] })).toThrow(
      PrefixRegistrationError,
    );
    expect(() => r.register({ symbol: "x", name: "bad", factor: 0, aliases: [] })).toThrow(
      PrefixRegistrationError,
    );
    expect(() => r.register({ symbol: "x", name: "bad", factor: NaN, aliases: [] })).toThrow(
      PrefixRegistrationError,
    );
    expect(() => r.register({ symbol: "x", name: "bad", factor: Infinity, aliases: [] })).toThrow(
      PrefixRegistrationError,
    );
  });

  it("prefixes are immutable after registration", () => {
    const r = new PrefixRegistry([]);
    const p = r.register({ symbol: "k", name: "kilo", factor: 1e3, aliases: [] });
    expect(Object.isFrozen(p)).toBe(true);
    expect(() => {
      (p as unknown as Record<string, unknown>).factor = 999;
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Prefixability
// ---------------------------------------------------------------------------

describe("Unit prefixability", () => {
  it("m (meter) is prefixable", () => {
    expect(defaultUnitRegistry.resolve("m").metadata?.prefixable).toBe(true);
  });

  it("g (gram) is prefixable", () => {
    expect(defaultUnitRegistry.resolve("g").metadata?.prefixable).toBe(true);
  });

  it("s (second) is prefixable", () => {
    expect(defaultUnitRegistry.resolve("s").metadata?.prefixable).toBe(true);
  });

  it("Hz is prefixable", () => {
    expect(defaultUnitRegistry.resolve("Hz").metadata?.prefixable).toBe(true);
  });

  it("W is prefixable", () => {
    expect(defaultUnitRegistry.resolve("W").metadata?.prefixable).toBe(true);
  });

  it("kg is NOT prefixable (kilogram special case)", () => {
    expect(defaultUnitRegistry.resolve("kg").metadata?.prefixable).not.toBe(true);
  });

  it("°C and °F are NOT prefixable", () => {
    expect(defaultUnitRegistry.resolve("°C").metadata?.prefixable).not.toBe(true);
    expect(defaultUnitRegistry.resolve("°F").metadata?.prefixable).not.toBe(true);
    expect(defaultUnitRegistry.resolve("K").metadata?.prefixable).not.toBe(true);
  });

  it("day is NOT prefixable", () => {
    expect(defaultUnitRegistry.resolve("day").metadata?.prefixable).not.toBe(true);
  });

  it("in and ft are NOT prefixable", () => {
    expect(defaultUnitRegistry.resolve("in").metadata?.prefixable).not.toBe(true);
    expect(defaultUnitRegistry.resolve("ft").metadata?.prefixable).not.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Kilogram special case documentation in code behavior
// ---------------------------------------------------------------------------

describe("Kilogram special case", () => {
  it("kg remains the SI base (factor 1) and is not prefixable", () => {
    const kg = defaultUnitRegistry.resolve("kg");
    expect(kg.toBaseFactor).toBe(1);
    expect(kg.metadata?.prefixable).not.toBe(true);
  });

  it("g is scalable unit with factor 0.001", () => {
    const g = defaultUnitRegistry.resolve("g");
    expect(g.toBaseFactor).toBe(0.001);
    expect(g.metadata?.prefixable).toBe(true);
  });

  it("k + g via prefix would be kg logic but atomic kg takes precedence", () => {
    // km etc. already atomic, but for kg-like: k+g factor 1 is same as kg atomic 1
    // Ensure resolve kg returns atomic, not derived
    const kg = parseUnit("kg");
    expect(kg.symbol).toBe("kg");
    expect(kg.toBaseFactor).toBe(1);
  });

  it("mg with atomic precedence is correct (also derivable as m+g)", () => {
    const mg = parseUnit("mg");
    // m (milli,1e-3) * g(0.001)=1e-6 matches atomic mg 1e-6
    expect(mg.toBaseFactor).toBe(1e-6);
    // via Quantity conversion: 1 mg = 0.001 g
    expect(Quantity.of(1, "mg").to("g").value).toBeCloseTo(0.001);
  });
});

// ---------------------------------------------------------------------------
// Prefixed unit resolution (lazy generation)
// ---------------------------------------------------------------------------

describe("Prefixed unit resolution", () => {
  it("resolves km (kilo + meter)", () => {
    const km = parseUnit("km");
    expect(km.symbol).toBe("km");
    // km already atomic, but should have correct dimension and factor
    expect(km.dimension).toEqual(Dim.Length);
    expect(km.toBaseFactor).toBe(1000);
  });

  it("resolves cm (centi + meter)", () => {
    const cm = parseUnit("cm");
    expect(cm.toBaseFactor).toBe(0.01);
  });

  it("resolves mm (milli + meter)", () => {
    const mm = parseUnit("mm");
    expect(mm.toBaseFactor).toBe(0.001);
  });

  it("lazily generates nm (nano + meter) not in atomic seed", () => {
    const nm = parseUnit("nm");
    expect(nm.symbol).toBe("nm");
    expect(nm.dimension).toEqual(Dim.Length);
    expect(nm.toBaseFactor).toBeCloseTo(1e-9);
    // conversion: 1 nm = 1e-9 m
    expect(Quantity.of(1, "nm").to("m").value).toBeCloseTo(1e-9);
  });

  it("lazily generates µm (micro + meter)", () => {
    const um = parseUnit("µm");
    expect(um.toBaseFactor).toBeCloseTo(1e-6);
    expect(Quantity.of(1, "µm").to("m").value).toBeCloseTo(1e-6);
  });

  it("resolves ug alias via u + g", () => {
    const ug = parseUnit("ug"); // u alias for µ + g
    expect(ug.toBaseFactor).toBeCloseTo(1e-9); // 1e-6 * 0.001
    expect(Quantity.of(1, "ug").to("g").value).toBeCloseTo(1e-6);
  });

  it("resolves mg (milli + gram) and µg (micro + gram)", () => {
    // mg already atomic, but prefix path matches too
    expect(Quantity.of(1, "mg").to("g").value).toBeCloseTo(0.001);
    expect(Quantity.of(1, "µg").to("g").value).toBeCloseTo(1e-6);
  });

  it("resolves kW (kilo + watt)", () => {
    const kW = parseUnit("kW");
    expect(kW.symbol).toBe("kW");
    // Prompt-18 correction: 1 W = 1 J/s compositionally in base units (not
    // factor 1), so the absolute kW factor composes from the W base factor;
    // the kW→W ratio stays exactly 1000.
    const wBase = parseUnit("W").toBaseFactor;
    expect(kW.toBaseFactor).toBeCloseTo(1000 * wBase, 12);
    expect(Quantity.of(1, "kW").to("W").value).toBeCloseTo(1000);
  });

  it("resolves MHz (mega + hertz)", () => {
    const MHz = parseUnit("MHz");
    // Phase 21.30 audit: Hz = 86400/day (time base is the day), so the
    // absolute factor is 1e6 × 86400; the MHz→Hz ratio stays exactly 1e6.
    expect(MHz.toBaseFactor).toBeCloseTo(1e6 * 86400, 6);
    expect(Quantity.of(1, "MHz").to("Hz").value).toBeCloseTo(1e6);
  });

  it("resolves nF concept if F is prefixable base (extensibility)", () => {
    // Register a temp F unit for this test (isolated registry)
    const reg = new UnitRegistry([]);
    reg.register(
      makeUnit({
        symbol: "F",
        dimension: Dim.Count,
        toBaseFactor: 1,
        metadata: { prefixable: true },
      }),
    );
    const nF = parseUnit("nF", reg);
    expect(nF.toBaseFactor).toBeCloseTo(1e-9);
  });

  it("resulting units have correct dimension, conversion, canonical identity, symbol", () => {
    const nm = parseUnit("nm");
    expect(nm.dimension).toEqual(Dim.Length);
    expect(nm.conversion.kind).toBe("linear");
    expect(nm.conversion.scale).toBeCloseTo(1e-9);
    expect(nm.id).toBe("nm");
    expect(nm.symbol).toBe("nm");
    expect(nm.name.toLowerCase()).toContain("nano");
  });

  it("does not mutate the original base unit", () => {
    const before = defaultUnitRegistry.resolve("m").toBaseFactor;
    parseUnit("km");
    parseUnit("nm");
    expect(defaultUnitRegistry.resolve("m").toBaseFactor).toBe(before);
  });

  it("generated units are not permanently registered (lazy, cached via parseCache)", () => {
    // nm should be resolvable but not appear in list() as explicitly registered?
    // Actually our cache is prefixedCache, not main units, so list() won't include it
    const reg = new UnitRegistry([]);
    reg.register(
      makeUnit({
        symbol: "m",
        dimension: Dim.Length,
        toBaseFactor: 1,
        metadata: { prefixable: true },
      }),
    );
    parseUnit("nm", reg);
    expect(reg.list().some((u) => u.symbol === "nm")).toBe(false);
    expect(reg.has("nm")).toBe(true); // has checks prefix-derived too
    expect(reg.resolve("nm").symbol).toBe("nm");
  });
});

// ---------------------------------------------------------------------------
// Prefix collisions / precedence
// ---------------------------------------------------------------------------

describe("Prefix collisions and precedence", () => {
  it("exact unit symbol wins over prefix-derived (km atomic vs k+m)", () => {
    // km is both atomic and derivable; exact hit should return atomic
    const km = defaultUnitRegistry.resolve("km");
    expect(km.symbol).toBe("km");
    expect(km.label).toBe("kilometer");
  });

  it("has() considers prefix-derivable units as having a definition", () => {
    // nm is not atomic but prefix-derivable
    expect(defaultUnitRegistry.has("nm")).toBe(true);
    expect(defaultUnitRegistry.has("unknownXYZ")).toBe(false);
  });

  it("case-sensitive: mW vs MW are distinct", () => {
    // mW = milli + W, MW = mega + W (absolute factors compose from W base;
    // see the kW correction above).
    const mW = parseUnit("mW");
    const MW = parseUnit("MW");
    const wBase = parseUnit("W").toBaseFactor;
    expect(mW.toBaseFactor).toBeCloseTo(1e-3 * wBase, 12);
    expect(MW.toBaseFactor).toBeCloseTo(1e6 * wBase, 6);
  });

  it("da (deca) longest-match beats d and a singly", () => {
    // dag = deca + g = 10 * 0.001 = 0.01 kg
    const dag = parseUnit("dag");
    expect(dag.toBaseFactor).toBeCloseTo(0.01);
    // Ensure dag is not parsed as d + ag or da + g confusion
    expect(dag.symbol).toBe("dag");
  });
});

// ---------------------------------------------------------------------------
// Single-prefix restriction
// ---------------------------------------------------------------------------

describe("Single-prefix restriction", () => {
  it("rejects kmm (multiple prefixes, second base not prefixable)", () => {
    // k + mm where mm is atomic but NOT prefixable, so should fail
    expect(() => parseUnit("kmm")).toThrow(UnsupportedUnitError);
  });

  it("rejects µkg (prefix + non-prefixable kg)", () => {
    expect(() => parseUnit("µkg")).toThrow(UnsupportedUnitError);
  });

  it("rejects kkg (kilo + kilogram, kg not prefixable)", () => {
    expect(() => parseUnit("kkg")).toThrow(UnsupportedUnitError);
  });

  it("rejects µ°C (prefix + affine temperature)", () => {
    expect(() => parseUnit("µ°C")).toThrow(UnsupportedUnitError);
  });

  it("rejects mmk (multiple prefixes trailing)", () => {
    expect(() => parseUnit("mmk")).toThrow(UnsupportedUnitError);
  });

  it("provides clear error for ambiguous multiple prefixes", () => {
    try {
      parseUnit("kmm");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedUnitError);
      expect((e as Error).message).toContain("kmm");
    }
  });
});

// ---------------------------------------------------------------------------
// Prefix numerical safety (extreme prefixes)
// ---------------------------------------------------------------------------

describe("Prefix numerical safety", () => {
  it("quetta (1e30) converts correctly and doesn't overflow to Infinity for small values", () => {
    const Qm = parseUnit("Qm"); // quetta + meter = 1e30
    expect(Qm.toBaseFactor).toBe(1e30);
    // 1 Qm in m is 1e30
    expect(Quantity.of(1, "Qm").to("m").value).toBe(1e30);
    // 1 m in Qm is 1e-30
    expect(Quantity.of(1, "m").to("Qm").value).toBeCloseTo(1e-30);
  });

  it("quecto (1e-30) converts correctly", () => {
    const qm = parseUnit("qm"); // quecto + meter = 1e-30
    expect(qm.toBaseFactor).toBeCloseTo(1e-30);
    expect(Quantity.of(1, "qm").to("m").value).toBeCloseTo(1e-30);
    // 1 / 1e-30 = 1e30 but IEEE rounding gives ~9.999e29; check relative
    const roundTrip = Quantity.of(1, "m").to("qm").value;
    expect(Math.abs(roundTrip - 1e30) / 1e30).toBeLessThan(1e-10);
  });

  it("prefix scale integrates with conversion model without unsafe overflow for normal use", () => {
    // 1e30 * small value should stay finite
    const v = Quantity.of(1e-6, "Qm").to("m").value;
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBe(1e24);
  });

  it("very small prefixed unit round-trips", () => {
    const q = Quantity.of(5, "qm");
    expect(q.to("Qm").to("qm").value).toBeCloseTo(5, 6);
  });
});

// ---------------------------------------------------------------------------
// Generated vs registered distinction
// ---------------------------------------------------------------------------

describe("Generated vs registered units", () => {
  it("does not register millions of combinations permanently", () => {
    const reg = new UnitRegistry([]);
    reg.register(
      makeUnit({
        symbol: "m",
        dimension: Dim.Length,
        toBaseFactor: 1,
        metadata: { prefixable: true },
      }),
    );
    const beforeCount = reg.list().length;
    // Derive a few prefixed units
    parseUnit("nm", reg);
    parseUnit("µm", reg);
    parseUnit("pm", reg);
    // list() should not have grown with prefixedCache entries
    expect(reg.list().length).toBe(beforeCount);
  });

  it("caching does not change semantics (same symbol same result)", () => {
    const a = parseUnit("nm");
    const b = parseUnit("nm");
    expect(a.toBaseFactor).toBe(b.toBaseFactor);
    expect(a.dimension).toEqual(b.dimension);
  });

  it("cache is deterministic (same result regardless of call order)", () => {
    const reg1 = new UnitRegistry([]);
    reg1.register(
      makeUnit({
        symbol: "m",
        dimension: Dim.Length,
        toBaseFactor: 1,
        metadata: { prefixable: true },
      }),
    );
    const reg2 = new UnitRegistry([]);
    reg2.register(
      makeUnit({
        symbol: "m",
        dimension: Dim.Length,
        toBaseFactor: 1,
        metadata: { prefixable: true },
      }),
    );
    expect(parseUnit("nm", reg1).toBaseFactor).toBe(parseUnit("nm", reg2).toBaseFactor);
  });
});

// ---------------------------------------------------------------------------
// Prefix composition integration with derived units (e.g. kW/day)
// ---------------------------------------------------------------------------

describe("Prefix composition with derived units", () => {
  it("kW/day composite after prefix resolution", () => {
    const q = Quantity.of(1, "kW/day");
    // 1 kW = 1000 W, so 1 kW/day = 1000 W per day -> dimension E·T^-1 / T = E·T^-2
    expect(q.unit.symbol).toBe("kW/day");
    // Convert to W/day
    expect(Quantity.of(1, "kW/day").to("W/day").value).toBeCloseTo(1000);
  });

  it("MHz as standalone and in composite like MHz/day is not valid but nm/m is", () => {
    // nm/m should be dimensionless
    const ratio = Quantity.of(500, "nm/m");
    expect(ratio.value).toBe(500);
    expect(ratio.unit.dimension).toEqual(Dim.Dimensionless);
  });
});

// ---------------------------------------------------------------------------
// Security: prefix system doesn't use eval or prototype tricks
// ---------------------------------------------------------------------------

describe("Prefix security", () => {
  it("prefix registry doesn't use eval", () => {
    // Attempt to register a prefix with malicious name shouldn't execute
    const reg = new PrefixRegistry([]);
    reg.register({ symbol: "bad", name: "bad'; eval('evil')", factor: 1e3, aliases: [] });
    expect(reg.get("bad").name).toBe("bad'; eval('evil')");
  });

  it("prefix resolution doesn't mutate registry", () => {
    const reg = new UnitRegistry([]);
    reg.register(
      makeUnit({
        symbol: "m",
        dimension: Dim.Length,
        toBaseFactor: 1,
        metadata: { prefixable: true },
      }),
    );
    const before = reg.list().length;
    parseUnit("nm", reg);
    expect(reg.list().length).toBe(before);
  });

  it("prefix doesn't allow __proto__ pollution", () => {
    expect(() => parseUnit("__proto__")).toThrow(UnsupportedUnitError);
    expect(({} as Record<string, unknown>).__proto__).toBe(Object.prototype);
  });
});
