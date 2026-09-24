/**
 * nutrition-context-errors.test.ts — Prompt 25 recovery tests.
 *
 * Proves MissingNutritionContextError / InvalidNutritionContextError are live
 * validation machinery (not dead exports):
 *  - missing context fails explicitly with the typed error (no silent NaN)
 *  - malformed context fails with the typed error
 *  - failed conversions never mutate the source object
 *  - valid contexts never trigger the errors
 */
import { describe, expect, it } from "vitest";
import { Measurement, Quantity } from "@vetwo/units";
import {
  NutritionMeasurement,
  NutritionQuantity,
  createNutritionContext,
  resolveDryMatterFraction,
  MissingNutritionContextError,
  InvalidNutritionContextError,
  NutritionContextError,
  InvalidNutritionBasisError,
} from "../src/index.js";

const ctx90 = () => createNutritionContext({ dryMatterFraction: 0.9 });

describe("MissingNutritionContextError — missing context fails explicitly", () => {
  it("is exported from the public entrypoint", () => {
    expect(typeof MissingNutritionContextError).toBe("function");
    expect(typeof InvalidNutritionContextError).toBe("function");
  });

  it("measurement basis conversion without context throws the typed error", () => {
    const nm = NutritionMeasurement.of(Measurement.exact(Quantity.of(10, "%")), "cp", "asFed");
    expect(() => nm.convertBasis("dryMatter")).toThrow(MissingNutritionContextError);
  });

  it("quantity basis conversion without context throws the typed error", () => {
    const nq = NutritionQuantity.of(Quantity.of(10, "%"), "cp", "asFed");
    expect(() => nq.convertBasis("dryMatter")).toThrow(MissingNutritionContextError);
  });

  it("resolveDryMatterFraction without context throws the typed error", () => {
    expect(() => resolveDryMatterFraction(undefined)).toThrow(MissingNutritionContextError);
    expect(() => resolveDryMatterFraction({} as never)).toThrow(MissingNutritionContextError);
  });

  it("failed conversion does not mutate the source object", () => {
    const nm = NutritionMeasurement.of(Measurement.exact(Quantity.of(10, "%")), "cp", "asFed");
    const before = nm.value.value;
    expect(() => nm.convertBasis("dryMatter")).toThrow();
    expect(nm.basis.id).toBe("asfed");
    expect(nm.value.value).toBe(before);
  });

  it("error message names the missing requirement", () => {
    try {
      resolveDryMatterFraction(undefined);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MissingNutritionContextError);
      expect((e as Error).message).toMatch(/dryMatterFraction|moistureFraction/);
    }
  });
});

describe("InvalidNutritionContextError — malformed context fails explicitly", () => {
  it("non-object context is invalid", () => {
    expect(() => createNutritionContext(null as never)).toThrow(InvalidNutritionContextError);
    expect(() => createNutritionContext([] as never)).toThrow(InvalidNutritionContextError);
    expect(() => createNutritionContext("0.9" as never)).toThrow(InvalidNutritionContextError);
  });

  it("forbidden prototype keys are invalid", () => {
    const evil = JSON.parse('{"__proto__":{"x":1},"dryMatterFraction":0.9}');
    expect(() => createNutritionContext(evil)).toThrow(InvalidNutritionContextError);
  });

  it("inconsistent DM + moisture is invalid", () => {
    expect(() => createNutritionContext({ dryMatterFraction: 0.9, moistureFraction: 0.2 })).toThrow(
      InvalidNutritionContextError,
    );
  });

  it("non-Measurement dryMatterMeasurement is invalid", () => {
    expect(() => createNutritionContext({ dryMatterMeasurement: { nope: true } as never })).toThrow(
      InvalidNutritionContextError,
    );
  });

  it("empty sampleState is invalid", () => {
    expect(() => createNutritionContext({ sampleState: "   " })).toThrow(
      InvalidNutritionContextError,
    );
  });

  it("non-object metadata is invalid", () => {
    expect(() => createNutritionContext({ metadata: [] as never })).toThrow(
      InvalidNutritionContextError,
    );
  });

  it("invalid type stays inside the NutritionContextError hierarchy", () => {
    try {
      createNutritionContext(null as never);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidNutritionContextError);
      expect(e).toBeInstanceOf(NutritionContextError);
    }
  });

  it("out-of-range fractions still raise basis errors (no silent clamp)", () => {
    expect(() => createNutritionContext({ dryMatterFraction: 0 })).toThrow(
      InvalidNutritionBasisError,
    );
    expect(() => createNutritionContext({ dryMatterFraction: 1.5 })).toThrow(
      InvalidNutritionBasisError,
    );
    expect(() => createNutritionContext({ dryMatterFraction: Number.NaN })).toThrow(
      NutritionContextError,
    );
  });
});

describe("valid context — errors are not triggered incorrectly", () => {
  it("DM-only context resolves and converts", () => {
    const ctx = createNutritionContext({ dryMatterFraction: 0.9 });
    expect(ctx.resolvedDryMatterFraction).toBeCloseTo(0.9, 12);
    expect(ctx.resolvedMoistureFraction).toBeCloseTo(0.1, 12);
    const nm = NutritionMeasurement.of(Measurement.exact(Quantity.of(9, "%")), "cp", "asFed");
    const dm = nm.convertBasis("dryMatter", ctx);
    expect(dm.basis.id).toBe("drymatter");
    expect(dm.value.value).toBeCloseTo(10, 9);
  });

  it("moisture-only context derives DM", () => {
    const ctx = createNutritionContext({ moistureFraction: 0.1 });
    expect(ctx.resolvedDryMatterFraction).toBeCloseTo(0.9, 12);
  });

  it("context objects are frozen", () => {
    expect(Object.isFrozen(ctx90())).toBe(true);
  });
});
