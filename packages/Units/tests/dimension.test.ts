/**
 * tests/dimension.test.ts
 * -----------------------------------------------------------------------
 * Specification tests for the generic dimension system
 * (docs/DIMENSION_SPEC.md). Covers hand-written examples AND seeded,
 * deterministic property-based checks of the algebraic invariants —
 * no external property-testing dependency required.
 * -----------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";
import {
  DIMENSIONLESS,
  Dim,
  DimensionError,
  DimensionRegistry,
  InvalidDimensionError,
  defaultDimensionRegistry,
  defineDimension,
  dimensionKey,
  dimensionsEqual,
  divideDim,
  isDimensionless,
  multiplyDim,
  powDim,
  rootDim,
} from "../src/index.js";

const M = Dim.Mass;
const L = Dim.Length;
const T = Dim.Time;
const E = Dim.Energy;

// ---------------------------------------------------------------------------
// Construction & canonical representation
// ---------------------------------------------------------------------------

describe("defineDimension", () => {
  it("builds frozen vectors and drops zero exponents", () => {
    const d = defineDimension({ M: 1, T: 0 });
    expect(d).toEqual({ M: 1 });
    expect(Object.isFrozen(d)).toBe(true);
  });

  it("is order-independent at construction", () => {
    expect(
      dimensionsEqual(defineDimension({ M: 1, L: -2 }), defineDimension({ L: -2, M: 1 })),
    ).toBe(true);
  });

  it("rejects unregistered ids", () => {
    expect(() => defineDimension({ Bogus: 1 })).toThrow(InvalidDimensionError);
  });

  it("rejects non-integer exponents", () => {
    expect(() => defineDimension({ M: 0.5 })).toThrow(InvalidDimensionError);
  });

  it("rejects malformed ids", () => {
    const registry = new DimensionRegistry();
    expect(() => registry.register("1bad", "x")).toThrow(InvalidDimensionError);
    expect(() => registry.register("has space", "x")).toThrow(InvalidDimensionError);
    expect(() => registry.register("", "x")).toThrow(InvalidDimensionError);
  });
});

describe("canonical key", () => {
  it("is identical regardless of construction path or insertion order", () => {
    const force = multiplyDim(M, multiplyDim(L, powDim(T, -2)));
    expect(dimensionKey(force)).toBe(dimensionKey(defineDimension({ M: 1, L: 1, T: -2 })));
    expect(dimensionKey(force)).toBe(dimensionKey({ T: -2, M: 1, L: 1 }));
  });

  it('canonicalizes dimensionless to "1"', () => {
    expect(dimensionKey(DIMENSIONLESS)).toBe("1");
    expect(dimensionKey(divideDim(L, L))).toBe("1");
  });

  it("renders explicit signs for negative exponents", () => {
    expect(dimensionKey(divideDim(M, T))).toBe("M^1·T^-1");
  });

  it("is usable as a Map key", () => {
    const map = new Map<string, string>();
    map.set(dimensionKey(defineDimension({ M: 1, T: -1 })), "velocity-like");
    expect(map.get(dimensionKey(multiplyDim(M, powDim(T, -1))))).toBe("velocity-like");
  });

  it("keys are deterministic across multiple calls", () => {
    const dim = multiplyDim(M, divideDim(L, powDim(T, 2)));
    const k1 = dimensionKey(dim);
    const k2 = dimensionKey(dim);
    const k3 = dimensionKey(dim);
    expect(k1).toBe(k2);
    expect(k2).toBe(k3);
  });
});

// ---------------------------------------------------------------------------
// Algebra
// ---------------------------------------------------------------------------

describe("multiplyDim (A × B adds exponents)", () => {
  it("M × L = M¹L¹", () => {
    expect(dimensionKey(multiplyDim(M, L))).toBe("L^1·M^1");
  });

  it("M × T⁻¹ = M¹T⁻¹", () => {
    expect(dimensionKey(multiplyDim(M, powDim(T, -1)))).toBe("M^1·T^-1");
  });

  it("L × L = L²", () => {
    expect(dimensionKey(multiplyDim(L, L))).toBe("L^2");
  });

  it("L × L⁻¹ cancels to dimensionless", () => {
    expect(isDimensionless(multiplyDim(L, powDim(L, -1)))).toBe(true);
  });

  it("M × M⁻¹ cancels to dimensionless", () => {
    expect(isDimensionless(multiplyDim(M, powDim(M, -1)))).toBe(true);
  });

  it("complex: energy × time⁻¹ = power-like E¹T⁻¹", () => {
    expect(dimensionKey(divideDim(E, T))).toBe("E^1·T^-1");
  });

  it("dimensionless × A = A (left identity)", () => {
    expect(dimensionsEqual(multiplyDim(DIMENSIONLESS, M), M)).toBe(true);
    expect(dimensionsEqual(multiplyDim(DIMENSIONLESS, L), L)).toBe(true);
  });

  it("dimensionless × dimensionless = dimensionless", () => {
    expect(isDimensionless(multiplyDim(DIMENSIONLESS, DIMENSIONLESS))).toBe(true);
  });

  it("handles high exponents: L⁵", () => {
    const l5 = multiplyDim(multiplyDim(L, L), multiplyDim(multiplyDim(L, L), L));
    expect(dimensionKey(l5)).toBe("L^5");
  });
});

describe("divideDim (A / B subtracts exponents)", () => {
  it("M / T = M¹T⁻¹", () => {
    expect(dimensionKey(divideDim(M, T))).toBe("M^1·T^-1");
  });

  it("M / (L·T)", () => {
    expect(dimensionKey(divideDim(M, multiplyDim(L, T)))).toBe("L^-1·M^1·T^-1");
  });

  it("L / T²", () => {
    expect(dimensionKey(divideDim(L, powDim(T, 2)))).toBe("L^1·T^-2");
  });

  it("cancels to dimensionless when A === B", () => {
    expect(isDimensionless(divideDim(E, E))).toBe(true);
  });

  it("dimensionless / A = A⁻¹", () => {
    expect(isDimensionless(divideDim(DIMENSIONLESS, DIMENSIONLESS))).toBe(true);
    expect(dimensionsEqual(divideDim(DIMENSIONLESS, M), powDim(M, -1))).toBe(true);
  });

  it("A / dimensionless = A", () => {
    expect(dimensionsEqual(divideDim(M, DIMENSIONLESS), M)).toBe(true);
  });
});

describe("powDim (exponents scale by n)", () => {
  it("L²", () => {
    expect(dimensionKey(powDim(L, 2))).toBe("L^2");
  });

  it("T⁻² via negative power", () => {
    expect(dimensionKey(powDim(T, -2))).toBe("T^-2");
  });

  it("(L·T⁻¹)² = L²T⁻²", () => {
    expect(dimensionKey(powDim(divideDim(L, T), 2))).toBe("L^2·T^-2");
  });

  it("(M·L·T⁻²)² = M²L²T⁻⁴", () => {
    const accel = multiplyDim(M, divideDim(L, powDim(T, 2)));
    expect(dimensionKey(powDim(accel, 2))).toBe("L^2·M^2·T^-4");
  });

  it("A⁰ = dimensionless and A¹ = A", () => {
    expect(powDim(M, 0)).toBe(DIMENSIONLESS);
    expect(dimensionsEqual(powDim(M, 1), M)).toBe(true);
  });

  it("power of power: (A²)³ = A⁶", () => {
    const l2 = powDim(L, 2);
    const l6 = powDim(l2, 3);
    expect(dimensionKey(l6)).toBe("L^6");
  });

  it("power distributes over multiplication: (A × B)² = A² × B²", () => {
    const ab = multiplyDim(M, L);
    const ab2 = powDim(ab, 2);
    const a2b2 = multiplyDim(powDim(M, 2), powDim(L, 2));
    expect(dimensionKey(ab2)).toBe(dimensionKey(a2b2));
  });

  it("rejects fractional powers", () => {
    expect(() => powDim(L, 0.5)).toThrow(InvalidDimensionError);
  });
});

describe("rootDim (exact roots only)", () => {
  it("sqrt(L²) → L", () => {
    expect(dimensionsEqual(rootDim(powDim(L, 2), 2), L)).toBe(true);
  });

  it("(L²T⁻²)^(1/2) → L·T⁻¹", () => {
    const speedSquared = powDim(divideDim(L, T), 2);
    expect(dimensionsEqual(rootDim(speedSquared, 2), divideDim(L, T))).toBe(true);
  });

  it("sqrt(L) is invalid and throws DimensionError", () => {
    expect(() => rootDim(L, 2)).toThrow(DimensionError);
  });

  it("degree 1 is the identity root: root(A, 1) = A", () => {
    expect(dimensionsEqual(rootDim(L, 1), L)).toBe(true);
    expect(dimensionsEqual(rootDim(M, 1), M)).toBe(true);
    expect(dimensionsEqual(rootDim(divideDim(L, T), 1), divideDim(L, T))).toBe(true);
  });

  it("root of dimensionless is dimensionless", () => {
    expect(dimensionsEqual(rootDim(DIMENSIONLESS, 2), DIMENSIONLESS)).toBe(true);
    expect(dimensionsEqual(rootDim(DIMENSIONLESS, 5), DIMENSIONLESS)).toBe(true);
  });

  it("rejects degree 0, negatives and non-integers", () => {
    expect(() => rootDim(L, 0)).toThrow(InvalidDimensionError);
    expect(() => rootDim(L, -2)).toThrow(InvalidDimensionError);
    expect(() => rootDim(L, 1.5)).toThrow(InvalidDimensionError);
  });

  it("cubic root: (L³T⁻³)^(1/3) → L·T⁻¹", () => {
    const cubed = powDim(divideDim(L, T), 3);
    expect(dimensionsEqual(rootDim(cubed, 3), divideDim(L, T))).toBe(true);
  });

  it("rejects non-exact cubic root", () => {
    expect(() => rootDim(L, 3)).toThrow(DimensionError);
  });
});

// ---------------------------------------------------------------------------
// Registry semantics
// ---------------------------------------------------------------------------

describe("DimensionRegistry", () => {
  it("prevents id collisions", () => {
    const registry = new DimensionRegistry();
    registry.register("X", "first");
    expect(() => registry.register("X", "second")).toThrow(InvalidDimensionError);
  });

  it("supports custom base dimensions without touching core math", () => {
    const registry = new DimensionRegistry();
    // NOTE: "Info" graduated to a seeded dimension in Phase 21, so the
    // custom-dimension example uses "Angle" instead (still unseeded).
    registry.register("Angle", "Angle");
    const angleVector = registry.normalize({ Angle: 1 });
    const perTime = registry.normalize({ Angle: 1, T: -1 });
    expect(dimensionKey(angleVector)).toBe("Angle^1");
    expect(dimensionKey(perTime)).toBe("Angle^1·T^-1");
    // the default registry does not leak test registrations
    expect(defaultDimensionRegistry.has("Angle")).toBe(false);
  });

  it("keeps units and dimensions as separate registries", () => {
    expect(defaultDimensionRegistry.has("kg")).toBe(false); // "kg" is a UNIT, not a dimension
    expect(defaultDimensionRegistry.getName("M")).toBe("Mass");
  });

  it("getName returns empty string for unknown ids", () => {
    const registry = new DimensionRegistry();
    expect(registry.getName("Nonexistent")).toBe("");
  });

  it("list returns all registered dimensions sorted by id", () => {
    const registry = new DimensionRegistry([]);
    registry.register("Z", "Zebra");
    registry.register("A", "Alpha");
    registry.register("M", "Mass");
    const listed = registry.list();
    expect(listed.map((d) => d.id)).toEqual(["A", "M", "Z"]);
  });

  it("normalize drops zero exponents", () => {
    const registry = new DimensionRegistry([]);
    registry.register("M", "Mass");
    const result = registry.normalize({ M: 0 });
    expect(dimensionKey(result)).toBe("1");
  });

  it("normalize rejects invalid exponents", () => {
    const registry = new DimensionRegistry([]);
    registry.register("M", "Mass");
    expect(() => registry.normalize({ M: 1.5 })).toThrow(InvalidDimensionError);
  });

  it("normalize rejects unregistered ids", () => {
    const registry = new DimensionRegistry([]);
    registry.register("M", "Mass");
    expect(() => registry.normalize({ Unknown: 1 })).toThrow(InvalidDimensionError);
  });

  it("isolated registry does not share state with default", () => {
    const isolated = new DimensionRegistry([]);
    expect(isolated.has("M")).toBe(false);
    expect(defaultDimensionRegistry.has("M")).toBe(true);
  });

  it("inherits seed dimensions by default", () => {
    const derived = new DimensionRegistry();
    expect(derived.has("M")).toBe(true);
    expect(derived.has("L")).toBe(true);
    expect(derived.has("T")).toBe(true);
    expect(derived.getName("M")).toBe("Mass");
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe("immutability", () => {
  it("operations never mutate their inputs", () => {
    const a = defineDimension({ M: 1, T: -1 });
    const b = defineDimension({ L: 1 });
    const aSnapshot = JSON.stringify(a);
    const bSnapshot = JSON.stringify(b);

    multiplyDim(a, b);
    divideDim(a, b);
    powDim(a, 3);
    try {
      rootDim(a, 2);
    } catch {
      /* expected non-exact root */
    }

    expect(JSON.stringify(a)).toBe(aSnapshot);
    expect(JSON.stringify(b)).toBe(bSnapshot);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(b)).toBe(true);
  });

  it("results are frozen", () => {
    expect(Object.isFrozen(multiplyDim(M, L))).toBe(true);
    expect(Object.isFrozen(divideDim(M, T))).toBe(true);
    expect(Object.isFrozen(powDim(M, 2))).toBe(true);
    expect(Object.isFrozen(powDim(M, 0))).toBe(true);
  });

  it("defineDimension result is frozen", () => {
    const d = defineDimension({ M: 1 });
    expect(Object.isFrozen(d)).toBe(true);
  });

  it("DIMENSIONLESS constant is frozen", () => {
    expect(Object.isFrozen(DIMENSIONLESS)).toBe(true);
  });

  it("Dim convenience object is frozen", () => {
    expect(Object.isFrozen(Dim)).toBe(true);
  });

  it("Dim vectors are frozen", () => {
    expect(Object.isFrozen(Dim.Mass)).toBe(true);
    expect(Object.isFrozen(Dim.Length)).toBe(true);
    expect(Object.isFrozen(Dim.Time)).toBe(true);
    expect(Object.isFrozen(Dim.Dimensionless)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property-based invariants (seeded deterministic generator)
// ---------------------------------------------------------------------------

/**
 * Deterministic xorshift PRNG so property runs are reproducible in CI.
 */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

const IDS = ["I", "J", "L", "M", "Substance", "T", "Temp"] as const;
const EXPONENTS = [-3, -2, -1, 0, 1, 2, 3];

/** Generate a random valid dimension vector over the seed ids. */
function randomDimension(rng: () => number): ReturnType<typeof defineDimension> {
  const raw: Record<string, number> = {};
  for (const id of IDS) {
    if (rng() < 0.5) {
      raw[id] = EXPONENTS[Math.floor(rng() * EXPONENTS.length)] as number;
    }
  }
  return defineDimension(raw);
}

describe("dimension algebra invariants (property-based)", () => {
  const rng = makeRng(0x5eed);
  const samples = Array.from({ length: 300 }, () => ({
    a: randomDimension(rng),
    b: randomDimension(rng),
    c: randomDimension(rng),
  }));

  it("commutativity: A × B = B × A", () => {
    for (const { a, b } of samples) {
      expect(dimensionKey(multiplyDim(a, b))).toBe(dimensionKey(multiplyDim(b, a)));
    }
  });

  it("associativity: (A × B) × C = A × (B × C)", () => {
    for (const { a, b, c } of samples) {
      expect(dimensionKey(multiplyDim(multiplyDim(a, b), c))).toBe(
        dimensionKey(multiplyDim(a, multiplyDim(b, c))),
      );
    }
  });

  it("identity: A × dimensionless = A", () => {
    for (const { a } of samples) {
      expect(dimensionsEqual(multiplyDim(a, DIMENSIONLESS), a)).toBe(true);
    }
  });

  it("self-cancellation: A / A = dimensionless", () => {
    for (const { a } of samples) {
      expect(isDimensionless(divideDim(a, a))).toBe(true);
    }
  });

  it("round-trip: (A / B) × B = A", () => {
    for (const { a, b } of samples) {
      expect(dimensionKey(multiplyDim(divideDim(a, b), b))).toBe(dimensionKey(a));
    }
  });

  it("power identity: A⁰ = dimensionless, A¹ = A, A² = A × A", () => {
    for (const { a } of samples) {
      expect(isDimensionless(powDim(a, 0))).toBe(true);
      expect(dimensionsEqual(powDim(a, 1), a)).toBe(true);
      expect(dimensionKey(powDim(a, 2))).toBe(dimensionKey(multiplyDim(a, a)));
    }
  });

  it("division antisymmetry: A / B = A × B⁻¹", () => {
    for (const { a, b } of samples) {
      expect(dimensionKey(divideDim(a, b))).toBe(dimensionKey(multiplyDim(a, powDim(b, -1))));
    }
  });

  it("exact roots: root(A^n, n) = A for n ∈ {2, 3}", () => {
    for (const { a } of samples.slice(0, 100)) {
      expect(dimensionsEqual(rootDim(powDim(a, 2), 2), a)).toBe(true);
      expect(dimensionsEqual(rootDim(powDim(a, 3), 3), a)).toBe(true);
    }
  });

  it("power of power: (A^n)^m = A^(n*m)", () => {
    for (const { a } of samples.slice(0, 100)) {
      const a2 = powDim(a, 2);
      const a2_3 = powDim(a2, 3);
      const a6 = powDim(a, 6);
      expect(dimensionKey(a2_3)).toBe(dimensionKey(a6));
    }
  });

  it("multiply dimensionless: A × dimensionless = dimensionless × A = A", () => {
    for (const { a } of samples) {
      expect(dimensionsEqual(multiplyDim(DIMENSIONLESS, a), a)).toBe(true);
      expect(dimensionsEqual(multiplyDim(a, DIMENSIONLESS), a)).toBe(true);
    }
  });

  it("divide with dimensionless: A / dimensionless = A, dimensionless / A = A⁻¹", () => {
    for (const { a } of samples) {
      expect(dimensionsEqual(divideDim(a, DIMENSIONLESS), a)).toBe(true);
      expect(dimensionsEqual(divideDim(DIMENSIONLESS, a), powDim(a, -1))).toBe(true);
    }
  });
});
