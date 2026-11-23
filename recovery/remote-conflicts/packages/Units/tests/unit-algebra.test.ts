/**
 * tests/unit-algebra.test.ts — Phase 23: Advanced Unit Algebra, Derived
 * Units & Symbolic Dimensional Analysis.
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  createRegistry,
  SI_PACK,
  RADIATION_PACK,
  Expression,
  parseUnitExpression,
  formatUnitExpr,
  unitExprKey,
  normalizeUnitExpr,
  simplifyUnitExpr,
  equivalentUnits,
  dimensionOfUnitExpr,
  scaleOfUnitExpr,
  toUnit,
  reciprocalUnitExpr,
  rootUnitExpr,
  powUnitExpr,
  multiplyUnits,
  divideUnits,
  atom,
  one,
  analyzeUnitExpr,
  checkUnitExpr,
  serializeUnitExpr,
  deserializeUnitExpr,
  defaultDerivedUnitRegistry,
  DerivedUnitRegistry,
  analyzeDimensions,
  inferUnknownDimensions,
  Dim,
} from "../src/index.js";
import { parseUnit } from "../src/unit-parser.js";
import { ExpressionError, ExpressionLimitError } from "../src/errors/index.js";

const reg = createRegistry({ packs: [SI_PACK] });
const parse = (text: string) => parseUnitExpression(text, reg);

// ---------------------------------------------------------------------------
// 23.2/23.3 Canonical algebra
// ---------------------------------------------------------------------------

describe("canonical unit algebra", () => {
  it("m/s and m·s^-1 share the canonical representation", () => {
    expect(unitExprKey(parse("m/s"))).toBe(unitExprKey(parse("m·s^-1")));
    expect(unitExprKey(parse("m/s"))).toBe(unitExprKey(parse("m/s")));
  });

  it("factor order is irrelevant: kg·m/s² ≡ m·kg/s²", () => {
    expect(unitExprKey(parse("kg*m/s^2"))).toBe(unitExprKey(parse("m*kg/s^2")));
  });

  it("simplification: m·m→m², m²/m→m, kg·m/kg→m, (m/s)·s→m, 1/s·s→1", () => {
    expect(formatUnitExpr(simplifyUnitExpr(parse("m*m")))).toBe("m²");
    expect(formatUnitExpr(simplifyUnitExpr(parse("m^2/m")))).toBe("m");
    expect(formatUnitExpr(simplifyUnitExpr(parse("kg*m/kg")))).toBe("m");
    expect(formatUnitExpr(simplifyUnitExpr(parse("(m/s)*s")))).toBe("m");
    expect(formatUnitExpr(simplifyUnitExpr(parse("1/s*s")))).toBe("1");
    expect(formatUnitExpr(simplifyUnitExpr(parse("(m/s)/(m/s)")))).toBe("1");
    expect(formatUnitExpr(simplifyUnitExpr(parse("(m^2/s^2)*s")))).toBe("m²/s");
  });

  it("zero exponents vanish; reciprocal normalizes", () => {
    expect(formatUnitExpr(simplifyUnitExpr(parse("m^0*kg")))).toBe("kg");
    expect(formatUnitExpr(reciprocalUnitExpr(parse("m/s")))).not.toBe("1");
    expect(unitExprKey(reciprocalUnitExpr(parse("m/s")))).toBe(unitExprKey(parse("s/m")));
  });

  it("builders compose structurally", () => {
    const expr = divideUnits(
      multiplyUnits(atom(parseUnit("kg", reg)), atom(parseUnit("m", reg))),
      powUnitExpr(atom(parseUnit("s", reg)), 2),
    );
    expect(unitExprKey(expr)).toBe(unitExprKey(parse("kg*m/s^2")));
    expect(unitExprKey(one())).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// 23.4 Dimension algebra over expressions
// ---------------------------------------------------------------------------

describe("dimension inference without numerics", () => {
  it("Force = M·L·T⁻², Energy = E (engine model)", () => {
    expect(dimensionOfUnitExpr(parse("kg*m/s^2"))).toEqual({ M: 1, L: 1, T: -2 });
    expect(dimensionOfUnitExpr(parse("N", reg))).toEqual({ M: 1, L: 1, T: -2 });
    expect(dimensionOfUnitExpr(parse("J", reg))).toEqual(Dim.Energy);
    expect(dimensionOfUnitExpr(parse("V", reg))).toEqual({ E: 1, T: -1, I: -1 });
    expect(dimensionOfUnitExpr(parse("Hz", reg))).toEqual({ T: -1 });
  });

  it("Velocity² = L²/T² (powers raise dimensions)", () => {
    expect(dimensionOfUnitExpr(parse("(m/s)^2", reg))).toEqual({ L: 2, T: -2 });
  });

  it("analyzeUnitExpr returns diagnostics instead of throwing", () => {
    const ok = analyzeUnitExpr(parse("kg*m/s^2"));
    expect(ok.valid).toBe(true);
    expect(ok.dimension).toEqual({ M: 1, L: 1, T: -2 });
    // Affine atoms cannot be combined: valid:false with a reason.
    const bad = analyzeUnitExpr(parse("°C*m"));
    expect(bad.valid).toBe(false);
    expect(bad.diagnostics.length).toBeGreaterThan(0);
    expect(checkUnitExpr(parse("m"))).toBe(true);
    expect(checkUnitExpr(parse("°C*m"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 23.5/23.6 Derived units: display intent vs canonical identity
// ---------------------------------------------------------------------------

describe("derived units", () => {
  it("N → kg·m/s², Pa → N/m², J → N·m, W → J/s, Hz → 1/s, C/V/Ω expand", () => {
    const r = defaultDerivedUnitRegistry;
    // Expansion goes to primitives: compare against primitive spellings…
    expect(unitExprKey(r.expand("N", reg))).toBe(unitExprKey(parse("kg*m/s^2", reg)));
    expect(unitExprKey(r.expand("Pa", reg))).toBe(unitExprKey(parse("kg/(m*s^2)", reg)));
    // W expands transitively (W→J/s→N·m/s→kg·m²/s³):
    expect(unitExprKey(r.expand("W", reg))).toBe(unitExprKey(parse("kg*m^2/s^3", reg)));
    // …but NOT equivalent to J/s: the engine E-model keeps J on the E base
    // dimension, so expansion (M·L²·T⁻³) and J/s (E·T⁻¹) differ by design.
    expect(equivalentUnits(r.expand("W", reg), parse("J/s", reg))).toBe(false);
    expect(unitExprKey(r.expand("Hz", reg))).toBe(unitExprKey(parse("1/s", reg)));
    expect(unitExprKey(r.expand("C", reg))).toBe(unitExprKey(parse("A*s", reg)));
    // V expands transitively through W and J to primitives:
    expect(unitExprKey(r.expand("V", reg))).toBe(unitExprKey(parse("kg*m^2/s^3/A", reg)));
    // …while named forms stay equivalent without collapsing structure.
    expect(equivalentUnits(r.expand("Pa", reg), parse("N/m^2", reg))).toBe(true);
    expect(unitExprKey(r.expand("Pa", reg))).not.toBe(unitExprKey(parse("N/m^2", reg)));
  });

  it("matchDerived recovers display intent from structure", () => {
    expect(defaultDerivedUnitRegistry.matchDerived(parse("kg*m/s^2", reg), reg)).toBe("N");
    expect(defaultDerivedUnitRegistry.matchDerived(parse("N/m^2", reg), reg)).toBe("Pa");
    expect(defaultDerivedUnitRegistry.matchDerived(parse("m"), reg)).toBeUndefined();
  });

  it("custom registries are isolated and validated", () => {
    const custom = new DerivedUnitRegistry([]);
    custom.define({ name: "smoot", definition: "m", description: "test-only" });
    expect(custom.expand("smoot", reg)).toBeDefined();
    expect(() => custom.define({ name: "smoot", definition: "m" })).toThrow();
    expect(() => custom.define({ name: "bad", definition: "not_a_unit_xyz" })).toThrow();
    expect(() => custom.require("missing")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 23.7 Prefix algebra
// ---------------------------------------------------------------------------

describe("prefix algebra", () => {
  it("km/cm/mm/ deductible combos parse with correct scales", () => {
    expect(parse("km").kind).toBe("atom");
    expect(scaleOfUnitExpr(parse("km"))).toBe(1000);
    expect(scaleOfUnitExpr(parse("mg/mL", reg))).toBeCloseTo(1, 12); // both milli cancel
    expect(scaleOfUnitExpr(parse("mmol/L", reg))).toBeCloseTo(1, 12); // 1 mmol/L = 1 mol/m³
    // Absolute base scale (Mcal/kg per kJ/kg), not the kJ/J ratio:
    expect(scaleOfUnitExpr(parse("kJ/kg", reg))).toBeCloseTo(0.239006 / 1000, 12);
  });

  it("invalid prefix combos are rejected by the registry", () => {
    expect(() => parse("kkg")).toThrow(ExpressionError);
    expect(() => parse("mkg")).toThrow(ExpressionError);
  });
});

// ---------------------------------------------------------------------------
// 23.8/23.9 Powers and exact roots
// ---------------------------------------------------------------------------

describe("powers and exact roots", () => {
  it("m², m³, (m/s)², (m/s)³ parse with dimensions", () => {
    expect(dimensionOfUnitExpr(parse("m^3"))).toEqual({ L: 3 });
    expect(dimensionOfUnitExpr(parse("(m/s)^3", reg))).toEqual({ L: 3, T: -3 });
  });

  it("sqrt(m²)→m, sqrt(m⁴)→m², sqrt(m) throws", () => {
    expect(formatUnitExpr(rootUnitExpr(parse("m^2"), 2))).toBe("m");
    expect(formatUnitExpr(rootUnitExpr(parse("m^4"), 2))).toBe("m²");
    expect(() => rootUnitExpr(parse("m"), 2)).toThrow(ExpressionError);
    expect(() => rootUnitExpr(parse("m^2"), 0)).toThrow(ExpressionError);
  });

  it("non-integer power exponents are rejected", () => {
    expect(() => parse("m^2.5")).toThrow(ExpressionError);
    expect(() => powUnitExpr(atom(parseUnit("m", reg)), 1.5)).toThrow(ExpressionError);
  });
});

// ---------------------------------------------------------------------------
// 23.15 Affine/nonlinear safety
// ---------------------------------------------------------------------------

describe("affine and nonlinear safety", () => {
  it("dimension/scale inference rejects affine atoms explicitly", () => {
    expect(() => dimensionOfUnitExpr(parse("°C*m"))).toThrow(ExpressionError);
    expect(() => scaleOfUnitExpr(parse("°C*m"))).toThrow(ExpressionError);
    expect(() => toUnit(parse("°C*m"))).toThrow(ExpressionError);
  });

  it("equivalence never equates affine with linear", () => {
    // K (linear, kind-tagged) vs °C (affine): different conversions → not equivalent.
    expect(equivalentUnits(parse("K"), parse("°C"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 23.16 Equivalence (structural + metrological, kind- and basis-aware)
// ---------------------------------------------------------------------------

describe("unit equivalence", () => {
  it("N ≡ kg·m/s²; J ≡ N·m is FALSE in the engine E-model (documented)", () => {
    expect(equivalentUnits(parse("N", reg), parse("kg*m/s^2", reg))).toBe(true);
    expect(equivalentUnits(parse("Pa", reg), parse("N/m^2", reg))).toBe(true);
    expect(equivalentUnits(parse("J", reg), parse("N*m", reg))).toBe(false);
  });

  it("kinds gate equivalence: Bq ≢ Hz, Gy ≢ Sv under default policy", () => {
    const radReg = createRegistry({ packs: [RADIATION_PACK] });
    const bq = parseUnitExpression("Bq", radReg);
    const hz = parseUnitExpression("Hz", radReg);
    // Same T⁻¹ dimension and (after the Phase 21 Hz audit) same scale —
    // kinds still keep them apart unless explicitly ignored.
    expect(equivalentUnits(bq, hz)).toBe(false);
    expect(equivalentUnits(bq, hz, { ignoreKind: true })).toBe(true);
    const gy = parseUnitExpression("Gy", radReg);
    const sv = parseUnitExpression("Sv", radReg);
    expect(equivalentUnits(gy, sv)).toBe(false);
    expect(equivalentUnits(gy, sv, { ignoreKind: true })).toBe(true);
    expect(equivalentUnits(gy, parseUnitExpression("Gy", radReg))).toBe(true);
  });

  it("basis mismatch blocks equivalence", () => {
    expect(equivalentUnits(parse("kg DM"), parse("kg"))).toBe(false);
    expect(equivalentUnits(parse("kg DM"), parse("kg DM"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 23.17–23.21 Parser, formatter, serialization, interning
// ---------------------------------------------------------------------------

describe("parser, formatter, serialization", () => {
  it("parses kg*m/s^2, kg·m/s², (kg*m)/s^2, (kg/s^2)*m identically", () => {
    const key = unitExprKey(parse("kg*m/s^2"));
    expect(unitExprKey(parse("kg·m/s²"))).toBe(key);
    expect(unitExprKey(parse("(kg*m)/s^2"))).toBe(key);
    expect(unitExprKey(parse("(kg/s^2)*m"))).toBe(key);
    // …while kg/(m·s²) is genuinely different (parentheses matter).
    expect(unitExprKey(parse("kg/(m*s^2)"))).not.toBe(key);
  });

  it("rejects malformed input with typed errors", () => {
    expect(() => parse("")).toThrow(ExpressionError);
    expect(() => parse("kg//s")).toThrow(ExpressionError);
    expect(() => parse("(kg")).toThrow(ExpressionError);
    expect(() => parse("kg)")).toThrow(ExpressionError);
    expect(() => parse("nope_xyz")).toThrow(ExpressionError);
    expect(() => parse("m^-")).toThrow(ExpressionError);
  });

  it("formats ascii/unicode deterministically with named units preserved", () => {
    expect(formatUnitExpr(parse("kg*m/s^2"))).toBe("kg·m/s²");
    expect(formatUnitExpr(parse("kg*m/s^2"), { style: "ascii" })).toBe("kg*m/s^2");
    expect(formatUnitExpr(parse("1/s"))).toBe("1/s");
    expect(formatUnitExpr(parse("N", reg))).toBe("N"); // display intent kept
  });

  it("serialization round-trips; malformed input rejected", () => {
    const expr = parse("kg*m/s^2");
    const restored = deserializeUnitExpr(JSON.parse(JSON.stringify(serializeUnitExpr(expr))), reg);
    expect(unitExprKey(restored)).toBe(unitExprKey(expr));
    expect(() => deserializeUnitExpr(null, reg)).toThrow(ExpressionError);
    expect(() => deserializeUnitExpr({ version: 2, type: "unit-expr", factors: [] }, reg)).toThrow(
      ExpressionError,
    );
    expect(() => deserializeUnitExpr({ version: 1, type: "nope", factors: [] }, reg)).toThrow(
      ExpressionError,
    );
    expect(() =>
      deserializeUnitExpr(
        { version: 1, type: "unit-expr", factors: [{ unit: "m", exponent: 1.5 }] },
        reg,
      ),
    ).toThrow(ExpressionError);
    expect(() =>
      deserializeUnitExpr(
        { version: 1, type: "unit-expr", factors: [{ unit: "nope_xyz", exponent: 1 }] },
        reg,
      ),
    ).toThrow(ExpressionError);
    expect(() =>
      deserializeUnitExpr(
        JSON.parse('{"version":1,"type":"unit-expr","factors":[],"__proto__":{}}'),
        reg,
      ),
    ).toThrow(ExpressionError);
  });

  it("interning returns identical normalized objects for equal expressions", () => {
    expect(normalizeUnitExpr(parse("m/s"))).toBe(normalizeUnitExpr(parse("m·s^-1")));
  });

  it("materialized units convert correctly", () => {
    const newton = toUnit(parse("kg*m/s^2", reg));
    expect(Quantity.of(1, "N", reg).to(newton).value).toBeCloseTo(1, 9);
  });
});

// ---------------------------------------------------------------------------
// 23.22 Security limits
// ---------------------------------------------------------------------------

describe("algebra security limits", () => {
  it("rejects enormous input, deep nesting, huge exponents", () => {
    expect(() => parseUnitExpression("m".padEnd(600, "*m"), reg)).toThrow(ExpressionLimitError);
    let nested = "m";
    for (let i = 0; i < 40; i++) nested = `(${nested})`;
    expect(() => parseUnitExpression(nested, reg)).toThrow(ExpressionLimitError);
    expect(() => parseUnitExpression("m^1000000", reg)).toThrow(ExpressionLimitError);
    expect(() =>
      deserializeUnitExpr(
        { version: 1, type: "unit-expr", factors: new Array(600).fill({ unit: "m", exponent: 1 }) },
        reg,
      ),
    ).toThrow(ExpressionLimitError);
  });

  it("custom limits are enforced", () => {
    expect(() => parseUnitExpression("m*m", reg, { maxAstNodes: 1 })).toThrow(ExpressionLimitError);
    expect(() => parseUnitExpression("m^5", reg, { maxExponent: 2 })).toThrow(ExpressionLimitError);
  });
});

// ---------------------------------------------------------------------------
// 23.24 Property tests (algebraic identities)
// ---------------------------------------------------------------------------

describe("algebraic identities (property)", () => {
  const cases = ["m", "kg*m/s^2", "N", "J/s", "mol/L"];
  it("(a*b)/b = a", () => {
    for (const text of cases) {
      const a = parse(text, reg);
      const rebuilt = simplifyUnitExpr(
        parse(`(${formatUnitExpr(a, { style: "ascii" })})*s/s`, reg),
      );
      void rebuilt;
      // Direct structural check instead: (a·s)/s normalizes to a.
      const { multiplyUnits: mul, divideUnits: div } = { multiplyUnits, divideUnits };
      const s = atom(parseUnit("s", reg));
      expect(unitExprKey(simplifyUnitExpr(div(mul(a, s), s)))).toBe(unitExprKey(a));
    }
  });

  it("a*1 = a, a/a = 1, (a*b)*c = a*(b*c), a*(b/c) = (a*b)/c", () => {
    for (const text of cases) {
      const a = parse(text, reg);
      const b = parse("s", reg);
      const c = parse("kg", reg);
      expect(unitExprKey(simplifyUnitExpr(multiplyUnits(a, one())))).toBe(unitExprKey(a));
      expect(unitExprKey(simplifyUnitExpr(divideUnits(a, a)))).toBe("1");
      expect(unitExprKey(simplifyUnitExpr(multiplyUnits(multiplyUnits(a, b), c)))).toBe(
        unitExprKey(simplifyUnitExpr(multiplyUnits(a, multiplyUnits(b, c)))),
      );
      expect(unitExprKey(simplifyUnitExpr(multiplyUnits(a, divideUnits(b, c))))).toBe(
        unitExprKey(simplifyUnitExpr(divideUnits(multiplyUnits(a, b), c))),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 23.10–23.12 Symbolic dimensional analysis API
// ---------------------------------------------------------------------------

describe("symbolic dimensional analysis", () => {
  it("analyzeDimensions reports without evaluating", () => {
    const ok = analyzeDimensions(
      Expression.multiply(Expression.variable("m"), Expression.variable("a")),
      {
        m: Dim.Mass,
        a: { L: 1, T: -2 },
      },
    );
    expect(ok.valid).toBe(true);
    expect(ok.dimension).toEqual({ M: 1, L: 1, T: -2 });
    const bad = analyzeDimensions(
      Expression.add(Expression.variable("l"), Expression.variable("t")),
      { l: "m", t: "s" },
    );
    expect(bad.valid).toBe(false);
    expect(bad.dimension).toBeUndefined();
    expect(bad.diagnostics.length).toBeGreaterThan(0);
  });

  it("inferUnknownDimensions propagates constraints", () => {
    // F = m·a, given output Force and m = Mass → a = L/T².
    const expr = Expression.multiply(Expression.variable("m"), Expression.variable("a"));
    const solved = inferUnknownDimensions(
      expr,
      { m: Dim.Mass },
      { outputDimension: { M: 1, L: 1, T: -2 } },
    );
    expect(solved["a"]).toEqual({ L: 1, T: -2 });
    // x = y/t, given output Velocity and t = Time → y = Length.
    const expr2 = Expression.divide(Expression.variable("y"), Expression.variable("t"));
    const solved2 = inferUnknownDimensions(
      expr2,
      { t: { T: 1 } },
      { outputDimension: { L: 1, T: -1 } },
    );
    expect(solved2["y"]).toEqual({ L: 1 });
    // add/sub unify siblings: e = m1 + m2 with m1 known → m2 = Mass.
    const expr3 = Expression.add(Expression.variable("m1"), Expression.variable("m2"));
    const solved3 = inferUnknownDimensions(expr3, { m1: Dim.Mass }, {});
    expect(solved3["m2"]).toEqual({ M: 1 });
  });
});
