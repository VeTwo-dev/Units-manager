import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
const license = pkg.license as string;

let failed = false;
try {
  const content = await readFile(join(root, "LICENSE"), "utf-8");
  if (!content.toLowerCase().includes(license.toLowerCase())) {
    console.error(`LICENSE does not mention the "${license}" license`);
    failed = true;
  }
} catch {
  console.error("LICENSE file is missing");
  failed = true;
}

if (failed) process.exitCode = 1;
else console.log(`license check passed (${license})`);
