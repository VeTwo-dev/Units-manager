/**
 * audit.test.ts — Pre-nutrition-units structural trust audit.
 *
 * Each describe block maps to an audit section (§3–§17). These tests probe
 * malicious mutation, algebraic identities, high-risk temperature/affine
 * behavior, nonlinear boundaries, parser/formatter round-trips, registry
 * safety, formula/graph failure modes, measurement edge cases, constants,
 * systems, serialization attacks, and compile-time types.
 *
 * Nothing here tests domain logic — @vetwo/units must stay domain-neutral.
 *
 * Findings fixed during this audit (2026-09-13, all verified 1337/1337):
 * LOW-05 — E=mc² did not reproduce c² (no exact-SI constants); fixed by
 *   adding c/h/e/kB/NA/R constants + end-to-end regression test below.
 * LOW-06 — composite power symbols lied: pow(m/s,2) emitted "m/s^2" which
 *   re-parses as m·s⁻² while the stored dimension was L²·T⁻². Fixed in
 *   src/unit-parser.ts (powUnit parenthesizes composite bases → "(m/s)^2";
 *   divideUnits groups composite denominators → "kg/(m·s)") with the
 *   symbol-stability regression test below.
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Measurement,
  parseUnit,
  formatUnit,
  formatQuantity,
  createRegistry,
  SI_PACK,
  IMPERIAL_PACK,
  US_CUSTOMARY_PACK,
  ANGLE_PACK,
  makeUnit,
  serializeQuantity,
  deserializeQuantity,
  serializeMeasurement,
  deserializeMeasurement,
  defineFormula,
  evaluateFormula,
  createDependencyGraph,
  createStandardConstantRegistry,
  normalizeToSystem,
  SI_SYSTEM,
  CGS_SYSTEM,
  countSignificantFigures,
  toSignificantFigures,
  multiplyDim,
  divideDim,
  powDim,
  dimensionsEqual,
  dimensionKey,
  UnitMismatchError,
  DivisionByZeroError,
  InvalidMeasurementError,
  InvalidUnitError,
  UnsupportedUnitError,
  InvalidUnitExpressionError,
  ImpossibleConversionError,
  InvalidAffineOperationError,
  UnsupportedTransformationError,
  FormulaError,
  CyclicDependencyError,
  Expression,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// §3 Quantity immutability (regression: Quantity instances are frozen)
// ---------------------------------------------------------------------------

describe("audit §3: immutability", () => {
  it("Quantity instances are frozen; assignment cannot corrupt them", () => {
    const q = Quantity.of(10, "kg");
    expect(Object.isFrozen(q)).toBe(true);
    // Strict-mode assignment to a frozen object throws; value is unchanged either way.
    expect(() => {
      (q as unknown as Record<string, unknown>).value = 999;
    }).toThrow(TypeError);
    expect(q.value).toBe(10);
  });

  it("Measurement nested metadata is deep-frozen (no caller-side mutation)", () => {
    const meta = { source: "lab", provenance: { method: "scale", derivedFrom: [] as unknown[] } };
    const m = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"), meta);
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.isFrozen(m.metadata)).toBe(true);
    (meta.provenance.derivedFrom as unknown[]).push("CORRUPT");
    expect((m.metadata?.provenance as { derivedFrom?: unknown[] })?.derivedFrom ?? []).toEqual([]);
    expect(() => {
      ((m.metadata as Record<string, unknown>).source as string) = "x";
    }).toThrow(TypeError);
    expect(m.metadata?.source).toBe("lab");
  });

  it("formula definitions detach caller-owned dimension objects", () => {
    const dim = { M: 1 } as { M: number };
    const f = defineFormula({
      id: "audit_f",
      expression: Expression.variable("x"),
      inputs: { x: { dimension: dim } },
    });
    dim.M = 99;
    expect(f.inputs.x?.dimension).toEqual({ M: 1 });
  });

  it("registry snapshots isolate in both directions", () => {
    const r = createRegistry({});
    const s = r.snapshot();
    s.registerAtomic({ symbol: "qx", dimension: { L: 1 }, toBaseFactor: 1, label: "x" });
    expect(r.has("qx")).toBe(false);
    r.registerAtomic({ symbol: "qy", dimension: { L: 1 }, toBaseFactor: 1, label: "y" });
    expect(s.has("qy")).toBe(false);
  });

  it("units from makeUnit are frozen including metadata", () => {
    const u = makeUnit({
      symbol: "zz",
      dimension: { L: 1 },
      toBaseFactor: 1,
      label: "z",
      metadata: { kind: "x" },
    });
    expect(Object.isFrozen(u)).toBe(true);
    expect(Object.isFrozen(u.metadata)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4 Dimension system
// ---------------------------------------------------------------------------

describe("audit §4: dimensions", () => {
  const d = (s: string) => parseUnit(s).dimension;
  const key = (s: string) => JSON.stringify(d(s));

  it("A×1=A, A/A=1, associativity, commutativity, inverse, powers", () => {
    const A = { M: 1, L: 2 };
    const B = { T: -1 };
    const C = { M: -1 };
    const ONE: Record<string, number> = {};
    expect(dimensionsEqual(multiplyDim(A, ONE), A)).toBe(true);
    expect(dimensionsEqual(divideDim(A, A), ONE)).toBe(true);
    expect(
      dimensionsEqual(multiplyDim(multiplyDim(A, B), C), multiplyDim(A, multiplyDim(B, C))),
    ).toBe(true);
    expect(dimensionsEqual(multiplyDim(A, B), multiplyDim(B, A))).toBe(true);
    expect(dimensionsEqual(powDim(A, 2), multiplyDim(A, A))).toBe(true);
    expect(dimensionsEqual(powDim(A, 0), ONE)).toBe(true);
    expect(dimensionsEqual(powDim(A, -1), divideDim(ONE, A))).toBe(true);
    expect(dimensionKey(A)).toBe(dimensionKey({ L: 2, M: 1 }));
  });

  it("parsed dimensions round-trip through canonical keys", () => {
    const si = createRegistry({ packs: [SI_PACK] });
    expect(parseUnit("N", si).dimension).toEqual(parseUnit("kg*m/s^2", si).dimension);
    expect(d("m/m")).toEqual({});
    expect(d("(m/s)^2")).toEqual({ L: 2, T: -2 });
    expect(key("kg*m/s^2")).toBe(key("m*kg/s^2"));
  });
});

// ---------------------------------------------------------------------------
// §5 Unit model
// ---------------------------------------------------------------------------

describe("audit §5: units", () => {
  const si = createRegistry({ packs: [SI_PACK] });

  it("base, derived, prefixed, alias and compound units", () => {
    expect(parseUnit("kg").symbol).toBe("kg");
    expect(parseUnit("N", si).dimension).toEqual({ M: 1, L: 1, T: -2 });
    expect(parseUnit("km").symbol).toBe("km");
    expect(Quantity.of(1, "km").to("m").value).toBe(1000);
    expect(parseUnit("h").symbol).toBe("hour");
    expect(parseUnit("kg*m/s^2", si).dimension).toEqual(parseUnit("N", si).dimension);
  });

  it("rejects stacked prefixes and unknown units", () => {
    expect(() => parseUnit("kkg")).toThrow(UnsupportedUnitError);
    expect(() => parseUnit("mkg")).toThrow(UnsupportedUnitError);
    expect(() => parseUnit("zzz_nope")).toThrow(UnsupportedUnitError);
  });

  it("different dimensions never compare as equivalent", () => {
    expect(Quantity.of(1, "kg").dimension).not.toEqual(Quantity.of(1, "m").dimension);
    expect(() => Quantity.of(1, "kg").to("m")).toThrow(ImpossibleConversionError);
  });
});

// ---------------------------------------------------------------------------
// §6 Quantity arithmetic matrix
// ---------------------------------------------------------------------------

describe("audit §6: arithmetic", () => {
  const kg = (v: number) => Quantity.of(v, "kg");
  const m = (v: number) => Quantity.of(v, "m");
  const s = (v: number) => Quantity.of(v, "s");

  it("valid operations preserve dimensions, units and values", () => {
    expect(kg(1).add(kg(2)).value).toBe(3);
    expect(m(5).subtract(m(2)).value).toBe(3);
    expect(kg(2).multiply(m(3)).dimension).toEqual({ M: 1, L: 1 });
    expect(kg(6).divide(kg(2)).value).toBe(3);
    expect(kg(6).divide(kg(2)).dimension).toEqual({});
    expect(m(10).divide(s(2)).dimension).toEqual({ L: 1, T: -1 });
    expect(kg(2).scale(3).value).toBe(6);
    expect(m(3).pow(2).value).toBe(9);
    expect(Quantity.of(9, "m^2").sqrt().value).toBe(3);
    expect(kg(1500).to("g").value).toBe(1500000);
    expect(kg(2).min(kg(5)).value).toBe(2);
    expect(kg(2).max(kg(5)).value).toBe(5);
    expect(Quantity.of(2, "s").reciprocal().value).toBeCloseTo(0.5, 12);
    expect(kg(-5).sign().value).toBe(-1);
    expect(m(10).modulo(m(3)).value).toBe(1);
    expect(Quantity.of(1.234, "kg").roundTo("g").value).toBe(1234);
  });

  it("invalid operations throw typed errors, never NaN", () => {
    expect(() => kg(1).add(m(1))).toThrow(UnitMismatchError);
    expect(() => kg(1).subtract(m(1))).toThrow(UnitMismatchError);
    expect(() => m(1).divide(s(0))).toThrow(DivisionByZeroError);
    expect(() => Quantity.of(0, "kg").divide(Quantity.of(0, "kg"))).toThrow(DivisionByZeroError);
    expect(() => m(1).to("kg")).toThrow(ImpossibleConversionError);
    expect(() => Quantity.of(-4, "m^2").sqrt()).toThrow();
    const r = kg(0).divide(s(1));
    expect(r.value).toBe(0);
  });

  it("operations do not mutate operands", () => {
    const a = kg(5);
    const b = kg(3);
    a.add(b);
    a.multiply(b);
    expect(a.value).toBe(5);
    expect(b.value).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §7 Temperature / affine units (high risk)
// ---------------------------------------------------------------------------

describe("audit §7: temperature", () => {
  const C = (v: number) => Quantity.of(v, "°C");
  const K = (v: number) => Quantity.of(v, "K");

  it("absolute conversions both directions", () => {
    expect(C(0).to("K").value).toBeCloseTo(273.15, 9);
    expect(K(273.15).to("°C").value).toBeCloseTo(0, 9);
    expect(Quantity.of(32, "°F").to("°C").value).toBeCloseTo(0, 9);
  });

  it("delta + absolute, absolute − absolute = delta", () => {
    expect(C(10).add(K(5)).value).toBeCloseTo(15, 9);
    const delta = C(10).subtract(C(5));
    expect(delta.value).toBeCloseTo(5, 9);
    expect(delta.dimension).toEqual({ Temp: 1 });
  });

  it("invalid absolute-temperature arithmetic throws", () => {
    expect(() => C(10).add(C(5))).toThrow(InvalidAffineOperationError);
    expect(() => C(10).multiply(kg2())).toThrow(InvalidAffineOperationError);
    function kg2() {
      return Quantity.of(2, "kg");
    }
  });

  it("linear temperatures multiply/scale; deltas convert 1:1", () => {
    // K is linear (interval), multiplying by mass produces a composite unit (physically meaningful)
    const product = K(5).multiply(Quantity.of(2, "kg"));
    expect(product.value).toBe(10);
    // Scaling absolute temperature is not meaningful
    expect(() => C(10).scale(2)).toThrow(InvalidAffineOperationError);
    // K to °C conversion still works
    expect(K(1).to("°C").value).toBeCloseTo(-272.15, 6);
  });
});

// ---------------------------------------------------------------------------
// §8 Nonlinear / logarithmic units
// ---------------------------------------------------------------------------

describe("audit §8: nonlinear units", () => {
  it("logarithmic units convert to themselves but not multiplicatively", () => {
    const db = makeUnit({
      symbol: "dB",
      dimension: {},
      conversion: { kind: "logarithmic", reference: 1, factor: 10 },
      label: "decibel",
    });
    expect(Quantity.of(3, db).to(db).value).toBe(3);
    expect(() => Quantity.of(3, db).multiply(Quantity.of(2, db))).toThrow(
      UnsupportedTransformationError,
    );
    expect(() => Quantity.of(3, db).to("fraction")).toThrow();
  });

  it("same-unit logarithmic add is pure numeric (documented boundary)", () => {
    const db = makeUnit({
      symbol: "dB2",
      dimension: {},
      conversion: { kind: "logarithmic", reference: 1, factor: 10 },
      label: "decibel",
    });
    expect(Quantity.of(3, db).add(Quantity.of(2, db)).value).toBe(5);
  });

  it("measurement uncertainty on nonlinear units fails explicitly", () => {
    const db = makeUnit({
      symbol: "dB3",
      dimension: {},
      conversion: { kind: "logarithmic", reference: 1, factor: 10 },
      label: "decibel",
    });
    expect(() => Measurement.of(Quantity.of(3, db), Quantity.of(0.1, db))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// §9 Parser: edge cases, limits, determinism
// ---------------------------------------------------------------------------

describe("audit §9: parser", () => {
  it("juxtaposition, unicode, superscripts, parens, negative exponents", () => {
    expect(parseUnit("m s^-1").dimension).toEqual({ L: 1, T: -1 });
    expect(parseUnit("m²").dimension).toEqual({ L: 2 });
    expect(parseUnit("(m/s)^2").dimension).toEqual({ L: 2, T: -2 });
    expect(parseUnit("m^-2").dimension).toEqual({ L: -2 });
    expect(parseUnit("kg m s^-2", createRegistry({ packs: [SI_PACK] })).dimension).toEqual({
      M: 1,
      L: 1,
      T: -2,
    });
  });

  it("rejects malformed, empty, overlong and over-deep input with typed errors", () => {
    for (const bad of ["", "   ", "m//s", "(m/s", "m/s)", "m^2.5", "^m", "m^"]) {
      expect(() => parseUnit(bad), JSON.stringify(bad)).toThrow();
    }
    expect(() => parseUnit("a".repeat(5000))).toThrow(InvalidUnitExpressionError);
    expect(() => parseUnit("(".repeat(500) + "m" + ")".repeat(500))).toThrow(
      InvalidUnitExpressionError,
    );
  });

  it("emitted symbols always re-parse to the same dimension (regression)", () => {
    // Audit §5: pow(m/s,2) once emitted "m/s^2", which re-parses as m·s⁻²
    // while the stored dimension was L²·T⁻² — the symbol lied.
    const si = createRegistry({ packs: [SI_PACK] });
    for (const text of ["kg*m", "kg/m", "kg*m/s^2", "kg/(m*s)", "(m/s)^2", "m^2", "(kg*m)/s^2"]) {
      const u = parseUnit(text, si);
      const back = parseUnit(u.symbol, si);
      expect(back.dimension, `${text} → ${u.symbol}`).toEqual(u.dimension);
    }
    expect(parseUnit("(m/s)^2", si).symbol).toBe("(m/s)^2");
    expect(parseUnit("kg/(m*s)", si).symbol).toBe("kg/(m·s)");
  });

  it("parse is deterministic across calls", () => {
    const a = parseUnit("kg*m/s^2", createRegistry({ packs: [SI_PACK] }));
    const b = parseUnit("kg*m/s^2", createRegistry({ packs: [SI_PACK] }));
    expect(a.symbol).toBe(b.symbol);
    expect(a.dimension).toEqual(b.dimension);
    expect(a.toBaseFactor).toBe(b.toBaseFactor);
  });
});

// ---------------------------------------------------------------------------
// §10 Formatter round-trips and determinism
// ---------------------------------------------------------------------------

describe("audit §10: formatter", () => {
  const cases = ["m/s", "kg*m/s^2", "m^2", "s^-1", "°C", "m", "kg", "%", "m/m"];
  for (const text of cases) {
    it(`round-trips ${text} (unicode and ascii)`, () => {
      const u = parseUnit(text);
      for (const formatted of [formatUnit(u), formatUnit(u, { ascii: true })]) {
        const back = parseUnit(formatted);
        expect(back.dimension).toEqual(u.dimension);
      }
    });
  }

  it("output is deterministic and dimensionless-aware", () => {
    expect(formatUnit(parseUnit("m"))).toBe(formatUnit(parseUnit("m")));
    expect(formatQuantity(Quantity.of(NaN, "m"))).toBe("NaN m");
    expect(formatQuantity(Quantity.of(Infinity, "m"))).toBe("Infinity m");
    const angleReg = createRegistry({ packs: [ANGLE_PACK] });
    expect(formatQuantity(Quantity.of(1.5, "rad", angleReg), { showKind: true })).toContain("1.5");
  });
});

// ---------------------------------------------------------------------------
// §11 Registries: conflicts, pollution (regression), snapshots, namespaces
// ---------------------------------------------------------------------------

describe("audit §11: registries", () => {
  it("rejects prototype-polluted definitions (regression)", () => {
    const r = createRegistry({});
    expect(() =>
      r.registerAtomic(
        JSON.parse(
          '{"symbol":"qx","dimension":{"L":1},"toBaseFactor":1,"label":"x","__proto__":{}}',
        ),
      ),
    ).toThrow();
    expect(({} as Record<string, unknown>).qx).toBeUndefined();
  });

  it("rejects duplicate symbols and imperial/US collisions", () => {
    const r = createRegistry({});
    r.registerAtomic({ symbol: "qx", dimension: { L: 1 }, toBaseFactor: 1, label: "x" });
    expect(() =>
      r.registerAtomic({ symbol: "qx", dimension: { L: 1 }, toBaseFactor: 1, label: "x2" }),
    ).toThrow();
    expect(() => createRegistry({ packs: [IMPERIAL_PACK, US_CUSTOMARY_PACK] })).toThrow();
    expect(
      Quantity.of(1, "ton", createRegistry({ packs: [IMPERIAL_PACK] })).to("kg").value,
    ).toBeCloseTo(1016.05, 2);
  });

  it("seeded registries share atomics; snapshots detach", () => {
    const r = createRegistry({});
    expect(r.has("m")).toBe(true);
    const s = r.snapshot();
    expect(s.has("m")).toBe(true);
    s.registerAtomic({ symbol: "qz", dimension: { L: 1 }, toBaseFactor: 1, label: "z" });
    expect(r.has("qz")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §12 Formula engine and dependency graph
// ---------------------------------------------------------------------------

describe("audit §12: formulas and graphs", () => {
  const E = Expression;
  const ab = () =>
    defineFormula({
      id: "f",
      expression: E.divide(E.variable("a"), E.variable("b")),
      inputs: { a: { dimension: "m" }, b: { dimension: "m" } },
    });

  it("dimension errors fail at define time; runtime errors are typed", () => {
    expect(() =>
      defineFormula({
        id: "bad",
        expression: E.add(E.variable("a"), E.variable("b")),
        inputs: { a: { dimension: "m" }, b: { dimension: "s" } },
      }),
    ).toThrow(FormulaError);
    const f = ab();
    expect(() => evaluateFormula(f, { a: Quantity.of(1, "m"), b: Quantity.of(0, "m") })).toThrow(
      DivisionByZeroError,
    );
    expect(() => evaluateFormula(f, { a: Quantity.of(1, "m") })).toThrow(FormulaError);
    expect(() =>
      evaluateFormula(f, {
        a: Quantity.of(1, "m"),
        b: Quantity.of(2, "m"),
        c: Quantity.of(3, "m"),
      }),
    ).toThrow(FormulaError);
    expect(() =>
      evaluateFormula(
        defineFormula({
          id: "g",
          expression: E.call("nope", [E.variable("a")]),
          inputs: { a: { dimension: "m" } },
        }),
        { a: Quantity.of(1, "m") },
      ),
    ).toThrow(FormulaError);
  });

  it("cycles report paths; trace mode is tracked", () => {
    const fa = defineFormula({
      id: "fa",
      expression: E.variable("b"),
      inputs: { b: { dimension: "m" } },
      outputName: "a",
    });
    const fb = defineFormula({
      id: "fb",
      expression: E.variable("a"),
      inputs: { a: { dimension: "m" } },
      outputName: "b",
    });
    expect(() => createDependencyGraph([fa, fb])).toThrow(CyclicDependencyError);
    try {
      createDependencyGraph([fa, fb]);
    } catch (e) {
      expect((e as Error).message).toContain("fa");
      expect((e as Error).message).toContain("fb");
    }
    const f = ab();
    const traced = evaluateFormula(
      f,
      { a: Quantity.of(4, "m"), b: Quantity.of(2, "m") },
      { trace: true },
    );
    expect(traced).toHaveProperty("steps");
  });

  it("formulas never execute arbitrary code", () => {
    expect(() =>
      defineFormula({
        id: "evil",
        expression: { kind: "eval", code: "1+1" } as never,
        inputs: {},
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// §13 Measurement edge cases
// ---------------------------------------------------------------------------

describe("audit §13: measurements", () => {
  it("zero, affine, mixed, negative and NaN uncertainties behave safely", () => {
    expect(Measurement.of(Quantity.of(0, "kg"), Quantity.of(0, "kg")).relativeUncertainty()).toBe(
      0,
    );
    expect(() =>
      Measurement.of(Quantity.of(0, "kg"), Quantity.of(0.1, "kg")).relativeUncertainty(),
    ).toThrow();
    expect(() => Measurement.of(Quantity.of(20, "°C"), Quantity.of(1, "°C"))).toThrow(
      InvalidMeasurementError,
    );
    expect(
      Measurement.of(Quantity.of(10, "kg"), Quantity.of(200, "g")).relativeUncertainty(),
    ).toBeCloseTo(0.02, 12);
    expect(() => Measurement.of(Quantity.of(10, "kg"), Quantity.of(-1, "kg"))).toThrow(
      InvalidMeasurementError,
    );
    expect(() => Measurement.of(Quantity.of(10, "kg"), Quantity.of(NaN, "kg"))).toThrow(
      InvalidMeasurementError,
    );
    expect(() => Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.1, "m"))).toThrow(
      InvalidMeasurementError,
    );
  });

  it("equality, overlap and affine conversion semantics", () => {
    const a = Measurement.of(Quantity.of(10, "kg"), Quantity.of(1, "kg"));
    const b = Measurement.of(Quantity.of(10.5, "kg"), Quantity.of(1, "kg"));
    const c = Measurement.of(Quantity.of(20, "kg"), Quantity.of(1, "kg"));
    expect(a.overlaps(b)).toBe(true);
    expect(a.overlaps(c)).toBe(false);
    expect(a.exactEquals(a)).toBe(true);
    expect(a.equals(b)).toBe(false);
    expect(a.approximatelyEquals(a)).toBe(true);
    const t = Measurement.of(Quantity.of(10, "K"), Quantity.of(2, "K")).to("°C");
    expect(t.uncertainty.value).toBeCloseTo(2, 12);
  });

  it("significant figures count and render deterministically", () => {
    expect(countSignificantFigures("12.30")).toBe(4);
    expect(countSignificantFigures("100")).toBe(1);
    expect(countSignificantFigures("0.00123")).toBe(3);
    expect(() => countSignificantFigures("abc")).toThrow();
    expect(toSignificantFigures(12345, 3)).toBe("1.23e+4");
  });
});

// ---------------------------------------------------------------------------
// §14 Scientific constants
// ---------------------------------------------------------------------------

describe("audit §14: constants", () => {
  it("E=mc² end to end: correct value, dimension and honest symbol", () => {
    const si = createRegistry({ packs: [SI_PACK] });
    const E = Expression;
    const c = createStandardConstantRegistry().require("c");
    const f = defineFormula(
      {
        id: "emc2",
        expression: E.multiply(E.variable("mass"), E.power(E.variable("c"), 2)),
        inputs: { mass: { dimension: { M: 1 } } },
        constants: { c },
      },
      { registry: si },
    );
    const r = evaluateFormula(f, { mass: Quantity.of(1, "kg") }, { registry: si });
    expect(r.dimension).toEqual({ M: 1, L: 2, T: -2 });
    // c² = 299792458² exactly in integers; relative error must be ~1e-12.
    const got = r.to("N*m", si).value;
    expect(Math.abs(got - 299792458 ** 2) / 299792458 ** 2).toBeLessThan(1e-9);
    // The symbol must re-parse to the result's own dimension (regression).
    expect(parseUnit(r.unit.symbol, si).dimension).toEqual(r.dimension);
  });

  it("identifiers, exactness, uncertainty, dimensions and reproducibility", () => {
    const reg = createStandardConstantRegistry();
    expect(reg.require("c").quantity.value).toBe(299792458);
    expect(reg.require("c").exact).toBe(true);
    expect(reg.require("c").measurement.uncertainty.value).toBe(0);
    expect(reg.require("G").exact).toBe(false);
    expect(reg.require("G").measurement.uncertainty.value).toBeGreaterThan(0);
    expect(reg.require("c").quantity.dimension).toEqual({ L: 1, T: -1 });
    expect(() => reg.require("nope")).toThrow();
    const snap = reg.snapshot();
    expect(snap.require("c").quantity.value).toBe(299792458);
    const e = defineFormula({
      id: "emc2",
      expression: Expression.multiply(
        Expression.variable("m"),
        Expression.power(Expression.variable("c"), 2),
      ),
      inputs: { m: { dimension: { M: 1 } } },
      constants: { c: reg.require("c") },
    });
    void e;
  });
});

// ---------------------------------------------------------------------------
// §15 Systems and profiles
// ---------------------------------------------------------------------------

describe("audit §15: systems", () => {
  const siOnly = createRegistry({ packs: [SI_PACK] });

  it("SI/CGS/Imperial/US preferred units and conversions", () => {
    expect(normalizeToSystem(Quantity.of(1000, "g", siOnly), SI_SYSTEM, {}).unit.symbol).toBe("kg");
    expect(normalizeToSystem(Quantity.of(1, "lb", siOnly), CGS_SYSTEM, {}).unit.symbol).toBe("g");
    // Composite dimensions without a profile mapping fail explicitly (never guessed).
    expect(() => normalizeToSystem(Quantity.of(1, "N", siOnly), CGS_SYSTEM, {})).toThrow();
    expect(() => normalizeToSystem(Quantity.of(1, "J", siOnly), CGS_SYSTEM, {})).toThrow();
    expect(
      Quantity.of(100, "km/h", siOnly).to(
        "mph",
        createRegistry({ packs: [SI_PACK, IMPERIAL_PACK] }),
      ).value,
    ).toBeCloseTo(62.1371, 4);
  });

  it("display never mutates quantities; imperial foot converts", () => {
    const q = Quantity.of(100, "km/h");
    const shown = formatQuantity(q, { decimals: 1 });
    expect(typeof shown).toBe("string");
    expect(q.value).toBe(100);
    expect(Quantity.of(1, "ft").to("m").value).toBeCloseTo(0.3048, 12);
  });
});

// ---------------------------------------------------------------------------
// §16 Serialization: round-trips, malformed, versions, pollution
// ---------------------------------------------------------------------------

describe("audit §16: serialization", () => {
  it("NaN/Infinity/-0 survive JSON round-trips", () => {
    for (const v of [NaN, Infinity, -Infinity, -0, 0, 1.5]) {
      const back = deserializeQuantity(
        JSON.parse(JSON.stringify(serializeQuantity(Quantity.of(v, "m")))),
      );
      if (Number.isNaN(v)) expect(back.value).toBeNaN();
      else if (Object.is(v, -0)) expect(Object.is(back.value, -0)).toBe(true);
      else expect(back.value).toBe(v);
    }
  });

  it("rejects pollution, version mismatch and wrong types", () => {
    expect(() =>
      deserializeQuantity(
        JSON.parse('{"version":1,"type":"quantity","value":1,"unit":"kg","__proto__":{}}'),
      ),
    ).toThrow(InvalidUnitError);
    expect(() =>
      deserializeQuantity({ version: 99, type: "quantity", value: 1, unit: "kg" }),
    ).toThrow(InvalidUnitError);
    expect(() =>
      deserializeQuantity({ version: 1, type: "measurement", value: 1, unit: "kg" }),
    ).toThrow(InvalidUnitError);
    expect(() =>
      deserializeMeasurement({
        version: 1,
        type: "measurement",
        value: { version: 1, type: "quantity", value: 1, unit: "kg" },
        uncertainty: { version: 1, type: "quantity", value: -1, unit: "kg" },
      }),
    ).toThrow(InvalidMeasurementError);
  });

  it("measurement round-trips preserve value, uncertainty and metadata", () => {
    const m = Measurement.of(Quantity.of(10.25, "kg"), Quantity.of(0.05, "kg"), {
      source: "scale-3",
    });
    const back = deserializeMeasurement(JSON.parse(JSON.stringify(serializeMeasurement(m))));
    expect(back.value.value).toBe(10.25);
    expect(back.uncertainty.value).toBe(0.05);
    expect(back.metadata?.source).toBe("scale-3");
  });
});

// ---------------------------------------------------------------------------
// §17 TypeScript type-level tests
// ---------------------------------------------------------------------------

describe("audit §17: types", () => {
  it("readonly arrays and inference hold at compile time", () => {
    const q: Quantity = Quantity.of(1, "m");
    const v: number = q.value;
    expect(typeof v).toBe("number");
    // @ts-expect-error - value is readonly (runtime: frozen assignment throws)
    expect(() => {
      q.value = 5;
    }).toThrow(TypeError);
    expect(() => Quantity.of("x" as never, "m")).toThrow();
  });

  it("package metadata is coherent", async () => {
    const { readFile } = await import("node:fs/promises");
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      name?: unknown;
      version?: unknown;
      dependencies?: unknown;
      exports?: unknown;
      sideEffects?: unknown;
      files?: unknown;
    };
    expect(pkg.name).toBe("@vetwo/units");
    expect(typeof pkg.version).toBe("string");
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.sideEffects).toBe(false);
    expect((pkg.files as string[]).join(",")).not.toMatch(/tests/);
  });
});
