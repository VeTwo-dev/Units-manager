/**
 * nutrition-uncertainty.test.ts — Phase 9: measurement uncertainty via core Measurement
 */
import { describe, expect, it } from "vitest";
import { Quantity, Measurement } from "@vetwo/units";
import { NutritionMeasurement, createNutritionContext } from "../src/index.js";

describe("phase9 — uncertainty construction", () => {
  it("without uncertainty (exact)", () => {
    const m = NutritionMeasurement.of(Measurement.exact(Quantity.of(100, "mg/kg")), "ca", "asFed");
    expect(m.uncertainty.value).toBe(0);
  });

  it("with absolute uncertainty", () => {
    const meas = Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(5, "mg/kg"));
    const nm = NutritionMeasurement.of(meas, "ca", "asFed");
    expect(nm.uncertainty.value).toBe(5);
    expect(nm.value.value).toBe(100);
  });

  it("with relative uncertainty", () => {
    const meas = Measurement.of(Quantity.of(100, "mg/kg"), 0.05); // 5%
    const nm = NutritionMeasurement.of(meas, "ca", "asFed");
    expect(nm.uncertainty.value).toBeCloseTo(5, 9);
  });

  it("rejects negative, NaN, Infinity uncertainty via core", () => {
    expect(() => Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(-5, "mg/kg"))).toThrow();
    expect(() => Measurement.of(Quantity.of(100, "mg/kg"), NaN as never)).toThrow();
    expect(() => Measurement.of(Quantity.of(100, "mg/kg"), Infinity as never)).toThrow();
    expect(() =>
      NutritionMeasurement.of(
        Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(-1, "mg/kg")) as never,
        "ca",
        "asFed",
      ),
    ).toThrow();
  });
});

describe("phase9 — uncertainty unit conversion", () => {
  it("mg/kg ± 50 → g/kg ± 0.05 preserves uncertainty", () => {
    const meas = Measurement.of(Quantity.of(1000, "mg/kg"), Quantity.of(50, "mg/kg"));
    const nm = NutritionMeasurement.of(meas, "ca", "asFed");
    const converted = nm.to("g/kg");
    expect(converted.value.value).toBeCloseTo(1, 9);
    expect(converted.uncertainty.value).toBeCloseTo(0.05, 9);
  });

  it("round-trip preserves uncertainty", () => {
    const meas = Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(5, "mg/kg"));
    const nm = NutritionMeasurement.of(meas, "ca", "asFed");
    const back = nm.to("g/kg").to("mg/kg");
    expect(back.value.value).toBeCloseTo(100, 9);
    expect(back.uncertainty.value).toBeCloseTo(5, 9);
  });
});

describe("phase9 — uncertainty + basis conversion", () => {
  it("scales uncertainty deterministically via DM fraction", () => {
    const meas = Measurement.of(Quantity.of(100, "g/kg"), Quantity.of(5, "g/kg"));
    const nm = NutritionMeasurement.of(meas, "cp", "asFed");
    const ctx = createNutritionContext({ dryMatterFraction: 0.5 });
    const dm = nm.convertBasis("dryMatter", ctx);
    // C_DM = C_AF / 0.5 = 200, sigma_DM = 5 /0.5 =10
    expect(dm.value.value).toBeCloseTo(200, 9);
    expect(dm.uncertainty.value).toBeCloseTo(10, 9);
    expect(dm.basis.id).toBe("drymatter");
  });

  it("uncertain DM fraction currently handled as exact (documented limitation) — does not silently include DM uncertainty", () => {
    // If DM itself had uncertainty, our current convertBasis uses exact DM fraction (number)
    // So it scales but does not propagate DM uncertainty — we document this
    const meas = Measurement.of(Quantity.of(100, "g/kg"), Quantity.of(5, "g/kg"));
    const nm = NutritionMeasurement.of(meas, "cp", "asFed");
    // Create context with DM 0.88 exact, not uncertain Measurement
    const ctx = createNutritionContext({ dryMatterFraction: 0.88 });
    const dm = nm.convertBasis("dryMatter", ctx);
    // Uncertainty should be 5/0.88
    expect(dm.uncertainty.value).toBeCloseTo(5 / 0.88, 9);
  });
});

describe("phase9 — comparison safety with uncertainty", () => {
  it("compatible nutrient comparison works", () => {
    const a = NutritionMeasurement.of(
      Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(5, "mg/kg")),
      "ca",
      "asFed",
    );
    const b = NutritionMeasurement.of(
      Measurement.of(Quantity.of(110, "mg/kg"), Quantity.of(4, "mg/kg")),
      "ca",
      "asFed",
    );
    expect(a.compare(b)).toBe(-1);
    expect(b.compare(a)).toBe(1);
  });

  it("incompatible nutrient comparison throws", () => {
    const ca = NutritionMeasurement.of(
      Measurement.of(Quantity.of(100, "mg/kg"), 0.05),
      "ca",
      "asFed",
    );
    const p = NutritionMeasurement.of(Measurement.exact(Quantity.of(100, "mg/kg")), "p", "asFed");
    expect(() => ca.compare(p)).toThrow();
  });
});

describe("phase9 — metadata + uncertainty coexistence", () => {
  it("uncertainty and metadata coexist", () => {
    const meta = { sample: { sampleId: "S1" }, method: { id: "M1" } } as never;
    const nm = NutritionMeasurement.of(
      Measurement.of(Quantity.of(100, "mg/kg"), 0.05),
      "ca",
      "asFed",
      { metadata: meta },
    );
    expect(nm.uncertainty.value).toBeCloseTo(5, 9);
    expect(nm.metadata?.sample?.sampleId).toBe("S1");
  });
});

describe("phase9 — serialization preserves uncertainty", () => {
  it("round-trip preserves value, unit, nutrient, basis, uncertainty", () => {
    const meas = Measurement.of(Quantity.of(250, "mg/kg"), Quantity.of(10, "mg/kg"));
    const nm = NutritionMeasurement.of(meas, "ca", "asFed");
    const json = JSON.stringify(nm.toJSON());
    const back = NutritionMeasurement.fromJSON(JSON.parse(json));
    expect(back.equals(nm)).toBe(true);
    expect(back.uncertainty.value).toBeCloseTo(10, 9);
  });
});
