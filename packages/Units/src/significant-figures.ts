/**
 * significant-figures.ts
 * -----------------------------------------------------------------------
 * Single responsibility: significant-figure counting, propagation rules
 * and presentation rendering — all as pure functions on explicit inputs.
 *
 * Deliberately NOT attached to IEEE-754 numbers: a double cannot carry
 * "12.30 vs 12" distinctions, so significant figures live in decimal
 * TEXT (counting) or explicit counts (propagation), never inferred from
 * floats silently.
 *
 * - Counting operates on decimal strings with documented textbook rules.
 * - Propagation rules take explicit counts (mul/div → min sig figs;
 *   add/sub → min decimal places) and return counts.
 * - Rendering produces strings; it never mutates values.
 * -----------------------------------------------------------------------
 */
import { NumericalError } from "./numerical.js";

// ---------------------------------------------------------------------------
// Counting (decimal text in, count out)
// ---------------------------------------------------------------------------

/**
 * Count significant figures in a plain decimal string.
 *
 * Rules (documented heuristic):
 * - Leading zeros never count ("0.00123" → 3).
 * - Zeros between significant digits count ("101" → 3).
 * - Trailing zeros count only with a decimal point ("100." → 3, "100" → 1).
 * - "0", "0.0", "0.00" → 1 (all-zero edge case, documented simplification).
 * - Exponents (e/E) do not affect the count ("1.23e6" → 3).
 *
 * Throws NumericalError for non-decimal text (e.g. "", ".", "1e", "abc").
 */
export function countSignificantFigures(text: string): number {
  if (typeof text !== "string") {
    throw new NumericalError(`Significant-figure input must be a string, got ${typeof text}`);
  }
  const t = text.trim();
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(t);
  if (!m) {
    throw new NumericalError(`"${text}" is not a plain decimal number`);
  }
  const intPart = m[2] ?? "";
  const fracPart = m[3] ?? "";
  if (intPart === "" && fracPart === "") {
    throw new NumericalError(`"${text}" contains no digits`);
  }
  const hasDot = t.split(/[eE]/)[0]!.includes(".");
  const digits = (intPart + fracPart).replace(/^0+/, "");
  if (digits === "") return 1; // all zeros
  if (!hasDot) {
    const stripped = digits.replace(/0+$/, "");
    return stripped === "" ? 1 : stripped.length;
  }
  return digits.length;
}

// ---------------------------------------------------------------------------
// Propagation rules (explicit counts in, count out)
// ---------------------------------------------------------------------------

function assertSigFigCount(n: number, what: string): void {
  if (!Number.isInteger(n) || n < 1) {
    throw new NumericalError(`${what} must be a positive integer count, got ${String(n)}`);
  }
}

/**
 * Significant figures of a product or quotient: the minimum of the inputs.
 * Example: 2.5 (2 s.f.) × 3.42 (3 s.f.) → 2 s.f.
 */
export function mulDivSigFigs(aSigFigs: number, bSigFigs: number): number {
  assertSigFigCount(aSigFigs, "aSigFigs");
  assertSigFigCount(bSigFigs, "bSigFigs");
  return Math.min(aSigFigs, bSigFigs);
}

/**
 * Decimal places of a sum or difference: the minimum of the inputs'
 * decimal places. Example: 12.1 (1 place) + 3.42 (2 places) → 1 place.
 */
export function addSubDecimalPlaces(aPlaces: number, bPlaces: number): number {
  if (!Number.isInteger(aPlaces) || aPlaces < 0) {
    throw new NumericalError(`aPlaces must be a non-negative integer, got ${String(aPlaces)}`);
  }
  if (!Number.isInteger(bPlaces) || bPlaces < 0) {
    throw new NumericalError(`bPlaces must be a non-negative integer, got ${String(bPlaces)}`);
  }
  return Math.min(aPlaces, bPlaces);
}

// ---------------------------------------------------------------------------
// Rendering (number in, string out — values never mutated)
// ---------------------------------------------------------------------------

function assertRenderSigFigs(sigFigs: number): void {
  if (!Number.isInteger(sigFigs) || sigFigs < 1 || sigFigs > 100) {
    throw new NumericalError(
      `Significant figures must be an integer in [1, 100], got ${String(sigFigs)}`,
    );
  }
}

