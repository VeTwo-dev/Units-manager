import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
const reportsDir = join(root, "reports", "architecture");
mkdirSync(reportsDir, { recursive: true });

const out = join(reportsDir, "dependency-graph.svg");
execSync(`madge src --image "${out}"`, {
  cwd: root,
  stdio: "inherit",
});
console.log(`dependency graph written to ${out}`);
