/**
 * nutrition-metadata.ts — Phase 8: immutable provenance & measurement context.
 *
 * Focused core, extensible via `custom` namespace. No LIMS, no workflow engine.
 */

import { NutritionContextError } from "./errors.js";

export type QualityFlag =
  | "valid"
  | "estimated"
  | "below-detection-limit"
  | "above-detection-limit"
  | "suspect"
  | "review-required";

const QUALITY_FLAGS: ReadonlySet<string> = new Set([
  "valid",
  "estimated",
  "below-detection-limit",
  "above-detection-limit",
  "suspect",
  "review-required",
]);

export interface DetectionLimits {
  readonly limitOfDetection?: { value: number; unit: string };
  readonly limitOfQuantification?: { value: number; unit: string };
}

export interface AnalyticalMethod {
  readonly name?: string;
  readonly id?: string;
  readonly version?: string;
  readonly reference?: string;
}

export interface SampleContext {
  readonly sampleId?: string;
  readonly replicateId?: string;
  readonly sampleType?: string;
  readonly materialDescription?: string;
  readonly physicalState?: string;
  readonly preparationState?: string;
  readonly collectionTimestamp?: string; // ISO 8601
  readonly storageInfo?: string;
  readonly basis?: string;
}

export interface Provenance {
  readonly source?: string;
  readonly sourceId?: string;
  readonly laboratoryId?: string;
  readonly analystId?: string;
  readonly instrumentId?: string;
  readonly timestamp?: string; // ISO 8601
  readonly method?: AnalyticalMethod;
  readonly sample?: SampleContext;
  readonly conversion?: {
    readonly sourceBasis?: string;
    readonly targetBasis?: string;
    readonly dryMatterFraction?: number;
    readonly conversionType?: string;
    readonly timestamp?: string;
  };
  readonly parentIds?: readonly string[];
}

export interface NutritionMetadata {
  readonly provenance?: Provenance;
  readonly sample?: SampleContext;
  readonly method?: AnalyticalMethod;
  readonly qualityFlag?: QualityFlag;
  readonly detectionLimits?: DetectionLimits;
  readonly reference?: string;
  readonly custom?: Readonly<Record<string, unknown>>;
}

const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function assertNoPollution(obj: unknown, owner: string): void {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
  const r = obj as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(r, "__proto__") ||
    Object.prototype.hasOwnProperty.call(r, "constructor") ||
    Object.prototype.hasOwnProperty.call(r, "prototype")
  ) {
    throw new NutritionContextError(`${owner} contains forbidden keys`);
  }
  for (const v of Object.values(r)) {
    if (v && typeof v === "object") assertNoPollution(v, owner);
    if (typeof v === "function")
      throw new NutritionContextError(`${owner} must not contain executable values`);
  }
}

function validateId(value: string, field: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new NutritionContextError(`${field} must match ${ID_PATTERN}, got "${value}"`);
  }
}

function validateIsoTimestamp(value: string, field: string): void {
  if (!ISO8601_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new NutritionContextError(`${field} must be ISO 8601, got "${value}"`);
  }
}

function validateQualityFlag(value: string): void {
  if (!QUALITY_FLAGS.has(value)) {
    throw new NutritionContextError(
      `qualityFlag must be one of ${[...QUALITY_FLAGS].join(", ")}, got "${value}"`,
    );
  }
}

function validateDetectionLimits(dl: DetectionLimits): void {
  if (dl.limitOfDetection) {
    if (
      typeof dl.limitOfDetection.value !== "number" ||
      !Number.isFinite(dl.limitOfDetection.value)
    ) {
      throw new NutritionContextError("limitOfDetection.value must be finite number");
    }
    if (
      typeof dl.limitOfDetection.unit !== "string" ||
      dl.limitOfDetection.unit.trim().length === 0
    ) {
      throw new NutritionContextError("limitOfDetection.unit must be non-empty string");
    }
  }
  if (dl.limitOfQuantification) {
    if (
      typeof dl.limitOfQuantification.value !== "number" ||
      !Number.isFinite(dl.limitOfQuantification.value)
    ) {
      throw new NutritionContextError("limitOfQuantification.value must be finite number");
    }
    if (
      typeof dl.limitOfQuantification.unit !== "string" ||
      dl.limitOfQuantification.unit.trim().length === 0
    ) {
      throw new NutritionContextError("limitOfQuantification.unit must be non-empty string");
    }
  }
}

