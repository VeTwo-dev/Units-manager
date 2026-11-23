/**
 * tests/parser-advanced.test.ts — Phase 18: Advanced Parsing,
 * Canonicalization & Unit Intelligence. Strict/lenient modes, canonical
 * keys, suggestions/diagnostics, Unicode normalization, DoS limits,
 * fast-path equivalence, case sensitivity, round trips.
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Dim,
  UnitRegistry,
  makeUnit,
  parseUnit,
  UnitParser,
  suggestUnit,
  parseWithDiagnostics,
  canonicalUnitKey,
  createRegistry,
  SI_PACK,
  IMPERIAL_PACK,
  serializeQuantity,
  deserializeQuantity,
  formatUnit,
  InvalidUnitExpressionError,
  UnsupportedUnitError,
} from "../src/index.js";
import { MAX_UNIT_EXPRESSION_LENGTH, MAX_NESTING_DEPTH } from "../src/unit-parser.js";
import { serializeUnit, deserializeUnit } from "../src/serializer.js";
import { dimensionsEqual } from "../src/dimension.js";

// ---------------------------------------------------------------------------
// Strict vs lenient
// ---------------------------------------------------------------------------

describe("Parser strict mode", () => {
  it.each(["kg", "kg/s", "m^2", "m²", "kg·m/s²", "(kg*m)/s^2", "Mcal/kg", "%"] as const)(
    "strict accepts %s",
    (expr) => {
      expect(parseUnit(expr, undefined, { strict: true }).symbol).toBeTruthy();
    },
  );

  it.each(["kg m", "m2", "(kg)(m)", "kg m^-2"] as const)("strict rejects %s", (expr) => {
    expect(() => parseUnit(expr, undefined, { strict: true })).toThrow(InvalidUnitExpressionError);
  });

  it("lenient (default) still accepts conveniences", () => {
    expect(parseUnit("kg m").dimension).toEqual({ M: 1, L: 1 });
    expect(parseUnit("m2").dimension).toEqual({ L: 2 });
  });

  it("UnitParser honors constructor defaults and per-call override", () => {
    const strictParser = new UnitParser(undefined, { strict: true });
    expect(() => strictParser.parse("kg m")).toThrow(InvalidUnitExpressionError);
    expect(strictParser.parse("kg m", { strict: false }).dimension).toEqual({ M: 1, L: 1 });
    expect(() => UnitParser.parse("m2", undefined, { strict: true })).toThrow(
      InvalidUnitExpressionError,
    );
  });
});

// ---------------------------------------------------------------------------
// Canonical keys
// ---------------------------------------------------------------------------

describe("Canonical unit keys", () => {
  it("same expression parses to identical keys (deterministic)", () => {
    expect(canonicalUnitKey(parseUnit("kg/m³"))).toBe(canonicalUnitKey(parseUnit("kg/m³")));
  });

  it("N and kg·m/s² share dimension, scale and canonical key", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    const n = parseUnit("N", reg);
    const composed = parseUnit("kg·m/s²", reg);
    expect(dimensionsEqual(n.dimension, composed.dimension)).toBe(true);
    expect(n.toBaseFactor).toBeCloseTo(composed.toBaseFactor, 6);
    expect(canonicalUnitKey(n)).toBe(canonicalUnitKey(composed));
  });

  it("m/s and m·s^-1 share canonical key", () => {
    expect(canonicalUnitKey(parseUnit("m/s"))).toBe(canonicalUnitKey(parseUnit("m·s^-1")));
  });

  it("kg and g have different keys", () => {
    expect(canonicalUnitKey(parseUnit("kg"))).not.toBe(canonicalUnitKey(parseUnit("g")));
  });

  it("basis participates in the key", () => {
    expect(canonicalUnitKey(parseUnit("% DM"))).not.toBe(canonicalUnitKey(parseUnit("%")));
  });
});

// ---------------------------------------------------------------------------
// Suggestions & diagnostics
// ---------------------------------------------------------------------------

describe("Unit suggestions", () => {
  it("suggests alias-adjacent symbols for typos", () => {
    const reg = new UnitRegistry([]);
    reg.register(
      makeUnit({
        symbol: "kg",
        dimension: Dim.Mass,
        toBaseFactor: 1,
        aliases: ["kilogram"],
      }),
    );
    const s = suggestUnit("kilogrma", reg);
    expect(s).toContain("kilogram");
    expect(s.length).toBeLessThanOrEqual(3);
  });

  it("suggests for near-miss unit symbols", () => {
    // "kgs" is one edit away from "kg"
    expect(suggestUnit("kgs")).toContain("kg");
  });

  it("is deterministic across calls", () => {
    expect(suggestUnit("metre")).toEqual(suggestUnit("metre"));
  });

  it("returns [] for long inputs and invalid options", () => {
    expect(suggestUnit("x".repeat(100))).toEqual([]);
    expect(suggestUnit("kg", undefined, { maxSuggestions: 0 })).toEqual([]);
    expect(suggestUnit(123 as never)).toEqual([]);
  });

  it("respects custom registries", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    expect(suggestUnit("newtun", reg)).toContain("newton");
  });
});

describe("Parse diagnostics", () => {
  it("ok:true returns the unit with no suggestions", () => {
    const d = parseWithDiagnostics("kg/m³");
    expect(d.ok).toBe(true);
    expect(d.unit?.symbol).toBe("kg/m^3"); // parser composes powers with "^"
    expect(d.suggestions).toEqual([]);
    expect(d.error).toBeUndefined();
  });

  it("ok:false carries typed error plus suggestions", () => {
    const d = parseWithDiagnostics("kgs");
    expect(d.ok).toBe(false);
    expect(d.unit).toBeUndefined();
    expect(d.error).toBeInstanceOf(UnsupportedUnitError);
    expect(d.suggestions).toContain("kg");
  });

  it("never alters parse behavior (advisory only)", () => {
    const viaDiag = parseWithDiagnostics("kg");
    expect(viaDiag.ok).toBe(true);
    expect(viaDiag.unit).toBe(parseUnit("kg")); // same cached instance
  });

  it("respects strict option", () => {
    expect(parseWithDiagnostics("m2", undefined, { strict: true }).ok).toBe(false);
    expect(parseWithDiagnostics("m2").ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unicode normalization
// ---------------------------------------------------------------------------

describe("Unicode normalization", () => {
  it("micro-sign µ (U+00B5) and Greek μ (U+03BC) both resolve", () => {
    const a = parseUnit("µg");
    const b = parseUnit("μg");
    expect(a.symbol).toBe("µg");
    // Input spelling is preserved for display (semantic identity is what matters):
    expect(b.symbol).toBe("μg");
    expect(dimensionsEqual(a.dimension, b.dimension)).toBe(true);
    expect(a.toBaseFactor).toBe(b.toBaseFactor);
    expect(canonicalUnitKey(a)).toBe(canonicalUnitKey(b));
  });

  it("NFC composed vs decomposed inputs agree", () => {
    const composed = "Å"; // single codepoint U+00C5 (unsupported unit either way)
    const decomposed = "Å"; // A + combining ring
    // Both normalize identically; both fail the same way (deterministic)
    expect(() => parseUnit(composed)).toThrow();
    expect(() => parseUnit(decomposed)).toThrow();
    try {
      parseUnit(composed);
    } catch (e) {
      expect((e as Error).constructor).toBe(
        (() => {
          try {
            parseUnit(decomposed);
          } catch (e2) {
            return (e2 as object).constructor;
          }
          return null;
        })(),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Case sensitivity
// ---------------------------------------------------------------------------

describe("Case sensitivity with packs", () => {
  it("Pa resolves, pa does not", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    expect(parseUnit("Pa", reg).symbol).toBe("Pa");
    expect(() => parseUnit("pa", reg)).toThrow(UnsupportedUnitError);
  });

  it("W resolves, w does not (core)", () => {
    expect(parseUnit("W").symbol).toBe("W");
    expect(() => parseUnit("w")).toThrow(UnsupportedUnitError);
  });

  it("mW and MW are distinct", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    // Prompt-18 correction: absolute W factors compose from 1 W = 1 J/s
    // in base units (see prefix.test.ts kW note); prefix ratios are exact.
    const wBase = parseUnit("W", reg).toBaseFactor;
    expect(parseUnit("mW", reg).toBaseFactor).toBeCloseTo(0.001 * wBase, 12);
    expect(parseUnit("MW", reg).toBaseFactor).toBeCloseTo(1e6 * wBase, 6);
  });
});

// ---------------------------------------------------------------------------
// Prefix handling incl. longest-match
// ---------------------------------------------------------------------------

describe("Prefix handling", () => {
  it("deca longest-match: dam is decameter, not deci-…", () => {
    expect(parseUnit("dam").toBaseFactor).toBeCloseTo(10, 12);
  });

  it("kPa and MHz resolve via prefix+unit", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    expect(parseUnit("kPa", reg).toBaseFactor).toBeCloseTo(1000 * 7464960000, 0);
    // Phase 21.30 audit: Hz = 86400/day, so MHz = 1e6 × 86400 in base units.
    expect(parseUnit("MHz", reg).toBaseFactor).toBeCloseTo(1e6 * 86400, 0);
  });

  it("single-prefix rule still rejects kmm", () => {
    expect(() => parseUnit("kmm")).toThrow(UnsupportedUnitError);
  });
});

// ---------------------------------------------------------------------------
// Compound units, exponents, grouping, precedence
// ---------------------------------------------------------------------------

describe("Compound units", () => {
  it("J/(kg·K) parses with E·M⁻¹·Temp⁻¹", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    const u = parseUnit("J/(kg·K)", reg);
    expect(u.dimension).toEqual({ E: 1, M: -1, Temp: -1 });
  });

  it("N·m parses with M·L²·T⁻²", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    expect(parseUnit("N·m", reg).dimension).toEqual({ M: 1, L: 2, T: -2 });
  });

  it("(m/s)^2 applies exponent to the group", () => {
    expect(parseUnit("(m/s)^2").dimension).toEqual({ L: 2, T: -2 });
  });

  it("left-assoc division: a/b/c = a/(b*c)", () => {
    const chained = parseUnit("kg/s/m");
    const grouped = parseUnit("kg/(s*m)");
    expect(chained.dimension).toEqual(grouped.dimension);
    expect(chained.toBaseFactor).toBeCloseTo(grouped.toBaseFactor, 12);
  });

  it("fractional powers rejected with reason", () => {
    expect(() => parseUnit("m^0.5")).toThrow(InvalidUnitExpressionError);
    expect(() => parseUnit("sqrt(m)")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Whitespace
// ---------------------------------------------------------------------------

describe("Whitespace handling", () => {
  it.each(["kg/s", "kg / s", " kg / s ", "kg/s "] as const)("parses %s identically", (expr) => {
    const u = parseUnit(expr);
    expect(u.dimension).toEqual({ M: 1, T: -1 });
  });

  it("whitespace adjacency implies multiplication (lenient)", () => {
    expect(parseUnit("kg m").dimension).toEqual({ M: 1, L: 1 });
  });
});

// ---------------------------------------------------------------------------
// Fast path equivalence
// ---------------------------------------------------------------------------

describe("Parser fast path", () => {
  it("simple identifiers return the registry instance", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    expect(parseUnit("N", reg)).toBe(reg.resolve("N"));
    expect(parseUnit("kg")).toBe(parseUnit("kg")); // cached identity
  });
});

// ---------------------------------------------------------------------------
// DoS protection
// ---------------------------------------------------------------------------

describe("Parser DoS protection", () => {
  it("rejects over-long input", () => {
    expect(() => parseUnit("kg" + "*kg".repeat(3000))).toThrow(InvalidUnitExpressionError);
    expect(MAX_UNIT_EXPRESSION_LENGTH).toBe(4096);
  });

  it("rejects deep nesting", () => {
    const deep = "(".repeat(200) + "kg" + ")".repeat(200);
    expect(() => parseUnit(deep)).toThrow(InvalidUnitExpressionError);
    expect(MAX_NESTING_DEPTH).toBeLessThanOrEqual(100);
  });

  it("huge exponents resolve deterministically without hanging", () => {
    const u = parseUnit("m^1000000");
    expect(u.dimension).toEqual({ L: 1000000 });
  });

  it("error messages truncate huge inputs but keep full expression", () => {
    const evil = "kg*".repeat(500) + "!";
    try {
      parseUnit(evil);
      expect.fail("should throw");
    } catch (e) {
      const err = e as InstanceType<typeof InvalidUnitExpressionError>;
      expect(err.expression).toBe(evil.trim());
      expect(err.message.length).toBeLessThan(evil.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Property: parse/format/serialize round trips
// ---------------------------------------------------------------------------

describe("Parser round trips", () => {
  it.each(["kg", "m/s", "kg·m/s²", "mg/kg", "m²", "cm²", "kg/m³", "%", "ppm"] as const)(
    "parse(format(parse(%s))) preserves semantics",
    (expr) => {
      const once = parseUnit(expr);
      const formatted = formatUnit(once);
      const twice = parseUnit(formatted);
      expect(dimensionsEqual(twice.dimension, once.dimension)).toBe(true);
      expect(twice.toBaseFactor).toBeCloseTo(once.toBaseFactor, 9);
    },
  );

  it("text → parse → serialize → deserialize preserves identity", () => {
    const reg = createRegistry({ packs: [SI_PACK] });
    for (const expr of ["N", "Pa", "kg·m/s²"] as const) {
      const u = parseUnit(expr, reg);
      expect(deserializeUnit(serializeUnit(u), reg).symbol).toBe(u.symbol);
    }
  });

  it("Quantity serialize round-trip with pack units", () => {
    const reg = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK] });
    const q = Quantity.of(60, "mph", reg);
    const restored = deserializeQuantity(serializeQuantity(q), reg);
    expect(restored.value).toBe(60);
    expect(restored.unit.symbol).toBe("mph");
    expect(restored.to("m/s", reg).value).toBeCloseTo(60 * 0.44704, 6);
  });
});

// ---------------------------------------------------------------------------
// Basis tags preserved
// ---------------------------------------------------------------------------

describe("Basis tags", () => {
  it("mg/kg DM keeps basis metadata, dimension unaffected", () => {
    const u = parseUnit("mg/kg DM");
    expect(u.basis).toBe("DM");
    expect(dimensionsEqual(u.dimension, {})).toBe(true);
  });

  it("strict mode still accepts basis suffix", () => {
    const u = parseUnit("mg/kg DM", undefined, { strict: true });
    expect(u.basis).toBe("DM");
  });
});

// ---------------------------------------------------------------------------
// Security: no code execution
// ---------------------------------------------------------------------------

describe("Parser security", () => {
  it.each(["eval(kg)", "constructor", "__proto__", "kg.constructor"] as const)(
    "rejects %s without execution",
    (expr) => {
      expect(() => parseUnit(expr)).toThrow();
      expect(({} as Record<string, unknown>).__proto__).toBe(Object.prototype);
    },
  );
});
