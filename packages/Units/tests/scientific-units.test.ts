/**
 * tests/scientific-units.test.ts — Phase 21: Advanced Physical & Scientific Units.
 *
 * Every factor asserted here is an exact definitional value with its source
 * in the pack file. Tests use tolerance only where the engine day-base
 * forces a non-terminating binary expansion (e.g. /86400 chains), never to
 * hide a wrong constant.
 */
import { describe, expect, it } from "vitest";
import {
  Quantity,
  createRegistry,
  SI_PACK,
  SCIENTIFIC_PACK,
  CGS_PACK,
  IMPERIAL_PACK,
  ANGLE_PACK,
  RADIATION_PACK,
  ASTRONOMY_PACK,
  INFORMATION_PACK,
  dimensionsEqual,
  Dim,
  formatQuantity,
  serializeQuantity,
  deserializeQuantity,
  canonicalUnitKey,
  makeUnit,
} from "../src/index.js";
import { convert } from "../src/conversion-engine.js";
import { UnsupportedTransformationError } from "../src/errors/index.js";

const reg = createRegistry({
  packs: [
    SI_PACK,
    SCIENTIFIC_PACK,
    CGS_PACK,
    IMPERIAL_PACK,
    ANGLE_PACK,
    RADIATION_PACK,
    ASTRONOMY_PACK,
    INFORMATION_PACK,
  ],
});

const q = (value: number, unit: string) => Quantity.of(value, unit, reg);

// ---------------------------------------------------------------------------
// 21.2 Mechanical identities: derived, never fake dimensions
// ---------------------------------------------------------------------------

describe("mechanical derived identities", () => {
  it("N has the dimension of kg·m/s² (mathematical identity, distinct display)", () => {
    const n = q(1, "N");
    const composed = q(1, "kg·m/s²");
    expect(dimensionsEqual(n.dimension, composed.dimension)).toBe(true);
    expect(n.unit.symbol).not.toBe(composed.unit.symbol);
    expect(n.toBase().value).toBeCloseTo(composed.toBase().value, 6);
  });

  it("Pa = N/m², W = J/s dimensionally (J itself uses the engine E dimension)", () => {
    expect(dimensionsEqual(q(1, "Pa").dimension, q(1, "N/m²").dimension)).toBe(true);
    expect(dimensionsEqual(q(1, "W").dimension, q(1, "J/s").dimension)).toBe(true);
    expect(q(1, "Pa").toBase().value).toBeCloseTo(q(1, "N/m²").toBase().value, 6);
    // Documented engine model: energy J lives on the E base dimension for
    // backward compat, so J is NOT dimensionally N·m (M·L²·T⁻²) here.
    expect(dimensionsEqual(q(1, "J").dimension, q(1, "N·m").dimension)).toBe(false);
    expect(() => q(2, "J").to("N·m", reg)).toThrow();
  });

  it("force = mass × acceleration dimensionally", () => {
    const f = q(2, "kg").multiply(q(3, "m/s²"));
    expect(dimensionsEqual(f.dimension, q(1, "N").dimension)).toBe(true);
    expect(f.to("N", reg).value).toBeCloseTo(6, 9);
  });
});

// ---------------------------------------------------------------------------
// 21.3 Density (mass / volume, no special dimension)
// ---------------------------------------------------------------------------

describe("density via dimension algebra", () => {
  it("kg/m³, g/cm³ and lb/ft³ interconvert", () => {
    expect(q(1000, "kg/m³").to("g/cm³", reg).value).toBeCloseTo(1, 9);
    expect(q(1, "g/cm³").to("kg/m³", reg).value).toBeCloseTo(1000, 9);
    // 1 lb/ft³ = 16.01846337396014 kg/m³ (exact derivation)
    expect(q(1, "lb/ft³").to("kg/m³", reg).value).toBeCloseTo(16.01846337396014, 9);
    expect(q(1, "kg/m³").dimension).toEqual({ M: 1, L: -3 });
  });
});

// ---------------------------------------------------------------------------
// 21.4 Flow rates
// ---------------------------------------------------------------------------

describe("flow rates", () => {
  it("m³/s, L/min, kg/s, kg/h interconvert", () => {
    expect(q(1, "m³/s").to("L/min", reg).value).toBeCloseTo(60000, 9);
    expect(q(1, "kg/s").to("kg/h", reg).value).toBeCloseTo(3600, 9);
    expect(q(1, "L/min").dimension).toEqual({ L: 3, T: -1 });
  });
});

