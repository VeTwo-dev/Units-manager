/**
 * nutrition-collections.ts — Phase 10: lightweight collections for nutrition measurements.
 *
 * No DataFrame, no DB, no statistics engine — just immutable, validated,
 * iterable containers with deterministic lookup and atomic conversion.
 */

import {
  NutritionMeasurement,
  type SerializedNutritionMeasurement,
} from "./nutrition-measurement.js";
import {
  InvalidNutritionQuantityError,
  MeasurementNotFoundError,
  AmbiguousMeasurementError,
  InvalidSeriesError,
  CollectionConversionError,
} from "./errors.js";
import type { NutritionMetadata } from "./nutrition-metadata.js";
import type { NutritionContext } from "./nutrition-context.js";

// ---------------------------------------------------------------------------
// NutritionSample
// ---------------------------------------------------------------------------

export interface NutritionSampleOptions {
  readonly id: string;
  readonly metadata?: NutritionMetadata;
  readonly context?: NutritionContext;
  readonly measurements?: readonly NutritionMeasurement[];
}

const SAMPLE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

export class NutritionSample {
  readonly id: string;
  readonly metadata?: NutritionMetadata;
  readonly context?: NutritionContext;
  readonly measurements: readonly NutritionMeasurement[];

  constructor(opts: NutritionSampleOptions) {
    if (!opts || typeof opts !== "object" || Array.isArray(opts))
      throw new InvalidNutritionQuantityError("NutritionSample opts must be plain object");
    if (typeof opts.id !== "string" || !SAMPLE_ID_RE.test(opts.id))
      throw new InvalidNutritionQuantityError(`sample id must match ${SAMPLE_ID_RE}`);
    if (opts.measurements) {
      for (const m of opts.measurements) {
        if (!(m instanceof NutritionMeasurement))
          throw new InvalidNutritionQuantityError(
            "sample measurements must be NutritionMeasurement",
          );
      }
    }
    this.id = opts.id;
    if (opts.metadata) this.metadata = opts.metadata;
    if (opts.context) this.context = opts.context;
    this.measurements = Object.freeze([...(opts.measurements ?? [])]);
    Object.freeze(this);
  }

  withMeasurement(m: NutritionMeasurement): NutritionSample {
    if (!(m instanceof NutritionMeasurement))
      throw new InvalidNutritionQuantityError("measurement must be NutritionMeasurement");
    return new NutritionSample({
      id: this.id,
      metadata: this.metadata,
      context: this.context,
      measurements: [...this.measurements, m],
    });
  }

  toJSON(): SerializedNutritionSample {
    return {
      version: 1,
      type: "nutrition-sample",
      id: this.id,
      ...(this.metadata ? { metadata: this.metadata } : {}),
      ...(this.context ? { context: this.context } : {}),
      measurements: this.measurements.map((m) => m.toJSON()),
    };
  }

  static fromJSON(data: unknown): NutritionSample {
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new InvalidNutritionQuantityError("sample JSON must be plain object");
    const r = data as Record<string, unknown>;
    if (r.version !== 1 || r.type !== "nutrition-sample" || typeof r.id !== "string")
      throw new InvalidNutritionQuantityError("invalid sample serialization");
    const measurements = Array.isArray(r.measurements)
      ? (r.measurements as unknown[]).map((m) => NutritionMeasurement.fromJSON(m as never))
      : [];
    return new NutritionSample({
      id: r.id as string,
      metadata: r.metadata as never,
      context: r.context as never,
      measurements,
    });
  }

  [Symbol.iterator](): Iterator<NutritionMeasurement> {
    return this.measurements[Symbol.iterator]();
  }
}

export interface SerializedNutritionSample {
  readonly version: 1;
  readonly type: "nutrition-sample";
  readonly id: string;
  readonly metadata?: NutritionMetadata;
  readonly context?: NutritionContext;
  readonly measurements: readonly SerializedNutritionMeasurement[];
}

// ---------------------------------------------------------------------------
// NutritionMeasurementSet
// ---------------------------------------------------------------------------

export class NutritionMeasurementSet implements Iterable<NutritionMeasurement> {
  private readonly list: readonly NutritionMeasurement[];
  private readonly byNutrient: ReadonlyMap<string, readonly NutritionMeasurement[]>;
  private readonly byKey: ReadonlyMap<string, NutritionMeasurement>;

