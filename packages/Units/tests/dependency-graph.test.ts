/**
 * tests/dependency-graph.test.ts — Phase 24: Dependency Graphs &
 * Scientific Computation Pipelines.
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Measurement,
  Dim,
  Expression,
  defineFormula,
  createDependencyGraph,
  deserializeDependencyGraph,
  createPipeline,
  createRegistry,
  SI_PACK,
  type Formula,
} from "../src/index.js";
import { CyclicDependencyError, ExpressionLimitError, FormulaError } from "../src/errors/index.js";

const { variable: v, literal: lit, add, multiply: mul, divide: div, power: pow } = Expression;

const siReg = createRegistry({ packs: [SI_PACK] });
const O = { registry: siReg };

function physicsFormulas(): { velocity: Formula; energy: Formula } {
  const velocity = defineFormula(
    {
      id: "velocity",
      expression: div(v("distance"), v("time")),
      inputs: { distance: { dimension: "m" }, time: { dimension: "s" } },
      outputName: "velocity",
    },
    O,
  );
  const energy = defineFormula(
    {
      id: "kinetic_energy",
      expression: div(mul(v("mass"), pow(v("velocity"), 2)), lit(2, "1")),
      inputs: { mass: { dimension: "kg" }, velocity: { dimension: "m/s" } },
      outputName: "energy",
    },
    O,
  );
  return { velocity, energy };
}

const baseInputs = {
  distance: Quantity.of(100, "m"),
  time: Quantity.of(10, "s"),
  mass: Quantity.of(2, "kg"),
};

// ---------------------------------------------------------------------------
// 24.8/24.9 Construction, ordering, cycles, missing inputs
// ---------------------------------------------------------------------------

describe("graph construction and ordering", () => {
  it("topological order is deterministic (velocity before energy)", () => {
    const { velocity, energy } = physicsFormulas();
    const g = createDependencyGraph([energy, velocity]); // input order irrelevant
    expect(g.evaluationOrder()).toEqual(["velocity", "kinetic_energy"]);
    expect(g.diagnostics().requiredInputs).toEqual(["distance", "mass", "time"]);
    expect(g.diagnostics().outputNames).toEqual(["energy", "velocity"]);
    expect(g.diagnostics().edgeCount).toBe(1);
  });

  it("independent formulas order alphabetically", () => {
    const a = defineFormula(
      {
        id: "b_formula",
        expression: add(v("x"), lit(1, "1")),
        inputs: { x: { dimension: "1" } },
        outputName: "b_out",
      },
      O,
    );
    const b = defineFormula(
      {
        id: "a_formula",
        expression: add(v("y"), lit(1, "1")),
        inputs: { y: { dimension: "1" } },
        outputName: "a_out",
      },
      O,
    );
    expect(createDependencyGraph([a, b]).evaluationOrder()).toEqual(["a_formula", "b_formula"]);
  });

  it("cycles fail with the cycle path (2-cycle and self-loop)", () => {
    const mk = (id: string, dep: string, output: string) =>
      defineFormula(
        {
          id,
          expression: add(v(dep), lit(1, "1")),
          inputs: { [dep]: { dimension: "1" } },
          outputName: output,
        },
        O,
      );
    expect(() => createDependencyGraph([mk("a", "b", "a"), mk("b", "a", "b")])).toThrow(
      CyclicDependencyError,
    );
    try {
      createDependencyGraph([mk("a", "b", "a"), mk("b", "a", "b")]);
    } catch (error) {
      expect((error as Error).message).toContain("a -> b -> a");
    }
    expect(() => createDependencyGraph([mk("s", "s", "s")])).toThrow(CyclicDependencyError);
  });

  it("duplicate ids/outputs and empty graphs fail", () => {
    const { velocity } = physicsFormulas();
    expect(() => createDependencyGraph([velocity, velocity])).toThrow(FormulaError);
    const clone = defineFormula(
      {
        id: "velocity2",
        expression: div(v("distance"), v("time")),
        inputs: { distance: { dimension: "m" }, time: { dimension: "s" } },
        outputName: "velocity",
      },
      O,
    );
    expect(() => createDependencyGraph([velocity, clone])).toThrow(FormulaError);
    expect(() => createDependencyGraph([])).toThrow(FormulaError);
  });

  it("missing dependencies and unexpected inputs fail at evaluation", () => {
    const { velocity, energy } = physicsFormulas();
    const g = createDependencyGraph([velocity, energy]);
    expect(() => g.evaluate({ distance: baseInputs.distance })).toThrow(FormulaError);
    expect(() => g.evaluate({ ...baseInputs, ghost: Quantity.of(1, "kg") })).toThrow(FormulaError);
  });
});

// ---------------------------------------------------------------------------
// 24.10/24.11 Incremental recomputation and invalidation
// ---------------------------------------------------------------------------

describe("incremental recomputation", () => {
  it("mass → force → work recomputes only downstream nodes", () => {
    const force = defineFormula(
      {
        id: "force",
        expression: mul(v("mass"), v("accel")),
        inputs: { mass: { dimension: "kg" }, accel: { dimension: "m/s^2" } },
        outputName: "force",
      },
      O,
    );
    const work = defineFormula(
      {
        id: "work",
        expression: mul(v("force"), v("distance")),
        inputs: { force: { dimension: "N" }, distance: { dimension: "m" } },
        outputName: "work",
      },
      O,
    );
    const g = createDependencyGraph([work, force]);
    const first = g.evaluate({
      mass: Quantity.of(10, "kg"),
      accel: Quantity.of(2, "m/s^2"),
      distance: Quantity.of(5, "m"),
    });
    expect(first.outputs["force"]!.to("N", siReg).value).toBeCloseTo(20, 9);

    // Change an unrelated-side input? There is none here — change distance:
    // force must be reused by reference, work recomputed.
    const second = g.reevaluate(first, { distance: Quantity.of(10, "m") });
    expect(second.outputs["force"]).toBe(first.outputs["force"]); // same ref: not recomputed
    expect(second.outputs["work"]!.to("N·m", siReg).value).toBeCloseTo(
      (first.outputs["work"]!.to("N·m", siReg).value as number) * 2,
      6,
    );

    // Change mass: both force and work recompute.
    const third = g.reevaluate(first, { mass: Quantity.of(20, "kg") });
    expect(third.outputs["force"]).not.toBe(first.outputs["force"]);
    expect(third.outputs["force"]!.to("N", siReg).value).toBeCloseTo(40, 9);
  });

  it("unknown recomputation inputs throw", () => {
    const { velocity } = physicsFormulas();
    const g = createDependencyGraph([velocity]);
    const first = g.evaluate({ distance: baseInputs.distance, time: baseInputs.time });
    expect(() => g.reevaluate(first, { nope: Quantity.of(1, "kg") } as never)).toThrow(
      FormulaError,
    );
  });
});

// ---------------------------------------------------------------------------
// 24.12 Pipelines expose stages, validation, diagnostics
// ---------------------------------------------------------------------------

describe("pipelines", () => {
  it("distance → velocity → energy exposes stages and validation", () => {
    const { velocity, energy } = physicsFormulas();
    const pipeline = createPipeline([velocity, energy]);
    expect(pipeline.stages).toEqual(["velocity", "kinetic_energy"]);
    const run = pipeline.run(baseInputs);
    expect(run.stages.map((s) => s.formula)).toEqual(["velocity", "kinetic_energy"]);
    expect(run.stages[0]!.output).toBe("velocity");
    expect(run.stages[1]!.output).toBe("energy");
    expect(run.outputs["velocity"]!.to("m/s").value).toBeCloseTo(10, 9);
    expect(run.validation.requiredInputs).toEqual(["distance", "mass", "time"]);
    expect(run.intermediates["energy"]).toBeDefined();
    expect(run.consumedInputs).toEqual(["distance", "mass", "time"]);

    const rerun = pipeline.reevaluate(run, { mass: Quantity.of(4, "kg") });
    expect(rerun.outputs["velocity"]).toBe(run.outputs["velocity"]);
    expect(rerun.stages.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 24.24 Graph serialization (data-only, revalidated)
// ---------------------------------------------------------------------------

describe("graph serialization", () => {
  it("round-trips structure and revalidates formulas", () => {
    const { velocity, energy } = physicsFormulas();
    const g = createDependencyGraph([velocity, energy]);
    const restored = deserializeDependencyGraph(JSON.parse(JSON.stringify(g.serialize())));
    expect(restored.evaluationOrder()).toEqual(["velocity", "kinetic_energy"]);
    const r = restored.evaluate(baseInputs);
    expect(r.outputs["velocity"]!.to("m/s").value).toBeCloseTo(10, 9);
  });

  it("rejects malformed payloads", () => {
    expect(() => deserializeDependencyGraph(null)).toThrow(FormulaError);
    expect(() =>
      deserializeDependencyGraph({ version: 2, type: "dependency-graph", formulas: [] }),
    ).toThrow(FormulaError);
    expect(() =>
      deserializeDependencyGraph({ version: 1, type: "dependency-graph", formulas: [] }),
    ).toThrow(FormulaError);
    expect(() =>
      deserializeDependencyGraph({ version: 1, type: "dependency-graph", formulas: [{ nope: 1 }] }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 24.25 Graph limits; Measurement through pipelines
// ---------------------------------------------------------------------------

describe("graph limits and measurement flow", () => {
  it("caps graph size and per-formula dependencies", () => {
    const formulas: Formula[] = [];
    for (let i = 0; i < 5; i++) {
      formulas.push(
        defineFormula({
          id: `f${i}`,
          expression: add(v("x"), lit(1, "1")),
          inputs: { x: { dimension: "1" } },
          outputName: `o${i}`,
        }),
      );
    }
    expect(() => createDependencyGraph(formulas, { limits: { maxGraphNodes: 2 } })).toThrow(
      ExpressionLimitError,
    );
    const wideInputs: Record<string, { dimension: string }> = {};
    let expr = v("a0");
    for (let i = 1; i < 10; i++) {
      wideInputs[`a${i}`] = { dimension: "1" };
      expr = add(expr, v(`a${i}`));
    }
    wideInputs["a0"] = { dimension: "1" };
    const wide = defineFormula({
      id: "wide",
      expression: expr,
      inputs: wideInputs,
      outputName: "w",
    });
    expect(() => createDependencyGraph([wide], { limits: { maxDependencies: 2 } })).toThrow(
      ExpressionLimitError,
    );
  });

  it("measurements flow through graphs with uncertainty", () => {
    const force = defineFormula(
      {
        id: "force",
        expression: mul(v("mass"), v("accel")),
        inputs: { mass: { dimension: Dim.Mass }, accel: { dimension: "m/s^2" } },
        outputName: "force",
      },
      O,
    );
    const g = createDependencyGraph([force]);
    const m = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
    const r = g.evaluate({ mass: m, accel: Quantity.of(10, "m/s^2") });
    const forceOut = r.outputs["force"];
    if (!(forceOut instanceof Measurement)) throw new Error("expected Measurement");
    expect(forceOut.relativeUncertainty()).toBeCloseTo(0.02, 9);
  });
});
