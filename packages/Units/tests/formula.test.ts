/**
 * tests/formula.test.ts — Phase 24: Formula Engine (define, validate,
 * compile, evaluate, functions, trace, partial eval, serialization).
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Measurement,
  Dim,
  Expression,
  defineFormula,
  compileFormula,
  evaluateFormula,
  formulaVariables,
  analyzeDimensions,
  serializeFormula,
  deserializeFormula,
  serializeExpression,
  deserializeExpression,
  compileExpression,
  evaluateExpression,
  inferExpressionDimension,
  createRegistry,
  SI_PACK,
  ANGLE_PACK,
  RADIATION_PACK,
  FunctionRegistry,
  defaultFunctionRegistry,
  formatQuantity,
} from "../src/index.js";
import { ExpressionError, FormulaError, ExpressionLimitError } from "../src/errors/index.js";

const reg = createRegistry({ packs: [SI_PACK, ANGLE_PACK] });
const radReg = createRegistry({ packs: [SI_PACK, RADIATION_PACK] });
const {
  variable: v,
  literal: lit,
  add,
  multiply: mul,
  divide: div,
  power: pow,
  call: fn,
} = Expression;
const O = { registry: reg };

// ---------------------------------------------------------------------------
// 24.4/24.5 Definition, validation, evaluation
// ---------------------------------------------------------------------------

describe("formula definition and evaluation", () => {
  it("force = mass × acceleration → 98.1 N", () => {
    const f = defineFormula(
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
    const r = evaluateFormula(
      f,
      { mass: Quantity.of(10, "kg"), accel: Quantity.of(9.81, "m/s^2", reg) },
      O,
    );
    if (!(r instanceof Quantity)) throw new Error("expected Quantity");
    expect(r.value).toBeCloseTo(98.1, 9);
    expect(r.unit.symbol).toBe("N");
  });

  it("velocity = distance / time with outputUnit conversion", () => {
    const f = defineFormula(
      {
        id: "velocity",
        expression: div(v("distance"), v("time")),
        inputs: { distance: { dimension: "m" }, time: { dimension: "s" } },
        outputUnit: "km/h",
      },
      O,
    );
    const r = evaluateFormula(
      f,
      { distance: Quantity.of(100, "m"), time: Quantity.of(10, "s") },
      O,
    );
    if (!(r instanceof Quantity)) throw new Error("expected Quantity");
    expect(r.value).toBeCloseTo(36, 9);
  });

  it("density = mass / volume; energy = m·v²/2", () => {
    const density = defineFormula(
      {
        id: "density",
        expression: div(v("mass"), v("volume")),
        inputs: { mass: { dimension: "kg" }, volume: { dimension: "m^3" } },
      },
      O,
    );
    const r = evaluateFormula(
      density,
      { mass: Quantity.of(1000, "kg"), volume: Quantity.of(1, "m^3") },
      O,
    );
    if (!(r instanceof Quantity)) throw new Error("expected Quantity");
    expect(r.to("kg/m^3", reg).value).toBeCloseTo(1000, 9);

    const energy = defineFormula(
      {
        id: "energy",
        expression: div(mul(v("mass"), pow(v("velocity"), 2)), lit(2, "1")),
        inputs: { mass: { dimension: "kg" }, velocity: { dimension: "m/s" } },
      },
      O,
    );
    const e = evaluateFormula(
      energy,
      { mass: Quantity.of(2, "kg"), velocity: Quantity.of(10, "m/s") },
      O,
    );
    if (!(e instanceof Quantity)) throw new Error("expected Quantity");
    expect(e.toBase().value).toBeCloseTo(100 * 86400 * 86400, 3);
  });

  it("plain numbers bind as dimensionless", () => {
    const f = defineFormula(
      {
        id: "double",
        expression: mul(v("x"), lit(2, "1")),
        inputs: { x: { dimension: "1" } },
      },
      O,
    );
    const r = evaluateFormula(f, { x: 21 }, O);
    if (!(r instanceof Quantity)) throw new Error("expected Quantity");
    expect(r.value).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 24.4 Dimensional validation rejects before execution
// ---------------------------------------------------------------------------

describe("dimensional validation", () => {
  it.each([
    ["length + time", add(v("l"), v("t")), { l: "m", t: "s" }],
    ["mass + energy", add(v("m"), v("e")), { m: "kg", e: "J" }],
    ["velocity + force", add(v("u"), v("f")), { u: "m/s", f: "N" }],
  ])("rejects %s at define time", (_label, expression, dims) => {
    const inputs = Object.fromEntries(Object.entries(dims).map(([k, d]) => [k, { dimension: d }]));
    expect(() => defineFormula({ id: "bad", expression, inputs }, O)).toThrow(FormulaError);
  });

  it("expectedDimension mismatch fails validation", () => {
    expect(() =>
      defineFormula(
        {
          id: "bad",
          expression: div(v("distance"), v("time")),
          inputs: { distance: { dimension: "m" }, time: { dimension: "s" } },
          expectedDimension: { L: 1, T: -2 },
        },
        O,
      ),
    ).toThrow(FormulaError);
  });

  it("unbound variables, bad ids, bad declarations fail fast", () => {
    expect(() => defineFormula({ id: "x", expression: v("ghost"), inputs: {} }, O)).toThrow(
      FormulaError,
    );
    expect(() =>
      defineFormula({ id: "9bad", expression: v("x"), inputs: { x: { dimension: "1" } } }, O),
    ).toThrow(FormulaError);
    expect(() =>
      defineFormula({ id: "x", expression: v("x"), inputs: { x: { dimension: 42 as never } } }, O),
    ).toThrow(FormulaError);
    expect(() =>
      defineFormula({ id: "x", expression: v("x"), inputs: { x: { dimension: "nope_xyz" } } }, O),
    ).toThrow(FormulaError);
  });

  it("binding checks fire at evaluation (dimension + declared kind)", () => {
    const f = defineFormula(
      {
        id: "spin",
        expression: mul(v("rate"), lit(2, "1")),
        inputs: { rate: { dimension: { T: -1 }, kind: "activity" } },
      },
      O,
    );
    expect(() => evaluateFormula(f, { rate: Quantity.of(1, "kg") }, O)).toThrow(FormulaError); // dimension first
    // Same dimension (T⁻¹) but wrong kind: Hz is frequency, not activity.
    expect(() => evaluateFormula(f, { rate: Quantity.of(60, "Hz") }, O)).toThrow(FormulaError);
    // Declared kind satisfied: Bq is activity (multiply yields base units).
    const ok = evaluateFormula(f, { rate: Quantity.of(100, "Bq", radReg) }, { registry: radReg });
    if (!(ok instanceof Quantity)) throw new Error("expected Quantity");
    expect(ok.to("Bq", radReg).value).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 24.6/24.7 Compilation and caching
// ---------------------------------------------------------------------------

describe("compilation and caching", () => {
  it("compiled formulas evaluate repeatedly without revalidation", () => {
    const f = defineFormula(
      {
        id: "force",
        expression: mul(v("mass"), v("accel")),
        inputs: { mass: { dimension: "kg" }, accel: { dimension: "m/s^2" } },
      },
      O,
    );
    const c1 = compileFormula(f, O);
    const c2 = compileFormula(f, O);
    expect(c1).toBe(c2); // cache hit (same object)
    expect(c1.key).toBe(c2.key);
    for (const m of [1, 2, 3]) {
      const r = c1.evaluate({ mass: Quantity.of(m, "kg"), accel: Quantity.of(2, "m/s^2", reg) });
      if (!(r instanceof Quantity)) throw new Error("expected Quantity");
      expect(r.value).toBe(m * 2);
    }
  });

  it("missing and unexpected bindings throw typed errors", () => {
    const f = defineFormula(
      {
        id: "f",
        expression: add(v("a"), v("b")),
        inputs: { a: { dimension: "kg" }, b: { dimension: "kg" } },
      },
      O,
    );
    const c = compileFormula(f, O);
    expect(() => c.evaluate({ a: Quantity.of(1, "kg") })).toThrow(FormulaError);
    expect(() =>
      c.evaluate({ a: Quantity.of(1, "kg"), b: Quantity.of(1, "kg"), z: 1 } as never),
    ).toThrow(FormulaError);
    expect(() => c.evaluate({ a: Quantity.of(1, "kg"), b: Quantity.of(1, "m") })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 24.3 Measurement bindings propagate uncertainty
// ---------------------------------------------------------------------------

describe("measurement bindings", () => {
  it("force with a measured mass propagates uncertainty", () => {
    const f = defineFormula(
      {
        id: "force",
        expression: mul(v("mass"), v("accel")),
        inputs: { mass: { dimension: "kg" }, accel: { dimension: "m/s^2" } },
      },
      O,
    );
    const m = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
    const r = evaluateFormula(f, { mass: m, accel: Quantity.of(10, "m/s^2", reg) }, O);
    if (!(r instanceof Measurement)) throw new Error("expected Measurement");
    expect(r.value.toBase().value).toBeCloseTo(100 * 86400 * 86400, 3);
    expect(r.uncertainty.toBase().value).toBeGreaterThan(0);
  });

  it("function calls reject Measurement bindings explicitly", () => {
    const f = defineFormula(
      {
        id: "s",
        expression: fn("sqrt", [v("x")]),
        inputs: { x: { dimension: "m^2" } },
      },
      O,
    );
    const m = Measurement.of(Quantity.of(9, "m^2"), Quantity.of(0.1, "m^2"));
    expect(() => evaluateFormula(f, { x: m }, O)).toThrow(FormulaError);
  });
});

// ---------------------------------------------------------------------------
// 24.16 Constants and 24.21 partial evaluation
// ---------------------------------------------------------------------------

describe("constants and partial evaluation", () => {
  it("E = m·c² precomputes c²; remaining variables shrink", () => {
    const f = defineFormula(
      {
        id: "e_mc2",
        expression: mul(v("m"), pow(v("c"), 2)),
        inputs: { m: { dimension: "kg" } },
        constants: { c: Quantity.of(299792458, "m/s", reg) },
      },
      O,
    );
    expect(formulaVariables(f)).toEqual(["m"]); // c folded away
    const r = evaluateFormula(f, { m: Quantity.of(1, "kg") }, O);
    if (!(r instanceof Quantity)) throw new Error("expected Quantity");
    expect(r.toBase().value).toBeGreaterThan(0);
  });

  it("defaults fill omitted optional inputs", () => {
    const f = defineFormula(
      {
        id: "greet",
        expression: mul(v("x"), v("g")),
        inputs: { x: { dimension: "1" }, g: { dimension: "1", optional: true, default: 2 } },
      },
      O,
    );
    const r = evaluateFormula(f, { x: 21 }, O);
    if (!(r instanceof Quantity)) throw new Error("expected Quantity");
    expect(r.value).toBe(42);
  });

  it("invalid constant names and values throw", () => {
    expect(() =>
      defineFormula(
        {
          id: "x",
          expression: v("x"),
          inputs: { x: { dimension: "1" } },
          constants: { "9bad": 1 },
        },
        O,
      ),
    ).toThrow(FormulaError);
  });
});

// ---------------------------------------------------------------------------
// 24.17/24.18 Functions: registry, dimensions, arity, kinds
// ---------------------------------------------------------------------------

describe("functions", () => {
  it("sqrt/abs/min/max evaluate with dimensional rules", () => {
    const root = defineFormula(
      { id: "root", expression: fn("sqrt", [v("a")]), inputs: { a: { dimension: "m^2" } } },
      O,
    );
    const r = evaluateFormula(root, { a: Quantity.of(9, "m^2") }, O);
    if (!(r instanceof Quantity)) throw new Error("expected Quantity");
    expect(r.to("m").value).toBeCloseTo(3, 12);

    const m = defineFormula(
      {
        id: "m",
        expression: fn("min", [v("a"), v("b")]),
        inputs: { a: { dimension: "kg" }, b: { dimension: "kg" } },
      },
      O,
    );
    const r2 = evaluateFormula(m, { a: Quantity.of(3, "kg"), b: Quantity.of(5, "kg") }, O);
    if (!(r2 instanceof Quantity)) throw new Error("expected Quantity");
    expect(r2.value).toBe(3);
  });

  it("sin(length) and exp(length) fail; sin(angle) passes with kinds", () => {
    expect(() =>
      defineFormula(
        { id: "s", expression: fn("sin", [v("x")]), inputs: { x: { dimension: "m" } } },
        O,
      ),
    ).toThrow(FormulaError);
    expect(() =>
      defineFormula(
        { id: "e", expression: fn("exp", [v("x")]), inputs: { x: { dimension: "kg" } } },
        O,
      ),
    ).toThrow(FormulaError);
    const ok = defineFormula(
      {
        id: "s",
        expression: fn("sin", [v("x")]),
        inputs: { x: { dimension: "1", kind: "angle" } },
      },
      { ...O, semanticPolicy: "semantic-aware" },
    );
    const r = evaluateFormula(ok, { x: Quantity.of(Math.PI / 2, "rad", reg) }, O);
    if (!(r instanceof Quantity)) throw new Error("expected Quantity");
    expect(r.value).toBeCloseTo(1, 12);
    // Kind-less fraction arg under semantic-aware: unknown passes (no claim).
    const r2 = evaluateFormula(ok, { x: Quantity.of(0, "fraction", reg) }, O);
    if (!(r2 instanceof Quantity)) throw new Error("expected Quantity");
    expect(r2.value).toBe(0);
  });

  it("unknown functions and arity violations throw", () => {
    expect(() =>
      defineFormula(
        { id: "u", expression: fn("nope_fn", [v("x")]), inputs: { x: { dimension: "1" } } },
        O,
      ),
    ).toThrow();
    expect(() =>
      defineFormula(
        {
          id: "a",
          expression: fn("sin", [v("x"), v("y")]),
          inputs: { x: { dimension: "1" }, y: { dimension: "1" } },
        },
        O,
      ),
    ).toThrow();
  });

  it("host function registration is validated and usable", () => {
    const functions = new FunctionRegistry([]);
    functions.register({
      name: "double",
      minArity: 1,
      maxArity: 1,
      evaluate: (args) => args[0]!.scale(2),
      inferDimension: (dims) => dims[0]!,
    });
    expect(functions.list()).toEqual(["double"]);
    expect(() =>
      functions.register({
        name: "double",
        minArity: 1,
        maxArity: 1,
        evaluate: (args) => args[0]!,
        inferDimension: (dims) => dims[0]!,
      }),
    ).toThrow(ExpressionError);
    expect(() =>
      functions.register({
        name: "Bad",
        minArity: 1,
        maxArity: 1,
        evaluate: (a) => a[0]!,
        inferDimension: (d) => d[0]!,
      }),
    ).toThrow(ExpressionError);
    const f = defineFormula(
      { id: "d", expression: fn("double", [v("x")]), inputs: { x: { dimension: "kg" } } },
      { registry: reg, functions },
    );
    const r = evaluateFormula(f, { x: Quantity.of(5, "kg") }, { registry: reg, functions });
    if (!(r instanceof Quantity)) throw new Error("expected Quantity");
    expect(r.value).toBe(10);
    expect(defaultFunctionRegistry.list()).toContain("sqrt");
  });
});

// ---------------------------------------------------------------------------
// Call nodes in the expression engine itself (compile/infer/serialize)
// ---------------------------------------------------------------------------

describe("expression call nodes", () => {
  it("evaluate, infer, compile and serialize call nodes", () => {
    const expr = fn("sqrt", [mul(v("x"), v("x"))]);
    const r = evaluateExpression(expr, { x: Quantity.of(4, "m") }, O);
    expect(r.to("m").value).toBeCloseTo(4, 12);
    expect(inferExpressionDimension(expr, { x: Dim.Length }, O)).toEqual(Dim.Length);
    const c = compileExpression(expr, O);
    expect(c.evaluate({ x: Quantity.of(9, "m") }).to("m").value).toBeCloseTo(9, 12);
    expect(deserializeExpression(JSON.parse(JSON.stringify(serializeExpression(expr))))).toEqual(
      expr,
    );
  });

  it("unknown functions, arity violations and Measurement calls fail", () => {
    expect(() =>
      evaluateExpression(fn("nope_fn", [v("x")]), { x: Quantity.of(1, "fraction") }, O),
    ).toThrow(ExpressionError);
    expect(() =>
      evaluateExpression(
        fn("sin", [v("x"), v("y")]),
        { x: Quantity.of(0, "fraction"), y: Quantity.of(0, "fraction") },
        O,
      ),
    ).toThrow(ExpressionError);
    expect(() => fn("Bad-Name", [v("x")])).toThrow(ExpressionError);
    expect(() => inferExpressionDimension(fn("sin", [v("x")]), { x: Dim.Length }, O)).toThrow(
      ExpressionError,
    );
  });
});

// ---------------------------------------------------------------------------
// 24.13/24.14 Expected outputs; 24.15 semantic validation
// ---------------------------------------------------------------------------

describe("expected outputs", () => {
  it("outputUnit must be compatible; per-call override works", () => {
    const f = defineFormula(
      {
        id: "v",
        expression: div(v("d"), v("t")),
        inputs: { d: { dimension: "m" }, t: { dimension: "s" } },
      },
      O,
    );
    const c = compileFormula(f, O);
    const kmh = c.evaluate(
      { d: Quantity.of(100, "m"), t: Quantity.of(10, "s") },
      { outputUnit: "km/h" },
    );
    if (!(kmh instanceof Quantity)) throw new Error("expected Quantity");
    expect(kmh.value).toBeCloseTo(36, 9);
    expect(() =>
      c.evaluate({ d: Quantity.of(100, "m"), t: Quantity.of(10, "s") }, { outputUnit: "kg" }),
    ).toThrow();
    expect(() =>
      defineFormula(
        {
          id: "v2",
          expression: div(v("d"), v("t")),
          inputs: { d: { dimension: "m" }, t: { dimension: "s" } },
          outputUnit: "kg",
        },
        O,
      ),
    ).toThrow(FormulaError);
  });

  it("expectedKind gates dose confusion", () => {
    // Absorbed dose in, equivalent dose expected → define-time rejection
    // (semanticPolicy lives in the options argument, not the definition).
    expect(() =>
      defineFormula(
        {
          id: "dose",
          expression: v("d"),
          inputs: { d: { dimension: "J/kg", kind: "absorbed-dose" } },
          expectedKind: "equivalent-dose",
        },
        { ...O, semanticPolicy: "semantic-aware" },
      ),
    ).toThrow(FormulaError);
  });

  it("…while identical kinds pass expectedKind", () => {
    const f = defineFormula(
      {
        id: "dose",
        expression: v("d"),
        inputs: { d: { dimension: "J/kg", kind: "absorbed-dose" } },
        expectedKind: "absorbed-dose",
        semanticPolicy: "semantic-aware",
      },
      O,
    );
    expect(f.expectedKind).toBe("absorbed-dose");
  });
});

// ---------------------------------------------------------------------------
// 24.20 Trace mode
// ---------------------------------------------------------------------------

describe("trace mode", () => {
  it("records deterministic steps without changing the result", () => {
    const f = defineFormula(
      {
        id: "force",
        expression: mul(v("mass"), v("accel")),
        inputs: { mass: { dimension: "kg" }, accel: { dimension: "m/s^2" } },
      },
      O,
    );
    const traced = evaluateFormula(
      f,
      { mass: Quantity.of(10, "kg"), accel: Quantity.of(9.81, "m/s^2", reg) },
      { ...O, trace: true },
    );
    if (!(typeof traced === "object" && "steps" in traced)) throw new Error("expected trace");
    expect(traced.result.value).toBeCloseTo(98.1, 9);
    expect(traced.steps.length).toBeGreaterThanOrEqual(3);
    expect(traced.steps[traced.steps.length - 1]!.result).toContain("98.1");
    // Same inputs without trace give the same value (fast path unaffected).
    const plain = evaluateFormula(
      f,
      { mass: Quantity.of(10, "kg"), accel: Quantity.of(9.81, "m/s^2", reg) },
      O,
    );
    if (!(plain instanceof Quantity)) throw new Error("expected Quantity");
    expect(plain.value).toBe(traced.result.value);
  });
});

// ---------------------------------------------------------------------------
// 24.24 Serialization (round-trip + attacks)
// ---------------------------------------------------------------------------

describe("formula serialization", () => {
  it("round-trips definitions and revalidates on load", () => {
    const f = defineFormula(
      {
        id: "force",
        expression: mul(v("mass"), v("accel")),
        inputs: { mass: { dimension: "kg" }, accel: { dimension: "m/s^2" } },
        outputName: "force",
        outputUnit: "N",
        description: "Newton's second law",
      },
      O,
    );
    const restored = deserializeFormula(JSON.parse(JSON.stringify(serializeFormula(f))), O);
    expect(restored.id).toBe("force");
    expect(restored.description).toBe("Newton's second law");
    const r = evaluateFormula(
      restored,
      { mass: Quantity.of(2, "kg"), accel: Quantity.of(3, "m/s^2", reg) },
      O,
    );
    if (!(r instanceof Quantity)) throw new Error("expected Quantity");
    expect(r.value).toBeCloseTo(6, 9);
  });

  it("rejects malformed, versioned-wrong, and polluted payloads", () => {
    expect(() => deserializeFormula(null, O)).toThrow(FormulaError);
    expect(() => deserializeFormula({ version: 2, type: "formula" }, O)).toThrow(FormulaError);
    expect(() => deserializeFormula({ version: 1, type: "nope" }, O)).toThrow(FormulaError);
    expect(() =>
      deserializeFormula(JSON.parse('{"version":1,"type":"formula","id":"x","__proto__":{}}'), O),
    ).toThrow(FormulaError);
    // Valid shape but dimensionally invalid expression still fails.
    expect(() =>
      deserializeFormula(
        {
          version: 1,
          type: "formula",
          id: "bad",
          expression: serializeExpression(add(v("a"), v("b"))).root,
          inputs: { a: { dimension: "m" }, b: { dimension: "s" } },
        },
        O,
      ),
    ).toThrow(FormulaError);
  });

  it("expression serialization still round-trips call nodes", () => {
    const expr = fn("sqrt", [v("x")]);
    const restored = deserializeExpression(JSON.parse(JSON.stringify(serializeExpression(expr))));
    expect(restored).toEqual(expr);
  });
});

// ---------------------------------------------------------------------------
// 24.25 Formula security limits
// ---------------------------------------------------------------------------

describe("formula security", () => {
  it("caps variables, depth, and serialized size", () => {
    const manyInputs: Record<string, { dimension: string }> = {};
    for (let i = 0; i < 300; i++) manyInputs[`v${i}`] = { dimension: "1" };
    let expr = v("v0");
    for (let i = 1; i < 300; i++) expr = add(expr, v(`v${i}`));
    expect(() => defineFormula({ id: "big", expression: expr, inputs: manyInputs }, O)).toThrow(
      ExpressionLimitError,
    );
    let deep = v("x");
    for (let i = 0; i < 100; i++) deep = add(deep, lit(1, "1"));
    expect(() =>
      defineFormula({ id: "deep", expression: deep, inputs: { x: { dimension: "1" } } }, O),
    ).toThrow(ExpressionLimitError);
  });

  it("unknown variables in evaluation throw typed errors", () => {
    const f = defineFormula(
      { id: "f", expression: add(v("a"), lit(1, "1")), inputs: { a: { dimension: "1" } } },
      O,
    );
    expect(() => evaluateFormula(f, {}, O)).toThrow(FormulaError);
    expect(() => evaluateFormula(f, { a: "nope" } as never, O)).toThrow(FormulaError);
  });
});

// ---------------------------------------------------------------------------
// 24.27 Property tests
// ---------------------------------------------------------------------------

describe("formula properties", () => {
  it("(a / b) * b ≈ a for compatible quantities", () => {
    const f = defineFormula(
      {
        id: "roundtrip",
        expression: mul(div(v("a"), v("b")), v("b")),
        inputs: { a: { dimension: "m" }, b: { dimension: "s" } },
      },
      O,
    );
    const a = Quantity.of(100, "m");
    const b = Quantity.of(4, "s");
    const r = evaluateFormula(f, { a, b }, O);
    if (!(r instanceof Quantity)) throw new Error("expected Quantity");
    expect(r.to("m").value).toBeCloseTo(100, 9);
  });

  it("dimension(mass × acceleration) = Force; dimension(distance/time) = Velocity", () => {
    expect(
      analyzeDimensions(mul(v("m"), v("a")), { m: Dim.Mass, a: { L: 1, T: -2 } }, O).dimension,
    ).toEqual({ M: 1, L: 1, T: -2 });
    expect(analyzeDimensions(div(v("d"), v("t")), { d: "m", t: "s" }, O).dimension).toEqual({
      L: 1,
      T: -1,
    });
  });

  it("formatted results render through the existing formatter", () => {
    expect(formatQuantity(Quantity.of(98.1, "N", reg))).toContain("N");
  });
});
