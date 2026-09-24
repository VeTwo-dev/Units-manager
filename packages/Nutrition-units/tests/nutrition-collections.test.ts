/**
 * nutrition-collections.test.ts — Phase 10: collections & series
 */
import { describe, expect, it } from "vitest";
import { Quantity, Measurement } from "@vetwo/units";
import {
  NutritionMeasurement,
  NutritionSample,
  NutritionMeasurementSet,
  NutritionMeasurementSeries,
  createNutritionContext,
} from "../src/index.js";

// Helpers
function meas(
  value: number,
  unit: string,
  nutrient = "cp",
  basis = "asFed",
  unc = 0.1,
): NutritionMeasurement {
  const q = Quantity.of(value, unit);
  const m = Measurement.of(q, unc);
  return NutritionMeasurement.of(m, nutrient, basis);
}

describe("NutritionSample", () => {
  it("construction with identity and metadata", () => {
    const s = new NutritionSample({ id: "S-001", measurements: [meas(10, "g/kg", "cp")] });
    expect(s.id).toBe("S-001");
    expect(s.measurements.length).toBe(1);
    expect(Object.isFrozen(s)).toBe(true);
  });

  it("immutability — cannot mutate measurements array", () => {
    const s = new NutritionSample({ id: "S-002", measurements: [meas(10, "g/kg")] });
    expect(() =>
      (s.measurements as unknown as NutritionMeasurement[]).push(meas(20, "g/kg")),
    ).toThrow();
  });

  it("withMeasurement returns new sample", () => {
    const s1 = new NutritionSample({ id: "S-003" });
    const s2 = s1.withMeasurement(meas(10, "g/kg"));
    expect(s1.measurements.length).toBe(0);
    expect(s2.measurements.length).toBe(1);
  });

  it("serialization round-trip", () => {
    const s = new NutritionSample({
      id: "S-004",
      measurements: [meas(10, "g/kg"), meas(20, "mg/kg", "ca")],
    });
    const json = JSON.stringify(s.toJSON());
    const back = NutritionSample.fromJSON(JSON.parse(json));
    expect(back.id).toBe(s.id);
    expect(back.measurements.length).toBe(2);
    expect(back.measurements[0]!.value.value).toBe(10);
  });

  it("rejects invalid id", () => {
    expect(() => new NutritionSample({ id: "" } as never)).toThrow();
    expect(() => new NutritionSample({ id: "bad id!" } as never)).toThrow();
  });
});

describe("NutritionMeasurementSet", () => {
  it("creation, iteration, lookup", () => {
    const set = new NutritionMeasurementSet([meas(10, "g/kg", "cp"), meas(20, "g/kg", "ca")]);
    expect(set.size).toBe(2);
    const arr = [...set];
    expect(arr.length).toBe(2);
    expect(set.get("cp")?.value.value).toBe(10);
    expect(set.get("ca")?.value.value).toBe(20);
  });

  it("basis-aware lookup", () => {
    const af = meas(10, "g/kg", "cp", "asFed");
    const dm = meas(20, "g/kg", "cp", "dryMatter");
    const set = new NutritionMeasurementSet([af, dm]);
    expect(set.get("cp", "asFed")?.basis.id).toBe("asfed");
    expect(set.get("cp", "dryMatter")?.basis.id).toBe("drymatter");
    expect(set.get("cp")).toBeUndefined(); // ambiguous
  });

  it("duplicate behavior — permits duplicates", () => {
    const m1 = meas(10, "g/kg", "cp");
    const m2 = meas(15, "g/kg", "cp");
    const set = new NutritionMeasurementSet([m1]);
    const set2 = set.add(m2);
    expect(set.size).toBe(1);
    expect(set2.size).toBe(2);
    expect(set2.getAll("cp").length).toBe(2);
  });

  it("filtering and immutability", () => {
    const set = new NutritionMeasurementSet([
      meas(10, "g/kg", "cp"),
      meas(20, "g/kg", "ca"),
      meas(5, "mg/kg", "fe"),
    ]);
    const filtered = set.filterByNutrient("cp");
    expect(filtered.size).toBe(1);
    expect(set.size).toBe(3); // original unchanged
    const byBasis = set.filterByBasis("asFed");
    expect(byBasis.size).toBe(3);
  });

  it("unit-aware conversion preserves semantics", () => {
    const set = new NutritionMeasurementSet([meas(1, "g/kg", "cp")]);
    const converted = set.convertUnits("mg/kg");
    expect(converted.get("cp")?.value.value).toBeCloseTo(1000, 9);
    expect(converted.get("cp")?.nutrient.id).toBe("cp");
  });

  it("basis-aware conversion atomicity — fails if any fails", () => {
    const set = new NutritionMeasurementSet([
      meas(100, "g/kg", "cp", "asFed"),
      meas(200, "g/kg", "ca", "asFed"),
    ]);
    const ctx = createNutritionContext({ dryMatterFraction: 0.5 });
    const converted = set.convertBasis("dryMatter", ctx);
    expect(converted.get("cp", "dryMatter")?.value.value).toBeCloseTo(200, 9);
    // missing context should throw atomically (no partial)
    expect(() => set.convertBasis("dryMatter", undefined as never)).toThrow();
    expect(set.size).toBe(2); // original unchanged
  });

  it("serialization deterministic", () => {
    const set = new NutritionMeasurementSet([meas(10, "g/kg", "cp"), meas(20, "g/kg", "ca")]);
    const json = JSON.stringify(set.toJSON());
    const back = NutritionMeasurementSet.fromJSON(JSON.parse(json));
    expect(back.size).toBe(2);
    expect(JSON.stringify(back.toJSON())).toBe(json);
  });

  it("malicious payload rejected", () => {
    expect(() =>
      NutritionMeasurementSet.fromJSON(
        JSON.parse(
          '{"version":1,"type":"nutrition-measurement-set","measurements":[{"__proto__":{}}]}',
        ),
      ),
    ).toThrow();
  });
});

