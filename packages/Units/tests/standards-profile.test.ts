/**
 * standards-profile.test.ts — Phase 28: unit systems, standards profiles
 * and multi-system interoperability.
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  Measurement,
  Expression,
  ProfileRegistry,
  registerStandardProfiles,
  SI_PROFILE,
  CGS_PROFILE,
  IMPERIAL_PROFILE,
  US_CUSTOMARY_PROFILE,
  SI_SYSTEM,
  CGS_SYSTEM,
  IMPERIAL_SYSTEM,
  preferredUnitForDimension,
  isAllowed,
  unitStatus,
  normalizeToSystem,
  normalizeMeasurementToSystem,
  selectUnitForMagnitude,
  convertBetweenSystems,
  resolveContext,
  evaluateInContext,
  displayMeasurement,
  formatWithContext,
  importUnitName,
  validateImportMapping,
  serializeProfile,
  deserializeProfile,
  defineFormula,
  createRegistry,
  SI_PACK,
  IMPERIAL_PACK,
  CGS_PACK,
  UnitSystemError,
  UnsupportedTransformationError,
  dimensionKey,
  parseUnit,
} from "../src/index.js";

const all = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK, CGS_PACK] });
const O = { registry: all };

function profiles(): ProfileRegistry {
  const regs = new ProfileRegistry();
  registerStandardProfiles(regs);
  return regs;
}

// ---------------------------------------------------------------------------
// Registration, validation, inheritance
// ---------------------------------------------------------------------------

describe("ProfileRegistry", () => {
  it("registers the four standard profiles with versions", () => {
    const regs = profiles();
    expect(regs.list().map((p) => p.id)).toEqual(["cgs", "imperial", "si", "us-customary"]);
    expect(regs.get("si").version).toBe("1.0.0");
    expect(regs.version).toBe(4);
    // Exported profile constants match the registered entries.
    expect(regs.get("si").displayName).toBe(SI_PROFILE.displayName);
    expect(regs.get("cgs").unitSystem).toBe(CGS_PROFILE.unitSystem);
    expect(regs.get("imperial").preferredUnits).toEqual(IMPERIAL_PROFILE.preferredUnits);
    expect(regs.get("us-customary").version).toBe(US_CUSTOMARY_PROFILE.version);
    // Single-profile serialization round-trips through the registry path.
    const single = serializeProfile(regs.get("si"));
    expect(single.id).toBe("si");
    expect(single.type).toBe("standards-profile");
  });

  it("rejects duplicates, bad ids, empty versions, unknown parents, self-extend", () => {
    const regs = profiles();
    expect(() => regs.register({ ...SI_PROFILE })).toThrow(UnitSystemError);
    expect(() => regs.register({ id: "bad id", version: "1", unitSystem: "si" })).toThrow(
      UnitSystemError,
    );
    expect(() => regs.register({ id: "x", version: "", unitSystem: "si" })).toThrow(
      UnitSystemError,
    );
    expect(() =>
      regs.register({ id: "x", version: "1", unitSystem: "si", extends: "ghost" }),
    ).toThrow(UnitSystemError);
    expect(() => regs.register({ id: "x", version: "1", unitSystem: "si", extends: "x" })).toThrow(
      UnitSystemError,
    );
    // A extends B, B extends A is impossible: whichever registers second
    // names an unknown parent (cycles structurally impossible).
    const r2 = new ProfileRegistry();
    r2.register({ id: "a", version: "1", unitSystem: "si", extends: undefined });
    expect(() =>
      r2.register({ id: "b", version: "1", unitSystem: "si", extends: "a" }),
    ).not.toThrow();
    expect(r2.get("b").unitSystem).toBe("si");
  });

  it("inheritance merges with child winning", () => {
    const regs = new ProfileRegistry();
    regs.register({
      id: "base",
      version: "1",
      unitSystem: "si",
      preferredUnits: { "M^1": "kg", "L^1": "m" },
      allowedUnits: ["kg", "m"],
      formatting: { decimals: 2 },
    });
    const child = regs.register({
      id: "child",
      version: "1",
      unitSystem: "si",
      extends: "base",
      preferredUnits: { "M^1": "g" },
      formatting: { notation: "scientific" },
    });
    expect(child.preferredUnits?.["M^1"]).toBe("g");
    expect(child.preferredUnits?.["L^1"]).toBe("m");
    expect(child.allowedUnits).toEqual(["kg", "m"]);
    expect(child.formatting).toEqual({ decimals: 2, notation: "scientific" });
    expect(child.extends).toBe("base");
  });

  it("unregister never cascades (dependents keep flattened copies)", () => {
    const regs = new ProfileRegistry();
    regs.register({ id: "base", version: "1", unitSystem: "si", preferredUnits: { "M^1": "kg" } });
    regs.register({ id: "child", version: "1", unitSystem: "si", extends: "base" });
    regs.unregister("base");
    expect(regs.has("base")).toBe(false);
    expect(regs.get("child").preferredUnits?.["M^1"]).toBe("kg");
  });
});

// ---------------------------------------------------------------------------
// Preferred units, availability, status
// ---------------------------------------------------------------------------

describe("preferred units and availability", () => {
  it("every built-in preferredUnits entry matches its dimension key", () => {
    const regs = profiles();
    const reg = createRegistry({ packs: [SI_PACK, IMPERIAL_PACK, CGS_PACK] });
    for (const profile of regs.list()) {
      for (const [key, symbol] of Object.entries(profile.preferredUnits ?? {})) {
        const unit = parseUnit(symbol, reg);
        expect(dimensionKey(unit.dimension), `${profile.id}:${symbol}`).toBe(key);
      }
    }
  });

  it("preferredUnitForDimension falls back to system categories for base dims", () => {
    expect(preferredUnitForDimension({ M: 1 }, SI_SYSTEM)).toBe("kg");
    expect(preferredUnitForDimension({ M: 1 }, CGS_SYSTEM)).toBe("g");
    expect(preferredUnitForDimension({ L: 1, T: -1 }, SI_SYSTEM)).toBeUndefined();
    const regs = profiles();
    expect(preferredUnitForDimension({ M: 1, L: 1, T: -2 }, SI_SYSTEM, regs.get("si"))).toBe("N");
  });

  it("isAllowed/unitStatus separate policy from identity", () => {
    const regs = profiles();
    const si = regs.get("si");
    expect(isAllowed("m", si)).toBe(true);
    expect(isAllowed("gal", si)).toBe(false);
    expect(unitStatus("m", si)).toBe("accepted");
    expect(unitStatus("gal", si)).toBe("forbidden");
    const custom = regs.register({
      id: "lab",
      version: "1",
      unitSystem: "si",
      deprecatedUnits: { ft: "use SI metres" },
    });
    expect(unitStatus("ft", custom)).toBe("deprecated");
    expect(unitStatus("m", custom)).toBe("accepted"); // no allow-list → unrestricted
    // Identity untouched: deprecated units still resolve and convert.
    expect(Quantity.of(1, "ft", all).to("m", all).value).toBeCloseTo(0.3048, 12);
  });
});

// ---------------------------------------------------------------------------
// Conversion and normalization (engine does the math)
// ---------------------------------------------------------------------------

describe("cross-system conversion", () => {
  it("SI ↔ Imperial ↔ CGS where supported", () => {
    const regs = profiles();
    const cgs = { profile: regs.get("cgs"), ...O };
    const imp = { profile: regs.get("imperial"), ...O };
    expect(convertBetweenSystems(Quantity.of(1, "N", all), "cgs", cgs).value).toBeCloseTo(
      100000,
      6,
    );
    expect(
      convertBetweenSystems(Quantity.of(100, "km/h", all), "imperial", {
        profile: {
          ...regs.get("imperial"),
          preferredUnits: { ...regs.get("imperial").preferredUnits, "L^1·T^-1": "mph" },
        },
        ...O,
      }).value,
    ).toBeCloseTo(62.1371, 4);
    // Composites without a mapping fail explicitly — never guessed.
    expect(() => convertBetweenSystems(Quantity.of(100, "km/h", all), "imperial", imp)).toThrow(
      UnitSystemError,
    );
    expect(() => convertBetweenSystems(Quantity.of(1, "kg", all), "nope", O)).toThrow(
      UnitSystemError,
    );
  });

  it("normalizeToSystem keeps display intent out of storage", () => {
    const regs = profiles();
    const q = Quantity.of(1000, "g", all);
    const normalized = normalizeToSystem(q, SI_SYSTEM, { profile: regs.get("si"), ...O });
    expect(normalized.unit.symbol).toBe("kg");
    expect(normalized.value).toBeCloseTo(1, 12);
    expect(q.unit.symbol).toBe("g"); // original untouched
    expect(q.value).toBe(1000);
  });

  it("temperature deltas land on kelvin; affine policy respected", () => {
    const regs = profiles();
    const delta = Quantity.of(5, "K", all).withKind("temperature-difference");
    expect(normalizeToSystem(delta, SI_SYSTEM, { profile: regs.get("si"), ...O }).unit.symbol).toBe(
      "K",
    );
    expect(
      normalizeToSystem(Quantity.of(32, "°F", all), SI_SYSTEM, { profile: regs.get("si"), ...O })
        .unit.symbol,
    ).toBe("K");
    const noAffine = regs.register({
      id: "no-affine",
      version: "1",
      unitSystem: "si",
      conversionPolicy: { allowAffine: false },
    });
    expect(() =>
      normalizeToSystem(Quantity.of(20, "°C", all), SI_SYSTEM, { profile: noAffine, ...O }),
    ).toThrow(UnsupportedTransformationError);
  });

  it("measurements convert value and uncertainty together", () => {
    const regs = profiles();
    const m = Measurement.of(Quantity.of(100, "km/h", all), Quantity.of(2, "km/h", all));
    const mphProfile = {
      ...regs.get("imperial"),
      preferredUnits: { ...regs.get("imperial").preferredUnits, "L^1·T^-1": "mph" },
    };
    const converted = normalizeMeasurementToSystem(m, IMPERIAL_SYSTEM, {
      profile: mphProfile,
      ...O,
    });
    expect(converted.value.unit.symbol).toBe("mph");
    expect(converted.value.value).toBeCloseTo(62.1371, 4);
    expect(converted.uncertainty.unit.symbol).toBe("mph");
    expect(converted.uncertainty.value).toBeCloseTo(1.24274, 4);
    expect(m.value.unit.symbol).toBe("km/hour"); // original untouched (canonical parse form)
  });
});

// ---------------------------------------------------------------------------
// Automatic prefix selection (display only)
// ---------------------------------------------------------------------------

describe("selectUnitForMagnitude", () => {
  it("picks engineering prefixes deterministically", () => {
    expect(selectUnitForMagnitude(Quantity.of(0.001, "m", all), O).unit.symbol).toBe("mm");
    expect(selectUnitForMagnitude(Quantity.of(1500, "m", all), O).unit.symbol).toBe("km");
    expect(selectUnitForMagnitude(Quantity.of(5, "m", all), O).unit.symbol).toBe("m");
    expect(selectUnitForMagnitude(Quantity.of(2.5e9, "Hz", all), O).unit.symbol).toBe("GHz");
  });

  it("never alters the quantity; skips unparseable collisions", () => {
    const q = Quantity.of(60, "s", all);
    const selected = selectUnitForMagnitude(q, O);
    // 60 s → scaled 60 in s (no prefix gives [1,1000) except none) — value preserved either way.
    expect(selected.to("s", all).value).toBeCloseTo(60, 12);
    // "min" trap: base "in" + "m" must not become minute.
    const inch = Quantity.of(5000, "in", all);
    const sel = selectUnitForMagnitude(inch, O);
    expect(sel.dimension).toEqual(inch.dimension);
    expect(selectUnitForMagnitude(Quantity.of(0, "m", all), O).unit.symbol).toBe("m");
  });
});

// ---------------------------------------------------------------------------
// ScientificContext, formatting, formula integration
// ---------------------------------------------------------------------------

describe("ScientificContext", () => {
  it("resolves systems and profiles; reference data recorded", () => {
    const regs = profiles();
    const ctx = resolveContext({
      unitSystem: "cgs",
      profiles: regs,
      registry: all,
      referenceData: { codata: "2018" },
    });
    expect(ctx.system?.name).toBe("cgs");
    expect(() => resolveContext({ unitSystem: "nope" })).toThrow(UnitSystemError);
    expect(() => resolveContext({ profile: "si" })).toThrow(UnitSystemError);
  });

  it("formatWithContext converts and formats", () => {
    const regs = profiles();
    const out = formatWithContext(Quantity.of(1, "N", all), {
      unitSystem: "cgs",
      profiles: regs,
      registry: all,
    });
    expect(out).toContain("dyn");
    const plain = formatWithContext(Quantity.of(1, "m", all), {});
    expect(plain).toContain("m");
  });

  it("evaluateInContext presents formula results in system units", () => {
    const regs = profiles();
    const force = defineFormula({
      id: "force",
      expression: Expression.multiply(Expression.variable("mass"), Expression.variable("accel")),
      inputs: { mass: { dimension: "kg" }, accel: { dimension: "m/s^2" } },
      outputName: "force",
    });
    const { result, system, unit } = evaluateInContext(
      force,
      { mass: Quantity.of(10, "kg"), accel: Quantity.of(2, "m/s^2", all) },
      { unitSystem: "cgs", profiles: regs, registry: all },
    );
    expect(system).toBe("cgs");
    expect(unit).toBe("dyn");
    if (!(result instanceof Quantity)) throw new Error("expected Quantity");
    expect(result.value).toBeCloseTo(2e6, 0);
  });

  it("displayMeasurement renders converted value ± uncertainty", () => {
    const regs = profiles();
    const mphProfile = {
      ...regs.get("imperial"),
      preferredUnits: { ...regs.get("imperial").preferredUnits, "L^1·T^-1": "mph" },
    };
    const m = Measurement.of(Quantity.of(100, "km/h", all), Quantity.of(2, "km/h", all));
    const text = displayMeasurement(
      m,
      { unitSystem: "imperial", profiles: regs, registry: all },
      { profile: mphProfile, ...O },
    );
    expect(text).toContain("mph");
    expect(text).toContain("±");
    expect(m.value.unit.symbol).toBe("km/hour"); // untouched (canonical parse form)
  });
});

// ---------------------------------------------------------------------------
// Import mapping, serialization, security, properties
// ---------------------------------------------------------------------------

describe("import mapping", () => {
  it("maps explicit external names; rejects unknown and bad targets", () => {
    const mapping = { "kg/m3": "kg/m^3", "lb/ft^3": "lb/ft^3" } as const;
    expect(importUnitName("kg/m3", mapping, O).symbol).toBe("kg/m^3");
    expect(() => importUnitName("slug/ft3", mapping, O)).toThrow(UnitSystemError);
    expect(() => importUnitName("x", { x: "nope_xyz" }, O)).toThrow(UnitSystemError);
    expect(validateImportMapping(mapping, O)).toEqual(["kg/m3", "lb/ft^3"]);
    expect(() => validateImportMapping({ x: "nope_xyz" }, O)).toThrow(UnitSystemError);
    expect(() =>
      validateImportMapping({ a: "kg", b: "m" }, { ...O, limits: { maxMappings: 1 } }),
    ).toThrow(UnitSystemError);
  });
});

describe("profile serialization", () => {
  it("round-trips registries deterministically", () => {
    const regs = profiles();
    regs.register({
      id: "lab",
      version: "2.1.0",
      unitSystem: "si",
      extends: "si",
      preferredUnits: { "M^1": "g" },
      deprecatedUnits: { ft: "use metres" },
      referenceData: { codata: "2018" },
    });
    const json = JSON.stringify(regs.serialize());
    const back = ProfileRegistry.deserialize(JSON.parse(json));
    expect(JSON.stringify(back.serialize())).toBe(json);
    expect(back.get("lab").preferredUnits?.["M^1"]).toBe("g");
    expect(back.get("lab").preferredUnits?.["L^1"]).toBe("m"); // inherited
    expect(() => ProfileRegistry.deserialize({ version: 2 })).toThrow(UnitSystemError);
    expect(() => ProfileRegistry.deserialize("not json{[")).toThrow(UnitSystemError);
    expect(() =>
      ProfileRegistry.deserialize(
        JSON.parse('{"version":1,"type":"profile-registry","profiles":[],"__proto__":{}}'),
      ),
    ).toThrow(UnitSystemError);
  });

  it("rejects malformed profiles and oversized payloads", () => {
    expect(() => deserializeProfile({ version: 1, type: "standards-profile" })).toThrow(
      UnitSystemError,
    );
    expect(() =>
      deserializeProfile({
        version: 1,
        type: "standards-profile",
        id: "x",
        profileVersion: "1",
        unitSystem: "si",
        formatting: { notation: "hex" },
      }),
    ).toThrow(UnitSystemError);
    expect(() =>
      ProfileRegistry.deserialize("x".repeat(100), { limits: { maxSerializedChars: 10 } }),
    ).toThrow(UnitSystemError);
    const regs = new ProfileRegistry({ limits: { maxProfiles: 1 } });
    regs.register({ id: "a", version: "1", unitSystem: "si" });
    expect(() => regs.register({ id: "b", version: "1", unitSystem: "si" })).toThrow(
      UnitSystemError,
    );
  });
});

describe("property: round-trip conversion", () => {
  it("convert(convert(x, A, B), B, A) ≈ x", () => {
    const cases: Array<[number, string, string]> = [
      [100, "km/h", "mph"],
      [1, "N", "dyn"],
      [32, "°F", "K"],
      [5, "gal", "L"],
    ];
    for (const [value, from, to] of cases) {
      const there = Quantity.of(value, from, all).to(to, all);
      const back = there.to(from, all);
      expect(back.value).toBeCloseTo(value, 6);
    }
  });

  it("preferred-unit normalization is idempotent and value-preserving", () => {
    const regs = profiles();
    for (const profileId of ["si", "cgs", "imperial", "us-customary"] as const) {
      const profile = regs.get(profileId);
      for (const [key, symbol] of Object.entries(profile.preferredUnits ?? {})) {
        // Skip symbols outside the test registry (e.g. gal needs US pack).
        let q: Quantity;
        try {
          q = Quantity.of(2.5, symbol, all);
        } catch {
          continue;
        }
        void key;
        const once = normalizeToSystem(q, SI_SYSTEM, { profile, ...O });
        const twice = normalizeToSystem(once, SI_SYSTEM, { profile, ...O });
        expect(twice.unit.symbol).toBe(once.unit.symbol);
        expect(twice.value).toBeCloseTo(once.value, 12);
        expect(once.toBase().value).toBeCloseTo(q.toBase().value, 9);
      }
    }
  });
});
