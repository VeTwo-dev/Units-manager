/**
 * interop.test.ts — Phase 29: extension manifests, scoped registries,
 * namespaces, ambiguity, mappings, interchange, migration, canonicalization,
 * presets, comparison policies, diagnostics and strictness.
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Measurement,
  createRegistry,
  PrefixRegistry,
  SI_PACK,
  UnitRegistry,
  QuantityKindRegistry,
  FunctionRegistry,
  ConstantRegistry,
  UnitSystemRegistry,
  ProfileRegistry,
  createExtensionScope,
  snapshotScope,
  validateExtension,
  applyExtension,
  checkRequiresUnits,
  parseNamespacedSymbol,
  resolveAmbiguous,
  mapExternalUnit,
  toInterchange,
  fromInterchange,
  migrateSerialized,
  canonicalIdentity,
  canonicalizeUnitText,
  formatWithPreset,
  compareQuantities,
  quantitiesEqual,
  quantitiesApproximatelyEqual,
  explainConversion,
  explainFormula,
  resolveStrictness,
  assertValidFunctionName,
  assertValidStandardReference,
  attachStandardRef,
  defineFormula,
  Expression,
  AmbiguousUnitError,
  ExtensionError,
  MigrationError,
  INTERCHANGE_SCHEMA_VERSION,
  MeasurementSeries,
  MeasurementDataset,
  serializeConstantRegistry,
  createStandardConstantRegistry,
  type ExtensionManifest,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Extension manifests: validation, conflicts, atomic apply
// ---------------------------------------------------------------------------

describe("extension manifests", () => {
  const targets = () => ({
    units: new UnitRegistry(),
    prefixes: new PrefixRegistry([]),
    kinds: new QuantityKindRegistry([]),
    functions: new FunctionRegistry([]),
    constants: new ConstantRegistry(),
    systems: new UnitSystemRegistry(),
    profiles: new ProfileRegistry(),
  });

  const goodManifest = (id = "acme-units"): ExtensionManifest => ({
    id,
    version: "1.2.0",
    description: "Test extension",
    requiresUnits: ">=0.0.2",
    units: [
      {
        symbol: "smoot",
        dimension: { L: 1 },
        toBaseFactor: 1.7018,
        label: "smoot",
      },
    ],
    kinds: [{ id: "test-kind", name: "Test", dimension: {} }],
    functions: [
      {
        name: "double",
        minArity: 1,
        maxArity: 1,
        evaluate: (args) => args[0]!.scale(2),
        inferDimension: (dims) => dims[0]!,
      },
    ],
    metadata: { contact: "test@example.com" },
  });

  it("validates cleanly and applies atomically", () => {
    const t = targets();
    expect(validateExtension(goodManifest(), t)).toEqual([]);
    const applied = applyExtension(goodManifest(), t);
    expect(applied.id).toBe("acme-units");
    expect(applied.applied.units).toBe(1);
    expect(applied.applied.kinds).toBe(1);
    expect(applied.applied.functions).toBe(1);
    expect(t.units.has("smoot")).toBe(true);
    expect(t.kinds.has("test-kind")).toBe(true);
    expect(t.functions.has("double")).toBe(true);
  });

  it("detects symbol/dimension/factor/kind conflicts without mutating", () => {
    const t = targets();
    applyExtension(goodManifest(), t);
    // Same symbol, different dimension → dimension conflict.
    const conflicts = validateExtension(
      {
        id: "other",
        version: "1.0.0",
        units: [{ symbol: "smoot", dimension: { M: 1 }, toBaseFactor: 1.7018, label: "x" }],
      },
      t,
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("dimension");
    // Same symbol, different factor → factor conflict.
    const factorConflicts = validateExtension(
      {
        id: "other2",
        version: "1.0.0",
        units: [{ symbol: "smoot", dimension: { L: 1 }, toBaseFactor: 2, label: "x" }],
      },
      t,
    );
    expect(factorConflicts[0]!.kind).toBe("factor");
    // Applying with conflicts throws and leaves targets untouched.
    expect(() =>
      applyExtension(
        {
          id: "bad",
          version: "1.0.0",
          units: [{ symbol: "smoot", dimension: { M: 1 }, toBaseFactor: 1, label: "x" }],
        },
        t,
      ),
    ).toThrow(ExtensionError);
    // Duplicate kind id → identifier conflict.
    expect(
      validateExtension(
        { id: "k", version: "1.0.0", kinds: [{ id: "test-kind", name: "T", dimension: {} }] },
        t,
      ),
    ).toHaveLength(1);
  });

  it("detects alias collisions and intra-manifest duplicates in dry-run", () => {
    const t = targets();
    applyExtension(goodManifest(), t);
    // Alias of the registered unit collides.
    expect(
      validateExtension(
        {
          id: "alias-collide",
          version: "1.0.0",
          units: [
            {
              symbol: "other",
              dimension: { L: 1 },
              toBaseFactor: 1,
              label: "x",
              aliases: ["smoot"],
            } as never,
          ],
        },
        t,
      ).some((c) => c.kind === "alias"),
    ).toBe(true);
    // Same symbol twice inside one manifest.
    const dupes = validateExtension(
      {
        id: "dupes",
        version: "1.0.0",
        units: [
          { symbol: "aa", dimension: { L: 1 }, toBaseFactor: 1, label: "a" },
          { symbol: "aa", dimension: { L: 1 }, toBaseFactor: 1, label: "a" },
        ],
      },
      targets(),
    );
    expect(dupes.some((c) => c.detail.includes("within manifest"))).toBe(true);
  });

  it("applies prefixes for real (not declared-only)", () => {
    const t = targets();
    const applied = applyExtension(
      {
        id: "prefix-ext",
        version: "1.0.0",
        prefixes: [{ symbol: "wk", name: "week-kilo", factor: 1000, aliases: [] }],
      },
      { prefixes: t.prefixes },
    );
    expect(applied.applied.prefixes).toBe(1);
    expect(t.prefixes.has("wk")).toBe(true);
    // Collisions against the standard set fail without partial application.
    const seeded = new PrefixRegistry();
    expect(() =>
      applyExtension(
        {
          id: "prefix-dup",
          version: "1.0.0",
          prefixes: [
            { symbol: "wk2", name: "ok", factor: 2, aliases: [] },
            { symbol: "k", name: "x", factor: 2, aliases: [] },
          ],
        },
        { prefixes: seeded },
      ),
    ).toThrow(ExtensionError);
    expect(seeded.has("wk2")).toBe(false);
    expect(seeded.get("k").factor).toBe(1000);
  });

  it("rolls back partial failures (atomic apply)", () => {
    const t = targets();
    // Second entry is malformed (empty symbol); first is valid. The valid
    // one must not survive.
    expect(() =>
      applyExtension(
        {
          id: "partial",
          version: "1.0.0",
          units: [
            { symbol: "goodunit", dimension: { L: 1 }, toBaseFactor: 1, label: "good" },
            { symbol: "", dimension: { L: 1 }, toBaseFactor: 1, label: "bad" },
          ],
        },
        t,
      ),
    ).toThrow(ExtensionError);
    expect(t.units.has("goodunit")).toBe(false);
  });

  it("validates requiresUnits ranges", () => {
    expect(() => checkRequiresUnits(">=1.0.0", "x")).not.toThrow();
    expect(() => checkRequiresUnits("^1.0.0", "x")).not.toThrow();
    expect(() => checkRequiresUnits("~1.0.0", "x")).not.toThrow();
    expect(() => checkRequiresUnits("=1.0.0", "x")).not.toThrow();
    expect(() => checkRequiresUnits(">=0.0.2", "x")).not.toThrow();
    expect(() => checkRequiresUnits(">=9.9.9", "x")).toThrow(ExtensionError);
    expect(() => checkRequiresUnits("^2.0.0", "x")).toThrow(ExtensionError);
    expect(() => checkRequiresUnits("~1.1.0", "x")).toThrow(ExtensionError);
    expect(() => checkRequiresUnits("=0.0.2", "x")).toThrow(ExtensionError);
    expect(() => checkRequiresUnits("sometime-later", "x")).toThrow(ExtensionError);
    expect(() => checkRequiresUnits("", "x")).toThrow(ExtensionError);
  });

  it("ENGINE_VERSION tracks package.json (no silent drift)", async () => {
    const { readFile } = await import("node:fs/promises");
    const { ENGINE_VERSION: engineVersion } = await import("../src/index.js");
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      version?: unknown;
    };
    expect(engineVersion).toBe(pkg.version);
  });

  it("rejects malformed manifests", () => {
    const t = targets();
    expect(() => validateExtension({ id: "bad id!", version: "1.0.0" }, t)).toThrow(ExtensionError);
    expect(() => validateExtension({ id: "x", version: "", units: [] }, t)).toThrow(ExtensionError);
    expect(() =>
      validateExtension({ id: "x", version: "1.0.0", units: "nope" as never }, t),
    ).toThrow(ExtensionError);
  });
});

// ---------------------------------------------------------------------------
// Scoped registries and snapshots
// ---------------------------------------------------------------------------

describe("scoped registries", () => {
  it("creates isolated scopes and snapshots", () => {
    const a = createExtensionScope();
    const b = createExtensionScope();
    applyExtension(
      {
        id: "x",
        version: "1.0.0",
        units: [{ symbol: "wibble", dimension: { L: 1 }, toBaseFactor: 3, label: "w" }],
      },
      { units: a.units },
    );
    expect(a.units.has("wibble")).toBe(true);
    expect(b.units.has("wibble")).toBe(false);
    const snap = snapshotScope(a);
    expect(snap.units.has("wibble")).toBe(true);
    applyExtension(
      {
        id: "y",
        version: "1.0.0",
        units: [{ symbol: "wobble", dimension: { L: 1 }, toBaseFactor: 4, label: "w" }],
      },
      { units: a.units },
    );
    expect(a.units.has("wobble")).toBe(true);
    expect(snap.units.has("wobble")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Namespaces and ambiguity
// ---------------------------------------------------------------------------

describe("registry snapshots and function aliases", () => {
  it("snapshots isolate later registrations on every registry", () => {
    const kinds = new QuantityKindRegistry([]);
    kinds.register({ id: "k1", name: "K1", dimension: {} });
    const kindsSnap = kinds.snapshot();
    kinds.register({ id: "k2", name: "K2", dimension: {} });
    expect(kinds.has("k2")).toBe(true);
    expect(kindsSnap.has("k2")).toBe(false);
    expect(kindsSnap.require("k1").name).toBe("K1");

    const functions = new FunctionRegistry([]);
    functions.register({
      name: "double",
      minArity: 1,
      maxArity: 1,
      evaluate: (args) => args[0]!.scale(2),
      inferDimension: (dims) => dims[0]!,
    });
    const functionsSnap = functions.snapshot();
    functions.register({
      name: "triple",
      minArity: 1,
      maxArity: 1,
      evaluate: (args) => args[0]!.scale(3),
      inferDimension: (dims) => dims[0]!,
    });
    expect(functions.has("triple")).toBe(true);
    expect(functionsSnap.has("triple")).toBe(false);

    const profiles = new ProfileRegistry();
    profiles.register({ id: "p1", version: "1", unitSystem: "si" });
    const profilesSnap = profiles.snapshot();
    profiles.register({ id: "p2", version: "1", unitSystem: "si" });
    expect(profiles.has("p2")).toBe(true);
    expect(profilesSnap.has("p2")).toBe(false);
    expect(profilesSnap.version).toBe(profiles.version - 1);
  });

  it("function aliases resolve, collide safely and list deterministically", () => {
    const functions = new FunctionRegistry([]);
    functions.register({
      name: "sqrt",
      aliases: ["square_root"],
      minArity: 1,
      maxArity: 1,
      evaluate: (args) => args[0]!.sqrt(),
      inferDimension: (dims) => dims[0]!,
    });
    expect(functions.canonicalName("square_root")).toBe("sqrt");
    expect(functions.require("square_root").name).toBe("sqrt");
    expect(functions.has("square_root")).toBe(true);
    expect(functions.listAliases()).toEqual([["square_root", "sqrt"]]);
    expect(functions.call("square_root", [Quantity.of(9, "m^2")]).to("m").value).toBeCloseTo(3, 9);
    // Alias collisions (with names or other aliases) throw.
    expect(() =>
      functions.register({
        name: "other",
        aliases: ["sqrt"],
        minArity: 1,
        maxArity: 1,
        evaluate: (args) => args[0]!,
        inferDimension: (dims) => dims[0]!,
      }),
    ).toThrow();
    expect(() =>
      functions.register({
        name: "square_root",
        minArity: 1,
        maxArity: 1,
        evaluate: (args) => args[0]!,
        inferDimension: (dims) => dims[0]!,
      }),
    ).toThrow();
    expect(() =>
      functions.register({
        name: "self",
        aliases: ["self"],
        minArity: 1,
        maxArity: 1,
        evaluate: (args) => args[0]!,
        inferDimension: (dims) => dims[0]!,
      }),
    ).toThrow();
  });
});

describe("namespaces and ambiguity", () => {
  const sources = () => {
    const imperial = new UnitRegistry([]);
    imperial.registerAtomic({
      symbol: "ton",
      dimension: { M: 1 },
      toBaseFactor: 1016.0469088,
      label: "long ton",
    });
    const us = new UnitRegistry([]);
    us.registerAtomic({
      symbol: "ton",
      dimension: { M: 1 },
      toBaseFactor: 907.18474,
      label: "short ton",
    });
    const si = new UnitRegistry([]);
    si.registerAtomic({ symbol: "tonne", dimension: { M: 1 }, toBaseFactor: 1000, label: "tonne" });
    return [
      { namespace: "imperial", registry: imperial },
      { namespace: "us", registry: us },
      { namespace: "si", registry: si },
    ];
  };

  it("parses namespace prefixes", () => {
    expect(parseNamespacedSymbol("si:kg")).toEqual({ namespace: "si", symbol: "kg" });
    expect(parseNamespacedSymbol("kg")).toEqual({ namespace: undefined, symbol: "kg" });
    expect(() => parseNamespacedSymbol("")).toThrow(AmbiguousUnitError);
    expect(() => parseNamespacedSymbol("bad ns:x")).toThrow(ExtensionError);
  });

  it("explicit namespaces select one source", () => {
    const r = resolveAmbiguous("us:ton", { sources: sources() });
    expect(r.resolution).toBe("unique");
    expect(r.resolved?.namespace).toBe("us");
    expect(() => resolveAmbiguous("xx:ton", { sources: sources() })).toThrow();
  });

  it("strict rejects incompatible duplicates; standard accepts identical physics", () => {
    // ton differs across imperial/us → strict and standard both throw.
    expect(() => resolveAmbiguous("ton", { sources: sources(), strategy: "strict" })).toThrow(
      AmbiguousUnitError,
    );
    expect(() => resolveAmbiguous("ton", { sources: sources(), strategy: "standard" })).toThrow(
      AmbiguousUnitError,
    );
    // Same physics in two scopes → standard resolves deterministically.
    const a = new UnitRegistry([]);
    a.registerAtomic({ symbol: "m", dimension: { L: 1 }, toBaseFactor: 1, label: "meter" });
    const b = new UnitRegistry([]);
    b.registerAtomic({ symbol: "m", dimension: { L: 1 }, toBaseFactor: 1, label: "meter" });
    const report = resolveAmbiguous("m", {
      sources: [
        { namespace: "b-scope", registry: b },
        { namespace: "a-scope", registry: a },
      ],
      strategy: "standard",
    });
    expect(report.resolution).toBe("unique");
    expect(report.resolved?.namespace).toBe("a-scope"); // sorted-first wins
    // Permissive guesses deterministically instead of throwing.
    const guess = resolveAmbiguous("ton", { sources: sources(), strategy: "permissive" });
    expect(guess.resolution).toBe("ambiguous");
    expect(guess.resolved?.namespace).toBe("imperial");
  });

  it("unknown symbols and bad strategies throw", () => {
    expect(() => resolveAmbiguous("zzz-nope", { sources: sources() })).toThrow();
    expect(() =>
      resolveAmbiguous("ton", { sources: sources(), strategy: "whatever" as never }),
    ).toThrow(ExtensionError);
    expect(() => resolveAmbiguous("ton", { sources: [] })).toThrow(ExtensionError);
  });
});

// ---------------------------------------------------------------------------
// External mappings
// ---------------------------------------------------------------------------

describe("external mappings", () => {
  it("maps external names through explicit validated mappings", () => {
    const { unit } = mapExternalUnit("kg/m3", { "kg/m3": "kg/m^3", "lb/ft3": "lb/ft^3" }, [
      { namespace: "app", registry: new UnitRegistry() },
    ]);
    expect(unit.symbol).toBe("kg/m^3");
    expect(() =>
      mapExternalUnit("slug/ft3", { "kg/m3": "kg/m^3" }, [
        { namespace: "app", registry: new UnitRegistry() },
      ]),
    ).toThrow(ExtensionError);
    expect(() =>
      mapExternalUnit("x", { x: "nope_xyz" }, [{ namespace: "app", registry: new UnitRegistry() }]),
    ).toThrow(ExtensionError);
  });
});

// ---------------------------------------------------------------------------
// Interchange formats
// ---------------------------------------------------------------------------

describe("interchange formats", () => {
  it("round-trips quantity, measurement, series, dataset and reference data", () => {
    const q = Quantity.of(10, "kg");
    expect(fromInterchange(JSON.parse(JSON.stringify(toInterchange(q))))).toEqual(q);
    const m = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
    const mBack = fromInterchange(JSON.parse(JSON.stringify(toInterchange(m))));
    expect(mBack).toBeInstanceOf(Measurement);
    const series = MeasurementSeries.of([m, m]);
    const seriesBack = fromInterchange(JSON.parse(JSON.stringify(toInterchange(series))));
    expect(seriesBack).toBeInstanceOf(MeasurementSeries);
    const ds = MeasurementDataset.of({ mass: series });
    const dsBack = fromInterchange(JSON.parse(JSON.stringify(toInterchange(ds))));
    expect(dsBack).toBeInstanceOf(MeasurementDataset);
    const ref = createStandardConstantRegistry();
    const siReg = createRegistry({ packs: [SI_PACK] });
    const refBack = fromInterchange(
      JSON.parse(JSON.stringify(toInterchange(serializeConstantRegistry(ref)))),
      {
        registry: siReg,
      },
    );
    expect(refBack).toBeDefined();
  });

  it("formula results travel tagged; unknown kinds and fields handled by policy", () => {
    const q = Quantity.of(10, "kg");
    const env = {
      schemaVersion: 1,
      kind: "formula-result",
      payload: {
        resultKind: "quantity",
        result: JSON.parse(JSON.stringify(toInterchange(q).payload)),
      },
    };
    const back = fromInterchange(JSON.parse(JSON.stringify(env)));
    expect(back).toBeInstanceOf(Quantity);
    expect(() => fromInterchange({ schemaVersion: 1, kind: "teleport", payload: {} })).toThrow(
      ExtensionError,
    );
    expect(() => fromInterchange({ schemaVersion: 999, kind: "quantity", payload: {} })).toThrow(
      ExtensionError,
    );
    expect(() => fromInterchange("not json{[")).toThrow(ExtensionError);
    // Producer extensions travel on the envelope and validate as data.
    const withExt = toInterchange(q, { extensions: { lab: "a1" } });
    expect(withExt.extensions).toEqual({ lab: "a1" });
    expect(fromInterchange(JSON.parse(JSON.stringify(withExt)))).toBeInstanceOf(Quantity);
    expect(() => toInterchange(q, { extensions: { __proto__: {} } as never })).toThrow(
      ExtensionError,
    );
    // Unknown-field policies.
    const withExtra = {
      schemaVersion: 1,
      kind: "quantity",
      payload: toInterchange(q).payload,
      future: 1,
    };
    expect(() => fromInterchange(withExtra, { unknownFields: "reject" })).toThrow(ExtensionError);
    expect(fromInterchange(withExtra, { unknownFields: "ignore" })).toBeInstanceOf(Quantity);
    expect(INTERCHANGE_SCHEMA_VERSION).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

describe("migration", () => {
  it("chains migrations and rejects unknown versions", () => {
    const v0 = { version: 0, type: "thing", value: 1 };
    const out = migrateSerialized(
      v0,
      [
        {
          kind: "thing",
          fromVersion: 0,
          toVersion: 1,
          migrate: (d) => ({ ...(d as object), version: 1 }),
        },
        {
          kind: "thing",
          fromVersion: 1,
          toVersion: 2,
          migrate: (d) => ({ ...(d as object), version: 2 }),
        },
      ],
      2,
      "thing",
    ) as Record<string, unknown>;
    expect(out.version).toBe(2);
    expect(out.value).toBe(1);
    expect(() => migrateSerialized(v0, [], 1, "thing")).toThrow();
    expect(() => migrateSerialized({ version: 5, type: "thing" }, [], 5)).not.toThrow();
    expect(() => migrateSerialized(null, [], 1)).toThrow(MigrationError);
  });
});

// ---------------------------------------------------------------------------
// Canonicalization and presets
// ---------------------------------------------------------------------------

describe("canonicalization and presets", () => {
  it("equivalent spellings share canonical identity", () => {
    const siReg = createRegistry({ packs: [SI_PACK] });
    const a = canonicalizeUnitText("m/s");
    const b = canonicalizeUnitText("m·s^-1");
    expect(a.key).toBe(b.key);
    expect(a.dimension).toBe("L^1·T^-1");
    const n = canonicalizeUnitText("N", siReg);
    const expanded = canonicalizeUnitText("kg*m/s^2", siReg);
    expect(n.key).toBe(expanded.key);
    expect(canonicalIdentity).toBeDefined();
    expect(() => canonicalizeUnitText("")).toThrow();
  });

  it("format presets render without changing identity", () => {
    const q = Quantity.of(1500, "m");
    expect(formatWithPreset(q, "compact")).toContain("1500");
    expect(formatWithPreset(q, "machine")).toContain("1500");
    expect(formatWithPreset(q, "canonical")).toContain("1500");
    expect(formatWithPreset(q, "symbolic")).toContain("1500");
    expect(formatWithPreset(q, "human")).toContain("1500");
    expect(() => formatWithPreset(q, "nope" as never)).toThrow(ExtensionError);
    const m = Measurement.of(Quantity.of(10, "kg"), Quantity.of(0.2, "kg"));
    expect(formatWithPreset(m, "compact")).toContain("±");
  });
});

// ---------------------------------------------------------------------------
// Comparison policies
// ---------------------------------------------------------------------------

describe("comparison policies", () => {
  it("exact/absolute/relative/combined behave distinctly", () => {
    const a = Quantity.of(1.0, "m");
    const b = Quantity.of(1.0 + 5e-10, "m");
    expect(quantitiesEqual(a, b)).toBe(false);
    expect(quantitiesApproximatelyEqual(a, b)).toBe(true);
    expect(compareQuantities(a, b, "absolute", { absoluteTolerance: 1e-9 })).toBe(true);
    expect(compareQuantities(a, b, "absolute", { absoluteTolerance: 1e-12 })).toBe(false);
    expect(compareQuantities(a, b, "relative", { relativeTolerance: 1e-6 })).toBe(true);
    expect(() => compareQuantities(a, Quantity.of(1, "s"), "combined")).toThrow();
    void compareQuantities;
  });
});

// ---------------------------------------------------------------------------
// Diagnostics and strictness
// ---------------------------------------------------------------------------

describe("diagnostics and strictness", () => {
  it("explainConversion reports steps and warnings", () => {
    const r = explainConversion(Quantity.of(1000, "m"), "km");
    expect(r.output).toContain("1");
    expect(r.dimension).toBe("L^1");
    expect(r.warnings.some((w) => w.code === "implicit-conversion")).toBe(true);
    const same = explainConversion(Quantity.of(1, "m"), "m");
    expect(same.warnings).toHaveLength(0);
    const f = defineFormula({
      id: "speed",
      expression: Expression.divide(Expression.variable("d"), Expression.variable("t")),
      inputs: { d: { dimension: "m" }, t: { dimension: "s" } },
      outputName: "v",
    });
    const explained = explainFormula(f, { d: Quantity.of(100, "m"), t: Quantity.of(10, "s") });
    // Prompt-18 correction: divide results read in the emitted composite
    // unit, so the explanation shows 10 (m)/(s) instead of 864000 m/day.
    expect(explained.output).toContain("10");
    expect(explained.formula).toBe("speed");
    expect(resolveStrictness("strict").parserStrict).toBe(true);
    expect(resolveStrictness("permissive").allowAmbiguous).toBe(true);
    expect(resolveStrictness("standard").semanticPolicy).toBe("semantic-aware");
    expect(() => resolveStrictness("chaos" as never)).toThrow();
  });

  it("function metadata helpers and standard references validate", () => {
    expect(() => assertValidFunctionName("sqrt", "x")).not.toThrow();
    expect(() => assertValidFunctionName("Bad Name", "x")).toThrow(ExtensionError);
    expect(() =>
      assertValidStandardReference({ identifier: "BIPM-SI", edition: "9th" }, "x"),
    ).not.toThrow();
    expect(() => assertValidStandardReference({ identifier: "" }, "x")).toThrow(ExtensionError);
    expect(() =>
      assertValidStandardReference({ identifier: "x", effectiveDate: "not-a-date" }, "x"),
    ).toThrow(ExtensionError);
    const withRef = attachStandardRef({ a: 1 }, { identifier: "BIPM-SI" }, "x");
    expect(withRef.standardRef).toBeDefined();
    expect(Object.isFrozen(withRef)).toBe(true);
  });
});
