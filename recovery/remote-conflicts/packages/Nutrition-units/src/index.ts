/**
 * index.ts — Public API of `@vetwo/nutrition-units`.
 * Registers nutrition calculation rules on module load, then exposes the
 * facade classes application code should use.
 *
 * Layering:
 *   @vetwo/units  (generic)
 *        ↓
 *   @vetwo/nutrition-units  (nutrition semantics)
 */
import { registerNutritionRules } from "./nutrition-rules.js";

registerNutritionRules(); // side-effect: populate the default rule registry once

// --- Core nutrition facades (Phase 1 — preserved) ---
export { NutritionMath, nutritionMath } from "./nutrition-math.js";
export { CoefficientResolver, coefficientResolver } from "./coefficient-resolver.js";
export { BasisConverter } from "./basis-converter.js";
export { TargetUnitRegistry, defaultTargetUnitRegistry } from "./target-unit-registry.js";
export type { NutrientKey } from "./target-unit-registry.js";
export { FeedSchemaLoader } from "./feed-schema-loader.js";
export type { UnitSchema } from "./feed-schema-loader.js";
export { NUTRIENT_CONTRIBUTION_RULE, DIET_COST_RULE } from "./nutrition-rules.js";

// --- Phase 2: nutrition semantic model ---
export {
  NutrientKindRegistry,
  defaultNutrientKindRegistry,
  isNutrientKindId,
} from "./nutrient-kind.js";
export type { NutrientKind } from "./nutrient-kind.js";

export { BasisRegistry, defaultBasisRegistry, isBasisId } from "./basis.js";
export type { BasisDefinition, BasisId } from "./basis.js";

export {
  NutritionQuantity,
  serializeNutritionQuantity,
  deserializeNutritionQuantity,
} from "./nutrition-quantity.js";
export type {
  SerializedNutritionQuantity,
  NutritionQuantityOptions,
} from "./nutrition-quantity.js";

// --- Phase 5: basis & context ---
export { createNutritionContext, resolveDryMatterFraction } from "./nutrition-context.js";
export type { NutritionContext, NutritionContextOptions } from "./nutrition-context.js";

// --- Phase 6: unit families ---
export {
  inferUnitFamily,
  isFamilyCompatible,
  assertFamilyCompatible,
  listUnitFamilies,
  getMolarMass,
  convertMolarToMass,
} from "./unit-family.js";
export type { NutritionUnitFamily, UnitFamilyDefinition } from "./unit-family.js";

// --- Phase 7: semantic compatibility ---
export {
  checkNutrientCompatibility,
  isNutrientCompatible,
  assertNutrientCompatible,
  assertSemanticCompatibility,
  canConvert,
  assertCanConvert,
} from "./semantic-compatibility.js";
export type {
  SemanticMode,
  CompatibilityStatus,
  CompatibilityResult,
} from "./semantic-compatibility.js";

// --- Phase 8: metadata & provenance ---
export { createNutritionMetadata, mergeNutritionMetadata } from "./nutrition-metadata.js";
export type {
  NutritionMetadata,
  Provenance,
  SampleContext,
  AnalyticalMethod,
  DetectionLimits,
  QualityFlag,
} from "./nutrition-metadata.js";

// --- Phase 9: measurement with uncertainty ---
export {
  NutritionMeasurement,
  serializeNutritionMeasurement,
  deserializeNutritionMeasurement,
} from "./nutrition-measurement.js";
export type {
  SerializedNutritionMeasurement,
  NutritionMeasurementOptions,
} from "./nutrition-measurement.js";

// --- Phase 10: collections & series ---
export {
  NutritionSample,
  NutritionMeasurementSet,
  NutritionMeasurementSeries,
} from "./nutrition-collections.js";
export type {
  SerializedNutritionSample,
  SerializedNutritionMeasurementSet,
  SerializedNutritionMeasurementSeries,
  SeriesPoint,
  NutritionSampleOptions,
} from "./nutrition-collections.js";

// --- Phase 11: interoperability & external data ---
export {
  SCHEMA_VERSION,
  canonicalJsonStringify,
  createExternalNutrientIdentifier,
  createExternalUnitIdentifier,
  registerExternalNutrientMapping,
  resolveExternalNutrient,
  clearExternalNutrientMappings,
  registerMigration,
  migrateSerializedNutritionMeasurement,
  serializeNutritionMeasurementCanonical,
  toCanonicalJson,
  fromCanonicalJson,
  handleUnknownNutrient,
  mapTabularRowToNutritionMeasurement,
} from "./interop.js";
export type {
  ExternalNutrientIdentifier,
  ExternalUnitIdentifier,
  CanonicalNutritionMeasurement,
  MigrationFunction,
  TabularFieldMapping,
  TabularRowMapping,
  UnknownNutrientHandling,
} from "./interop.js";

export * from "./errors.js";
