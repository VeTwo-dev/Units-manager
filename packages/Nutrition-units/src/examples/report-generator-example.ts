/**
 * examples/report-generator-example.ts
 * -----------------------------------------------------------------------
 * Demonstrates the Report Generator consuming Quantity + formatter only —
 * never raw numbers, never re-deriving units.
 * -----------------------------------------------------------------------
 */
import { Quantity, formatQuantity } from "@vetwo/units";

export interface DietLine {
  nutrientLabel: string;
  supplied: Quantity;
  required: Quantity;
}

export function renderDietReport(lines: DietLine[]): string {
  return lines
    .map((line) => {
      const suppliedStr = formatQuantity(line.supplied, { decimals: 1 });
      const requiredStr = formatQuantity(line.required, { decimals: 1 });
      const pct = ((line.supplied.toBase().value / line.required.toBase().value) * 100).toFixed(0);
      return `${line.nutrientLabel.padEnd(12)} ${suppliedStr.padStart(12)} / ${requiredStr.padEnd(12)} (${pct}%)`;
    })
    .join("\n");
}