function freezeDeep<T extends Record<string, unknown>>(obj: T): T {
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      freezeDeep(v as Record<string, unknown>);
    }
  }
  return Object.freeze(obj);
}

export function createNutritionMetadata(input: NutritionMetadata = {}): NutritionMetadata {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new NutritionContextError("NutritionMetadata must be a plain object");
  }
  assertNoPollution(input, "NutritionMetadata");

  const result: Record<string, unknown> = {};

  if (input.provenance) {
    const p = input.provenance;
    if (p.sourceId) validateId(p.sourceId, "provenance.sourceId");
    if (p.laboratoryId) validateId(p.laboratoryId, "provenance.laboratoryId");
    if (p.instrumentId) validateId(p.instrumentId, "provenance.instrumentId");
    if (p.timestamp) validateIsoTimestamp(p.timestamp, "provenance.timestamp");
    if (p.method) {
      if (p.method.id) validateId(p.method.id, "provenance.method.id");
      if (p.method.version && typeof p.method.version !== "string")
        throw new NutritionContextError("method.version must be string");
    }
    if (p.sample) {
      if (p.sample.sampleId) validateId(p.sample.sampleId, "provenance.sample.sampleId");
      if (p.sample.collectionTimestamp)
        validateIsoTimestamp(p.sample.collectionTimestamp, "provenance.sample.collectionTimestamp");
    }
    const frozenProvenance = freezeDeep({
      ...p,
      method: p.method ? { ...p.method } : undefined,
      sample: p.sample ? { ...p.sample } : undefined,
      conversion: p.conversion ? { ...p.conversion } : undefined,
    } as Record<string, unknown>);
    result.provenance = frozenProvenance;
  }

  if (input.sample) {
    if (input.sample.sampleId) validateId(input.sample.sampleId, "sample.sampleId");
    if (input.sample.replicateId) validateId(input.sample.replicateId, "sample.replicateId");
    if (input.sample.collectionTimestamp)
      validateIsoTimestamp(input.sample.collectionTimestamp, "sample.collectionTimestamp");
    result.sample = freezeDeep({ ...input.sample } as Record<string, unknown>);
  }

  if (input.method) {
    if (input.method.id) validateId(input.method.id, "method.id");
    result.method = freezeDeep({ ...input.method } as Record<string, unknown>);
  }

  if (input.qualityFlag) {
    validateQualityFlag(input.qualityFlag);
    result.qualityFlag = input.qualityFlag;
  }

  if (input.detectionLimits) {
    validateDetectionLimits(input.detectionLimits);
    result.detectionLimits = freezeDeep({ ...input.detectionLimits } as Record<string, unknown>);
  }

  if (input.reference) {
    if (typeof input.reference !== "string" || input.reference.trim().length === 0)
      throw new NutritionContextError("reference must be non-empty string");
    result.reference = input.reference;
  }

  if (input.custom) {
    assertNoPollution(input.custom, "custom");
    result.custom = freezeDeep({ ...input.custom } as Record<string, unknown>);
  }

  return Object.freeze(result) as NutritionMetadata;
}

export function mergeNutritionMetadata(
  a: NutritionMetadata | undefined,
  b: NutritionMetadata | undefined,
): NutritionMetadata | undefined {
  if (!a) return b;
  if (!b) return a;
  // If both have method with different ids, mark as mixed rather than guessing
  if (a.method?.id && b.method?.id && a.method.id !== b.method.id) {
    return createNutritionMetadata({
      ...a,
      ...b,
      provenance: {
        ...(a.provenance ?? {}),
        ...(b.provenance ?? {}),
        parentIds: [...(a.provenance?.parentIds ?? []), ...(b.provenance?.parentIds ?? [])],
      },
      custom: {
        ...(a.custom ?? {}),
        ...(b.custom ?? {}),
        _mixedMethods: [a.method.id, b.method.id],
      },
    } as NutritionMetadata);
  }
  return createNutritionMetadata({
    ...a,
    ...b,
    provenance:
      a.provenance || b.provenance
        ? { ...(a.provenance ?? {}), ...(b.provenance ?? {}) }
        : undefined,
    sample: a.sample || b.sample ? { ...(a.sample ?? {}), ...(b.sample ?? {}) } : undefined,
    detectionLimits:
      a.detectionLimits || b.detectionLimits
        ? { ...(a.detectionLimits ?? {}), ...(b.detectionLimits ?? {}) }
        : undefined,
    custom: a.custom || b.custom ? { ...(a.custom ?? {}), ...(b.custom ?? {}) } : undefined,
  } as NutritionMetadata);
}
