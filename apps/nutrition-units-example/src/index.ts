/**
 * @vetwo/nutrition-units-example — external-style consumer demo.
 *
 * Uses ONLY public package APIs (never relative ../../src imports):
 *   - NutritionMeasurementOptions / NutritionSampleOptions contracts
 *   - basis + context conversion with explicit failure modes
 *   - safe unit conversion, sample lookup, serialize/deserialize
 *   - small deterministic report
 *
 * Run: pnpm --filter @vetwo/nutrition-units-example start
 */
import { Measurement, Quantity } from "@vetwo/units";
import {
  InvalidNutritionContextError,
  MissingNutritionContextError,
  NutritionMeasurement,
  NutritionMeasurementSet,
  NutritionSample,
  createNutritionContext,
  type NutritionMeasurementOptions,
  type NutritionSampleOptions,
} from "@vetwo/nutrition-units";

export interface DemoFailure {
  readonly case: string;
  readonly errorName: string;
  readonly message: string;
}

export interface DemoResult {
  readonly report: string;
  readonly calciumMgPerKgAsFed: number;
  readonly calciumGPerKgAsFed: number;
  readonly proteinPctDryMatter: number;
  readonly sampleSize: number;
  readonly roundTripEqual: boolean;
  readonly failures: readonly DemoFailure[];
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

export function runDemo(): DemoResult {
  // 1–4. Measurements + semantic identity + basis + context (typed options).
  const measurementOpts: NutritionMeasurementOptions = {
    context: createNutritionContext({ dryMatterFraction: 0.9 }),
    metadata: { reference: "consumer-demo" },
  };
  const calcium = NutritionMeasurement.of(
    Measurement.of(Quantity.of(100, "mg/kg"), Quantity.of(3, "mg/kg")),
    "ca",
    "asFed",
    measurementOpts,
  );
  const protein = NutritionMeasurement.from(9, "%", "cp", "asFed");

  // 5. Validate: range check on the physical value (dimension-safe).
  const inRange = (v: number, lo: number, hi: number): boolean => v >= lo && v <= hi;
  if (!inRange(calcium.value.value, 0, 1000)) throw new Error("calcium out of range");

  // 6. Safe unit conversion (mg/kg → g/kg) + basis conversion (asFed → DM).
  const calciumGPerKg = calcium.to("g/kg");
  const proteinDM = protein.convertBasis("dryMatter", measurementOpts.context);

  // 7–8. Sample creation (typed options) + retrieval.
  const sampleOpts: NutritionSampleOptions = {
    id: "consumer-demo-001",
    context: measurementOpts.context,
    measurements: [calcium, proteinDM],
  };
  const sample = new NutritionSample(sampleOpts);
  const set = new NutritionMeasurementSet([...sample]);
  const foundCa = set.getOrThrow("ca", "asFed");

  // 9–10. Serialize → deserialize → deterministic report.
  const json = JSON.stringify(sample.toJSON());
  const back = NutritionSample.fromJSON(JSON.parse(json) as unknown);
  const backSet = new NutritionMeasurementSet([...back]);
  const roundTripEqual =
    back.id === sample.id &&
    back.measurements.length === sample.measurements.length &&
    backSet.get("ca", "asFed")?.value.value === 100 &&
    backSet.get("cp", "drymatter")?.value.value === proteinDM.value.value;

  const reportLines = [
    `sample ${sample.id} (${String(sample.measurements.length)} measurements)`,
    `Ca ${fmt(foundCa.value.value)} ${foundCa.value.unit.symbol} asFed = ${fmt(calciumGPerKg.value.value)} ${calciumGPerKg.value.unit.symbol} asFed`,
    `CP ${fmt(protein.value.value)} ${protein.value.unit.symbol} asFed = ${fmt(proteinDM.value.value)} ${proteinDM.value.unit.symbol} DM`,
    `round-trip ${roundTripEqual ? "ok" : "MISMATCH"}`,
  ];

  // 11. Failure modes — typed errors, no silent wrong results.
  const failures: DemoFailure[] = [];
  try {
    protein.convertBasis("dryMatter");
    throw new Error("expected MissingNutritionContextError");
  } catch (e) {
    if (!(e instanceof MissingNutritionContextError)) throw e;
    failures.push({ case: "basis-without-context", errorName: e.name, message: e.message });
  }
  try {
    createNutritionContext({ dryMatterFraction: 0.9, moistureFraction: 0.2 });
    throw new Error("expected InvalidNutritionContextError");
  } catch (e) {
    if (!(e instanceof InvalidNutritionContextError)) throw e;
    failures.push({ case: "inconsistent-context", errorName: e.name, message: e.message });
  }

  return {
    report: reportLines.join("\n"),
    calciumMgPerKgAsFed: foundCa.value.value,
    calciumGPerKgAsFed: calciumGPerKg.value.value,
    proteinPctDryMatter: proteinDM.value.value,
    sampleSize: sample.measurements.length,
    roundTripEqual,
    failures,
  };
}

// Executable entrypoint (tsx src/index.ts).
const isMain = process.argv[1]?.endsWith("apps/nutrition-units-example/src/index.ts");
if (isMain) {
  const result = runDemo();
  console.log(result.report);
  for (const f of result.failures) console.log(`handled ${f.case}: ${f.errorName}`);
}
