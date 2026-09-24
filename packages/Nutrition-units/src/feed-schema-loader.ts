/**
 * feed-schema-loader.ts
 * -----------------------------------------------------------------------
 * Single responsibility: read the project's JSON unit-map (feed / animal /
 * requirements / solver / constraints / minerals / economics) and turn
 * every string unit into a real `Unit`, ready to be attached to values
 * coming from the Feed Database / Animal Requirements JSON.
 *
 * This is the ONLY place that knows the shape of the schema JSON; it
 * performs zero calculations — it only builds Quantity factories.
 * -----------------------------------------------------------------------
 */
import { Quantity } from "@vetwo/units";

/** Mirrors the JSON structure supplied by the host application. */
export interface UnitSchema {
  feed: { asFed: Record<string, string>; dryMatterBasis: Record<string, string> };
  animal: Record<string, string>;
  requirements: Record<string, string>;
  solver: Record<string, string>;
  feedConstraints: Record<string, string>;
  mineralsLimits: Record<string, string>;
  economics: Record<string, string>;
}

export class FeedSchemaLoader {
  constructor(private readonly schema: UnitSchema) {}

  private resolveUnit(unitSymbol: string | undefined, field: string): string {
    if (unitSymbol === undefined) {
      throw new Error(`Missing unit for field "${field}" in the unit-map schema`);
    }
    return unitSymbol;
  }

  /** Build a Quantity for a raw numeric value using the as-fed unit for `field`. */
  asFed(field: keyof UnitSchema["feed"]["asFed"], value: number): Quantity {
    return Quantity.of(
      value,
      this.resolveUnit(this.schema.feed.asFed[field as string], String(field)),
    );
  }

  dryMatterBasis(field: keyof UnitSchema["feed"]["dryMatterBasis"], value: number): Quantity {
    return Quantity.of(
      value,
      this.resolveUnit(this.schema.feed.dryMatterBasis[field as string], String(field)),
    );
  }

  requirement(field: keyof UnitSchema["requirements"], value: number): Quantity {
    return Quantity.of(
      value,
      this.resolveUnit(this.schema.requirements[field as string], String(field)),
    );
  }

  animal(field: keyof UnitSchema["animal"], value: number): Quantity {
    return Quantity.of(value, this.resolveUnit(this.schema.animal[field as string], String(field)));
  }

  economics(field: keyof UnitSchema["economics"], value: number): Quantity {
    return Quantity.of(
      value,
      this.resolveUnit(this.schema.economics[field as string], String(field)),
    );
  }

  feedConstraint(field: keyof UnitSchema["feedConstraints"], value: number): Quantity {
    return Quantity.of(
      value,
      this.resolveUnit(this.schema.feedConstraints[field as string], String(field)),
    );
  }

  solver(field: keyof UnitSchema["solver"], value: number): Quantity {
    return Quantity.of(value, this.resolveUnit(this.schema.solver[field as string], String(field)));
  }
}
