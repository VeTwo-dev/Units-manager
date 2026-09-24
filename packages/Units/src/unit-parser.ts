/**
 * unit-parser.ts
 * -----------------------------------------------------------------------
 * Single responsibility: turn a unit expression string into a resolved
 * `Unit` object.
 *
 * Grammar (EBNF, whitespace is ignored except to separate tokens):
 *
 *   expression := term ( ( "/" | "*" | "·" | "⋅" | "×" | implicitMul ) term )*
 *   term       := factor ( exponent )?
 *   factor     := UNIT | ONE | "(" expression ")"
 *   ONE        := "1"  // the canonical dimensionless identity (and only it:
 *                      // "2", "-1", "1.5" etc. are still rejected). This keeps
 *                      // emitted symbols re-parseable: Quantity math and formula
 *                      // evaluation legitimately produce "(1)·(kg)"-style symbols,
 *                      // and serialization round-trips depend on parsing them.
 *   exponent   := "^" INTEGER
 *               |  SUPERSCRIPT  // e.g. "²", "⁻¹"
 *               |  INTEGER      // trailing digit without "^", e.g. "m2" → m^2
 *
 * Where:
 * - UNIT is a maximal run of characters not in { whitespace "()/*·⋅×^" } and
 *   not a superscript/digit that would be an exponent. Atomic symbols,
 *   aliases and prefix+unit combos are resolved via UnitRegistry (which also
 *   consults PrefixRegistry). Resolution is case-sensitive.
 * - "/" is division (left-associative, so "a/b/c" = (a/b)/c = a/(b*c)).
 * - implicit multiplication: adjacency of two factors without an explicit
 *   operator (e.g. "kg m" or "m s^-1" or "(kg)(m)") is treated as "*".
 * - Whitespace is allowed anywhere between tokens and at ends, and between
 *   factors it implies multiplication (documented behavior).
 * - A trailing INTEGER after a UNIT without "^" is treated as an exponent
 *   (so "m2" == "m^2" == "m²"); this is a convenience, not a separate unit.
 *   Strict mode (`{ strict: true }`) rejects both this and implicit
 *   multiplication, requiring explicit operators and "^"/superscript exponents.
 *
 * Normalization: input is NFC-normalized (deterministic; precomposed ° µ ²
 * unaffected). Micro-sign µ (U+00B5) and Greek μ (U+03BC) both resolve via
 * the prefix alias table — normalization never changes meaning.
 *
 * Limits: input text ≤ 4096 chars, parenthesis nesting ≤ 100. Single
 * identifiers take a fast path (direct registry lookup, identical result).
 *
 * Security: no eval/Function/dynamic import. Malformed input produces a
 * typed InvalidUnitExpressionError with expression, position and reason.
 * Parser cache is bounded to avoid DoS via arbitrary input.
 * -----------------------------------------------------------------------
 */
import { DIMENSIONLESS, divideDim, isDimensionless, multiplyDim, powDim } from "./dimension.js";
import { isAffineUnit, makeUnit, type Unit, type Basis } from "./unit.js";
import { defaultUnitRegistry, UnitRegistry } from "./unit-registry.js";
import { InvalidUnitExpressionError, UnsupportedUnitError } from "./errors/index.js";
import { linearScaleOf } from "./conversion-engine.js";

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

type TokenType = "UNIT" | "MUL" | "DIV" | "POW" | "LPAREN" | "RPAREN" | "INT" | "SUPER";

interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly pos: number;
}

const SUPER_MAP: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁻": "-",
  "⁺": "+",
};

