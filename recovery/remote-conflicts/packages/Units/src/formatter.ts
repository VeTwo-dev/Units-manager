/**
 * formatter.ts — Single responsibility: render Units and Quantities as strings.
 * Does NOT perform unit math, conversion, or domain logic. Pure representation.
 * -----------------------------------------------------------------------
 * Canonical vs display:
 * - Canonical: deterministic, stable across processes, suitable for snapshots.
 *   Uses `·` for multiplication and Unicode superscripts (², ⁻¹) by default.
 * - Display: human-readable with options (ascii, locale, decimals).
 * Both are parseable by UnitParser (parser/formatter symmetry).
 * -----------------------------------------------------------------------
 */
import type { Quantity } from "./quantity.js";
import { isDimensionlessUnit, type Unit } from "./unit.js";
import {
  toEngineeringNotation,
  toScientificNotation,
  toSignificantFigures,
} from "./significant-figures.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Numeric notation for presentation (never alters the stored value). */
export type NumericNotation = "standard" | "scientific" | "engineering";

export interface FormatOptions {
  /** Number of decimals for quantity value (default 2). */
  decimals?: number;
  /** Whether to show basis suffix like " DM" (default true). */
  showBasis?: boolean;
  /** Locale for number formatting via toLocaleString. */
  locale?: string;
  /** If true, use ascii "m^2" / "s^-1" instead of "m²" / "s⁻¹". */
  ascii?: boolean;
  /** Multiplication symbol for display (default "·" middle dot). */
  multiplicationSymbol?: string;
  /** Whether to use Unicode superscripts (default !ascii). */
  superscript?: boolean;
  /** Spacing between number and unit (default single space). */
  spacing?: string;
  /**
   * Significant figures for the value. Takes precedence over `decimals`
   * (and `locale`, which is ignored in this path). Presentation only.
   */
  significantFigures?: number;
  /**
   * Numeric notation: "standard" (default), "scientific" (1.23e+6) or
   * "engineering" (exponent multiple of 3, e.g. 1.235e+3 → "1.235e+3"
   * stays, 12345 → "12.35e+3"). Without `significantFigures`, the
   * `decimals` option sets mantissa decimals (default 2).
   */
  notation?: NumericNotation;
  /**
   * Append the semantic kind in brackets (e.g. "1.50 rad [angle]").
   * Display only — mathematical identity never depends on formatting.
   */
  showKind?: boolean;
}

export interface FormatUnitOptions {
  ascii?: boolean;
  multiplicationSymbol?: string;
  superscript?: boolean;
}

// ---------------------------------------------------------------------------
// Superscript helpers
// ---------------------------------------------------------------------------

const SUPERSCRIPT_MAP: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "-": "⁻",
  "+": "⁺",
};

const SUPERSCRIPT_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(SUPERSCRIPT_MAP).map(([k, v]) => [v, k]),
);

function toSuperscript(n: number): string {
  return String(n)
    .split("")
    .map((ch) => SUPERSCRIPT_MAP[ch] ?? ch)
    .join("");
}

function normalizeSuperscripts(symbol: string, useAscii: boolean): string {
  if (useAscii) {
    // Convert superscript chars to ^ + ascii digits
    // e.g. "m²" -> "m^2", "s⁻¹" -> "s^-1"
    let out = "";
    let i = 0;
    while (i < symbol.length) {
      const ch = symbol[i]!;
      if (SUPERSCRIPT_REVERSE[ch] !== undefined) {
        // Collect consecutive superscript chars
        let seq = "";
        while (i < symbol.length && SUPERSCRIPT_REVERSE[symbol[i]!] !== undefined) {
          seq += SUPERSCRIPT_REVERSE[symbol[i]!]!;
          i++;
        }
        // seq is like "2" or "-1"
        // Need to ensure we have "^" before it
        // But original may be "m²" without "^", so we add "^"
        // For "m²", we have "m" + "²" -> we want "m^2" in ascii
        // For "s⁻¹", we want "s^-1"
        out += "^" + seq;
      } else {
        out += ch;
        i++;
      }
    }
    return out;
  } else {
    // Convert ^-notation to superscripts: "m^2" -> "m²", "s^-1" -> "s⁻¹"
    // Replace ^ followed by optional - and digits
    return symbol.replace(/\^(-?\d+)/g, (_m, digits: string) =>
      toSuperscript(Number.parseInt(digits, 10)),
    );
  }
}

