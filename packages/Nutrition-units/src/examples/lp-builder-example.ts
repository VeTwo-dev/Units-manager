/**
 * examples/lp-builder-example.ts
 * -----------------------------------------------------------------------
 * Demonstrates end-to-end flow: JSON feed row -> Quantity -> Coefficient ->
 * HiGHS-ready plain numbers. Nowhere does this file write `/100` or `*1000`.
 * -----------------------------------------------------------------------
 */
import { Quantity } from "@vetwo/units";
import { coefficientResolver } from "../coefficient-resolver.js";
import { FeedSchemaLoader, type UnitSchema } from "../feed-schema-loader.js";

// A minimal slice of a Feed Database row (as-fed basis), straight from JSON.
interface FeedRow {
  name: string;
  cp: number; // percent
  ca: number; // percent
  fe: number; // mg/kg
  de: number; // Mcal/kg
  price: number; // currency/kg
}

interface HighsConstraintRow {
  feedName: string;
  cpCoefficient: number; // grams CP per kg of feed
  caCoefficient: number; // grams Ca per kg of feed
  feCoefficient: number; // mg Fe per kg of feed
  deCoefficient: number; // Mcal per kg of feed
  costCoefficient: number; // currency per kg of feed
}

export function buildConstraintRow(row: FeedRow, schema: UnitSchema): HighsConstraintRow {
  const loader = new FeedSchemaLoader(schema);

  // One "unit" of the decision variable == 1 kg/day of this feed.
  // NOTE: intake must carry the /day rate dimension so that multiplying by
  // a dimensionless "%" or "mg/kg" concentration yields a per-day contribution
  // (e.g. g/day, mg/day) — matching the solver's kg/day decision variable.
  const oneUnitIntake = Quantity.of(1, "kg/day");

  const cpConc = loader.asFed("cp", row.cp);
  const caConc = loader.asFed("ca", row.ca);
  const feConc = loader.asFed("fe", row.fe);
  const deConc = loader.asFed("de", row.de);
  const price = loader.economics("feedPrice", row.price);

  return {
    feedName: row.name,
    cpCoefficient: coefficientResolver.getCoefficient(oneUnitIntake, cpConc, "cp"),
    caCoefficient: coefficientResolver.getCoefficient(oneUnitIntake, caConc, "ca"),
    feCoefficient: coefficientResolver.getCoefficient(oneUnitIntake, feConc, "fe"),
    deCoefficient: coefficientResolver.getCoefficient(oneUnitIntake, deConc, "de"),
    costCoefficient: coefficientResolver.getCostCoefficient(oneUnitIntake, price),
  };
}

/**
 * The solver module receives ONLY `HighsConstraintRow` objects — plain
 * numbers — and builds the HiGHS problem. It never imports @vetwo/units
 * or nutrition-engine at all.
 */
export function toHighsColumn(row: HighsConstraintRow) {
  return {
    name: row.feedName,
    obj: row.costCoefficient,
    constraintCoefs: {
      cp: row.cpCoefficient,
      ca: row.caCoefficient,
      fe: row.feCoefficient,
      de: row.deCoefficient,
    },
  };
}