describe("NutritionMeasurementSeries", () => {
  it("ordering and timestamps", () => {
    const m1 = meas(10, "g/kg", "cp");
    const m2 = meas(12, "g/kg", "cp");
    const series = new NutritionMeasurementSeries([
      { timestamp: "2026-01-01T00:00:00.000Z", measurement: m1 },
      { timestamp: "2026-01-02T00:00:00.000Z", measurement: m2 },
    ]);
    expect(series.size).toBe(2);
    expect(series.points[0]!.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects invalid ordering and timestamps", () => {
    const m = meas(10, "g/kg");
    expect(
      () => new NutritionMeasurementSeries([{ timestamp: "invalid-date", measurement: m }]),
    ).toThrow();
    expect(
      () =>
        new NutritionMeasurementSeries([
          { timestamp: "2026-01-02T00:00:00.000Z", measurement: m },
          { timestamp: "2026-01-01T00:00:00.000Z", measurement: m },
        ]),
    ).toThrow();
  });

  it("replicates preserved", () => {
    const series = new NutritionMeasurementSeries([
      { timestamp: "2026-01-01T00:00:00.000Z", measurement: meas(10, "g/kg", "ca") },
      { timestamp: "2026-01-01T00:01:00.000Z", measurement: meas(11, "g/kg", "ca") },
      { timestamp: "2026-01-01T00:02:00.000Z", measurement: meas(9, "g/kg", "ca") },
    ]);
    expect(series.size).toBe(3);
    const added = series.add({
      timestamp: "2026-01-01T00:03:00.000Z",
      measurement: meas(10, "g/kg", "ca"),
    });
    expect(added.size).toBe(4);
    expect(series.size).toBe(3); // original unchanged
  });

  it("serialization round-trip", () => {
    const series = new NutritionMeasurementSeries([
      { timestamp: "2026-01-01T00:00:00.000Z", measurement: meas(10, "g/kg") },
      { timestamp: "2026-01-02T00:00:00.000Z", measurement: meas(12, "g/kg") },
    ]);
    const json = JSON.stringify(series.toJSON());
    const back = NutritionMeasurementSeries.fromJSON(JSON.parse(json));
    expect(back.size).toBe(2);
    expect(JSON.stringify(back.toJSON())).toBe(json);
  });

  it("immutability", () => {
    const series = new NutritionMeasurementSeries([
      { timestamp: "2026-01-01T00:00:00.000Z", measurement: meas(10, "g/kg") },
    ]);
    expect(Object.isFrozen(series)).toBe(true);
    expect(Object.isFrozen(series.points)).toBe(true);
  });
});

describe("collections — semantic safety", () => {
  it("preserves distinct nutrients", () => {
    const set = new NutritionMeasurementSet([meas(10, "g/kg", "ca"), meas(10, "g/kg", "cp")]);
    expect(set.getAll("ca").length).toBe(1);
    expect(set.getAll("cp").length).toBe(1);
    expect(set.get("ca")?.nutrient.id).toBe("ca");
    expect(set.get("cp")?.nutrient.id).toBe("cp");
  });

  it("collection conversion respects semantic compatibility", () => {
    const set = new NutritionMeasurementSet([meas(10, "g/kg", "ca"), meas(20, "g/kg", "ca")]);
    const converted = set.convertUnits("mg/kg");
    for (const m of converted) {
      expect(m.nutrient.id).toBe("ca");
    }
  });
});