const SUPER_CHARS = new Set(Object.keys(SUPER_MAP));
const MUL_CHARS = new Set(["*", "·", "⋅", "×"]);
const WHITESPACE_RE = /^\s$/;

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isSuperscript(ch: string): boolean {
  return SUPER_CHARS.has(ch);
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i]!;
    if (WHITESPACE_RE.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "LPAREN", value: "(", pos: i });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "RPAREN", value: ")", pos: i });
      i++;
      continue;
    }
    if (ch === "/") {
      tokens.push({ type: "DIV", value: "/", pos: i });
      i++;
      continue;
    }
    if (ch === "^") {
      tokens.push({ type: "POW", value: "^", pos: i });
      i++;
      continue;
    }
    if (MUL_CHARS.has(ch)) {
      tokens.push({ type: "MUL", value: ch, pos: i });
      i++;
      continue;
    }
    if (isSuperscript(ch)) {
      // Collect consecutive superscript chars as one SUPER token (e.g. "⁻¹")
      const start = i;
      let raw = "";
      while (i < n && isSuperscript(input[i]!)) {
        raw += input[i];
        i++;
      }
      tokens.push({ type: "SUPER", value: raw, pos: start });
      continue;
    }
    if (isDigit(ch) || (ch === "-" && i + 1 < n && isDigit(input[i + 1]!))) {
      // Standalone integer (exponent or implicit) — collect optional leading "-"
      const start = i;
      let raw = "";
      if (ch === "-") {
        raw += "-";
        i++;
      }
      while (i < n && isDigit(input[i]!)) {
        raw += input[i];
        i++;
      }
      // If next char is "." then it's malformed decimal exponent — treat "." as invalid
      if (i < n && input[i] === ".") {
        throw new InvalidUnitExpressionError(
          input,
          `decimal exponents are not supported (found "." at position ${i})`,
          i,
        );
      }
      tokens.push({ type: "INT", value: raw, pos: start });
      continue;
    }
    // UNIT token: collect until next delimiter (whitespace, operators, parens, superscript, digit)
    // But note: ";" "," "." etc. are not allowed in unit symbols — they will be collected
    // as UNIT and later fail registry lookup, which becomes UnsupportedUnitError vs
    // InvalidUnitExpressionError. To give better errors for ";" we treat it as invalid char.
    if (
      ch === ";" ||
      ch === "," ||
      ch === ":" ||
      ch === "!" ||
      ch === "&" ||
      ch === "|" ||
      ch === "\\"
    ) {
      throw new InvalidUnitExpressionError(input, `invalid character "${ch}" at position ${i}`, i);
    }
    // Collect UNIT
    const start = i;
    let raw = "";
    while (i < n) {
      const c = input[i]!;
      if (
        WHITESPACE_RE.test(c) ||
        c === "(" ||
        c === ")" ||
        c === "/" ||
        c === "^" ||
        MUL_CHARS.has(c) ||
        isSuperscript(c) ||
        isDigit(c) // digit starts a separate INT token for exponent handling
      ) {
        break;
      }
      // Deliberately treat "." as delimiter to catch "kg^1.5" as invalid
      if (c === "." || c === ";" || c === "," || c === ":") break;
      raw += c;
      i++;
    }
    if (raw.length === 0) {
      // Should not happen, but protect
      throw new InvalidUnitExpressionError(input, `unexpected character "${ch}"`, i);
    }
    tokens.push({ type: "UNIT", value: raw, pos: start });
  }
  return tokens;
}

