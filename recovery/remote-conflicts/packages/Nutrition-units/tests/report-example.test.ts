/**
 * report-example.test.ts — Prompt 25 recovery tests.
 *
 * Behavioral coverage for src/examples/report-generator-example.ts: the diet
 * reporter must render deterministic, semantically correct lines — supplied
 * vs required with a correct fulfillment percentage — without mutating its
 * inputs and across equivalent units.
 */
import { describe, expect, it } from "vitest";
import { Quantity } from "@vetwo/units";
import { renderDietReport, type DietLine } from "../src/examples/report-generator-example.js";

const line = (label: string, supplied: number, required: number, unit = "g/day"): DietLine => ({
  nutrientLabel: label,
  supplied: Quantity.of(supplied, unit),
  required: Quantity.of(required, unit),
});

describe("report example — renderDietReport", () => {
  it("renders supplied/required with correct fulfillment percentage", () => {
    const out = renderDietReport([line("Protein", 120, 150)]);
    expect(out).toContain("Protein");
    expect(out).toContain("(80%)");
  });

  it("output is deterministic across runs", () => {
    const lines = [line("Protein", 120, 150), line("Calcium", 8, 10, "g/day")];
    expect(renderDietReport(lines)).toBe(renderDietReport(lines));
  });

  it("handles equivalent units on either side", () => {
    const out = renderDietReport([
      {
        nutrientLabel: "Protein",
        supplied: Quantity.of(0.12, "kg/day"),
        required: Quantity.of(150, "g/day"),
      },
    ]);
    expect(out).toContain("(80%)");
  });

  it("does not mutate its inputs", () => {
    const lines = [line("Protein", 120, 150)];
    const before = lines[0].supplied.value;
    renderDietReport(lines);
    expect(lines[0].supplied.value).toBe(before);
  });

  it("renders one line per input, empty input renders empty output", () => {
    const out = renderDietReport([line("A", 1, 2), line("B", 2, 2)]);
    expect(out.split("\n")).toHaveLength(2);
    expect(renderDietReport([])).toBe("");
  });
});