// ---------------------------------------------------------------------------
// 21.5 Pressure (every factor verified)
// ---------------------------------------------------------------------------

describe("pressure units", () => {
  it("SI prefixes: kPa, MPa", () => {
    expect(q(1, "kPa").to("Pa", reg).value).toBe(1000);
    expect(q(1, "MPa").to("Pa", reg).value).toBe(1000000);
  });

  it("bar/mbar: 1 bar = 1e5 Pa exactly", () => {
    expect(q(1, "bar").to("Pa", reg).value).toBe(100000);
    expect(q(1013.25, "mbar").to("Pa", reg).value).toBeCloseTo(101325, 9);
  });

  it("atm = 101325 Pa exact; mmHg = 133.322387415 Pa; inHg = 25.4 × mmHg", () => {
    expect(q(1, "atm").to("Pa", reg).value).toBe(101325);
    expect(q(1, "mmHg").to("Pa", reg).value).toBeCloseTo(133.322387415, 9);
    expect(q(1, "inHg").to("Pa", reg).value).toBeCloseTo(25.4 * 133.322387415, 6);
    expect(q(1, "inHg").to("mmHg", reg).value).toBeCloseTo(25.4, 12);
  });

  it("psi and psf from shared lbf definitions", () => {
    expect(q(1, "psi").to("Pa", reg).value).toBeCloseTo(6894.757293168, 6);
    expect(q(1, "psf").to("Pa", reg).value).toBeCloseTo(47.88025898033583, 6);
    expect(q(1, "psi").to("psf", reg).value).toBeCloseTo(144, 9);
  });
});

// ---------------------------------------------------------------------------
// 21.6 Force
// ---------------------------------------------------------------------------

describe("force units", () => {
  it("N/kN/MN via prefixes; dyn; lbf; kgf = 9.80665 N exact", () => {
    expect(q(1, "kN").to("N", reg).value).toBe(1000);
    expect(q(1, "MN").to("N", reg).value).toBe(1000000);
    expect(q(1, "dyn").to("N", reg).value).toBeCloseTo(1e-5, 12);
    expect(q(1, "lbf").to("N", reg).value).toBeCloseTo(4.4482216152605, 9);
    expect(q(1, "kgf").to("N", reg).value).toBeCloseTo(9.80665, 12);
  });
});

// ---------------------------------------------------------------------------
// 21.7 Energy (BTU variants never silently collapsed)
// ---------------------------------------------------------------------------

describe("energy units", () => {
  it("J/kJ/MJ prefixes; erg = 1e-7 J", () => {
    // NOTE: kJ/J chains through the legacy 0.239006 MJ constant, so the
    // ratio carries 1-ulp IEEE noise (999.9999999999999) — tolerance, not
    // exactness, is the honest assertion for chained constants.
    expect(q(1, "kJ").to("J", reg).value).toBeCloseTo(1000, 12);
    expect(q(1, "erg").to("J", reg).value).toBeCloseTo(1e-7, 12);
  });

  it("cal = 4.184 J exact; kcal via prefix", () => {
    expect(q(1, "cal").to("J", reg).value).toBe(4.184);
    expect(q(1, "kcal").to("J", reg).value).toBe(4184);
  });

  it("Wh/kWh: 1 Wh = 3600 J exact", () => {
    expect(q(1, "Wh").to("J", reg).value).toBeCloseTo(3600, 9);
    expect(q(1, "kWh").to("J", reg).value).toBeCloseTo(3600000, 6);
  });

  it("BTU variants are distinct units", () => {
    const it = q(1, "BTU").to("J", reg).value;
    const th = q(1, "BTU_th").to("J", reg).value;
    const mean = q(1, "BTU_mean").to("J", reg).value;
    expect(it).toBeCloseTo(1055.05585262, 6);
    expect(th).toBeCloseTo(1054.35, 6);
    expect(mean).toBeCloseTo(1055.87, 6);
    expect(it).not.toBeCloseTo(th, 6);
    expect(q(1, "BTU_IT").to("J", reg).value).toBeCloseTo(it, 12); // alias
  });
});

// ---------------------------------------------------------------------------
// 21.8 Power (horsepower variants documented + distinct)
// ---------------------------------------------------------------------------

