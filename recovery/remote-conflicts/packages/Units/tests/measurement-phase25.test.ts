/**
 * tests/measurement-phase25.test.ts — Phase 25 additions: extended metadata
 * (significant figures, confidence, provenance, correlation), correlation-aware
 * arithmetic, function uncertainty propagation, and extended serialization.
 *
 * Core Measurement behavior is covered by tests/measurement.test.ts; this
 * file covers only the Phase 25 extensions.
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Measurement,
  serializeMeasurement,
  deserializeMeasurement,
  evaluateMeasurement,
  parseMeasurement,
  Expression,
  InvalidMeasurementError,
  NumericalError,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Extended metadata validation
// ---------------------------------------------------------------------------

describe("extended metadata validation", () => {
  it("accepts significant figures, confidence, provenance metadata", () => {
    const m = Measurement.of(Quantity.of(10.25, "kg"), Quantity.of(0.05, "kg"), {
      significantFigures: { sigFigs: 4, notation: "standard" },
      confidenceInterval: { coverageFactor: 2, confidenceLevel: 0.95, distribution: "normal" },
      provenance: { method: "caliper", laboratoryId: "lab-1", timestamp: "2026-01-01T00:00:00Z" },
    });
    expect(m.significantFigures).toBe(4);
    expect(m.confidenceInterval?.coverageFactor).toBe(2);
    expect(m.provenance?.laboratoryId).toBe("lab-1");
  });

  it("rejects invalid extended metadata", () => {
    const q = Quantity.of(10, "kg");
    const u = Quantity.of(0.1, "kg");
    expect(() => Measurement.of(q, u, { significantFigures: { sigFigs: 0 } })).toThrow(
      InvalidMeasurementError,
    );
    expect(() =>
      Measurement.of(q, u, { significantFigures: { sigFigs: 3, notation: "hex" as never } }),
    ).toThrow(InvalidMeasurementError);
    expect(() => Measurement.of(q, u, { confidenceInterval: { coverageFactor: 0 } })).toThrow(
      InvalidMeasurementError,
    );
    expect(() =>
      Measurement.of(q, u, {
        confidenceInterval: { coverageFactor: 2, distribution: "cauchy" as never },
      }),
    ).toThrow(InvalidMeasurementError);
    expect(() =>
      Measurement.of(q, u, { correlation: { with: q as never, coefficient: 0.5 } }),
    ).toThrow(InvalidMeasurementError);
    expect(() =>
      Measurement.of(q, u, {
        correlation: { with: Measurement.of(q, u), coefficient: 2 },
      }),
    ).toThrow(InvalidMeasurementError);
    expect(() => Measurement.of(q, u, { autoSigFigs: "yes" as never })).toThrow(
      InvalidMeasurementError,
    );
  });
});

// ---------------------------------------------------------------------------
// Significant figures presentation
// ---------------------------------------------------------------------------

describe("significant figures presentation", () => {
  it("formats with explicit significant figures", () => {
    const m = Measurement.of(Quantity.of(10.25, "kg"), Quantity.of(0.05, "kg"), {
      significantFigures: { sigFigs: 4 },
    });
    expect(m.getEffectiveSigFigs()).toBe(4);
    expect(m.formatWithSigFigs()).toBe("10.25");
    expect(m.formatWithSigFigs("scientific")).toBe("1.025e+1");
  });

  it("auto-calculates significant figures from uncertainty", () => {
    // 10.25 ± 0.05 → relative 0.0049 → ~3 sig figs
    const m = Measurement.of(Quantity.of(10.25, "kg"), Quantity.of(0.05, "kg"), {
      autoSigFigs: true,
    });
    expect(m.getEffectiveSigFigs()).toBeGreaterThanOrEqual(2);
    expect(m.getEffectiveSigFigs()).toBeLessThanOrEqual(4);
    // Exact (u = 0) with autoSigFigs → 1
    const exact = Measurement.exact(Quantity.of(5, "m"), { autoSigFigs: true });
    expect(exact.getEffectiveSigFigs()).toBe(1);
  });

  it("stored precision is never mutated by formatting", () => {
    const m = Measurement.of(Quantity.of(12.347, "m"), Quantity.of(0.218, "m"), {
      significantFigures: { sigFigs: 3 },
    });
    m.formatWithSigFigs();
    m.formatWithSigFigs("engineering");
    expect(m.value.value).toBe(12.347);
    expect(m.uncertainty.value).toBe(0.218);
  });
});

// ---------------------------------------------------------------------------
// Confidence intervals
// ---------------------------------------------------------------------------

describe("confidence intervals", () => {
  it("computes k=2 intervals around the nominal value", () => {
    const m = Measurement.of(Quantity.of(10, "m"), Quantity.of(0.5, "m"), {
      confidenceInterval: { coverageFactor: 2, confidenceLevel: 0.95 },
    });
    const ci = m.getConfidenceInterval();
    expect(ci).not.toBeNull();
    expect(ci!.lower.value).toBeCloseTo(9, 12);
    expect(ci!.upper.value).toBeCloseTo(11, 12);
    expect(ci!.coverageFactor).toBe(2);
  });

  it("returns null without confidence metadata", () => {
    const m = Measurement.of(Quantity.of(10, "m"), Quantity.of(0.5, "m"));
    expect(m.getConfidenceInterval()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Correlation-aware arithmetic
// ---------------------------------------------------------------------------

describe("correlation-aware arithmetic", () => {
  it("addCorrelated interpolates between quadrature and linear sum", () => {
    const a = Measurement.of(Quantity.of(10, "kg"), Quantity.of(3, "kg"));
    const b = Measurement.of(Quantity.of(5, "kg"), Quantity.of(4, "kg"));
    const indep = a.addCorrelated(b, { with: b, coefficient: 0 });
    expect(indep.uncertainty.value).toBeCloseTo(5, 12); // √(9+16)
    expect(indep.uncertainty.value).toBeCloseTo(a.add(b).uncertainty.value, 12);
    const full = a.addCorrelated(b, { with: b, coefficient: 1 });
    expect(full.uncertainty.value).toBeCloseTo(7, 12); // 3 + 4
  });

  it("subtractCorrelated cancels fully correlated uncertainties", () => {
    const a = Measurement.of(Quantity.of(10, "kg"), Quantity.of(3, "kg"));
    const b = Measurement.of(Quantity.of(4, "kg"), Quantity.of(3, "kg"));
    const full = a.subtractCorrelated(b, { with: b, coefficient: 1 });
    expect(full.uncertainty.value).toBeCloseTo(0, 12);
    expect(full.value.value).toBeCloseTo(6, 12);
  });

  it("multiplyCorrelated/divideCorrelated use relative quadrature with covariance", () => {
    const a = Measurement.of(Quantity.of(10, "kg"), Quantity.of(1, "kg")); // r = 0.1
    const b = Measurement.of(Quantity.of(5, "m"), Quantity.of(0.25, "m")); // r = 0.05
    const prod = a.multiplyCorrelated(b, { with: b, coefficient: 0 });
    expect(prod.uncertainty.toBase().value).toBeCloseTo(
      a.multiply(b).uncertainty.toBase().value,
      9,
    );
    const anti = a.multiplyCorrelated(b, { with: b, coefficient: -1 });
    const expected = 50 * Math.abs(0.1 - 0.05);
    expect(anti.uncertainty.toBase().value).toBeCloseTo(expected, 9);
  });
});

// ---------------------------------------------------------------------------
// Function uncertainty propagation
// ---------------------------------------------------------------------------

describe("function uncertainty propagation", () => {
  it("sqrt halves relative uncertainty", () => {
    const m = Measurement.of(Quantity.of(9, "m^2"), Quantity.of(0.18, "m^2")); // r = 0.02
    const r = evaluateMeasurement(Expression.call("sqrt", [Expression.variable("x")]), { x: m });
    expect(r.value.to("m").value).toBeCloseTo(3, 9);
    // relative of result ≈ 0.01
    const rel = r.uncertainty.toBase().value / Math.abs(r.value.toBase().value);
    expect(rel).toBeCloseTo(0.01, 9);
  });

  it("exp scales by f(x): σ = f(x)·r", () => {
    const m = Measurement.of(Quantity.of(2, "fraction"), Quantity.of(0.02, "fraction"));
    const r = evaluateMeasurement(Expression.call("exp", [Expression.variable("x")]), { x: m });
    expect(r.value.value).toBeCloseTo(Math.E ** 2, 9);
    expect(r.uncertainty.value).toBeCloseTo(Math.E ** 2 * 0.01, 9);
  });

  it("abs/negate preserve uncertainty; sin uses |cos| factor", () => {
    const m = Measurement.of(Quantity.of(-5, "kg"), Quantity.of(0.2, "kg"));
    const a = evaluateMeasurement(Expression.call("abs", [Expression.variable("x")]), { x: m });
    expect(a.value.value).toBe(5);
    expect(a.uncertainty.value).toBe(0.2);
    const s = Measurement.of(Quantity.of(0, "fraction"), Quantity.of(0.1, "fraction"));
    const sin = evaluateMeasurement(Expression.call("sin", [Expression.variable("x")]), { x: s });
    expect(sin.value.value).toBeCloseTo(0, 12);
    expect(sin.uncertainty.value).toBeCloseTo(0.1, 9); // |cos 0| = 1
  });

  it("unknown functions still throw explicitly", () => {
    const m = Measurement.of(Quantity.of(4, "fraction"), Quantity.of(0.1, "fraction"));
    expect(() =>
      evaluateMeasurement(Expression.call("nope_fn", [Expression.variable("x")]), { x: m }),
    ).toThrow(InvalidMeasurementError);
  });
});

// ---------------------------------------------------------------------------
// Extended serialization round-trips
// ---------------------------------------------------------------------------

describe("extended serialization", () => {
  it("round-trips significant figures, confidence, provenance", () => {
    const m = Measurement.of(Quantity.of(10.25, "kg"), Quantity.of(0.05, "kg"), {
      significantFigures: { sigFigs: 4, notation: "scientific" },
      confidenceInterval: { coverageFactor: 2, distribution: "normal" },
      provenance: { method: "scale", laboratoryId: "lab-1", timestamp: "2026-01-01T00:00:00Z" },
      autoSigFigs: true,
    });
    const restored = deserializeMeasurement(JSON.parse(JSON.stringify(serializeMeasurement(m))));
    expect(restored.significantFigures).toBe(4);
    expect(restored.confidenceInterval?.coverageFactor).toBe(2);
    expect(restored.provenance?.laboratoryId).toBe("lab-1");
    expect(restored.autoSigFigs).toBe(true);
    expect(restored.value.value).toBe(10.25);
  });

  it("round-trips provenance derivation chains", () => {
    const parent = Measurement.of(Quantity.of(5, "kg"), Quantity.of(0.1, "kg"));
    const child = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"), {
      provenance: { method: "doubled", derivedFrom: [parent] },
    });
    const restored = deserializeMeasurement(
      JSON.parse(JSON.stringify(serializeMeasurement(child))),
    );
    expect(restored.provenance?.derivedFrom?.length).toBe(1);
    expect(restored.provenance?.derivedFrom?.[0].value.value).toBe(5);
  });

  it("relative uncertainty of zero with nonzero uncertainty throws (no silent Infinity)", () => {
    const z = Measurement.of(Quantity.of(0, "kg"), Quantity.of(0.1, "kg"));
    expect(() => z.relativeUncertainty()).toThrow(NumericalError);
    expect(Measurement.of(Quantity.of(0, "kg"), Quantity.of(0, "kg")).relativeUncertainty()).toBe(
      0,
    );
  });
});

// ---------------------------------------------------------------------------
// Text parsing (controlled forms)
// ---------------------------------------------------------------------------

describe("measurement text parsing", () => {
  it("parses '10 ± 0.5 kg' and '10.0 +/- 0.2 m'", () => {
    const a = parseMeasurement("10 ± 0.5 kg");
    expect(a.value.value).toBe(10);
    expect(a.uncertainty.value).toBe(0.5);
    expect(a.value.unit.symbol).toBe("kg");
    const b = parseMeasurement("10.0 +/- 0.2 m");
    expect(b.value.value).toBe(10);
    expect(b.uncertainty.value).toBe(0.2);
  });

  it("parses explicit uncertainty units ('10 kg ± 200 g')", () => {
    const m = parseMeasurement("10 kg ± 200 g");
    expect(m.value.value).toBe(10);
    expect(m.uncertainty.value).toBe(200);
    expect(m.uncertainty.unit.symbol).toBe("g");
    expect(m.relativeUncertainty()).toBeCloseTo(0.02, 12);
  });

  it("bounds nested derivation depth (cyclic/malicious payloads terminate)", () => {
    const leaf = JSON.parse(
      JSON.stringify(
        serializeMeasurement(Measurement.of(Quantity.of(1, "kg"), Quantity.of(0.1, "kg"))),
      ),
    );
    let nested: unknown = leaf;
    for (let i = 0; i < 20; i++) {
      nested = {
        version: 1,
        type: "measurement",
        value: { version: 1, type: "quantity", value: 1, unit: "kg" },
        uncertainty: { version: 1, type: "quantity", value: 0.1, unit: "kg" },
        provenance: { derivedFrom: [nested] },
      };
    }
    expect(() => deserializeMeasurement(nested)).toThrow(InvalidMeasurementError);
  });

  it("rejects ambiguous, mismatched and oversized input", () => {
    expect(() => parseMeasurement("hello")).toThrow(InvalidMeasurementError);
    expect(() => parseMeasurement("10 kg")).toThrow(InvalidMeasurementError);
    expect(() => parseMeasurement("10 m ± 2 s")).toThrow(InvalidMeasurementError);
    expect(() => parseMeasurement("10 ± -0.5 kg")).toThrow(InvalidMeasurementError);
    expect(() => parseMeasurement("10 ± 0.5 kg", undefined, { maxLength: 5 })).toThrow(
      InvalidMeasurementError,
    );
    expect(() => parseMeasurement(42 as never)).toThrow(InvalidMeasurementError);
  });
});
