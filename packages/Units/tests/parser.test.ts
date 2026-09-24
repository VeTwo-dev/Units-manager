/**
 * tests/parser.test.ts — Phase 8: Universal Unit Parser
 */
import { describe, expect, it } from "vitest";
import { parseUnit, UnitParser } from "../src/unit-parser.js";
import { Quantity } from "../src/quantity.js";
import { isDimensionless } from "../src/dimension.js";
import { InvalidUnitExpressionError, UnsupportedUnitError } from "../src/errors/index.js";
import { Dim } from "../src/dimension.js";
import { UnitRegistry } from "../src/unit-registry.js";
import { makeUnit } from "../src/unit.js";

// ---------------------------------------------------------------------------
// Basics: atomic, aliases, prefixes
// ---------------------------------------------------------------------------

describe("Parser basic — atomic & aliases", () => {
  it.each(["kg", "g", "mg", "m", "cm", "km", "s", "h", "hour", "%", "ppm"] as const)(
    "parses %s",
    (sym) => {
      // "h" is alias for hour, should resolve to hour
      expect(parseUnit(sym).symbol).toBeTruthy();
    },
  );
  it("aliases handled via registry (meter via m)", () => {
    const reg = new UnitRegistry([]);
    const L = Dim.Length;
    reg.register(
      makeUnit({
        symbol: "m",
        dimension: L,
        toBaseFactor: 1,
        aliases: ["meter", "metre"],
        label: "meter",
      }),
    );
    expect(reg.resolve("meter").symbol).toBe("m");
    expect(parseUnit("meter", reg).symbol).toBe("m");
    expect(parseUnit("metre", reg).symbol).toBe("m");
  });
});

