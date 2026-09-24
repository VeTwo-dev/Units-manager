import { execSync } from "node:child_process";

console.log("validating exports with publint...");
execSync("publint", { stdio: "inherit" });

console.log("type-checking the package...");
execSync("tsc --noEmit", { stdio: "inherit" });

console.log("exports validation passed");
