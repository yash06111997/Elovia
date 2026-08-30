import { rmSync } from "node:fs";

const userAgent = process.env.npm_config_user_agent ?? "";

if (!userAgent.startsWith("pnpm/")) {
  console.error("Use pnpm instead");
  process.exit(1);
}

for (const lockfile of ["package-lock.json", "yarn.lock"]) {
  rmSync(new URL(`../${lockfile}`, import.meta.url), { force: true });
}
