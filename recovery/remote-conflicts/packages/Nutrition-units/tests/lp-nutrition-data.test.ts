/**
 * lp-nutrition-data.test.ts — Prompt 25 LP forensics tests.
 *
 * SCOPE NOTICE: this package must NOT implement feed formulation, ration
 * balancing, optimization, LP/MILP, HiGHS, or solver infrastructure. This
 * test therefore covers ONLY the legitimate nutrition-data portions of
 * src/examples/lp-builder-example.ts:
 *   JSON feed row → Quantity (via FeedSchemaLoader) → plain-number
 *   coefficients (via coefficientResolver).
 * No solver is imported, built, or executed here. The solver-facing
 * `toHighsColumn` shape is asserted only as a plain-data mapping, and the
 * question of whether the example file belongs in this package is left to
 * the final classification report.
 */
import { describe, expect, it } from "vitest";
// Side-effect import: registers the nutrition calculation rules exactly as a
// real consumer gets them when importing the package entrypoint.
import "../src/index.js";
import { buildConstraintRow, toHighsColumn } from "../src/examples/lp-builder-example.js";
import type { UnitSchema } from "../src/index.js";

const schema: UnitSchema = {
  feed: {
    asFed: { cp: "%", ca: "%", fe: "mg/kg", de: "Mcal/kg" },
    dryMatterBasis: {},
  },
  animal: {},
  requirements: {},
  solver: {},
  feedConstraints: {},
  mineralsLimits: {},
  economics: { feedPrice: "cur/kg" },
};

const row = { name: "corn", cp: 8, ca: 0.02, fe: 20, de: 3.4, price: 0.25 };

describe("lp example — nutrition-data coefficient extraction (no solver)", () => {
  it("produces finite plain-number coefficients from a feed row", () => {
    const out = buildConstraintRow(row, schema);
    expect(out.feedName).toBe("corn");
    for (const v of [
      out.cpCoefficient,
      out.caCoefficient,
      out.feCoefficient,
      out.deCoefficient,
      out.costCoefficient,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("is deterministic for the same inputs", () => {
    expect(buildConstraintRow(row, schema)).toEqual(buildConstraintRow(row, schema));
  });

  it("protein coefficient matches hand arithmetic (8% of 1 kg = 80 g)", () => {
    const out = buildConstraintRow(row, schema);
    expect(out.cpCoefficient).toBeCloseTo(80, 9);
  });

  it("cost coefficient matches the price per kg", () => {
    const out = buildConstraintRow(row, schema);
    expect(out.costCoefficient).toBeCloseTo(0.25, 9);
  });

  it("solver-facing shape is plain data (no Quantity leaks)", () => {
    const col = toHighsColumn(buildConstraintRow(row, schema));
    expect(col.name).toBe("corn");
    expect(typeof col.obj).toBe("number");
    expect(Object.values(col.constraintCoefs).every((v) => typeof v === "number")).toBe(true);
  });
});
