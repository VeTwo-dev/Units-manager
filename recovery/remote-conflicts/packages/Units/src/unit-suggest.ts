/**
 * unit-suggest.ts
 * -----------------------------------------------------------------------
 * Single responsibility: typo suggestions and parse diagnostics.
 *
 * These are explicitly OFF the hot path: `parseUnit` never computes
 * suggestions. Call `suggestUnit` / `parseWithDiagnostics` only when
 * handling a failure (CLI, UI, validation reports).
 *
 * - Suggestions use bounded Levenshtein distance over registry symbols +
 *   aliases, sorted by (distance, symbol) with plain code-unit comparison
 *   for cross-run determinism (no locale-dependent ordering).
 * - Diagnostics wrap `parseUnit` results without changing parse behavior.
 * - Never executes code; never mutates registries.
 * -----------------------------------------------------------------------
 */
import { parseUnit } from "./unit-parser.js";
import { defaultUnitRegistry, type UnitRegistry } from "./unit-registry.js";
import type { Unit } from "./unit.js";
import {
  InvalidUnitExpressionError,
  UnsupportedUnitError,
  type UnitEngineError,
} from "./errors/index.js";

export interface SuggestOptions {
  /** Maximum suggestions returned (default 3). */
  readonly maxSuggestions?: number;
  /** Maximum edit distance considered (default 3). */
  readonly maxDistance?: number;
}

export interface ParseDiagnostics {
  readonly ok: boolean;
  readonly unit?: Unit;
  readonly error?: InvalidUnitExpressionError | UnsupportedUnitError;
  /** Suggestions, present only when parsing failed and input was short enough. */
  readonly suggestions: readonly string[];
}

const DEFAULT_MAX_SUGGESTIONS = 3;
const DEFAULT_MAX_DISTANCE = 3;
/** Inputs longer than this get no suggestions (bounded work). */
const MAX_SUGGEST_INPUT_LENGTH = 64;

/** Iterative Levenshtein with early exit past maxDistance (bounded work). */
function levenshtein(a: string, b: string, maxDistance: number): number {
  if (a === b) return 0;
  // Ensure a is the shorter string to bound memory
  if (a.length > b.length) [a, b] = [b, a];
  // Lower bound: length difference alone exceeds the budget
  if (b.length - a.length > maxDistance) return maxDistance + 1;
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  let curr = new Array<number>(a.length + 1);
  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    let rowMin = curr[0]!;
    const bj = b[j - 1]!;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === bj ? 0 : 1;
      const v = Math.min(prev[i]! + 1, curr[i - 1]! + 1, prev[i - 1]! + cost);
      curr[i] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[a.length]!;
}

function collectCandidates(registry: UnitRegistry): string[] {
  const candidates = new Set<string>();
  for (const unit of registry.list()) {
    candidates.add(unit.symbol);
    for (const alias of unit.aliases) candidates.add(alias);
  }
  return [...candidates];
}

/**
 * Suggest registry symbols/aliases close to a mistyped input.
 * Deterministic: sorted by (distance, code-unit order). Returns at most
 * maxSuggestions entries within maxDistance. Empty for long inputs.
 */
export function suggestUnit(
  input: string,
  registry: UnitRegistry = defaultUnitRegistry,
  opts: SuggestOptions = {},
): readonly string[] {
  if (typeof input !== "string") return [];
  const trimmed = input.normalize("NFC").trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SUGGEST_INPUT_LENGTH) return [];
  const maxSuggestions = opts.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS;
  const maxDistance = opts.maxDistance ?? DEFAULT_MAX_DISTANCE;
  if (
    !Number.isInteger(maxSuggestions) ||
    maxSuggestions < 1 ||
    !Number.isInteger(maxDistance) ||
    maxDistance < 1
  ) {
    return [];
  }
  const scored: Array<{ candidate: string; distance: number }> = [];
  for (const candidate of collectCandidates(registry)) {
    const distance = levenshtein(trimmed, candidate, maxDistance);
    if (distance <= maxDistance) scored.push({ candidate, distance });
  }
  scored.sort((a, b) =>
    a.distance === b.distance
      ? a.candidate < b.candidate
        ? -1
        : a.candidate > b.candidate
          ? 1
          : 0
      : a.distance - b.distance,
  );
  return Object.freeze(scored.slice(0, maxSuggestions).map((s) => s.candidate));
}

/**
 * Parse with structured diagnostics. On success returns the unit; on
 * failure returns the typed error plus optional suggestions. Never alters
 * the parse result — suggestions are advisory only.
 */
export function parseWithDiagnostics(
  input: string,
  registry: UnitRegistry = defaultUnitRegistry,
  opts: SuggestOptions & { strict?: boolean } = {},
): ParseDiagnostics {
  try {
    const unit = parseUnit(input, registry, { strict: opts.strict });
    return { ok: true, unit, suggestions: [] };
  } catch (e) {
    if (e instanceof InvalidUnitExpressionError || e instanceof UnsupportedUnitError) {
      const suggestions = typeof input === "string" ? suggestUnit(input, registry, opts) : [];
      return { ok: false, error: e, suggestions };
    }
    // Preserve unexpected error types untouched (still typed engine errors
    // in practice; rethrow anything else as-is for diagnosis).
    throw e as UnitEngineError;
  }
}
