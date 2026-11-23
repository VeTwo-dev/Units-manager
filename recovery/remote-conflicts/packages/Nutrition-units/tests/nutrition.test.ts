/**
 * tests/nutrition.test.ts
 * -----------------------------------------------------------------------
 * Specification tests for the nutrition domain layer. All expected
 * magnitudes were verified by hand against the dimensional algebra of
 * @vetwo/units (see ARCHITECTURE.md "Verified example calculations").
 * -----------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";
import { Quantity, UnitMismatchError } from "@vetwo/units";
// Import through the package entry point so its module-load side effect
// (registering the nutrition calculation rules) always runs first.
import {
  nutritionMath,
  BasisConverter,
  CoefficientResolver,
  coefficientResolver,
  defaultTargetUnitRegistry,
  FeedSchemaLoader,
  type UnitSchema,
} from "../src/index.js";

const INTAKE_10_KG_DAY = Quantity.of(10, "kg/day");

// ---------------------------------------------------------------------------
// NutritionMath
// ---------------------------------------------------------------------------

describe("NutritionMath.calculate", () => {
  it.each([
    ["cp", 12, "%", 1200],
    ["ca", 0.9, "%", 90],
    ["fe", 80, "mg/kg", 800],
    ["de", 3.2, "Mcal/kg", 32],
    ["vitA", 5000, "IU/kg", 50000],
  ] as const)(
    "computes %s contribution in the nutrient's reporting unit",
    (key, value, unit, expected) => {
      const result = nutritionMath.calculate(INTAKE_10_KG_DAY, Quantity.of(value, unit), key);
      expect(result.unit.symbol).toBe(defaultTargetUnitRegistry.getTargetUnit(key));
      expect(result.value).toBeCloseTo(expected, 6);
    },
  );

  it("sums contributions of the same nutrient across feeds", () => {
    const a = nutritionMath.calculate(Quantity.of(5, "kg/day"), Quantity.of(12, "%"), "cp");
    const b = nutritionMath.calculate(Quantity.of(5, "kg/day"), Quantity.of(12, "%"), "cp");
    expect(nutritionMath.sum([a, b]).to("g/day").value).toBeCloseTo(1200, 6);
  });

  it("refuses results whose dimension matches no reporting unit", () => {
    // kg × Mcal is mass·energy — no nutrient reports in that dimension
    expect(() =>
      nutritionMath.calculate(Quantity.of(1, "kg"), Quantity.of(1, "Mcal"), "de"),
    ).toThrow(/Impossible conversion/);
    expect(() => Quantity.of(1, "kg").add(Quantity.of(1, "Mcal"))).toThrow(UnitMismatchError);
  });
});

describe("NutritionMath.calculateCost", () => {
  it("10 kg/day x 0.35 cur/kg -> 3.5 cur/day", () => {
    const cost = nutritionMath.calculateCost(INTAKE_10_KG_DAY, Quantity.of(0.35, "cur/kg"));
    expect(cost.value).toBeCloseTo(3.5, 9);
    expect(cost.unit.symbol).toBe("cur/day");
  });
});

// ---------------------------------------------------------------------------
// BasisConverter
// ---------------------------------------------------------------------------

describe("BasisConverter", () => {
  it("converts 15 % DM at 88 % DM to 13.2 % as-fed", () => {
    const asFed = BasisConverter.toAsFed(Quantity.of(15, "% DM"), Quantity.of(88, "%"));
    expect(asFed.value).toBeCloseTo(13.2, 9);
    expect(asFed.unit.basis).toBeUndefined();
  });

  it("round-trips back to dry matter", () => {
    const dm = BasisConverter.toDryMatterBasis(Quantity.of(13.2, "%"), Quantity.of(88, "%"));
    expect(dm.value).toBeCloseTo(15, 6);
    expect(dm.unit.basis).toBe("DM");
  });

  it("rejects a non-DM quantity passed as dry matter", () => {
    expect(() => BasisConverter.toAsFed(Quantity.of(15, "%"), Quantity.of(88, "%"))).toThrow();
  });

  it("rejects a dry-matter percent that is not a % quantity", () => {
    expect(() =>
      BasisConverter.toAsFed(Quantity.of(15, "% DM"), Quantity.of(0.88, "fraction")),
    ).toThrow();
  });

  it("rejects division by 0 % dry matter", () => {
    expect(() =>
      BasisConverter.toDryMatterBasis(Quantity.of(13.2, "%"), Quantity.of(0, "%")),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CoefficientResolver — the solver boundary
// ---------------------------------------------------------------------------

describe("CoefficientResolver", () => {
  it("returns plain numbers suitable for an LP constraint matrix", () => {
    expect(
      coefficientResolver.getCoefficient(INTAKE_10_KG_DAY, Quantity.of(12, "%"), "cp"),
    ).toBeCloseTo(1200, 6);
    expect(
      coefficientResolver.getCostCoefficient(INTAKE_10_KG_DAY, Quantity.of(0.35, "cur/kg")),
    ).toBeCloseTo(3.5, 9);
    expect(coefficientResolver.getBound(Quantity.of(450, "kg"), "lb")).toBeCloseTo(992.0801798, 4);
    expect(new CoefficientResolver().getBound(Quantity.of(1, "kg"), "g")).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// TargetUnitRegistry overrides
// ---------------------------------------------------------------------------

describe("TargetUnitRegistry", () => {
  it("allows overriding a reporting unit without touching the table", () => {
    const registry = defaultTargetUnitRegistry;
    registry.override("me", "Mcal/day");
    expect(registry.getTargetUnit("me")).toBe("Mcal/day");
    const result = nutritionMath.calculate(INTAKE_10_KG_DAY, Quantity.of(3.2, "Mcal/kg"), "me");
    expect(result.unit.symbol).toBe("Mcal/day");
    expect(result.value).toBeCloseTo(32, 6);
    registry.override("me", "Kcal/day"); // restore spec default
  });
});

// ---------------------------------------------------------------------------
// FeedSchemaLoader
// ---------------------------------------------------------------------------

const SCHEMA: UnitSchema = {
  feed: { asFed: { cp: "%" }, dryMatterBasis: { cp: "% DM" } },
  animal: { bodyWeight: "kg" },
  requirements: { cpMin: "g/day" },
  solver: { decisionVariable: "kg/day" },
  feedConstraints: { maxInclusion: "kg/day" },
  mineralsLimits: { caMax: "g/day" },
  economics: { price: "cur/kg" },
};

describe("FeedSchemaLoader", () => {
  const loader = new FeedSchemaLoader(SCHEMA);

  it("builds Quantities from the JSON unit-map", () => {
    expect(loader.asFed("cp", 12).toString()).toBe("12 %");
    expect(loader.dryMatterBasis("cp", 15).toString()).toBe("15 % DM");
    expect(loader.requirement("cpMin", 900).unit.symbol).toBe("g/day");
    expect(loader.animal("bodyWeight", 450).unit.symbol).toBe("kg");
    expect(loader.economics("price", 0.35).unit.symbol).toBe("cur/kg");
    expect(loader.feedConstraint("maxInclusion", 10).unit.symbol).toBe("kg/day");
  });

  it("throws when a field has no registered unit", () => {
    expect(() => loader.asFed("unknownField" as never, 1)).toThrow(/Missing unit/);
  });

  it("integrates with NutritionMath end-to-end", () => {
    const intake = new FeedSchemaLoader(SCHEMA).solver("decisionVariable", 10);
    const cp = loader.asFed("cp", 12);
    expect(nutritionMath.calculate(intake, cp, "cp").to("g/day").value).toBeCloseTo(1200, 6);
  });
});
