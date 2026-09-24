/**
 * index.ts — Public API of the `@core/unit-engine` package.
 * Domain packages and applications should only ever import from here,
 * never reach into internal files directly (encapsulation / ISP).
 */
export * from "./dimension.js";
export {
  NumericalError,
  defaultNumericalPolicy,
  getNumericalPolicy,
  setNumericalPolicy,
  resetNumericalPolicy,
  classifyNumber,
  assertValidQuantityValue,
  isValidQuantityValue,
  approxEqual as approxEqualWithTolerance,
  exactEqual,
  checkFiniteResult,
  roundValue,
} from "./numerical.js";
export type { ComparisonOptions, RoundingMode, NumericalPolicy, NumberKind } from "./numerical.js";
export * from "./prefix.js";
export * from "./unit.js";
export * from "./unit-registry.js";
export * from "./unit-system.js";
export * from "./unit-parser.js";
export * from "./unit-suggest.js";
export * from "./quantity.js";
export * from "./conversion-engine.js";
export * from "./guards.js";
export * from "./formatter.js";
export * from "./serializer.js";
export * from "./calculation-rule-registry.js";
export * from "./expression.js";
export * from "./measurement.js";
export * from "./quantity-kind.js";
export * from "./function-registry.js";
export * from "./formula.js";
export * from "./dependency-graph.js";
export * from "./unit-algebra.js";
export * from "./constants.js";
export * from "./statistics.js";
export * from "./standards-profile.js";
export * from "./interop.js";
export * from "./significant-figures.js";
export * from "./testing.js";
export * from "./errors/index.js";
export type { AtomicUnitDef } from "./units/atomic-units.js";
export { ATOMIC_UNITS } from "./units/atomic-units.js";
export { SI_PACK, SI_BASE_EXTRA_UNITS, SI_DERIVED_UNITS, SI_ACCEPTED_UNITS } from "./packs/si.js";
export {
  IMPERIAL_PACK,
  yardDef,
  mileDef,
  ounceDef,
  mphDef,
  knotDef,
  lbfDef,
  psiDef,
  psfDef,
  imperialTonDef,
} from "./packs/imperial.js";
export { US_CUSTOMARY_PACK } from "./packs/us-customary.js";
export { CGS_PACK } from "./packs/cgs.js";
export { SCIENTIFIC_PACK } from "./packs/scientific.js";
export { ANGLE_PACK } from "./packs/angle.js";
export { RADIATION_PACK } from "./packs/radiation.js";
export { ASTRONOMY_PACK } from "./packs/astronomy.js";
export { INFORMATION_PACK } from "./packs/information.js";
