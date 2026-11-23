import { bench, describe } from "vitest";
import { parseUnit } from "./unit-parser.js";
import { convert } from "./conversion-engine.js";
import { Quantity } from "./quantity.js";
import { UnitRegistry } from "./unit-registry.js";
import { defaultPrefixRegistry } from "./prefix.js";
import { formatUnit, formatQuantity } from "./formatter.js";
import {
  serializeUnit,
  serializeQuantity,
  deserializeUnit,
  deserializeQuantity,
} from "./serializer.js";
import { isQuantity, isUnit } from "./guards.js";
import { defaultUnitSystemRegistry } from "./unit-system.js";
import { Dim, multiplyDim, divideDim, powDim, dimensionKey, dimensionsEqual } from "./dimension.js";
import { Expression, compileExpression, evaluateExpression } from "./expression.js";
import { getConversionPlan, convertWithPlan } from "./conversion-engine.js";
import { canonicalUnitKey } from "./unit.js";
import { createRegistry } from "./unit-system.js";
import { SI_PACK } from "./packs/si.js";
import { IMPERIAL_PACK } from "./packs/imperial.js";
import { ANGLE_PACK } from "./packs/angle.js";
import { Measurement } from "./measurement.js";
import { toSignificantFigures, toEngineeringNotation } from "./significant-figures.js";
import { areKindsCompatible } from "./quantity-kind.js";
import { parseUnitExpression, unitExprKey, equivalentUnits } from "./unit-algebra.js";
import { defineFormula, compileFormula } from "./formula.js";
import {
  Measurement as BenchMeasurement,
  serializeMeasurement,
  deserializeMeasurement,
} from "./measurement.js";
import {
  createStandardConstantRegistry,
  serializeConstantRegistry,
  deserializeConstantRegistry,
} from "./constants.js";
import {
  MeasurementSeries,
  CovarianceMatrix,
  combineUncertainties,
  propagateWithCovariance,
} from "./statistics.js";
import {
  ProfileRegistry,
  registerStandardProfiles,
  normalizeToSystem,
  selectUnitForMagnitude,
  formatWithContext,
} from "./standards-profile.js";
import { IMPERIAL_SYSTEM } from "./unit-system.js";
import {
  validateExtension,
  applyExtension,
  resolveAmbiguous,
  toInterchange,
  fromInterchange,
  canonicalizeUnitText,
  formatWithPreset,
  compareQuantities,
  migrateSerialized,
  parseNamespacedSymbol,
} from "./interop.js";

const registry = new UnitRegistry();
const kg = parseUnit("kg");
const g = parseUnit("g");
const m = parseUnit("m");
const cm = parseUnit("cm");
const c = parseUnit("°C");
const k = parseUnit("K");
const f = parseUnit("°F");
const prefixReg = defaultPrefixRegistry;

describe("benchmarks: unit lookup", () => {
  bench("parseUnit cache hit (kg)", () => {
    parseUnit("kg");
  });
  bench("UnitRegistry.resolve (kg)", () => {
    registry.resolve("kg");
  });
});

describe("benchmarks: conversion", () => {
  bench("same-unit conversion (kg→kg)", () => {
    convert(1, kg, kg);
  });
  bench("linear conversion (kg→g)", () => {
    convert(1, kg, g);
  });
  bench("linear conversion (m→cm)", () => {
    convert(1, m, cm);
  });
  bench("affine conversion (°C→K)", () => {
    convert(25, c, k);
  });
  bench("affine conversion (°C→°F)", () => {
    convert(100, c, f);
  });
  bench("Quantity.to linear (kg→g)", () => {
    Quantity.of(1, "kg").to("g");
  });
  bench("Quantity.to affine (°C→K)", () => {
    Quantity.of(25, "°C").to("K");
  });
});

describe("benchmarks: error paths", () => {
  bench("incompatible dimension rejection (kg→m)", () => {
    try {
      convert(1, kg, m);
    } catch {
      // expected
    }
  });
});

describe("benchmarks: derived units", () => {
  bench("derived unit parse (g/day)", () => {
    parseUnit("g/day");
  });
  bench("derived unit conversion (Mcal/kg concept via %→fraction)", () => {
    const pct = parseUnit("%");
    const frac = parseUnit("fraction");
    convert(50, pct, frac);
  });
});

