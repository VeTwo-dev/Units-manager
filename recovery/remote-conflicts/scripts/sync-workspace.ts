import { execSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
const packagesDir = join(root, "packages");
const reportsDir = join(root, "reports", "architecture");

// 1. Build the inter-package dependency graph with madge.
execSync(`madge packages --image "${join(reportsDir, "workspace-graph.svg")}"`, {
  cwd: root,
  stdio: "inherit",
});

// 2. Check that shared dependencies resolve to the same version in
//    every workspace package.
const versions = new Map<string, Map<string, string>>();
for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkg = JSON.parse(await readFile(join(packagesDir, entry.name, "package.json"), "utf-8"));
  for (const [dep, range] of Object.entries<string>({
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  })) {
    if (!versions.has(dep)) versions.set(dep, new Map());
    versions.get(dep)!.set(pkg.name, range);
  }
}

let failed = 0;
for (const [dep, ranges] of versions) {
  const unique = new Set(ranges.values());
  if (unique.size > 1) {
    console.error(`"${dep}" has divergent versions across the workspace:`);
    for (const [pkg, range] of ranges) console.error(`  ${pkg}: ${range}`);
    failed += 1;
  }
}

if (failed === 0) {
  console.log("workspace dependencies are aligned");
} else {
  console.error(`sync-workspace: ${failed} dependency(ies) out of sync`);
  process.exitCode = 1;
}
