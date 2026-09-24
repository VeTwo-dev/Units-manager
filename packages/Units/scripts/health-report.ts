import { execSync } from "node:child_process";

const steps: Array<[string, string]> = [
  ["type-checking", "tsc --noEmit"],
  ["linting", "eslint . --max-warnings=0"],
  ["testing", "vitest run"],
];

let failed = 0;
for (const [label, command] of steps) {
  try {
    execSync(command, { stdio: "inherit" });
    console.log(`[ok] ${label}`);
  } catch {
    console.error(`[failed] ${label}`);
    failed += 1;
  }
}

if (failed === 0) {
  console.log("health report: all checks passed");
} else {
  console.error(`health report: ${failed} check(s) failed`);
  process.exitCode = 1;
}
