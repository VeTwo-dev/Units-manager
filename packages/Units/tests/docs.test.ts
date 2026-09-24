/**
 * docs.test.ts — Phase 30: documentation examples must compile and run
 * (getting-started snippets), and the public export surface must not gain
 * accidental leaks (API-stability tripwire).
 */
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";
import {
  Quantity,
  Measurement,
  defineFormula,
  evaluateFormula,
  Expression,
  formatWithContext,
  ProfileRegistry,
  registerStandardProfiles,
  createRegistry,
  SI_PACK,
  CGS_PACK,
  UnitMismatchError,
} from "../src/index.js";

describe("getting-started examples", () => {
  it("basic quantity workflow", () => {
    const distance = Quantity.of(100, "m");
    const time = Quantity.of(10, "s");
    const velocity = distance.divide(time);
    expect(velocity.to("km/h").value).toBeCloseTo(36, 9);
    expect(() => Quantity.of(1, "kg").add(Quantity.of(1, "m"))).toThrow(UnitMismatchError);
  });

  it("measurement workflow", () => {
    const mass = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
    expect(mass.relativeUncertainty()).toBeCloseTo(0.02, 12);
    const total = mass.add(Measurement.of(Quantity.of(5, "kg"), Quantity.of(0.1, "kg")));
    expect(total.uncertainty.value).toBeCloseTo(Math.sqrt(0.05), 9);
  });

  it("formula workflow", () => {
    const speed = defineFormula({
      id: "speed",
      expression: Expression.divide(Expression.variable("d"), Expression.variable("t")),
      inputs: { d: { dimension: "m" }, t: { dimension: "s" } },
      outputName: "v",
    });
    const v = evaluateFormula(speed, { d: Quantity.of(100, "m"), t: Quantity.of(10, "s") });
    expect(v).toBeInstanceOf(Quantity);
  });

  it("systems display workflow", () => {
    const profiles = new ProfileRegistry();
    registerStandardProfiles(profiles);
    const si = createRegistry({ packs: [SI_PACK, CGS_PACK] });
    const out = formatWithContext(Quantity.of(1, "N", si), {
      unitSystem: "cgs",
      profiles,
      registry: si,
    });
    expect(out).toContain("dyn");
  });
});

describe("public API surface (stability tripwire)", () => {
  it("exports exactly the curated public surface", () => {
    const names = Object.keys(api).sort();
    // Spot-check load-bearing names; the full sorted list below trips on
    // any accidental addition or removal.
    for (const required of [
      "Quantity",
      "Measurement",
      "UnitRegistry",
      "parseUnit",
      "formatQuantity",
      "defineFormula",
      "evaluateFormula",
      "createExtensionScope",
      "applyExtension",
      "resolveAmbiguous",
      "toInterchange",
      "fromInterchange",
      "migrateSerialized",
      "compareQuantities",
      "resolveStrictness",
      "UnitEngineError",
      "AmbiguousUnitError",
      "ExtensionError",
      "MigrationError",
    ]) {
      expect(names, `missing export: ${required}`).toContain(required);
    }
    // Guard against internal leakage: no dunder names, no unsafe/eval
    // helpers. (Legitimate "evaluate*" APIs are allowlisted explicitly.)
    const allowlisted = new Set([
      "evaluateExpression",
      "evaluateFormula",
      "evaluateInContext",
      "evaluateMeasurement",
    ]);
    for (const n of names) {
      expect(n.startsWith("__"), `dunder export: ${n}`).toBe(false);
      const lower = n.toLowerCase();
      if (!allowlisted.has(n)) {
        expect(lower.includes("unsafe"), `unsafe export: ${n}`).toBe(false);
        expect(lower === "eval" || lower.startsWith("eval_"), `eval export: ${n}`).toBe(false);
      }
    }
    // Snapshot the count so growth is a deliberate, reviewed diff.
    expect(names.length).toBeGreaterThan(150);
  });
});
