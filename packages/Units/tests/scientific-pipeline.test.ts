/**
 * tests/scientific-pipeline.test.ts — Phase 24.28: full-pipeline
 * integration proving the architecture works as one coherent system:
 *
 *   unit text → UnitExpr algebra → equivalence → formula → validation →
 *   compilation → dependency graph → evaluation → conversion →
 *   formatting → serialization round-trip.
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Dim,
  Expression,
  parseUnitExpression,
  equivalentUnits,
  formatUnitExpr,
  defineFormula,
  compileFormula,
  createDependencyGraph,
  createPipeline,
  serializeFormula,
  deserializeFormula,
  formatQuantity,
  serializeQuantity,
  deserializeQuantity,
  createRegistry,
  SI_PACK,
  ANGLE_PACK,
} from "../src/index.js";

const reg = createRegistry({ packs: [SI_PACK, ANGLE_PACK] });
const O = { registry: reg };
const { variable: v, multiply: mul, divide: div, call: fn } = Expression;

describe("scientific pipeline integration", () => {
  it("unit text → algebra → formula → graph → conversion → format → serde", () => {
    // 1. Unit text parses to structural algebra…
    const newtonExpr = parseUnitExpression("N", reg);
    const composedExpr = parseUnitExpression("kg*m/s^2", reg);
    // 2. …with proven equivalence and canonical rendering…
    expect(equivalentUnits(newtonExpr, composedExpr)).toBe(true);
    expect(formatUnitExpr(composedExpr)).toBe("kg·m/s²");

    // 3. Formulas validate dimensionally (force, then work from force)…
    const force = defineFormula(
      {
        id: "force",
        expression: mul(v("mass"), v("accel")),
        inputs: { mass: { dimension: Dim.Mass }, accel: { dimension: "m/s^2" } },
        outputName: "force",
        outputUnit: "N",
        expectedDimension: { M: 1, L: 1, T: -2 },
      },
      O,
    );
    const work = defineFormula(
      {
        id: "work",
        expression: mul(v("force"), v("distance")),
        inputs: { force: { dimension: "N" }, distance: { dimension: "m" } },
        outputName: "work",
        expectedDimension: { M: 1, L: 2, T: -2 },
      },
      O,
    );

    // 4. …compile once, run as a pipeline…
    const pipeline = createPipeline([force, work], O);
    const run = pipeline.run({
      mass: Quantity.of(10, "kg"),
      accel: Quantity.of(9.81, "m/s^2", reg),
      distance: Quantity.of(2, "m"),
    });
    expect(run.outputs["force"]!.to("N", reg).value).toBeCloseTo(98.1, 9);

    // 5. …convert, format and serialize the result…
    const workInJoules = run.outputs["work"]!.to("N·m", reg);
    expect(formatQuantity(workInJoules)).toContain("N");
    const restored = deserializeQuantity(
      JSON.parse(JSON.stringify(serializeQuantity(workInJoules))),
      reg,
    );
    expect(restored.to("N·m", reg).value).toBeCloseTo(workInJoules.to("N·m", reg).value, 9);

    // 6. …and formulas + graph serialize for storage.
    const reloaded = deserializeFormula(JSON.parse(JSON.stringify(serializeFormula(force))), O);
    expect(reloaded.id).toBe("force");
    const graph = createDependencyGraph([reloaded, work], O);
    expect(graph.evaluationOrder()).toEqual(["force", "work"]);
  });

  it("angle-kind pipeline: arc length = radius × angle with semantic gate", () => {
    const arc = defineFormula(
      {
        id: "arc_length",
        expression: mul(v("radius"), v("angle")),
        inputs: { radius: { dimension: "m" }, angle: { dimension: "1", kind: "angle" } },
        outputName: "arc",
      },
      { ...O, semanticPolicy: "semantic-aware" },
    );
    const compiled = compileFormula(arc, O);
    const ok = compiled.evaluate({
      radius: Quantity.of(2, "m"),
      angle: Quantity.of(Math.PI, "rad", reg),
    });
    if (!(ok instanceof Quantity)) throw new Error("expected Quantity");
    expect(ok.to("m").value).toBeCloseTo(2 * Math.PI, 9);
    // Same dimension but wrong kind (Hz is T⁻¹… use a dimensionless impostor):
    // a kind-less fraction passes the wildcard, but an explicitly wrong kind fails.
    const wrongKind = Quantity.of(0.5, "rad", reg).withKind("solid-angle");
    expect(() => compiled.evaluate({ radius: Quantity.of(2, "m"), angle: wrongKind })).toThrow();
  });

  it("pendulum period: T = 2π√(L/g) end to end", () => {
    const period = defineFormula(
      {
        id: "pendulum",
        expression: mul(
          Expression.literal(2 * Math.PI, "1"),
          fn("sqrt", [div(v("length"), v("gravity"))]),
        ),
        inputs: { length: { dimension: "m" }, gravity: { dimension: "m/s^2" } },
        outputName: "period",
      },
      O,
    );
    const r = compileFormula(period, O).evaluate({
      length: Quantity.of(1, "m"),
      gravity: Quantity.of(9.81, "m/s^2", reg),
    });
    if (!(r instanceof Quantity)) throw new Error("expected Quantity");
    expect(r.to("s").value).toBeCloseTo(2.006, 3);
  });
});