describe("benchmarks: prefix", () => {
  bench("prefix lookup (k)", () => {
    prefixReg.get("k");
  });
  bench("prefixed-unit resolution (nm, cold cache via registry)", () => {
    const r = new UnitRegistry();
    // r has m prefixable, parse nm via registry resolve
    r.resolve("nm");
  });
  bench("prefixed-unit resolution (nm, parseUnit hot)", () => {
    parseUnit("nm");
  });
  bench("prefixed conversion (nm→m)", () => {
    const nm = parseUnit("nm");
    const mm = parseUnit("m");
    convert(1, nm, mm);
  });
});

describe("benchmarks: quantity engine", () => {
  const qKg = Quantity.of(10, "kg");
  const qG = Quantity.of(500, "g");
  const qM = Quantity.of(5, "m");
  const qS = Quantity.of(2, "s");

  bench("Quantity construction", () => {
    Quantity.of(10, "kg");
  });
  bench("Quantity conversion (kg→g)", () => {
    qKg.to("g");
  });
  bench("Quantity addition", () => {
    qKg.add(qG);
  });
  bench("Quantity subtraction", () => {
    qKg.subtract(qG);
  });
  bench("Quantity multiplication (Quantity×Quantity)", () => {
    qKg.multiply(qM);
  });
  bench("Quantity division (Quantity÷Quantity)", () => {
    qM.divide(qS);
  });
  bench("Quantity scale", () => {
    qKg.scale(2);
  });
  bench("Quantity negate", () => {
    qKg.negate();
  });
  bench("Quantity lessThan comparison", () => {
    qKg.lessThan(Quantity.of(20, "kg"));
  });
});

describe("benchmarks: parser (Phase 8)", () => {
  bench("parse atomic kg", () => {
    parseUnit("kg");
  });
  bench("parse prefixed mg", () => {
    parseUnit("mg");
  });
  bench("parse simple composite kg/m³", () => {
    parseUnit("kg/m³");
  });
  bench("parse complex composite kg·m/s²", () => {
    parseUnit("kg·m/s²");
  });
  bench("parse with parens (kg*m)/s^2", () => {
    parseUnit("(kg*m)/s^2");
  });
  bench("parse repeated with cache (kg/m³)", () => {
    parseUnit("kg/m³");
  });
  bench("parse malformed kg//s", () => {
    try {
      parseUnit("kg//s");
    } catch {
      void 0;
    }
  });
  bench("parse dimensionless m/m", () => {
    parseUnit("m/m");
  });
});

describe("benchmarks: dimensionless", () => {
  const qM1 = Quantity.of(10, "m");
  const qM2 = Quantity.of(2, "m");
  bench("dimensionless division m/m", () => {
    qM1.divide(qM2);
  });
  bench("dimensionless multiply %→fraction", () => {
    Quantity.of(15, "%").to("fraction");
  });
});

describe("benchmarks: formatter", () => {
  const uAtomic = parseUnit("kg");
  const uCompound = parseUnit("kg·m/s²");
  const qFmt = Quantity.of(12.5, "kg");
  bench("format atomic Unit", () => {
    formatUnit(uAtomic);
  });
  bench("format compound Unit", () => {
    formatUnit(uCompound);
  });
  bench("format Quantity", () => {
    formatQuantity(qFmt);
  });
});

describe("benchmarks: serializer & guards", () => {
  const qSer = Quantity.of(12.5, "kg");
  const uSer = parseUnit("kg");
  bench("serialize Unit", () => {
    serializeUnit(uSer);
  });
  bench("serialize Quantity", () => {
    serializeQuantity(qSer);
  });
  bench("deserialize Unit", () => {
    const ser = serializeUnit(uSer);
    deserializeUnit(ser);
  });
  bench("deserialize Quantity", () => {
    const ser = serializeQuantity(qSer);
    deserializeQuantity(ser);
  });
  bench("guard isQuantity", () => {
    isQuantity(qSer);
  });
  bench("guard isUnit", () => {
    isUnit(uSer);
  });
});

describe("benchmarks: numerical (Phase 11)", () => {
  const q = Quantity.of(4, "m");
  bench("power m^2", () => {
    q.pow(2);
  });
  bench("approx equals", () => {
    Quantity.of(1, "kg").approximatelyEquals(Quantity.of(1000, "g"), { absoluteTolerance: 1e-9 });
  });
  bench("round", () => {
    q.round(0);
  });
  bench("exact equals", () => {
    q.exactEquals(Quantity.of(4, "m"));
  });
});

describe("benchmarks: systems (Phase 12)", () => {
  bench("system lookup si", () => {
    defaultUnitSystemRegistry.getSystem("si");
  });
  bench("unit lookup via system", () => {
    defaultUnitSystemRegistry.resolveWithSystem("kg", "si");
  });
  bench("cross-system kg->lb", () => {
    Quantity.of(1, "kg").to("lb");
  });
  bench("repeated registry lookup", () => {
    new UnitRegistry().resolve("kg");
  });
});

