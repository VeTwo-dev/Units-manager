import { execSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";

execSync("tsup", { cwd: root, stdio: "inherit" });

async function walk(dir: string): Promise<Array<[string, number]>> {
  const entries: Array<[string, number]> = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) entries.push(...(await walk(full)));
    else if (entry.isFile()) entries.push([relative(root, full), (await stat(full)).size]);
  }
  return entries;
}

const files = await walk(join(root, "dist"));
let total = 0;
for (const [file, size] of files) {
  console.log(`${(size / 1024).toFixed(2)} kB  ${file}`);
  total += size;
}
console.log(`total bundle: ${(total / 1024).toFixed(2)} kB`);
