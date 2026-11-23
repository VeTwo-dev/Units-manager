/**
 * public-surface.test.ts — Prompt 25 §24 public-API consumer test.
 *
 * Imports ONLY the published package name (self-reference → built dist),
 * proving the shipped artifact exposes the recovered APIs where intended.
 * Run after build (turbo `test` depends on `^build`).
 */
import { describe, expect, it } from "vitest";
import {
  InvalidNutritionContextError,
  MissingNutritionContextError,
  NutritionMeasurement,
  NutritionSample,
  createNutritionContext,
  type NutritionMeasurementOptions,
  type NutritionSampleOptions,
} from "@vetwo/nutrition-units";
import { Measurement, Quantity } from "@vetwo/units";

describe("public surface via package name", () => {
  it("recovered errors, options, and facades resolve from dist", () => {
    expect(typeof MissingNutritionContextError).toBe("function");
    expect(typeof InvalidNutritionContextError).toBe("function");
    const mOpts: NutritionMeasurementOptions = {
      context: createNutritionContext({ dryMatterFraction: 0.9 }),
    };
    const nm = NutritionMeasurement.of(
      Measurement.exact(Quantity.of(50, "mg/kg")),
      "ca",
      "asFed",
      mOpts,
    );
    const sOpts: NutritionSampleOptions = { id: "pub-1", measurements: [nm] };
    const s = new NutritionSample(sOpts);
    expect(s.measurements).toHaveLength(1);
    const back = NutritionSample.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(back.id).toBe("pub-1");
  });
});
