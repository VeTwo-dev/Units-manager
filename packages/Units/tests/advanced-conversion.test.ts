/**
 * tests/advanced-conversion.test.ts — Phase 13: Advanced Conversion Engine
 */
import { describe, expect, it } from "vitest";
import { Quantity } from "../src/quantity.js";
import { parseUnit } from "../src/unit-parser.js";
import { convert, toBase, fromBase } from "../src/conversion-engine.js";
import { InvalidAffineOperationError, ImpossibleConversionError } from "../src/errors/index.js";

describe("13.1 conversion model audit", () => {
  it("distinguishes linear vs affine", () => {
    expect(parseUnit("kg").conversion.kind).toBe("linear");
    expect(parseUnit("°C").conversion.kind).toBe("affine");
    expect(parseUnit("K").conversion.kind).toBe("linear"); // K offset 0 is linear? Actually K is linear with offset 0?
    // K is linear scale 1, not affine with offset, but we treat as linear
    expect(parseUnit("K").conversion.kind).toBe("linear");
  });
});

describe("13.3 temperature conversions", () => {
  it("°C → K, K → °C", () => {
    expect(convert(0, parseUnit("°C"), parseUnit("K"))).toBeCloseTo(273.15, 9);
    expect(convert(273.15, parseUnit("K"), parseUnit("°C"))).toBeCloseTo(0, 9);
  });
  it("°C → °F", () => {
    expect(convert(0, parseUnit("°C"), parseUnit("°F"))).toBeCloseTo(32, 9);
    expect(convert(100, parseUnit("°C"), parseUnit("°F"))).toBeCloseTo(212, 9);
  });
  it("Quantity °C → °F via Quantity.to", () => {
    expect(Quantity.of(0, "°C").to("°F").value).toBeCloseTo(32, 9);
    expect(Quantity.of(100, "°C").to("°F").value).toBeCloseTo(212, 9);
  });
});

describe("13.4 absolute vs differential", () => {
  it("adding two absolute °C throws", () => {
    expect(() => Quantity.of(10, "°C").add(Quantity.of(5, "°C"))).toThrow(
      InvalidAffineOperationError,
    );
  });
  it("subtracting two absolute °C yields delta K", () => {
    const r = Quantity.of(10, "°C").subtract(Quantity.of(5, "°C"));
    expect(r.isDimensionless()).toBe(false);
    expect(r.value).toBeCloseTo(5, 9); // delta 5 K
    expect(r.unit.symbol).toBe("K");
  });
  it("absolute °C + delta K succeeds", () => {
    const r = Quantity.of(10, "°C").add(Quantity.of(5, "K"));
    expect(r.value).toBeCloseTo(15, 9);
    expect(r.unit.symbol).toBe("°C");
  });
  it("delta - absolute = delta (temperature difference)", () => {
    const r = Quantity.of(5, "K").subtract(Quantity.of(10, "°C"));
    // 5 K - 10 °C = 5 K - 283.15 K = -278.15 K difference
    expect(r.value).toBeCloseTo(-278.15, 6);
    expect(r.unit.symbol).toBe("K");
  });
  it("difference 1°C interval equals 1 K", () => {
    const diff = Quantity.of(1, "°C").subtract(Quantity.of(0, "°C"));
    expect(diff.to("K").value).toBeCloseTo(1, 9);
  });
});

describe("13.5 offset safety", () => {
  it("multiply with affine throws", () => {
    expect(() => Quantity.of(10, "°C").multiply(Quantity.of(2, "kg"))).toThrow(
      InvalidAffineOperationError,
    );
    expect(() => Quantity.of(2, "kg").multiply(Quantity.of(10, "°C"))).toThrow(
      InvalidAffineOperationError,
    );
  });
  it("divide with affine throws", () => {
    expect(() => Quantity.of(10, "°C").divide(Quantity.of(2, "kg"))).toThrow(
      InvalidAffineOperationError,
    );
    expect(() => Quantity.of(10, "kg").divide(Quantity.of(2, "°C"))).toThrow(
      InvalidAffineOperationError,
    );
  });
  it("divide affine by scalar throws", () => {
    expect(() => Quantity.of(10, "°C").divide(2)).toThrow(InvalidAffineOperationError);
  });
  it("scale with affine throws (scaling absolute temperature is not meaningful)", () => {
    expect(() => Quantity.of(10, "°C").scale(2)).toThrow(InvalidAffineOperationError);
  });
});

describe("13.6 conversion composition", () => {
  it("C → F → K deterministic", () => {
    const c = parseUnit("°C");
    const f = parseUnit("°F");
    const k = parseUnit("K");
    const v = 25;
    const viaF = fromBase(toBase(convert(v, c, f), f), k);
    const direct = convert(v, c, k);
    expect(viaF).toBeCloseTo(direct, 9);
  });
});

describe("13.8 direct vs base", () => {
  it("direct conversion same as base conversion", () => {
    const a = parseUnit("kg");
    const b = parseUnit("g");
    expect(convert(1, a, b)).toBeCloseTo(1000, 9);
    // Both via base: toBase and fromBase
    expect(toBase(1, a)).toBe(1);
    expect(fromBase(1, b)).toBe(1000);
  });
  it("registration order does not affect conversion", () => {
    // Both kg and g are already registered, order shouldn't matter
    expect(convert(1, parseUnit("g"), parseUnit("kg"))).toBeCloseTo(0.001, 12);
  });
});

describe("13.10 impossible conversions", () => {
  it("kg → m throws", () => {
    expect(() => convert(1, parseUnit("kg"), parseUnit("m"))).toThrow(ImpossibleConversionError);
  });
  it("second → kelvin throws", () => {
    expect(() => convert(1, parseUnit("s"), parseUnit("K"))).toThrow(ImpossibleConversionError);
  });
  it("Quantity kg → m throws", () => {
    expect(() => Quantity.of(1, "kg").to("m")).toThrow(ImpossibleConversionError);
  });
});

describe("13.13 invertibility", () => {
  it("A→B→A preserves value for linear", () => {
    const a = parseUnit("kg");
    const b = parseUnit("lb");
    const v = 10;
    expect(convert(convert(v, a, b), b, a)).toBeCloseTo(v, 9);
  });
  it("affine invertibility", () => {
    const c = parseUnit("°C");
    const k = parseUnit("K");
    const v = 25;
    expect(convert(convert(v, c, k), k, c)).toBeCloseTo(v, 9);
  });
});

describe("13.11 non-linear deferred", () => {
  it("logarithmic units not implemented as linear, document", () => {
    // dB, pH should not be simple factor units; we defer and document
    expect(() => parseUnit("dB")).toThrow();
    // If we had non-linear, it would require declarative model, not function
  });
});

describe("13.19 property: linear conversion preserves add", () => {
  it("convert(a+b) ≈ convert(a)+convert(b) for linear", () => {
    const a = Quantity.of(1, "kg");
    const b = Quantity.of(500, "g");
    const sum = a.add(b); // 1.5 kg
    const sumConverted = sum.to("g").value; // 1500 g
    const aG = a.to("g").value; // 1000
    const bG = b.to("g").value; // 500
    expect(sumConverted).toBeCloseTo(aG + bG, 9);
  });
  it("not for affine absolute", () => {
    // 10°C + 5°C is not 15°C via linear, but our add throws, so property not applicable
    expect(() => Quantity.of(10, "°C").add(Quantity.of(5, "°C"))).toThrow();
  });
});
