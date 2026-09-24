# Formulas — Expressions, Compilation, Calculation Rules

For repeatable science (same computation, many inputs), the engine offers a
declarative formula pipeline instead of inline arithmetic.

## Building blocks

- **`Expression`** — composable computation trees:
  `Expression.variable("mass")`, `Expression.multiply(...)`,
  `Expression.add(...)`, plus a function registry for safe, named functions
  (no arbitrary execution — dangerous names are inert).
- **`compileExpression(expr)`** — compiles once; `compiled.evaluate(ctx)` runs
  many contexts fast. `evaluateExpression(expr, ctx)` interprets directly.
- **`defineFormula({ id, expression, inputs, outputName }, { registry })`** —
  validates dimensions up front; `compileFormula(def, { registry })` produces
  an evaluator accepting `Quantity` or `Measurement` bindings.
- **`CalculationRuleRegistry`** — named, discoverable calculation rules
  (`register` / `resolve` / `run`); missing rules throw `RuleNotFoundError`.
  Domain packages register their rules here on import.

```ts
const expr = Expression.multiply(Expression.variable("mass"), Expression.variable("accel"));
const compiled = compileExpression(expr);
compiled.evaluate({ mass: Quantity.of(10, "kg"), accel: Quantity.of(9.81, "m/s^2") });
// → 98.1 (kg·m/s²)
```

## Pipelines and graphs

- Invalid formulas fail **before** producing values; recompilation is fresh.
- `dependency-graph` utilities (`madge`-compatible analysis plus runtime
  helpers) evaluate chains, fan-outs, diamonds, and disconnected graphs
  deterministically.
- The formula engine accepts `Measurement` bindings and propagates
  uncertainty through evaluation.

## Practical rules

- DO model repeated domain calculations as `defineFormula` + compiled
  evaluation — inputs are dimension-checked once, not per call.
- DO register domain rules in the `CalculationRuleRegistry` from the domain
  package entrypoint (side-effect on import, like nutrition does).
- DO NOT inline `mass * 9.81`-style arithmetic across application code when a
  named, tested formula exists.
- DO NOT pass raw numbers where the formula declares `Quantity` inputs.