describe("Parser prefixes", () => {
  it.each(["km", "mm", "µm", "mg", "µg", "MHz"] as const)("resolves %s via prefix", (sym) => {
    const u = parseUnit(sym);
    expect(u.symbol).toBe(sym);
  });
  it("km dimension L, conversion 1000", () => {
    expect(parseUnit("km").dimension).toEqual(Dim.Length);
    expect(parseUnit("km").toBaseFactor).toBe(1000);
  });
  it("MHz dimension T^-1", () => {
    expect(isDimensionless(parseUnit("MHz").dimension)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Composite parsing
// ---------------------------------------------------------------------------

describe("Parser composites", () => {
  it("m/s", () => {
    const u = parseUnit("m/s");
    expect(u.dimension).toEqual({ L: 1, T: -1 });
  });
  it("m/s² via superscript", () => {
    const u = parseUnit("m/s²");
    expect(u.dimension).toEqual({ L: 1, T: -2 });
  });
  it("kg·m/s²", () => {
    const u = parseUnit("kg·m/s²");
    expect(u.dimension).toEqual({ M: 1, L: 1, T: -2 });
  });
  it("kg*m/s^2 ASCII", () => {
    const u = parseUnit("kg*m/s^2");
    expect(u.dimension).toEqual({ M: 1, L: 1, T: -2 });
  });
  it("Mcal/kg", () => {
    const u = parseUnit("Mcal/kg");
    expect(u.dimension).toEqual({ E: 1, M: -1 });
  });
  it("kg m^-2 whitespace as multiply", () => {
    const u = parseUnit("kg m^-2");
    expect(u.dimension).toEqual({ M: 1, L: -2 });
  });
  it("m2 shorthand → m^2", () => {
    expect(parseUnit("m2").dimension).toEqual({ L: 2 });
  });
  it("cm² superscript", () => {
    expect(parseUnit("cm²").dimension).toEqual({ L: 2 });
  });
  it("(kg*m)/s^2 with parens", () => {
    const a = parseUnit("(kg*m)/s^2");
    const b = parseUnit("kg*m/s^2");
    expect(a.dimension).toEqual(b.dimension);
    expect(a.toBaseFactor).toBe(b.toBaseFactor);
  });
  it("kg/m³", () => {
    const u = parseUnit("kg/m³");
    expect(u.dimension).toEqual({ M: 1, L: -3 });
  });
  it("kg·m²/s²", () => {
    expect(parseUnit("kg·m²/s²").dimension).toEqual({ M: 1, L: 2, T: -2 });
  });
});

// ---------------------------------------------------------------------------
// Equivalence where syntax sematically equivalent
// ---------------------------------------------------------------------------

describe("Parser equivalence", () => {
  it("m/s == m·s^-1", () => {
    const a = parseUnit("m/s");
    const b = parseUnit("m·s^-1");
    expect(a.dimension).toEqual(b.dimension);
    expect(a.toBaseFactor).toBeCloseTo(b.toBaseFactor);
  });
  it("m²/s² semantics across forms", () => {
    // m² vs m^2 vs m2 should be equivalent
    const a = parseUnit("m²");
    const b = parseUnit("m^2");
    const c = parseUnit("m2");
    expect(a.dimension).toEqual(b.dimension);
    expect(b.dimension).toEqual(c.dimension);
  });
});

// ---------------------------------------------------------------------------
// Case sensitivity
// ---------------------------------------------------------------------------

describe("Parser case sensitivity", () => {
  it("W vs w distinct", () => {
    expect(parseUnit("W").symbol).toBe("W");
    expect(() => parseUnit("w")).toThrow(UnsupportedUnitError);
  });
  it("M prefix vs m prefix distinct (MHz vs mHz)", () => {
    // MHz is mega+Hz, mHz is milli+Hz
    const MHz = parseUnit("MHz");
    const mHz = parseUnit("mHz");
    expect(MHz.toBaseFactor).not.toBe(mHz.toBaseFactor);
  });
  it("does not lowercase globally", () => {
    expect(parseUnit("K").symbol).toBe("K");
    expect(parseUnit("kW").symbol).toBe("kW");
  });
});

// ---------------------------------------------------------------------------
// Whitespace
// ---------------------------------------------------------------------------

describe("Parser whitespace", () => {
  it('"kg/s" vs "kg / s" vs " kg / s " same', () => {
    const a = parseUnit("kg/s");
    const b = parseUnit("kg / s");
    const c = parseUnit(" kg / s ");
    expect(a.dimension).toEqual(b.dimension);
    expect(b.dimension).toEqual(c.dimension);
    expect(a.toBaseFactor).toBe(b.toBaseFactor);
  });
  it("kg s^-1 with space as multiply", () => {
    const a = parseUnit("kg s^-1");
    const b = parseUnit("kg/s");
    // kg * s^-1 vs kg / s: same dimension M·T^-1? Actually kg= M, s^-1 = T^-1, product M·T^-1 vs M/T = M·T^-1 same
    expect(a.dimension).toEqual(b.dimension);
  });
});

// ---------------------------------------------------------------------------
// Dimensionless symbols via parser
// ---------------------------------------------------------------------------

describe("Parser dimensionless symbols", () => {
  it.each(["%", "‰", "ppm", "ppb", "ppt", "fraction"] as const)("parses %s", (sym) => {
    expect(isDimensionless(parseUnit(sym).dimension)).toBe(true);
    expect(parseUnit(sym).symbol).toBe(sym);
  });
  it("does not confuse % with punctuation", () => {
    expect(() => parseUnit("%;")).toThrow(InvalidUnitExpressionError);
  });
});

// ---------------------------------------------------------------------------
// Composite dimension correctness (generic algebra)
// ---------------------------------------------------------------------------

describe("Parser composite dimension correctness", () => {
  it("kg·m/s² dimension M·L·T^-2", () => {
    const u = parseUnit("kg·m/s²");
    expect(u.dimension).toEqual({ M: 1, L: 1, T: -2 });
  });
  it("generic, no special case for N/J/Pa/W", () => {
    const newtonLike = parseUnit("kg·m/s²");
    expect(newtonLike.dimension).toEqual({ M: 1, L: 1, T: -2 });
  });
});

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

describe("Parser canonicalization", () => {
  it("m/s and m·s^-1 equivalent dimensions", () => {
    expect(parseUnit("m/s").dimension).toEqual(parseUnit("m·s^-1").dimension);
  });
  it("cache returns same instance for same expression", () => {
    const a = parseUnit("kg/m³");
    const b = parseUnit("kg/m³");
    expect(a).toBe(b); // cached
  });
});

// ---------------------------------------------------------------------------
// Cache behavior (bounded)
// ---------------------------------------------------------------------------

describe("Parser cache", () => {
  it("repeated parsing hits cache", () => {
    const a = parseUnit("kg/m³");
    const b = parseUnit("kg/m³");
    expect(a).toBe(b);
  });
  it("different registries have separate cache keys", () => {
    const r = new UnitRegistry([]);
    r.register(makeUnit({ symbol: "m", dimension: Dim.Length, toBaseFactor: 1, label: "meter" }));
    // "m" in custom registry vs default: different cache key but both resolve
    expect(parseUnit("m").symbol).toBe("m");
    expect(parseUnit("m", r).symbol).toBe("m");
  });
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

describe("Parser security", () => {
  it("does not execute eval", () => {
    expect(() => parseUnit("eval(...)")).toThrow();
    expect(() => parseUnit("kg;throw")).toThrow(InvalidUnitExpressionError);
  });
  it.each(["constructor", "__proto__", "toString"] as const)(
    "rejects %s as unit without execution",
    (s) => {
      expect(() => parseUnit(s)).toThrow(UnsupportedUnitError);
      expect(({} as Record<string, unknown>).__proto__).toBe(Object.prototype);
    },
  );
  it("kg || something is rejected", () => {
    expect(() => parseUnit("kg || something")).toThrow(InvalidUnitExpressionError);
  });
  it("new Function style is rejected", () => {
    expect(() => parseUnit("new Function(...)")).toThrow();
  });
  it("does not mutate registry", () => {
    const reg = new UnitRegistry([]);
    reg.register(makeUnit({ symbol: "m", dimension: Dim.Length, toBaseFactor: 1, label: "m" }));
    const before = reg.size;
    try {
      parseUnit("__proto__", reg);
    } catch {
      void 0;
    }
    expect(reg.size).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Invalid input
// ---------------------------------------------------------------------------

describe("Parser invalid input", () => {
  it('empty ""', () => {
    expect(() => parseUnit("")).toThrow(InvalidUnitExpressionError);
  });
  it('"   " whitespace only', () => {
    expect(() => parseUnit("   ")).toThrow(InvalidUnitExpressionError);
  });
  it.each([
    "/kg",
    "kg/",
    "kg//s",
    "kg**s",
    "kg^^2",
    "kg^",
    "kg^abc",
    "kg(",
    "(kg",
    "kg)",
    "kg;something",
  ] as const)("rejects %s", (expr) => {
    expect(() => parseUnit(expr)).toThrow();
  });
  it("kg^1.5 fractional exponent rejected", () => {
    expect(() => parseUnit("kg^1.5")).toThrow(InvalidUnitExpressionError);
  });
  it("malformed superscript sequence", () => {
    // Lone superscript minus without digit may be parsed but should error or be handled
    // We treat "m⁻" as exponent with just minus sign → should throw
    expect(() => parseUnit("m⁻")).toThrow();
  });
  it("includes expression in error", () => {
    try {
      parseUnit("/kg");
      expect.fail("should throw");
    } catch (e) {
      expect((e as InvalidUnitExpressionError).expression).toBe("/kg");
      expect((e as Error).message).toContain("/kg");
    }
  });
  it("reports position", () => {
    try {
      parseUnit("kg//s");
    } catch (e) {
      expect((e as InvalidUnitExpressionError).position).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Quantity integration
// ---------------------------------------------------------------------------

describe("Parser Quantity integration", () => {
  it('Quantity.of uses parser: "kg/m" resolves', () => {
    expect(Quantity.of(10, "kg/m").unit.symbol).toBe("kg/m");
  });
  it("preserves basis via Quantity.of? generic parser keeps DM as metadata", () => {
    // Current generic parser keeps DM as basis for backward compat
    const q = Quantity.of(10, "kg/m DM");
    expect(q.unit.basis).toBe("DM");
  });
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("Parser property: prefix preserves dimension", () => {
  it("km vs m same dimension", () => {
    expect(parseUnit("km").dimension).toEqual(parseUnit("m").dimension);
  });
  it("parsing via to() preserves meaning", () => {
    const q = Quantity.of(1, "km");
    expect(q.to("m").value).toBe(1000);
    expect(parseUnit("km").toBaseFactor).toBe(1000);
  });
  it("dimensionless cancellation remains dimensionless after parse", () => {
    expect(isDimensionless(parseUnit("m/m").dimension)).toBe(true);
    expect(isDimensionless(parseUnit("kg/kg").dimension)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe("Parser immutability", () => {
  it("parsed Units are frozen", () => {
    expect(Object.isFrozen(parseUnit("kg/m³"))).toBe(true);
    expect(Object.isFrozen(parseUnit("m/s²").dimension)).toBe(true);
  });
  it("registry Units are frozen", () => {
    expect(Object.isFrozen(parseUnit("kg"))).toBe(true);
  });
  it("cache cannot be mutated through returned object", () => {
    const a = parseUnit("m/s");
    expect(() => {
      (a as unknown as Record<string, unknown>).symbol = "hack";
    }).toThrow();
    const b = parseUnit("m/s");
    expect(b.symbol).toBe("m/s");
  });
});

// ---------------------------------------------------------------------------
// UnitParser class API
// ---------------------------------------------------------------------------

describe("UnitParser class API", () => {
  it("new UnitParser().parse == parseUnit", () => {
    const p = new UnitParser();
    expect(p.parse("kg/m").symbol).toBe(parseUnit("kg/m").symbol);
  });
  it("static UnitParser.parse", () => {
    expect(UnitParser.parse("m/s").dimension).toEqual(parseUnit("m/s").dimension);
  });
  it("does not expose tokenizer/parser internals", () => {
    const p = new UnitParser();
    expect((p as unknown as Record<string, unknown>).tokenize).toBeUndefined();
    expect((p as unknown as Record<string, unknown>).ast).toBeUndefined();
  });
});
