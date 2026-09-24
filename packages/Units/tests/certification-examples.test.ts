/**
 * certification-examples.test.ts — Prompt 18 §§12–13: end-to-end scientific
 * example suite across diverse workloads + the full cross-subsystem chain.
 *
 * Not domain expansion: each example verifies the GENERIC engine on a
 * different scientific workload with hand-derived references. Respects the
 * documented engine models (E-dimension energy family, affine temperature).
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Measurement,
  MeasurementSeries,
  parseUnit,
  dimensionsEqual,
  createRegistry,
  SI_PACK,
  ANGLE_PACK,
  RADIATION_PACK,
  INFORMATION_PACK,
  CGS_PACK,
  defineFormula,
  evaluateFormula,
  Expression,
  createStandardConstantRegistry,
  normalizeToSystem,
  CGS_SYSTEM,
  serializeQuantity,
  deserializeQuantity,
  serializeMeasurement,
  deserializeMeasurement,
  DIMENSIONLESS,
} from "../src/index.js";

function close(actual: number, expected: number, tol = 1e-9): void {
  const denom = Math.max(1e-300, Math.abs(actual), Math.abs(expected));
  expect(Math.abs(actual - expected) / denom).toBeLessThan(tol);
}

const si = () => createRegistry({ packs: [SI_PACK] });

// ---------------------------------------------------------------------------
// Mechanics
// ---------------------------------------------------------------------------

describe("prompt18 §12: mechanics", () => {
  it("velocity, acceleration, force, pressure, energy, power", () => {
    const r = si();
    // v = 100 m / 9.58 s ≈ 10.4384 m/s ≈ 37.578 km/h (hand: 100/9.58).
    const v = Quantity.of(100, "m", r).divide(Quantity.of(9.58, "s", r));
    close(v.to("m/s", r).value, 100 / 9.58, 1e-12);
    close(v.to("km/h", r).value, (100 / 9.58) * 3.6, 1e-9);
    // a = Δv/Δt: (10 − 0) m/s in 2 s = 5 m/s².
    const a = Quantity.of(10, "m/s", r)
      .subtract(Quantity.of(0, "m/s", r))
      .divide(Quantity.of(2, "s", r));
    close(a.to("m/s^2", r).value, 5, 1e-12);
    // F = ma: 1500 kg × 3 m/s² = 4500 N, dimension M·L·T⁻².
    const F = Quantity.of(1500, "kg", r).multiply(Quantity.of(3, "m/s^2", r));
    expect(dimensionsEqual(F.dimension, { M: 1, L: 1, T: -2 })).toBe(true);
    close(F.to("N", r).value, 4500, 1e-9);
    // p = F/A: 4500 N / 2 m² = 2250 Pa.
    close(F.divide(Quantity.of(2, "m^2", r)).to("Pa", r).value, 2250, 1e-9);
    // E = ½mv²: 0.5 × 2 × 10² = 100 N·m (mechanical energy unit).
    const E = Quantity.of(2, "kg", r)
      .multiply(Quantity.of(10, "m/s", r).pow(2))
      .multiply(0.5);
    close(E.to("N*m", r).value, 100, 1e-9);
    // P = F·d/t: 100 N × 5 m / 2 s = 250 N·m/s, dimension M·L²·T⁻³.
    const P = Quantity.of(100, "N", r)
      .multiply(Quantity.of(5, "m", r))
      .divide(Quantity.of(2, "s", r));
    expect(dimensionsEqual(P.dimension, { M: 1, L: 2, T: -3 })).toBe(true);
    close(P.to("N*m/s", r).value, 250, 1e-9);
  });
});

// ---------------------------------------------------------------------------
// Thermodynamics
// ---------------------------------------------------------------------------

describe("prompt18 §12: thermodynamics", () => {
  it("absolute temperatures, intervals, and heat in the E-world", () => {
    const r = si();
    close(Quantity.of(100, "°C", r).to("K", r).value, 373.15, 1e-9);
    // ΔT = 80 °C − 20 °C = 60 K interval.
    const dT = Quantity.of(80, "°C", r).subtract(Quantity.of(20, "°C", r));
    close(dT.value, 60, 1e-9);
    // Q = mcΔT = 2 kg × 4184 J/(kg·K) × 60 K = 502080 J (E-world chain).
    const c = Quantity.of(4184, "J/(kg*K)", r);
    const Q = Quantity.of(2, "kg", r).multiply(c).multiply(dT);
    expect(dimensionsEqual(Q.dimension, { E: 1 })).toBe(true);
    close(Q.to("J", r).value, 502080, 1e-6);
    close(Q.to("kJ", r).value, 502.08, 1e-9);
  });
});

// ---------------------------------------------------------------------------
// Electricity (E-world: V·A = W is internally consistent)
// ---------------------------------------------------------------------------

describe("prompt18 §12: electricity", () => {
  it("charge, voltage, resistance, power", () => {
    const r = si();
    // Q = It: 2 A × 30 s = 60 C.
    const Q = Quantity.of(2, "A", r).multiply(Quantity.of(30, "s", r));
    close(Q.to("C", r).value, 60, 1e-9);
    // V = E/Q: 120 J / 60 C = 2 V.
    close(Quantity.of(120, "J", r).divide(Q).to("V", r).value, 2, 1e-9);
    // R = V/I: 12 V / 2 A = 6 Ω.
    close(
      Quantity.of(12, "V", r)
        .divide(Quantity.of(2, "A", r))
        .to("ohm", r).value,
      6,
      1e-9,
    );
    // P = VI: 12 V × 2 A = 24 W; 24 W × 3600 s = 86400 J.
    const P = Quantity.of(12, "V", r).multiply(Quantity.of(2, "A", r));
    close(P.to("W", r).value, 24, 1e-9);
    close(P.multiply(Quantity.of(3600, "s", r)).to("J", r).value, 86400, 1e-6);
  });

  it("compositional identities: derived units equal constituent compositions", () => {
    // Prompt-18 regression: each derived E-electrical unit must convert 1:1
    // with its hand-written composition. A drifted base factor (the old
    // V = Ω = S = W = 1 clique) fails here while same-clique pairs pass —
    // reciprocal round-trips alone cannot catch absolute-scale errors.
    const r = si();
    const identities: Array<[string, string]> = [
      ["V", "J/(A*s)"],
      ["W", "J/s"],
      ["ohm", "V/A"],
      ["S", "A/V"],
      ["F", "C/V"],
      ["Wb", "V*s"],
      ["H", "Wb/A"],
      ["Wh", "W*h"],
      ["N", "kg*m/s^2"],
      ["Pa", "N/m^2"],
      ["Hz", "s^-1"],
    ];
    for (const [named, composed] of identities) {
      const fwd = Quantity.of(1, named, r).to(composed, r).value;
      const rev = Quantity.of(1, composed, r).to(named, r).value;
      close(fwd, 1, 1e-9);
      close(rev, 1, 1e-9);
    }
  });
});

// ---------------------------------------------------------------------------
// Chemistry
// ---------------------------------------------------------------------------

describe("prompt18 §12: chemistry", () => {
  it("amount, Avogadro count, concentration, molar volume", () => {
    const r = si();
    // N = n·N_A: 2 mol → 1.204428152e24 entities (dimensionless count).
    // The constant's quantity (mol⁻¹) — not its bare number — cancels Substance.
    const std = createStandardConstantRegistry();
    const NA = std.require("avogadroConstant").quantity;
    const N = Quantity.of(2, "mol", r).multiply(NA);
    expect(dimensionsEqual(N.dimension, DIMENSIONLESS)).toBe(true);
    close(N.value, 2 * 6.02214076e23, 1e-12);
    // c = n/V: 0.5 mol / 2 L = 0.25 mol/L; 1 L = 0.001 m³.
    close(Quantity.of(1, "L", r).to("m^3", r).value, 0.001, 1e-12);
    const c = Quantity.of(0.5, "mol", r).divide(Quantity.of(2, "L", r));
    close(c.to("mol/L", r).value, 0.25, 1e-12);
    // m = n·M: 2 mol × 18 g/mol = 36 g = 0.036 kg.
    close(
      Quantity.of(2, "mol", r)
        .multiply(Quantity.of(18, "g/mol", r))
        .to("g", r).value,
      36,
      1e-9,
    );
  });
});

// ---------------------------------------------------------------------------
// Fluid mechanics
// ---------------------------------------------------------------------------

describe("prompt18 §12: fluid mechanics", () => {
  it("density, volume flow, mass flow, dynamic pressure", () => {
    const r = si();
    // ρ = 1000 kg/m³; Q = Av = 0.01 m² × 2 m/s = 0.02 m³/s.
    const Q = Quantity.of(0.01, "m^2", r).multiply(Quantity.of(2, "m/s", r));
    close(Q.to("m^3/s", r).value, 0.02, 1e-12);
    // ṁ = ρQ = 20 kg/s.
    close(Quantity.of(1000, "kg/m^3", r).multiply(Q).to("kg/s", r).value, 20, 1e-9);
    // ΔP = ½ρv² = 0.5 × 1000 × 4 = 2000 Pa.
    const dP = Quantity.of(1000, "kg/m^3", r)
      .multiply(Quantity.of(2, "m/s", r).pow(2))
      .multiply(0.5);
    close(dP.to("Pa", r).value, 2000, 1e-9);
  });
});

// ---------------------------------------------------------------------------
// Optics / radiation / time / information (where supported)
// ---------------------------------------------------------------------------

describe("prompt18 §12: optics, radiation, time, information", () => {
  it("wavelength from c = λf; dose prefixes; time and data units", () => {
    const r = si();
    // λ = c/f: 299792458 / 5e14 = 5.99584916e-7 m (hand arithmetic).
    const std = createStandardConstantRegistry();
    const c = std.require("speedOfLight").quantity.value;
    close(
      Quantity.of(c, "m/s", r)
        .divide(Quantity.of(5e14, "Hz", r))
        .to("m", r).value,
      c / 5e14,
      1e-9,
    );
    // Angle: π/2 rad is dimensionless-adjacent but parsed and convertible.
    const ang = createRegistry({ packs: [SI_PACK, ANGLE_PACK] });
    close(Quantity.of(180, "deg", ang).to("rad", ang).value, Math.PI, 1e-12);
    // Radiation: 2 Gy + 500 mGy = 2.5 Gy (E·M⁻¹ preserved).
    const rad2 = createRegistry({ packs: [SI_PACK, RADIATION_PACK] });
    const dose = Quantity.of(2, "Gy", rad2).add(Quantity.of(500, "mGy", rad2));
    close(dose.to("Gy", rad2).value, 2.5, 1e-12);
    expect(dimensionsEqual(dose.dimension, { E: 1, M: -1 })).toBe(true);
    // Decay rate: 1 GBq = 1000 MBq, dimension T⁻¹.
    const act = Quantity.of(1, "GBq", rad2);
    expect(dimensionsEqual(act.dimension, { T: -1 })).toBe(true);
    close(act.to("MBq", rad2).value, 1000, 1e-12);
    // Time: 1 day = 86400 s; 2 h + 30 min = 9000 s.
    close(Quantity.of(1, "day").to("s").value, 86400, 1e-12);
    close(Quantity.of(2, "h").add(Quantity.of(30, "min")).to("s").value, 9000, 1e-12);
    // Information: 1 byte = 8 bit; 1 kB message = 8000 bit.
    const info = createRegistry({ packs: [INFORMATION_PACK] });
    close(Quantity.of(1, "byte", info).to("bit", info).value, 8, 1e-12);
    close(Quantity.of(1, "kB", info).to("bit", info).value, 8000, 1e-12);
  });
});

// ---------------------------------------------------------------------------
// Parser: the dimensionless identity "1" (regression)
// ---------------------------------------------------------------------------

describe("prompt18 §8: dimensionless identity parses", () => {
  it("emitted '(1)' symbols re-parse; only the exact token '1' is accepted", () => {
    const r = si();
    // The engine emits "(1)·(kg)"-style symbols (literal folding); they must
    // re-parse so serialization round-trips (Prompt-18 fix).
    for (const text of ["1", "(1)", "1/m", "m/1", "1*m", "(1)·((kg)·((m/s)^2))"]) {
      const u = parseUnit(text, r);
      const again = parseUnit(u.symbol, r);
      expect(dimensionsEqual(again.dimension, u.dimension)).toBe(true);
    }
    expect(dimensionsEqual(parseUnit("1", r).dimension, DIMENSIONLESS)).toBe(true);
    // Implicit multiplication applies uniformly: "1 m" is 1·m = m.
    expect(dimensionsEqual(parseUnit("1 m", r).dimension, { L: 1 })).toBe(true);
    // Anything else numeric still throws: no silent acceptance of "2/m",
    // "-1", "01" or decimals.
    for (const bad of ["2", "2/m", "-1", "01", "1.0", "m/0"]) {
      expect(() => parseUnit(bad, r), bad).toThrow();
    }
    // "m1" keeps its documented exponent reading (m^1), unchanged.
    expect(dimensionsEqual(parseUnit("m1", r).dimension, { L: 1 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §13 — Cross-subsystem integration chain
// ---------------------------------------------------------------------------

describe("prompt18 §13: full subsystem chain", () => {
  it("parser → unit → dimension → quantity → conversion → formula → measurement → statistics → system → serialization", () => {
    const r = createRegistry({ packs: [SI_PACK, CGS_PACK] });
    // 1. Parser → Unit → Dimension.
    const unit = parseUnit("kg*m/s^2", r);
    expect(dimensionsEqual(unit.dimension, { M: 1, L: 1, T: -2 })).toBe(true);
    // 2. Quantity → Conversion (weight = 9.8 m/s² × 10 kg = 98 N).
    const weight = Quantity.of(9.8, "m/s^2", r).multiply(Quantity.of(10, "kg", r));
    close(weight.to("N", r).value, 98, 1e-9);
    // 3. Formula with a standard constant.
    const E = Expression;
    const std = createStandardConstantRegistry();
    const f = defineFormula(
      {
        id: "chainke",
        expression: E.multiply(
          E.literal(0.5, "1"),
          E.multiply(E.variable("m"), E.power(E.variable("v"), 2)),
        ),
        inputs: { m: { dimension: "kg" }, v: { dimension: "m/s" } },
        constants: { c: std.require("speedOfLight") },
      },
      { registry: r },
    );
    const ke = evaluateFormula(
      f,
      { m: Quantity.of(2, "kg"), v: Quantity.of(3, "m/s") },
      { registry: r },
    );
    if (!(ke instanceof Quantity)) throw new Error("expected Quantity");
    close(ke.to("N*m", r).value, 9, 1e-9);
    // 4. Measurement with uncertainty → 5. Series statistics.
    const series = MeasurementSeries.of([
      Measurement.of(Quantity.of(9, "N*m", r), Quantity.of(0.3, "N*m", r)),
      Measurement.of(Quantity.of(9.6, "N*m", r), Quantity.of(0.3, "N*m", r)),
      Measurement.of(Quantity.of(8.4, "N*m", r), Quantity.of(0.3, "N*m", r)),
    ]);
    close(series.mean().value.value, 9, 1e-12);
    // 6. Unit-system normalization preserves physics (10 m → 1000 cm).
    const norm = normalizeToSystem(Quantity.of(10, "m", r), CGS_SYSTEM, { registry: r });
    expect(norm.unit.symbol).toBe("cm");
    close(norm.value, 1000, 1e-12);
    // 7. Serialization round-trip preserves value, unit and uncertainty
    // (decoders take the ambient registry explicitly — never ambient magic).
    const m = Measurement.of(ke, Quantity.of(0.5, "N*m", r));
    const back = deserializeMeasurement(JSON.parse(JSON.stringify(serializeMeasurement(m))), r);
    expect(back.value.exactEquals(m.value)).toBe(true);
    expect(back.uncertainty.exactEquals(m.uncertainty)).toBe(true);
    const qback = deserializeQuantity(JSON.parse(JSON.stringify(serializeQuantity(ke))), r);
    expect(qback.exactEquals(ke)).toBe(true);
  });
});