function normalizeMultiplication(symbol: string, target: string): string {
  // Replace any of * · ⋅ × with target
  return symbol.replace(/[*·⋅×]/g, target);
}

// ---------------------------------------------------------------------------
// Caching (bounded, per unit + options)
// ---------------------------------------------------------------------------

const MAX_CACHE = 500;
const unitCache = new Map<string, string>();

function cacheKey(unit: Unit, opts: FormatUnitOptions): string {
  // Include both id and symbol: custom registries may reuse an id with a
  // different symbol, and the formatted output depends on the symbol text.
  const basis = unit.basis ? `|${unit.basis}` : "";
  return `${unit.id}|${unit.symbol}${basis}::${opts.ascii ? "a" : "u"}::${opts.multiplicationSymbol ?? "·"}`;
}

function cacheGet(key: string): string | undefined {
  return unitCache.get(key);
}

function cacheSet(key: string, value: string): void {
  if (unitCache.size >= MAX_CACHE) {
    const first = unitCache.keys().next().value as string | undefined;
    if (first) unitCache.delete(first);
  }
  unitCache.set(key, value);
}

// ---------------------------------------------------------------------------
// Unit formatting
// ---------------------------------------------------------------------------

/**
 * Format a Unit to its canonical display string.
 * Deterministic, stable ordering is inherited from the stored `unit.symbol`
 * (which itself is deterministic per parser/registry). Equivalent units
 * created via different expressions (e.g. "m/s" vs "m·s^-1") share the same
 * dimension and scale but may retain different symbols; they are considered
 * equivalent via `dimensionsEqual` rather than string equality, per spec
 * 9.3/9.4 note.
 */
export function formatUnit(unit: Unit, opts: FormatUnitOptions = {}): string {
  const ascii = opts.ascii ?? false;
  const mulSym = opts.multiplicationSymbol ?? "·";
  const useSuper = opts.superscript ?? !ascii;

  const key = cacheKey(unit, { ascii, multiplicationSymbol: mulSym, superscript: useSuper });
  const cached = cacheGet(key);
  if (cached) return cached;

  // Preserve known dimensionless symbols verbatim (%, ‰, ppm, etc.)
  // For generic dimensionless composite like "m/m" we keep its symbol as is
  // rather than collapsing to "1" — the quantity formatter decides whether to show unit.
  let symbol = unit.symbol;

  // Normalize multiplication and superscripts
  symbol = normalizeMultiplication(symbol, mulSym);
  // Handle superscripts vs ascii
  if (useSuper) {
    // Ensure ^ notation becomes superscript
    symbol = normalizeSuperscripts(symbol, false);
  } else {
    // Ensure superscript becomes ^ notation
    symbol = normalizeSuperscripts(symbol, true);
  }

  // For dimensionless canonical "1" we keep "1" as symbol (quantity formatter may hide it)
  cacheSet(key, symbol);
  return symbol;
}

// ---------------------------------------------------------------------------
// Quantity formatting
// ---------------------------------------------------------------------------

const KNOWN_DIMENSIONLESS_SYMBOLS = new Set(["%", "‰", "ppm", "ppb", "ppt", "fraction", "1"]);

