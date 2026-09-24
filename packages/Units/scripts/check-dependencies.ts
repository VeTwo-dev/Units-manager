import { execSync } from "node:child_process";

execSync("knip", { stdio: "inherit" });
console.log("dependency check passed");
