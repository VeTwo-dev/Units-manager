import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
const targets = ["dist", "coverage", "temp", ".turbo", "node_modules/.cache"];

for (const target of targets) {
  await rm(join(root, target), { recursive: true, force: true });
  console.log(`removed ${target}`);
}