  constructor(measurements: readonly NutritionMeasurement[] = []) {
    if (!Array.isArray(measurements))
      throw new InvalidNutritionQuantityError("measurements must be array");
    const list = [...measurements];
    for (const m of list) {
      if (!(m instanceof NutritionMeasurement))
        throw new InvalidNutritionQuantityError("all entries must be NutritionMeasurement");
    }
    // Validate duplicate handling: allow duplicates but key is nutrient+basis+unit — we keep first
    const byNutrient = new Map<string, NutritionMeasurement[]>();
    const byKey = new Map<string, NutritionMeasurement>();
    for (const m of list) {
      const key = `${m.nutrient.id}|${m.basis.id}|${m.measurement.value.unit.symbol}`;
      if (!byKey.has(key)) byKey.set(key, m);
      const arr = byNutrient.get(m.nutrient.id) ?? [];
      arr.push(m);
      byNutrient.set(m.nutrient.id, arr);
    }
    this.list = Object.freeze(list);
    this.byNutrient = byNutrient;
    this.byKey = byKey;
    Object.freeze(this);
  }

  get size(): number {
    return this.list.length;
  }

  [Symbol.iterator](): Iterator<NutritionMeasurement> {
    return this.list[Symbol.iterator]();
  }

  get(nutrientId: string, basisId?: string): NutritionMeasurement | undefined {
    const arr = this.byNutrient.get(nutrientId.toLowerCase());
    if (!arr) return undefined;
    if (!basisId) {
      if (arr.length === 1) return arr[0];
      return undefined; // ambiguous
    }
    const found = arr.filter((m) => m.basis.id === basisId.toLowerCase());
    if (found.length === 1) return found[0];
    return undefined;
  }

  getAll(nutrientId: string): readonly NutritionMeasurement[] {
    return this.byNutrient.get(nutrientId.toLowerCase()) ?? Object.freeze([]);
  }

  getOrThrow(nutrientId: string, basisId?: string): NutritionMeasurement {
    const found = this.get(nutrientId, basisId);
    if (!found) {
      const arr = this.getAll(nutrientId);
      if (arr.length === 0) throw new MeasurementNotFoundError(nutrientId);
      throw new AmbiguousMeasurementError(
        nutrientId,
        `${arr.length} matches for basis "${basisId ?? "any"}"`,
      );
    }
    return found;
  }

  has(nutrientId: string, basisId?: string): boolean {
    return this.get(nutrientId, basisId) !== undefined;
  }

  add(m: NutritionMeasurement): NutritionMeasurementSet {
    if (!(m instanceof NutritionMeasurement))
      throw new InvalidNutritionQuantityError("add requires NutritionMeasurement");
    // Allow duplicates — just append
    return new NutritionMeasurementSet([...this.list, m]);
  }

  remove(nutrientId: string, basisId?: string): NutritionMeasurementSet {
    const toRemove = this.list.filter((m) => {
      if (m.nutrient.id !== nutrientId.toLowerCase()) return false;
      if (basisId) return m.basis.id === basisId.toLowerCase();
      return true;
    });
    if (toRemove.length === 0) return this;
    return new NutritionMeasurementSet(this.list.filter((m) => !toRemove.includes(m)));
  }

  filter(predicate: (m: NutritionMeasurement) => boolean): NutritionMeasurementSet {
    return new NutritionMeasurementSet(this.list.filter(predicate));
  }

  filterByNutrient(nutrientId: string): NutritionMeasurementSet {
    return new NutritionMeasurementSet(this.getAll(nutrientId));
  }

  filterByBasis(basisId: string): NutritionMeasurementSet {
    return this.filter((m) => m.basis.id === basisId.toLowerCase());
  }

  map(mapper: (m: NutritionMeasurement) => NutritionMeasurement): NutritionMeasurementSet {
    return new NutritionMeasurementSet(this.list.map(mapper));
  }

  convertUnits(targetUnit: string): NutritionMeasurementSet {
    // Atomic: if any fails, whole operation fails (no partial)
    const converted = this.list.map((m) => {
      try {
        return m.to(targetUnit);
      } catch (e) {
        throw new CollectionConversionError(m.nutrient.id, (e as Error).message);
      }
    });
    return new NutritionMeasurementSet(converted);
  }

