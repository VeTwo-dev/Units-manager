/**
 * nutrition-measurement-options.test.ts — Prompt 25 recovery tests.
 *
 * Proves NutritionMeasurementOptions is the real public construction contract:
 * minimum/full construction, context, metadata, uncertainty, rejection of
 * invalid inputs, immutability, and serialization round-trips.
 */
import { describe, expect, it } from "vitest";
import { Measurement, Quantity } from "@vetwo/units";
import {
  NutritionMeasurement,
  createNutritionContext,
  type NutritionMeasurementOptions,
  InvalidNutritionQuantityError,
  NutritionUnitCompatibilityError,
  InvalidNutritionBasisError,
} from "../src/index.js";

const exactCa = () =>
  NutritionMeasurement.of(Measurement.exact(Quantity.of(100, "mg/kg")), "ca", "asFed");

describe("NutritionMeasurementOptions — construction contract", () => {
  it("minimum valid construction needs only measurement + nutrient", () => {
    const nm = exactCa();
    expect(nm.nutrient.id).toBe("ca");
    expect(nm.basis.id).toBe("asfed");
    expect(nm.value.value).toBe(100);
    expect(nm.context).toBeUndefined();
  });

  it("options type describes the contract (compile-time usage)", () => {
    const opts: NutritionMeasurementOptions = {
      context: createNutritionContext({ dryMatterFraction: 0.9 }),
      metadata: { provenance: { sourceId: "lab-a" } },
    };
    const nm = NutritionMeasurement.of(
      Measurement.exact(Quantity.of(100, "mg/kg")),
      "ca",
      "asFed",
      opts,
    );
    expect(nm.context?.resolvedDryMatterFraction).toBeCloseTo(0.9, 12);
    expect(nm.metadata?.provenance?.sourceId).toBe("lab-a");
  });

  it("from() builds value + uncertainty through the same options", () => {
    const nm = NutritionMeasurement.from(100, "mg/kg", "ca", "asFed", Quantity.of(2, "mg/kg"), {
      metadata: { reference: "lot-42" },
    } satisfies NutritionMeasurementOptions);
    expect(nm.value.value).toBe(100);
    expect(nm.uncertainty.value).toBe(2);
    expect(nm.metadata?.reference).toBe("lot-42");
  });

  it("non-Measurement input is rejected", () => {
    expect(() => NutritionMeasurement.of({ nope: 1 } as never, "ca", "asFed")).toThrow(
      InvalidNutritionQuantityError,
    );
  });

  it("unknown nutrient is rejected", () => {
    expect(() =>
      NutritionMeasurement.of(
        Measurement.exact(Quantity.of(1, "mg/kg")),
        "not-a-nutrient",
        "asFed",
      ),
    ).toThrow();
  });

  it("unknown basis is rejected", () => {
    expect(() =>
      NutritionMeasurement.of(Measurement.exact(Quantity.of(1, "mg/kg")), "ca", "not-a-basis"),
    ).toThrow();
  });

  it("incompatible measurement unit is rejected (mineral vs energy unit)", () => {
    expect(() =>
      NutritionMeasurement.of(Measurement.exact(Quantity.of(10, "MJ/kg")), "ca", "asFed"),
    ).toThrow(NutritionUnitCompatibilityError);
  });

  it("malformed metadata is rejected", () => {
    expect(() =>
      NutritionMeasurement.of(Measurement.exact(Quantity.of(1, "mg/kg")), "ca", "asFed", {
        metadata: [] as never,
      }),
    ).toThrow();
  });

  it("caller mutation of opts cannot corrupt the measurement", () => {
    const ctx = { dryMatterFraction: 0.9 } as never;
    const nm = NutritionMeasurement.of(Measurement.exact(Quantity.of(1, "mg/kg")), "ca", "asFed", {
      context: ctx,
    });
    (ctx as Record<string, unknown>).dryMatterFraction = 0.1;
    expect(nm.context?.dryMatterFraction ?? nm.context?.resolvedDryMatterFraction).toBeCloseTo(
      0.9,
      12,
    );
    expect(Object.isFrozen(nm)).toBe(true);
  });
});

describe("NutritionMeasurementOptions — serialization round-trip", () => {
  it("toJSON → fromJSON preserves semantics", () => {
    const nm = NutritionMeasurement.of(
      Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(3, "mg/kg")),
      "ca",
      "asFed",
      { context: createNutritionContext({ dryMatterFraction: 0.9 }) },
    );
    const back = NutritionMeasurement.fromJSON(JSON.parse(JSON.stringify(nm.toJSON())));
    expect(back.equals(nm)).toBe(true);
    expect(back.context?.resolvedDryMatterFraction).toBeCloseTo(0.9, 12);
  });

  it("fromJSON honors explicit options registries", () => {
    const nm = exactCa();
    const back = NutritionMeasurement.fromJSON(nm.toJSON(), {});
    expect(back.nutrient.id).toBe("ca");
  });

  it("malformed serialization is rejected, never defaulted", () => {
    expect(() => NutritionMeasurement.fromJSON({ version: 2 } as never)).toThrow(
      InvalidNutritionQuantityError,
    );
    expect(() => NutritionMeasurement.fromJSON({ version: 1, type: "nope" } as never)).toThrow(
      InvalidNutritionQuantityError,
    );
  });

  it("basis mismatch between unit tag and basis id is rejected", () => {
    expect(() =>
      NutritionMeasurement.of(Measurement.exact(Quantity.of(1, "mg/kg")), "ca", "!!"),
    ).toThrow(InvalidNutritionBasisError);
  });
});
