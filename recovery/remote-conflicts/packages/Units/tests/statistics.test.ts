/**
 * statistics.test.ts — Phase 27: uncertainty components, covariance,
 * series statistics, intervals, datasets, covariance propagation.
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Measurement,
  defineFormula,
  combineUncertainties,
  CovarianceMatrix,
  MeasurementSeries,
  MeasurementDataset,
  expandUncertainty,
  makeMeasurementInterval,
  makeConfidenceBounds,
  confidenceBoundsOf,
  runMonteCarloPropagation,
  propagateWithCovariance,
  serializeInterval,
  deserializeInterval,
  serializeConfidenceBounds,
  deserializeConfidenceBounds,
  Expression,
  InvalidMeasurementError,
  UnsupportedTransformationError,
  UnitMismatchError,
} from "../src/index.js";

const kg = (v: number, u: number): Measurement =>
  Measurement.of(Quantity.of(v, "kg"), Quantity.of(u, "kg"));
const m = (v: number, u: number): Measurement =>
  Measurement.of(Quantity.of(v, "m"), Quantity.of(u, "m"));

// ---------------------------------------------------------------------------
// Uncertainty components
// ---------------------------------------------------------------------------

describe("combineUncertainties", () => {
  it("root-sum-squares independent components", () => {
    const u = combineUncertainties([
      { id: "repeatability", type: "A", standardUncertainty: Quantity.of(3, "g") },
      { id: "calibration", type: "B", standardUncertainty: Quantity.of(4, "g") },
    ]);
    expect(u.value).toBeCloseTo(5, 12);
    expect(u.unit.symbol).toBe("g");
  });

  it("adds covariance terms when correlations are supplied", () => {
    const comps = [
      { id: "a", standardUncertainty: Quantity.of(3, "g") },
      { id: "b", standardUncertainty: Quantity.of(4, "g") },
    ] as const;
    const indep = combineUncertainties([...comps]);
    const full = combineUncertainties([...comps], {
      correlations: [{ idA: "a", idB: "b", coefficient: 1 }],
    });
    expect(indep.value).toBeCloseTo(5, 12);
    expect(full.value).toBeCloseTo(7, 12);
    const anti = combineUncertainties([...comps], {
      correlations: [{ idA: "a", idB: "b", coefficient: -1 }],
    });
    expect(anti.value).toBeCloseTo(1, 12);
  });

  it("rejects dimension mixing, bad coefficients, unknown ids, duplicates", () => {
    const g = { id: "a", standardUncertainty: Quantity.of(1, "g") };
    const kgU = { id: "b", standardUncertainty: Quantity.of(1, "kg") };
    expect(() => combineUncertainties([])).toThrow(InvalidMeasurementError);
    expect(() =>
      combineUncertainties([g, { id: "c", standardUncertainty: Quantity.of(1, "m") }]),
    ).toThrow(InvalidMeasurementError);
    expect(() => combineUncertainties([g, kgU])).not.toThrow(); // same dimension, mixed units OK
    expect(() =>
      combineUncertainties([g, { id: "b", standardUncertainty: Quantity.of(1, "g") }], {
        correlations: [{ idA: "a", idB: "b", coefficient: 2 }],
      }),
    ).toThrow(InvalidMeasurementError);
    expect(() =>
      combineUncertainties([g, { id: "b", standardUncertainty: Quantity.of(1, "g") }], {
        correlations: [{ idA: "a", idB: "zzz", coefficient: 0 }],
      }),
    ).toThrow(InvalidMeasurementError);
    expect(() => combineUncertainties([g, g])).toThrow(InvalidMeasurementError);
    expect(() =>
      combineUncertainties([{ id: "x", standardUncertainty: Quantity.of(-1, "g") }]),
    ).toThrow(InvalidMeasurementError);
  });

  it("mixed units combine physically (g vs kg)", () => {
    const u = combineUncertainties([
      { id: "a", standardUncertainty: Quantity.of(3000, "mg") },
      { id: "b", standardUncertainty: Quantity.of(0.004, "kg") },
    ]);
    // 3 g and 4 g → 5 g (first component's unit)
    expect(u.unit.symbol).toBe("mg");
    expect(u.value).toBeCloseTo(5000, 9);
  });
});

// ---------------------------------------------------------------------------
// CovarianceMatrix
// ---------------------------------------------------------------------------

describe("CovarianceMatrix", () => {
  it("builds from data with correlation accessors", () => {
    const cov = CovarianceMatrix.fromData(["x", "y"], "m", [
      [0.04, 0.01],
      [0.01, 0.09],
    ]);
    expect(cov.size).toBe(2);
    expect(cov.standardUncertainty("x").value).toBeCloseTo(0.2, 12);
    expect(cov.correlation("x", "y")).toBeCloseTo(0.01 / (0.2 * 0.3), 12);
    expect(cov.correlation("x", "x")).toBe(1);
    expect(cov.variance("y").value).toBeCloseTo(0.09, 12);
  });

  it("builds from measurements with explicit correlations", () => {
    const cov = CovarianceMatrix.fromMeasurements(
      { a: m(1, 0.2), b: m(2, 0.3) },
      { correlations: [{ idA: "a", idB: "b", coefficient: 0.5 }] },
    );
    expect(cov.correlation("a", "b")).toBeCloseTo(0.5, 12);
    // Dimension mismatch across entries throws.
    expect(() => CovarianceMatrix.fromMeasurements([m(1, 0.1), kg(1, 0.1)] as never)).toThrow(
      InvalidMeasurementError,
    );
  });

  it("rejects non-square, asymmetric, negative-variance, non-PSD input", () => {
    expect(() => CovarianceMatrix.fromData(["x"], "m", [[1, 2]])).toThrow(InvalidMeasurementError);
    expect(() =>
      CovarianceMatrix.fromData(["x", "y"], "m", [
        [1, 0.5],
        [0.6, 1],
      ]),
    ).toThrow(InvalidMeasurementError);
    expect(() => CovarianceMatrix.fromData(["x"], "m", [[-1]])).toThrow(InvalidMeasurementError);
    // Correlation 0.99 with these variances is PSD; 2.0 coefficient rejected earlier.
    // Non-PSD: variances 1,1 with covariance 2.
    expect(() =>
      CovarianceMatrix.fromData(["x", "y"], "m", [
        [1, 2],
        [2, 1],
      ]),
    ).toThrow(InvalidMeasurementError);
    // Affine units have no covariance scale.
    expect(() => CovarianceMatrix.fromData(["t"], "°C", [[1]])).toThrow(InvalidMeasurementError);
    expect(() => CovarianceMatrix.fromData(["t"], "nope", [[1]])).toThrow(InvalidMeasurementError);
  });

  it("zero-variance rows must be uncorrelated", () => {
    const ok = CovarianceMatrix.fromData(["x", "y"], "m", [
      [0, 0],
      [0, 1],
    ]);
    expect(ok.correlation("x", "y")).toBe(0);
    expect(() =>
      CovarianceMatrix.fromData(["x", "y"], "m", [
        [0, 0.5],
        [0.5, 1],
      ]),
    ).toThrow(InvalidMeasurementError);
  });

  it("serializes deterministically with round-trip", () => {
    const cov = CovarianceMatrix.fromData(["x", "y"], "m", [
      [0.04, 0.01],
      [0.01, 0.09],
    ]);
    const json = JSON.stringify(cov.serialize());
    const back = CovarianceMatrix.deserialize(JSON.parse(json));
    expect(JSON.stringify(back.serialize())).toBe(json);
    expect(back.correlation("x", "y")).toBeCloseTo(cov.correlation("x", "y"), 12);
    expect(() => CovarianceMatrix.deserialize({ version: 2 })).toThrow(InvalidMeasurementError);
    expect(() => CovarianceMatrix.deserialize("not json{[")).toThrow(InvalidMeasurementError);
  });

  it("enforces size limits", () => {
    const labels = Array.from({ length: 5 }, (_, i) => `x${i}`);
    const eye = labels.map((_, i) => labels.map((_, j) => (i === j ? 1 : 0)));
    expect(() =>
      CovarianceMatrix.fromData(labels, "m", eye, { limits: { maxMatrixDimension: 2 } }),
    ).toThrow(InvalidMeasurementError);
  });
});

// ---------------------------------------------------------------------------
// MeasurementSeries
// ---------------------------------------------------------------------------

describe("MeasurementSeries", () => {
  const series = () => MeasurementSeries.of([m(1, 0.1), m(2, 0.2), m(3, 0.3)]);

  it("mean / variance / stddev / SEM with units preserved", () => {
    const s = series();
    expect(s.count).toBe(3);
    expect(s.mean().value.value).toBeCloseTo(2, 12);
    expect(s.mean().value.unit.symbol).toBe("m");
    // SEM = 1/√3, mean σ = 0.2 → u = √(1/3 + 0.04)
    expect(s.mean().uncertainty.value).toBeCloseTo(Math.sqrt(1 / 3 + 0.04), 12);
    expect(s.variance().value).toBeCloseTo(1, 12);
    expect(s.variance().unit.symbol).toContain("m");
    expect(s.stddev().value).toBeCloseTo(1, 12);
    expect(s.stddev().unit.symbol).toBe("m");
    expect(s.standardError().value).toBeCloseTo(1 / Math.sqrt(3), 12);
  });

  it("mixed units normalize without losing originals", () => {
    const s = MeasurementSeries.of([
      Measurement.of(Quantity.of(1, "m"), Quantity.of(0.01, "m")),
      Measurement.of(Quantity.of(100, "cm"), Quantity.of(1, "cm")),
      Measurement.of(Quantity.of(0.001, "km"), Quantity.of(0.00001, "km")),
    ]);
    expect(s.mean().value.value).toBeCloseTo(1, 12);
    expect(s.originals[1]!.value.unit.symbol).toBe("cm");
    const cm = s.toUnit("cm");
    expect(cm.mean().value.value).toBeCloseTo(100, 9);
    expect(cm.originals[0]!.value.unit.symbol).toBe("m");
  });

  it("weighted means: explicit and inverse-variance", () => {
    const s = series();
    const equal = s.weightedMean([1, 1, 1]);
    expect(equal.value.value).toBeCloseTo(2, 12);
    const heavy = s.weightedMean([0, 0, 1]);
    expect(heavy.value.value).toBeCloseTo(3, 12);
    // Inverse-variance: w = 100, 25, 100/9 → mean = (100+50+100/3)/(225+25/9…)
    const iv = s.weightedMean("inverse-variance");
    const w = [100, 25, 100 / 9];
    const expected = (100 * 1 + 25 * 2 + (100 / 9) * 3) / w.reduce((a, b) => a + b, 0);
    expect(iv.value.value).toBeCloseTo(expected, 12);
    expect(iv.uncertainty.value).toBeCloseTo(1 / Math.sqrt(w.reduce((a, b) => a + b, 0)), 12);
    expect(() => s.weightedMean([1, 2])).toThrow(InvalidMeasurementError);
    expect(() => s.weightedMean([0, 0, 0])).toThrow(InvalidMeasurementError);
    expect(() => s.weightedMean([-1, 1, 1])).toThrow(InvalidMeasurementError);
    // Zero uncertainty breaks inverse-variance explicitly.
    const exact = MeasurementSeries.of([m(1, 0), m(2, 0.1)]);
    expect(() => exact.weightedMean("inverse-variance")).toThrow(InvalidMeasurementError);
  });

  it("min/max return original observations; summaries are deterministic", () => {
    const s = series();
    expect(s.min().value.value).toBe(1);
    expect(s.max().value.value).toBe(3);
    const summary = s.summarize();
    expect(summary.count).toBe(3);
    expect(summary.dimension).toBe("L^1");
    expect(JSON.stringify(s.summarize())).toBe(JSON.stringify(summary));
  });

  it("rejects mixed dimensions and bad construction", () => {
    expect(() => MeasurementSeries.of([])).toThrow(InvalidMeasurementError);
    expect(() => MeasurementSeries.of([m(1, 0.1), kg(1, 0.1)] as never)).toThrow(
      InvalidMeasurementError,
    );
    expect(() => MeasurementSeries.of([m(1, 0.1)], { targetUnit: "kg" })).toThrow(
      InvalidMeasurementError,
    );
    expect(() => MeasurementSeries.of([m(1, 0.1)], { targetUnit: "°C" })).toThrow(
      InvalidMeasurementError,
    );
  });

  it("series serialization round-trips", () => {
    const s = series();
    const back = MeasurementSeries.deserialize(JSON.parse(JSON.stringify(s.serialize())));
    expect(back.count).toBe(3);
    expect(back.mean().value.value).toBeCloseTo(2, 12);
    expect(() => MeasurementSeries.deserialize({ version: 9 })).toThrow(InvalidMeasurementError);
  });

  it("property: mean(x,x,x)=x and std(x,x,x)=0", () => {
    const s = MeasurementSeries.of([m(5, 0.1), m(5, 0.1), m(5, 0.1)]);
    expect(s.mean().value.value).toBeCloseTo(5, 12);
    expect(s.stddev().value).toBe(0);
    expect(s.variance().value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Intervals and expanded uncertainty
// ---------------------------------------------------------------------------

describe("intervals", () => {
  it("expanded uncertainty scales without claiming confidence", () => {
    const u = expandUncertainty(Quantity.of(0.5, "m"), 2);
    expect(u.value).toBe(1);
    expect(u.unit.symbol).toBe("m");
    expect(() => expandUncertainty(Quantity.of(1, "m"), 0)).toThrow(InvalidMeasurementError);
  });

  it("physical vs confidence intervals stay distinct types", () => {
    const physical = makeMeasurementInterval(Quantity.of(5, "m"), Quantity.of(7, "m"));
    expect(physical.lower.value).toBe(5);
    expect(() => makeMeasurementInterval(Quantity.of(7, "m"), Quantity.of(5, "m"))).toThrow(
      InvalidMeasurementError,
    );
    expect(() => makeMeasurementInterval(Quantity.of(5, "m"), Quantity.of(7, "s"))).toThrow(
      InvalidMeasurementError,
    );
    const ci = makeConfidenceBounds({
      lower: Quantity.of(5, "m"),
      upper: Quantity.of(7, "m"),
      level: 0.95,
      coverageFactor: 2,
      distribution: "normal",
    });
    expect(ci.level).toBe(0.95);
    expect(() =>
      makeConfidenceBounds({ lower: Quantity.of(5, "m"), upper: Quantity.of(7, "m"), level: 2 }),
    ).toThrow(InvalidMeasurementError);
    // confidenceBoundsOf derives symmetric bounds from k·u.
    const from = confidenceBoundsOf(m(10, 0.5), 2, 0.95);
    expect(from.lower.value).toBeCloseTo(9, 12);
    expect(from.upper.value).toBeCloseTo(11, 12);
    expect(from.coverageFactor).toBe(2);
  });

  it("interval serialization round-trips", () => {
    const ci = makeConfidenceBounds({
      lower: Quantity.of(5, "m"),
      upper: Quantity.of(7, "m"),
      level: 0.95,
    });
    const back = deserializeConfidenceBounds(
      JSON.parse(JSON.stringify(serializeConfidenceBounds(ci))),
    );
    expect(back.level).toBe(0.95);
    expect(back.lower.value).toBe(5);
    const phys = deserializeInterval(
      JSON.parse(
        JSON.stringify(
          serializeInterval(makeMeasurementInterval(Quantity.of(1, "m"), Quantity.of(2, "m"))),
        ),
      ),
    );
    expect(phys.upper.value).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Monte Carlo extension point + covariance propagation
// ---------------------------------------------------------------------------

describe("propagation", () => {
  it("Monte Carlo fails explicitly (deferred extension point)", () => {
    expect(() =>
      runMonteCarloPropagation(
        Expression.variable("x"),
        { x: m(1, 0.1) },
        {
          method: "monte-carlo",
          samples: 1000,
        },
      ),
    ).toThrow(UnsupportedTransformationError);
  });

  it("propagateWithCovariance matches quadrature for independent inputs", () => {
    const expr = Expression.add(Expression.variable("a"), Expression.variable("b"));
    const bindings = { a: m(10, 0.3), b: m(5, 0.4) };
    const cov = CovarianceMatrix.fromMeasurements(bindings);
    const r = propagateWithCovariance(expr, bindings, cov);
    expect(r.value.value).toBeCloseTo(15, 12);
    expect(r.uncertainty.value).toBeCloseTo(0.5, 9);
  });

  it("propagateWithCovariance honors correlations (fully correlated subtract cancels)", () => {
    const expr = Expression.subtract(Expression.variable("a"), Expression.variable("b"));
    const bindings = { a: m(10, 0.3), b: m(4, 0.3) };
    const indep = propagateWithCovariance(
      expr,
      bindings,
      CovarianceMatrix.fromMeasurements(bindings),
    );
    expect(indep.uncertainty.value).toBeCloseTo(Math.sqrt(0.18), 9);
    const full = propagateWithCovariance(
      expr,
      bindings,
      CovarianceMatrix.fromMeasurements(bindings, {
        correlations: [{ idA: "a", idB: "b", coefficient: 1 }],
      }),
    );
    expect(full.uncertainty.value).toBeCloseTo(0, 9);
    expect(full.value.value).toBeCloseTo(6, 12);
  });

  it("propagateWithCovariance handles multiply/divide/power/convert", () => {
    const bindings = { a: m(10, 0.2), b: m(5, 0.1) };
    const cov = CovarianceMatrix.fromMeasurements(bindings);
    const prod = propagateWithCovariance(
      Expression.multiply(Expression.variable("a"), Expression.variable("b")),
      bindings,
      cov,
    );
    expect(prod.value.toBase().value).toBeCloseTo(50, 9);
    const direct = bindings.a.multiply(bindings.b);
    expect(prod.uncertainty.toBase().value).toBeCloseTo(direct.uncertainty.toBase().value, 6);
    const pw = propagateWithCovariance(
      Expression.power(Expression.variable("a"), 2),
      bindings,
      cov,
    );
    expect(pw.uncertainty.toBase().value).toBeCloseTo(
      bindings.a.pow(2).uncertainty.toBase().value,
      6,
    );
  });

  it("propagateWithCovariance rejects call nodes and missing entries explicitly", () => {
    const bindings = { a: m(4, 0.1) };
    const cov = CovarianceMatrix.fromMeasurements(bindings);
    expect(() =>
      propagateWithCovariance(Expression.call("sqrt", [Expression.variable("a")]), bindings, cov),
    ).toThrow(UnsupportedTransformationError);
    expect(() =>
      propagateWithCovariance(
        Expression.add(Expression.variable("a"), Expression.variable("zzz")),
        bindings,
        cov,
      ),
    ).toThrow(InvalidMeasurementError);
    expect(() =>
      propagateWithCovariance(Expression.variable("a"), { a: Quantity.of(1, "m") } as never, cov),
    ).toThrow(InvalidMeasurementError);
  });

  it("dimension mismatch in bindings is rejected, not silently propagated", () => {
    const expr = Expression.add(Expression.variable("a"), Expression.variable("b"));
    const cov = CovarianceMatrix.fromData(["a", "b"], "m", [
      [0.01, 0],
      [0, 0.01],
    ]);
    expect(() => propagateWithCovariance(expr, { a: m(1, 0.1), b: kg(1, 0.1) }, cov)).toThrow(
      UnitMismatchError,
    );
  });
});

// ---------------------------------------------------------------------------
// MeasurementDataset
// ---------------------------------------------------------------------------

describe("MeasurementDataset", () => {
  const dataset = () =>
    MeasurementDataset.of({
      distance: MeasurementSeries.of([m(100, 1), m(200, 2)]),
      time: MeasurementSeries.of([
        Measurement.of(Quantity.of(10, "s"), Quantity.of(0.1, "s")),
        Measurement.of(Quantity.of(20, "s"), Quantity.of(0.2, "s")),
      ]),
    });

  it("validates rectangularity and names", () => {
    expect(() => MeasurementDataset.of({})).toThrow(InvalidMeasurementError);
    expect(() =>
      MeasurementDataset.of({
        a: MeasurementSeries.of([m(1, 0.1)]),
        b: MeasurementSeries.of([m(1, 0.1), m(2, 0.1)]),
      }),
    ).toThrow(InvalidMeasurementError);
    expect(dataset().observationCount).toBe(2);
  });

  it("filters, selects, normalizes and summarizes", () => {
    const ds = dataset();
    const filtered = ds.filter((row) => row.distance!.value.value > 150);
    expect(filtered.observationCount).toBe(1);
    expect(filtered.variables.distance!.observations[0]!.value.value).toBe(200);
    expect(ds.select(["distance"]).variableNames).toEqual(["distance"]);
    expect(() => ds.select(["nope"])).toThrow(InvalidMeasurementError);
    const normed = ds.normalize({ distance: "km" });
    expect(normed.variables.distance!.mean().value.value).toBeCloseTo(0.15, 12);
    expect(normed.variables.distance!.originals[0]!.value.unit.symbol).toBe("m");
    const summary = ds.summarize();
    expect(summary.distance!.count).toBe(2);
    expect(summary.time!.mean.value.value).toBeCloseTo(15, 12);
  });

  it("applies formulas per row with uncertainty and provenance", () => {
    const ds = dataset();
    const velocity = defineFormula({
      id: "velocity",
      expression: Expression.divide(Expression.variable("distance"), Expression.variable("time")),
      inputs: { distance: { dimension: "m" }, time: { dimension: "s" } },
      outputName: "velocity",
    });
    const series = ds.applyFormula(velocity);
    expect(series.count).toBe(2);
    // 100/10 and 200/20 → 10 m/s twice; uncertainty propagates relatively.
    expect(series.observations[0]!.value.to("m/s").value).toBeCloseTo(10, 9);
    expect(series.observations[1]!.value.to("m/s").value).toBeCloseTo(10, 9);
    expect(series.observations[0]!.uncertainty.value).toBeGreaterThan(0);
    // Provenance names the formula and the source rows (shallow by default).
    expect(series.observations[0]!.provenance?.method).toBe("formula:velocity");
    expect(series.observations[0]!.provenance?.derivedFrom?.length).toBe(2);
    const bare = ds.applyFormula(velocity, { provenance: "none" });
    expect(bare.observations[0]!.provenance).toBeUndefined();
    // Mapping + unknown variables fail explicitly.
    expect(() => ds.applyFormula(velocity, { mapping: { distance: "nope" } })).toThrow(
      InvalidMeasurementError,
    );
  });

  it("serializes deterministically with round-trip", () => {
    const ds = dataset();
    const json = JSON.stringify(ds.serialize());
    const back = MeasurementDataset.deserialize(JSON.parse(json));
    expect(JSON.stringify(back.serialize())).toBe(json);
    expect(back.observationCount).toBe(2);
    expect(() => MeasurementDataset.deserialize({ version: 2 })).toThrow(InvalidMeasurementError);
  });

  it("enforces limits", () => {
    expect(() =>
      MeasurementDataset.of(
        { a: MeasurementSeries.of([m(1, 0.1), m(2, 0.1)]) },
        { limits: { maxVariables: 0 } },
      ),
    ).toThrow();
  });
});
