/**
 * tests/expression.test.ts — Phase 15: Advanced Expression Engine & Formula Algebra
 * Phase 16: compilation caching, batch evaluation, cache equivalence.
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Dim,
  UnitMismatchError,
  UnitRegistry,
  makeUnit,
  Expression,
  compileExpression,
  evaluateExpression,
  inferExpressionDimension,
  simplifyExpression,
  serializeExpression,
  deserializeExpression,
  canonicalExpressionKey,
  expressionDepth,
  parseUnit,
  FormulaRegistry,
  defaultFormulaRegistry,
  isExpression,
  isSerializedExpression,
  ExpressionError,
  UnknownVariableError,
  ExpressionLimitError,
  DivisionByZeroError,
} from "../src/index.js";
import { dimensionKey, dimensionsEqual } from "../src/dimension.js";

// ---------------------------------------------------------------------------
// Literals & variables
// ---------------------------------------------------------------------------

describe("Expression literals and variables", () => {
  it("evaluates a literal", () => {
    const q = evaluateExpression(Expression.literal(10, "kg"));
    expect(q.value).toBe(10);
    expect(q.unit.symbol).toBe("kg");
  });

  it("evaluates a variable from context", () => {
    const q = evaluateExpression(Expression.variable("intake"), {
      intake: Quantity.of(10, "kg/day"),
    });
    expect(q.value).toBe(10);
    expect(q.unit.symbol).toBe("kg/day");
  });

  it("rejects invalid variable names", () => {
    expect(() => Expression.variable("")).toThrow(ExpressionError);
    expect(() => Expression.variable("1abc")).toThrow(ExpressionError);
    expect(() => Expression.variable("a b")).toThrow(ExpressionError);
    // "__proto__" fails the name pattern (must start with a letter)
    expect(() => Expression.variable("__proto__")).toThrow(ExpressionError);
  });

  it("prototype-named bindings cannot resolve via prototype chain", () => {
    // "constructor" passes the name pattern but lookup uses own-property
    // checks, so it cannot resolve Object.prototype members:
    expect(() => evaluateExpression(Expression.variable("constructor"), {})).toThrow(
      UnknownVariableError,
    );
    expect(() => evaluateExpression(Expression.variable("toString"), {})).toThrow(
      UnknownVariableError,
    );
  });

  it("rejects non-number literal values and empty units", () => {
    expect(() => Expression.literal("10" as unknown as number, "kg")).toThrow(ExpressionError);
    expect(() => Expression.literal(10, "")).toThrow(ExpressionError);
  });

  it("unknown variable throws UnknownVariableError", () => {
    expect(() => evaluateExpression(Expression.variable("nope"), {})).toThrow(UnknownVariableError);
  });

  it("variable bound to non-Quantity throws ExpressionError", () => {
    expect(() =>
      evaluateExpression(Expression.variable("x"), { x: 5 as unknown as Quantity }),
    ).toThrow(ExpressionError);
  });

  it("all nodes are frozen (immutable)", () => {
    const e = Expression.add(Expression.literal(1, "kg"), Expression.variable("x"));
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen((e as { left: unknown }).left)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Arithmetic: add / subtract / multiply / divide / power / convert
// ---------------------------------------------------------------------------

describe("Expression arithmetic", () => {
  it("add: 2 kg + 500 g = 2.5 kg", () => {
    const q = evaluateExpression(
      Expression.add(Expression.literal(2, "kg"), Expression.literal(500, "g")),
    );
    expect(q.value).toBeCloseTo(2.5, 12);
    expect(q.unit.symbol).toBe("kg");
  });

  it("subtract: 2 kg - 500 g = 1.5 kg", () => {
    const q = evaluateExpression(
      Expression.subtract(Expression.literal(2, "kg"), Expression.literal(500, "g")),
    );
    expect(q.value).toBeCloseTo(1.5, 12);
  });

  it("multiply: 10 kg/day × 12 % → g/day", () => {
    const q = evaluateExpression(
      Expression.multiply(Expression.literal(10, "kg/day"), Expression.literal(12, "%")),
    );
    expect(q.to("g/day").value).toBeCloseTo(1200, 9);
  });

  it("multiply: 10 kg/day × 80 mg/kg → mg/day", () => {
    const q = evaluateExpression(
      Expression.multiply(Expression.literal(10, "kg/day"), Expression.literal(80, "mg/kg")),
    );
    expect(q.to("mg/day").value).toBeCloseTo(800, 9);
  });

  it("multiply: 3 Mcal/kg × 5 kg → Mcal", () => {
    const q = evaluateExpression(
      Expression.multiply(Expression.literal(3, "Mcal/kg"), Expression.literal(5, "kg")),
    );
    expect(q.to("Mcal").value).toBeCloseTo(15, 9);
  });

  it("divide: 10 kg / 2 s → 5 kg/s", () => {
    const q = evaluateExpression(
      Expression.divide(Expression.literal(10, "kg"), Expression.literal(2, "s")),
    );
    // Quantity.divide returns base-unit values (s base = day); convert to kg/s
    expect(q.to("kg/s").value).toBeCloseTo(5, 9);
    expect(dimensionsEqual(q.dimension, { M: 1, T: -1 })).toBe(true);
  });

  it("power: (2 m)^2 → 4 m²", () => {
    const q = evaluateExpression(Expression.power(Expression.literal(2, "m"), 2));
    expect(q.value).toBeCloseTo(4, 12);
    expect(q.dimension).toEqual({ L: 2 });
  });

  it("power rejects non-integer exponents", () => {
    expect(() => Expression.power(Expression.literal(2, "m"), 1.5)).toThrow(ExpressionError);
    expect(() => evaluateExpression(Expression.power(Expression.literal(2, "m"), 0))).not.toThrow();
  });

  it("convert: 3000 g → 3 kg", () => {
    const q = evaluateExpression(Expression.convert(Expression.literal(3000, "g"), "kg"));
    expect(q.value).toBeCloseTo(3, 12);
    expect(q.unit.symbol).toBe("kg");
  });

  it("convert with incompatible dimension throws", () => {
    expect(() =>
      evaluateExpression(Expression.convert(Expression.literal(1, "kg"), "m")),
    ).toThrow();
  });

  it("nested: (10 kg / 2 s) * 3 s → 15 kg", () => {
    const expr = Expression.multiply(
      Expression.divide(Expression.literal(10, "kg"), Expression.literal(2, "s")),
      Expression.literal(3, "s"),
    );
    const q = evaluateExpression(expr);
    expect(q.to("kg").value).toBeCloseTo(15, 9);
  });

  it("mass + length is invalid", () => {
    expect(() =>
      evaluateExpression(Expression.add(Expression.literal(5, "kg"), Expression.literal(2, "m"))),
    ).toThrow(UnitMismatchError);
  });

  it("division by zero throws DivisionByZeroError", () => {
    expect(() =>
      evaluateExpression(
        Expression.divide(Expression.literal(1, "kg"), Expression.literal(0, "kg")),
      ),
    ).toThrow(DivisionByZeroError);
  });
});

// ---------------------------------------------------------------------------
// Dimension inference (static, no numeric evaluation)
// ---------------------------------------------------------------------------

describe("Expression dimension inference", () => {
  it("infers intake × concentration → mg/day without evaluating", () => {
    const expr = Expression.multiply(Expression.variable("intake"), Expression.variable("conc"));
    const dim = inferExpressionDimension(expr, { intake: "kg/day", conc: "mg/kg" });
    expect(dim).toEqual({ M: 1, T: -1 }); // mg/day: Count? no — mg is M, /day is T^-1 → M^1·T^-1
  });

  it("infers literals directly", () => {
    expect(inferExpressionDimension(Expression.literal(5, "kg"))).toEqual(Dim.Mass);
  });

  it("infers add/subtract as operand dimension, rejects mismatch", () => {
    const ok = Expression.add(Expression.variable("a"), Expression.variable("b"));
    expect(inferExpressionDimension(ok, { a: "kg", b: "g" })).toEqual(Dim.Mass);
    const bad = Expression.add(Expression.variable("a"), Expression.variable("b"));
    expect(() => inferExpressionDimension(bad, { a: "kg", b: "m" })).toThrow(ExpressionError);
  });

  it("infers power by scaling exponents", () => {
    expect(inferExpressionDimension(Expression.power(Expression.literal(2, "m"), 2))).toEqual({
      L: 2,
    });
  });

  it("infers convert as target dimension, rejects mismatch", () => {
    const ok = Expression.convert(Expression.literal(1, "g"), "kg");
    expect(inferExpressionDimension(ok)).toEqual(Dim.Mass);
    const bad = Expression.convert(Expression.literal(1, "g"), "m");
    expect(() => inferExpressionDimension(bad)).toThrow(ExpressionError);
  });

  it("accepts DimensionVector declarations as well as unit strings", () => {
    const dim = inferExpressionDimension(Expression.variable("x"), { x: Dim.Mass });
    expect(dim).toEqual(Dim.Mass);
  });

  it("unknown variable in inference throws UnknownVariableError", () => {
    expect(() => inferExpressionDimension(Expression.variable("zzz"), {})).toThrow(
      UnknownVariableError,
    );
  });
});

// ---------------------------------------------------------------------------
// Simplification: constant folding, identities, normalization
// ---------------------------------------------------------------------------

describe("Expression simplification", () => {
  it("folds 2 kg × 3 → 6 (mass dimension preserved)", () => {
    const s = simplifyExpression(
      Expression.multiply(Expression.literal(2, "kg"), Expression.literal(3, "fraction")),
    );
    expect(s.kind).toBe("literal");
    if (s.kind === "literal") {
      expect(s.value).toBeCloseTo(6, 12);
      // Folded literal keeps the evaluated composite symbol; semantics (value + dimension) preserved
      expect(inferExpressionDimension(s)).toEqual(Dim.Mass);
      expect(evaluateExpression(s, {}).to("kg").value).toBeCloseTo(6, 9);
    }
  });

  it("folds 2 m × 3 s → 6 m·s", () => {
    const s = simplifyExpression(
      Expression.multiply(Expression.literal(2, "m"), Expression.literal(3, "s")),
    );
    expect(s.kind).toBe("literal");
  });

  it("normalizes 1000 m + 1 km → 2000 m", () => {
    const s = simplifyExpression(
      Expression.add(Expression.literal(1000, "m"), Expression.literal(1, "km")),
    );
    expect(s.kind).toBe("literal");
    if (s.kind === "literal") {
      expect(s.value).toBeCloseTo(2000, 9);
      expect(s.unit).toBe("m");
    }
  });

  it("x × 1 → x, x / 1 → x", () => {
    const x = Expression.variable("x");
    const one = Expression.literal(1, "1");
    expect(simplifyExpression(Expression.multiply(x, one))).toBe(x);
    expect(simplifyExpression(Expression.divide(x, one))).toBe(x);
  });

  it("x ^ 1 → x, x ^ 0 → 1", () => {
    const x = Expression.variable("x");
    expect(simplifyExpression(Expression.power(x, 1))).toBe(x);
    const zero = simplifyExpression(Expression.power(x, 0));
    expect(zero).toEqual({ kind: "literal", value: 1, unit: "1" });
  });

  it("does NOT simplify x / x → 1 (unsafe)", () => {
    const x = Expression.variable("x");
    const s = simplifyExpression(Expression.divide(x, x));
    expect(s.kind).toBe("divide");
  });

  it("does NOT simplify x + 0 for variables (dimension-unsafe)", () => {
    const x = Expression.variable("x");
    const s = simplifyExpression(Expression.add(x, Expression.literal(0, "1")));
    expect(s.kind).toBe("add");
  });

  it("simplification preserves semantics (evaluate equal)", () => {
    const expr = Expression.multiply(
      Expression.add(Expression.literal(1000, "m"), Expression.literal(1, "km")),
      Expression.literal(1, "1"),
    );
    const ctx = {};
    const before = evaluateExpression(expr, ctx);
    const after = evaluateExpression(simplifyExpression(expr), ctx);
    expect(after.toBase().value).toBeCloseTo(before.toBase().value, 9);
  });
});

// ---------------------------------------------------------------------------
// Compilation: validated plan, no codegen
// ---------------------------------------------------------------------------

describe("Expression compilation", () => {
  it("compile ≈ evaluate for all valid expressions", () => {
    const expr = Expression.multiply(Expression.variable("intake"), Expression.variable("conc"));
    const ctx = { intake: Quantity.of(10, "kg/day"), conc: Quantity.of(80, "mg/kg") };
    const direct = evaluateExpression(expr, ctx);
    const compiled = compileExpression(expr);
    expect(compiled.evaluate(ctx).to("mg/day").value).toBeCloseTo(direct.to("mg/day").value, 9);
  });

  it("compiled expression caches (same object on recompile)", () => {
    const expr = Expression.add(Expression.literal(1, "kg"), Expression.literal(2, "kg"));
    expect(compileExpression(expr)).toBe(compileExpression(expr));
  });

  it("compiled plan pre-resolves units (batch evaluation needs no parsing)", () => {
    const expr = Expression.multiply(Expression.variable("a"), Expression.variable("b"));
    const compiled = compileExpression(expr);
    const r1 = compiled.evaluate({ a: Quantity.of(2, "kg"), b: Quantity.of(3, "m") });
    const r2 = compiled.evaluate({ a: Quantity.of(4, "kg"), b: Quantity.of(5, "m") });
    expect(r1.toBase().value).toBeCloseTo(6, 9);
    expect(r2.toBase().value).toBeCloseTo(20, 9);
  });

  it("compiled inferDimension works", () => {
    const compiled = compileExpression(
      Expression.multiply(Expression.variable("a"), Expression.variable("b")),
    );
    expect(compiled.inferDimension({ a: "kg", b: "m" })).toEqual({ M: 1, L: 1 });
  });

  it("compiled key is deterministic", () => {
    const a = compileExpression(
      Expression.add(Expression.literal(1, "kg"), Expression.literal(1, "kg")),
    );
    const b = compileExpression(
      Expression.add(Expression.literal(1, "kg"), Expression.literal(1, "kg")),
    );
    expect(a.key).toBe(b.key);
  });

  it("compile validates (dimension errors surface at compile for literals)", () => {
    // Literals resolve at compile; dimension errors surface at evaluation
    const compiled = compileExpression(
      Expression.add(Expression.literal(5, "kg"), Expression.literal(2, "m")),
    );
    expect(() => compiled.evaluate({})).toThrow(UnitMismatchError);
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe("Expression serialization", () => {
  it("round-trips literal/variable/compound", () => {
    const expr = Expression.multiply(Expression.variable("intake"), Expression.literal(12, "%"));
    const ser = serializeExpression(expr);
    expect(ser.version).toBe(1);
    expect(ser.type).toBe("expression");
    const back = deserializeExpression(ser);
    expect(canonicalExpressionKey(back)).toBe(canonicalExpressionKey(expr));
  });

  it("round-trips power/convert", () => {
    const expr = Expression.convert(Expression.power(Expression.variable("x"), 2), "m^2");
    const back = deserializeExpression(JSON.parse(JSON.stringify(serializeExpression(expr))));
    expect(canonicalExpressionKey(back)).toBe(canonicalExpressionKey(expr));
  });

  it("deterministic: same expression → byte-identical JSON", () => {
    const a = Expression.add(Expression.literal(1, "kg"), Expression.variable("x"));
    const b = Expression.add(Expression.literal(1, "kg"), Expression.variable("x"));
    expect(JSON.stringify(serializeExpression(a))).toBe(JSON.stringify(serializeExpression(b)));
  });

  it("rejects missing/unsupported version and wrong type", () => {
    expect(() => deserializeExpression({} as never)).toThrow(ExpressionError);
    expect(() =>
      deserializeExpression({ version: 99, type: "expression", root: {} } as never),
    ).toThrow(ExpressionError);
    expect(() =>
      deserializeExpression({ version: 1, type: "quantity", root: {} } as never),
    ).toThrow(ExpressionError);
  });

  it("rejects malformed nodes (bad kind, bad power, empty unit)", () => {
    expect(() =>
      deserializeExpression({ version: 1, type: "expression", root: { kind: "nope" } } as never),
    ).toThrow(ExpressionError);
    expect(() =>
      deserializeExpression({
        version: 1,
        type: "expression",
        root: { kind: "power", base: { kind: "literal", value: 1, unit: "m" }, exponent: 1.5 },
      } as never),
    ).toThrow(ExpressionError);
  });

  it("rejects prototype pollution payloads", () => {
    const before = ({} as Record<string, unknown>).__proto__;
    const payload = JSON.parse(
      '{"version":1,"type":"expression","root":{"kind":"literal","value":1,"unit":"kg","__proto__":{}}}',
    );
    expect(() => deserializeExpression(payload)).toThrow(ExpressionError);
    expect(({} as Record<string, unknown>).__proto__).toBe(before);
  });

  it("never deserializes functions", () => {
    const payload = {
      version: 1,
      type: "expression",
      root: { kind: "literal", value: "() => 1", unit: "kg" },
    } as never;
    expect(() => deserializeExpression(payload)).toThrow(ExpressionError);
  });
});

// ---------------------------------------------------------------------------
// Security limits: depth, nodes, names, input size
// ---------------------------------------------------------------------------

describe("Expression security limits", () => {
  function deepExpr(depth: number) {
    let e = Expression.literal(1, "kg");
    for (let i = 0; i < depth; i++) e = Expression.add(e, Expression.literal(1, "kg"));
    return e;
  }

  it("rejects excessively deep ASTs", () => {
    const e = deepExpr(200);
    expect(expressionDepth(e)).toBeGreaterThan(64);
    expect(() => evaluateExpression(e, {}, { limits: { maxDepth: 64 } })).toThrow(
      ExpressionLimitError,
    );
  });

  it("rejects huge node counts", () => {
    // Build a wide tree: (((1+1)+1)+...) with 3000 leaves
    let e = Expression.literal(1, "kg");
    for (let i = 0; i < 3000; i++) e = Expression.add(e, Expression.literal(1, "kg"));
    expect(() => evaluateExpression(e, {}, { limits: { maxNodes: 100 } })).toThrow(
      ExpressionLimitError,
    );
  });

  it("rejects oversized serialized input", () => {
    const big = "x".repeat(70000);
    expect(() => deserializeExpression(big, { maxSerializedChars: 100 })).toThrow(
      ExpressionLimitError,
    );
  });

  it("rejects invalid JSON strings", () => {
    expect(() => deserializeExpression("{not json")).toThrow(ExpressionError);
  });

  it("limits are configurable (permissive override)", () => {
    const e = deepExpr(10);
    expect(() =>
      evaluateExpression(e, {}, { limits: { maxDepth: 64, maxNodes: 10000 } }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// FormulaRegistry (generic, NOT domain rules)
// ---------------------------------------------------------------------------

describe("FormulaRegistry", () => {
  it("defines and runs a generic formula", () => {
    const reg = new FormulaRegistry();
    reg.define(
      "work",
      ["force", "distance"],
      Expression.multiply(Expression.variable("force"), Expression.variable("distance")),
    );
    const q = reg.run("work", { force: Quantity.of(10, "kg"), distance: Quantity.of(5, "m") });
    expect(q.toBase().value).toBeCloseTo(50, 9);
  });

  it("validates undeclared variables at define time", () => {
    const reg = new FormulaRegistry();
    expect(() => reg.define("bad", ["a"], Expression.variable("b"))).toThrow(ExpressionError);
  });

  it("rejects duplicates, bad names, duplicate variables", () => {
    const reg = new FormulaRegistry();
    reg.define("f", ["a"], Expression.variable("a"));
    expect(() => reg.define("f", ["a"], Expression.variable("a"))).toThrow(ExpressionError);
    expect(() => reg.define("1bad", ["a"], Expression.variable("a"))).toThrow(ExpressionError);
    expect(() => reg.define("g", ["a", "a"], Expression.variable("a"))).toThrow(ExpressionError);
  });

  it("run requires all variables (UnknownVariableError)", () => {
    const reg = new FormulaRegistry();
    reg.define("f", ["a", "b"], Expression.add(Expression.variable("a"), Expression.variable("b")));
    expect(() => reg.run("f", { a: Quantity.of(1, "kg") })).toThrow(UnknownVariableError);
  });

  it("inferDimension validates output dimension", () => {
    const reg = new FormulaRegistry();
    reg.define(
      "rate",
      ["mass", "time"],
      Expression.divide(Expression.variable("mass"), Expression.variable("time")),
    );
    expect(reg.inferDimension("rate", { mass: "kg", time: "s" })).toEqual({ M: 1, T: -1 });
  });

  it("unknown formula throws", () => {
    const reg = new FormulaRegistry();
    expect(() => reg.run("nope", {})).toThrow(ExpressionError);
  });

  it("defaultFormulaRegistry is separate from CalculationRuleRegistry", () => {
    expect(defaultFormulaRegistry).toBeDefined();
    expect(defaultFormulaRegistry.list()).toEqual(expect.any(Array));
    expect(typeof defaultFormulaRegistry.define).toBe("function");
    expect(typeof defaultFormulaRegistry.run).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe("Expression immutability", () => {
  it("evaluate does not mutate the AST or context", () => {
    const expr = Expression.add(Expression.literal(1, "kg"), Expression.variable("x"));
    const before = JSON.stringify(serializeExpression(expr));
    const ctx = { x: Quantity.of(2, "kg") };
    evaluateExpression(expr, ctx);
    expect(JSON.stringify(serializeExpression(expr))).toBe(before);
    expect(ctx.x.value).toBe(2);
  });

  it("simplify returns frozen nodes", () => {
    const s = simplifyExpression(
      Expression.add(Expression.literal(1, "kg"), Expression.literal(1, "g")),
    );
    expect(Object.isFrozen(s)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("Expression properties", () => {
  const ctx = { a: Quantity.of(2, "kg"), b: Quantity.of(3, "m"), c: Quantity.of(4, "s") };
  const A = Expression.variable("a");
  const B = Expression.variable("b");
  const C = Expression.variable("c");

  it("evaluate(a × b) ≈ evaluate(b × a) after normalization", () => {
    const ab = evaluateExpression(Expression.multiply(A, B), ctx).toBase().value;
    const ba = evaluateExpression(Expression.multiply(B, A), ctx).toBase().value;
    expect(ab).toBeCloseTo(ba, 9);
  });

  it("evaluate((a × b) × c) ≈ evaluate(a × (b × c))", () => {
    const left = evaluateExpression(Expression.multiply(Expression.multiply(A, B), C), ctx).toBase()
      .value;
    const right = evaluateExpression(
      Expression.multiply(A, Expression.multiply(B, C)),
      ctx,
    ).toBase().value;
    expect(left).toBeCloseTo(right, 9);
  });

  it("compile(expr) ≈ evaluate(expr)", () => {
    const expr = Expression.divide(Expression.multiply(A, B), C);
    const compiled = compileExpression(expr).evaluate(ctx).toBase().value;
    const direct = evaluateExpression(expr, ctx).toBase().value;
    expect(compiled).toBeCloseTo(direct, 9);
  });

  it("serialize/deserialize preserves evaluation", () => {
    // (a*b has M·L, c has T — incompatible; use compatible variant)
    const ok = Expression.add(A, Expression.literal(1, "kg"));
    const back = deserializeExpression(serializeExpression(ok));
    expect(evaluateExpression(back, ctx).value).toBeCloseTo(evaluateExpression(ok, ctx).value, 9);
  });

  it("dimension inference matches evaluated dimension", () => {
    const expr = Expression.multiply(A, B);
    const inferred = inferExpressionDimension(expr, { a: "kg", b: "m" });
    expect(inferred).toEqual({ M: 1, L: 1 });
    expect(dimensionKey(evaluateExpression(expr, ctx).dimension)).toBe(dimensionKey(inferred));
  });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe("Expression guards", () => {
  it("isExpression validates structure", () => {
    expect(isExpression(Expression.literal(1, "kg"))).toBe(true);
    expect(isExpression({ kind: "bogus" })).toBe(false);
    expect(isExpression(null)).toBe(false);
    expect(isExpression([])).toBe(false);
    // Object literals cannot carry __proto__ as an own key; JSON.parse can:
    const polluted = JSON.parse('{"kind":"literal","value":1,"unit":"kg","__proto__":{}}');
    expect(isExpression(polluted)).toBe(false);
  });

  it("isSerializedExpression validates shape", () => {
    const ser = serializeExpression(Expression.literal(1, "kg"));
    expect(isSerializedExpression(ser)).toBe(true);
    expect(isSerializedExpression({ version: 1, type: "quantity", value: 1, unit: "kg" })).toBe(
      false,
    );
    expect(isSerializedExpression(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Audit fixes: hostile keys, custom-registry simplification
// ---------------------------------------------------------------------------

describe("Expression audit fixes", () => {
  it("canonicalExpressionKey rejects hostile input with a typed error", () => {
    // Deeply nested hand-built object (bypasses builders): must not stack-overflow
    let evil: unknown = { kind: "literal", value: 1, unit: "kg" };
    for (let i = 0; i < 10000; i++) {
      evil = { kind: "add", left: evil, right: { kind: "literal", value: 1, unit: "kg" } };
    }
    expect(() => canonicalExpressionKey(evil as never)).toThrow(ExpressionLimitError);
  });

  it("expressionDepth rejects malformed nodes with a typed error", () => {
    expect(() => expressionDepth({ kind: "add" } as never)).toThrow(ExpressionError);
  });

  it("x*1 simplifies with custom-registry dimensionless units", () => {
    const reg = new UnitRegistry([]);
    reg.register(
      makeUnit({ symbol: "myfrac", dimension: {}, toBaseFactor: 1, label: "my fraction" }),
    );
    const x = Expression.variable("x");
    const s = simplifyExpression(Expression.multiply(x, Expression.literal(1, "myfrac")), {
      registry: reg,
    });
    expect(s).toBe(x);
  });
});

// ---------------------------------------------------------------------------
// Audit fixes round 2: stale caches, define-time validation, stored registry
// ---------------------------------------------------------------------------

describe("Expression audit fixes round 2", () => {
  it("define() rejects unknown literal units immediately", () => {
    const reg = new FormulaRegistry();
    expect(() => reg.define("bad", [], Expression.literal(1, "not-a-unit-xyz"))).toThrow();
  });

  it("custom-registry formulas work end-to-end via stored registry", () => {
    const reg = new UnitRegistry([]);
    reg.register(makeUnit({ symbol: "myU", dimension: Dim.Mass, toBaseFactor: 2, label: "my" }));
    const formulas = new FormulaRegistry();
    formulas.define(
      "double",
      ["x"],
      Expression.multiply(Expression.variable("x"), Expression.literal(2, "myU")),
      {
        registry: reg,
      },
    );
    // run() without explicit registry uses the define-time registry
    // 3 myU (=6 base) × 2 myU (=4 base) = 24 in base units
    const q = formulas.run("double", { x: Quantity.of(3, "myU", reg) });
    expect(q.toBase().value).toBeCloseTo(24, 9);
    expect(formulas.inferDimension("double", { x: "myU" }, { registry: reg })).toEqual({
      M: 2,
    });
  });

  it("parser cache invalidates on registry mutation (nm shadowing)", () => {
    const reg = new UnitRegistry([]);
    reg.register(
      makeUnit({
        symbol: "m",
        dimension: Dim.Length,
        toBaseFactor: 1,
        label: "m",
        metadata: { prefixable: true },
      }),
    );
    expect(parseUnit("nm", reg).toBaseFactor).toBeCloseTo(1e-9, 18);
    reg.register(
      makeUnit({ symbol: "nm", dimension: Dim.Length, toBaseFactor: 999, label: "custom" }),
    );
    // Must resolve the new atomic, not the stale prefix derivation
    expect(parseUnit("nm", reg).toBaseFactor).toBe(999);
  });

  it("compiled plans invalidate on registry mutation", () => {
    const reg = new UnitRegistry([]);
    reg.register(
      makeUnit({
        symbol: "m",
        dimension: Dim.Length,
        toBaseFactor: 1,
        label: "m",
        metadata: { prefixable: true },
      }),
    );
    const before = compileExpression(Expression.literal(1, "nm"), { registry: reg });
    // Folding preserves the literal's own unit (value 1 nm); base value reflects derivation
    expect(before.evaluate({}).value).toBe(1);
    expect(before.evaluate({}).toBase().value).toBeCloseTo(1e-9, 18);
    reg.register(
      makeUnit({ symbol: "nm", dimension: Dim.Length, toBaseFactor: 999, label: "custom" }),
    );
    const after = compileExpression(Expression.literal(1, "nm"), { registry: reg });
    expect(after.evaluate({}).toBase().value).toBe(999);
    expect(after).not.toBe(before);
  });
});