function formatNumeric(value: number, opts: FormatOptions): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  // Preserve -0 as "0" or "-0"? Use "0" for display, but keep sign via isNegative check if needed
  // We'll treat -0 as "0" with same decimals
  if (Object.is(value, -0)) value = 0;

  const { decimals = 2, locale, significantFigures, notation = "standard" } = opts;
  // Significant-figure and notation paths take precedence over decimals/locale.
  // They render text only; the stored Quantity value is never altered.
  if (significantFigures !== undefined || notation !== "standard") {
    if (notation === "scientific") {
      return significantFigures !== undefined
        ? toScientificNotation(value, significantFigures)
        : toScientificNotation(value, decimals + 1);
    }
    if (notation === "engineering") {
      return significantFigures !== undefined
        ? toEngineeringNotation(value, significantFigures)
        : toEngineeringNotation(value, decimals + 1);
    }
    return toSignificantFigures(value, significantFigures as number);
  }
  if (locale) {
    return value.toLocaleString(locale, { maximumFractionDigits: decimals });
  }
  // Use toFixed but trim unnecessary? Spec says avoid unnecessary trailing zeros unless requested
  // For now, respect decimals exactly as before (toFixed)
  return value.toFixed(decimals);
}

export function formatQuantity(q: Quantity, opts: FormatOptions = {}): string {
  const {
    decimals = 2,
    showBasis = true,
    locale,
    ascii = false,
    multiplicationSymbol,
    superscript,
    spacing = " ",
    significantFigures,
    notation = "standard",
    showKind = false,
  } = opts;

  // Numeric part (significantFigures/notation are presentation-only; value untouched)
  const numberPart = formatNumeric(q.value, { decimals, locale, significantFigures, notation });

  let result: string;
  // Unit part: handle purely dimensionless without semantic symbol
  if (isDimensionlessUnit(q.unit)) {
    const sym = q.unit.symbol;
    // Known semantic dimensionless: show symbol
    if (KNOWN_DIMENSIONLESS_SYMBOLS.has(sym) && sym !== "1" && sym !== "fraction") {
      const unitStr = formatUnit(q.unit, { ascii, multiplicationSymbol, superscript });
      const basisPart = showBasis && q.unit.basis ? ` ${q.unit.basis}` : "";
      result = `${numberPart}${spacing}${unitStr}${basisPart}`;
    } else if (sym === "1" || sym === "fraction" || sym.includes("(") || sym.includes("/")) {
      // For "1", "fraction", or composite like "m/m" / "(m)/(m)": show just number (no unit)
      // However if basis is present (e.g. "fraction DM"? unlikely) we show basis
      const basisPart = showBasis && q.unit.basis ? ` ${q.unit.basis}` : "";
      result = basisPart ? `${numberPart}${spacing}${sym}${basisPart}` : numberPart;
    } else {
      // Fallback: show symbol
      const unitStr = formatUnit(q.unit, { ascii, multiplicationSymbol, superscript });
      const basisPart = showBasis && q.unit.basis ? ` ${q.unit.basis}` : "";
      result = `${numberPart}${spacing}${unitStr}${basisPart}`;
    }
  } else {
    const unitStr = formatUnit(q.unit, { ascii, multiplicationSymbol, superscript });
    const basisPart = showBasis && q.unit.basis ? ` ${q.unit.basis}` : "";
    result = `${numberPart}${spacing}${unitStr}${basisPart}`;
  }
  // Semantic kind suffix is display-only (Phase 22): identity never depends on it.
  if (showKind && q.kind !== undefined) result += ` [${q.kind}]`;
  return result;
}

/** Alias for display formatting (same as formatQuantity with defaults). */
export function formatQuantityDisplay(q: Quantity, opts: FormatOptions = {}): string {
  return formatQuantity(q, opts);
}

/** Alias for canonical formatting (superscript unicode, ·, decimals 2). */
export function formatUnitCanonical(unit: Unit): string {
  return formatUnit(unit, { ascii: false, multiplicationSymbol: "·", superscript: true });
}
