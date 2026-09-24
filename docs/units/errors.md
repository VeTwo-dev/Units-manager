# Error Taxonomy & Handling — `@vetwo/units`

Every public error extends `UnitEngineError`. Catch that base for generic
handling, or catch specific classes at trust boundaries.

## Reference (all verified in `src/errors/index.ts`)

| Error                                                                                           | When it fires                                          |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `UnitMismatchError`                                                                             | `add`/`subtract` across dimensions                     |
| `ConversionError` / `ImpossibleConversionError`                                                 | `to()` across incompatible units                       |
| `InvalidAffineOperationError`                                                                   | meaningless temperature ops (`°C+°C`, `°C×2`, `°C×kg`) |
| `DivisionByZeroError`                                                                           | zero scalar or zero-valued divisor                     |
| `UnsupportedUnitError`                                                                          | unknown unit symbol                                    |
| `InvalidUnitError` / `InvalidUnitExpressionError`                                               | malformed unit / expression                            |
| `InvalidDimensionError`                                                                         | malformed dimension                                    |
| `NumericalError`                                                                                | non-finite values, unsafe results, bad scale factors   |
| `InvalidMeasurementError`                                                                       | malformed measurement construction/payload             |
| `UnsupportedTransformationError`                                                                | logarithmic/custom conversions without a context model |
| `RuleNotFoundError`                                                                             | unregistered calculation rule                          |
| `FormulaError` / `ExpressionError` / `UnknownVariableError` / `ExpressionLimitError`            | formula pipeline problems                              |
| `IncompatibleQuantityKindError`                                                                 | semantic-kind mismatch (opt-in policies)               |
| `MissingSemanticContextError` / `UnsupportedSemanticConversionError` / `AmbiguousSemanticError` | semantic-layer problems                                |
| `AmbiguousUnitError`                                                                            | unresolvable unit ambiguity                            |
| `ExtensionError` / `MigrationError`                                                             | extension/migration failures                           |
| `CyclicDependencyError`                                                                         | dependency-graph cycles                                |

## Handling guide

```ts
try {
  const v = Quantity.of(rawValue, rawUnit).to("g");
} catch (e) {
  if (e instanceof UnsupportedUnitError) return badRequest("unknown unit");
  if (e instanceof ImpossibleConversionError) return badRequest("incompatible units");
  throw e; // never swallow dimensional errors into a guessed value
}
```

- DO catch specific errors at trust boundaries (user input, file import, API).
- DO let dimensional errors propagate from core logic — they signal real bugs.
- DO include the offending symbols/values in your own error context.
- DO NOT catch `UnitEngineError` broadly and continue with a default number.
- DO NOT string-match `error.message` to branch logic — use `instanceof`.
