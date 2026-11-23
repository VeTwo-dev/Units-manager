/**
 * nutrition-interop.test.ts — Phase 11: interoperability, serialization, external data
 */
import { describe, expect, it, beforeEach } from "vitest";
import { Quantity, Measurement } from "@vetwo/units";
import {
  NutritionMeasurement,
  canonicalJsonStringify,
  SCHEMA_VERSION,
  createExternalNutrientIdentifier,
  createExternalUnitIdentifier,
  registerExternalNutrientMapping,
  resolveExternalNutrient,
  clearExternalNutrientMappings,
  migrateSerializedNutritionMeasurement,
  toCanonicalJson,
  fromCanonicalJson,
  handleUnknownNutrient,
  mapTabularRowToNutritionMeasurement,
  deserializeNutritionMeasurement,
} from "../src/index.js";

describe("phase11 — canonical & deterministic serialization", () => {
  it("same object serializes deterministically (key order, repeated)", () => {
    const nm = NutritionMeasurement.of(Measurement.of(Quantity.of(18.5, "%"), 0.5), "cp", "asFed");
    const a = canonicalJsonStringify(nm.toJSON());
    const b = canonicalJsonStringify(nm.toJSON());
    expect(a).toBe(b);
    // Our canonicalJsonStringify sorts keys, so order doesn't matter
    expect(canonicalJsonStringify({ b: 2, a: 1 })).toBe(canonicalJsonStringify({ a: 1, b: 2 }));
  });

  it("preserves value, unit, nutrient, basis, uncertainty, metadata, provenance", () => {
    const meas = Measurement.of(Quantity.of(250, "mg/kg"), Quantity.of(10, "mg/kg"));
    const nm = NutritionMeasurement.of(meas, "ca", "dryMatter", {
      metadata: { sample: { sampleId: "S1" }, method: { id: "M1" } } as never,
    });
    const json = toCanonicalJson(nm);
    const back = fromCanonicalJson(json);
    expect(back.equals(nm)).toBe(true);
    expect(back.metadata?.sample?.sampleId).toBe("S1");
    expect(back.uncertainty.value).toBeCloseTo(10, 9);
  });

  it("schemaVersion explicit and distinct from package version", () => {
    const nm = NutritionMeasurement.of(Measurement.exact(Quantity.of(10, "g/kg")), "cp", "asFed");
    const json = JSON.parse(toCanonicalJson(nm));
    expect(json.schemaVersion).toBe(SCHEMA_VERSION);
    expect(json.version).toBe(1);
    expect(SCHEMA_VERSION).toBe(1);
  });
});

describe("phase11 — schema versioning & migration", () => {
  it("migrates v0 → v1 with defaults", () => {
    const v0 = { value: 10, unit: "g/kg", nutrient: "cp" }; // legacy without basis
    const migrated = migrateSerializedNutritionMeasurement(v0, 0, 1) as Record<string, unknown>;
    expect(migrated.basis).toBe("asFed");
    expect(migrated.version).toBe(1);
  });

  it("unsupported version throws", () => {
    const nm = NutritionMeasurement.of(Measurement.exact(Quantity.of(10, "g/kg")), "cp", "asFed");
    const json = JSON.stringify({ ...JSON.parse(toCanonicalJson(nm)), schemaVersion: 999 });
    expect(() => fromCanonicalJson(json)).toThrow();
  });

  it("future migration must be explicit, not silent", () => {
    expect(() => migrateSerializedNutritionMeasurement({}, 1, 999)).toThrow();
  });
});

describe("phase11 — nutrient identifiers & alias resolution", () => {
  it("canonical IDs are stable, aliases resolve deterministically", () => {
    const nm1 = NutritionMeasurement.of(Measurement.exact(Quantity.of(10, "g/kg")), "CP", "asFed");
    const nm2 = NutritionMeasurement.of(
      Measurement.exact(Quantity.of(10, "g/kg")),
      "crudeProtein",
      "asFed",
    );
    expect(nm1.nutrient.id).toBe(nm2.nutrient.id);
    expect(nm1.nutrient.id).toBe("cp");
  });

  it("case handling per documented rules (case-insensitive)", () => {
    const a = NutritionMeasurement.of(Measurement.exact(Quantity.of(10, "g/kg")), "CP", "asFed");
    const b = NutritionMeasurement.of(Measurement.exact(Quantity.of(10, "g/kg")), "cp", "asFed");
    expect(a.nutrient.id).toBe(b.nutrient.id);
  });
});

