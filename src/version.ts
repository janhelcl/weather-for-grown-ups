import { readFileSync } from "node:fs";

interface PackageMetadata {
  version?: unknown;
}

function loadPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageMetadata;

  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("package.json must define a non-empty version");
  }

  return packageJson.version;
}

export const WFG_VERSION = loadPackageVersion();