describe("benchmarks: advanced conversion (Phase 13)", () => {
  const c = parseUnit("°C");
  const k = parseUnit("K");
  bench("affine conversion repeated (cache hit)", () => {
    convert(25, c, k);
  });
  bench("linear conversion cache miss (new registry)", () => {
    const r = new UnitRegistry();
    const a = r.resolve("kg");
    const b = r.resolve("g");
    convert(1, a, b);
  });
  bench("cross-system conversion lookup", () => {
    defaultUnitSystemRegistry.resolveWithSystem("W", "si");
  });
});

describe("benchmarks: expression engine (Phase 15)", () => {
  const ctx = { intake: Quantity.of(10, "kg/day"), conc: Quantity.of(80, "mg/kg") };
  const expr = Expression.multiply(Expression.variable("intake"), Expression.variable("conc"));
  const compiled = compileExpression(expr);
  const directA = Quantity.of(10, "kg/day");
  const directB = Quantity.of(80, "mg/kg");

  bench("direct Quantity arithmetic", () => {
    directA.multiply(directB);
  });
  bench("expression evaluation (interpreted)", () => {
    evaluateExpression(expr, ctx);
  });
  bench("compiled expression evaluation", () => {
    compiled.evaluate(ctx);
  });
  bench("compiled expression batch (3 contexts)", () => {
    compiled.evaluate(ctx);
    compiled.evaluate({ intake: Quantity.of(5, "kg/day"), conc: Quantity.of(40, "mg/kg") });
    compiled.evaluate({ intake: Quantity.of(20, "kg/day"), conc: Quantity.of(160, "mg/kg") });
  });
  bench("expression compile (cached)", () => {
    compileExpression(expr);
  });
});

describe("benchmarks: conversion plans (Phase 16)", () => {
  const plan = getConversionPlan(kg, g);
  bench("conversion plan resolve (cache hit)", () => {
    getConversionPlan(kg, g);
  });
  bench("conversion via cached plan", () => {
    convertWithPlan(1, plan);
  });
  bench("conversion plan miss (fresh units)", () => {
    const r = new UnitRegistry();
    getConversionPlan(r.resolve("m"), r.resolve("cm"));
  });
});

describe("benchmarks: universal dimension (Phase 14)", () => {
  const mDim = Dim.Mass;
  const lDim = Dim.Length;
  bench("dimension multiply", () => {
    multiplyDim(mDim, lDim);
  });
  bench("dimension divide", () => {
    divideDim(mDim, lDim);
  });
  bench("dimension pow", () => {
    powDim(lDim, 2);
  });
  bench("dimension equality", () => {
    dimensionsEqual(mDim, lDim);
  });
  bench("dimension canonical key", () => {
    dimensionKey({ M: 1, L: 1, T: -2 });
  });
});

describe("benchmarks: parser advanced (Phase 18)", () => {
  bench("parse unicode µm", () => {
    parseUnit("µm");
  });
  bench("parse strict kg·m/s²", () => {
    parseUnit("kg·m/s²", undefined, { strict: true });
  });
  bench("canonicalization (canonicalUnitKey)", () => {
    canonicalUnitKey(kg);
  });
  bench("parse cache miss (fresh registry)", () => {
    parseUnit("kg", new UnitRegistry());
  });
  bench("parse malformed (InvalidUnitExpressionError path)", () => {
    try {
      parseUnit("kg//s");
    } catch {
      void 0;
    }
  });
});

describe("benchmarks: quantity math & measurement (Phase 19/20)", () => {
  const area = Quantity.of(9, "m^2");
  const ma = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
  const mb = Measurement.of(Quantity.of(5, "kg"), Quantity.of(0.1, "kg"));
  bench("Quantity.sqrt", () => {
    area.sqrt();
  });
  bench("Quantity.reciprocal", () => {
    Quantity.of(2, "s").reciprocal();
  });
  bench("Quantity dimensionless sin", () => {
    Quantity.of(0.5, "fraction").sin();
  });
  bench("Measurement.add (quadrature)", () => {
    ma.add(mb);
  });
  bench("Measurement.multiply (relative quadrature)", () => {
    ma.multiply(mb);
  });
  bench("sigfig rendering", () => {
    toSignificantFigures(12345.6789, 4);
  });
  bench("engineering notation", () => {
    toEngineeringNotation(12345.6789, 4);
  });
});

