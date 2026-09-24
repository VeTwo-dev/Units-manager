/**
 * tests/measurement.test.ts — Phase 20: Uncertainty, Precision, Significant
 * Figures & Measurement Semantics.
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Measurement,
  serializeMeasurement,
  deserializeMeasurement,
  isMeasurement,
  isSerializedMeasurement,
  countSignificantFigures,
  mulDivSigFigs,
  addSubDecimalPlaces,
  toSignificantFigures,
  toScientificNotation,
  toEngineeringNotation,
  formatQuantity,
  evaluateMeasurement,
  Expression,
  Dim,
  UnitMismatchError,
  NumericalError,
  InvalidMeasurementError,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Construction & validation
// ---------------------------------------------------------------------------

describe("Measurement construction", () => {
  it("of() with absolute uncertainty", () => {
    const m = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
    expect(m.value.value).toBe(10);
    expect(m.uncertainty.value).toBe(0.2);
    expect(m.dimension).toEqual(Dim.Mass);
  });

  it("of() with relative fraction converts to absolute", () => {
    const m = Measurement.of(Quantity.of(10, "kg"), 0.02);
    expect(m.uncertainty.value).toBeCloseTo(0.2, 12);
    expect(m.uncertainty.unit.symbol).toBe("kg");
  });

  it("exact() records stated zero uncertainty", () => {
    const m = Measurement.exact(Quantity.of(5, "m"));
    expect(m.uncertainty.value).toBe(0);
    expect(m.value.value).toBe(5);
  });

  it("rejects dimension mismatch (kg ± m)", () => {
    expect(() => Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "m"))).toThrow(
      InvalidMeasurementError,
    );
  });

  it("rejects negative uncertainty", () => {
    expect(() => Measurement.of(Quantity.of(10, "kg"), Quantity.of(-0.2, "kg"))).toThrow(
      InvalidMeasurementError,
    );
    expect(() => Measurement.of(Quantity.of(10, "kg"), -0.1)).toThrow(InvalidMeasurementError);
  });

  it("rejects NaN uncertainty, non-finite relative", () => {
    expect(() => Measurement.of(Quantity.of(10, "kg"), Quantity.of(NaN, "kg"))).toThrow(
      InvalidMeasurementError,
    );
    expect(() => Measurement.of(Quantity.of(10, "kg"), Infinity)).toThrow(InvalidMeasurementError);
  });

  it("rejects affine uncertainty units (use K, not °C)", () => {
    expect(() => Measurement.of(Quantity.of(20, "°C"), Quantity.of(2, "°C"))).toThrow(
      InvalidMeasurementError,
    );
    // ...but K uncertainty on a °C value is fine
    expect(() => Measurement.of(Quantity.of(20, "°C"), Quantity.of(2, "K"))).not.toThrow();
  });

  it("rejects invalid confidence levels", () => {
    const v = Quantity.of(10, "kg");
    const u = Quantity.of(0.2, "kg");
    expect(() => Measurement.of(v, u, { confidenceLevel: 0 })).toThrow(InvalidMeasurementError);
    expect(() => Measurement.of(v, u, { confidenceLevel: 1 })).toThrow(InvalidMeasurementError);
    expect(() => Measurement.of(v, u, { confidenceLevel: NaN })).toThrow(InvalidMeasurementError);
    expect(() => Measurement.of(v, u, { confidenceLevel: 0.95 })).not.toThrow();
  });

  it("rejects unknown methods and non-Quantity inputs", () => {
    const v = Quantity.of(10, "kg");
    const u = Quantity.of(0.2, "kg");
    expect(() => Measurement.of(v, u, { method: "monte-carlo" as never })).toThrow(
      InvalidMeasurementError,
    );
    expect(() => Measurement.of(10 as never, u)).toThrow(InvalidMeasurementError);
    expect(() => Measurement.of(v, "x" as never)).toThrow(InvalidMeasurementError);
  });

  it("instances are frozen (immutable)", () => {
    const m = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
    expect(Object.isFrozen(m)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Conversion (scale-only uncertainty)
// ---------------------------------------------------------------------------

describe("Measurement conversion", () => {
  it("converts value and uncertainty together", () => {
    const m = Measurement.of(Quantity.of(1, "kg"), Quantity.of(0.1, "kg")).to("g");
    expect(m.value.value).toBeCloseTo(1000, 9);
    expect(m.uncertainty.value).toBeCloseTo(100, 9);
  });

  it("affine conversion never applies offsets to uncertainty", () => {
    const m = Measurement.of(Quantity.of(10, "K"), Quantity.of(2, "K")).to("°C");
    expect(m.value.value).toBeCloseTo(-263.15, 9);
    expect(m.uncertainty.value).toBeCloseTo(2, 12); // NOT 275.15
  });

  it("preserves metadata across conversion", () => {
    const m = Measurement.of(Quantity.of(1, "kg"), Quantity.of(0.1, "kg"), {
      source: "scale-3",
    }).to("g");
    expect(m.metadata?.source).toBe("scale-3");
  });
});

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

describe("Measurement propagation", () => {
  it("add: quadrature σ=√(σ₁²+σ₂²)", () => {
    const a = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.3, "kg"));
    const b = Measurement.of(Quantity.of(5, "kg"), Quantity.of(0.4, "kg"));
    const r = a.add(b);
    expect(r.value.value).toBeCloseTo(15, 12);
    expect(r.uncertainty.value).toBeCloseTo(0.5, 12);
  });

  it("add converts units before combining", () => {
    const a = Measurement.of(Quantity.of(1, "kg"), Quantity.of(0.1, "kg"));
    const b = Measurement.of(Quantity.of(500, "g"), Quantity.of(50, "g"));
    const r = a.add(b);
    expect(r.value.value).toBeCloseTo(1.5, 12);
    expect(r.uncertainty.value).toBeCloseTo(Math.sqrt(0.1 ** 2 + 0.05 ** 2), 12);
    expect(r.value.unit.symbol).toBe("kg"); // left-unit policy
  });

  it("subtract: quadrature, dimension preserved", () => {
    const a = Measurement.of(Quantity.of(10, "m"), Quantity.of(0.3, "m"));
    const b = Measurement.of(Quantity.of(4, "m"), Quantity.of(0.4, "m"));
    const r = a.subtract(b);
    expect(r.value.value).toBeCloseTo(6, 12);
    expect(r.uncertainty.value).toBeCloseTo(0.5, 12);
  });

  it("add rejects dimension mismatch", () => {
    const a = Measurement.of(Quantity.of(1, "kg"), Quantity.of(0.1, "kg"));
    const b = Measurement.of(Quantity.of(1, "m"), Quantity.of(0.1, "m"));
    expect(() => a.add(b)).toThrow(UnitMismatchError);
  });

  it("multiply: relative quadrature", () => {
    // 10±0.2 kg × 5±0.1 m → 50 ± 50·√(0.02² + 0.02²)
    const a = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
    const b = Measurement.of(Quantity.of(5, "m"), Quantity.of(0.1, "m"));
    const r = a.multiply(b);
    expect(r.value.toBase().value).toBeCloseTo(50, 9);
    expect(r.uncertainty.toBase().value).toBeCloseTo(50 * Math.sqrt(0.02 ** 2 + 0.02 ** 2), 9);
  });

  it("divide: relative quadrature", () => {
    const a = Measurement.of(Quantity.of(10, "m"), Quantity.of(0.2, "m"));
    const b = Measurement.of(Quantity.of(2, "s"), Quantity.of(0.02, "s"));
    const r = a.divide(b);
    // Canonical time base is day, so base velocity is m/day (5 m/s = 432000 m/day).
    expect(r.value.to("m/s").value).toBeCloseTo(5, 9);
    expect(r.value.toBase().value).toBeCloseTo(432000, 6);
    expect(r.uncertainty.to("m/s").value).toBeCloseTo(5 * Math.sqrt(0.02 ** 2 + 0.01 ** 2), 9);
  });

  it("pow scales relative uncertainty by |n|", () => {
    const a = Measurement.of(Quantity.of(4, "m"), Quantity.of(0.04, "m")); // 1%
    const r = a.pow(2);
    expect(r.value.toBase().value).toBeCloseTo(16, 9);
    expect(r.uncertainty.toBase().value).toBeCloseTo(16 * 0.02, 9);
  });

  it("pow rejects non-integer exponents", () => {
    const a = Measurement.of(Quantity.of(4, "m"), Quantity.of(0.04, "m"));
    expect(() => a.pow(1.5)).toThrow();
  });

  it("scale multiplies uncertainty by |factor|", () => {
    const r = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg")).scale(3);
    expect(r.value.value).toBe(30);
    expect(r.uncertainty.value).toBeCloseTo(0.6, 12);
  });

  it("negate/abs preserve uncertainty", () => {
    const m = Measurement.of(Quantity.of(-5, "kg"), Quantity.of(0.2, "kg"));
    expect(m.negate().value.value).toBe(5);
    expect(m.negate().uncertainty.value).toBe(0.2);
    expect(m.abs().value.value).toBe(5);
    expect(m.abs().uncertainty.value).toBe(0.2);
  });

  it("zero nominal with nonzero uncertainty is undefined for relative ops", () => {
    const z = Measurement.of(Quantity.of(0, "kg"), Quantity.of(0.1, "kg"));
    const o = Measurement.of(Quantity.of(2, "m"), Quantity.of(0.1, "m"));
    expect(() => z.multiply(o)).toThrow(NumericalError);
    expect(() =>
      Measurement.of(Quantity.of(0, "kg"), Quantity.of(0, "kg")).multiply(o),
    ).not.toThrow();
  });

  it("relative propagation is unit-aware for mixed representations", () => {
    // 10 kg ± 200 g → 2% relative, not 200/10 = 20.
    const a = Measurement.of(Quantity.of(10, "kg"), Quantity.of(200, "g"));
    expect(a.relativeUncertainty()).toBeCloseTo(0.02, 12);
    const o = Measurement.of(Quantity.of(2, "fraction"), Quantity.of(0.02, "fraction"));
    const r = a.multiply(o);
    expect(r.uncertainty.to("kg").value).toBeCloseTo(20 * Math.sqrt(0.02 ** 2 + 0.01 ** 2), 9);
  });

  it("operations do not mutate operands", () => {
    const a = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
    const b = Measurement.of(Quantity.of(5, "kg"), Quantity.of(0.1, "kg"));
    a.add(b);
    expect(a.value.value).toBe(10);
    expect(a.uncertainty.value).toBe(0.2);
  });
});

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

describe("Measurement comparison", () => {
  it("equals compares value and uncertainty", () => {
    const a = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
    const b = Measurement.of(Quantity.of(10000, "g"), Quantity.of(200, "g"));
    expect(a.equals(b)).toBe(true);
    // Base-normalized identity (same as Quantity.exactEquals): 10 kg and
    // 10000 g share base values, so they are exactly equal as quantities.
    expect(a.exactEquals(b)).toBe(true);
    const c = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.3, "kg"));
    expect(a.equals(c)).toBe(false);
    expect(a.exactEquals(c)).toBe(false);
  });

  it("overlaps is explicit interval intersection", () => {
    const a = Measurement.of(Quantity.of(10, "kg"), Quantity.of(1, "kg")); // [9,11]
    const b = Measurement.of(Quantity.of(11, "kg"), Quantity.of(1, "kg")); // [10,12]
    const c = Measurement.of(Quantity.of(20, "kg"), Quantity.of(1, "kg")); // [19,21]
    expect(a.overlaps(b)).toBe(true);
    expect(a.overlaps(c)).toBe(false);
  });

  it("overlaps rejects dimension mismatch", () => {
    const a = Measurement.of(Quantity.of(10, "kg"), Quantity.of(1, "kg"));
    const b = Measurement.of(Quantity.of(10, "m"), Quantity.of(1, "m"));
    expect(() => a.overlaps(b)).toThrow(UnitMismatchError);
  });

  it("relativeUncertainty as fraction", () => {
    expect(
      Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg")).relativeUncertainty(),
    ).toBeCloseTo(0.02, 12);
    expect(Measurement.of(Quantity.of(10, "kg"), Quantity.of(0, "kg")).relativeUncertainty()).toBe(
      0,
    );
    expect(() =>
      Measurement.of(Quantity.of(0, "kg"), Quantity.of(0.1, "kg")).relativeUncertainty(),
    ).toThrow(NumericalError);
  });
});

// ---------------------------------------------------------------------------
// Expression integration
// ---------------------------------------------------------------------------

describe("Measurement expression integration", () => {
  it("evaluates formulas with uncertainty propagation", () => {
    const expr = Expression.multiply(Expression.variable("a"), Expression.variable("b"));
    const r = evaluateMeasurement(expr, {
      a: Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg")),
      b: Measurement.of(Quantity.of(5, "m"), Quantity.of(0.1, "m")),
    });
    expect(r.value.toBase().value).toBeCloseTo(50, 9);
    expect(r.uncertainty.toBase().value).toBeCloseTo(50 * Math.sqrt(0.02 ** 2 + 0.02 ** 2), 9);
  });

  it("treats plain Quantities as exact", () => {
    const expr = Expression.add(Expression.variable("a"), Expression.variable("b"));
    const r = evaluateMeasurement(expr, {
      a: Quantity.of(10, "kg"),
      b: Measurement.of(Quantity.of(5, "kg"), Quantity.of(0.5, "kg")),
    });
    expect(r.value.value).toBeCloseTo(15, 12);
    expect(r.uncertainty.value).toBeCloseTo(0.5, 12);
  });

  it("supports literals, convert and power nodes", () => {
    const expr = Expression.convert(
      Expression.multiply(Expression.literal(2, "fraction"), Expression.variable("x")),
      "g",
    );
    const r = evaluateMeasurement(expr, {
      x: Measurement.of(Quantity.of(3, "kg"), Quantity.of(0.03, "kg")),
    });
    expect(r.value.unit.symbol).toBe("g");
    expect(r.value.value).toBeCloseTo(6000, 9);
    const powExpr = Expression.power(Expression.variable("x"), 2);
    const pr = evaluateMeasurement(powExpr, {
      x: Measurement.of(Quantity.of(4, "m"), Quantity.of(0.04, "m")),
    });
    expect(pr.value.toBase().value).toBeCloseTo(16, 9);
  });

  it("rejects unknown variables and bad bindings", () => {
    const expr = Expression.variable("nope");
    expect(() => evaluateMeasurement(expr, {})).toThrow();
    expect(() => evaluateMeasurement(Expression.variable("x"), { x: 5 as never })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe("Measurement serialization", () => {
  it("round-trips value, uncertainty and metadata", () => {
    const m = Measurement.of(Quantity.of(10.5, "kg"), Quantity.of(0.2, "kg"), {
      confidenceLevel: 0.95,
      source: "scale-3",
    });
    const json = JSON.parse(JSON.stringify(serializeMeasurement(m)));
    const r = deserializeMeasurement(json);
    expect(r.value.value).toBe(10.5);
    expect(r.uncertainty.value).toBe(0.2);
    expect(r.metadata?.confidenceLevel).toBe(0.95);
    expect(r.metadata?.source).toBe("scale-3");
    expect(r.value.unit.symbol).toBe("kg");
  });

  it("round-trips special values via string encoding", () => {
    const m = Measurement.of(Quantity.of(NaN, "kg"), Quantity.of(0.2, "kg"));
    const r = deserializeMeasurement(JSON.parse(JSON.stringify(serializeMeasurement(m))));
    expect(Number.isNaN(r.value.value)).toBe(true);
    expect(r.uncertainty.value).toBe(0.2);
  });

  it("rejects malformed payloads", () => {
    expect(() => deserializeMeasurement(null)).toThrow();
    expect(() => deserializeMeasurement({})).toThrow();
    expect(() => deserializeMeasurement({ version: 2, type: "measurement" })).toThrow();
    expect(() => deserializeMeasurement({ version: 1, type: "quantity" })).toThrow();
    expect(() =>
      deserializeMeasurement({
        version: 1,
        type: "measurement",
        value: { version: 1, type: "quantity", value: 1, unit: "kg" },
        uncertainty: { version: 1, type: "quantity", value: -1, unit: "kg" },
      }),
    ).toThrow();
    expect(() =>
      deserializeMeasurement({
        version: 1,
        type: "measurement",
        value: { version: 1, type: "quantity", value: 1, unit: "kg" },
        uncertainty: { version: 1, type: "quantity", value: 1, unit: "m" },
      }),
    ).toThrow();
  });

  it("rejects prototype pollution", () => {
    const payload = JSON.parse(
      '{"version":1,"type":"measurement","value":{"version":1,"type":"quantity","value":1,"unit":"kg"},"uncertainty":{"version":1,"type":"quantity","value":0.1,"unit":"kg"},"__proto__":{}}',
    );
    const before = ({} as Record<string, unknown>).__proto__;
    expect(() => deserializeMeasurement(payload)).toThrow();
    expect(({} as Record<string, unknown>).__proto__).toBe(before);
  });

  it("isMeasurement / isSerializedMeasurement guards", () => {
    const m = Measurement.of(Quantity.of(1, "kg"), Quantity.of(0.1, "kg"));
    expect(isMeasurement(m)).toBe(true);
    expect(isMeasurement(Quantity.of(1, "kg"))).toBe(false);
    expect(isMeasurement(null)).toBe(false);
    expect(isSerializedMeasurement(serializeMeasurement(m))).toBe(true);
    expect(isSerializedMeasurement({ version: 1, type: "quantity" })).toBe(false);
    expect(isSerializedMeasurement(null)).toBe(false);
  });

  it("serialize/deserialize preserves semantics (property)", () => {
    const cases: Array<[number, string, number, string]> = [
      [10, "kg", 0.2, "kg"],
      [0, "m", 0, "m"],
      [2.5, "Mcal/kg", 0.05, "Mcal/kg"],
    ];
    for (const [v, vu, u, uu] of cases) {
      const m = Measurement.of(Quantity.of(v, vu), Quantity.of(u, uu));
      const r = deserializeMeasurement(JSON.parse(JSON.stringify(serializeMeasurement(m))));
      expect(r.value.value).toBe(v);
      expect(r.uncertainty.value).toBe(u);
      expect(r.dimension).toEqual(m.dimension);
    }
  });

  it("toString shows value ± uncertainty unit", () => {
    expect(Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg")).toString()).toBe(
      "10 ± 0.2 kg",
    );
  });
});

// ---------------------------------------------------------------------------
// Significant figures
// ---------------------------------------------------------------------------

describe("Significant figures: counting", () => {
  it.each([
    ["12.30", 4],
    ["12", 2],
    ["100", 1],
    ["100.", 3],
    ["0.0012300", 5],
    ["0", 1],
    ["0.0", 1],
    ["1.23e6", 3],
    ["-4.50", 3],
    [".5", 1],
    ["101", 3],
  ] as const)("countSignificantFigures(%s) = %i", (text, expected) => {
    expect(countSignificantFigures(text)).toBe(expected);
  });

  it("rejects non-decimal text", () => {
    expect(() => countSignificantFigures("")).toThrow();
    expect(() => countSignificantFigures(".")).toThrow();
    expect(() => countSignificantFigures("abc")).toThrow();
    expect(() => countSignificantFigures("1e")).toThrow();
    expect(() => countSignificantFigures(12 as never)).toThrow();
  });
});

describe("Significant figures: propagation rules", () => {
  it("mul/div take the minimum count", () => {
    expect(mulDivSigFigs(2, 3)).toBe(2);
    expect(mulDivSigFigs(4, 4)).toBe(4);
    expect(() => mulDivSigFigs(0, 2)).toThrow();
    expect(() => mulDivSigFigs(2.5, 2)).toThrow();
  });

  it("add/sub take the minimum decimal places", () => {
    expect(addSubDecimalPlaces(1, 2)).toBe(1);
    expect(addSubDecimalPlaces(0, 3)).toBe(0);
    expect(() => addSubDecimalPlaces(-1, 2)).toThrow();
  });
});

describe("Significant figures: rendering", () => {
  it("toSignificantFigures fixes sig figs", () => {
    expect(toSignificantFigures(12345, 3)).toBe("1.23e+4");
    expect(toSignificantFigures(0.0012345, 3)).toBe("0.00123");
    expect(toSignificantFigures(0, 3)).toBe("0.00");
    expect(toSignificantFigures(-2.5, 2)).toBe("-2.5");
    expect(toSignificantFigures(NaN, 3)).toBe("NaN");
    expect(toSignificantFigures(Infinity, 3)).toBe("Infinity");
    expect(() => toSignificantFigures(1, 0)).toThrow();
    expect(() => toSignificantFigures(1, 101)).toThrow();
  });

  it("toScientificNotation uses one leading digit", () => {
    expect(toScientificNotation(12345, 4)).toBe("1.234e+4"); // 1.2345 is not exact in binary
    expect(toScientificNotation(0.00012345, 3)).toBe("1.23e-4");
    expect(toScientificNotation(-2.5, 2)).toBe("-2.5e+0");
  });

  it("toEngineeringNotation snaps exponents to multiples of three", () => {
    expect(toEngineeringNotation(12345, 4)).toBe("12.35e+3");
    expect(toEngineeringNotation(0.00012345, 3)).toBe("123e-6");
    expect(toEngineeringNotation(999960, 4)).toBe("1.000e+6");
  });
});

// ---------------------------------------------------------------------------
// Formatter integration (presentation only)
// ---------------------------------------------------------------------------

describe("Formatter significant figures and notation", () => {
  it("significantFigures option renders sig figs, ignores decimals", () => {
    expect(formatQuantity(Quantity.of(12345, "m"), { significantFigures: 3 })).toBe("1.23e+4 m");
    expect(
      formatQuantity(Quantity.of(12.34567, "kg"), { significantFigures: 4, decimals: 9 }),
    ).toBe("12.35 kg");
  });

  it("notation scientific/engineering", () => {
    expect(formatQuantity(Quantity.of(12345, "m"), { notation: "scientific" })).toBe("1.23e+4 m");
    expect(formatQuantity(Quantity.of(12345, "m"), { notation: "engineering" })).toBe("12.3e+3 m");
    expect(
      formatQuantity(Quantity.of(12345, "m"), { notation: "scientific", significantFigures: 5 }),
    ).toBe("1.2345e+4 m");
  });

  it("display never mutates the stored value", () => {
    const q = Quantity.of(12.34567, "kg");
    formatQuantity(q, { significantFigures: 3 });
    formatQuantity(q, { notation: "scientific" });
    expect(q.value).toBe(12.34567);
  });

  it("special numbers still render", () => {
    expect(formatQuantity(Quantity.of(NaN, "kg"), { significantFigures: 3 })).toContain("NaN");
  });
});
