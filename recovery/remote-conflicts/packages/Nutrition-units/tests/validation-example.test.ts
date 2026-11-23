/**
 * validation-example.test.ts — Prompt 25 recovery tests.
 *
 * Behavioral coverage for src/examples/validation-example.ts: the range
 * validator must accept in-range values, flag out-of-range values with
 * useful messages, and reject dimension-mismatched inputs with a typed
 * error instead of producing a silently wrong verdict.
 */
import { describe, expect, it } from "vitest";
import { DimensionError, Quantity } from "@vetwo/units";
import { validateRange } from "../src/examples/validation-example.js";

const g = (v: number, unit = "g/day") => Quantity.of(v, unit);

describe("validation example — validateRange", () => {
  it("accepts an in-range value", () => {
    expect(validateRange(g(120), g(100), g(150))).toEqual({ ok: true });
  });

  it("flags below-minimum with a useful message", () => {
    const r = validateRange(g(80), g(100), g(150));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/below minimum/);
  });

  it("flags above-maximum with a useful message", () => {
    const r = validateRange(g(200), g(100), g(150));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/exceeds maximum/);
  });

  it("compares across equivalent units (dimensional safety, not string equality)", () => {
    const r = validateRange(Quantity.of(0.12, "kg/day"), g(100), g(150));
    expect(r.ok).toBe(true);
  });

  it("rejects dimension-mismatched bounds with a typed error", () => {
    expect(() => validateRange(g(120), Quantity.of(100, "Mcal/day"), g(150))).toThrow(
      DimensionError,
    );
    expect(() => validateRange(Quantity.of(5, "Mcal/day"), g(100), g(150))).toThrow(DimensionError);
  });

  it("boundary values are inclusive", () => {
    expect(validateRange(g(100), g(100), g(150)).ok).toBe(true);
    expect(validateRange(g(150), g(100), g(150)).ok).toBe(true);
  });
});