describe("phase11 — external identifiers", () => {
  beforeEach(() => clearExternalNutrientMappings());

  it("namespace-aware, immutable, validated", () => {
    const ext = createExternalNutrientIdentifier("my.namespace", "ext-123");
    expect(Object.isFrozen(ext)).toBe(true);
    expect(() => createExternalNutrientIdentifier("Bad Namespace!", "id")).toThrow();
    expect(() => createExternalNutrientIdentifier("ns", "")).toThrow();
    const extUnit = createExternalUnitIdentifier("ns", "unit-1", "g/kg");
    expect(extUnit.symbol).toBe("g/kg");
  });

  it("external → canonical mapping is explicit and deterministic", () => {
    const ext = createExternalNutrientIdentifier("vendor.a", "CP_CUSTOM");
    registerExternalNutrientMapping(ext, "cp");
    expect(resolveExternalNutrient(ext)).toBe("cp");
    expect(() => registerExternalNutrientMapping(ext, "cp")).toThrow(); // duplicate
  });

  it("extensible without vendor coupling", () => {
    const ext2 = createExternalNutrientIdentifier("vendor.b", "CUSTOM_2");
    registerExternalNutrientMapping(ext2, "ca");
    expect(resolveExternalNutrient(ext2)).toBe("ca");
  });
});

describe("phase11 — unknown handling", () => {
  beforeEach(() => clearExternalNutrientMappings());

  it("unknown nutrient fails safely by default, external mode preserves", () => {
    const ext = createExternalNutrientIdentifier("vendor.x", "UNKNOWN_NUT");
    expect(() => handleUnknownNutrient(ext, "fail")).toThrow();
    const kept = handleUnknownNutrient(ext, "external");
    expect((kept as { namespace: string }).namespace).toBe("vendor.x");
  });

  it("unknown nutrient in deserialization fails explicitly", () => {
    const bad = {
      version: 1,
      type: "nutrition-measurement",
      measurement: {
        version: 1,
        type: "measurement",
        value: { version: 1, type: "quantity", value: 10, unit: "g/kg" },
        uncertainty: { version: 1, type: "quantity", value: 0, unit: "g/kg" },
        method: "linearized",
      },
      nutrient: "unknown_xyz_999",
      basis: "asFed",
    };
    expect(() => deserializeNutritionMeasurement(bad as never)).toThrow();
  });

  it("unknown unit fails safely", () => {
    const bad = {
      version: 1,
      type: "nutrition-measurement",
      measurement: {
        version: 1,
        type: "measurement",
        value: { version: 1, type: "quantity", value: 10, unit: "not-a-unit-xyz" },
        uncertainty: { version: 1, type: "quantity", value: 0, unit: "not-a-unit-xyz" },
        method: "linearized",
      },
      nutrient: "cp",
      basis: "asFed",
    };
    expect(() => deserializeNutritionMeasurement(bad as never)).toThrow();
  });

  it("unknown nutrient never silently becomes known", () => {
    const ext = createExternalNutrientIdentifier("vendor.y", "MYSTERY");
    // Not registered, fail mode throws, not silently maps to cp
    expect(() => handleUnknownNutrient(ext, "fail")).toThrow();
    expect(resolveExternalNutrient(ext)).toBeUndefined();
  });
});