  convertBasis(targetBasisId: string, context: NutritionContext): NutritionMeasurementSet {
    const converted = this.list.map((m) => {
      try {
        return m.convertBasis(targetBasisId, context);
      } catch (e) {
        throw new CollectionConversionError(m.nutrient.id, (e as Error).message);
      }
    });
    return new NutritionMeasurementSet(converted);
  }

  toJSON(): SerializedNutritionMeasurementSet {
    return {
      version: 1,
      type: "nutrition-measurement-set",
      measurements: this.list.map((m) => m.toJSON()),
    };
  }

  static fromJSON(data: unknown): NutritionMeasurementSet {
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new InvalidNutritionQuantityError("set JSON must be plain object");
    const r = data as Record<string, unknown>;
    if (r.version !== 1 || r.type !== "nutrition-measurement-set" || !Array.isArray(r.measurements))
      throw new InvalidNutritionQuantityError("invalid set serialization");
    const list = (r.measurements as unknown[]).map((m) =>
      NutritionMeasurement.fromJSON(m as never),
    );
    return new NutritionMeasurementSet(list);
  }
}

export interface SerializedNutritionMeasurementSet {
  readonly version: 1;
  readonly type: "nutrition-measurement-set";
  readonly measurements: readonly SerializedNutritionMeasurement[];
}

// ---------------------------------------------------------------------------
// NutritionMeasurementSeries (ordered, time-series)
// ---------------------------------------------------------------------------

export interface SeriesPoint {
  readonly timestamp: string; // ISO 8601
  readonly measurement: NutritionMeasurement;
}

export class NutritionMeasurementSeries implements Iterable<SeriesPoint> {
  readonly points: readonly SeriesPoint[];

  constructor(points: readonly SeriesPoint[] = []) {
    if (!Array.isArray(points)) throw new InvalidSeriesError("series points must be array");
    const validated: SeriesPoint[] = [];
    let lastTime = -Infinity;
    for (const p of points) {
      if (!p || typeof p !== "object" || Array.isArray(p))
        throw new InvalidSeriesError("series point must be object");
      if (typeof p.timestamp !== "string" || Number.isNaN(Date.parse(p.timestamp)))
        throw new InvalidSeriesError(`invalid timestamp "${String(p.timestamp)}"`);
      if (!(p.measurement instanceof NutritionMeasurement))
        throw new InvalidSeriesError("series point measurement must be NutritionMeasurement");
      const t = Date.parse(p.timestamp);
      if (t < lastTime)
        throw new InvalidSeriesError("series timestamps must be in non-decreasing order");
      lastTime = t;
      validated.push(Object.freeze({ timestamp: p.timestamp, measurement: p.measurement }));
    }
    this.points = Object.freeze(validated);
    Object.freeze(this);
  }

  get size(): number {
    return this.points.length;
  }

  [Symbol.iterator](): Iterator<SeriesPoint> {
    return this.points[Symbol.iterator]();
  }

  add(point: SeriesPoint): NutritionMeasurementSeries {
    return new NutritionMeasurementSeries([...this.points, point]);
  }

  filter(predicate: (p: SeriesPoint) => boolean): NutritionMeasurementSeries {
    return new NutritionMeasurementSeries(this.points.filter(predicate));
  }

  toJSON(): SerializedNutritionMeasurementSeries {
    return {
      version: 1,
      type: "nutrition-measurement-series",
      points: this.points.map((p) => ({
        timestamp: p.timestamp,
        measurement: p.measurement.toJSON(),
      })),
    };
  }

  static fromJSON(data: unknown): NutritionMeasurementSeries {
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new InvalidNutritionQuantityError("series JSON must be plain object");
    const r = data as Record<string, unknown>;
    if (r.version !== 1 || r.type !== "nutrition-measurement-series" || !Array.isArray(r.points))
      throw new InvalidNutritionQuantityError("invalid series serialization");
    const points = (r.points as unknown[]).map((p) => {
      const rec = p as Record<string, unknown>;
      return {
        timestamp: rec.timestamp as string,
        measurement: NutritionMeasurement.fromJSON(rec.measurement as never),
      };
    });
    return new NutritionMeasurementSeries(points as never);
  }
}

export interface SerializedNutritionMeasurementSeries {
  readonly version: 1;
  readonly type: "nutrition-measurement-series";
  readonly points: readonly { timestamp: string; measurement: SerializedNutritionMeasurement }[];
}
