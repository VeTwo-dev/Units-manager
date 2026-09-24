/**
 * Consumer application test — imports ONLY public package names
 * (@vetwo/units, @vetwo/nutrition-units), never workspace source paths.
 * Verifies the demo builds on the real public API, is deterministic,
 * converts correctly, round-trips, and surfaces typed validation errors.
 */
import { describe, expect, it } from "vitest";
import {
  InvalidNutritionContextError,
  MissingNutritionContextError,
  type NutritionMeasurementOptions,
  type NutritionSampleOptions,
} from "@vetwo/nutrition-units";
import { runDemo } from "../src/index.js";

describe("nutrition-units-example consumer", () => {
  it("recovered option types are importable from the public entrypoint", () => {
    const mo: NutritionMeasurementOptions = {};
    const so: NutritionSampleOptions = { id: "type-probe" };
    expect(mo).toEqual({});
    expect(so.id).toBe("type-probe");
    expect(typeof MissingNutritionContextError).toBe("function");
    expect(typeof InvalidNutritionContextError).toBe("function");
  });

  it("produces the deterministic report", () => {
    const a = runDemo();
    const b = runDemo();
    expect(a.report).toBe(b.report);
    expect(a.report).toBe(
      [
        "sample consumer-demo-001 (2 measurements)",
        "Ca 100.0 mg/kg asFed = 0.1 g/kg asFed",
        "CP 9.0 % asFed = 10.0 % DM",
        "round-trip ok",
      ].join("\n"),
    );
  });

  it("converts units and basis correctly", () => {
    const r = runDemo();
    expect(r.calciumMgPerKgAsFed).toBe(100);
    expect(r.calciumGPerKgAsFed).toBeCloseTo(0.1, 12);
    expect(r.proteinPctDryMatter).toBeCloseTo(10, 9);
    expect(r.sampleSize).toBe(2);
    expect(r.roundTripEqual).toBe(true);
  });

  it("handles both failure modes with typed errors", () => {
    const r = runDemo();
    expect(r.failures).toHaveLength(2);
    expect(r.failures[0]?.errorName).toBe("MissingNutritionContextError");
    expect(r.failures[1]?.errorName).toBe("InvalidNutritionContextError");
  });
});
