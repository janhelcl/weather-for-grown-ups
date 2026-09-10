import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { shutdownGribDecodePool } from "../src/grib/grib-decode-pool.js";

const script = process.argv[2];
if (script === undefined) {
  throw new Error("Usage: tsx scripts/run-live-smoke.ts <script>");
}

try {
  await import(pathToFileURL(resolve("scripts", script)).href);
} finally {
  // Source-mode worker threads inherit tsx loader IPC and can keep one-off
  // smoke processes alive even after their assertions finish. Live checks are
  // process boundaries just like the CLI, so they own pool teardown too.
  shutdownGribDecodePool();
}