describe("power units", () => {
  it("W/kW/MW/GW via prefixes", () => {
    expect(q(1, "kW").to("W", reg).value).toBe(1000);
    // Prompt-18 note: prefix composition carries ≤1 ulp float dust, so the
    // GW assertion uses tolerance (exact equality on conversions is fragile
    // per the floating-point policy; ratios remain exact).
    expect(q(1, "GW").to("W", reg).value).toBeCloseTo(1e9, 6);
  });

  it("horsepower variants: electric > mechanical > metric", () => {
    const mech = q(1, "hp").to("W", reg).value;
    const metric = q(1, "hp_metric").to("W", reg).value;
    const electric = q(1, "hp_electric").to("W", reg).value;
    // Prompt-18 correction: hp factors compose from the corrected W base
    // (previously understated ~48.4×); values use tolerance for ≤1 ulp dust.
    expect(mech).toBeCloseTo(745.69987158227, 6);
    expect(metric).toBeCloseTo(735.49875, 6);
    expect(electric).toBeCloseTo(746, 6);
    expect(electric).toBeGreaterThan(mech);
    expect(mech).toBeGreaterThan(metric);
  });
});

// ---------------------------------------------------------------------------
// 21.9/21.10 Angle and solid angle
// ---------------------------------------------------------------------------