describe("benchmarks: semantic kinds vs plain Quantity (Phase 22)", () => {
  const plain = Quantity.of(10, "kg");
  const other = Quantity.of(5, "kg");
  const angleReg = createRegistry({ packs: [ANGLE_PACK] });
  bench("Quantity.add (dimensional-only default)", () => {
    plain.add(other);
  });
  bench("Quantity.add (semantic-aware)", () => {
    plain.add(other, { semanticPolicy: "semantic-aware" });
  });
  bench("kind compatibility check", () => {
    areKindsCompatible("activity", "frequency", "semantic-aware");
  });
  bench("Quantity construction with kind metadata", () => {
    Quantity.of(1.5, "rad", angleReg);
  });
});

describe("benchmarks: unit algebra and formulas (Phase 23/24)", () => {
  const siOnly = createRegistry({ packs: [SI_PACK] });
  const forceDef = defineFormula(
    {
      id: "bench_force",
      expression: Expression.multiply(Expression.variable("mass"), Expression.variable("accel")),
      inputs: { mass: { dimension: "kg" }, accel: { dimension: "m/s^2" } },
      outputName: "force",
    },
    { registry: siOnly },
  );
  const compiled = compileFormula(forceDef, { registry: siOnly });
  const ctx = { mass: Quantity.of(10, "kg"), accel: Quantity.of(9.81, "m/s^2", siOnly) };
  bench("parseUnitExpression + canonicalize", () => {
    unitExprKey(parseUnitExpression("kg*m/s^2", siOnly));
  });
  bench("equivalentUnits (N vs kg·m/s²)", () => {
    equivalentUnits(parseUnitExpression("N", siOnly), parseUnitExpression("kg*m/s^2", siOnly));
  });
  bench("compiled formula evaluate", () => {
    compiled.evaluate(ctx);
  });
  bench("defineFormula (validation path)", () => {
    defineFormula(
      {
        id: "bench_tmp",
        expression: Expression.add(Expression.variable("a"), Expression.variable("b")),
        inputs: { a: { dimension: "kg" }, b: { dimension: "kg" } },
      },
      { registry: siOnly },
    );
  });
});

describe("benchmarks: measurements and constants (Phase 25/26)", () => {
  const siOnly = createRegistry({ packs: [SI_PACK] });
  const m10 = BenchMeasurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
  const m5 = BenchMeasurement.of(Quantity.of(5, "kg"), Quantity.of(0.1, "kg"));
  const mForm = defineFormula(
    {
      id: "bench_mforce",
      expression: Expression.multiply(Expression.variable("mass"), Expression.variable("accel")),
      inputs: { mass: { dimension: "kg" }, accel: { dimension: "m/s^2" } },
      outputName: "force",
    },
    { registry: siOnly },
  );
  const mCompiled = compileFormula(mForm, { registry: siOnly });
  const mCtx = { mass: m10, accel: BenchMeasurement.of(Quantity.of(9.81, "m/s^2", siOnly), 0.01) };
  const qCtx = { mass: Quantity.of(10, "kg"), accel: Quantity.of(9.81, "m/s^2", siOnly) };
  const constReg = createStandardConstantRegistry({ units: siOnly });
  const constPayload = JSON.stringify(serializeConstantRegistry(constReg));
  bench("Measurement creation", () => {
    BenchMeasurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
  });
  bench("Measurement arithmetic (add)", () => {
    m10.add(m5);
  });
  bench("Measurement arithmetic (multiply)", () => {
    m10.multiply(m5);
  });
  bench("Measurement serialization round-trip", () => {
    deserializeMeasurement(JSON.parse(JSON.stringify(serializeMeasurement(m10))));
  });
  bench("formula evaluation with Quantity", () => {
    mCompiled.evaluate(qCtx);
  });
  bench("formula evaluation with Measurement", () => {
    mCompiled.evaluate(mCtx);
  });
  bench("constant lookup", () => {
    constReg.require("c");
  });
  bench("constant alias lookup", () => {
    constReg.require("lightspeed");
  });
  bench("constant registry serialization round-trip", () => {
    deserializeConstantRegistry(JSON.parse(constPayload), { units: siOnly });
  });
});