/**
 * Render with exactly `sigFigs` significant figures (e.g. 12345 → "1.23e+4"
 * for 3). NaN/Infinity pass through as text. Zero renders as "0" (or
 * "0.00" style for sigFigs > 1).
 */
export function toSignificantFigures(value: number, sigFigs: number): string {
  if (typeof value !== "number") {
    throw new NumericalError(`Value must be a number, got ${typeof value}`);
  }
  assertRenderSigFigs(sigFigs);
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (value === 0) return sigFigs === 1 ? "0" : `0.${"0".repeat(sigFigs - 1)}`;
  return value.toPrecision(sigFigs);
}

function splitMantissaExponent(
  value: number,
  sigFigs: number,
): { mantissa: string; exponent: number } {
  assertRenderSigFigs(sigFigs);
  if (typeof value !== "number") {
    throw new NumericalError(`Value must be a number, got ${typeof value}`);
  }
  if (!Number.isFinite(value) || value === 0) {
    const zeroMantissa =
      value === 0 ? (sigFigs === 1 ? "0" : `0.${"0".repeat(sigFigs - 1)}`) : String(value);
    return { mantissa: zeroMantissa, exponent: 0 };
  }
  let exp = Math.floor(Math.log10(Math.abs(value)));
  let text = (value / 10 ** exp).toFixed(sigFigs - 1);
  // Rounding may push the mantissa to the next power (e.g. 9.9996 → "10.00");
  // renormalize with a bounded loop (each pass divides by 10).
  let guard = 0;
  while (Math.abs(Number.parseFloat(text)) >= 10 && guard < 4) {
    exp += 1;
    text = (value / 10 ** exp).toFixed(sigFigs - 1);
    guard++;
  }
  return { mantissa: text, exponent: exp };
}

function formatExp(exp: number): string {
  return `e${exp >= 0 ? "+" : ""}${exp}`;
}

/**
 * Scientific notation: one leading digit (e.g. 12345 → "1.23e+4" for 3 s.f.).
 * Deterministic; NaN/Infinity pass through as text.
 */
export function toScientificNotation(value: number, sigFigs = 6): string {
  assertRenderSigFigs(sigFigs);
  if (typeof value !== "number") {
    throw new NumericalError(`Value must be a number, got ${typeof value}`);
  }
  if (!Number.isFinite(value)) return String(value);
  const { mantissa, exponent } = splitMantissaExponent(value, sigFigs);
  return `${mantissa}${formatExp(exponent)}`;
}

/**
 * Engineering notation: exponent constrained to multiples of three
 * (e.g. 12345 → "12.34e+3" for 4 s.f.). Deterministic.
 *
 * Shifting the decimal point left by `shift` digits costs `shift` mantissa
 * decimals, preserving the total significant-figure count. If that would go
 * negative, the exponent is bumped instead. A final verification pass
 * against countSignificantFigures corrects rounding-carry artifacts once.
 */
export function toEngineeringNotation(value: number, sigFigs = 6): string {
  assertRenderSigFigs(sigFigs);
  if (typeof value !== "number") {
    throw new NumericalError(`Value must be a number, got ${typeof value}`);
  }
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) {
    return `${sigFigs === 1 ? "0" : `0.${"0".repeat(sigFigs - 1)}`}${formatExp(0)}`;
  }
  const exp = Math.floor(Math.log10(Math.abs(value)));
  const shift = ((exp % 3) + 3) % 3;
  let engExp = exp - shift;
  let decimals = sigFigs - 1 - shift;
  while (decimals < 0) {
    engExp += 3;
    decimals += 3;
  }
  let text = (value / 10 ** engExp).toFixed(decimals);
  // Carry renormalization (e.g. 999.96 → "1000.0"): new mantissa is in
  // [1, 10), so exactly sigFigs - 1 decimals restore the count.
  if (Math.abs(Number.parseFloat(text)) >= 1000) {
    engExp += 3;
    decimals = sigFigs - 1;
    text = (value / 10 ** engExp).toFixed(decimals);
  }
  // Verify the displayed count; correct once for rounding artifacts.
  const shown = countSignificantFigures(text);
  if (shown !== sigFigs) {
    decimals = Math.max(0, decimals + (sigFigs - shown));
    text = (value / 10 ** engExp).toFixed(decimals);
  }
  return `${text}${formatExp(engExp)}`;
}
