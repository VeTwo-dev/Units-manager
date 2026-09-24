/**
 * basis-converter.ts
 * -----------------------------------------------------------------------
 * Single responsibility: convert a nutrient Quantity between "as-fed" and
 * "dry-matter" reporting basis. This requires an extra input (the feed's
 * DM%) so it cannot be a pure unit conversion — it is domain knowledge,
 * and therefore lives in nutrition-engine, not in the core unit-engine.
 * -----------------------------------------------------------------------
 */
import { Quantity, ConversionError } from "@vetwo/units";

export class BasisConverter {
  /**
   * asFedValue = dmValue * (dryMatterPercent / 100)
   * Both directions handled; dryMatterPercent must be a "%" Quantity.
   */
  static toAsFed(dmQuantity: Quantity, dryMatterPercent: Quantity): Quantity {
    BasisConverter.assertIsDmBasis(dmQuantity);
    BasisConverter.assertIsPercent(dryMatterPercent);
    const result = dmQuantity.multiply(dryMatterPercent);
    // Strip DM basis tag from source symbol for target unit
    const bareSymbol =
      dmQuantity.unit.symbol.replace(/\s+DM$/i, "").trim() ||
      dmQuantity.unit.symbol.replace(/\s+DM$/i, "");
    // dmQuantity.unit.symbol is like "% DM" or "g/kg DM" — strip DM for target
    const targetSymbol = dmQuantity.unit.symbol.endsWith(" DM")
      ? dmQuantity.unit.symbol.slice(0, -3)
      : bareSymbol;
    return result.to(targetSymbol);
  }

  static toDryMatterBasis(asFedQuantity: Quantity, dryMatterPercent: Quantity): Quantity {
    BasisConverter.assertIsPercent(dryMatterPercent);
    const dmBase = dryMatterPercent.toBase().value;
    if (!Number.isFinite(dmBase) || Math.abs(dmBase) < 1e-12) {
      throw new ConversionError(
        asFedQuantity.unit.symbol,
        `${asFedQuantity.unit.symbol} DM`,
        "dry matter is 0% or non-finite",
      );
    }
    const result = asFedQuantity.divide(dryMatterPercent);
    return result.to(`${asFedQuantity.unit.symbol} DM`);
  }

  private static assertIsDmBasis(q: Quantity): void {
    if (q.unit.basis !== "DM") {
      throw new ConversionError(
        q.unit.symbol,
        "asFed",
        `expected a DM-basis quantity, got basis="${q.unit.basis}"`,
      );
    }
  }

  private static assertIsPercent(q: Quantity): void {
    if (q.unit.symbol !== "%") {
      throw new ConversionError(q.unit.symbol, "%", "dry matter must be expressed as a percent");
    }
    if (!Number.isFinite(q.value) || !Number.isFinite(q.toBase().value)) {
      throw new ConversionError(q.unit.symbol, "%", "dry matter percent must be finite");
    }
    if (q.value <= 0 || q.value > 100) {
      throw new ConversionError(
        q.unit.symbol,
        "%",
        `dry matter percent must satisfy 0 < % ≤ 100, got ${q.value}%`,
      );
    }
  }
}