describe("angle and solid angle", () => {
  it("deg/arcmin/arcsec/rev convert to rad", () => {
    expect(q(180, "deg").to("rad", reg).value).toBeCloseTo(Math.PI, 12);
    expect(q(1, "rev").to("deg", reg).value).toBeCloseTo(360, 9);
    expect(q(1, "deg").to("arcmin", reg).value).toBeCloseTo(60, 9);
    expect(q(1, "arcmin").to("arcsec", reg).value).toBeCloseTo(60, 9);
    expect(q(1, "turn").to("rad", reg).value).toBeCloseTo(2 * Math.PI, 9); // alias
  });

  it("angle is dimensionless but kind-tagged; sr likewise", () => {
    expect(q(1, "rad").dimension).toEqual({});
    expect(q(1, "rad").kind).toBe("angle");
    expect(q(1, "sr").kind).toBe("solid-angle");
    expect(q(1, "fraction").kind).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 21.11/21.28 Temperature incl. Rankine + affine regression
// ---------------------------------------------------------------------------

describe("temperature scales and affine safety", () => {
  it("Rankine: 0 °R = 0 K,  Rankine intervals equal kelvin intervals × 9/5", () => {
    expect(Quantity.of(0, "°R", reg).to("K", reg).value).toBe(0);
    expect(Quantity.of(491.67, "°R", reg).to("°F", reg).value).toBeCloseTo(32, 9);
    expect(Quantity.of(9, "°R", reg).to("K", reg).value).toBeCloseTo(5, 12);
  });

  it("absolute vs difference: Δ1 °C = Δ1 K but 1 °C ≠ 1 K", () => {
    expect(Quantity.of(1, "°C", reg).to("K", reg).value).toBeCloseTo(274.15, 12);
    const delta = Quantity.of(20, "°C", reg).subtract(Quantity.of(19, "°C", reg));
    expect(delta.value).toBeCloseTo(1, 12);
    expect(delta.kind).toBe("temperature-difference");
  });

  it("affine regression: absolute + absolute throws; absolute ± delta works", () => {
    expect(() => Quantity.of(10, "°C", reg).add(Quantity.of(5, "°C", reg))).toThrow();
    expect(Quantity.of(10, "°C", reg).add(Quantity.of(5, "K", reg)).value).toBeCloseTo(15, 12);
  });
});

// ---------------------------------------------------------------------------
// 21.13 Frequency
// ---------------------------------------------------------------------------

describe("frequency", () => {
  it("Hz/kHz/MHz/GHz/THz with T⁻¹ dimension", () => {
    expect(q(1, "kHz").to("Hz", reg).value).toBe(1000);
    expect(q(1, "GHz").to("Hz", reg).value).toBe(1e9);
    expect(q(1, "Hz").dimension).toEqual({ T: -1 });
    expect(q(1, "kHz").kind).toBe("frequency"); // kind survives prefixing
  });
});

// ---------------------------------------------------------------------------
// 21.14/21.15 Electrical quantities + compound forms via algebra
// ---------------------------------------------------------------------------

describe("electrical units", () => {
  it("V = W/A, Ω = V/A, C = A·s dimensionally", () => {
    expect(dimensionsEqual(q(1, "V").dimension, q(1, "W/A").dimension)).toBe(true);
    expect(dimensionsEqual(q(1, "Ω").dimension, q(1, "V/A").dimension)).toBe(true);
    expect(dimensionsEqual(q(1, "C").dimension, q(1, "A·s").dimension)).toBe(true);
    // Prompt-18 note: ≤1 ulp composition dust → tolerance, not exact equality.
    expect(q(12, "V").to("mV", reg).value).toBeCloseTo(12000, 6);
  });

  it("compound forms work through generic algebra: V/m, Ω·m, S/m", () => {
    expect(q(100, "V/m").to("V/cm", reg).value).toBeCloseTo(1, 9);
    expect(q(1, "Ω·m").dimension).toEqual({ E: 1, T: -1, I: -2, L: 1 });
    expect(q(1, "S/m").toBase().value).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 21.16 Radioactivity (factors, no casual equation)
// ---------------------------------------------------------------------------

describe("radioactivity units", () => {
  it("Bq/Ci: 1 Ci = 3.7e10 Bq exact", () => {
    expect(q(1, "Ci").to("Bq", reg).value).toBe(3.7e10);
    expect(q(1, "MBq").to("Bq", reg).value).toBe(1e6);
    expect(q(1, "Bq").kind).toBe("activity");
  });

  it("Gy/rd and Sv/rem scales; dose kinds differ", () => {
    expect(q(1, "rd").to("Gy", reg).value).toBeCloseTo(0.01, 12);
    expect(q(100, "rem").to("Sv", reg).value).toBeCloseTo(1, 12);
    expect(q(1, "Gy").kind).toBe("absorbed-dose");
    expect(q(1, "Sv").kind).toBe("equivalent-dose");
  });
});

// ---------------------------------------------------------------------------
// 21.17 Optics
// ---------------------------------------------------------------------------

describe("optics units", () => {
  it("nm via prefixes; lm/lx/cd present with photometric kinds", () => {
    expect(q(550, "nm").to("m", reg).value).toBeCloseTo(5.5e-7, 12);
    expect(q(1, "lm").kind).toBe("luminous-flux");
    expect(q(1, "lx").kind).toBe("illuminance");
    expect(q(1, "cd").kind).toBe("luminous-intensity");
    expect(q(1, "lx").to("lm/m²", reg).value).toBeCloseTo(1, 9);
  });
});

// ---------------------------------------------------------------------------
// 21.18/21.27 Logarithmic units: declared extension point, explicit rejection
// ---------------------------------------------------------------------------

describe("logarithmic units (deferred, never faked)", () => {
  it("a declared logarithmic unit cannot be converted or composed", () => {
    const dB = makeUnit({
      symbol: "dB",
      dimension: {},
      conversion: { kind: "logarithmic", reference: 1, factor: 10 },
      label: "decibel",
    });
    const dBv = makeUnit({
      symbol: "dBV",
      dimension: {},
      conversion: { kind: "logarithmic", reference: 1, factor: 20 },
      label: "decibel (field)",
    });
    // Identity is still identity (same reference, same factor) — correct.
    expect(convert(10, dB, dB)).toBe(10);
    expect(Quantity.of(10, dB).to(dB).value).toBe(10);
    // Anything else fails explicitly — never silent NaN.
    expect(() => convert(10, dB, dBv)).toThrow(UnsupportedTransformationError);
    expect(() => Quantity.of(10, dB).to(dBv)).toThrow(UnsupportedTransformationError);
    expect(() => Quantity.of(10, "m", reg).multiply(Quantity.of(3, dB))).toThrow();
    expect(() => Quantity.of(10, "m", reg).divide(Quantity.of(3, dB))).toThrow();
  });

  it("custom conversions are declarative but not executable", () => {
    const custom = makeUnit({
      symbol: "cu",
      dimension: Dim.Length,
      conversion: { kind: "custom", id: "host:length-calibration" },
      label: "custom",
    });
    expect(() => Quantity.of(1, custom).to("m", reg)).toThrow(UnsupportedTransformationError);
  });
});

// ---------------------------------------------------------------------------
// 21.19/21.20 Chemistry (algebra only, no reaction logic)
// ---------------------------------------------------------------------------

describe("chemical quantities via algebra", () => {
  it("mol/L, mol/kg, kg/mol preserve their distinct dimensions", () => {
    expect(q(1, "mol/L").dimension).toEqual({ Substance: 1, L: -3 });
    expect(q(1, "mol/kg").dimension).toEqual({ Substance: 1, M: -1 });
    expect(q(1, "kg/mol").dimension).toEqual({ M: 1, Substance: -1 });
    expect(q(2, "mol/L").to("mmol/L", reg).value).toBeCloseTo(2000, 9);
    expect(q(1, "mol/L").to("mol/m³", reg).value).toBeCloseTo(1000, 9);
  });
});

// ---------------------------------------------------------------------------
// 21.21/21.22 Material science + fluids via algebra
// ---------------------------------------------------------------------------

describe("material and fluid quantities via algebra", () => {
  it("stress/modulus share pressure dimension; strain is dimensionless", () => {
    expect(dimensionsEqual(q(1, "Pa").dimension, q(1, "N/m²").dimension)).toBe(true);
    expect(q(1, "mm/mm").dimension).toEqual({});
  });

  it("poise/stokes convert to SI dynamic/kinematic viscosity", () => {
    expect(q(1, "P").to("Pa·s", reg).value).toBeCloseTo(0.1, 12);
    expect(q(1, "St").to("m²/s", reg).value).toBeCloseTo(1e-4, 12);
  });
});

// ---------------------------------------------------------------------------
// 21.24 Astronomy
// ---------------------------------------------------------------------------

describe("astronomical distances", () => {
  it("AU exact; light-year exact; parsec derived from AU", () => {
    expect(q(1, "AU").to("m", reg).value).toBe(149597870700);
    expect(q(1, "lyr").to("m", reg).value).toBe(9460730472580800);
    // 1 pc = 648000/π AU (IAU 2015) — recomputed here, not copied
    expect(q(1, "pc").to("AU", reg).value).toBeCloseTo(648000 / Math.PI, 9);
    expect(q(1, "kpc").to("pc", reg).value).toBe(1000);
    expect(q(1, "Mpc").to("kpc", reg).value).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// 21.25 Time scales (Julian year yes, civil month no)
// ---------------------------------------------------------------------------

describe("time scales", () => {
  it("Julian year = 365.25 days; week = 7 days", () => {
    expect(q(1, "yr").to("day", reg).value).toBe(365.25);
    expect(q(1, "week").to("day", reg).value).toBe(7);
  });

  it("civil month is not a unit (no fixed duration to fake)", () => {
    expect(() => q(1, "month")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 21.26 Information units (dedicated dimension, decimal vs binary)
// ---------------------------------------------------------------------------

describe("information units", () => {
  it("byte = 8 bit; kB decimal vs KiB binary never confused", () => {
    expect(q(1, "byte").to("bit", reg).value).toBe(8);
    expect(q(1, "kB").to("bit", reg).value).toBe(8000);
    expect(q(1, "KiB").to("bit", reg).value).toBe(8192);
    expect(q(1, "MiB").to("KiB", reg).value).toBe(1024);
    expect(q(1, "kB").kind).toBe("information");
  });

  it("information is not a pure ratio", () => {
    expect(() => q(8, "bit").to("fraction", reg)).toThrow();
    expect(q(1, "bit").dimension).toEqual({ Info: 1 });
  });
});

// ---------------------------------------------------------------------------
// 21.32 Canonical identities + 21.33 pack mechanics
// ---------------------------------------------------------------------------

describe("canonical identities and pack mechanics", () => {
  it("N and kg·m/s² share dimension; canonical keys agree", () => {
    const n = q(1, "N");
    const composed = q(1, "kg·m/s²");
    expect(dimensionsEqual(n.dimension, composed.dimension)).toBe(true);
    expect(canonicalUnitKey(n.unit)).toBe(canonicalUnitKey(composed.unit));
  });

  it("every new unit round-trips serialization and formats", () => {
    for (const symbol of [
      "deg",
      "sr",
      "Bq",
      "Gy",
      "Sv",
      "AU",
      "pc",
      "bit",
      "KiB",
      "°R",
      "inHg",
      "psf",
      "kgf",
    ]) {
      const original = q(2.5, symbol);
      const restored = deserializeQuantity(
        JSON.parse(JSON.stringify(serializeQuantity(original))),
        reg,
      );
      expect(restored.value).toBe(2.5);
      expect(formatQuantity(original)).toContain(original.unit.symbol);
    }
  });

  it("aliases resolve: turn→rev, rad_dose→rd, BTU_IT→BTU, octet→byte", () => {
    expect(q(1, "turn").to("rev", reg).value).toBe(1);
    expect(q(1, "rad_dose").to("Gy", reg).value).toBeCloseTo(0.01, 12);
    expect(q(1, "octet").to("bit", reg).value).toBe(8);
  });
});