function superToInt(raw: string, input: string, pos: number): number {
  let ascii = "";
  for (const ch of raw) {
    const mapped = SUPER_MAP[ch];
    if (mapped === undefined) {
      throw new InvalidUnitExpressionError(input, `invalid superscript character "${ch}"`, pos);
    }
    ascii += mapped;
  }
  // ascii now like "-1", "2", "12" etc.
  const n = Number.parseInt(ascii, 10);
  if (!Number.isInteger(n)) {
    throw new InvalidUnitExpressionError(input, `superscript "${raw}" is not an integer`, pos);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Parser helpers (Unit algebra)
// ---------------------------------------------------------------------------

function requireLinearOperands(a: Unit, b: Unit, rawExpr: string, op: string): void {
  for (const u of [a, b]) {
    if (u.conversion.kind !== "linear") {
      throw new InvalidUnitExpressionError(
        rawExpr,
        `${op} requires linear units ("${u.symbol}" has a ${u.conversion.kind} conversion; ` +
          `logarithmic/custom units cannot be composed algebraically)`,
      );
    }
  }
}

function multiplyUnits(a: Unit, b: Unit, rawExpr: string): Unit {
  if (isAffineUnit(a) || isAffineUnit(b)) {
    throw new InvalidUnitExpressionError(
      rawExpr,
      `affine units (${a.symbol}, ${b.symbol}) cannot be multiplied`,
    );
  }
  requireLinearOperands(a, b, rawExpr, "multiplication");
  const dimension = multiplyDim(a.dimension, b.dimension);
  const scale = linearScaleOf(a) * linearScaleOf(b);
  if (!Number.isFinite(scale) || scale === 0) {
    throw new InvalidUnitExpressionError(rawExpr, "multiplication produced non-finite scale");
  }
  return makeUnit({
    symbol: `${a.symbol}·${b.symbol}`,
    dimension: isDimensionless(dimension) ? DIMENSIONLESS : dimension,
    conversion: { kind: "linear", scale },
    label: `${a.label ?? a.symbol}·${b.label ?? b.symbol}`,
  });
}

function divideUnits(a: Unit, b: Unit, rawExpr: string): Unit {
  if (isAffineUnit(a) || isAffineUnit(b)) {
    throw new InvalidUnitExpressionError(
      rawExpr,
      `affine units (${a.symbol}, ${b.symbol}) cannot be divided`,
    );
  }
  requireLinearOperands(a, b, rawExpr, "division");
  const dimension = divideDim(a.dimension, b.dimension);
  const scale = linearScaleOf(a) / linearScaleOf(b);
  if (!Number.isFinite(scale) || scale === 0) {
    throw new InvalidUnitExpressionError(rawExpr, "division produced non-finite scale");
  }
  // Audit §5 fix: a composite denominator must be grouped — "kg/m·s" would
  // otherwise re-parse as (kg/m)·s, a different dimension. A bare power
  // denominator ("s^2") is left alone: "kg/s^2" already reads correctly.
  const denominatorNeedsParens = /[*·×\s/]/.test(b.symbol) && !isFullyParenthesized(b.symbol);
  const bSymbol = denominatorNeedsParens ? `(${b.symbol})` : b.symbol;
  const bLabel = denominatorNeedsParens ? `(${b.label ?? b.symbol})` : (b.label ?? b.symbol);
  return makeUnit({
    symbol: `${a.symbol}/${bSymbol}`,
    dimension: isDimensionless(dimension) ? DIMENSIONLESS : dimension,
    conversion: { kind: "linear", scale },
    label: `${a.label ?? a.symbol} per ${bLabel}`,
  });
}

/**
 * Audit §5 fix: wrap a composite base so the emitted symbol re-parses to
 * the same dimension. Without this, pow(m/s, 2) emitted "m/s^2", which
 * re-parses as m·(s⁻²) — a DIFFERENT dimension (L·T⁻² vs L²·T⁻²) — while
 * the stored dimension stayed correct, i.e. the symbol lied. Atomic
 * symbols (kg, m, °C, %) pass through bare to preserve existing output.
 * Already fully-parenthesized symbols (balanced outer parens, e.g.
 * "(m/s)^2") pass through to avoid redundant nesting; partially grouped
 * symbols like "(a)·(b)" are still wrapped.
 */
/** Exported for literal-folding paths that must emit re-parseable symbols. */
export function isFullyParenthesized(symbol: string): boolean {
  if (!symbol.startsWith("(") || !symbol.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < symbol.length; i++) {
    if (symbol[i] === "(") depth++;
    else if (symbol[i] === ")") {
      depth--;
      if (depth === 0 && i !== symbol.length - 1) return false;
    }
  }
  return depth === 0;
}

/** Exported for literal-folding paths that must emit re-parseable symbols. */
export function parenthesizeComposite(symbol: string): string {
  if (!/[*·/×^()\s]/.test(symbol)) return symbol;
  if (isFullyParenthesized(symbol)) return symbol;
  return `(${symbol})`;
}

function powUnit(base: Unit, exponent: number, rawExpr: string): Unit {
  if (!Number.isInteger(exponent)) {
    throw new InvalidUnitExpressionError(rawExpr, `exponent must be an integer, got ${exponent}`);
  }
  if (isAffineUnit(base)) {
    if (exponent !== 1) {
      throw new InvalidUnitExpressionError(
        rawExpr,
        `affine unit "${base.symbol}" cannot be raised to power ${exponent}`,
      );
    }
    return base;
  }
  if (exponent === 0) {
    // Any unit to power 0 is dimensionless 1
    return makeUnit({
      symbol: "1",
      dimension: DIMENSIONLESS,
      conversion: { kind: "linear", scale: 1 },
      label: "dimensionless",
    });
  }
  if (exponent === 1) return base;
  if (base.conversion.kind !== "linear") {
    throw new InvalidUnitExpressionError(
      rawExpr,
      `power requires a linear unit ("${base.symbol}" has a ${base.conversion.kind} conversion)`,
    );
  }
  const dimension = powDim(base.dimension, exponent);
  const scale = Math.pow(linearScaleOf(base), exponent);
  if (!Number.isFinite(scale) || scale === 0) {
    throw new InvalidUnitExpressionError(
      rawExpr,
      `power produced non-finite scale for exponent ${exponent}`,
    );
  }
  const baseSymbol = parenthesizeComposite(base.symbol);
  const baseLabel = parenthesizeComposite(base.label ?? base.symbol);
  return makeUnit({
    symbol: `${baseSymbol}^${exponent}`,
    dimension,
    conversion: { kind: "linear", scale },
    label: `${baseLabel}^${exponent}`,
  });
}

// ---------------------------------------------------------------------------
// Basis handling (generic metadata, preserved for backward compat)
// ---------------------------------------------------------------------------

function extractBasis(raw: string): { core: string; basis: Basis } {
  const dmMatch = raw.match(/^(.*)\s+DM$/);
  if (dmMatch?.[1] !== undefined) return { core: dmMatch[1].trim(), basis: "DM" };
  const asFedMatch = raw.match(/^(.*)\s+asFed$/);
  if (asFedMatch?.[1] !== undefined) return { core: asFedMatch[1].trim(), basis: "asFed" };
  return { core: raw, basis: undefined };
}

// ---------------------------------------------------------------------------
// Main parser (recursive descent)
// ---------------------------------------------------------------------------

function parseTokens(
  tokens: Token[],
  input: string,
  registry: UnitRegistry,
  strict: boolean,
): Unit {
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function consume(): Token {
    const t = tokens[pos];
    if (!t)
      throw new InvalidUnitExpressionError(input, "unexpected end of expression", input.length);
    pos++;
    return t;
  }

  function parseFactor(depth: number): Unit {
    if (depth > MAX_NESTING_DEPTH) {
      throw new InvalidUnitExpressionError(
        input,
        `parenthesis nesting exceeds maximum depth ${MAX_NESTING_DEPTH}`,
      );
    }
    const t = peek();
    if (!t) {
      throw new InvalidUnitExpressionError(
        input,
        "unexpected end, expected unit or '('",
        input.length,
      );
    }
    if (t.type === "LPAREN") {
      consume(); // "("
      const inner = parseExpression(depth + 1);
      const next = peek();
      if (!next || next.type !== "RPAREN") {
        throw new InvalidUnitExpressionError(
          input,
          `expected ")" to close "(" at position ${t.pos}`,
          t.pos,
        );
      }
      consume(); // ")"
      return inner;
    }
    if (t.type === "UNIT") {
      consume();
      let unit: Unit;
      try {
        unit = registry.resolve(t.value);
      } catch (e) {
        if (e instanceof UnsupportedUnitError) {
          // Preserve original error type for unknown/unsupported units (including
          // single-prefix restriction like "kkg" where base not prefixable).
          throw e;
        }
        throw e;
      }
      return unit;
    }
    // Prompt-18 fix: the canonical dimensionless identity "1" is a valid
    // factor (only the exact token "1" — never "2", "-1", "01", decimals).
    // Rationale: the engine itself emits "(1)·(kg)"-style symbols (literal
    // folding, Quantity×dimensionless), and serialization round-trips require
    // parsing them back. This fires only at factor-start (after an operator,
    // "(" or input start) — exponents ("m^1") and trailing digits ("m1")
    // keep their existing exponent handling, and other integers still throw.
    if (t.type === "INT" && t.value === "1") {
      consume();
      return makeUnit({
        symbol: "1",
        dimension: DIMENSIONLESS,
        toBaseFactor: 1,
        label: "dimensionless",
      });
    }
    throw new InvalidUnitExpressionError(
      input,
      `expected unit or "(" but found "${t.value}" at position ${t.pos}`,
      t.pos,
    );
  }

  function parseExponentTail(base: Unit): Unit {
    const next = peek();
    if (!next) return base;
    if (next.type === "POW") {
      consume(); // "^"
      const afterPow = peek();
      if (!afterPow) {
        throw new InvalidUnitExpressionError(input, 'expected integer after "^"', next.pos);
      }
      if (afterPow.type === "INT") {
        const intTok = consume();
        const exp = Number.parseInt(intTok.value, 10);
        if (!Number.isInteger(exp)) {
          throw new InvalidUnitExpressionError(
            input,
            `exponent "${intTok.value}" is not an integer`,
            intTok.pos,
          );
        }
        return powUnit(base, exp, input);
      }
      if (afterPow.type === "SUPER") {
        const superTok = consume();
        const exp = superToInt(superTok.value, input, superTok.pos);
        return powUnit(base, exp, input);
      }
      throw new InvalidUnitExpressionError(
        input,
        `expected integer or superscript after "^" but found "${afterPow.value}"`,
        afterPow.pos,
      );
    }
    if (next.type === "SUPER") {
      const superTok = consume();
      const exp = superToInt(superTok.value, input, superTok.pos);
      return powUnit(base, exp, input);
    }
    if (next.type === "INT") {
      // Trailing digit without "^", e.g. "m2" where tokenizer produced UNIT("m") + INT("2").
      // Lenient convenience; strict mode requires "^" or superscript (unambiguous).
      if (strict) {
        throw new InvalidUnitExpressionError(
          input,
          `strict mode requires "^" for exponents (found "${next.value}" at position ${next.pos})`,
          next.pos,
        );
      }
      const intTok = consume();
      const exp = Number.parseInt(intTok.value, 10);
      if (!Number.isInteger(exp)) {
        throw new InvalidUnitExpressionError(
          input,
          `exponent "${intTok.value}" is not an integer`,
          intTok.pos,
        );
      }
      return powUnit(base, exp, input);
    }
    return base;
  }

  function parseTerm(depth: number): Unit {
    let left = parseFactor(depth);
    left = parseExponentTail(left);
    return left;
  }

  function parseExpression(depth: number): Unit {
    if (tokens.length === 0) {
      throw new InvalidUnitExpressionError(input, "empty unit expression", 0);
    }
    let left = parseTerm(depth);
    while (true) {
      const next = peek();
      if (!next) break;
      if (next.type === "DIV") {
        consume();
        const right = parseTerm(depth);
        left = divideUnits(left, right, input);
        continue;
      }
      if (next.type === "MUL") {
        consume();
        const right = parseTerm(depth);
        left = multiplyUnits(left, right, input);
        continue;
      }
      if (next.type === "UNIT" || next.type === "LPAREN") {
        // Implicit multiplication ("kg m", "(kg)(m)") — lenient convenience only.
        if (strict) {
          throw new InvalidUnitExpressionError(
            input,
            `strict mode requires explicit operators ("*", "/", "·") between units (found "${next.value}" at position ${next.pos})`,
            next.pos,
          );
        }
        const right = parseTerm(depth);
        left = multiplyUnits(left, right, input);
        continue;
      }
      if (next.type === "RPAREN") {
        break; // let caller handle paren close
      }
      // Any other token (POW already handled in parseTerm, INT/SUPER handled as exponent)
      // If we encounter stray POW/INT/SUPER here, it's malformed
      if (next.type === "POW" || next.type === "INT" || next.type === "SUPER") {
        throw new InvalidUnitExpressionError(
          input,
          `unexpected token "${next.value}" at position ${next.pos}`,
          next.pos,
        );
      }
      break;
    }
    return left;
  }

  const result = parseExpression(0);
  if (pos < tokens.length) {
    const leftover = tokens[pos]!;
    throw new InvalidUnitExpressionError(
      input,
      `unexpected token "${leftover.value}" at position ${leftover.pos}`,
      leftover.pos,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Cache (bounded, per-registry, GC-safe) and parser limits
// ---------------------------------------------------------------------------

const MAX_CACHE_SIZE = 500;
/** Maximum unit-expression text length accepted (DoS guard). */
export const MAX_UNIT_EXPRESSION_LENGTH = 4096;
/**
 * Maximum parenthesis nesting depth (DoS guard — the recursive-descent
 * parser uses the call stack, so depth must stay far below stack limits).
 */
export const MAX_NESTING_DEPTH = 100;

/** Parser behavior options. */
export interface ParseOptions {
  /**
   * Strict mode rejects ambiguous conveniences that lenient mode accepts:
   * implicit multiplication (`kg m`, `(kg)(m)`) and bare trailing-digit
   * exponents (`m2` — use `m^2` or `m²`). Unambiguous superscripts (`m²`),
   * explicit operators and `^` exponents work in both modes. Default false
   * (lenient, backward compatible).
   */
  readonly strict?: boolean;
}

/**
 * Per-registry parse caches. A WeakMap keyed by registry object means:
 * - distinct custom registries never share (and cannot poison) each other,
 * - discarded registries are garbage-collected with their caches,
 * - each cache is bounded independently (FIFO eviction at MAX_CACHE_SIZE).
 * Cache keys embed `registry.version`, so entries from before a
 * register/unregister mutation can never be hit (stale definitions are
 * unreachable; they age out via FIFO eviction).
 */
const parseCaches = new WeakMap<UnitRegistry, Map<string, Unit>>();

function cacheFor(registry: UnitRegistry): Map<string, Unit> {
  let cache = parseCaches.get(registry);
  if (!cache) {
    cache = new Map<string, Unit>();
    parseCaches.set(registry, cache);
  }
  return cache;
}

function cacheKeyFor(registry: UnitRegistry, trimmed: string): string {
  return `${registry.version}::${trimmed}`;
}

function cacheSet(cache: Map<string, Unit>, key: string, unit: Unit): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry (Map preserves insertion order)
    const firstKey = cache.keys().next().value as string | undefined;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, unit);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a unit expression into a resolved Unit.
 *
 * Supported syntax (examples):
 * - "kg", "g", "mg", "%", "ppm", "‰", "ppb", "ppt"
 * - prefixes: "km", "nm", "µm" / "ug", "MHz", "kW"
 * - "m/s", "kg / s", "m·s^-1", "kg·m/s²", "kg*m/s^2", "m^2", "m²", "m2", "cm²"
 * - "(kg*m)/s^2", "kg m^-2", "m/s^2", "kg*m2/s2"
 *
 * Basis suffixes " DM" / " asFed" are preserved as generic metadata
 * (stored in Unit.basis) for backward compat with @vetwo/nutrition-units,
 * but the core parser is agnostic to their domain meaning.
 */
/**
 * A core that needs no tokenization: a single identifier with no
 * whitespace, parens, operators, digits, superscripts or punctuation.
 * Such inputs resolve (or fail) identically through the registry, so the
 * fast path bypasses the tokenizer with zero behavior change.
 */
const SIMPLE_IDENTIFIER_RE = /^[^\s()/^*.·⋅×0-9⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺.;,:!&|\\-]+$/u;

function attachBasis(unit: Unit, basis: Basis): Unit {
  if (!basis) return unit;
  return makeUnit({
    ...unit,
    basis,
    // Keep original combined symbol for debugging, but core symbol stays expression
    // Store basis separately; label already from unit
  });
}

export function parseUnit(
  input: string,
  registry: UnitRegistry = defaultUnitRegistry,
  opts: ParseOptions = {},
): Unit {
  if (typeof input !== "string") {
    throw new InvalidUnitExpressionError(String(input), "unit expression must be a string");
  }
  // Unicode NFC normalization first (deterministic; precomposed ° µ ² unaffected,
  // decomposed sequences collapse). Positions in errors refer to normalized text.
  const trimmed = input.normalize("NFC").trim();
  if (trimmed.length === 0) {
    throw new InvalidUnitExpressionError(input, "empty unit expression");
  }
  if (trimmed.length > MAX_UNIT_EXPRESSION_LENGTH) {
    throw new InvalidUnitExpressionError(
      input,
      `unit expression exceeds maximum length ${MAX_UNIT_EXPRESSION_LENGTH}`,
    );
  }
  const strict = opts.strict ?? false;
  // Cache key includes strictness: strict and lenient parses are distinct operations.
  const cache = cacheFor(registry);
  const key = `${cacheKeyFor(registry, trimmed)}::${strict ? "strict" : "lenient"}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const { core, basis } = extractBasis(trimmed);

  // Fast path: single identifiers resolve directly (identical to slow path,
  // which would produce exactly one UNIT token resolved the same way).
  if (SIMPLE_IDENTIFIER_RE.test(core)) {
    try {
      const unit = attachBasis(registry.resolve(core), basis);
      cacheSet(cache, key, unit);
      return unit;
    } catch (e) {
      if (e instanceof UnsupportedUnitError) {
        // Fall through to the full parser for a structured error. The slow
        // path re-resolves and throws the same UnsupportedUnitError.
      } else {
        throw e;
      }
    }
  }

  // Tokenize and parse core expression
  const rawCore = core;
  let unit: Unit;
  try {
    const tokens = tokenize(rawCore);
    if (tokens.length === 0) {
      throw new InvalidUnitExpressionError(input, "empty unit expression after basis extraction");
    }
    // Guard against obvious malformed leading/trailing operators before parsing
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    if (first && (first.type === "DIV" || first.type === "MUL")) {
      throw new InvalidUnitExpressionError(
        input,
        `expression cannot start with "${first.value}"`,
        first.pos,
      );
    }
    if (last && (last.type === "DIV" || last.type === "MUL" || last.type === "POW")) {
      throw new InvalidUnitExpressionError(
        input,
        `expression cannot end with "${last.value}"`,
        last.pos,
      );
    }
    // Check for double operators that tokenizer would have left as separate tokens
    // Parser will handle, but we can give a fast path for "//" etc. via token adjacency check
    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i]!;
      const b = tokens[i + 1]!;
      if ((a.type === "DIV" && b.type === "DIV") || (a.type === "MUL" && b.type === "MUL")) {
        throw new InvalidUnitExpressionError(
          input,
          `consecutive operators "${a.value}${b.value}"`,
          b.pos,
        );
      }
      if (a.type === "POW" && b.type === "POW") {
        throw new InvalidUnitExpressionError(input, `consecutive "^" operators`, b.pos);
      }
    }

    unit = parseTokens(tokens, rawCore, registry, strict);
  } catch (e) {
    if (e instanceof InvalidUnitExpressionError || e instanceof UnsupportedUnitError) throw e;
    // Wrap unknown errors as InvalidUnitExpressionError for consistent typed errors
    throw new InvalidUnitExpressionError(input, (e as Error).message);
  }

  // Re-attach basis as frozen metadata (generic, not domain-specific).
  // Serializer re-adds basis as " DM".
  unit = attachBasis(unit, basis);

  cacheSet(cache, key, unit);
  return unit;
}

/**
 * UnitParser class — object-oriented facade over parseUnit, per spec 8.21.
 * parser.parse("kg/m") returns the canonical Unit. Tokenizer/AST/cache are
 * internal details kept private.
 */
export class UnitParser {
  constructor(
    private readonly registry: UnitRegistry = defaultUnitRegistry,
    private readonly defaultOpts: ParseOptions = {},
  ) {}

  parse(input: string, opts: ParseOptions = {}): Unit {
    return parseUnit(input, this.registry, { ...this.defaultOpts, ...opts });
  }

  static parse(
    input: string,
    registry: UnitRegistry = defaultUnitRegistry,
    opts: ParseOptions = {},
  ): Unit {
    return parseUnit(input, registry, opts);
  }
}
