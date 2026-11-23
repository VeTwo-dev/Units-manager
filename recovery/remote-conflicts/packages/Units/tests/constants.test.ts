/**
 * tests/constants.test.ts — Phase 26: ScientificConstant identity, registry
 * semantics (conflicts, namespaces, scopes, snapshots), versioning,
 * serialization, security, and formula integration.
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Measurement,
  Dim,
  Expression,
  ConstantRegistry,
  createStandardConstantRegistry,
  SI_PHYSICS_CONSTANT_DEFS,
  serializeConstant,
  serializeConstantRegistry,
  deserializeConstantRegistry,
  recordConstantUsage,
  defineFormula,
  evaluateFormula,
  deserializeFormula,
  serializeFormula,
  createRegistry,
  SI_PACK,
  UnitEngineError,
} from "../src/index.js";

const { variable: v, multiply: mul, power: pow } = Expression;

function testRegistry(): ConstantRegistry {
  return createStandardConstantRegistry();
}

// ---------------------------------------------------------------------------
// Identity, aliases, symbols
// ---------------------------------------------------------------------------

describe("constant identity", () => {
  it("ids, symbols and aliases resolve to the same identity", () => {
    const r = testRegistry();
    expect(r.require("speedOfLight")).toBe(r.require("c"));
    expect(r.require("c")).toBe(r.require("lightspeed"));
    expect(r.require("avogadroConstant").quantity.value).toBe(6.02214076e23);
    expect(r.require("NA").symbol).toBe("NA");
    expect(r.has("g0")).toBe(true);
    expect(r.has("nope")).toBe(false);
  });

  it("built-in dataset is conservative and sourced", () => {
    expect(SI_PHYSICS_CONSTANT_DEFS.length).toBe(7);
    for (const def of SI_PHYSICS_CONSTANT_DEFS) {
      expect(def.source.trim().length).toBeGreaterThan(0);
      const c = testRegistry().require(def.id);
      expect(c.exact).toBe(def.exact);
      expect(c.version).toBeGreaterThanOrEqual(1);
    }
  });

  it("exact constants carry zero uncertainty; G carries CODATA uncertainty", () => {
    const r = testRegistry();
    expect(r.require("c").measurement.uncertainty.value).toBe(0);
    expect(r.require("planckConstant").measurement.uncertainty.value).toBe(0);
    const g = r.require("newtonianGravitation");
    expect(g.exact).toBe(false);
    expect(g.measurement.uncertainty.value).toBeCloseTo(0.00015e-11, 20);
  });
});

// ---------------------------------------------------------------------------
// Registration conflicts and validation
// ---------------------------------------------------------------------------

describe("registration conflicts", () => {
  it("rejects duplicate ids, symbols and aliases (no silent choice)", () => {
    const r = new ConstantRegistry({ name: "t", datasetVersion: "1" });
    r.register({ id: "a", symbol: "a", value: 1, unit: "m", exact: true, source: "s" });
    expect(() =>
      r.register({ id: "a", symbol: "b", value: 2, unit: "m", exact: true, source: "s" }),
    ).toThrow(UnitEngineError);
    expect(() =>
      r.register({ id: "b", symbol: "a", value: 2, unit: "m", exact: true, source: "s" }),
    ).toThrow(UnitEngineError);
    expect(() =>
      r.register({
        id: "c",
        symbol: "c",
        aliases: ["a"],
        value: 3,
        unit: "m",
        exact: true,
        source: "s",
      }),
    ).toThrow(UnitEngineError);
  });

  it("rejects malformed definitions", () => {
    const r = new ConstantRegistry({ name: "t", datasetVersion: "1" });
    expect(() =>
      r.register({ id: "bad id", symbol: "x", value: 1, unit: "m", exact: true, source: "s" }),
    ).toThrow(UnitEngineError);
    expect(() =>
      r.register({ id: "x", symbol: "x", value: 1, unit: "nope_xyz", exact: true, source: "s" }),
    ).toThrow(UnitEngineError);
    expect(() =>
      r.register({ id: "x", symbol: "x", value: 1, unit: "m", exact: true, source: "" }),
    ).toThrow(UnitEngineError);
    expect(() =>
      r.register({
        id: "x",
        symbol: "x",
        value: 1,
        unit: "m",
        exact: true,
        source: "s",
        uncertainty: 0.1,
      }),
    ).toThrow(UnitEngineError); // exact + uncertainty
    expect(() =>
      r.register({ id: "x", symbol: "x", value: 1, unit: "m", exact: false, source: "s" }),
    ).toThrow(UnitEngineError); // inexact without uncertainty
    expect(() =>
      r.register({
        id: "x",
        symbol: "x",
        value: 1,
        unit: "m",
        exact: false,
        uncertainty: -1,
        source: "s",
      }),
    ).toThrow(UnitEngineError);
    expect(() =>
      r.register({ id: "x", symbol: "x", value: NaN, unit: "m", exact: true, source: "s" }),
    ).toThrow(UnitEngineError);
    expect(() =>
      r.register({
        id: "x",
        symbol: "x",
        value: 1,
        unit: "m",
        exact: true,
        source: "s",
        validFrom: "2020-01-02",
        validTo: "2020-01-01",
      }),
    ).toThrow(UnitEngineError);
  });

  it("enforces registry limits", () => {
    const r = new ConstantRegistry({ name: "t", datasetVersion: "1", limits: { maxConstants: 1 } });
    r.register({ id: "a", symbol: "a", value: 1, unit: "m", exact: true, source: "s" });
    expect(() =>
      r.register({ id: "b", symbol: "b", value: 1, unit: "m", exact: true, source: "s" }),
    ).toThrow(UnitEngineError);
  });
});

// ---------------------------------------------------------------------------
// Namespaces and scopes
// ---------------------------------------------------------------------------

describe("namespaces and scopes", () => {
  it("namespaced lookup requires matching namespace", () => {
    const r = new ConstantRegistry({ name: "t", namespace: "si", datasetVersion: "1" });
    r.register({ id: "c", symbol: "c", value: 1, unit: "m/s", exact: true, source: "s" });
    expect(r.require("si:c").id).toBe("c");
    expect(r.require("c").id).toBe("c");
    expect(() => r.require("other:c")).toThrow(UnitEngineError);
  });

  it("child scopes shadow parents explicitly; snapshots detach", () => {
    const parent = testRegistry();
    const child = new ConstantRegistry({ name: "app", datasetVersion: "app-1", parent });
    // Child shadows c with an explicit override.
    child.register({
      id: "speedOfLight",
      symbol: "c",
      value: 300000000,
      unit: "m/s",
      exact: true,
      source: "approx",
    });
    expect(child.require("c").quantity.value).toBe(300000000);
    expect(parent.require("c").quantity.value).toBe(299792458);
    // Untouched names fall through to the parent.
    expect(child.require("h").quantity.value).toBe(parent.require("h").quantity.value);
    // Snapshots detach: later parent changes are invisible.
    const snap = child.snapshot();
    expect(snap.require("c").quantity.value).toBe(300000000);
  });
});

// ---------------------------------------------------------------------------
// Dimensional analysis with constants (E = m·c² infers energy)
// ---------------------------------------------------------------------------

describe("dimensional analysis", () => {
  it("m·c² infers M·L²·T⁻² before execution", () => {
    const r = testRegistry();
    const c = r.require("c");
    const f = defineFormula({
      id: "emc2",
      expression: mul(v("m"), pow(v("c"), 2)),
      inputs: { m: { dimension: Dim.Mass } },
      constants: { c },
      expectedDimension: { M: 1, L: 2, T: -2 },
    });
    expect(f.constantRefs["c"]).toEqual({ id: "speedOfLight", version: 1 });
  });
});

// ---------------------------------------------------------------------------
// Formula integration: exact constants fold, uncertain ones propagate
// ---------------------------------------------------------------------------

describe("formula integration", () => {
  const siReg = createRegistry({ packs: [SI_PACK] });
  const O = { registry: siReg };

  it("E = m·c² evaluates with an exact constant", () => {
    const r = testRegistry();
    const f = defineFormula(
      {
        id: "emc2",
        expression: mul(v("m"), pow(v("c"), 2)),
        inputs: { m: { dimension: Dim.Mass } },
        constants: { c: r.require("c") },
        // NOTE: N·m, not J — this engine keeps energy J on the E base
        // dimension, while m·c² is mechanically M·L²·T⁻² (documented model).
        outputUnit: "N·m",
      },
      O,
    );
    const out = evaluateFormula(f, { m: Quantity.of(1, "kg") }, O);
    if (!(out instanceof Quantity)) throw new Error("expected Quantity");
    expect(out.value).toBeCloseTo(299792458 ** 2, -6); // negative precision = coarse absolute tolerance
  });

  it("uncertain constants propagate through the Measurement path", () => {
    const r = testRegistry();
    const f = defineFormula(
      {
        id: "grav",
        expression: mul(v("m"), v("G")),
        inputs: { m: { dimension: Dim.Mass } },
        constants: { G: r.require("newtonianGravitation") },
      },
      O,
    );
    // G becomes a pre-bound Measurement input: result carries uncertainty.
    const out = evaluateFormula(f, { m: Quantity.of(2, "kg") }, O);
    if (!(out instanceof Measurement)) throw new Error("expected Measurement");
    expect(out.uncertainty.value).toBeGreaterThan(0);
    // Relative uncertainty of G is preserved in the product.
    const gRel = r.require("G").measurement.relativeUncertainty();
    expect(out.relativeUncertainty()).toBeCloseTo(gRel, 9);
  });

  it("constant/input name collisions throw explicitly", () => {
    const r = testRegistry();
    expect(() =>
      defineFormula(
        {
          id: "x",
          expression: mul(v("c"), v("m")),
          inputs: { c: { dimension: "m/s" }, m: { dimension: Dim.Mass } },
          constants: { c: r.require("c") },
        },
        O,
      ),
    ).toThrow();
  });

  it("measurement constants with zero uncertainty fold as exact", () => {
    const f = defineFormula(
      {
        id: "x",
        expression: mul(v("m"), v("k")),
        inputs: { m: { dimension: Dim.Mass } },
        constants: { k: Measurement.exact(Quantity.of(2, "fraction")) },
      },
      O,
    );
    const out = evaluateFormula(f, { m: Quantity.of(3, "kg") }, O);
    if (!(out instanceof Quantity)) throw new Error("expected Quantity");
    expect(out.value).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Serialization, versions, reproducibility
// ---------------------------------------------------------------------------

describe("serialization and versions", () => {
  it("registry round-trips deterministically", () => {
    const r = testRegistry();
    const json = JSON.stringify(serializeConstantRegistry(r));
    const siReg = createRegistry({ packs: [SI_PACK] });
    const restored = deserializeConstantRegistry(JSON.parse(json), { units: siReg });
    expect(restored.size).toBe(r.size);
    expect(restored.require("c").quantity.value).toBe(299792458);
    expect(restored.datasetVersion).toBe(r.datasetVersion);
    // Byte-identical re-serialization (deterministic key order).
    expect(JSON.stringify(serializeConstantRegistry(restored))).toBe(json);
  });

  it("rejects malformed registries and oversized payloads", () => {
    expect(() => deserializeConstantRegistry(null)).toThrow(UnitEngineError);
    expect(() => deserializeConstantRegistry({ version: 2, type: "constant-registry" })).toThrow(
      UnitEngineError,
    );
    expect(() =>
      deserializeConstantRegistry(
        JSON.parse('{"version":1,"type":"constant-registry","__proto__":{}}'),
      ),
    ).toThrow(UnitEngineError);
    expect(() =>
      deserializeConstantRegistry("x".repeat(100), { limits: { maxSerializedChars: 10 } }),
    ).toThrow(UnitEngineError);
    expect(() =>
      deserializeConstantRegistry({
        version: 1,
        type: "constant-registry",
        name: "t",
        datasetVersion: "1",
        constants: [{ version: 1, type: "scientific-constant", id: "a", symbol: "a" }],
      }),
    ).toThrow(UnitEngineError);
  });

  it("formula constant refs gate on version (reproducibility)", () => {
    const r = testRegistry();
    const siReg = createRegistry({ packs: [SI_PACK] });
    const f = defineFormula(
      {
        id: "emc2",
        expression: mul(v("m"), pow(v("c"), 2)),
        inputs: { m: { dimension: Dim.Mass } },
        constants: { c: r.require("c") },
      },
      { registry: siReg },
    );
    const payload = JSON.parse(JSON.stringify(serializeFormula(f)));
    expect(payload.constantRefs.c).toEqual({ id: "speedOfLight", version: 1 });
    // Same version resolves.
    const ok = deserializeFormula(payload, { registry: siReg, constantRegistry: r });
    expect(ok.id).toBe("emc2");
    // Newer registry version fails explicitly instead of silently recomputing.
    const newer = new ConstantRegistry({ name: "n", datasetVersion: "v2" });
    const orig = r.require("c");
    newer.register({
      id: orig.id,
      symbol: orig.symbol,
      value: orig.quantity.value,
      unit: "m/s",
      exact: true,
      source: orig.source,
      version: 2,
    });
    expect(() =>
      deserializeFormula(payload, { registry: siReg, constantRegistry: newer }),
    ).toThrow();
    // Missing registry fails explicitly too.
    expect(() => deserializeFormula(payload, { registry: siReg })).toThrow();
  });

  it("recordConstantUsage captures the reproducibility tuple", () => {
    const r = testRegistry();
    const rec = recordConstantUsage(r.require("c"), r.datasetVersion);
    expect(rec).toEqual({
      id: "speedOfLight",
      symbol: "c",
      value: 299792458,
      unit: "m/s",
      version: 1,
      source: "SI Brochure (BIPM), 9th edition",
      datasetVersion: "SI-2019+CODATA-2018",
    });
  });

  it("single constants serialize (data-only, no evaluators)", () => {
    const r = testRegistry();
    const s = serializeConstant(r.require("G"));
    expect(s.type).toBe("scientific-constant");
    expect(s.uncertainty).toBe(1.5e-15);
    expect(JSON.stringify(s)).not.toContain("function");
  });
});
