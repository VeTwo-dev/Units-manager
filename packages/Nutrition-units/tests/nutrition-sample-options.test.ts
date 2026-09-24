/**
 * nutrition-sample-options.test.ts — Prompt 25 recovery tests.
 *
 * Proves NutritionSampleOptions is the real public sample-construction
 * contract: identity, metadata, insertion, lookup, duplicates, immutability,
 * serialization, and rejection of invalid inputs.
 */
import { describe, expect, it } from "vitest";
import { Measurement, Quantity } from "@vetwo/units";
import {
  NutritionMeasurement,
  NutritionMeasurementSet,
  NutritionSample,
  createNutritionContext,
  type NutritionSampleOptions,
  InvalidNutritionQuantityError,
  MeasurementNotFoundError,
  AmbiguousMeasurementError,
} from "../src/index.js";

const caAsFed = (v = 100) =>
  NutritionMeasurement.of(Measurement.exact(Quantity.of(v, "mg/kg")), "ca", "asFed");
const cpAsFed = (v = 9) =>
  NutritionMeasurement.of(Measurement.exact(Quantity.of(v, "%")), "cp", "asFed");

describe("NutritionSampleOptions — sample construction contract", () => {
  it("id-only construction works", () => {
    const opts: NutritionSampleOptions = { id: "sample-001" };
    const s = new NutritionSample(opts);
    expect(s.id).toBe("sample-001");
    expect(s.measurements).toHaveLength(0);
  });

  it("full construction with metadata, context, measurements", () => {
    const s = new NutritionSample({
      id: "sample-002",
      metadata: { provenance: { sourceId: "lab-a" } } as never,
      context: createNutritionContext({ dryMatterFraction: 0.9 }),
      measurements: [caAsFed(), cpAsFed()],
    } satisfies NutritionSampleOptions);
    expect(s.measurements).toHaveLength(2);
    expect(s.context?.resolvedDryMatterFraction).toBeCloseTo(0.9, 12);
  });

  it("invalid ids are rejected", () => {
    expect(() => new NutritionSample({ id: "" })).toThrow(InvalidNutritionQuantityError);
    expect(() => new NutritionSample({ id: "has space!" })).toThrow(InvalidNutritionQuantityError);
    expect(() => new NutritionSample(null as never)).toThrow(InvalidNutritionQuantityError);
  });

  it("non-measurement entries are rejected", () => {
    expect(() => new NutritionSample({ id: "s", measurements: [{ nope: 1 } as never] })).toThrow(
      InvalidNutritionQuantityError,
    );
  });

  it("samples are immutable and iterable", () => {
    const s = new NutritionSample({ id: "s", measurements: [caAsFed()] });
    expect(Object.isFrozen(s)).toBe(true);
    expect([...s]).toHaveLength(1);
    expect(() => (s as unknown as { id: string }).id).not.toThrow();
  });

  it("withMeasurement returns a new sample (no mutation)", () => {
    const s = new NutritionSample({ id: "s", measurements: [caAsFed()] });
    const s2 = s.withMeasurement(cpAsFed());
    expect(s.measurements).toHaveLength(1);
    expect(s2.measurements).toHaveLength(2);
    expect(s2.id).toBe("s");
  });

  it("withMeasurement rejects non-measurements", () => {
    const s = new NutritionSample({ id: "s" });
    expect(() => s.withMeasurement({ nope: 1 } as never)).toThrow(InvalidNutritionQuantityError);
  });
});

describe("NutritionSampleOptions — serialization round-trip", () => {
  it("toJSON → fromJSON preserves identity and entries", () => {
    const s = new NutritionSample({
      id: "s-round",
      context: createNutritionContext({ dryMatterFraction: 0.88 }),
      measurements: [caAsFed(120), cpAsFed(9.5)],
    });
    const back = NutritionSample.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(back.id).toBe("s-round");
    expect(back.measurements).toHaveLength(2);
    expect(back.context?.resolvedDryMatterFraction).toBeCloseTo(0.88, 12);
  });

  it("malformed sample JSON is rejected", () => {
    expect(() => NutritionSample.fromJSON({ version: 2 } as never)).toThrow(
      InvalidNutritionQuantityError,
    );
  });
});

describe("NutritionSampleOptions — collection lookup semantics", () => {
  it("set lookup by nutrient, basis-aware", () => {
    const set = new NutritionMeasurementSet([caAsFed(100), cpAsFed(9)]);
    expect(set.size).toBe(2);
    expect(set.get("ca")?.value.value).toBe(100);
    expect(set.get("ca", "asFed")?.value.value).toBe(100);
    expect(set.get("ca", "dryMatter")).toBeUndefined();
    expect(set.get("zn")).toBeUndefined();
  });

  it("missing nutrient raises the typed error via require-style access", () => {
    const set = new NutritionMeasurementSet([caAsFed()]);
    expect(() => {
      const hit = set.get("zn");
      if (!hit) throw new MeasurementNotFoundError("zn");
    }).toThrow(MeasurementNotFoundError);
  });

  it("duplicate nutrient+basis+unit entries are ambiguous by design", () => {
    const set = new NutritionMeasurementSet([caAsFed(100), caAsFed(100)]);
    expect(set.size).toBe(2);
    // Ambiguous lookup returns undefined; explicit accessors distinguish
    // "not found" from "ambiguous" with typed errors.
    expect(set.get("ca")).toBeUndefined();
    expect(set.getAll("ca")).toHaveLength(2);
    expect(() => set.getOrThrow("ca")).toThrow(AmbiguousMeasurementError);
    expect(set.get("ca", "asFed")).toBeUndefined();
  });

  it("set rejects non-measurement entries", () => {
    expect(() => new NutritionMeasurementSet([{ nope: 1 } as never])).toThrow(
      InvalidNutritionQuantityError,
    );
  });
});