describe("benchmarks: statistics (Phase 27)", () => {
  const m = (v: number, u: number): Measurement =>
    Measurement.of(Quantity.of(v, "m"), Quantity.of(u, "m"));
  const series = MeasurementSeries.of([m(1, 0.1), m(2, 0.2), m(3, 0.3), m(4, 0.4)]);
  const cov = CovarianceMatrix.fromData(["a", "b"], "m", [
    [0.04, 0.01],
    [0.01, 0.09],
  ]);
  const expr = Expression.add(Expression.variable("a"), Expression.variable("b"));
  const bindings = { a: m(10, 0.3), b: m(5, 0.4) };
  const comps = [
    { id: "a", standardUncertainty: Quantity.of(3, "g") },
    { id: "b", standardUncertainty: Quantity.of(4, "g") },
  ];
  bench("measurement creation", () => {
    Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
  });
  bench("series mean", () => {
    series.mean();
  });
  bench("series variance", () => {
    series.variance();
  });
  bench("uncertainty combination", () => {
    combineUncertainties(comps);
  });
  bench("covariance correlation lookup", () => {
    cov.correlation("a", "b");
  });
  bench("covariance propagation (add)", () => {
    propagateWithCovariance(expr, bindings, cov);
  });
  bench("series serialization round-trip", () => {
    MeasurementSeries.deserialize(JSON.parse(JSON.stringify(series.serialize())));
  });
});

describe("benchmarks: standards profiles (Phase 28)", () => {
  const siImpReg = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK] });
  const regs = new ProfileRegistry();
  registerStandardProfiles(regs);
  bench("system lookup (imperial)", () => {
    defaultUnitSystemRegistry.getSystem("imperial");
  });
  bench("profile lookup", () => {
    regs.get("si");
  });
  bench("preferred-unit lookup", () => {
    void regs.get("si").preferredUnits?.["M^1"];
  });
  bench("cross-system conversion (N→lbf via profile)", () => {
    normalizeToSystem(Quantity.of(1, "N", siImpReg), IMPERIAL_SYSTEM, {
      profile: regs.get("imperial"),
      registry: siImpReg,
    });
  });
  bench("automatic unit selection", () => {
    selectUnitForMagnitude(Quantity.of(1500, "m", siImpReg), { registry: siImpReg });
  });
  bench("context creation + formatting", () => {
    formatWithContext(Quantity.of(1500, "m", siImpReg), {
      unitSystem: "si",
      profiles: regs,
      registry: siImpReg,
    });
  });
  bench("repeated formatting (formatter cache path)", () => {
    formatQuantity(Quantity.of(1, "N", siImpReg));
  });
});

describe("benchmarks: unit systems & packs (Phase 17)", () => {
  const siReg = createRegistry({ packs: [SI_PACK] });
  const siImpReg = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK] });
  bench("pack registry parse (N via SI pack)", () => {
    parseUnit("N", siReg);
  });
  bench("cross-system conversion (N→lbf)", () => {
    Quantity.of(1, "N", siImpReg).to("lbf", siImpReg);
  });
  bench("system lookup (imperial)", () => {
    defaultUnitSystemRegistry.getSystem("imperial");
  });
});

describe("benchmarks: interoperability (Phase 29/30)", () => {
  const siImpReg = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK] });
  const manifest = {
    id: "bench-ext",
    version: "1.0.0",
    units: [{ symbol: "benchm", dimension: { L: 1 }, toBaseFactor: 1, label: "bench" }],
  };
  const q = Quantity.of(1500, "m", siImpReg);
  let benchId = 0;
  bench("extension validate (clean manifest)", () => {
    validateExtension(manifest, { units: new UnitRegistry([]) });
  });
  bench("extension apply (1 unit, atomic)", () => {
    benchId += 1;
    applyExtension({ ...manifest, id: `bench-ext-${benchId}` }, { units: new UnitRegistry([]) });
  });
  bench("ambiguity resolution (unique hit)", () => {
    resolveAmbiguous("m", {
      sources: [{ namespace: "core", registry: siImpReg }],
    });
  });
  bench("interchange round-trip (quantity)", () => {
    fromInterchange(JSON.parse(JSON.stringify(toInterchange(q))));
  });
  bench("canonicalize unit text", () => {
    canonicalizeUnitText("kg*m/s^2", siImpReg);
  });
  bench("format preset (compact)", () => {
    formatWithPreset(q, "compact");
  });
  bench("comparison policy (combined)", () => {
    compareQuantities(q, Quantity.of(1500, "m", siImpReg), "combined");
  });
  bench("migration chain (2 steps)", () => {
    migrateSerialized(
      { version: 0, type: "thing", value: 1 },
      [
        {
          kind: "thing",
          fromVersion: 0,
          toVersion: 1,
          migrate: (d) => ({ ...(d as object), version: 1 }),
        },
        {
          kind: "thing",
          fromVersion: 1,
          toVersion: 2,
          migrate: (d) => ({ ...(d as object), version: 2 }),
        },
      ],
      2,
      "thing",
    );
  });
  bench("parse namespaced symbol", () => {
    parseNamespacedSymbol("si:kg");
  });
});