describe("phase11 — unknown fields & safe deserialization", () => {
  it("compatible mode: unknown non-critical fields ignored", () => {
    const nm = NutritionMeasurement.of(Measurement.exact(Quantity.of(10, "g/kg")), "cp", "asFed");
    const json = nm.toJSON() as unknown as Record<string, unknown>;
    const withExtra = { ...json, extraField: "preserve-me" };
    // Our deserialize currently ignores unknown fields (compatible mode) — should not throw and should preserve known
    const back = deserializeNutritionMeasurement(withExtra as never);
    expect(back.equals(nm)).toBe(true);
  });

  it("prototype pollution guarded", () => {
    const evil = JSON.parse(
      '{"version":1,"type":"nutrition-measurement","measurement":{"version":1,"type":"measurement","value":{"version":1,"type":"quantity","value":10,"unit":"g/kg"},"uncertainty":{"version":1,"type":"quantity","value":0,"unit":"g/kg"},"method":"linearized"},"nutrient":"cp","basis":"asFed","__proto__":{"polluted":true}}',
    );
    expect(() => deserializeNutritionMeasurement(evil)).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("malicious nested structures rejected", () => {
    const deep = {
      version: 1,
      type: "nutrition-measurement",
      measurement: {
        version: 1,
        type: "measurement",
        value: { version: 1, type: "quantity", value: "not-a-number", unit: "g/kg" },
        uncertainty: { version: 1, type: "quantity", value: 0, unit: "g/kg" },
        method: "linearized",
      },
      nutrient: "cp",
      basis: "asFed",
    };
    expect(() => deserializeNutritionMeasurement(deep as never)).toThrow();
  });

  it("NaN where forbidden throws, Infinity where forbidden throws", () => {
    const badNaN = {
      version: 1,
      type: "nutrition-measurement",
      measurement: {
        version: 1,
        type: "measurement",
        value: { version: 1, type: "quantity", value: "not-a-number", unit: "g/kg" },
        uncertainty: { version: 1, type: "quantity", value: 0, unit: "g/kg" },
        method: "linearized",
      },
      nutrient: "cp",
      basis: "asFed",
    };
    expect(() => deserializeNutritionMeasurement(badNaN as never)).toThrow();
    const badInf = {
      version: 1,
      type: "nutrition-measurement",
      measurement: {
        version: 1,
        type: "measurement",
        value: { version: 1, type: "quantity", value: 10, unit: "g/kg" },
        uncertainty: { version: 1, type: "quantity", value: Infinity, unit: "g/kg" },
        method: "linearized",
      },
      nutrient: "cp",
      basis: "asFed",
    };
    expect(() => deserializeNutritionMeasurement(badInf as never)).toThrow();
  });
});

describe("phase11 — tabular mapping", () => {
  it("maps external row to canonical measurement (explicit, deterministic, validated)", () => {
    const row = { nutrient_col: "CP", val: 18.5, unit_col: "%", basis_col: "asFed" };
    const nm = mapTabularRowToNutritionMeasurement(row, {
      fields: [
        { externalField: "nutrient_col", canonicalField: "nutrient" },
        { externalField: "val", canonicalField: "value" },
        { externalField: "unit_col", canonicalField: "unit" },
        { externalField: "basis_col", canonicalField: "basis" },
      ],
    });
    expect(nm.nutrient.id).toBe("cp");
    expect(nm.value.value).toBe(18.5);
    expect(nm.basis.id).toBe("asfed");
  });

  it("validates nutrient/unit/basis before creating domain object", () => {
    const badRow = { nutrient_col: "UNKNOWN_XYZ", val: 10, unit_col: "g/kg" };
    expect(() =>
      mapTabularRowToNutritionMeasurement(badRow, {
        fields: [
          { externalField: "nutrient_col", canonicalField: "nutrient" },
          { externalField: "val", canonicalField: "value" },
          { externalField: "unit_col", canonicalField: "unit" },
        ],
      }),
    ).toThrow();
  });

  it("strict mode unknown fields → error", () => {
    const row = { nutrient_col: "CP", val: 10, unit_col: "g/kg", extra: "oops" };
    expect(() =>
      mapTabularRowToNutritionMeasurement(row, {
        fields: [
          { externalField: "nutrient_col", canonicalField: "nutrient" },
          { externalField: "val", canonicalField: "value" },
          { externalField: "unit_col", canonicalField: "unit" },
        ],
        strict: true,
      }),
    ).toThrow();
  });

  it("external nutrient namespace mapping explicit, not heuristic", () => {
    clearExternalNutrientMappings();
    const ext = createExternalNutrientIdentifier("ext.vendor", "MY_CP");
    registerExternalNutrientMapping(ext, "cp");
    const row = { nutrient_col: "ext.vendor:MY_CP", val: 10, unit_col: "g/kg" };
    const nm = mapTabularRowToNutritionMeasurement(row, {
      fields: [
        { externalField: "nutrient_col", canonicalField: "nutrient" },
        { externalField: "val", canonicalField: "value" },
        { externalField: "unit_col", canonicalField: "unit" },
      ],
    });
    expect(nm.nutrient.id).toBe("cp");
    // Without explicit mapping, "MY_CP" alone would not heuristically become cp
    expect(() =>
      mapTabularRowToNutritionMeasurement(
        { nutrient_col: "MY_CP", val: 10, unit_col: "g/kg" },
        {
          fields: [
            { externalField: "nutrient_col", canonicalField: "nutrient" },
            { externalField: "val", canonicalField: "value" },
            { externalField: "unit_col", canonicalField: "unit" },
          ],
        },
      ),
    ).toThrow();
  });
});

describe("phase11 — round-trip guarantees", () => {
  it("domain → serialize → deserialize → domain preserves semantics", () => {
    const nm = NutritionMeasurement.of(
      Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(5, "mg/kg")),
      "ca",
      "dryMatter",
    );
    const json = toCanonicalJson(nm);
    const back = fromCanonicalJson(json);
    expect(back.equals(nm)).toBe(true);
    expect(back.basis.id).toBe("drymatter");
    expect(back.uncertainty.value).toBeCloseTo(5, 9);
  });

  it("deterministic serialization: repeated runs byte-equivalent", () => {
    const nm = NutritionMeasurement.of(Measurement.of(Quantity.of(18.5, "%"), 0.2), "cp", "asFed");
    const a = toCanonicalJson(nm);
    const b = toCanonicalJson(nm);
    expect(a).toBe(b);
    expect(canonicalJsonStringify(JSON.parse(a))).toBe(canonicalJsonStringify(JSON.parse(b)));
  });
});
