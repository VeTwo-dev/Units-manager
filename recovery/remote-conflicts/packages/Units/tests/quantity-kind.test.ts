/**
 * tests/quantity-kind.test.ts — Phase 22: Domain-Neutral Specialized
 * Scientific Quantities (semantic QuantityKind layer).
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Measurement,
  createRegistry,
  SI_PACK,
  ANGLE_PACK,
  RADIATION_PACK,
  ASTRONOMY_PACK,
  INFORMATION_PACK,
  QuantityKindRegistry,
  defaultQuantityKindRegistry,
  areKindsCompatible,
  assertSemanticCompatible,
  assertSemanticConvertible,
  isQuantityKindId,
  isSemanticPolicy,
  formatQuantity,
  serializeQuantity,
  deserializeQuantity,
  type SemanticPolicy,
} from "../src/index.js";
import {
  IncompatibleQuantityKindError,
  MissingSemanticContextError,
  UnitEngineError,
  UnsupportedSemanticConversionError,
} from "../src/errors/index.js";
import { defineDimension } from "../src/dimension.js";

const reg = createRegistry({
  packs: [SI_PACK, ANGLE_PACK, RADIATION_PACK, ASTRONOMY_PACK, INFORMATION_PACK],
});
const q = (value: number, unit: string) => Quantity.of(value, unit, reg);

// ---------------------------------------------------------------------------
// 22.11/22.12 Registry: extensible, deterministic, isolated, validated
// ---------------------------------------------------------------------------

describe("QuantityKindRegistry", () => {
  it("seeds the twelve generic scientific kinds", () => {
    const ids = defaultQuantityKindRegistry.list().map((k) => k.id);
    expect(ids).toEqual([
      "absorbed-dose",
      "activity",
      "angle",
      "equivalent-dose",
      "frequency",
      "illuminance",
      "information",
      "luminous-flux",
      "luminous-intensity",
      "solid-angle",
      "temperature-absolute",
      "temperature-difference",
    ]);
  });

  it("registers isolated custom kinds without touching the default", () => {
    const isolated = new QuantityKindRegistry([]);
    isolated.register({ id: "angle", name: "Angle", dimension: defineDimension({}) });
    expect(isolated.has("angle")).toBe(true);
    expect(defaultQuantityKindRegistry.has("angle")).toBe(true);
    expect(isolated.list().length).toBe(1);
  });

  it("rejects duplicates, bad ids, self-compatibility, functions, pollution", () => {
    const r = new QuantityKindRegistry([]);
    r.register({ id: "ok", name: "Ok", dimension: defineDimension({}) });
    expect(() => r.register({ id: "ok", name: "Dup", dimension: defineDimension({}) })).toThrow(
      UnitEngineError,
    );
    expect(() => r.register({ id: "Bad Id", name: "x", dimension: defineDimension({}) })).toThrow(
      UnitEngineError,
    );
    expect(() =>
      r.register({
        id: "self",
        name: "x",
        dimension: defineDimension({}),
        compatibleKinds: ["self"],
      }),
    ).toThrow(UnitEngineError);
    expect(() =>
      r.register({
        id: "evil",
        name: "x",
        dimension: defineDimension({}),
        metadata: { fn: (() => 0) as unknown as string },
      }),
    ).toThrow(UnitEngineError);
    expect(() =>
      r.register(JSON.parse('{"id":"p","name":"x","dimension":{},"__proto__":{}}')),
    ).toThrow();
    expect(() => r.require("nope")).toThrow(UnitEngineError);
  });
});

// ---------------------------------------------------------------------------
// 22.3/22.4 Compatibility rules and default-preserving policies
// ---------------------------------------------------------------------------

describe("semantic compatibility", () => {
  it.each([
    ["dimensional-only", "activity", "frequency", true],
    ["semantic-aware", "activity", "activity", true],
    ["semantic-aware", "activity", "frequency", false],
    ["semantic-aware", "angle", undefined, true], // unknown = no claim
    ["semantic-aware", undefined, undefined, true],
    ["semantic-aware", "absorbed-dose", "equivalent-dose", false],
    ["strict-semantic", "angle", "angle", true],
    ["strict-semantic", "angle", undefined, false],
    ["strict-semantic", undefined, undefined, true],
  ] as Array<[SemanticPolicy, string | undefined, string | undefined, boolean]>)(
    "%s: %s vs %s → %s",
    (policy, a, b, expected) => {
      expect(areKindsCompatible(a, b, policy)).toBe(expected);
    },
  );

  it("explicit compatibleKinds listings work symmetrically", () => {
    const r = new QuantityKindRegistry([]);
    r.register({ id: "a", name: "A", dimension: defineDimension({}) });
    r.register({ id: "b", name: "B", dimension: defineDimension({}), compatibleKinds: ["a"] });
    expect(areKindsCompatible("a", "b", "semantic-aware", r)).toBe(true);
    expect(areKindsCompatible("b", "a", "semantic-aware", r)).toBe(true);
  });

  it("assertSemanticCompatible throws typed errors; default policy never throws", () => {
    expect(() => assertSemanticCompatible("activity", "frequency", "semantic-aware")).toThrow(
      IncompatibleQuantityKindError,
    );
    expect(() =>
      assertSemanticCompatible("activity", "frequency", "dimensional-only"),
    ).not.toThrow();
    expect(() => areKindsCompatible("a", "b", "bogus" as SemanticPolicy)).toThrow(UnitEngineError);
    expect(isSemanticPolicy("strict-semantic")).toBe(true);
    expect(isSemanticPolicy("lax")).toBe(false);
    expect(isQuantityKindId("absorbed-dose")).toBe(true);
    expect(isQuantityKindId("Bad")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 22.5–22.10 Kind resolution from packs (+ prefix propagation)
// ---------------------------------------------------------------------------

describe("kind resolution", () => {
  it("packs tag units; plain quantities claim nothing", () => {
    expect(q(1.5, "rad").kind).toBe("angle");
    expect(q(1, "deg").kind).toBe("angle");
    expect(q(1, "sr").kind).toBe("solid-angle");
    expect(q(60, "Hz").kind).toBe("frequency");
    expect(q(1, "Bq").kind).toBe("activity");
    expect(q(1, "Gy").kind).toBe("absorbed-dose");
    expect(q(1, "Sv").kind).toBe("equivalent-dose");
    expect(q(273.15, "K").kind).toBe("temperature-absolute");
    expect(q(8, "bit").kind).toBe("information");
    expect(q(5, "kg").kind).toBeUndefined();
    expect(q(0.5, "fraction").kind).toBeUndefined();
  });

  it("kinds survive prefix derivation", () => {
    expect(q(1, "kHz").kind).toBe("frequency");
    expect(q(1, "mGy").kind).toBe("absorbed-dose");
    expect(q(1, "kB").kind).toBe("information");
    expect(q(1, "MPa").kind).toBeUndefined(); // generic stays generic
  });

  it("withKind sets explicit kinds with dimension validation", () => {
    const delta = q(5, "K").withKind("temperature-difference");
    expect(delta.kind).toBe("temperature-difference");
    expect(delta.value).toBe(5);
    expect(() => q(5, "kg").withKind("angle")).toThrow(); // dimension mismatch
    expect(() => q(5, "kg").withKind("nope")).toThrow(UnitEngineError); // unregistered
  });

  it("requireKind gates kind-sensitive math (e.g. trig wants angle)", () => {
    expect(
      q(Math.PI / 2, "rad")
        .requireKind("angle")
        .sin().value,
    ).toBeCloseTo(1, 12);
    // A gate needs strict-semantic: under semantic-aware, an unknown
    // (kind-less) quantity carries no claim to contradict, so it passes.
    expect(() => q(0.5, "fraction").requireKind("angle", "strict-semantic")).toThrow(
      IncompatibleQuantityKindError,
    );
    expect(q(0.5, "fraction").requireKind("angle", "semantic-aware").value).toBe(0.5);
    // Default dimensional path still accepts plain dimensionless trig.
    expect(Quantity.of(0, "fraction", reg).sin().value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 22.6 Temperature semantics through arithmetic
// ---------------------------------------------------------------------------

describe("temperature semantics", () => {
  it("absolute − absolute = explicitly-tagged interval", () => {
    const delta = Quantity.of(20, "°C", reg).subtract(Quantity.of(15, "°C", reg));
    expect(delta.kind).toBe("temperature-difference");
    expect(delta.value).toBeCloseTo(5, 12);
  });

  it("absolute + interval keeps the absolute kind", () => {
    const r = Quantity.of(10, "°C", reg).add(Quantity.of(5, "K", reg));
    expect(r.kind).toBe("temperature-absolute");
  });

  it("semantic-aware blocks absolute/interval mixing, default allows", () => {
    const abs = Quantity.of(10, "°C", reg);
    const delta = Quantity.of(20, "°C", reg).subtract(Quantity.of(15, "°C", reg));
    expect(() => abs.add(delta, { semanticPolicy: "semantic-aware" })).toThrow(
      IncompatibleQuantityKindError,
    );
    expect(() => abs.add(delta)).not.toThrow(); // default dimensional-only
  });

  it("scaling an interval preserves its kind", () => {
    const delta = Quantity.of(20, "°C", reg).subtract(Quantity.of(15, "°C", reg));
    expect(delta.scale(2).kind).toBe("temperature-difference");
  });
});

// ---------------------------------------------------------------------------
// 22.7/22.8 Dose and activity semantics (no medical logic — kinds only)
// ---------------------------------------------------------------------------

describe("dose and activity semantics", () => {
  it("Gy and Sv share a dimension vector but never a kind", () => {
    expect(q(1, "Gy").dimension).toEqual(q(1, "Sv").dimension);
    expect(q(1, "Gy").kind).not.toBe(q(1, "Sv").kind);
    // Dimensional math converts (same vector); semantic-aware callers block.
    expect(q(1, "Gy").to("Sv", reg).value).toBeCloseTo(1, 12);
    expect(() => q(1, "Gy").to("Sv", reg, { semanticPolicy: "semantic-aware" })).toThrow(
      UnsupportedSemanticConversionError,
    );
  });

  it("activity ≠ frequency under semantic-aware addition", () => {
    const a = Measurement.of(q(100, "Bq"), q(5, "Bq"));
    const f = Measurement.of(q(100, "Hz"), q(5, "Hz"));
    expect(() => a.add(f, { semanticPolicy: "semantic-aware" })).toThrow(
      IncompatibleQuantityKindError,
    );
    expect(a.add(f).value.value).toBe(200); // default path unchanged
  });
});

// ---------------------------------------------------------------------------
// 22.9/22.10 Luminous and information semantics
// ---------------------------------------------------------------------------

describe("luminous and information semantics", () => {
  it("lm and cd share dimension J but differ in kind", () => {
    expect(q(1, "lm").dimension).toEqual(q(1, "cd").dimension);
    expect(q(1, "lm").kind).toBe("luminous-flux");
    expect(q(1, "cd").kind).toBe("luminous-intensity");
  });

  it("information never mixes with pure ratios, even semantically", () => {
    expect(() => q(8, "bit").add(q(8, "fraction"))).toThrow(); // dimension mismatch first
  });
});

// ---------------------------------------------------------------------------
// 22.13 Semantic conversion with context
// ---------------------------------------------------------------------------

describe("semantic conversion context", () => {
  it("context-requiring kinds fail explicitly without context", () => {
    const r = new QuantityKindRegistry([]);
    r.register({
      id: "level",
      name: "Level",
      dimension: defineDimension({}),
      requiresContext: true,
    });
    expect(() => assertSemanticConvertible("level", "level", { registry: r })).toThrow(
      MissingSemanticContextError,
    );
    expect(() =>
      assertSemanticConvertible("level", "level", { registry: r, context: { ref: 1 } }),
    ).not.toThrow();
    // dimensional-only ignores kinds entirely, even context-requiring ones.
    expect(() =>
      assertSemanticConvertible("level", "level", { registry: r, policy: "dimensional-only" }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 22.15 Serialization preserves kinds explicitly
// ---------------------------------------------------------------------------

describe("kind serialization", () => {
  it("round-trips kind; validates registration and dimension", () => {
    const original = q(1.5, "rad");
    const restored = deserializeQuantity(
      JSON.parse(JSON.stringify(serializeQuantity(original))),
      reg,
    );
    expect(restored.kind).toBe("angle");
    expect(serializeQuantity(q(5, "kg")).kind).toBeUndefined();
    expect(() =>
      deserializeQuantity(
        { version: 1, type: "quantity", value: 1, unit: "rad", kind: "nope" },
        reg,
      ),
    ).toThrow();
    // Kind must match the unit's dimension — no smuggling angle onto kg.
    expect(() =>
      deserializeQuantity(
        { version: 1, type: "quantity", value: 1, unit: "kg", kind: "angle" },
        reg,
      ),
    ).toThrow();
    // Absent kind falls back to the unit's registered claim (not inference).
    const bare = deserializeQuantity({ version: 1, type: "quantity", value: 1, unit: "rad" }, reg);
    expect(bare.kind).toBe("angle");
  });

  it("rejects kind pollution payloads", () => {
    expect(() =>
      deserializeQuantity(
        JSON.parse('{"version":1,"type":"quantity","value":1,"unit":"rad","__proto__":{}}'),
        reg,
      ),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 22.16/22.17 Parser and formatter integration
// ---------------------------------------------------------------------------

describe("parser and formatter integration", () => {
  it("parser resolves kinds from registered definitions (no logic in parser)", () => {
    expect(q(1, "rad").kind).toBe("angle");
    expect(q(1, "rad").add(q(1, "deg")).kind).toBe("angle"); // left-unit carry
  });

  it("showKind is display-only", () => {
    expect(formatQuantity(q(1.5, "rad"), { showKind: true })).toBe("1.50 rad [angle]");
    expect(formatQuantity(q(1.5, "rad")).includes("[angle]")).toBe(false);
    expect(formatQuantity(q(5, "kg"), { showKind: true }).includes("[")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 22.18 Basic API unchanged; 22.24 property tests
// ---------------------------------------------------------------------------

describe("backward compatibility and properties", () => {
  it("basic API needs no kind knowledge", () => {
    expect(Quantity.of(10, "kg").to("g").value).toBe(10000);
    expect(Quantity.of(5, "kg").multiply(Quantity.of(2, "m")).toBase().value).toBe(10);
  });

  it("equivalent representations share dimensions (property)", () => {
    const pairs: Array<[string, string]> = [
      ["N", "kg·m/s²"],
      ["Pa", "N/m²"],
      ["W", "J/s"],
      ["V", "W/A"],
      ["deg", "rad"],
      ["kWh", "J"],
      ["Gy", "J/kg"],
      ["lm", "cd·sr"],
    ];
    for (const [a, b] of pairs) {
      expect(q(1, a).dimension).toEqual(q(1, b).dimension);
    }
  });

  it("kind-tagged conversions are symmetric where compatible (property)", () => {
    expect(q(180, "deg").to("rad", reg).to("deg", reg).value).toBeCloseTo(180, 9);
    expect(q(1, "Ci").to("Bq", reg).to("Ci", reg).value).toBeCloseTo(1, 9);
    expect(q(1, "pc").to("m", reg).to("pc", reg).value).toBeCloseTo(1, 6);
  });

  it("no semantic equivalence assumed between dose kinds (property)", () => {
    expect(() =>
      assertSemanticCompatible("absorbed-dose", "equivalent-dose", "semantic-aware"),
    ).toThrow(IncompatibleQuantityKindError);
    expect(() => assertSemanticCompatible("activity", "frequency", "semantic-aware")).toThrow(
      IncompatibleQuantityKindError,
    );
  });
});

// ---------------------------------------------------------------------------
// Measurement kind exposure
// ---------------------------------------------------------------------------

describe("Measurement kinds", () => {
  it("exposes value kind and gates add/subtract on request", () => {
    const m = Measurement.of(q(10, "Bq"), q(1, "Bq"));
    expect(m.kind).toBe("activity");
    expect(Measurement.of(q(10, "kg"), q(1, "kg")).kind).toBeUndefined();
    const same = Measurement.of(q(5, "Bq"), q(0.5, "Bq"));
    expect(m.add(same, { semanticPolicy: "semantic-aware" }).kind).toBe("activity");
  });
});
